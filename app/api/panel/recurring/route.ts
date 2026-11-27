import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
import {
  execute,
  query,
  queryOne,
  toBool,
  toMySqlDateTime,
  uuid,
  withTransaction,
} from '@/lib/db';
import { buildMonthDueDate, getIstanbulMonthBounds, roundCurrency } from '@/lib/format';

const RECURRING_CATEGORIES = [
  'Kira',
  'Elektrik',
  'Su',
  'İnternet',
  'Personel',
  'Muhasebe Ücreti',
  'Diğer',
] as const;

const createRecurringSchema = z.object({
  category: z.enum(RECURRING_CATEGORIES),
  title: z.string().trim().min(2, 'Sabit gider adı giriniz.').max(140),
  monthlyAmount: z.coerce.number().positive('Aylık tutar sıfırdan büyük olmalıdır.'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  paymentDay: z.coerce.number().int().min(1).max(31),
  frequency: z.enum(['monthly', 'quarterly', 'yearly']).default('monthly'),
  description: z.string().trim().max(400).optional().default(''),
});

const patchRecurringSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_card'),
    id: z.string().uuid(),
    category: z.enum(RECURRING_CATEGORIES).optional(),
    title: z.string().trim().min(2).max(140).optional(),
    monthlyAmount: z.coerce.number().positive().optional(),
    paymentDay: z.coerce.number().int().min(1).max(31).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    description: z.string().trim().max(400).optional(),
    isActive: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('pay_period'),
    periodId: z.string().uuid(),
    paidAmount: z.coerce.number().positive('Ödeme tutarı sıfırdan büyük olmalıdır.'),
    paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    paymentMethod: z.enum(['nakit', 'banka', 'kart', 'diger']),
  }),
]);

function shouldIncludeMonth(
  startYear: number,
  startMonth: number,
  targetYear: number,
  targetMonth: number,
  frequency: string
): boolean {
  const diff = (targetYear - startYear) * 12 + (targetMonth - startMonth);
  if (diff < 0) return false;
  if (frequency === 'quarterly') return diff % 3 === 0;
  if (frequency === 'yearly') return diff % 12 === 0;
  return true;
}

