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
import { roundCurrency } from '@/lib/format';

const createActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('income'),
    title: z.string().trim().min(2, 'Gelir adı giriniz.').max(140),
    amount: z.coerce.number().positive('Tutar sıfırdan büyük olmalıdır.'),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    categoryId: z.string().uuid().optional().nullable(),
    categoryName: z.string().trim().min(1).max(80).default('Diğer'),
    description: z.string().trim().max(400).optional().default(''),
  }),
  z.object({
    kind: z.literal('expense'),
    title: z.string().trim().min(2, 'Gider adı giriniz.').max(140),
    amount: z.coerce.number().positive('Tutar sıfırdan büyük olmalıdır.'),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    categoryId: z.string().uuid().optional().nullable(),
    categoryName: z.string().trim().min(1).max(80).default('Diğer'),
    paymentMethod: z.enum(['nakit', 'banka', 'kart', 'diger']).default('nakit'),
    description: z.string().trim().max(400).optional().default(''),
  }),
  z.object({
    kind: z.literal('income_category'),
    name: z.string().trim().min(2, 'Kategori adı giriniz.').max(60),
  }),
  z.object({
    kind: z.literal('expense_category'),
    name: z.string().trim().min(2, 'Kategori adı giriniz.').max(60),
  }),
]);

const patchFinanceSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_income'),
    id: z.string().uuid(),
    title: z.string().trim().min(2).max(140),
    amount: z.coerce.number().positive(),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    categoryName: z.string().trim().min(1).max(80),
    description: z.string().trim().max(400).optional().default(''),
  }),
  z.object({
    action: z.literal('update_expense'),
    id: z.string().uuid(),
    title: z.string().trim().min(2).max(140),
    amount: z.coerce.number().positive(),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    categoryName: z.string().trim().min(1).max(80),
    paymentMethod: z.enum(['nakit', 'banka', 'kart', 'diger']),
    description: z.string().trim().max(400).optional().default(''),
  }),
  z.object({
    action: z.literal('cancel_income'),
    id: z.string().uuid(),
  }),
  z.object({
    action: z.literal('cancel_expense'),
    id: z.string().uuid(),
  }),
]);

