import { NextResponse } from 'next/server';
import { requireSystemAdmin } from '@/lib/auth-server';
import { getIstanbulMonthBounds, roundCurrency } from '@/lib/format';

export async function GET() {
  const { error, db } = await requireSystemAdmin();
  if (error || !db) return error!;

  const { start: monthStart, end: monthEnd } = getIstanbulMonthBounds();
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [{ data: businesses }, { data: paymentRequests }] = await Promise.all([
    db.from('businesses').select('*').order('created_at', { ascending: false }),
    db.from('payment_requests').select('*').order('created_at', { ascending: false }),
  ]);

  const bizList = businesses ?? [];
  const reqList = paymentRequests ?? [];

  const totalBusinesses = bizList.length;
  const activeBusinesses = bizList.filter((b) => b.is_active && b.subscription_status === 'active').length;
  const passiveBusinesses = bizList.filter((b) => !b.is_active || b.subscription_status === 'passive').length;
  const paymentPendingBusinesses = bizList.filter((b) => b.subscription_status === 'payment_pending').length;
  const pendingApprovalBusinesses = bizList.filter((b) => b.subscription_status === 'pending_approval').length;
  const expiredBusinesses = bizList.filter(
    (b) =>
      b.subscription_status === 'expired' ||
      (b.subscription_status === 'active' &&
        b.subscription_end_at &&
        new Date(b.subscription_end_at) <= now)
  ).length;

  const activeThisMonthBusinesses = bizList.filter(
    (b) =>
      b.subscription_status === 'active' &&
      b.is_active &&
      (!b.subscription_end_at || new Date(b.subscription_end_at) >= new Date(`${monthStart}T00:00:00+03:00`))
  ).length;

  const thisMonthCollectedPayments = roundCurrency(
    reqList
      .filter(
        (r) =>
          r.status === 'approved' &&
          r.payment_date >= monthStart &&
          r.payment_date <= monthEnd
      )
      .reduce((acc, r) => acc + Number(r.amount), 0)
  );

  const thisMonthPendingPayments = roundCurrency(
    reqList
      .filter((r) => r.status === 'pending')
      .reduce((acc, r) => acc + Number(r.amount), 0)
  );

  const expiringSoonList = bizList.filter(
    (b) =>
      b.subscription_status === 'active' &&
      b.subscription_end_at &&
      new Date(b.subscription_end_at) > now &&
      new Date(b.subscription_end_at) <= sevenDaysLater
  );

  // Son 6 ay grafik verisi (Europe/Istanbul)
  const monthlySeries: Array<{
    key: string;
    label: string;
    registrations: number;
    revenue: number;
  }> = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('tr-TR', { month: 'short', year: '2-digit' }).format(d);
    const registrations = bizList.filter((b) => String(b.created_at).slice(0, 7) === key).length;
    const revenue = roundCurrency(
      reqList
        .filter((r) => r.status === 'approved' && String(r.payment_date).slice(0, 7) === key)
        .reduce((acc, r) => acc + Number(r.amount), 0)
    );
    monthlySeries.push({ key, label, registrations, revenue });
  }

  return NextResponse.json({
    metrics: {
      totalBusinesses,
      activeBusinesses,
      passiveBusinesses,
      paymentPendingBusinesses,
      pendingApprovalBusinesses,
      expiredBusinesses,
      activeThisMonthBusinesses,
      thisMonthCollectedPayments,
      thisMonthPendingPayments,
      expiringIn7DaysCount: expiringSoonList.length,
    },
    expiringSoonList,
    monthlySeries,
    recentRequests: reqList.slice(0, 8),
  });
}
