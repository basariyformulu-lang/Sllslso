import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
import { addMonthsToISODate, getIstanbulTodayISO, roundCurrency } from '@/lib/format';

const createCreditSaleSchema = z.object({
  customerId: z.string().uuid('Müşteri seçiniz.'),
  description: z.string().trim().min(2, 'Satış açıklaması giriniz.').max(200),
  totalAmount: z.coerce.number().positive('Satış tutarı sıfırdan büyük olmalıdır.'),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçerli bir satış tarihi giriniz.'),
  dueMonths: z.coerce.number().int().min(1).max(60).optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(400).optional().default(''),
});

const patchCreditSaleSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('collect_payment'),
    id: z.string().uuid(),
    amount: z.coerce.number().positive('Tahsilat tutarı sıfırdan büyük olmalıdır.'),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    paymentMethod: z.enum(['nakit', 'banka', 'kart', 'diger']),
    description: z.string().trim().max(200).optional().default('Vadeli satış tahsilatı'),
  }),
  z.object({
    action: z.literal('cancel'),
    id: z.string().uuid(),
  }),
]);

function computeCreditSaleStatus(
  sale: { total_amount: number; paid_amount: number; due_date: string; is_cancelled: boolean },
  todayISO: string
): 'vadesi_gelmedi' | 'vadesi_geldi' | 'kismen_tahsil' | 'tahsil_edildi' | 'gecikmis' | 'iptal' {
  if (sale.is_cancelled) return 'iptal';
  const total = roundCurrency(sale.total_amount);
  const paid = roundCurrency(sale.paid_amount);
  if (paid >= total) return 'tahsil_edildi';
  if (sale.due_date < todayISO) return 'gecikmis';
  if (sale.due_date === todayISO) return 'vadesi_geldi';
  if (paid > 0) return 'kismen_tahsil';
  return 'vadesi_gelmedi';
}

