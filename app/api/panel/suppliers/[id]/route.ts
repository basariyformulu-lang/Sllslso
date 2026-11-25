import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
import { getIstanbulTodayISO, roundCurrency } from '@/lib/format';

const updateSupplierSchema = z.object({
  companyName: z.string().trim().min(2).max(140).optional(),
  contactName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().or(z.literal('')).optional(),
  address: z.string().trim().max(250).optional(),
  notes: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
});

const supplierTxActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add_debt'),
    description: z.string().trim().min(2, 'Borç açıklaması giriniz.').max(200),
    amount: z.coerce.number().positive('Tutar sıfırdan büyük olmalıdır.'),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    notes: z.string().trim().max(400).optional().default(''),
  }),
  z.object({
    action: z.literal('add_payment'),
    amount: z.coerce.number().positive('Ödeme tutarı sıfırdan büyük olmalıdır.'),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    paymentMethod: z.enum(['nakit', 'banka', 'kart', 'diger']),
    description: z.string().trim().max(200).optional().default('Toptancı ödemesi'),
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
  const { error, ctx, db } = await requireBusinessContext('suppliers.view');
  if (error || !ctx || !db || !ctx.business) return error!;

  const { id } = await params;
  const today = getIstanbulTodayISO();

  const { data: supplier } = await db
    .from('suppliers')
    .select('*')
    .eq('id', id)
    .eq('business_id', ctx.business.id)
    .maybeSingle();

  if (!supplier) {
    return NextResponse.json({ error: 'Toptancı bulunamadı.' }, { status: 404 });
  }

  const { data: transactions } = await db
    .from('supplier_transactions')
    .select('*')
    .eq('supplier_id', id)
    .eq('business_id', ctx.business.id)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false });

  const activeTxs = (transactions ?? []).filter((t) => !t.is_cancelled);
  const opening = Number(supplier.opening_balance ?? 0);
  const debtSum = activeTxs
    .filter((t) => t.transaction_type === 'debt')
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const paymentSum = activeTxs
    .filter((t) => t.transaction_type === 'payment')
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const currentBalance = roundCurrency(
    opening + activeTxs.reduce((acc, t) => acc + Number(t.signed_amount), 0)
  );
  const dueDebts = activeTxs
    .filter((t) => t.transaction_type === 'debt' && t.due_date && t.due_date <= today)
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const overdueDebt = roundCurrency(
    Math.min(Math.max(0, currentBalance), Math.max(0, dueDebts - Math.max(0, paymentSum - opening)))
  );

  return NextResponse.json({
    supplier: {
      ...supplier,
      total_debt: roundCurrency(opening + debtSum),
      total_payment: roundCurrency(paymentSum),
      current_balance: currentBalance,
      overdue_debt: overdueDebt,
    },
    transactions: transactions ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx, db } = await requireBusinessContext('suppliers.edit');
  if (error || !ctx || !db || !ctx.business) return error!;

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = updateSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Toptancı bilgilerini kontrol ediniz.' }, { status: 400 });
  }

  const d = parsed.data;
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.companyName !== undefined) updatePayload.company_name = d.companyName;
  if (d.contactName !== undefined) updatePayload.contact_name = d.contactName;
  if (d.phone !== undefined) updatePayload.phone = d.phone;
  if (d.email !== undefined) updatePayload.email = d.email;
  if (d.address !== undefined) updatePayload.address = d.address;
  if (d.notes !== undefined) updatePayload.notes = d.notes;
  if (d.isActive !== undefined) updatePayload.is_active = d.isActive;

  const { data: updated, error: updErr } = await db
    .from('suppliers')
    .update(updatePayload)
    .eq('id', id)
    .eq('business_id', ctx.business.id)
    .select('*')
    .maybeSingle();

  if (updErr || !updated) {
    return NextResponse.json({ error: updErr?.message ?? 'Toptancı güncellenemedi.' }, { status: 400 });
  }

  return NextResponse.json({ supplier: updated });
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

  const parsed = supplierTxActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'İşlem bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const requiredPerm =
    payload.action === 'add_debt'
      ? 'suppliers.add_debt'
      : payload.action === 'add_payment'
      ? 'suppliers.add_payment'
      : 'suppliers.delete';

  const { error, ctx, db } = await requireBusinessContext(requiredPerm);
  if (error || !ctx || !db || !ctx.business) return error!;

  const { data: supplier } = await db
    .from('suppliers')
    .select('*')
    .eq('id', id)
    .eq('business_id', ctx.business.id)
    .maybeSingle();

  if (!supplier) {
    return NextResponse.json({ error: 'Toptancı bulunamadı.' }, { status: 404 });
  }

  if (payload.action === 'add_debt') {
    const amt = roundCurrency(payload.amount);
    const { data: tx, error: txErr } = await db
      .from('supplier_transactions')
      .insert({
        business_id: ctx.business.id,
        supplier_id: id,
        transaction_type: 'debt',
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
      .from('supplier_transactions')
      .select('signed_amount')
      .eq('supplier_id', id)
      .eq('business_id', ctx.business.id)
      .eq('is_cancelled', false);

    const currentBalance = roundCurrency(
      Number(supplier.opening_balance ?? 0) +
        (existingTxs ?? []).reduce((acc, t) => acc + Number(t.signed_amount), 0)
    );

    const isOverpayment = amt > currentBalance;
    if (isOverpayment && !payload.allowOverpayment) {
      return NextResponse.json(
        {
          error: `Girilen ödeme tutarı toptancıya olan güncel borçtan (${currentBalance.toFixed(2)} TL) fazladır.`,
          requiresOverpaymentConfirm: true,
          currentBalance,
        },
        { status: 409 }
      );
    }

    const { data: tx, error: txErr } = await db
      .from('supplier_transactions')
      .insert({
        business_id: ctx.business.id,
        supplier_id: id,
        transaction_type: 'payment',
        amount: amt,
        signed_amount: -amt,
        transaction_date: payload.transactionDate,
        payment_method: payload.paymentMethod,
        description: payload.description || 'Toptancı ödemesi',
        is_overpayment: isOverpayment,
        created_by: ctx.userId,
      })
      .select('*')
      .single();

    if (txErr) {
      return NextResponse.json({ error: txErr.message }, { status: 500 });
    }
    return NextResponse.json({ transaction: tx }, { status: 201 });
  }

  // Ters kayıt / iptal
  const { data: targetTx } = await db
    .from('supplier_transactions')
    .select('*')
    .eq('id', payload.transactionId)
    .eq('supplier_id', id)
    .eq('business_id', ctx.business.id)
    .maybeSingle();

  if (!targetTx || targetTx.is_cancelled) {
    return NextResponse.json({ error: 'İptal edilecek aktif hareket bulunamadı.' }, { status: 404 });
  }

  await db
    .from('supplier_transactions')
    .update({ is_cancelled: true })
    .eq('id', targetTx.id);

  await db.from('audit_logs').insert({
    scope: 'business',
    business_id: ctx.business.id,
    actor_user_id: ctx.userId,
    action: 'supplier_transaction_cancelled',
    entity_type: 'supplier_transactions',
    entity_id: targetTx.id,
    old_values: { amount: targetTx.amount, type: targetTx.transaction_type },
    new_values: { is_cancelled: true, reason: payload.reason },
    description: `Toptancı hareketi iptal edildi (${payload.reason}).`,
  });

  return NextResponse.json({ success: true });
}
