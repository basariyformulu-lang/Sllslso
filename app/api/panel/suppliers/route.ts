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

const supplierSchema = z.object({
  companyName: z.string().trim().min(2, 'Firma adı en az 2 karakter olmalıdır.').max(140),
  contactName: z.string().trim().max(100).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().email('Geçerli e-posta giriniz.').or(z.literal('')).optional().default(''),
  address: z.string().trim().max(250).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
  openingBalance: z.coerce.number().min(0, 'Başlangıç bakiyesi negatif olamaz.').optional().default(0),
});

export async function GET() {
  const { error, ctx } = await requireBusinessContext('suppliers.view');
  if (error || !ctx || !ctx.business) return error!;

  const today = getIstanbulTodayISO();
  const [suppliers, transactions] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM suppliers WHERE business_id = ? ORDER BY created_at DESC',
      [ctx.business.id]
    ),
    query<Record<string, unknown>>(
      'SELECT supplier_id, transaction_type, amount, signed_amount, due_date, is_cancelled FROM supplier_transactions WHERE business_id = ? AND is_cancelled = 0',
      [ctx.business.id]
    ),
  ]);

  const enriched = suppliers.map((s) => {
    const sid = String(s.id);
    const txs = transactions.filter((t) => String(t.supplier_id) === sid);
    const opening = Number(s.opening_balance ?? 0);
    const debtSum = txs
      .filter((t) => t.transaction_type === 'debt')
      .reduce((acc, t) => acc + Number(t.amount), 0);
    const paymentSum = txs
      .filter((t) => t.transaction_type === 'payment')
      .reduce((acc, t) => acc + Number(t.amount), 0);
    const currentBalance = roundCurrency(
      opening + txs.reduce((acc, t) => acc + Number(t.signed_amount), 0)
    );
    const dueDebts = txs
      .filter(
        (t) =>
          t.transaction_type === 'debt' && t.due_date && String(t.due_date) <= today
      )
      .reduce((acc, t) => acc + Number(t.amount), 0);
    const overdueDebt = roundCurrency(
      Math.min(Math.max(0, currentBalance), Math.max(0, dueDebts - Math.max(0, paymentSum - opening)))
    );

    return {
      ...s,
      is_active: toBool(s.is_active),
      created_at: toIsoString(s.created_at),
      opening_balance: roundCurrency(opening),
      total_debt: roundCurrency(opening + debtSum),
      total_payment: roundCurrency(paymentSum),
      current_balance: currentBalance,
      overdue_debt: overdueDebt,
    };
  });

  return NextResponse.json({ suppliers: enriched });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessContext('suppliers.create');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = supplierSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Toptancı bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const id = uuid();
  const nowStr = toMySqlDateTime();
  const opening = roundCurrency(d.openingBalance);

  await execute(
    `INSERT INTO suppliers
     (id, business_id, company_name, contact_name, phone, email, address, notes, opening_balance, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      ctx.business.id,
      d.companyName,
      d.contactName,
      d.phone,
      d.email,
      d.address,
      d.notes,
      opening,
      nowStr,
      nowStr,
    ]
  );

  const created = await queryOne<Record<string, unknown>>(
    'SELECT * FROM suppliers WHERE id = ? LIMIT 1',
    [id]
  );

  await writeAuditLog({
    scope: 'business',
    businessId: ctx.business.id,
    actorUserId: ctx.userId,
    action: 'supplier_created',
    entityType: 'suppliers',
    entityId: id,
    newValues: { company_name: d.companyName, opening_balance: opening },
    description: `${d.companyName} toptancısı oluşturuldu.`,
  });

  return NextResponse.json(
    {
      supplier: created
        ? { ...created, is_active: toBool(created.is_active), opening_balance: opening }
        : null,
    },
    { status: 201 }
  );
}
