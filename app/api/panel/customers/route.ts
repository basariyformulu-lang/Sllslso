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

const customerSchema = z.object({
  name: z.string().trim().min(2, 'Müşteri veya firma adı en az 2 karakter olmalıdır.').max(120),
  lastName: z.string().trim().max(80).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().email('Geçerli e-posta adresi giriniz.').or(z.literal('')).optional().default(''),
  address: z.string().trim().max(250).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
  openingBalance: z.coerce.number().min(0, 'Başlangıç bakiyesi negatif olamaz.').optional().default(0),
  registeredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET() {
  const { error, ctx } = await requireBusinessContext('customers.view');
  if (error || !ctx || !ctx.business) return error!;

  const [customers, transactions] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM customers WHERE business_id = ? ORDER BY created_at DESC',
      [ctx.business.id]
    ),
    query<Record<string, unknown>>(
      'SELECT customer_id, transaction_type, amount, signed_amount, is_cancelled FROM customer_transactions WHERE business_id = ? AND is_cancelled = 0',
      [ctx.business.id]
    ),
  ]);

  const enriched = customers.map((c) => {
    const cid = String(c.id);
    const txs = transactions.filter((t) => String(t.customer_id) === cid);
    const opening = Number(c.opening_balance ?? 0);
    const debtSum = txs
      .filter((t) => t.transaction_type === 'debt')
      .reduce((acc, t) => acc + Number(t.amount), 0);
    const paymentSum = txs
      .filter((t) => t.transaction_type === 'payment')
      .reduce((acc, t) => acc + Number(t.amount), 0);
    const netTx = txs.reduce((acc, t) => acc + Number(t.signed_amount), 0);
    return {
      ...c,
      is_active: toBool(c.is_active),
      created_at: toIsoString(c.created_at),
      opening_balance: roundCurrency(opening),
      total_debt: roundCurrency(opening + debtSum),
      total_payment: roundCurrency(paymentSum),
      current_balance: roundCurrency(opening + netTx),
    };
  });

  return NextResponse.json({ customers: enriched });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessContext('customers.create');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Müşteri bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const id = uuid();
  const nowStr = toMySqlDateTime();
  const opening = roundCurrency(d.openingBalance);
  const regDate = d.registeredAt ?? getIstanbulTodayISO();

  await execute(
    `INSERT INTO customers
     (id, business_id, name, last_name, phone, email, address, notes, opening_balance, registered_at, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      ctx.business.id,
      d.name,
      d.lastName,
      d.phone,
      d.email,
      d.address,
      d.notes,
      opening,
      regDate,
      nowStr,
      nowStr,
    ]
  );

  const created = await queryOne<Record<string, unknown>>(
    'SELECT * FROM customers WHERE id = ? LIMIT 1',
    [id]
  );

  await writeAuditLog({
    scope: 'business',
    businessId: ctx.business.id,
    actorUserId: ctx.userId,
    action: 'customer_created',
    entityType: 'customers',
    entityId: id,
    newValues: { name: d.name, opening_balance: opening },
    description: `${d.name} müşterisi oluşturuldu.`,
  });

  return NextResponse.json(
    {
      customer: created
        ? { ...created, is_active: toBool(created.is_active), opening_balance: opening }
        : null,
    },
    { status: 201 }
  );
}
