import { NextResponse } from 'next/server';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import { getIstanbulMonthBounds, getIstanbulTodayISO, roundCurrency } from '@/lib/format';
import { slugifyBookingTitle } from '@/lib/booking-helpers';

export async function GET() {
  const { error, ctx, db, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !db || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const today = getIstanbulTodayISO();
  const { start: monthStart, end: monthEnd } = getIstanbulMonthBounds();

  const [
    { data: page },
    { data: appointments },
    { data: payments },
    { data: services },
    { data: staff },
    { data: customers },
    { data: reviews },
  ] = await Promise.all([
    db.from('booking_pages').select('*').eq('business_id', businessId).maybeSingle(),
    db
      .from('appointments')
      .select('*, customer:booking_customers(id, first_name, last_name, phone)')
      .eq('business_id', businessId)
      .order('appointment_date', { ascending: true })
      .order('start_time', { ascending: true }),
    db
      .from('appointment_payments')
      .select('amount, payment_type, payment_date')
      .eq('business_id', businessId)
      .gte('payment_date', monthStart)
      .lte('payment_date', monthEnd),
    db.from('booking_services').select('id, is_active').eq('business_id', businessId),
    db.from('booking_staff').select('id, is_active').eq('business_id', businessId),
    db.from('booking_customers').select('id').eq('business_id', businessId),
    db
      .from('appointment_reviews')
      .select('id, rating, moderation_status, created_at, comment')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false }),
  ]);

  const appts = appointments ?? [];
  const todayAppointments = appts.filter((a) => a.appointment_date === today && a.status !== 'cancelled');
  const pendingCount = appts.filter((a) => a.status === 'pending').length;
  const monthAppointments = appts.filter(
    (a) => a.appointment_date >= monthStart && a.appointment_date <= monthEnd && a.status !== 'cancelled'
  );
  const completedThisMonth = monthAppointments.filter((a) => a.status === 'completed').length;

  const monthRevenue = roundCurrency(
    (payments ?? []).reduce(
      (sum, p) => sum + (p.payment_type === 'refund' ? -Number(p.amount) : Number(p.amount)),
      0
    )
  );

  const publishedReviews = (reviews ?? []).filter((r) => r.moderation_status !== 'hidden');
  const averageRating =
    publishedReviews.length > 0
      ? Math.round(
          (publishedReviews.reduce((acc, r) => acc + Number(r.rating), 0) / publishedReviews.length) *
            10
        ) / 10
      : 0;

  return NextResponse.json({
    readOnly,
    moduleEnabled:
      ctx.business.booking_module_enabled !== false &&
      ctx.business.booking_module_mode !== 'addon_locked',
    isSubscriptionActive: ctx.isSubscriptionActive,
    suggestedSlug: slugifyBookingTitle(ctx.business.name) || ctx.business.business_code.toLowerCase(),
    page: page ?? null,
    metrics: {
      todayCount: todayAppointments.length,
      pendingCount,
      monthCount: monthAppointments.length,
      completedThisMonth,
      monthRevenue,
      activeServices: (services ?? []).filter((s) => s.is_active).length,
      activeStaff: (staff ?? []).filter((s) => s.is_active).length,
      totalCustomers: (customers ?? []).length,
      averageRating,
      reviewCount: publishedReviews.length,
    },
    todayAppointments: todayAppointments.slice(0, 12),
    upcomingPending: appts
      .filter((a) => a.status === 'pending' && a.appointment_date >= today)
      .slice(0, 8),
  });
}
