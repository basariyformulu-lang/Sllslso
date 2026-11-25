import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/auth-server';
import { getIstanbulMonthBounds, getIstanbulTodayISO, roundCurrency } from '@/lib/format';

export async function GET(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessContext('reports.view');
  if (error || !ctx || !db || !ctx.business) return error!;

  const { searchParams } = new URL(req.url);
  const { start: defaultStart } = getIstanbulMonthBounds();
  const today = getIstanbulTodayISO();
  const startDate = searchParams.get('startDate') || defaultStart;
  const endDate = searchParams.get('endDate') || today;
  const businessId = ctx.business.id;

  const [
    { data: incomes },
    { data: expenses },
    { data: customers },
    { data: custTx },
    { data: suppliers },
    { data: suppTx },
    { data: creditSales },
    { data: recurringCards },
    { data: recurringPeriods },
  ] = await Promise.all([
    db
      .from('income_transactions')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_cancelled', false)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: false }),
    db
      .from('expense_transactions')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_cancelled', false)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: false }),
    db.from('customers').select('*').eq('business_id', businessId),
    db
      .from('customer_transactions')
      .select('*, customer:customers(name, last_name, phone)')
      .eq('business_id', businessId)
      .eq('is_cancelled', false)
      .order('transaction_date', { ascending: false }),
    db.from('suppliers').select('*').eq('business_id', businessId),
    db
      .from('supplier_transactions')
      .select('*, supplier:suppliers(company_name, phone)')
      .eq('business_id', businessId)
      .eq('is_cancelled', false)
      .order('transaction_date', { ascending: false }),
    db
      .from('credit_sales')
      .select('*, customer:customers(name, last_name, phone)')
      .eq('business_id', businessId)
      .eq('is_cancelled', false)
      .order('due_date', { ascending: true }),
    db
      .from('recurring_expenses')
      .select('*')
      .eq('business_id', businessId)
      .order('title', { ascending: true }),
    db
      .from('recurring_expense_periods')
      .select('*, recurring_expense:recurring_expenses(title, category)')
      .eq('business_id', businessId)
      .eq('status', 'paid')
      .gte('paid_date', startDate)
      .lte('paid_date', endDate)
      .order('paid_date', { ascending: false }),
  ]);

  // Günlük & Aylık gelir/gider agregasyonu
  const dailyMap = new Map<string, { date: string; income: number; expense: number }>();
  const monthlyMap = new Map<string, { month: string; income: number; expense: number }>();

  (incomes ?? []).forEach((i) => {
    const d = i.transaction_date;
    const m = d.slice(0, 7);
    const curD = dailyMap.get(d) ?? { date: d, income: 0, expense: 0 };
    curD.income = roundCurrency(curD.income + Number(i.amount));
    dailyMap.set(d, curD);

    const curM = monthlyMap.get(m) ?? { month: m, income: 0, expense: 0 };
    curM.income = roundCurrency(curM.income + Number(i.amount));
    monthlyMap.set(m, curM);
  });

  (expenses ?? []).forEach((e) => {
    const d = e.transaction_date;
    const m = d.slice(0, 7);
    const curD = dailyMap.get(d) ?? { date: d, income: 0, expense: 0 };
    curD.expense = roundCurrency(curD.expense + Number(e.amount));
    dailyMap.set(d, curD);

    const curM = monthlyMap.get(m) ?? { month: m, income: 0, expense: 0 };
    curM.expense = roundCurrency(curM.expense + Number(e.amount));
    monthlyMap.set(m, curM);
  });

  // Müşteri alacak raporu
  const customerReport = (customers ?? [])
    .map((c) => {
      const txs = (custTx ?? []).filter((t) => t.customer_id === c.id);
      const opening = Number(c.opening_balance ?? 0);
      const debt = txs.filter((t) => t.transaction_type === 'debt').reduce((a, t) => a + Number(t.amount), 0);
      const paid = txs.filter((t) => t.transaction_type === 'payment').reduce((a, t) => a + Number(t.amount), 0);
      const balance = roundCurrency(opening + txs.reduce((a, t) => a + Number(t.signed_amount), 0));
      return {
        id: c.id,
        name: `${c.name} ${c.last_name}`.trim(),
        phone: c.phone,
        totalDebt: roundCurrency(opening + debt),
        totalPayment: roundCurrency(paid),
        balance,
      };
    })
    .filter((r) => r.balance !== 0 || r.totalDebt > 0);

  // Toptancı borç raporu
  const supplierReport = (suppliers ?? [])
    .map((s) => {
      const txs = (suppTx ?? []).filter((t) => t.supplier_id === s.id);
      const opening = Number(s.opening_balance ?? 0);
      const debt = txs.filter((t) => t.transaction_type === 'debt').reduce((a, t) => a + Number(t.amount), 0);
      const paid = txs.filter((t) => t.transaction_type === 'payment').reduce((a, t) => a + Number(t.amount), 0);
      const balance = roundCurrency(opening + txs.reduce((a, t) => a + Number(t.signed_amount), 0));
      return {
        id: s.id,
        companyName: s.company_name,
        phone: s.phone,
        totalDebt: roundCurrency(opening + debt),
        totalPayment: roundCurrency(paid),
        balance,
      };
    })
    .filter((r) => r.balance !== 0 || r.totalDebt > 0);

  // Vadesi gelen alacaklar
  const dueReceivables = (creditSales ?? [])
    .filter((cs) => Number(cs.total_amount) > Number(cs.paid_amount) && cs.due_date <= endDate)
    .map((cs) => ({
      id: cs.id,
      customerName: cs.customer ? `${cs.customer.name} ${cs.customer.last_name}`.trim() : '—',
      description: cs.description,
      saleDate: cs.sale_date,
      dueDate: cs.due_date,
      totalAmount: roundCurrency(cs.total_amount),
      paidAmount: roundCurrency(cs.paid_amount),
      remainingAmount: roundCurrency(Number(cs.total_amount) - Number(cs.paid_amount)),
      isOverdue: cs.due_date < today,
    }));

  // Vadesi gelen toptancı borçları
  const duePayables = (suppTx ?? [])
    .filter((t) => t.transaction_type === 'debt' && t.due_date && t.due_date <= endDate)
    .map((t) => ({
      id: t.id,
      supplierName: t.supplier?.company_name ?? '—',
      description: t.description,
      transactionDate: t.transaction_date,
      dueDate: t.due_date,
      amount: roundCurrency(t.amount),
      isOverdue: t.due_date < today,
    }));

  // Tahsilat ve ödeme geçmişi (tarih aralığına göre)
  const collectionHistory = (custTx ?? []).filter(
    (t) =>
      t.transaction_type === 'payment' &&
      t.transaction_date >= startDate &&
      t.transaction_date <= endDate
  );

  const supplierPaymentHistory = (suppTx ?? []).filter(
    (t) =>
      t.transaction_type === 'payment' &&
      t.transaction_date >= startDate &&
      t.transaction_date <= endDate
  );

  // Birleşik finansal hareketler
  const allMovements = [
    ...(incomes ?? []).map((i) => ({
      id: `inc-${i.id}`,
      date: i.transaction_date,
      type: 'Gelir',
      party: i.category_name,
      description: i.title,
      amount: roundCurrency(i.amount),
      direction: '+' as const,
    })),
    ...(expenses ?? []).map((e) => ({
      id: `exp-${e.id}`,
      date: e.transaction_date,
      type: 'Gider',
      party: e.category_name,
      description: e.title,
      amount: roundCurrency(e.amount),
      direction: '-' as const,
    })),
    ...collectionHistory.map((c) => ({
      id: `col-${c.id}`,
      date: c.transaction_date,
      type: 'Müşteri Tahsilatı',
      party: c.customer ? `${c.customer.name} ${c.customer.last_name}`.trim() : 'Müşteri',
      description: c.description,
      amount: roundCurrency(c.amount),
      direction: '+' as const,
    })),
    ...supplierPaymentHistory.map((p) => ({
      id: `pay-${p.id}`,
      date: p.transaction_date,
      type: 'Toptancı Ödemesi',
      party: p.supplier?.company_name ?? 'Toptancı',
      description: p.description,
      amount: roundCurrency(p.amount),
      direction: '-' as const,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({
    range: { startDate, endDate },
    dailySummary: Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date)),
    monthlySummary: Array.from(monthlyMap.values()).sort((a, b) => b.month.localeCompare(a.month)),
    customerReport,
    supplierReport,
    dueReceivables,
    duePayables,
    collectionHistory,
    supplierPaymentHistory,
    recurringSummary: (recurringCards ?? []).filter((r) => r.is_active),
    recurringRealized: recurringPeriods ?? [],
    allMovements,
  });
}
