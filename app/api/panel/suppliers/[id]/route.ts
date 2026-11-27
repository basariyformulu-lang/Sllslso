import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
import {
  execute,
  query,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
  uuid,
  writeAuditLog,
} from '@/lib/db';
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
  const { error, ctx } = await requireBusinessContext('suppliers.view');
  if (error || !ctx || !ctx.business) return error!;

  const { id } = await params;
  const today = getIstanbulTodayISO();

  const supplier = await queryOne<Record<string, unknown>>(
    'SELECT * FROM suppliers WHERE id = ? AND business_id = ? LIMIT 1',
    [id, ctx.business.id]
  );

  if (!supplier) {
    return NextResponse.json({ error: 'Toptancı bulunamadı.' }, { status: 404 });
  }

  const transactions = await query<Record<string, unknown>>(
    'SELECT * FROM supplier_transactions WHERE supplier_id = ? AND business_id = ? ORDER BY transaction_date DESC, created_at DESC',
    [id, ctx.business.id]
  );

  const activeTxs = transactions.filter((t) => !toBool(t.is_cancelled));
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
    .filter((t) => t.transaction_type === 'debt' && t.due_date && String(t.due_date) <= today)
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const overdueDebt = roundCurrency(
    Math.min(Math.max(0, currentBalance), Math.max(0, dueDebts - Math.max(0, paymentSum - opening)))
  );

  return NextResponse.json({
    supplier: {
      ...supplier,
      is_active: toBool(supplier.is_active),
      total_debt: roundCurrency(opening + debtSum),
      total_payment: roundCurrency(paymentSum),
      current_balance: currentBalance,
      overdue_debt: overdueDebt,
    },
    transactions: transactions.map((t) => ({
      ...t,
      amount: Number(t.amount),
      signed_amount: Number(t.signed_amount),
      is_cancelled: toBool(t.is_cancelled),
      is_overpayment: toBool(t.is_overpayment),
      created_at: toIsoString(t.created_at),
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireBusinessContext('suppliers.edit');
  if (error || !ctx || !ctx.business) return error!;

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

  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM suppliers WHERE id = ? AND business_id = ? LIMIT 1',
    [id, ctx.business.id]
  );
  if (!existing) {
    return NextResponse.json({ error: 'Toptancı bulunamadı.' }, { status: 404 });
  }

  const d = parsed.data;
  await execute(
    `UPDATE suppliers
     SET company_name = ?, contact_name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ?, updated_at = ?
     WHERE id = ? AND business_id = ?`,
    [
      d.companyName ?? String(existing.company_name),
      d.contactName ?? String(existing.contact_name ?? ''),
      d.phone ?? String(existing.phone ?? ''),
      d.email ?? String(existing.email ?? ''),
      d.address ?? String(existing.address ?? ''),
      d.notes ?? String(existing.notes ?? ''),
      d.isActive !== undefined ? (d.isActive ? 1 : 0) : toBool(existing.is_active) ? 1 : 0,
      toMySqlDateTime(),
      id,
      ctx.business.id,
    ]
  );

  const updated = await queryOne<Record<string, unknown>>(
    'SELECT * FROM suppliers WHERE id = ? LIMIT 1',
    [id]
  );

  return NextResponse.json({
    supplier: updated ? { ...updated, is_active: toBool(updated.is_active) } : null,
  });
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

  const { error, ctx } = await requireBusinessContext(requiredPerm);
  if (error || !ctx || !ctx.business) return error!;

  const supplier = await queryOne<Record<string, unknown>>(
    'SELECT * FROM suppliers WHERE id = ? AND business_id = ? LIMIT 1',
    [id, ctx.business.id]
  );

  if (!supplier) {
    return NextResponse.json({ error: 'Toptancı bulunamadı.' }, { status: 404 });
  }

  const nowStr = toMySqlDateTime();

  if (payload.action === 'add_debt') {
    const amt = roundCurrency(payload.amount);
    const txId = uuid();
    await execute(
      `INSERT INTO supplier_transactions
       (id, business_id, supplier_id, transaction_type, amount, signed_amount, transaction_date, due_date, payment_method, description, notes, is_overpayment, is_cancelled, created_by, created_at)
       VALUES (?, ?, ?, 'debt', ?, ?, ?, ?, 'nakit', ?, ?, 0, 0, ?, ?)`,
      [
        txId,
        ctx.business.id,
        id,
        amt,
        amt,
        payload.transactionDate,
        payload.dueDate || null,
        payload.description,
        payload.notes,
        ctx.userId,
        nowStr,
      ]
    );
    const tx = await queryOne<Record<string, unknown>>(
      'SELECT * FROM supplier_transactions WHERE id = ? LIMIT 1',
      [txId]
    );
    return NextResponse.json({ transaction: tx }, { status: 201 });
  }

  if (payload.action === 'add_payment') {
    const amt = roundCurrency(payload.amount);
    const existingTxs = await query<{ signed_amount: number }>(
      'SELECT signed_amount FROM supplier_transactions WHERE supplier_id = ? AND business_id = ? AND is_cancelled = 0',
      [id, ctx.business.id]
    );

    const currentBalance = roundCurrency(
      Number(supplier.opening_balance ?? 0) +
        existingTxs.reduce((acc, t) => acc + Number(t.signed_amount), 0)
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

    const txId = uuid();
    await execute(
      `INSERT INTO supplier_transactions
       (id, business_id, supplier_id, transaction_type, amount, signed_amount, transaction_date, payment_method, description, notes, is_overpayment, is_cancelled, created_by, created_at)
       VALUES (?, ?, ?, 'payment', ?, ?, ?, ?, ?, '', ?, 0, ?, ?)`,
      [
        txId,
        ctx.business.id,
        id,
        amt,
        -amt,
        payload.transactionDate,
        payload.paymentMethod,
        payload.description || 'Toptancı ödemesi',
        isOverpayment ? 1 : 0,
        ctx.userId,
        nowStr,
      ]
    );
    const tx = await queryOne<Record<string, unknown>>(
      'SELECT * FROM supplier_transactions WHERE id = ? LIMIT 1',
      [txId]
    );
    return NextResponse.json({ transaction: tx }, { status: 201 });
  }

  const targetTx = await queryOne<Record<string, unknown>>(
    'SELECT * FROM supplier_transactions WHERE id = ? AND supplier_id = ? AND business_id = ? LIMIT 1',
    [payload.transactionId, id, ctx.business.id]
  );

  if (!targetTx || toBool(targetTx.is_cancelled)) {
    return NextResponse.json({ error: 'İptal edilecek aktif hareket bulunamadı.' }, { status: 404 });
  }

  await execute('UPDATE supplier_transactions SET is_cancelled = 1 WHERE id = ?', [
    String(targetTx.id),
  ]);

  await writeAuditLog({
    scope: 'business',
    businessId: ctx.business.id,
    actorUserId: ctx.userId,
    action: 'supplier_transaction_cancelled',
    entityType: 'supplier_transactions',
    entityId: String(targetTx.id),
    oldValues: { amount: targetTx.amount, type: targetTx.transaction_type },
    newValues: { is_cancelled: true, reason: payload.reason },
    description: `Toptancı hareketi iptal edildi (${payload.reason}).`,
  });

  return NextResponse.json({ success: true });
}
