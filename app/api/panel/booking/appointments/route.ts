import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import { roundCurrency, formatDateTR, getIstanbulTodayISO } from '@/lib/format';
import { computeAvailableSlots } from '@/lib/booking-slots';
import { dispatchAppointmentNotifications } from '@/lib/booking-notifications';
import { DEFAULT_BUSINESS_HOURS, formatTimeHHMM } from '@/lib/booking-helpers';

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
  const { error, ctx, db, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !db || !ctx.business) return error!;

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

    const [
      { data: page },
      { data: service },
      { data: allStaff },
      { data: staffServices },
      { data: wh },
      { data: breaks },
      { data: leaves },
      { data: appts },
    ] = await Promise.all([
      db.from('booking_pages').select('*').eq('business_id', businessId).maybeSingle(),
      db.from('booking_services').select('*').eq('id', serviceId).eq('business_id', businessId).maybeSingle(),
      db.from('booking_staff').select('id, full_name, is_active').eq('business_id', businessId).eq('is_active', true),
      db.from('staff_services').select('staff_id, service_id').eq('business_id', businessId),
      db.from('staff_working_hours').select('*').eq('business_id', businessId),
      db.from('staff_breaks').select('*').eq('business_id', businessId),
      db.from('staff_leaves').select('*').eq('business_id', businessId).lte('start_date', dateISO).gte('end_date', dateISO),
      db
        .from('appointments')
        .select('id, staff_id, start_time, end_time, status')
        .eq('business_id', businessId)
        .eq('appointment_date', dateISO)
        .in('status', ['pending', 'confirmed', 'completed']),
    ]);

    if (!service) return NextResponse.json({ slots: [] });

    let candidateStaffIds = (allStaff ?? []).map((s) => s.id);
    const serviceMappings = (staffServices ?? []).filter((ss) => ss.service_id === serviceId);
    if (serviceMappings.length > 0) {
      const allowedSet = new Set(serviceMappings.map((m) => m.staff_id));
      candidateStaffIds = candidateStaffIds.filter((id) => allowedSet.has(id));
    }
    if (staffId !== 'any') {
      candidateStaffIds = candidateStaffIds.filter((id) => id === staffId);
    }

    const slots = computeAvailableSlots({
      dateISO,
      serviceDurationMinutes: service.duration_minutes,
      slotIntervalMinutes: page?.slot_interval_minutes ?? 15,
      minAdvanceMinutes: 0,
      maxAdvanceDays: 180,
      businessHours: page?.business_hours ?? DEFAULT_BUSINESS_HOURS,
      candidateStaffIds,
      staffWorkingHours: wh ?? [],
      staffBreaks: breaks ?? [],
      staffLeaves: leaves ?? [],
      existingAppointments: appts ?? [],
      ignoreAppointmentId,
      enforceAdvanceRules: false,
    });

    return NextResponse.json({ slots });
  }

  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  let query = db
    .from('appointments')
    .select('*, customer:booking_customers(id, first_name, last_name, phone, email)')
    .eq('business_id', businessId)
    .order('appointment_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (startDate) query = query.gte('appointment_date', startDate);
  if (endDate) query = query.lte('appointment_date', endDate);

  const [{ data: appointments }, { data: services }, { data: staff }, { data: customers }, { data: payments }] =
    await Promise.all([
      query,
      db.from('booking_services').select('*').eq('business_id', businessId).order('sort_order', { ascending: true }),
      db.from('booking_staff').select('*').eq('business_id', businessId).order('sort_order', { ascending: true }),
      db.from('booking_customers').select('*').eq('business_id', businessId).eq('is_active', true).order('first_name', { ascending: true }),
      db.from('appointment_payments').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
    ]);

  const paymentMap = new Map<string, typeof payments>();
  (payments ?? []).forEach((p) => {
    const arr = paymentMap.get(p.appointment_id) ?? [];
    arr.push(p);
    paymentMap.set(p.appointment_id, arr);
  });

  const enrichedAppointments = (appointments ?? []).map((a) => ({
    ...a,
    service_price_snapshot: Number(a.service_price_snapshot),
    paid_amount: Number(a.paid_amount),
    payments: paymentMap.get(a.id) ?? [],
  }));

  return NextResponse.json({
    readOnly,
    appointments: enrichedAppointments,
    services: services ?? [],
    staff: staff ?? [],
    customers: customers ?? [],
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessBookingContext('booking.manage');
  if (error || !ctx || !db || !ctx.business) return error!;

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

  // Müşteri seçimi veya hızlı yeni müşteri oluşturma
  let bookingCustomerId = d.bookingCustomerId ?? null;
  let customerUserId: string | null = null;

  if (!bookingCustomerId) {
    if (!d.newCustomer) {
      return NextResponse.json({ error: 'Müşteri seçiniz veya yeni müşteri bilgisi giriniz.' }, { status: 400 });
    }
    const { data: createdCust, error: custErr } = await db
      .from('booking_customers')
      .insert({
        business_id: businessId,
        first_name: d.newCustomer.firstName,
        last_name: d.newCustomer.lastName,
        phone: d.newCustomer.phone,
        email: d.newCustomer.email.toLowerCase(),
      })
      .select('id, customer_user_id')
      .single();
    if (custErr || !createdCust) {
      return NextResponse.json({ error: custErr?.message ?? 'Müşteri oluşturulamadı.' }, { status: 500 });
    }
    bookingCustomerId = createdCust.id;
    customerUserId = createdCust.customer_user_id;
  } else {
    const { data: custRow } = await db
      .from('booking_customers')
      .select('id, customer_user_id')
      .eq('id', bookingCustomerId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (!custRow) {
      return NextResponse.json({ error: 'Seçilen müşteri bulunamadı.' }, { status: 404 });
    }
    customerUserId = custRow.customer_user_id;
  }

  // Sayfa kaydı yoksa otomatik taslak oluştur
  const { data: page } = await db
    .from('booking_pages')
    .select('id, slot_interval_minutes, business_hours')
    .eq('business_id', businessId)
    .maybeSingle();
  if (!page) {
    return NextResponse.json(
      { error: 'Önce Randevu Sayfası Tasarımı veya Ayarları bölümünden sayfanızı kaydediniz.' },
      { status: 400 }
    );
  }

  let candidateStaffIds: string[] = [];
  if (d.staffId === 'any') {
    const [{ data: service }, { data: allStaff }, { data: staffServices }, { data: wh }, { data: breaks }, { data: leaves }, { data: appts }] =
      await Promise.all([
        db.from('booking_services').select('duration_minutes').eq('id', d.serviceId).eq('business_id', businessId).single(),
        db.from('booking_staff').select('id').eq('business_id', businessId).eq('is_active', true),
        db.from('staff_services').select('staff_id').eq('business_id', businessId).eq('service_id', d.serviceId),
        db.from('staff_working_hours').select('*').eq('business_id', businessId),
        db.from('staff_breaks').select('*').eq('business_id', businessId),
        db.from('staff_leaves').select('*').eq('business_id', businessId).lte('start_date', d.appointmentDate).gte('end_date', d.appointmentDate),
        db.from('appointments').select('id, staff_id, start_time, end_time, status').eq('business_id', businessId).eq('appointment_date', d.appointmentDate).in('status', ['pending', 'confirmed', 'completed']),
      ]);

    let pool = (allStaff ?? []).map((s) => s.id);
    if ((staffServices ?? []).length > 0) {
      const allowed = new Set((staffServices ?? []).map((ss) => ss.staff_id));
      pool = pool.filter((id) => allowed.has(id));
    }

    const slots = computeAvailableSlots({
      dateISO: d.appointmentDate,
      serviceDurationMinutes: service?.duration_minutes ?? 30,
      slotIntervalMinutes: page.slot_interval_minutes ?? 15,
      minAdvanceMinutes: 0,
      maxAdvanceDays: 180,
      businessHours: page.business_hours ?? DEFAULT_BUSINESS_HOURS,
      candidateStaffIds: pool,
      staffWorkingHours: wh ?? [],
      staffBreaks: breaks ?? [],
      staffLeaves: leaves ?? [],
      existingAppointments: appts ?? [],
      enforceAdvanceRules: false,
    });
    const matchedSlot = slots.find((s) => s.time === d.startTime);
    if (!matchedSlot) {
      return NextResponse.json({ error: 'Seçilen saatte uygun personel bulunamadı.' }, { status: 409 });
    }
    candidateStaffIds = matchedSlot.availableStaffIds;
  } else {
    candidateStaffIds = [d.staffId];
  }

  let createdResult: Record<string, unknown> | null = null;
  let lastErrorMsg = 'Randevu oluşturulamadı.';

  for (const targetStaffId of candidateStaffIds) {
    const { data: rpcData, error: rpcErr } = await db.rpc('create_appointment_atomic', {
      p_business_id: businessId,
      p_booking_customer_id: bookingCustomerId,
      p_customer_user_id: customerUserId,
      p_service_id: d.serviceId,
      p_staff_id: targetStaffId,
      p_appointment_date: d.appointmentDate,
      p_start_time: d.startTime,
      p_customer_notes: '',
      p_business_notes: d.businessNotes,
      p_source: 'panel',
      p_status: d.status,
    });

    if (!rpcErr && rpcData) {
      createdResult = rpcData as Record<string, unknown>;
      break;
    }
    lastErrorMsg = rpcErr?.message ?? lastErrorMsg;
  }

  if (!createdResult) {
    return NextResponse.json({ error: lastErrorMsg }, { status: 409 });
  }

  await dispatchAppointmentNotifications(db, {
    businessId,
    appointmentId: String(createdResult.id),
    customerUserId,
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
  const { error, ctx, db } = await requireBusinessBookingContext(requiredPerm);
  if (error || !ctx || !db || !ctx.business) return error!;

  const businessId = ctx.business.id;

  const { data: existing } = await db
    .from('appointments')
    .select('*')
    .eq('id', d.id)
    .eq('business_id', businessId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'Randevu bulunamadı.' }, { status: 404 });
  }

  if (d.action === 'update_notes') {
    const { data: updated, error: updErr } = await db
      .from('appointments')
      .update({ business_notes: d.businessNotes, updated_at: new Date().toISOString() })
      .eq('id', d.id)
      .eq('business_id', businessId)
      .select('*')
      .single();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ appointment: updated });
  }

  if (d.action === 'update_status') {
    const patch: Record<string, unknown> = {
      status: d.status,
      updated_at: new Date().toISOString(),
    };
    if (d.status === 'cancelled') {
      patch.cancelled_by = 'business';
      patch.cancellation_reason = d.cancellationReason;
    }

    const { data: updated, error: updErr } = await db
      .from('appointments')
      .update(patch)
      .eq('id', d.id)
      .eq('business_id', businessId)
      .select('*')
      .single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    if (d.status === 'confirmed' && existing.status !== 'confirmed') {
      await dispatchAppointmentNotifications(db, {
        businessId,
        appointmentId: d.id,
        customerUserId: existing.customer_user_id,
        type: 'appointment_confirmed',
        customerTitle: 'Randevunuz Onaylandı',
        customerMessage: `${ctx.business.name} - ${formatDateTR(existing.appointment_date)} saat ${formatTimeHHMM(existing.start_time)} randevunuz onaylandı.`,
      });
    } else if (d.status === 'cancelled' && existing.status !== 'cancelled') {
      await dispatchAppointmentNotifications(db, {
        businessId,
        appointmentId: d.id,
        customerUserId: existing.customer_user_id,
        type: 'appointment_cancelled',
        customerTitle: 'Randevunuz İptal Edildi',
        customerMessage: `${ctx.business.name} - ${formatDateTR(existing.appointment_date)} saat ${formatTimeHHMM(existing.start_time)} randevunuz işletme tarafından iptal edildi.`,
      });
    }

    return NextResponse.json({ appointment: updated });
  }

  if (d.action === 'reschedule') {
    const { data: res, error: rpcErr } = await db.rpc('reschedule_appointment_atomic', {
      p_appointment_id: d.id,
      p_new_date: d.appointmentDate,
      p_new_start_time: d.startTime,
      p_new_staff_id: d.staffId ?? null,
      p_actor: 'business',
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 409 });
    }

    await dispatchAppointmentNotifications(db, {
      businessId,
      appointmentId: d.id,
      customerUserId: existing.customer_user_id,
      type: 'appointment_rescheduled',
      customerTitle: 'Randevu Saatiniz Güncellendi',
      customerMessage: `${ctx.business.name} randevunuz ${formatDateTR(d.appointmentDate)} saat ${d.startTime} olarak güncellendi.`,
    });

    return NextResponse.json({ result: res });
  }

  // action === 'record_payment' -> Mevcut Gelir/Gider Tablolarına Atomik Kayıt
  const { data: payRes, error: payErr } = await db.rpc('record_appointment_payment', {
    p_appointment_id: d.id,
    p_business_id: businessId,
    p_user_id: ctx.userId,
    p_amount: roundCurrency(d.amount),
    p_payment_type: d.paymentType,
    p_payment_method: d.paymentMethod,
    p_payment_date: d.paymentDate || getIstanbulTodayISO(),
    p_notes: d.notes,
    p_idempotency_key: d.idempotencyKey ?? null,
  });

  if (payErr) {
    return NextResponse.json({ error: payErr.message }, { status: 400 });
  }

  return NextResponse.json({ payment: payRes });
}
