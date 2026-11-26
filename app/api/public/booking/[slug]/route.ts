import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleSupabase, isServiceRoleConfigured } from '@/lib/supabase/server';
import { computeAvailableSlots } from '@/lib/booking-slots';
import { DEFAULT_BUSINESS_HOURS } from '@/lib/booking-helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ error: 'Sistem yapılandırılmamış.' }, { status: 503 });
  }

  const { slug } = await params;
  const db = createServiceRoleSupabase()!;

  const { data: page } = await db
    .from('booking_pages')
    .select('*')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();

  if (!page) {
    return NextResponse.json({ error: 'Randevu sayfası bulunamadı.' }, { status: 404 });
  }

  const { data: business } = await db
    .from('businesses')
    .select('id, name, is_active, subscription_status, subscription_end_at, booking_module_enabled, booking_module_mode')
    .eq('id', page.business_id)
    .maybeSingle();

  const subscriptionValid =
    Boolean(business) &&
    business!.is_active &&
    business!.subscription_status === 'active' &&
    (!business!.subscription_end_at || new Date(business!.subscription_end_at).getTime() > Date.now());

  const moduleEnabled =
    business?.booking_module_enabled !== false &&
    business?.booking_module_mode !== 'addon_locked';

  const isBookingOpen = page.status === 'published' && subscriptionValid && moduleEnabled;

  const { searchParams } = new URL(req.url);
  if (searchParams.get('slots') === '1') {
    if (!isBookingOpen) {
      return NextResponse.json({ slots: [], unavailableReason: 'İşletme şu anda online randevu alımına kapalıdır.' });
    }

    const dateISO = searchParams.get('date');
    const serviceId = searchParams.get('serviceId');
    const staffId = searchParams.get('staffId') || 'any';
    const ignoreAppointmentId = searchParams.get('ignoreAppointmentId') || undefined;

    if (!dateISO || !serviceId) {
      return NextResponse.json({ error: 'Tarih ve hizmet seçiniz.' }, { status: 400 });
    }

    const [
      { data: service },
      { data: allStaff },
      { data: staffServices },
      { data: wh },
      { data: breaks },
      { data: leaves },
      { data: appts },
    ] = await Promise.all([
      db
        .from('booking_services')
        .select('id, duration_minutes, is_active')
        .eq('id', serviceId)
        .eq('business_id', page.business_id)
        .eq('is_active', true)
        .maybeSingle(),
      db.from('booking_staff').select('id').eq('business_id', page.business_id).eq('is_active', true),
      db.from('staff_services').select('staff_id, service_id').eq('business_id', page.business_id),
      db.from('staff_working_hours').select('*').eq('business_id', page.business_id),
      db.from('staff_breaks').select('*').eq('business_id', page.business_id),
      db
        .from('staff_leaves')
        .select('*')
        .eq('business_id', page.business_id)
        .lte('start_date', dateISO)
        .gte('end_date', dateISO),
      db
        .from('appointments')
        .select('id, staff_id, start_time, end_time, status')
        .eq('business_id', page.business_id)
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
      slotIntervalMinutes: page.slot_interval_minutes ?? 15,
      minAdvanceMinutes: page.min_advance_minutes ?? 60,
      maxAdvanceDays: page.max_advance_days ?? 30,
      businessHours: page.business_hours ?? DEFAULT_BUSINESS_HOURS,
      candidateStaffIds,
      staffWorkingHours: wh ?? [],
      staffBreaks: breaks ?? [],
      staffLeaves: leaves ?? [],
      existingAppointments: appts ?? [],
      ignoreAppointmentId,
      enforceAdvanceRules: true,
    });

    return NextResponse.json({ slots });
  }

  const [{ data: services }, { data: staff }, { data: staffServices }, { data: reviews }] = await Promise.all([
    db
      .from('booking_services')
      .select('id, name, description, image_url, price, discount_price, duration_minutes, sort_order')
      .eq('business_id', page.business_id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('booking_staff')
      .select('id, full_name, avatar_url, specialties, bio, sort_order')
      .eq('business_id', page.business_id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    db.from('staff_services').select('staff_id, service_id').eq('business_id', page.business_id),
    db
      .from('appointment_reviews')
      .select(
        'id, rating, comment, business_reply, replied_at, created_at, appointment:appointments(service_name_snapshot, staff_name_snapshot), profile:profiles!appointment_reviews_customer_user_id_fkey(first_name, last_name)'
      )
      .eq('business_id', page.business_id)
      .neq('moderation_status', 'hidden')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  const enrichedServices = (services ?? []).map((s) => ({
    ...s,
    price: Number(s.price),
    discount_price: s.discount_price !== null ? Number(s.discount_price) : null,
    staff_ids: (staffServices ?? []).filter((ss) => ss.service_id === s.id).map((ss) => ss.staff_id),
  }));

  const enrichedStaff = (staff ?? []).map((st) => ({
    ...st,
    service_ids: (staffServices ?? []).filter((ss) => ss.staff_id === st.id).map((ss) => ss.service_id),
  }));

  const formattedReviews = (reviews ?? []).map((r) => {
    const prof = Array.isArray(r.profile) ? r.profile[0] : r.profile;
    const appt = Array.isArray(r.appointment) ? r.appointment[0] : r.appointment;
    const first = prof?.first_name ?? 'Müşteri';
    const lastInitial = prof?.last_name ? `${prof.last_name.slice(0, 1)}.` : '';
    return {
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      business_reply: r.business_reply,
      replied_at: r.replied_at,
      created_at: r.created_at,
      customer_name: `${first} ${lastInitial}`.trim(),
      service_name: appt?.service_name_snapshot ?? '',
      staff_name: appt?.staff_name_snapshot ?? '',
    };
  });

  const averageRating =
    formattedReviews.length > 0
      ? Math.round(
          (formattedReviews.reduce((acc, r) => acc + Number(r.rating), 0) / formattedReviews.length) *
            10
        ) / 10
      : 0;

  return NextResponse.json({
    page,
    isBookingOpen,
    closedReason: !subscriptionValid || !moduleEnabled
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
      totalReviews: formattedReviews.length,
    },
  });
}
