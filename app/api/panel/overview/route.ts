import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/auth-server';
import { query, toBool, toIsoString } from '@/lib/db';
import { getIstanbulMonthBounds, getIstanbulTodayISO, roundCurrency } from '@/lib/format';

export async function GET() {
  const { error, ctx } = await requireBusinessContext('reports.view');
  if (error || !ctx || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const today = getIstanbulTodayISO();
  const { start: monthStart, end: monthEnd } = getIstanbulMonthBounds();

  const [
    customers,
    custTx,
    suppliers,
    suppTx,
    creditSalesRows,
    incomes,
    expenses,
    recurring,
    notifications,
  ] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT id, name, last_name, opening_balance, is_active FROM customers WHERE business_id = ?',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM customer_transactions WHERE business_id = ? AND is_cancelled = 0',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT id, company_name, opening_balance, is_active FROM suppliers WHERE business_id = ?',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM supplier_transactions WHERE business_id = ? AND is_cancelled = 0',
      [businessId]
    ),
    query<Record<string, unknown>>(
      `SELECT cs.*, c.name AS c_name, c.last_name AS c_last_name
       FROM credit_sales cs
       LEFT JOIN customers c ON c.id = cs.customer_id
       WHERE cs.business_id = ? AND cs.is_cancelled = 0`,
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM income_transactions WHERE business_id = ? AND is_cancelled = 0',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM expense_transactions WHERE business_id = ? AND is_cancelled = 0',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM recurring_expenses WHERE business_id = ? AND is_active = 1',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM notifications WHERE business_id = ? ORDER BY created_at DESC LIMIT 15',
      [businessId]
    ),
  ]);

  const creditSales = creditSalesRows.map((cs) => ({
    ...cs,
    due_date: String(cs.due_date ?? ''),
    total_amount: Number(cs.total_amount ?? 0),
    paid_amount: Number(cs.paid_amount ?? 0),
    customer: cs.c_name
      ? { name: String(cs.c_name), last_name: String(cs.c_last_name ?? '') }
      : undefined,
  }));

  const custOpening = customers.reduce((acc, c) => acc + Number(c.opening_balance ?? 0), 0);
  const custNetTx = custTx.reduce((acc, t) => acc + Number(t.signed_amount ?? 0), 0);
  const totalCustomerReceivable = roundCurrency(custOpening + custNetTx);

  const suppOpening = suppliers.reduce((acc, s) => acc + Number(s.opening_balance ?? 0), 0);
  const suppNetTx = suppTx.reduce((acc, t) => acc + Number(t.signed_amount ?? 0), 0);
  const totalSupplierDebt = roundCurrency(suppOpening + suppNetTx);

  const dueCreditSales = creditSales.filter(
    (cs) => cs.due_date <= today && Number(cs.total_amount) > Number(cs.paid_amount)
  );
  const dueReceivablesFromCreditSales = dueCreditSales.reduce(
    (acc, cs) => acc + (Number(cs.total_amount) - Number(cs.paid_amount)),
    0
  );
  const directDueDebts = custTx
    .filter(
      (t) =>
        t.transaction_type === 'debt' &&
        !t.credit_sale_id &&
        t.due_date &&
        String(t.due_date) <= today
    )
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const dueReceivables = roundCurrency(
    Math.min(Math.max(0, totalCustomerReceivable), dueReceivablesFromCreditSales + directDueDebts)
  );

  const supplierPaymentsBySupplier = new Map<string, number>();
  suppTx.forEach((t) => {
    if (t.transaction_type === 'payment') {
      const sid = String(t.supplier_id);
      supplierPaymentsBySupplier.set(
        sid,
        (supplierPaymentsBySupplier.get(sid) ?? 0) + Number(t.amount)
      );
    }
  });
  let dueSupplierDebt = 0;
  suppliers.forEach((s) => {
    const sid = String(s.id);
    const dueDebts = suppTx
      .filter(
        (t) =>
          String(t.supplier_id) === sid &&
          t.transaction_type === 'debt' &&
          t.due_date &&
          String(t.due_date) <= today
      )
      .reduce((acc, t) => acc + Number(t.amount), 0);
    const totalSupplierPaid = supplierPaymentsBySupplier.get(sid) ?? 0;
    const totalSupplierBalance = Math.max(
      0,
      Number(s.opening_balance ?? 0) +
        suppTx
          .filter((t) => String(t.supplier_id) === sid)
          .reduce((acc, t) => acc + Number(t.signed_amount ?? 0), 0)
    );
    dueSupplierDebt += Math.min(
      totalSupplierBalance,
      Math.max(0, dueDebts - Math.max(0, totalSupplierPaid - Number(s.opening_balance ?? 0)))
    );
  });
  dueSupplierDebt = roundCurrency(dueSupplierDebt);

  const monthlyRecurringTotal = roundCurrency(
    recurring.reduce((acc, r) => acc + Number(r.monthly_amount ?? 0), 0)
  );

  const thisMonthExpenses = roundCurrency(
    expenses
      .filter(
        (e) =>
          String(e.transaction_date) >= monthStart && String(e.transaction_date) <= monthEnd
      )
      .reduce((acc, e) => acc + Number(e.amount ?? 0), 0)
  );

  const thisMonthCollections = roundCurrency(
    custTx
      .filter(
        (t) =>
          t.transaction_type === 'payment' &&
          String(t.transaction_date) >= monthStart &&
          String(t.transaction_date) <= monthEnd
      )
      .reduce((acc, t) => acc + Number(t.amount ?? 0), 0)
  );

  const thisMonthSupplierPayments = roundCurrency(
    suppTx
      .filter(
        (t) =>
          t.transaction_type === 'payment' &&
          String(t.transaction_date) >= monthStart &&
          String(t.transaction_date) <= monthEnd
      )
      .reduce((acc, t) => acc + Number(t.amount ?? 0), 0)
  );

  const allIncomes = incomes.reduce((acc, i) => acc + Number(i.amount ?? 0), 0);
  const allCollections = custTx
    .filter((t) => t.transaction_type === 'payment')
    .reduce((acc, t) => acc + Number(t.amount ?? 0), 0);
  const allExpenses = expenses.reduce((acc, e) => acc + Number(e.amount ?? 0), 0);
  const allSupplierPayments = suppTx
    .filter((t) => t.transaction_type === 'payment')
    .reduce((acc, t) => acc + Number(t.amount ?? 0), 0);
  const cashSummary = roundCurrency(
    allIncomes + allCollections - allExpenses - allSupplierPayments
  );

  const sevenDaysLaterDate = new Date();
  sevenDaysLaterDate.setDate(sevenDaysLaterDate.getDate() + 7);
  const sevenDaysISO = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(sevenDaysLaterDate);

  const upcomingCreditSales = creditSales
    .filter((cs) => Number(cs.total_amount) > Number(cs.paid_amount) && cs.due_date <= sevenDaysISO)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 8);

  return NextResponse.json({
    cards: {
      totalCustomerReceivable,
      totalSupplierDebt,
      dueReceivables,
      dueSupplierDebt,
      monthlyRecurringTotal,
      thisMonthExpenses,
      thisMonthCollections,
      thisMonthSupplierPayments,
      cashSummary,
    },
    upcomingCreditSales,
    notifications: notifications.map((n) => ({
      ...n,
      is_read: toBool(n.is_read),
      created_at: toIsoString(n.created_at),
    })),
  });
}
