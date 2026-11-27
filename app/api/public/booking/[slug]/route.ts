import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  DEFAULT_BUSINESS_HOURS,
  normalizePhoneTR,
} from '@/lib/booking-helpers';
import {
  createAppointmentAtomic,
  findOrCreateBookingCustomerByPhone,
  formatBookingPageRow,
} from '@/lib/booking-mysql';
import { dispatchAppointmentNotifications } from '@/lib/booking-notifications';
import { computeSlotMatrix } from '@/lib/booking-slots';
import { query, queryOne, toBool, toIsoString } from '@/lib/db';
import { formatDateTR } from '@/lib/format';
import type { StaffBreak, StaffLeave, StaffWorkingHour } from '@/lib/types';

const publicBookSchema = z.object({
  fullName: z.string().trim().min(2, 'Lütfen adınızı ve soyadınızı giriniz.').max(120),
  phone: z.string().trim().min(10, 'Geçerli bir cep telefonu numarası giriniz.').max(25),
  serviceId: z.string().uuid('Lütfen hizmet seçiniz.'),
  staffId: z.string().min(1, 'Lütfen personel seçiniz.'),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  customerNotes: z.string().trim().max(400).optional().default(''),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const pageRow = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_pages WHERE slug = ? LIMIT 1',
    [slug.toLowerCase()]
  );

  if (!pageRow) {
    return NextResponse.json({ error: 'Randevu sayfası bulunamadı.' }, { status: 404 });
  }

  const page = formatBookingPageRow(pageRow);
  const business = await queryOne<{
    id: string;
    name: string;
    is_active: number;
    subscription_status: string;
    subscription_end_at: string | null;
    booking_module_enabled: number;
    booking_module_mode: string;
  }>(
    `SELECT id, name, is_active, subscription_status, subscription_end_at, booking_module_enabled, booking_module_mode
     FROM businesses WHERE id = ? LIMIT 1`,
    [page.business_id]
  );

  const endAtIso = toIsoString(business?.subscription_end_at);
  const subscriptionValid =
    Boolean(business) &&
    toBool(business?.is_active) &&
    business?.subscription_status === 'active' &&
    (!endAtIso || new Date(endAtIso).getTime() > Date.now());

  const moduleEnabled =
    business?.booking_module_enabled !== 0 &&
    business?.booking_module_mode !== 'addon_locked';

  const isBookingOpen = page.status === 'published' && subscriptionValid && moduleEnabled;

  const { searchParams } = new URL(req.url);
  if (searchParams.get('slots') === '1') {
    if (!isBookingOpen) {
      return NextResponse.json({
        slots: [],
        slotMatrix: [],
        unavailableReason: 'İşletme şu anda online randevu alımına kapalıdır.',
      });
    }

    const dateISO = searchParams.get('date');
    const serviceId = searchParams.get('serviceId');
    const staffId = searchParams.get('staffId') || 'any';
    const ignoreAppointmentId = searchParams.get('ignoreAppointmentId') || undefined;

    if (!dateISO || !serviceId) {
      return NextResponse.json({ error: 'Tarih ve hizmet seçiniz.' }, { status: 400 });
    }

    const [service, allStaff, staffServices, whRows, breaksRows, leavesRows, appts] =
      await Promise.all([
        queryOne<{ id: string; duration_minutes: number }>(
          'SELECT id, duration_minutes FROM booking_services WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
          [serviceId, page.business_id]
        ),
        query<{ id: string }>(
          'SELECT id FROM booking_staff WHERE business_id = ? AND is_active = 1',
          [page.business_id]
        ),
        query<{ staff_id: string; service_id: string }>(
          'SELECT staff_id, service_id FROM staff_services WHERE business_id = ?',
          [page.business_id]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_working_hours WHERE business_id = ?',
          [page.business_id]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_breaks WHERE business_id = ?',
          [page.business_id]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_leaves WHERE business_id = ? AND start_date <= ? AND end_date >= ?',
          [page.business_id, dateISO, dateISO]
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
          [page.business_id, dateISO]
        ),
      ]);

    if (!service) return NextResponse.json({ slots: [], slotMatrix: [] });

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

    const slotMatrix = computeSlotMatrix({
      dateISO,
      serviceDurationMinutes: Number(service.duration_minutes || 30),
      slotIntervalMinutes: Math.max(30, page.slot_interval_minutes || 30),
      minAdvanceMinutes: page.min_advance_minutes ?? 60,
      maxAdvanceDays: page.max_advance_days ?? 30,
      businessHours: page.business_hours ?? DEFAULT_BUSINESS_HOURS,
      candidateStaffIds,
      staffWorkingHours: wh,
      staffBreaks: breaks,
      staffLeaves: leaves,
      existingAppointments: appts,
      ignoreAppointmentId,
      enforceAdvanceRules: true,
    });

    const slots = slotMatrix.filter((s) => s.available && Boolean(s.recommendedStaffId));
    return NextResponse.json({ slots, slotMatrix });
  }

  const [services, staff, staffServices, reviews] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT id, name, description, image_url, price, discount_price, duration_minutes, sort_order
       FROM booking_services
       WHERE business_id = ? AND is_active = 1
       ORDER BY sort_order ASC, created_at ASC`,
      [page.business_id]
    ),
    query<Record<string, unknown>>(
      `SELECT id, full_name, avatar_url, specialties, bio, sort_order
       FROM booking_staff
       WHERE business_id = ? AND is_active = 1
       ORDER BY sort_order ASC`,
      [page.business_id]
    ),
    query<{ staff_id: string; service_id: string }>(
      'SELECT staff_id, service_id FROM staff_services WHERE business_id = ?',
      [page.business_id]
    ),
    query<Record<string, unknown>>(
      `SELECT r.id, r.rating, r.comment, r.business_reply, r.replied_at, r.created_at,
              r.customer_name, a.service_name_snapshot, a.staff_name_snapshot
       FROM appointment_reviews r
       LEFT JOIN appointments a ON a.id = r.appointment_id
       WHERE r.business_id = ? AND r.moderation_status <> 'hidden'
       ORDER BY r.created_at DESC
       LIMIT 40`,
      [page.business_id]
    ),
  ]);

  const enrichedServices = services.map((s) => ({
    ...s,
    price: Number(s.price),
    discount_price: s.discount_price !== null ? Number(s.discount_price) : null,
    staff_ids: staffServices.filter((ss) => ss.service_id === s.id).map((ss) => ss.staff_id),
  }));

  const enrichedStaff = staff.map((st) => ({
    ...st,
    service_ids: staffServices.filter((ss) => ss.staff_id === st.id).map((ss) => ss.service_id),
  }));

  const formattedReviews = reviews.map((r) => ({
    id: String(r.id),
    rating: Number(r.rating),
    comment: String(r.comment ?? ''),
    business_reply: r.business_reply ? String(r.business_reply) : null,
    replied_at: toIsoString(r.replied_at),
    created_at: toIsoString(r.created_at),
    customer_name: String(r.customer_name || 'Müşteri'),
    service_name: String(r.service_name_snapshot ?? ''),
    staff_name: String(r.staff_name_snapshot ?? ''),
  }));

  const totalReviews = formattedReviews.length;
  const averageRating =
    totalReviews > 0
      ? Math.round(
          (formattedReviews.reduce((acc, r) => acc + Number(r.rating), 0) / totalReviews) * 10
        ) / 10
      : 0;

  const distribution = [5, 4, 3, 2, 1].map((stars) => {
    const count = formattedReviews.filter((r) => Math.round(r.rating) === stars).length;
    return {
      stars,
      count,
      percentage: totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0,
    };
  });

  return NextResponse.json({
    page,
    isBookingOpen,
    closedReason:
      !subscriptionValid || !moduleEnabled
        ? 'Bu işletmenin online randevu hizmeti geçici olarak kullanılamamaktadır.'
        : page.status === 'paused'
        ? 'İşletme geçici olarak online randevu alımını durdurmuştur.'
        : page.status === 'draft'
        ? 'Bu randevu sayfası henüz yayına alınmamıştır.'
        : null,
    services: enrichedServices,
    staff: enrichedStaff,
    reviews: formattedReviews,
    ratingSummary: {
      averageRating,
      totalReviews,
      distribution,
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = publicBookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Randevu bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const phoneNorm = normalizePhoneTR(d.phone);
  if (phoneNorm.length < 10) {
    return NextResponse.json(
      { error: 'Lütfen 10 haneli geçerli bir cep telefonu numarası giriniz (ör. 05XX XXX XX XX).' },
      { status: 400 }
    );
  }

  const pageRow = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_pages WHERE slug = ? LIMIT 1',
    [slug.toLowerCase()]
  );
  if (!pageRow) {
    return NextResponse.json({ error: 'Randevu sayfası bulunamadı.' }, { status: 404 });
  }

  const page = formatBookingPageRow(pageRow);
  const business = await queryOne<{
    id: string;
    name: string;
    is_active: number;
    subscription_status: string;
    subscription_end_at: string | null;
    booking_module_enabled: number;
    booking_module_mode: string;
  }>(
    `SELECT id, name, is_active, subscription_status, subscription_end_at, booking_module_enabled, booking_module_mode
     FROM businesses WHERE id = ? LIMIT 1`,
    [page.business_id]
  );

  const endAtIso = toIsoString(business?.subscription_end_at);
  const isBookingOpen =
    page.status === 'published' &&
    Boolean(business) &&
    toBool(business?.is_active) &&
    business?.subscription_status === 'active' &&
    (!endAtIso || new Date(endAtIso).getTime() > Date.now()) &&
    business?.booking_module_enabled !== 0 &&
    business?.booking_module_mode !== 'addon_locked';

  if (!isBookingOpen) {
    return NextResponse.json(
      { error: 'Bu işletme şu anda online randevu kabul etmemektedir.' },
      { status: 403 }
    );
  }

  const customer = await findOrCreateBookingCustomerByPhone({
    businessId: page.business_id,
    fullName: d.fullName,
    phone: d.phone,
  });

  let candidateStaffIds: string[] = [];
  if (d.staffId === 'any') {
    const [service, allStaff, staffServices, whRows, breaksRows, leavesRows, appts] =
      await Promise.all([
        queryOne<{ duration_minutes: number }>(
          'SELECT duration_minutes FROM booking_services WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
          [d.serviceId, page.business_id]
        ),
        query<{ id: string }>(
          'SELECT id FROM booking_staff WHERE business_id = ? AND is_active = 1',
          [page.business_id]
        ),
        query<{ staff_id: string }>(
          'SELECT staff_id FROM staff_services WHERE business_id = ? AND service_id = ?',
          [page.business_id, d.serviceId]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_working_hours WHERE business_id = ?',
          [page.business_id]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_breaks WHERE business_id = ?',
          [page.business_id]
        ),
        query<Record<string, unknown>>(
          'SELECT * FROM staff_leaves WHERE business_id = ? AND start_date <= ? AND end_date >= ?',
          [page.business_id, d.appointmentDate, d.appointmentDate]
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
          [page.business_id, d.appointmentDate]
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

    const matrix = computeSlotMatrix({
      dateISO: d.appointmentDate,
      serviceDurationMinutes: Number(service?.duration_minutes ?? 30),
      slotIntervalMinutes: Math.max(30, page.slot_interval_minutes || 30),
      minAdvanceMinutes: page.min_advance_minutes ?? 60,
      maxAdvanceDays: page.max_advance_days ?? 30,
      businessHours: page.business_hours ?? DEFAULT_BUSINESS_HOURS,
      candidateStaffIds: pool,
      staffWorkingHours: wh,
      staffBreaks: breaks,
      staffLeaves: leaves,
      existingAppointments: appts,
      enforceAdvanceRules: true,
    });

    const matched = matrix.find((s) => s.time === d.startTime && s.available);
    if (!matched) {
      return NextResponse.json(
        { error: 'Seçilen saat dilimi az önce dolmuş olabilir. Lütfen başka bir yeşil saat seçiniz.' },
        { status: 409 }
      );
    }
    candidateStaffIds = matched.availableStaffIds;
  } else {
    candidateStaffIds = [d.staffId];
  }

  let createdResult: Awaited<ReturnType<typeof createAppointmentAtomic>> | null = null;
  let lastErrorMsg = 'Randevu oluşturulamadı.';

  for (const targetStaffId of candidateStaffIds) {
    try {
      createdResult = await createAppointmentAtomic({
        businessId: page.business_id,
        bookingCustomerId: customer.id,
        customerName: customer.fullName,
        customerPhone: customer.phone,
        serviceId: d.serviceId,
        staffId: targetStaffId,
        appointmentDate: d.appointmentDate,
        startTime: d.startTime,
        customerNotes: d.customerNotes,
        source: 'online',
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
    businessId: page.business_id,
    appointmentId: createdResult.id,
    customerPhone: customer.phone,
    type: 'new_appointment',
    businessTitle: 'Yeni Online Randevu',
    businessMessage: `${customer.fullName} (${customer.phone}), ${formatDateTR(d.appointmentDate)} ${d.startTime} için "${createdResult.service_name}" randevusu aldı.`,
    customerTitle:
      createdResult.status === 'confirmed' ? 'Randevunuz Onaylandı' : 'Randevu Talebiniz Alındı',
    customerMessage: `${page.page_title} - ${formatDateTR(d.appointmentDate)} saat ${d.startTime} (${createdResult.service_name}) kaydınız oluşturuldu.`,
  });

  return NextResponse.json({ appointment: createdResult }, { status: 201 });
}
