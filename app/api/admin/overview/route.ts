import { NextResponse } from 'next/server';
import { requireSystemAdmin } from '@/lib/auth-server';
import { parseJsonField, query, toBool, toIsoString } from '@/lib/db';
import { getIstanbulMonthBounds, roundCurrency } from '@/lib/format';

export async function GET() {
  const { error } = await requireSystemAdmin();
  if (error) return error;

  const { start: monthStart, end: monthEnd } = getIstanbulMonthBounds();
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [businessesRaw, paymentRequestsRaw] = await Promise.all([
    query<Record<string, unknown>>('SELECT * FROM businesses ORDER BY created_at DESC'),
    query<Record<string, unknown>>('SELECT * FROM payment_requests ORDER BY created_at DESC'),
  ]);

  const bizList = businessesRaw.map((b) => ({
    ...b,
    id: String(b.id),
    name: String(b.name),
    is_active: toBool(b.is_active),
    subscription_status: String(b.subscription_status),
    subscription_start_at: toIsoString(b.subscription_start_at),
    subscription_end_at: toIsoString(b.subscription_end_at),
    created_at: toIsoString(b.created_at) ?? '',
  }));

  const reqList = paymentRequestsRaw.map((r) => ({
    ...r,
    id: String(r.id),
    amount: Number(r.amount ?? 0),
    payment_date: String(r.payment_date ?? ''),
    status: String(r.status),
    bank_snapshot: parseJsonField(r.bank_snapshot, {}),
    created_at: toIsoString(r.created_at) ?? '',
  }));

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
