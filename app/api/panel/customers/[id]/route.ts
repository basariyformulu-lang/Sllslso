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
  withTransaction,
  writeAuditLog,
} from '@/lib/db';
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
  const { error, ctx } = await requireBusinessContext('customers.view');
  if (error || !ctx || !ctx.business) return error!;

  const { id } = await params;
  const customer = await queryOne<Record<string, unknown>>(
    'SELECT * FROM customers WHERE id = ? AND business_id = ? LIMIT 1',
    [id, ctx.business.id]
  );

  if (!customer) {
    return NextResponse.json({ error: 'Müşteri bulunamadı.' }, { status: 404 });
  }

  const [transactions, creditSales] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM customer_transactions WHERE customer_id = ? AND business_id = ? ORDER BY transaction_date DESC, created_at DESC',
      [id, ctx.business.id]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM credit_sales WHERE customer_id = ? AND business_id = ? AND is_cancelled = 0 ORDER BY due_date ASC',
      [id, ctx.business.id]
    ),
  ]);

  const activeTxs = transactions.filter((t) => !toBool(t.is_cancelled));
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
      is_active: toBool(customer.is_active),
      total_debt: roundCurrency(opening + debtSum),
      total_payment: roundCurrency(paymentSum),
      current_balance: currentBalance,
    },
    transactions: transactions.map((t) => ({
      ...t,
      amount: Number(t.amount),
      signed_amount: Number(t.signed_amount),
      is_cancelled: toBool(t.is_cancelled),
      is_overpayment: toBool(t.is_overpayment),
      created_at: toIsoString(t.created_at),
    })),
    creditSales: creditSales.map((cs) => ({
      ...cs,
      total_amount: Number(cs.total_amount),
      paid_amount: Number(cs.paid_amount),
      is_cancelled: toBool(cs.is_cancelled),
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireBusinessContext('customers.edit');
  if (error || !ctx || !ctx.business) return error!;

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

  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM customers WHERE id = ? AND business_id = ? LIMIT 1',
    [id, ctx.business.id]
  );
  if (!existing) {
    return NextResponse.json({ error: 'Müşteri bulunamadı.' }, { status: 404 });
  }

  const d = parsed.data;
  await execute(
    `UPDATE customers
     SET name = ?, last_name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ?, updated_at = ?
     WHERE id = ? AND business_id = ?`,
    [
      d.name ?? String(existing.name),
      d.lastName ?? String(existing.last_name ?? ''),
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
    'SELECT * FROM customers WHERE id = ? LIMIT 1',
    [id]
  );

  return NextResponse.json({
    customer: updated ? { ...updated, is_active: toBool(updated.is_active) } : null,
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

  const { error, ctx } = await requireBusinessContext(requiredPerm);
  if (error || !ctx || !ctx.business) return error!;

  const customer = await queryOne<Record<string, unknown>>(
    'SELECT * FROM customers WHERE id = ? AND business_id = ? LIMIT 1',
    [id, ctx.business.id]
  );

  if (!customer) {
    return NextResponse.json({ error: 'Müşteri bulunamadı.' }, { status: 404 });
  }

  const nowStr = toMySqlDateTime();

  if (payload.action === 'add_debt') {
    const amt = roundCurrency(payload.amount);
    const txId = uuid();
    await execute(
      `INSERT INTO customer_transactions
       (id, business_id, customer_id, transaction_type, debt_category, amount, signed_amount, transaction_date, due_date, description, notes, is_overpayment, is_cancelled, created_by, created_at)
       VALUES (?, ?, ?, 'debt', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [
        txId,
        ctx.business.id,
        id,
        payload.debtCategory,
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
      'SELECT * FROM customer_transactions WHERE id = ? LIMIT 1',
      [txId]
    );
    return NextResponse.json({ transaction: tx }, { status: 201 });
  }

  if (payload.action === 'add_payment') {
    const amt = roundCurrency(payload.amount);
    const existingTxs = await query<{ signed_amount: number }>(
      'SELECT signed_amount FROM customer_transactions WHERE customer_id = ? AND business_id = ? AND is_cancelled = 0',
      [id, ctx.business.id]
    );

    const currentBalance = roundCurrency(
      Number(customer.opening_balance ?? 0) +
        existingTxs.reduce((acc, t) => acc + Number(t.signed_amount), 0)
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

    const txId = uuid();
    await withTransaction(async (conn) => {
      await conn.execute(
        `INSERT INTO customer_transactions
         (id, business_id, customer_id, credit_sale_id, transaction_type, debt_category, amount, signed_amount, transaction_date, payment_method, description, notes, is_overpayment, is_cancelled, created_by, created_at)
         VALUES (?, ?, ?, ?, 'payment', 'Tahsilat', ?, ?, ?, ?, ?, '', ?, 0, ?, ?)`,
        [
          txId,
          ctx.business!.id,
          id,
          payload.creditSaleId ?? null,
          amt,
          -amt,
          payload.transactionDate,
          payload.paymentMethod,
          payload.description || 'Müşteri tahsilatı',
          isOverpayment ? 1 : 0,
          ctx.userId,
          nowStr,
        ]
      );

      if (payload.creditSaleId) {
        const [saleRows] = await conn.execute(
          'SELECT id, paid_amount FROM credit_sales WHERE id = ? AND business_id = ? FOR UPDATE',
          [payload.creditSaleId, ctx.business!.id]
        );
        const sale = (saleRows as Array<{ id: string; paid_amount: number }>)[0];
        if (sale) {
          const newPaid = roundCurrency(Number(sale.paid_amount) + amt);
          await conn.execute(
            'UPDATE credit_sales SET paid_amount = ?, updated_at = ? WHERE id = ?',
            [newPaid, nowStr, sale.id]
          );
        }
      }
    });

    const tx = await queryOne<Record<string, unknown>>(
      'SELECT * FROM customer_transactions WHERE id = ? LIMIT 1',
      [txId]
    );
    return NextResponse.json({ transaction: tx }, { status: 201 });
  }

  const targetTx = await queryOne<Record<string, unknown>>(
    'SELECT * FROM customer_transactions WHERE id = ? AND customer_id = ? AND business_id = ? LIMIT 1',
    [payload.transactionId, id, ctx.business.id]
  );

  if (!targetTx || toBool(targetTx.is_cancelled)) {
    return NextResponse.json({ error: 'İptal edilecek aktif hareket bulunamadı.' }, { status: 404 });
  }

  await withTransaction(async (conn) => {
    await conn.execute('UPDATE customer_transactions SET is_cancelled = 1 WHERE id = ?', [
      String(targetTx.id),
    ]);

    if (targetTx.transaction_type === 'payment' && targetTx.credit_sale_id) {
      const [saleRows] = await conn.execute(
        'SELECT id, paid_amount FROM credit_sales WHERE id = ? FOR UPDATE',
        [String(targetTx.credit_sale_id)]
      );
      const sale = (saleRows as Array<{ id: string; paid_amount: number }>)[0];
      if (sale) {
        await conn.execute(
          'UPDATE credit_sales SET paid_amount = ?, updated_at = ? WHERE id = ?',
          [
            Math.max(0, roundCurrency(Number(sale.paid_amount) - Number(targetTx.amount))),
            nowStr,
            sale.id,
          ]
        );
      }
    }
  });

  await writeAuditLog({
    scope: 'business',
    businessId: ctx.business.id,
    actorUserId: ctx.userId,
    action: 'customer_transaction_cancelled',
    entityType: 'customer_transactions',
    entityId: String(targetTx.id),
    oldValues: { amount: targetTx.amount, type: targetTx.transaction_type },
    newValues: { is_cancelled: true, reason: payload.reason },
    description: `Müşteri hareketi iptal edildi (${payload.reason}).`,
  });

  return NextResponse.json({ success: true });
}
