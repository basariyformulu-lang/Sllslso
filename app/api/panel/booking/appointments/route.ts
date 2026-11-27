import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import {
  DEFAULT_BUSINESS_HOURS,
  formatTimeHHMM,
  normalizePhoneTR,
} from '@/lib/booking-helpers';
import {
  createAppointmentAtomic,
  ensureBookingPageMysql,
  formatBookingPageRow,
  recordAppointmentPaymentAtomic,
  rescheduleAppointmentAtomic,
} from '@/lib/booking-mysql';
import { dispatchAppointmentNotifications } from '@/lib/booking-notifications';
import { computeAvailableSlots } from '@/lib/booking-slots';
import { execute, query, queryOne, toBool, toIsoString, toMySqlDateTime, uuid } from '@/lib/db';
import { formatDateTR, getIstanbulTodayISO, roundCurrency } from '@/lib/format';
import type { StaffBreak, StaffLeave, StaffWorkingHour } from '@/lib/types';

const createPanelAppointmentSchema = z.object({
  bookingCustomerId: z.string().uuid().optional().nullable(),
  newCustomer: z
    .object({
      firstName: z.string().trim().min(2),
      lastName: z.string().trim().optional().default(''),
      phone: z.string().trim().min(7),
      email: z.string().trim().email().or(z.literal('')).optional().default(''),
    })
    .optional(),
  serviceId: z.string().uuid('Hizmet seçiniz.'),
  staffId: z.string().min(1, 'Personel seçiniz.'),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  status: z.enum(['pending', 'confirmed']).optional().default('confirmed'),
  businessNotes: z.string().trim().max(500).optional().default(''),
});

const patchAppointmentSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_status'),
    id: z.string().uuid(),
    status: z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']),
    cancellationReason: z.string().trim().max(300).optional().default(''),
  }),
  z.object({
    action: z.literal('reschedule'),
    id: z.string().uuid(),
    appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    staffId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal('update_notes'),
    id: z.string().uuid(),
    businessNotes: z.string().trim().max(500),
  }),
  z.object({
    action: z.literal('record_payment'),
    id: z.string().uuid(),
    amount: z.coerce.number().positive('Tutar sıfırdan büyük olmalıdır.'),
    paymentType: z.enum(['collection', 'refund']).default('collection'),
    paymentMethod: z.enum(['nakit', 'banka', 'kart', 'diger']).default('nakit'),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().trim().max(300).optional().default(''),
    idempotencyKey: z.string().trim().max(120).optional(),
  }),
]);

