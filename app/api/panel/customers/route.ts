import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
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
  const { error, ctx, db } = await requireBusinessContext('customers.view');
  if (error || !ctx || !db || !ctx.business) return error!;

  const [{ data: customers, error: custErr }, { data: transactions }] = await Promise.all([
    db
      .from('customers')
      .select('*')
      .eq('business_id', ctx.business.id)
      .order('created_at', { ascending: false }),
    db
      .from('customer_transactions')
      .select('customer_id, transaction_type, amount, signed_amount, is_cancelled')
      .eq('business_id', ctx.business.id)
      .eq('is_cancelled', false),
  ]);

  if (custErr) {
    return NextResponse.json({ error: custErr.message }, { status: 500 });
  }

  const enriched = (customers ?? []).map((c) => {
    const txs = (transactions ?? []).filter((t) => t.customer_id === c.id);
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
      opening_balance: roundCurrency(opening),
      total_debt: roundCurrency(opening + debtSum),
      total_payment: roundCurrency(paymentSum),
      current_balance: roundCurrency(opening + netTx),
    };
  });

  return NextResponse.json({ customers: enriched });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessContext('customers.create');
  if (error || !ctx || !db || !ctx.business) return error!;

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
  const { data: created, error: insertErr } = await db
    .from('customers')
    .insert({
      business_id: ctx.business.id,
      name: d.name,
      last_name: d.lastName,
      phone: d.phone,
      email: d.email,
      address: d.address,
      notes: d.notes,
      opening_balance: roundCurrency(d.openingBalance),
      registered_at: d.registeredAt ?? getIstanbulTodayISO(),
      is_active: true,
    })
    .select('*')
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await db.from('audit_logs').insert({
    scope: 'business',
    business_id: ctx.business.id,
    actor_user_id: ctx.userId,
    action: 'customer_created',
    entity_type: 'customers',
    entity_id: created.id,
    new_values: { name: created.name, opening_balance: created.opening_balance },
    description: `${created.name} müşterisi oluşturuldu.`,
  });

  return NextResponse.json({ customer: created }, { status: 201 });
}
