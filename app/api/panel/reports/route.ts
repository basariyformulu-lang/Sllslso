import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/auth-server';
import { query, toBool } from '@/lib/db';
import { getIstanbulMonthBounds, getIstanbulTodayISO, roundCurrency } from '@/lib/format';

export async function GET(req: NextRequest) {
  const { error, ctx } = await requireBusinessContext('reports.view');
  if (error || !ctx || !ctx.business) return error!;

  const { searchParams } = new URL(req.url);
  const { start: defaultStart } = getIstanbulMonthBounds();
  const today = getIstanbulTodayISO();
  const startDate = searchParams.get('startDate') || defaultStart;
  const endDate = searchParams.get('endDate') || today;
  const businessId = ctx.business.id;

  const [
    incomes,
    expenses,
    customers,
    custTx,
    suppliers,
    suppTx,
    creditSales,
    recurringCards,
    recurringPeriods,
  ] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT * FROM income_transactions
       WHERE business_id = ? AND is_cancelled = 0 AND transaction_date >= ? AND transaction_date <= ?
       ORDER BY transaction_date DESC`,
      [businessId, startDate, endDate]
    ),
    query<Record<string, unknown>>(
      `SELECT * FROM expense_transactions
       WHERE business_id = ? AND is_cancelled = 0 AND transaction_date >= ? AND transaction_date <= ?
       ORDER BY transaction_date DESC`,
      [businessId, startDate, endDate]
    ),
    query<Record<string, unknown>>('SELECT * FROM customers WHERE business_id = ?', [businessId]),
    query<Record<string, unknown>>(
      `SELECT ct.*, c.name AS c_name, c.last_name AS c_last_name, c.phone AS c_phone
       FROM customer_transactions ct
       LEFT JOIN customers c ON c.id = ct.customer_id
       WHERE ct.business_id = ? AND ct.is_cancelled = 0
       ORDER BY ct.transaction_date DESC`,
      [businessId]
    ),
    query<Record<string, unknown>>('SELECT * FROM suppliers WHERE business_id = ?', [businessId]),
    query<Record<string, unknown>>(
      `SELECT st.*, s.company_name AS s_company_name, s.phone AS s_phone
       FROM supplier_transactions st
       LEFT JOIN suppliers s ON s.id = st.supplier_id
       WHERE st.business_id = ? AND st.is_cancelled = 0
       ORDER BY st.transaction_date DESC`,
      [businessId]
    ),
    query<Record<string, unknown>>(
      `SELECT cs.*, c.name AS c_name, c.last_name AS c_last_name, c.phone AS c_phone
       FROM credit_sales cs
       LEFT JOIN customers c ON c.id = cs.customer_id
       WHERE cs.business_id = ? AND cs.is_cancelled = 0
       ORDER BY cs.due_date ASC`,
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM recurring_expenses WHERE business_id = ? ORDER BY title ASC',
      [businessId]
    ),
    query<Record<string, unknown>>(
      `SELECT p.*, r.title AS r_title, r.category AS r_category
       FROM recurring_expense_periods p
       LEFT JOIN recurring_expenses r ON r.id = p.recurring_expense_id
       WHERE p.business_id = ? AND p.status = 'paid' AND p.paid_date >= ? AND p.paid_date <= ?
       ORDER BY p.paid_date DESC`,
      [businessId, startDate, endDate]
    ),
  ]);

  const dailyMap = new Map<string, { date: string; income: number; expense: number }>();
  const monthlyMap = new Map<string, { month: string; income: number; expense: number }>();

  incomes.forEach((i) => {
    const d = String(i.transaction_date);
    const m = d.slice(0, 7);
    const curD = dailyMap.get(d) ?? { date: d, income: 0, expense: 0 };
    curD.income = roundCurrency(curD.income + Number(i.amount));
    dailyMap.set(d, curD);

    const curM = monthlyMap.get(m) ?? { month: m, income: 0, expense: 0 };
    curM.income = roundCurrency(curM.income + Number(i.amount));
    monthlyMap.set(m, curM);
  });

  expenses.forEach((e) => {
    const d = String(e.transaction_date);
    const m = d.slice(0, 7);
    const curD = dailyMap.get(d) ?? { date: d, income: 0, expense: 0 };
    curD.expense = roundCurrency(curD.expense + Number(e.amount));
    dailyMap.set(d, curD);

    const curM = monthlyMap.get(m) ?? { month: m, income: 0, expense: 0 };
    curM.expense = roundCurrency(curM.expense + Number(e.amount));
    monthlyMap.set(m, curM);
  });

  const customerReport = customers
    .map((c) => {
      const cid = String(c.id);
      const txs = custTx.filter((t) => String(t.customer_id) === cid);
      const opening = Number(c.opening_balance ?? 0);
      const debt = txs
        .filter((t) => t.transaction_type === 'debt')
        .reduce((a, t) => a + Number(t.amount), 0);
      const paid = txs
        .filter((t) => t.transaction_type === 'payment')
        .reduce((a, t) => a + Number(t.amount), 0);
      const balance = roundCurrency(
        opening + txs.reduce((a, t) => a + Number(t.signed_amount), 0)
      );
      return {
        id: cid,
        name: `${String(c.name)} ${String(c.last_name ?? '')}`.trim(),
        phone: String(c.phone ?? ''),
        totalDebt: roundCurrency(opening + debt),
        totalPayment: roundCurrency(paid),
        balance,
      };
    })
    .filter((r) => r.balance !== 0 || r.totalDebt > 0);

  const supplierReport = suppliers
    .map((s) => {
      const sid = String(s.id);
      const txs = suppTx.filter((t) => String(t.supplier_id) === sid);
      const opening = Number(s.opening_balance ?? 0);
      const debt = txs
        .filter((t) => t.transaction_type === 'debt')
        .reduce((a, t) => a + Number(t.amount), 0);
      const paid = txs
        .filter((t) => t.transaction_type === 'payment')
        .reduce((a, t) => a + Number(t.amount), 0);
      const balance = roundCurrency(
        opening + txs.reduce((a, t) => a + Number(t.signed_amount), 0)
      );
      return {
        id: sid,
        companyName: String(s.company_name),
        phone: String(s.phone ?? ''),
        totalDebt: roundCurrency(opening + debt),
        totalPayment: roundCurrency(paid),
        balance,
      };
    })
    .filter((r) => r.balance !== 0 || r.totalDebt > 0);

  const dueReceivables = creditSales
    .filter(
      (cs) =>
        Number(cs.total_amount) > Number(cs.paid_amount) && String(cs.due_date) <= endDate
    )
    .map((cs) => ({
      id: String(cs.id),
      customerName: cs.c_name
        ? `${String(cs.c_name)} ${String(cs.c_last_name ?? '')}`.trim()
        : '—',
      description: String(cs.description),
      saleDate: String(cs.sale_date),
      dueDate: String(cs.due_date),
      totalAmount: roundCurrency(Number(cs.total_amount)),
      paidAmount: roundCurrency(Number(cs.paid_amount)),
      remainingAmount: roundCurrency(Number(cs.total_amount) - Number(cs.paid_amount)),
      isOverdue: String(cs.due_date) < today,
    }));

  const duePayables = suppTx
    .filter(
      (t) =>
        t.transaction_type === 'debt' && t.due_date && String(t.due_date) <= endDate
    )
    .map((t) => ({
      id: String(t.id),
      supplierName: String(t.s_company_name ?? '—'),
      description: String(t.description),
      transactionDate: String(t.transaction_date),
      dueDate: String(t.due_date),
      amount: roundCurrency(Number(t.amount)),
      isOverdue: String(t.due_date) < today,
    }));

  const collectionHistory = custTx.filter(
    (t) =>
      t.transaction_type === 'payment' &&
      String(t.transaction_date) >= startDate &&
      String(t.transaction_date) <= endDate
  );

  const supplierPaymentHistory = suppTx.filter(
    (t) =>
      t.transaction_type === 'payment' &&
      String(t.transaction_date) >= startDate &&
      String(t.transaction_date) <= endDate
  );

  const allMovements = [
    ...incomes.map((i) => ({
      id: `inc-${String(i.id)}`,
      date: String(i.transaction_date),
      type: 'Gelir',
      party: String(i.category_name),
      description: String(i.title),
      amount: roundCurrency(Number(i.amount)),
      direction: '+' as const,
    })),
    ...expenses.map((e) => ({
      id: `exp-${String(e.id)}`,
      date: String(e.transaction_date),
      type: 'Gider',
      party: String(e.category_name),
      description: String(e.title),
      amount: roundCurrency(Number(e.amount)),
      direction: '-' as const,
    })),
    ...collectionHistory.map((c) => ({
      id: `col-${String(c.id)}`,
      date: String(c.transaction_date),
      type: 'Müşteri Tahsilatı',
      party: c.c_name
        ? `${String(c.c_name)} ${String(c.c_last_name ?? '')}`.trim()
        : 'Müşteri',
      description: String(c.description),
      amount: roundCurrency(Number(c.amount)),
      direction: '+' as const,
    })),
    ...supplierPaymentHistory.map((p) => ({
      id: `pay-${String(p.id)}`,
      date: String(p.transaction_date),
      type: 'Toptancı Ödemesi',
      party: String(p.s_company_name ?? 'Toptancı'),
      description: String(p.description),
      amount: roundCurrency(Number(p.amount)),
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
    recurringSummary: recurringCards.filter((r) => toBool(r.is_active)),
    recurringRealized: recurringPeriods.map((p) => ({
      ...p,
      recurring_expense: { title: p.r_title, category: p.r_category },
    })),
    allMovements,
  });
}