export async function GET() {
  const { error, ctx, db } = await requireBusinessContext('credit_sales.view');
  if (error || !ctx || !db || !ctx.business) return error!;

  const today = getIstanbulTodayISO();
  const [{ data: sales, error: salesErr }, { data: customers }] = await Promise.all([
    db
      .from('credit_sales')
      .select('*, customer:customers(id, name, last_name, phone)')
      .eq('business_id', ctx.business.id)
      .order('due_date', { ascending: true }),
    db
      .from('customers')
      .select('id, name, last_name, phone, is_active')
      .eq('business_id', ctx.business.id)
      .eq('is_active', true)
      .order('name', { ascending: true }),
  ]);

  if (salesErr) {
    return NextResponse.json({ error: salesErr.message }, { status: 500 });
  }

  const enriched = (sales ?? []).map((s) => ({
    ...s,
    total_amount: roundCurrency(s.total_amount),
    paid_amount: roundCurrency(s.paid_amount),
    remaining_amount: roundCurrency(Math.max(0, Number(s.total_amount) - Number(s.paid_amount))),
    computed_status: computeCreditSaleStatus(s, today),
  }));

  return NextResponse.json({ creditSales: enriched, customers: customers ?? [] });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessContext('credit_sales.create');
  if (error || !ctx || !db || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = createCreditSaleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Vadeli satış bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const computedDueDate = d.dueDate
    ? d.dueDate
    : d.dueMonths
    ? addMonthsToISODate(d.saleDate, d.dueMonths)
    : null;

  if (!computedDueDate) {
    return NextResponse.json(
      { error: 'Vade süresi (ay) veya vade tarihi belirtilmelidir.' },
      { status: 400 }
    );
  }

  const { data: customer } = await db
    .from('customers')
    .select('id, name, last_name')
    .eq('id', d.customerId)
    .eq('business_id', ctx.business.id)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json({ error: 'Seçilen müşteri bulunamadı.' }, { status: 404 });
  }

  const totalAmount = roundCurrency(d.totalAmount);

  const { data: sale, error: saleErr } = await db
    .from('credit_sales')
    .insert({
      business_id: ctx.business.id,
      customer_id: d.customerId,
      description: d.description,
      total_amount: totalAmount,
      paid_amount: 0,
      sale_date: d.saleDate,
      due_months: d.dueMonths ?? null,
      due_date: computedDueDate,
      notes: d.notes,
      created_by: ctx.userId,
    })
    .select('*')
    .single();

  if (saleErr || !sale) {
    return NextResponse.json({ error: saleErr?.message ?? 'Vadeli satış oluşturulamadı.' }, { status: 500 });
  }

  // Müşteri carisine otomatik borç hareketi ekle
  const { error: txErr } = await db.from('customer_transactions').insert({
    business_id: ctx.business.id,
    customer_id: d.customerId,
    credit_sale_id: sale.id,
    transaction_type: 'debt',
    debt_category: 'Vadeli Satış',
    amount: totalAmount,
    signed_amount: totalAmount,
    transaction_date: d.saleDate,
    due_date: computedDueDate,
    description: d.description,
    notes: d.notes,
    created_by: ctx.userId,
  });

  if (txErr) {
    await db.from('credit_sales').delete().eq('id', sale.id);
    return NextResponse.json({ error: txErr.message }, { status: 500 });
  }

  await db.from('notifications').insert({
    business_id: ctx.business.id,
    type: 'credit_sale_created',
    title: 'Yeni Vadeli Satış Kaydedildi',
    message: `${customer.name} ${customer.last_name} için ${totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL tutarında vadeli satış oluşturuldu (Vade: ${computedDueDate}).`,
    link: '/panel/vadeli-satislar',
  });

  return NextResponse.json({ creditSale: sale }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = patchCreditSaleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'İşlem bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const requiredPerm =
    payload.action === 'collect_payment' ? 'customers.add_payment' : 'credit_sales.delete';
  const { error, ctx, db } = await requireBusinessContext(requiredPerm);
  if (error || !ctx || !db || !ctx.business) return error!;

  const { data: sale } = await db
    .from('credit_sales')
    .select('*')
    .eq('id', payload.id)
    .eq('business_id', ctx.business.id)
    .maybeSingle();

  if (!sale || sale.is_cancelled) {
    return NextResponse.json({ error: 'Aktif vadeli satış bulunamadı.' }, { status: 404 });
  }

  if (payload.action === 'collect_payment') {
    const remaining = roundCurrency(Number(sale.total_amount) - Number(sale.paid_amount));
    const amt = roundCurrency(payload.amount);
    if (amt > remaining) {
      return NextResponse.json(
        {
          error: `Tahsilat tutarı bu vadeli satışın kalan bakiyesinden (${remaining.toFixed(2)} TL) fazla olamaz.`,
        },
        { status: 400 }
      );
    }

    const { error: txErr } = await db.from('customer_transactions').insert({
      business_id: ctx.business.id,
      customer_id: sale.customer_id,
      credit_sale_id: sale.id,
      transaction_type: 'payment',
      debt_category: 'Vadeli Satış Tahsilatı',
      amount: amt,
      signed_amount: -amt,
      transaction_date: payload.paymentDate,
      payment_method: payload.paymentMethod,
      description: payload.description || `${sale.description} tahsilatı`,
      created_by: ctx.userId,
    });

    if (txErr) {
      return NextResponse.json({ error: txErr.message }, { status: 500 });
    }

    const newPaid = roundCurrency(Number(sale.paid_amount) + amt);
    await db
      .from('credit_sales')
      .update({ paid_amount: newPaid, updated_at: new Date().toISOString() })
      .eq('id', sale.id);

    return NextResponse.json({ success: true, paidAmount: newPaid });
  }

  // İptal
  await db
    .from('credit_sales')
    .update({
      is_cancelled: true,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sale.id);

  await db
    .from('customer_transactions')
    .update({ is_cancelled: true })
    .eq('credit_sale_id', sale.id)
    .eq('business_id', ctx.business.id);

  await db.from('audit_logs').insert({
    scope: 'business',
    business_id: ctx.business.id,
    actor_user_id: ctx.userId,
    action: 'credit_sale_cancelled',
    entity_type: 'credit_sales',
    entity_id: sale.id,
    old_values: { total_amount: sale.total_amount },
    description: `Vadeli satış iptal edildi: ${sale.description}`,
  });

  return NextResponse.json({ success: true });
}
