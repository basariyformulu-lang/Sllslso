import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
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
  const { error, ctx, db } = await requireBusinessContext('recurring.view');
  if (error || !ctx || !db || !ctx.business) return error!;

  const { searchParams } = new URL(req.url);
  const { year: curYear, month: curMonth } = getIstanbulMonthBounds();
  const targetYear = Number(searchParams.get('year')) || curYear;
  const targetMonth = Number(searchParams.get('month')) || curMonth;

  const { data: cards, error: cardsErr } = await db
    .from('recurring_expenses')
    .select('*')
    .eq('business_id', ctx.business.id)
    .order('is_active', { ascending: false })
    .order('payment_day', { ascending: true });

  if (cardsErr) return NextResponse.json({ error: cardsErr.message }, { status: 500 });

  // Seçili ay için aktif sabit gider dönemlerini otomatik oluştur (zaten varsa veya ödenmişse dokunma!)
  for (const card of cards ?? []) {
    if (!card.is_active) continue;
    const [sYear, sMonth] = String(card.start_date).split('-').map(Number);
    if (!shouldIncludeMonth(sYear, sMonth, targetYear, targetMonth, card.frequency)) continue;
    const dueDate = buildMonthDueDate(targetYear, targetMonth, card.payment_day);
    if (card.end_date && dueDate > card.end_date) continue;

    await db
      .from('recurring_expense_periods')
      .upsert(
        {
          business_id: ctx.business.id,
          recurring_expense_id: card.id,
          period_year: targetYear,
          period_month: targetMonth,
          due_date: dueDate,
          planned_amount: roundCurrency(card.monthly_amount),
          status: 'pending',
        },
        { onConflict: 'recurring_expense_id,period_year,period_month', ignoreDuplicates: true }
      );
  }

  const [{ data: periods }, { data: allPeriods }] = await Promise.all([
    db
      .from('recurring_expense_periods')
      .select('*, recurring_expense:recurring_expenses(*)')
      .eq('business_id', ctx.business.id)
      .eq('period_year', targetYear)
      .eq('period_month', targetMonth)
      .order('due_date', { ascending: true }),
    db
      .from('recurring_expense_periods')
      .select('*, recurring_expense:recurring_expenses(title, category)')
      .eq('business_id', ctx.business.id)
      .eq('status', 'paid')
      .order('paid_date', { ascending: false })
      .limit(30),
  ]);

  const plannedMonthlyTotal = roundCurrency(
    (cards ?? [])
      .filter((c) => c.is_active)
      .reduce((acc, c) => acc + Number(c.monthly_amount), 0)
  );

  return NextResponse.json({
    cards: cards ?? [],
    periods: periods ?? [],
    paidHistory: allPeriods ?? [],
    plannedMonthlyTotal,
    targetYear,
    targetMonth,
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessContext('recurring.create');
  if (error || !ctx || !db || !ctx.business) return error!;

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

  const { data: card, error: insertErr } = await db
    .from('recurring_expenses')
    .insert({
      business_id: ctx.business.id,
      category: d.category,
      title: d.title,
      monthly_amount: amount,
      start_date: d.startDate,
      end_date: d.endDate || null,
      payment_day: d.paymentDay,
      frequency: d.frequency,
      description: d.description,
      is_active: true,
      created_by: ctx.userId,
    })
    .select('*')
    .single();

  if (insertErr || !card) {
    return NextResponse.json({ error: insertErr?.message ?? 'Sabit gider kartı oluşturulamadı.' }, { status: 500 });
  }

  // Başlangıç ayından itibaren geçerli ay için dönem planı oluştur
  const { year: curYear, month: curMonth } = getIstanbulMonthBounds();
  const [sYear, sMonth] = d.startDate.split('-').map(Number);
  if (shouldIncludeMonth(sYear, sMonth, curYear, curMonth, d.frequency)) {
    const dueDate = buildMonthDueDate(curYear, curMonth, d.paymentDay);
    if (!d.endDate || dueDate <= d.endDate) {
      await db.from('recurring_expense_periods').upsert(
        {
          business_id: ctx.business.id,
          recurring_expense_id: card.id,
          period_year: curYear,
          period_month: curMonth,
          due_date: dueDate,
          planned_amount: amount,
          status: 'pending',
        },
        { onConflict: 'recurring_expense_id,period_year,period_month', ignoreDuplicates: true }
      );
    }
  }

  return NextResponse.json({ card }, { status: 201 });
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
  if (payload.action === 'pay_period') {
    const { error, ctx, db } = await requireBusinessContext('recurring.pay');
    if (error || !ctx || !db || !ctx.business) return error!;

    const { data: rpcRes, error: rpcErr } = await db.rpc('pay_recurring_expense_period', {
      p_period_id: payload.periodId,
      p_business_id: ctx.business.id,
      p_user_id: ctx.userId,
      p_paid_amount: roundCurrency(payload.paidAmount),
      p_paid_date: payload.paidDate,
      p_payment_method: payload.paymentMethod,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 409 });
    }

    return NextResponse.json({ success: true, result: rpcRes });
  }

  const { error, ctx, db } = await requireBusinessContext('recurring.edit');
  if (error || !ctx || !db || !ctx.business) return error!;

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (payload.category !== undefined) updateFields.category = payload.category;
  if (payload.title !== undefined) updateFields.title = payload.title;
  if (payload.monthlyAmount !== undefined) updateFields.monthly_amount = roundCurrency(payload.monthlyAmount);
  if (payload.paymentDay !== undefined) updateFields.payment_day = payload.paymentDay;
  if (payload.endDate !== undefined) updateFields.end_date = payload.endDate || null;
  if (payload.description !== undefined) updateFields.description = payload.description;
  if (payload.isActive !== undefined) updateFields.is_active = payload.isActive;

  const { data: updated, error: updErr } = await db
    .from('recurring_expenses')
    .update(updateFields)
    .eq('id', payload.id)
    .eq('business_id', ctx.business.id)
    .select('*')
    .maybeSingle();

  if (updErr || !updated) {
    return NextResponse.json({ error: updErr?.message ?? 'Sabit gider güncellenemedi.' }, { status: 400 });
  }

  // Yalnızca ödenmemiş (pending) dönemlerin plan tutarını güncelle; ödenmiş eski dönemlere ASLA dokunma!
  if (payload.monthlyAmount !== undefined) {
    await db
      .from('recurring_expense_periods')
      .update({
        planned_amount: roundCurrency(payload.monthlyAmount),
        updated_at: new Date().toISOString(),
      })
      .eq('recurring_expense_id', payload.id)
      .eq('business_id', ctx.business.id)
      .eq('status', 'pending');
  }

  return NextResponse.json({ card: updated });
}