export async function GET(req: NextRequest) {
  const { error, ctx } = await requireBusinessContext('recurring.view');
  if (error || !ctx || !ctx.business) return error!;

  const { searchParams } = new URL(req.url);
  const { year: curYear, month: curMonth } = getIstanbulMonthBounds();
  const targetYear = Number(searchParams.get('year')) || curYear;
  const targetMonth = Number(searchParams.get('month')) || curMonth;

  const cards = await query<Record<string, unknown>>(
    'SELECT * FROM recurring_expenses WHERE business_id = ? ORDER BY is_active DESC, payment_day ASC',
    [ctx.business.id]
  );

  for (const card of cards) {
    if (!toBool(card.is_active)) continue;
    const [sYear, sMonth] = String(card.start_date).split('-').map(Number);
    if (!shouldIncludeMonth(sYear, sMonth, targetYear, targetMonth, String(card.frequency))) {
      continue;
    }
    const dueDate = buildMonthDueDate(targetYear, targetMonth, Number(card.payment_day));
    if (card.end_date && dueDate > String(card.end_date)) continue;

    await execute(
      `INSERT IGNORE INTO recurring_expense_periods
       (id, business_id, recurring_expense_id, period_year, period_month, due_date, planned_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        uuid(),
        ctx.business.id,
        String(card.id),
        targetYear,
        targetMonth,
        dueDate,
        roundCurrency(Number(card.monthly_amount)),
      ]
    );
  }

  const [periods, allPeriods] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT p.*, r.title AS r_title, r.category AS r_category, r.monthly_amount AS r_monthly_amount,
              r.payment_day AS r_payment_day, r.frequency AS r_frequency
       FROM recurring_expense_periods p
       LEFT JOIN recurring_expenses r ON r.id = p.recurring_expense_id
       WHERE p.business_id = ? AND p.period_year = ? AND p.period_month = ?
       ORDER BY p.due_date ASC`,
      [ctx.business.id, targetYear, targetMonth]
    ),
    query<Record<string, unknown>>(
      `SELECT p.*, r.title AS r_title, r.category AS r_category
       FROM recurring_expense_periods p
       LEFT JOIN recurring_expenses r ON r.id = p.recurring_expense_id
       WHERE p.business_id = ? AND p.status = 'paid'
       ORDER BY p.paid_date DESC
       LIMIT 30`,
      [ctx.business.id]
    ),
  ]);

  const plannedMonthlyTotal = roundCurrency(
    cards
      .filter((c) => toBool(c.is_active))
      .reduce((acc, c) => acc + Number(c.monthly_amount), 0)
  );

  return NextResponse.json({
    cards: cards.map((c) => ({
      ...c,
      monthly_amount: Number(c.monthly_amount),
      is_active: toBool(c.is_active),
    })),
    periods: periods.map((p) => ({
      ...p,
      planned_amount: Number(p.planned_amount),
      paid_amount: p.paid_amount != null ? Number(p.paid_amount) : null,
      recurring_expense: {
        id: p.recurring_expense_id,
        title: p.r_title,
        category: p.r_category,
        monthly_amount: Number(p.r_monthly_amount ?? p.planned_amount),
        payment_day: Number(p.r_payment_day ?? 1),
        frequency: p.r_frequency ?? 'monthly',
      },
    })),
    paidHistory: allPeriods.map((p) => ({
      ...p,
      planned_amount: Number(p.planned_amount),
      paid_amount: p.paid_amount != null ? Number(p.paid_amount) : null,
      recurring_expense: {
        title: p.r_title,
        category: p.r_category,
      },
    })),
    plannedMonthlyTotal,
    targetYear,
    targetMonth,
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessContext('recurring.create');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = createRecurringSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Sabit gider bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const amount = roundCurrency(d.monthlyAmount);
  const id = uuid();
  const nowStr = toMySqlDateTime();

  await execute(
    `INSERT INTO recurring_expenses
     (id, business_id, category, title, monthly_amount, start_date, end_date, payment_day, frequency, description, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      id,
      ctx.business.id,
      d.category,
      d.title,
      amount,
      d.startDate,
      d.endDate || null,
      d.paymentDay,
      d.frequency,
      d.description,
      ctx.userId,
      nowStr,
      nowStr,
    ]
  );

  const { year: curYear, month: curMonth } = getIstanbulMonthBounds();
  const [sYear, sMonth] = d.startDate.split('-').map(Number);
  if (shouldIncludeMonth(sYear, sMonth, curYear, curMonth, d.frequency)) {
    const dueDate = buildMonthDueDate(curYear, curMonth, d.paymentDay);
    if (!d.endDate || dueDate <= d.endDate) {
      await execute(
        `INSERT IGNORE INTO recurring_expense_periods
         (id, business_id, recurring_expense_id, period_year, period_month, due_date, planned_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [uuid(), ctx.business.id, id, curYear, curMonth, dueDate, amount]
      );
    }
  }

  const card = await queryOne<Record<string, unknown>>(
    'SELECT * FROM recurring_expenses WHERE id = ? LIMIT 1',
    [id]
  );

  return NextResponse.json(
    { card: card ? { ...card, is_active: toBool(card.is_active) } : null },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = patchRecurringSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Sabit gider bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const nowStr = toMySqlDateTime();

  if (payload.action === 'pay_period') {
    const { error, ctx } = await requireBusinessContext('recurring.pay');
    if (error || !ctx || !ctx.business) return error!;

    const paidAmount = roundCurrency(payload.paidAmount);
    try {
      const expenseId = await withTransaction(async (conn) => {
        const [rows] = await conn.execute(
          `SELECT p.*, r.title AS r_title, r.category AS r_category
           FROM recurring_expense_periods p
           LEFT JOIN recurring_expenses r ON r.id = p.recurring_expense_id
           WHERE p.id = ? AND p.business_id = ?
           FOR UPDATE`,
          [payload.periodId, ctx.business!.id]
        );
        const period = (rows as Array<Record<string, unknown>>)[0];
        if (!period) {
          throw new Error('NOT_FOUND:Sabit gider dönemi bulunamadı.');
        }
        if (period.status === 'paid') {
          throw new Error('CONFLICT:Bu dönem zaten ödenmiş olarak işaretlenmiş.');
        }

        const expId = uuid();
        await conn.execute(
          `INSERT INTO expense_transactions
           (id, business_id, category_id, category_name, title, amount, transaction_date, payment_method, description, is_cancelled, created_by, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          [
            expId,
            ctx.business!.id,
            String(period.r_category || 'Sabit Gider'),
            `${String(period.r_title || 'Sabit Gider')} (${period.period_month}/${period.period_year})`,
            paidAmount,
            payload.paidDate,
            payload.paymentMethod,
            'Aylık sabit gider ödemesi',
            ctx.userId,
            nowStr,
            nowStr,
          ]
        );

        await conn.execute(
          `UPDATE recurring_expense_periods
           SET status = 'paid', paid_amount = ?, paid_date = ?, payment_method = ?, expense_transaction_id = ?, updated_at = ?
           WHERE id = ?`,
          [paidAmount, payload.paidDate, payload.paymentMethod, expId, nowStr, payload.periodId]
        );

        return expId;
      });

      return NextResponse.json({ success: true, expenseTransactionId: expenseId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ödeme kaydedilemedi.';
      if (msg.startsWith('NOT_FOUND:')) return NextResponse.json({ error: msg.slice(10) }, { status: 404 });
      if (msg.startsWith('CONFLICT:')) return NextResponse.json({ error: msg.slice(9) }, { status: 409 });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const { error, ctx } = await requireBusinessContext('recurring.edit');
  if (error || !ctx || !ctx.business) return error!;

  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM recurring_expenses WHERE id = ? AND business_id = ? LIMIT 1',
    [payload.id, ctx.business.id]
  );
  if (!existing) {
    return NextResponse.json({ error: 'Sabit gider kartı bulunamadı.' }, { status: 404 });
  }

  const nextAmount =
    payload.monthlyAmount !== undefined
      ? roundCurrency(payload.monthlyAmount)
      : Number(existing.monthly_amount);

  await execute(
    `UPDATE recurring_expenses
     SET category = ?, title = ?, monthly_amount = ?, payment_day = ?, end_date = ?, description = ?, is_active = ?, updated_at = ?
     WHERE id = ? AND business_id = ?`,
    [
      payload.category ?? String(existing.category),
      payload.title ?? String(existing.title),
      nextAmount,
      payload.paymentDay ?? Number(existing.payment_day),
      payload.endDate !== undefined ? payload.endDate : existing.end_date,
      payload.description ?? String(existing.description ?? ''),
      payload.isActive !== undefined ? (payload.isActive ? 1 : 0) : toBool(existing.is_active) ? 1 : 0,
      nowStr,
      payload.id,
      ctx.business.id,
    ]
  );

  if (payload.monthlyAmount !== undefined) {
    await execute(
      `UPDATE recurring_expense_periods
       SET planned_amount = ?, updated_at = ?
       WHERE recurring_expense_id = ? AND business_id = ? AND status = 'pending'`,
      [nextAmount, nowStr, payload.id, ctx.business.id]
    );
  }

  const updated = await queryOne<Record<string, unknown>>(
    'SELECT * FROM recurring_expenses WHERE id = ? LIMIT 1',
    [payload.id]
  );

  return NextResponse.json({
    card: updated ? { ...updated, is_active: toBool(updated.is_active) } : null,
  });
}
