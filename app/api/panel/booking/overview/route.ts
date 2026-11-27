import { NextResponse } from 'next/server';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import { formatBookingPageRow } from '@/lib/booking-mysql';
import { slugifyBookingTitle } from '@/lib/booking-helpers';
import { query, queryOne, toBool, toIsoString } from '@/lib/db';
import { getIstanbulMonthBounds, getIstanbulTodayISO, roundCurrency } from '@/lib/format';

export async function GET() {
  const { error, ctx, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const today = getIstanbulTodayISO();
  const { start: monthStart, end: monthEnd } = getIstanbulMonthBounds();

  const [pageRow, appointments, payments, services, staff, customers, reviews] = await Promise.all([
    queryOne<Record<string, unknown>>(
      'SELECT * FROM booking_pages WHERE business_id = ? LIMIT 1',
      [businessId]
    ),
    query<Record<string, unknown>>(
      `SELECT a.*, bc.first_name AS c_first_name, bc.last_name AS c_last_name, bc.phone AS c_phone
       FROM appointments a
       LEFT JOIN booking_customers bc ON bc.id = a.booking_customer_id
       WHERE a.business_id = ?
       ORDER BY a.appointment_date ASC, a.start_time ASC`,
      [businessId]
    ),
    query<{ amount: number; payment_type: string; payment_date: string }>(
      `SELECT amount, payment_type, payment_date
       FROM appointment_payments
       WHERE business_id = ? AND payment_date >= ? AND payment_date <= ?`,
      [businessId, monthStart, monthEnd]
    ),
    query<{ id: string; is_active: number }>(
      'SELECT id, is_active FROM booking_services WHERE business_id = ?',
      [businessId]
    ),
    query<{ id: string; is_active: number }>(
      'SELECT id, is_active FROM booking_staff WHERE business_id = ?',
      [businessId]
    ),
    query<{ id: string }>(
      'SELECT id FROM booking_customers WHERE business_id = ?',
      [businessId]
    ),
    query<{ id: string; rating: number; moderation_status: string; created_at: string; comment: string }>(
      `SELECT id, rating, moderation_status, created_at, comment
       FROM appointment_reviews
       WHERE business_id = ?
       ORDER BY created_at DESC`,
      [businessId]
    ),
  ]);

  const appts = appointments.map((a) => ({
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
        }
      : {
          id: a.booking_customer_id,
          first_name: String(a.customer_name || 'Müşteri'),
          last_name: '',
          phone: String(a.customer_phone || ''),
        },
  }));

  const todayAppointments = appts.filter(
    (a) => String((a as Record<string, unknown>).appointment_date) === today && (a as Record<string, unknown>).status !== 'cancelled'
  );
  const pendingCount = appts.filter((a) => (a as Record<string, unknown>).status === 'pending').length;
  const monthAppointments = appts.filter((a) => {
    const dt = String((a as Record<string, unknown>).appointment_date);
    return dt >= monthStart && dt <= monthEnd && (a as Record<string, unknown>).status !== 'cancelled';
  });
  const completedThisMonth = monthAppointments.filter(
    (a) => (a as Record<string, unknown>).status === 'completed'
  ).length;

  const monthRevenue = roundCurrency(
    payments.reduce(
      (sum, p) => sum + (p.payment_type === 'refund' ? -Number(p.amount) : Number(p.amount)),
      0
    )
  );

  const publishedReviews = reviews.filter((r) => r.moderation_status !== 'hidden');
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
    suggestedSlug:
      slugifyBookingTitle(ctx.business.name) || ctx.business.business_code.toLowerCase(),
    page: pageRow ? formatBookingPageRow(pageRow) : null,
    metrics: {
      todayCount: todayAppointments.length,
      pendingCount,
      monthCount: monthAppointments.length,
      completedThisMonth,
      monthRevenue,
      activeServices: services.filter((s) => toBool(s.is_active)).length,
      activeStaff: staff.filter((s) => toBool(s.is_active)).length,
      totalCustomers: customers.length,
      averageRating,
      reviewCount: publishedReviews.length,
    },
    todayAppointments: todayAppointments.slice(0, 12),
    upcomingPending: appts
      .filter(
        (a) =>
          (a as Record<string, unknown>).status === 'pending' &&
          String((a as Record<string, unknown>).appointment_date) >= today
      )
      .slice(0, 8),
  });
}
