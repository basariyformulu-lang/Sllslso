import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
import { roundCurrency } from '@/lib/format';

const updateCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  lastName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().or(z.literal('')).optional(),
  address: z.string().trim().max(250).optional(),
  notes: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
});

const transactionActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add_debt'),
    description: z.string().trim().min(2, 'Borç açıklaması giriniz.').max(200),
    amount: z.coerce.number().positive('Tutar sıfırdan büyük olmalıdır.'),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    debtCategory: z.string().trim().max(80).optional().default('Cari Borç'),
    notes: z.string().trim().max(400).optional().default(''),
  }),
  z.object({
    action: z.literal('add_payment'),
    amount: z.coerce.number().positive('Ödeme tutarı sıfırdan büyük olmalıdır.'),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    paymentMethod: z.enum(['nakit', 'banka', 'kart', 'diger']),
    description: z.string().trim().max(200).optional().default('Müşteri tahsilatı'),
    creditSaleId: z.string().uuid().optional().nullable(),
    allowOverpayment: z.boolean().optional().default(false),
  }),
  z.object({
    action: z.literal('reverse_transaction'),
    transactionId: z.string().uuid(),
    reason: z.string().trim().max(200).optional().default('Kullanıcı tarafından iptal edildi'),
  }),
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx, db } = await requireBusinessContext('customers.view');
  if (error || !ctx || !db || !ctx.business) return error!;

  const { id } = await params;
  const { data: customer } = await db
    .from('customers')
    .select('*')
    .eq('id', id)
    .eq('business_id', ctx.business.id)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json({ error: 'Müşteri bulunamadı.' }, { status: 404 });
  }

  const [{ data: transactions }, { data: creditSales }] = await Promise.all([
    db
      .from('customer_transactions')
      .select('*')
      .eq('customer_id', id)
      .eq('business_id', ctx.business.id)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false }),
    db
      .from('credit_sales')
      .select('*')
      .eq('customer_id', id)
      .eq('business_id', ctx.business.id)
      .eq('is_cancelled', false)
      .order('due_date', { ascending: true }),
  ]);

  const activeTxs = (transactions ?? []).filter((t) => !t.is_cancelled);
  const opening = Number(customer.opening_balance ?? 0);
  const debtSum = activeTxs
    .filter((t) => t.transaction_type === 'debt')
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const paymentSum = activeTxs
    .filter((t) => t.transaction_type === 'payment')
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const currentBalance = roundCurrency(
    opening + activeTxs.reduce((acc, t) => acc + Number(t.signed_amount), 0)
  );

  return NextResponse.json({
    customer: {
      ...customer,
      total_debt: roundCurrency(opening + debtSum),
      total_payment: roundCurrency(paymentSum),
      current_balance: currentBalance,
    },
    transactions: transactions ?? [],
    creditSales: creditSales ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx, db } = await requireBusinessContext('customers.edit');
  if (error || !ctx || !db || !ctx.business) return error!;

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = updateCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Müşteri bilgilerini kontrol ediniz.' }, { status: 400 });
  }

  const d = parsed.data;
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.name !== undefined) updatePayload.name = d.name;
  if (d.lastName !== undefined) updatePayload.last_name = d.lastName;
  if (d.phone !== undefined) updatePayload.phone = d.phone;
  if (d.email !== undefined) updatePayload.email = d.email;
  if (d.address !== undefined) updatePayload.address = d.address;
  if (d.notes !== undefined) updatePayload.notes = d.notes;
  if (d.isActive !== undefined) updatePayload.is_active = d.isActive;

  const { data: updated, error: updErr } = await db
    .from('customers')
    .update(updatePayload)
    .eq('id', id)
    .eq('business_id', ctx.business.id)
    .select('*')
    .maybeSingle();

  if (updErr || !updated) {
    return NextResponse.json({ error: updErr?.message ?? 'Müşteri güncellenemedi.' }, { status: 400 });
  }

  return NextResponse.json({ customer: updated });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = transactionActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'İşlem bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const requiredPerm =
    payload.action === 'add_debt'
      ? 'customers.add_debt'
      : payload.action === 'add_payment'
      ? 'customers.add_payment'
      : 'customers.delete';

  const { error, ctx, db } = await requireBusinessContext(requiredPerm);
  if (error || !ctx || !db || !ctx.business) return error!;

  const { data: customer } = await db
    .from('customers')
    .select('*')
    .eq('id', id)
    .eq('business_id', ctx.business.id)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json({ error: 'Müşteri bulunamadı.' }, { status: 404 });
  }

  if (payload.action === 'add_debt') {
    const amt = roundCurrency(payload.amount);
    const { data: tx, error: txErr } = await db
      .from('customer_transactions')
      .insert({
        business_id: ctx.business.id,
        customer_id: id,
        transaction_type: 'debt',
        debt_category: payload.debtCategory,
        amount: amt,
        signed_amount: amt,
        transaction_date: payload.transactionDate,
        due_date: payload.dueDate || null,
        description: payload.description,
        notes: payload.notes,
        created_by: ctx.userId,
      })
      .select('*')
      .single();

    if (txErr) {
      return NextResponse.json({ error: txErr.message }, { status: 500 });
    }
    return NextResponse.json({ transaction: tx }, { status: 201 });
  }

  if (payload.action === 'add_payment') {
    const amt = roundCurrency(payload.amount);
    const { data: existingTxs } = await db
      .from('customer_transactions')
      .select('signed_amount')
      .eq('customer_id', id)
      .eq('business_id', ctx.business.id)
      .eq('is_cancelled', false);

    const currentBalance = roundCurrency(
      Number(customer.opening_balance ?? 0) +
        (existingTxs ?? []).reduce((acc, t) => acc + Number(t.signed_amount), 0)
    );

    const isOverpayment = amt > currentBalance;
    if (isOverpayment && !payload.allowOverpayment) {
      return NextResponse.json(
        {
          error: `Girilen ödeme tutarı müşterinin güncel borcundan (${currentBalance.toFixed(2)} TL) fazladır.`,
          requiresOverpaymentConfirm: true,
          currentBalance,
        },
        { status: 409 }
      );
    }

    const { data: tx, error: txErr } = await db
      .from('customer_transactions')
      .insert({
        business_id: ctx.business.id,
        customer_id: id,
        credit_sale_id: payload.creditSaleId ?? null,
        transaction_type: 'payment',
        debt_category: 'Tahsilat',
        amount: amt,
        signed_amount: -amt,
        transaction_date: payload.transactionDate,
        payment_method: payload.paymentMethod,
        description: payload.description || 'Müşteri tahsilatı',
        is_overpayment: isOverpayment,
        created_by: ctx.userId,
      })
      .select('*')
      .single();

    if (txErr) {
      return NextResponse.json({ error: txErr.message }, { status: 500 });
    }

    // Vadeli satışa bağlıysa paid_amount güncelle
    if (payload.creditSaleId) {
      const { data: sale } = await db
        .from('credit_sales')
        .select('*')
        .eq('id', payload.creditSaleId)
        .eq('business_id', ctx.business.id)
        .maybeSingle();
      if (sale) {
        const newPaid = roundCurrency(Number(sale.paid_amount) + amt);
        await db
          .from('credit_sales')
          .update({ paid_amount: newPaid, updated_at: new Date().toISOString() })
          .eq('id', sale.id);
      }
    }

    return NextResponse.json({ transaction: tx }, { status: 201 });
  }

  // Ters kayıt / iptal
  const { data: targetTx } = await db
    .from('customer_transactions')
    .select('*')
    .eq('id', payload.transactionId)
    .eq('customer_id', id)
    .eq('business_id', ctx.business.id)
    .maybeSingle();

  if (!targetTx || targetTx.is_cancelled) {
    return NextResponse.json({ error: 'İptal edilecek aktif hareket bulunamadı.' }, { status: 404 });
  }

  await db
    .from('customer_transactions')
    .update({ is_cancelled: true })
    .eq('id', targetTx.id);

  // Eğer vadeli satış tahsilatı iptal edildiyse paid_amount düşür
  if (targetTx.transaction_type === 'payment' && targetTx.credit_sale_id) {
    const { data: sale } = await db
      .from('credit_sales')
      .select('*')
      .eq('id', targetTx.credit_sale_id)
      .maybeSingle();
    if (sale) {
      await db
        .from('credit_sales')
        .update({
          paid_amount: Math.max(0, roundCurrency(Number(sale.paid_amount) - Number(targetTx.amount))),
          updated_at: new Date().toISOString(),
        })
        .eq('id', sale.id);
    }
  }

  await db.from('audit_logs').insert({
    scope: 'business',
    business_id: ctx.business.id,
    actor_user_id: ctx.userId,
    action: 'customer_transaction_cancelled',
    entity_type: 'customer_transactions',
    entity_id: targetTx.id,
    old_values: { amount: targetTx.amount, type: targetTx.transaction_type },
    new_values: { is_cancelled: true, reason: payload.reason },
    description: `Müşteri hareketi iptal edildi (${payload.reason}).`,
  });

  return NextResponse.json({ success: true });
}
