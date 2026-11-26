import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCustomerContext } from '@/lib/auth-server';
import { computeAvailableSlots } from '@/lib/booking-slots';
import { dispatchAppointmentNotifications } from '@/lib/booking-notifications';
import { DEFAULT_BUSINESS_HOURS, formatTimeHHMM } from '@/lib/booking-helpers';
import { formatDateTR } from '@/lib/format';

const customerBookSchema = z.object({
  slug: z.string().trim().min(2),
  serviceId: z.string().uuid('Hizmet seçiniz.'),
  staffId: z.string().min(1, 'Personel seçiniz.'),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  customerNotes: z.string().trim().max(400).optional().default(''),
});

const patchCustomerApptSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('cancel'),
    appointmentId: z.string().uuid(),
    cancellationReason: z.string().trim().max(300).optional().default(''),
  }),
  z.object({
    action: z.literal('reschedule'),
    appointmentId: z.string().uuid(),
    appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    staffId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal('mark_notifications_read'),
  }),
]);

export async function GET() {
  const { error, ctx, db } = await requireCustomerContext();
  if (error || !ctx || !db) return error!;

  const [{ data: appointments }, { data: reviews }, { data: notifications }] = await Promise.all([
    db
      .from('appointments')
      .select(
        '*, business:businesses(id, name), page:booking_pages!appointments_business_id_fkey(slug, page_title, phone, address, cancellation_deadline_hours)'
      )
      .eq('customer_user_id', ctx.userId)
      .order('start_at', { ascending: false }),
    db
      .from('appointment_reviews')
      .select('*')
      .eq('customer_user_id', ctx.userId),
    db
      .from('appointment_notifications')
      .select('*')
      .eq('recipient_user_id', ctx.userId)
      .eq('recipient_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const { data: bookingPages } = await db
    .from('booking_pages')
    .select('business_id, slug, page_title, phone, address, logo_url, cancellation_deadline_hours');

  const pageMap = new Map<string, NonNullable<typeof bookingPages>[number]>();
  (bookingPages ?? []).forEach((p) => pageMap.set(p.business_id, p));

  const reviewByAppt = new Map<string, NonNullable<typeof reviews>[number]>();
  (reviews ?? []).forEach((r) => reviewByAppt.set(r.appointment_id, r));

  const enrichedAppointments = (appointments ?? []).map((a) => {
    const pg = pageMap.get(a.business_id);
    const biz = Array.isArray(a.business) ? a.business[0] : a.business;
    return {
      ...a,
      service_price_snapshot: Number(a.service_price_snapshot),
      paid_amount: Number(a.paid_amount),
      business: {
        id: a.business_id,
        name: pg?.page_title || biz?.name || 'İşletme',
        booking_slug: pg?.slug ?? null,
        phone: pg?.phone ?? '',
        address: pg?.address ?? '',
        logo_url: pg?.logo_url ?? '',
        cancellation_deadline_hours: pg?.cancellation_deadline_hours ?? 2,
      },
      review: reviewByAppt.get(a.id) ?? null,
    };
  });

  // Müşterinin daha önce hizmet aldığı işletmeler
  const visitedMap = new Map<
    string,
    {
      businessId: string;
      name: string;
      slug: string | null;
      logoUrl: string;
      phone: string;
      address: string;
      appointmentCount: number;
    }
  >();

  enrichedAppointments.forEach((a) => {
    const existing = visitedMap.get(a.business_id);
    if (!existing) {
      visitedMap.set(a.business_id, {
        businessId: a.business_id,
        name: a.business.name,
        slug: a.business.booking_slug,
        logoUrl: a.business.logo_url,
        phone: a.business.phone,
        address: a.business.address,
        appointmentCount: 1,
      });
    } else {
      existing.appointmentCount += 1;
    }
  });

  return NextResponse.json({
    customer: ctx.customerAccount,
    appointments: enrichedAppointments,
    visitedBusinesses: Array.from(visitedMap.values()),
    notifications: notifications ?? [],
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireCustomerContext();
  if (error || !ctx || !db) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = customerBookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Randevu bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const { data: page } = await db
    .from('booking_pages')
    .select('*')
    .eq('slug', d.slug.toLowerCase())
    .maybeSingle();

  if (!page) {
    return NextResponse.json({ error: 'İşletme randevu sayfası bulunamadı.' }, { status: 404 });
  }

  const businessId = page.business_id;
  const customerAcc = ctx.customerAccount!;

  // Bu işletme için booking_customers kaydını bul veya oluştur
  let bookingCustomerId: string;
  const { data: existingCust } = await db
    .from('booking_customers')
    .select('id')
    .eq('business_id', businessId)
    .eq('customer_user_id', ctx.userId)
    .maybeSingle();

  if (existingCust) {
    bookingCustomerId = existingCust.id;
  } else {
    const { data: createdCust, error: custErr } = await db
      .from('booking_customers')
      .insert({
        business_id: businessId,
        customer_user_id: ctx.userId,
        first_name: customerAcc.first_name,
        last_name: customerAcc.last_name,
        phone: customerAcc.phone,
        email: customerAcc.email,
      })
      .select('id')
      .single();

    if (custErr || !createdCust) {
      return NextResponse.json({ error: custErr?.message ?? 'Müşteri profili bağlanamadı.' }, { status: 500 });
    }
    bookingCustomerId = createdCust.id;
  }

  // Uygun personel adaylarını belirle ("any" seçildiyse tüm uygun adayları sırayla dene)
  let candidateStaffIds: string[] = [];
  if (d.staffId === 'any') {
    const [{ data: service }, { data: allStaff }, { data: staffServices }, { data: wh }, { data: breaks }, { data: leaves }, { data: appts }] =
      await Promise.all([
        db
          .from('booking_services')
          .select('duration_minutes')
          .eq('id', d.serviceId)
          .eq('business_id', businessId)
          .eq('is_active', true)
          .single(),
        db.from('booking_staff').select('id').eq('business_id', businessId).eq('is_active', true),
        db.from('staff_services').select('staff_id').eq('business_id', businessId).eq('service_id', d.serviceId),
        db.from('staff_working_hours').select('*').eq('business_id', businessId),
        db.from('staff_breaks').select('*').eq('business_id', businessId),
        db
          .from('staff_leaves')
          .select('*')
          .eq('business_id', businessId)
          .lte('start_date', d.appointmentDate)
          .gte('end_date', d.appointmentDate),
        db
          .from('appointments')
          .select('id, staff_id, start_time, end_time, status')
          .eq('business_id', businessId)
          .eq('appointment_date', d.appointmentDate)
          .in('status', ['pending', 'confirmed', 'completed']),
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
      minAdvanceMinutes: page.min_advance_minutes ?? 60,
      maxAdvanceDays: page.max_advance_days ?? 30,
      businessHours: page.business_hours ?? DEFAULT_BUSINESS_HOURS,
      candidateStaffIds: pool,
      staffWorkingHours: wh ?? [],
      staffBreaks: breaks ?? [],
      staffLeaves: leaves ?? [],
      existingAppointments: appts ?? [],
      enforceAdvanceRules: true,
    });

    const matchedSlot = slots.find((s) => s.time === d.startTime);
    if (!matchedSlot) {
      return NextResponse.json(
        { error: 'Seçilen saat dilimi az önce dolmuş olabilir. Lütfen başka bir saat seçiniz.' },
        { status: 409 }
      );
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
      p_customer_user_id: ctx.userId,
      p_service_id: d.serviceId,
      p_staff_id: targetStaffId,
      p_appointment_date: d.appointmentDate,
      p_start_time: d.startTime,
      p_customer_notes: d.customerNotes,
      p_business_notes: '',
      p_source: 'online',
      p_status: null,
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

  const customerDisplayName = `${customerAcc.first_name} ${customerAcc.last_name}`.trim();
  await dispatchAppointmentNotifications(db, {
    businessId,
    appointmentId: String(createdResult.id),
    customerUserId: ctx.userId,
    type: 'new_appointment',
    businessTitle: 'Yeni Online Randevu',
    businessMessage: `${customerDisplayName}, ${formatDateTR(d.appointmentDate)} ${d.startTime} için "${createdResult.service_name}" randevusu aldı.`,
    customerTitle:
      createdResult.status === 'confirmed' ? 'Randevunuz Onaylandı' : 'Randevu Talebiniz Alındı',
    customerMessage: `${page.page_title} - ${formatDateTR(d.appointmentDate)} saat ${d.startTime} (${createdResult.service_name}) kaydınız oluşturuldu.`,
  });

  return NextResponse.json({ appointment: createdResult }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireCustomerContext();
  if (error || !ctx || !db) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = patchCustomerApptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'İşlem bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;

  if (d.action === 'mark_notifications_read') {
    await db
      .from('appointment_notifications')
      .update({ is_read: true })
      .eq('recipient_user_id', ctx.userId)
      .eq('recipient_type', 'customer')
      .eq('is_read', false);
    return NextResponse.json({ success: true });
  }

  const { data: existing } = await db
    .from('appointments')
    .select('*')
    .eq('id', d.appointmentId)
    .eq('customer_user_id', ctx.userId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'Randevu bulunamadı.' }, { status: 404 });
  }

  if (!['pending', 'confirmed'].includes(existing.status)) {
    return NextResponse.json(
      { error: 'Yalnızca bekleyen veya onaylı randevular üzerinde değişiklik yapılabilir.' },
      { status: 400 }
    );
  }

  const { data: page } = await db
    .from('booking_pages')
    .select('page_title, cancellation_deadline_hours')
    .eq('business_id', existing.business_id)
    .maybeSingle();

  const deadlineHours = page?.cancellation_deadline_hours ?? 2;
  const startMs = new Date(existing.start_at).getTime();
  if (startMs - Date.now() < deadlineHours * 60 * 60 * 1000) {
    return NextResponse.json(
      {
        error: `Randevu saatine ${deadlineHours} saatten az kaldığı için online iptal/değişiklik yapılamaz. Lütfen işletme ile iletişime geçiniz.`,
      },
      { status: 400 }
    );
  }

  if (d.action === 'cancel') {
    const { data: updated, error: updErr } = await db
      .from('appointments')
      .update({
        status: 'cancelled',
        cancelled_by: 'customer',
        cancellation_reason: d.cancellationReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('customer_user_id', ctx.userId)
      .select('*')
      .single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    await dispatchAppointmentNotifications(db, {
      businessId: existing.business_id,
      appointmentId: existing.id,
      customerUserId: ctx.userId,
      type: 'appointment_cancelled',
      businessTitle: 'Müşteri Randevusunu İptal Etti',
      businessMessage: `${formatDateTR(existing.appointment_date)} saat ${formatTimeHHMM(existing.start_time)} (${existing.service_name_snapshot}) randevusu müşteri tarafından iptal edildi.`,
      customerTitle: 'Randevunuz İptal Edildi',
      customerMessage: `${page?.page_title ?? 'İşletme'} randevunuz iptal edildi.`,
    });

    return NextResponse.json({ appointment: updated });
  }

  const { data: res, error: rpcErr } = await db.rpc('reschedule_appointment_atomic', {
    p_appointment_id: existing.id,
    p_new_date: d.appointmentDate,
    p_new_start_time: d.startTime,
    p_new_staff_id: d.staffId ?? null,
    p_actor: 'customer',
  });

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 409 });
  }

  await dispatchAppointmentNotifications(db, {
    businessId: existing.business_id,
    appointmentId: existing.id,
    customerUserId: ctx.userId,
    type: 'appointment_rescheduled',
    businessTitle: 'Müşteri Randevu Saatini Değiştirdi',
    businessMessage: `${existing.service_name_snapshot} randevusu ${formatDateTR(d.appointmentDate)} saat ${d.startTime} tarihine alındı.`,
    customerTitle: 'Randevunuz Güncellendi',
    customerMessage: `${page?.page_title ?? 'İşletme'} randevunuz ${formatDateTR(d.appointmentDate)} saat ${d.startTime} olarak güncellendi.`,
  });

  return NextResponse.json({ result: res });
}
