import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/auth-server';
import { getIstanbulMonthBounds, getIstanbulTodayISO, roundCurrency } from '@/lib/format';

export async function GET() {
  const { error, ctx, db } = await requireBusinessContext('reports.view');
  if (error || !ctx || !db || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const today = getIstanbulTodayISO();
  const { start: monthStart, end: monthEnd } = getIstanbulMonthBounds();

  const [
    { data: customers },
    { data: custTx },
    { data: suppliers },
    { data: suppTx },
    { data: creditSales },
    { data: incomes },
    { data: expenses },
    { data: recurring },
    { data: notifications },
  ] = await Promise.all([
    db.from('customers').select('id, name, last_name, opening_balance, is_active').eq('business_id', businessId),
    db.from('customer_transactions').select('*').eq('business_id', businessId).eq('is_cancelled', false),
    db.from('suppliers').select('id, company_name, opening_balance, is_active').eq('business_id', businessId),
    db.from('supplier_transactions').select('*').eq('business_id', businessId).eq('is_cancelled', false),
    db.from('credit_sales').select('*, customer:customers(name, last_name)').eq('business_id', businessId).eq('is_cancelled', false),
    db.from('income_transactions').select('*').eq('business_id', businessId).eq('is_cancelled', false),
    db.from('expense_transactions').select('*').eq('business_id', businessId).eq('is_cancelled', false),
    db.from('recurring_expenses').select('*').eq('business_id', businessId).eq('is_active', true),
    db.from('notifications').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(15),
  ]);

  // 1. Toplam müşteri alacağı
  const custOpening = (customers ?? []).reduce((acc, c) => acc + Number(c.opening_balance ?? 0), 0);
  const custNetTx = (custTx ?? []).reduce((acc, t) => acc + Number(t.signed_amount ?? 0), 0);
  const totalCustomerReceivable = roundCurrency(custOpening + custNetTx);

  // 2. Toplam toptancı borcu
  const suppOpening = (suppliers ?? []).reduce((acc, s) => acc + Number(s.opening_balance ?? 0), 0);
  const suppNetTx = (suppTx ?? []).reduce((acc, t) => acc + Number(t.signed_amount ?? 0), 0);
  const totalSupplierDebt = roundCurrency(suppOpening + suppNetTx);

  // 3. Vadesi gelen alacaklar (vadeli satışlar + vadesi geçmiş cari borçlar)
  const dueCreditSales = (creditSales ?? []).filter(
    (cs) => cs.due_date <= today && Number(cs.total_amount) > Number(cs.paid_amount)
  );
  const dueReceivablesFromCreditSales = dueCreditSales.reduce(
    (acc, cs) => acc + (Number(cs.total_amount) - Number(cs.paid_amount)),
    0
  );
  // Ayrıca doğrudan borç olarak eklenmiş ve credit_sale_id olmayan vadesi gelmiş borçlar
  const directDueDebts = (custTx ?? [])
    .filter(
      (t) =>
        t.transaction_type === 'debt' &&
        !t.credit_sale_id &&
        t.due_date &&
        t.due_date <= today
    )
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const dueReceivables = roundCurrency(Math.min(Math.max(0, totalCustomerReceivable), dueReceivablesFromCreditSales + directDueDebts));

  // 4. Vadesi gelen toptancı borçları
  const supplierPaymentsBySupplier = new Map<string, number>();
  (suppTx ?? []).forEach((t) => {
    if (t.transaction_type === 'payment') {
      supplierPaymentsBySupplier.set(
        t.supplier_id,
        (supplierPaymentsBySupplier.get(t.supplier_id) ?? 0) + Number(t.amount)
      );
    }
  });
  let dueSupplierDebt = 0;
  (suppliers ?? []).forEach((s) => {
    const dueDebts = (suppTx ?? [])
      .filter((t) => t.supplier_id === s.id && t.transaction_type === 'debt' && t.due_date && t.due_date <= today)
      .reduce((acc, t) => acc + Number(t.amount), 0);
    const totalSupplierPaid = supplierPaymentsBySupplier.get(s.id) ?? 0;
    const totalSupplierBalance = Math.max(
      0,
      Number(s.opening_balance ?? 0) +
        (suppTx ?? [])
          .filter((t) => t.supplier_id === s.id)
          .reduce((acc, t) => acc + Number(t.signed_amount ?? 0), 0)
    );
    dueSupplierDebt += Math.min(totalSupplierBalance, Math.max(0, dueDebts - Math.max(0, totalSupplierPaid - Number(s.opening_balance ?? 0))));
  });
  dueSupplierDebt = roundCurrency(dueSupplierDebt);

  // 5. Aylık sabit giderler (yalnızca aktif planlanan aylık yük)
  const monthlyRecurringTotal = roundCurrency(
    (recurring ?? []).reduce((acc, r) => acc + Number(r.monthly_amount ?? 0), 0)
  );

  // 6. Bu ay gerçekleşen giderler
  const thisMonthExpenses = roundCurrency(
    (expenses ?? [])
      .filter((e) => e.transaction_date >= monthStart && e.transaction_date <= monthEnd)
      .reduce((acc, e) => acc + Number(e.amount ?? 0), 0)
  );

  // 7. Bu ay tahsil edilen müşteri ödemeleri
  const thisMonthCollections = roundCurrency(
    (custTx ?? [])
      .filter(
        (t) =>
          t.transaction_type === 'payment' &&
          t.transaction_date >= monthStart &&
          t.transaction_date <= monthEnd
      )
      .reduce((acc, t) => acc + Number(t.amount ?? 0), 0)
  );

  // 8. Bu ay yapılan toptancı ödemeleri
  const thisMonthSupplierPayments = roundCurrency(
    (suppTx ?? [])
      .filter(
        (t) =>
          t.transaction_type === 'payment' &&
          t.transaction_date >= monthStart &&
          t.transaction_date <= monthEnd
      )
      .reduce((acc, t) => acc + Number(t.amount ?? 0), 0)
  );

  // 9. Kasa özeti (Toplam gelir + müşteri tahsilatları - toplam gider - toptancı ödemeleri)
  const allIncomes = (incomes ?? []).reduce((acc, i) => acc + Number(i.amount ?? 0), 0);
  const allCollections = (custTx ?? [])
    .filter((t) => t.transaction_type === 'payment')
    .reduce((acc, t) => acc + Number(t.amount ?? 0), 0);
  const allExpenses = (expenses ?? []).reduce((acc, e) => acc + Number(e.amount ?? 0), 0);
  const allSupplierPayments = (suppTx ?? [])
    .filter((t) => t.transaction_type === 'payment')
    .reduce((acc, t) => acc + Number(t.amount ?? 0), 0);
  const cashSummary = roundCurrency(allIncomes + allCollections - allExpenses - allSupplierPayments);

  // Yaklaşan ve vadesi geçen vadeli satışlar (7 gün içinde)
  const sevenDaysLaterDate = new Date();
  sevenDaysLaterDate.setDate(sevenDaysLaterDate.getDate() + 7);
  const sevenDaysISO = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(sevenDaysLaterDate);

  const upcomingCreditSales = (creditSales ?? [])
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
    notifications: notifications ?? [],
  });
}