export async function GET(req: NextRequest) {
  const { error, ctx, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode');

  if (mode === 'slots') {
    const dateISO = searchParams.get('date');
    const serviceId = searchParams.get('serviceId');
    const staffId = searchParams.get('staffId') || 'any';
    const ignoreAppointmentId = searchParams.get('ignoreAppointmentId') || undefined;

    if (!dateISO || !serviceId) {
      return NextResponse.json({ error: 'Tarih ve hizmet seçimi gereklidir.' }, { status: 400 });
    }

    const [pageRow, service, allStaff, staffServices, whRows, breaksRows, leavesRows, appts] =
      await Promise.all([
        queryOne<Record<string, unknown>>(
          'SELECT * FROM booking_pages WHERE business_id = ? LIMIT 1',
          [businessId]
        ),
        queryOne<Record<string, unknown>>(
          'SELECT * FROM booking_services WHERE id = ? AND business_id = ? LIMIT 1',
          [serviceId, businessId]
        ),
        query<{ id: string }>(
          'SELECT id FROM booking_staff WHERE business_id = ? AND is_active = 1',
          [businessId]
        ),
        query<{ staff_id: string; service_id: string }>(
          'SELECT staff_id, service_id FROM staff_services WHERE business_id = ?',
          [businessId]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_working_hours WHERE business_id = ?',
          [businessId]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_breaks WHERE business_id = ?',
          [businessId]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_leaves WHERE business_id = ? AND start_date <= ? AND end_date >= ?',
          [businessId, dateISO, dateISO]
        ),
        query<{
          id: string;
          staff_id: string;
          start_time: string;
          end_time: string;
          status: string;
        }>(
          `SELECT id, staff_id, start_time, end_time, status
           FROM appointments
           WHERE business_id = ? AND appointment_date = ?
             AND status IN ('pending', 'confirmed', 'completed')`,
          [businessId, dateISO]
        ),
      ]);

    if (!service) return NextResponse.json({ slots: [] });

    const page = pageRow ? formatBookingPageRow(pageRow) : null;
    let candidateStaffIds = allStaff.map((s) => s.id);
    const serviceMappings = staffServices.filter((ss) => ss.service_id === serviceId);
    if (serviceMappings.length > 0) {
      const allowedSet = new Set(serviceMappings.map((m) => m.staff_id));
      candidateStaffIds = candidateStaffIds.filter((id) => allowedSet.has(id));
    }
    if (staffId !== 'any') {
      candidateStaffIds = candidateStaffIds.filter((id) => id === staffId);
    }

    const wh: StaffWorkingHour[] = whRows.map((w) => ({
      id: String(w.id),
      staff_id: String(w.staff_id),
      day_of_week: Number(w.day_of_week),
      is_working: toBool(w.is_working),
      start_time: String(w.start_time).slice(0, 5),
      end_time: String(w.end_time).slice(0, 5),
    }));

    const breaks: StaffBreak[] = breaksRows.map((b) => ({
      id: String(b.id),
      business_id: String(b.business_id),
      staff_id: String(b.staff_id),
      day_of_week: b.day_of_week !== null ? Number(b.day_of_week) : null,
      title: String(b.title),
      start_time: String(b.start_time).slice(0, 5),
      end_time: String(b.end_time).slice(0, 5),
    }));

    const leaves: StaffLeave[] = leavesRows.map((l) => ({
      id: String(l.id),
      business_id: String(l.business_id),
      staff_id: l.staff_id ? String(l.staff_id) : null,
      start_date: String(l.start_date),
      end_date: String(l.end_date),
      reason: String(l.reason ?? ''),
      created_at: toIsoString(l.created_at) ?? '',
    }));

    const slots = computeAvailableSlots({
      dateISO,
      serviceDurationMinutes: Number(service.duration_minutes || 30),
      slotIntervalMinutes: Math.max(30, page?.slot_interval_minutes ?? 30),
      minAdvanceMinutes: 0,
      maxAdvanceDays: 180,
      businessHours: page?.business_hours ?? DEFAULT_BUSINESS_HOURS,
      candidateStaffIds,
      staffWorkingHours: wh,
      staffBreaks: breaks,
      staffLeaves: leaves,
      existingAppointments: appts,
      ignoreAppointmentId,
      enforceAdvanceRules: false,
    });

    return NextResponse.json({ slots });
  }

  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  let apptSql = `SELECT a.*, bc.first_name AS c_first_name, bc.last_name AS c_last_name, bc.phone AS c_phone, bc.email AS c_email
                 FROM appointments a
                 LEFT JOIN booking_customers bc ON bc.id = a.booking_customer_id
                 WHERE a.business_id = ?`;
  const apptParams: unknown[] = [businessId];
  if (startDate) {
    apptSql += ' AND a.appointment_date >= ?';
    apptParams.push(startDate);
  }
  if (endDate) {
    apptSql += ' AND a.appointment_date <= ?';
    apptParams.push(endDate);
  }
  apptSql += ' ORDER BY a.appointment_date ASC, a.start_time ASC';

  const [appointments, services, staff, customers, payments] = await Promise.all([
    query<Record<string, unknown>>(apptSql, apptParams),
    query<Record<string, unknown>>(
      'SELECT * FROM booking_services WHERE business_id = ? ORDER BY sort_order ASC',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM booking_staff WHERE business_id = ? ORDER BY sort_order ASC',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM booking_customers WHERE business_id = ? AND is_active = 1 ORDER BY first_name ASC',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM appointment_payments WHERE business_id = ? ORDER BY created_at DESC',
      [businessId]
    ),
  ]);

  const paymentMap = new Map<string, Record<string, unknown>[]>();
  payments.forEach((p) => {
    const k = String(p.appointment_id);
    const arr = paymentMap.get(k) ?? [];
    arr.push({
      ...p,
      amount: Number(p.amount),
      created_at: toIsoString(p.created_at),
    });
    paymentMap.set(k, arr);
  });

  const enrichedAppointments = appointments.map((a) => ({
    ...a,
    service_price_snapshot: Number(a.service_price_snapshot),
    paid_amount: Number(a.paid_amount),
    start_at: toIsoString(a.start_at),
    end_at: toIsoString(a.end_at),
    created_at: toIsoString(a.created_at),
    customer: a.c_first_name
      ? {
          id: a.booking_customer_id,
          first_name: a.c_first_name,
          last_name: a.c_last_name ?? '',
          phone: a.c_phone ?? a.customer_phone ?? '',
          email: a.c_email ?? '',
        }
      : {
          id: a.booking_customer_id,
          first_name: String(a.customer_name || 'Müşteri'),
          last_name: '',
          phone: String(a.customer_phone || ''),
          email: '',
        },
    payments: paymentMap.get(String(a.id)) ?? [],
  }));

  return NextResponse.json({
    readOnly,
    appointments: enrichedAppointments,
    services: services.map((s) => ({
      ...s,
      price: Number(s.price),
      discount_price: s.discount_price !== null ? Number(s.discount_price) : null,
      is_active: toBool(s.is_active),
    })),
    staff: staff.map((st) => ({ ...st, is_active: toBool(st.is_active) })),
    customers: customers.map((c) => ({ ...c, is_active: toBool(c.is_active) })),
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.manage');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = createPanelAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Randevu bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const businessId = ctx.business.id;
  const nowStr = toMySqlDateTime();

  let bookingCustomerId = d.bookingCustomerId ?? null;
  let customerName = '';
  let customerPhone = '';

  if (!bookingCustomerId) {
    if (!d.newCustomer) {
      return NextResponse.json(
        { error: 'Müşteri seçiniz veya yeni müşteri bilgisi giriniz.' },
        { status: 400 }
      );
    }
    const newId = uuid();
    const norm = normalizePhoneTR(d.newCustomer.phone);
    await execute(
      `INSERT INTO booking_customers
       (id, business_id, customer_user_id, first_name, last_name, phone, phone_normalized, email, notes, is_active, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, '', 1, ?, ?)`,
      [
        newId,
        businessId,
        d.newCustomer.firstName,
        d.newCustomer.lastName,
        d.newCustomer.phone,
        norm,
        d.newCustomer.email.toLowerCase(),
        nowStr,
        nowStr,
      ]
    );
    bookingCustomerId = newId;
    customerName = `${d.newCustomer.firstName} ${d.newCustomer.lastName}`.trim();
    customerPhone = d.newCustomer.phone;
  } else {
    const custRow = await queryOne<Record<string, unknown>>(
      'SELECT id, first_name, last_name, phone FROM booking_customers WHERE id = ? AND business_id = ? LIMIT 1',
      [bookingCustomerId, businessId]
    );
    if (!custRow) {
      return NextResponse.json({ error: 'Seçilen müşteri bulunamadı.' }, { status: 404 });
    }
    customerName = `${String(custRow.first_name ?? '')} ${String(custRow.last_name ?? '')}`.trim();
    customerPhone = String(custRow.phone ?? '');
  }

  const page = await ensureBookingPageMysql(ctx.business);
  if (!page) {
    return NextResponse.json({ error: 'Randevu sayfası oluşturulamadı.' }, { status: 500 });
  }

  let candidateStaffIds: string[] = [];
  if (d.staffId === 'any') {
    const [service, allStaff, staffServices, whRows, breaksRows, leavesRows, appts] =
      await Promise.all([
        queryOne<{ duration_minutes: number }>(
          'SELECT duration_minutes FROM booking_services WHERE id = ? AND business_id = ? LIMIT 1',
          [d.serviceId, businessId]
        ),
        query<{ id: string }>(
          'SELECT id FROM booking_staff WHERE business_id = ? AND is_active = 1',
          [businessId]
        ),
        query<{ staff_id: string }>(
          'SELECT staff_id FROM staff_services WHERE business_id = ? AND service_id = ?',
          [businessId, d.serviceId]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_working_hours WHERE business_id = ?',
          [businessId]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_breaks WHERE business_id = ?',
          [businessId]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_leaves WHERE business_id = ? AND start_date <= ? AND end_date >= ?',
          [businessId, d.appointmentDate, d.appointmentDate]
        ),
        query<{
          id: string;
          staff_id: string;
          start_time: string;
          end_time: string;
          status: string;
        }>(
          `SELECT id, staff_id, start_time, end_time, status
           FROM appointments
           WHERE business_id = ? AND appointment_date = ?
             AND status IN ('pending', 'confirmed', 'completed')`,
          [businessId, d.appointmentDate]
        ),
      ]);

    let pool = allStaff.map((s) => s.id);
    if (staffServices.length > 0) {
      const allowed = new Set(staffServices.map((ss) => ss.staff_id));
      pool = pool.filter((id) => allowed.has(id));
    }

    const wh: StaffWorkingHour[] = whRows.map((w) => ({
      id: String(w.id),
      staff_id: String(w.staff_id),
      day_of_week: Number(w.day_of_week),
      is_working: toBool(w.is_working),
      start_time: String(w.start_time).slice(0, 5),
      end_time: String(w.end_time).slice(0, 5),
    }));

    const breaks: StaffBreak[] = breaksRows.map((b) => ({
      id: String(b.id),
      business_id: String(b.business_id),
      staff_id: String(b.staff_id),
      day_of_week: b.day_of_week !== null ? Number(b.day_of_week) : null,
      title: String(b.title),
      start_time: String(b.start_time).slice(0, 5),
      end_time: String(b.end_time).slice(0, 5),
    }));

    const leaves: StaffLeave[] = leavesRows.map((l) => ({
      id: String(l.id),
      business_id: String(l.business_id),
      staff_id: l.staff_id ? String(l.staff_id) : null,
      start_date: String(l.start_date),
      end_date: String(l.end_date),
      reason: String(l.reason ?? ''),
      created_at: toIsoString(l.created_at) ?? '',
    }));

    const slots = computeAvailableSlots({
      dateISO: d.appointmentDate,
      serviceDurationMinutes: Number(service?.duration_minutes ?? 30),
      slotIntervalMinutes: Math.max(30, page.slot_interval_minutes ?? 30),
      minAdvanceMinutes: 0,
      maxAdvanceDays: 180,
      businessHours: page.business_hours ?? DEFAULT_BUSINESS_HOURS,
      candidateStaffIds: pool,
      staffWorkingHours: wh,
      staffBreaks: breaks,
      staffLeaves: leaves,
      existingAppointments: appts,
      enforceAdvanceRules: false,
    });
    const matchedSlot = slots.find((s) => s.time === d.startTime);
    if (!matchedSlot) {
      return NextResponse.json(
        { error: 'Seçilen saatte uygun personel bulunamadı.' },
        { status: 409 }
      );
    }
    candidateStaffIds = matchedSlot.availableStaffIds;
  } else {
    candidateStaffIds = [d.staffId];
  }

  let createdResult: Awaited<ReturnType<typeof createAppointmentAtomic>> | null = null;
  let lastErrorMsg = 'Randevu oluşturulamadı.';

  for (const targetStaffId of candidateStaffIds) {
    try {
      createdResult = await createAppointmentAtomic({
        businessId,
        bookingCustomerId,
        customerName,
        customerPhone,
        serviceId: d.serviceId,
        staffId: targetStaffId,
        appointmentDate: d.appointmentDate,
        startTime: d.startTime,
        customerNotes: '',
        businessNotes: d.businessNotes,
        source: 'panel',
        status: d.status,
      });
      break;
    } catch (err) {
      lastErrorMsg = err instanceof Error ? err.message : lastErrorMsg;
    }
  }

  if (!createdResult) {
    return NextResponse.json({ error: lastErrorMsg }, { status: 409 });
  }

  await dispatchAppointmentNotifications({
    businessId,
    appointmentId: createdResult.id,
    customerPhone,
    type: d.status === 'confirmed' ? 'appointment_confirmed' : 'new_appointment',
    customerTitle: 'Yeni Randevunuz Oluşturuldu',
    customerMessage: `${ctx.business.name} için ${formatDateTR(d.appointmentDate)} saat ${d.startTime} randevunuz oluşturuldu.`,
  });

  return NextResponse.json({ appointment: createdResult }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = patchAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'İşlem bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const requiredPerm = d.action === 'record_payment' ? 'booking.payments' : 'booking.manage';
  const { error, ctx } = await requireBusinessBookingContext(requiredPerm);
  if (error || !ctx || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM appointments WHERE id = ? AND business_id = ? LIMIT 1',
    [d.id, businessId]
  );

  if (!existing) {
    return NextResponse.json({ error: 'Randevu bulunamadı.' }, { status: 404 });
  }

  const nowStr = toMySqlDateTime();

  if (d.action === 'update_notes') {
    await execute(
      'UPDATE appointments SET business_notes = ?, updated_at = ? WHERE id = ? AND business_id = ?',
      [d.businessNotes, nowStr, d.id, businessId]
    );
    const updated = await queryOne<Record<string, unknown>>(
      'SELECT * FROM appointments WHERE id = ? LIMIT 1',
      [d.id]
    );
    return NextResponse.json({ appointment: updated });
  }

  if (d.action === 'update_status') {
    if (d.status === 'cancelled') {
      await execute(
        `UPDATE appointments
         SET status = 'cancelled', cancelled_by = 'business', cancellation_reason = ?, updated_at = ?
         WHERE id = ? AND business_id = ?`,
        [d.cancellationReason, nowStr, d.id, businessId]
      );
    } else {
      await execute(
        'UPDATE appointments SET status = ?, updated_at = ? WHERE id = ? AND business_id = ?',
        [d.status, nowStr, d.id, businessId]
      );
    }

    const updated = await queryOne<Record<string, unknown>>(
      'SELECT * FROM appointments WHERE id = ? LIMIT 1',
      [d.id]
    );

    if (d.status === 'confirmed' && existing.status !== 'confirmed') {
      await dispatchAppointmentNotifications({
        businessId,
        appointmentId: d.id,
        customerPhone: String(existing.customer_phone ?? ''),
        type: 'appointment_confirmed',
        customerTitle: 'Randevunuz Onaylandı',
        customerMessage: `${ctx.business.name} - ${formatDateTR(String(existing.appointment_date))} saat ${formatTimeHHMM(String(existing.start_time))} randevunuz onaylandı.`,
      });
    } else if (d.status === 'cancelled' && existing.status !== 'cancelled') {
      await dispatchAppointmentNotifications({
        businessId,
        appointmentId: d.id,
        customerPhone: String(existing.customer_phone ?? ''),
        type: 'appointment_cancelled',
        customerTitle: 'Randevunuz İptal Edildi',
        customerMessage: `${ctx.business.name} - ${formatDateTR(String(existing.appointment_date))} saat ${formatTimeHHMM(String(existing.start_time))} randevunuz işletme tarafından iptal edildi.`,
      });
    }

    return NextResponse.json({ appointment: updated });
  }

  if (d.action === 'reschedule') {
    try {
      const res = await rescheduleAppointmentAtomic({
        appointmentId: d.id,
        businessId,
        newDate: d.appointmentDate,
        newStartTime: d.startTime,
        newStaffId: d.staffId ?? null,
      });

      await dispatchAppointmentNotifications({
        businessId,
        appointmentId: d.id,
        customerPhone: String(existing.customer_phone ?? ''),
        type: 'appointment_rescheduled',
        customerTitle: 'Randevu Saatiniz Güncellendi',
        customerMessage: `${ctx.business.name} randevunuz ${formatDateTR(d.appointmentDate)} saat ${d.startTime} olarak güncellendi.`,
      });

      return NextResponse.json({ result: res });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Saat güncellenemedi.' },
        { status: 409 }
      );
    }
  }

  try {
    const payRes = await recordAppointmentPaymentAtomic({
      appointmentId: d.id,
      businessId,
      userId: ctx.userId,
      amount: roundCurrency(d.amount),
      paymentType: d.paymentType,
      paymentMethod: d.paymentMethod,
      paymentDate: d.paymentDate || getIstanbulTodayISO(),
      notes: d.notes,
      idempotencyKey: d.idempotencyKey ?? null,
    });
    return NextResponse.json({ payment: payRes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ödeme kaydedilemedi.' },
      { status: 400 }
    );
  }
}