export async function GET() {
  const { error, ctx } = await requireBusinessContext('finance.view');
  if (error || !ctx || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const [incomes, expenses, incomeCategories, expenseCategories] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM income_transactions WHERE business_id = ? ORDER BY transaction_date DESC, created_at DESC',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM expense_transactions WHERE business_id = ? ORDER BY transaction_date DESC, created_at DESC',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM income_categories WHERE business_id = ? AND is_active = 1 ORDER BY name ASC',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM expense_categories WHERE business_id = ? AND is_active = 1 ORDER BY name ASC',
      [businessId]
    ),
  ]);

  return NextResponse.json({
    incomes: incomes.map((i) => ({
      ...i,
      amount: Number(i.amount),
      is_cancelled: toBool(i.is_cancelled),
      created_at: toIsoString(i.created_at),
    })),
    expenses: expenses.map((e) => ({
      ...e,
      amount: Number(e.amount),
      is_cancelled: toBool(e.is_cancelled),
      created_at: toIsoString(e.created_at),
    })),
    incomeCategories: incomeCategories.map((c) => ({ ...c, is_active: toBool(c.is_active) })),
    expenseCategories: expenseCategories.map((c) => ({ ...c, is_active: toBool(c.is_active) })),
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessContext('finance.create');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = createActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Kayıt bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const nowStr = toMySqlDateTime();

  if (d.kind === 'income_category') {
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM income_categories WHERE business_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
      [ctx.business.id, d.name]
    );
    if (existing) {
      return NextResponse.json({ error: 'Bu kategori zaten mevcut.' }, { status: 400 });
    }
    const id = uuid();
    await execute(
      'INSERT INTO income_categories (id, business_id, name, is_default, is_active) VALUES (?, ?, ?, 0, 1)',
      [id, ctx.business.id, d.name]
    );
    const cat = await queryOne<Record<string, unknown>>(
      'SELECT * FROM income_categories WHERE id = ? LIMIT 1',
      [id]
    );
    return NextResponse.json({ category: cat }, { status: 201 });
  }

  if (d.kind === 'expense_category') {
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM expense_categories WHERE business_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
      [ctx.business.id, d.name]
    );
    if (existing) {
      return NextResponse.json({ error: 'Bu kategori zaten mevcut.' }, { status: 400 });
    }
    const id = uuid();
    await execute(
      'INSERT INTO expense_categories (id, business_id, name, is_default, is_active) VALUES (?, ?, ?, 0, 1)',
      [id, ctx.business.id, d.name]
    );
    const cat = await queryOne<Record<string, unknown>>(
      'SELECT * FROM expense_categories WHERE id = ? LIMIT 1',
      [id]
    );
    return NextResponse.json({ category: cat }, { status: 201 });
  }

  if (d.kind === 'income') {
    const id = uuid();
    await execute(
      `INSERT INTO income_transactions
       (id, business_id, category_id, category_name, title, amount, transaction_date, description, is_cancelled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        id,
        ctx.business.id,
        d.categoryId ?? null,
        d.categoryName,
        d.title,
        roundCurrency(d.amount),
        d.transactionDate,
        d.description,
        ctx.userId,
        nowStr,
        nowStr,
      ]
    );
    const row = await queryOne<Record<string, unknown>>(
      'SELECT * FROM income_transactions WHERE id = ? LIMIT 1',
      [id]
    );
    return NextResponse.json({ income: row }, { status: 201 });
  }

  const id = uuid();
  await execute(
    `INSERT INTO expense_transactions
     (id, business_id, category_id, category_name, title, amount, transaction_date, payment_method, description, is_cancelled, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      id,
      ctx.business.id,
      d.categoryId ?? null,
      d.categoryName,
      d.title,
      roundCurrency(d.amount),
      d.transactionDate,
      d.paymentMethod,
      d.description,
      ctx.userId,
      nowStr,
      nowStr,
    ]
  );
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM expense_transactions WHERE id = ? LIMIT 1',
    [id]
  );
  return NextResponse.json({ expense: row }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = patchFinanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'İşlem bilgilerini kontrol ediniz.' }, { status: 400 });
  }

  const d = parsed.data;
  const isCancel = d.action === 'cancel_income' || d.action === 'cancel_expense';
  const { error, ctx } = await requireBusinessContext(
    isCancel ? 'finance.delete' : 'finance.edit'
  );
  if (error || !ctx || !ctx.business) return error!;

  const nowStr = toMySqlDateTime();

  if (d.action === 'update_income') {
    const res = await execute(
      `UPDATE income_transactions
       SET title = ?, amount = ?, transaction_date = ?, category_name = ?, description = ?, updated_at = ?
       WHERE id = ? AND business_id = ? AND is_cancelled = 0`,
      [
        d.title,
        roundCurrency(d.amount),
        d.transactionDate,
        d.categoryName,
        d.description,
        nowStr,
        d.id,
        ctx.business.id,
      ]
    );
    if (res.affectedRows === 0) {
      return NextResponse.json({ error: 'Gelir güncellenemedi.' }, { status: 400 });
    }
    const updated = await queryOne<Record<string, unknown>>(
      'SELECT * FROM income_transactions WHERE id = ? LIMIT 1',
      [d.id]
    );
    return NextResponse.json({ income: updated });
  }

  if (d.action === 'update_expense') {
    const res = await execute(
      `UPDATE expense_transactions
       SET title = ?, amount = ?, transaction_date = ?, category_name = ?, payment_method = ?, description = ?, updated_at = ?
       WHERE id = ? AND business_id = ? AND is_cancelled = 0`,
      [
        d.title,
        roundCurrency(d.amount),
        d.transactionDate,
        d.categoryName,
        d.paymentMethod,
        d.description,
        nowStr,
        d.id,
        ctx.business.id,
      ]
    );
    if (res.affectedRows === 0) {
      return NextResponse.json({ error: 'Gider güncellenemedi.' }, { status: 400 });
    }
    const updated = await queryOne<Record<string, unknown>>(
      'SELECT * FROM expense_transactions WHERE id = ? LIMIT 1',
      [d.id]
    );
    return NextResponse.json({ expense: updated });
  }

  const table = d.action === 'cancel_income' ? 'income_transactions' : 'expense_transactions';
  await execute(
    `UPDATE ${table} SET is_cancelled = 1, cancelled_at = ?, cancelled_by = ? WHERE id = ? AND business_id = ?`,
    [nowStr, ctx.userId, d.id, ctx.business.id]
  );

  await writeAuditLog({
    scope: 'business',
    businessId: ctx.business.id,
    actorUserId: ctx.userId,
    action: `${table}_cancelled`,
    entityType: table,
    entityId: d.id,
    description: 'Gelir/gider kaydı iptal edildi.',
  });

  return NextResponse.json({ success: true });
}
