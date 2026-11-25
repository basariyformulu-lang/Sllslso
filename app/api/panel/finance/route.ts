import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
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
  const { error, ctx, db } = await requireBusinessContext('finance.view');
  if (error || !ctx || !db || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const [{ data: incomes }, { data: expenses }, { data: incomeCategories }, { data: expenseCategories }] =
    await Promise.all([
      db
        .from('income_transactions')
        .select('*')
        .eq('business_id', businessId)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false }),
      db
        .from('expense_transactions')
        .select('*')
        .eq('business_id', businessId)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false }),
      db
        .from('income_categories')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      db
        .from('expense_categories')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name', { ascending: true }),
    ]);

  return NextResponse.json({
    incomes: incomes ?? [],
    expenses: expenses ?? [],
    incomeCategories: incomeCategories ?? [],
    expenseCategories: expenseCategories ?? [],
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessContext('finance.create');
  if (error || !ctx || !db || !ctx.business) return error!;

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
  if (d.kind === 'income_category') {
    const { data: cat, error: err } = await db
      .from('income_categories')
      .insert({ business_id: ctx.business.id, name: d.name })
      .select('*')
      .single();
    if (err) return NextResponse.json({ error: 'Bu kategori zaten mevcut olabilir.' }, { status: 400 });
    return NextResponse.json({ category: cat }, { status: 201 });
  }

  if (d.kind === 'expense_category') {
    const { data: cat, error: err } = await db
      .from('expense_categories')
      .insert({ business_id: ctx.business.id, name: d.name })
      .select('*')
      .single();
    if (err) return NextResponse.json({ error: 'Bu kategori zaten mevcut olabilir.' }, { status: 400 });
    return NextResponse.json({ category: cat }, { status: 201 });
  }

  if (d.kind === 'income') {
    const { data: row, error: err } = await db
      .from('income_transactions')
      .insert({
        business_id: ctx.business.id,
        category_id: d.categoryId ?? null,
        category_name: d.categoryName,
        title: d.title,
        amount: roundCurrency(d.amount),
        transaction_date: d.transactionDate,
        description: d.description,
        created_by: ctx.userId,
      })
      .select('*')
      .single();
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });
    return NextResponse.json({ income: row }, { status: 201 });
  }

  const { data: row, error: err } = await db
    .from('expense_transactions')
    .insert({
      business_id: ctx.business.id,
      category_id: d.categoryId ?? null,
      category_name: d.categoryName,
      title: d.title,
      amount: roundCurrency(d.amount),
      transaction_date: d.transactionDate,
      payment_method: d.paymentMethod,
      description: d.description,
      created_by: ctx.userId,
    })
    .select('*')
    .single();
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
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
  const { error, ctx, db } = await requireBusinessContext(
    isCancel ? 'finance.delete' : 'finance.edit'
  );
  if (error || !ctx || !db || !ctx.business) return error!;

  if (d.action === 'update_income') {
    const { data: updated, error: err } = await db
      .from('income_transactions')
      .update({
        title: d.title,
        amount: roundCurrency(d.amount),
        transaction_date: d.transactionDate,
        category_name: d.categoryName,
        description: d.description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', d.id)
      .eq('business_id', ctx.business.id)
      .eq('is_cancelled', false)
      .select('*')
      .maybeSingle();
    if (err || !updated) return NextResponse.json({ error: 'Gelir güncellenemedi.' }, { status: 400 });
    return NextResponse.json({ income: updated });
  }

  if (d.action === 'update_expense') {
    const { data: updated, error: err } = await db
      .from('expense_transactions')
      .update({
        title: d.title,
        amount: roundCurrency(d.amount),
        transaction_date: d.transactionDate,
        category_name: d.categoryName,
        payment_method: d.paymentMethod,
        description: d.description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', d.id)
      .eq('business_id', ctx.business.id)
      .eq('is_cancelled', false)
      .select('*')
      .maybeSingle();
    if (err || !updated) return NextResponse.json({ error: 'Gider güncellenemedi.' }, { status: 400 });
    return NextResponse.json({ expense: updated });
  }

  const table = d.action === 'cancel_income' ? 'income_transactions' : 'expense_transactions';
  const { error: cancelErr } = await db
    .from(table)
    .update({
      is_cancelled: true,
      cancelled_at: new Date().toISOString(),
      cancelled_by: ctx.userId,
    })
    .eq('id', d.id)
    .eq('business_id', ctx.business.id);

  if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 });

  await db.from('audit_logs').insert({
    scope: 'business',
    business_id: ctx.business.id,
    actor_user_id: ctx.userId,
    action: `${table}_cancelled`,
    entity_type: table,
    entity_id: d.id,
    description: 'Gelir/gider kaydı iptal edildi.',
  });

  return NextResponse.json({ success: true });
}
