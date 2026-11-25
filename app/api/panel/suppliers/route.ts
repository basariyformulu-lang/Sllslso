import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
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
  const { error, ctx, db } = await requireBusinessContext('suppliers.view');
  if (error || !ctx || !db || !ctx.business) return error!;

  const today = getIstanbulTodayISO();
  const [{ data: suppliers, error: suppErr }, { data: transactions }] = await Promise.all([
    db
      .from('suppliers')
      .select('*')
      .eq('business_id', ctx.business.id)
      .order('created_at', { ascending: false }),
    db
      .from('supplier_transactions')
      .select('supplier_id, transaction_type, amount, signed_amount, due_date, is_cancelled')
      .eq('business_id', ctx.business.id)
      .eq('is_cancelled', false),
  ]);

  if (suppErr) {
    return NextResponse.json({ error: suppErr.message }, { status: 500 });
  }

  const enriched = (suppliers ?? []).map((s) => {
    const txs = (transactions ?? []).filter((t) => t.supplier_id === s.id);
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
      .filter((t) => t.transaction_type === 'debt' && t.due_date && t.due_date <= today)
      .reduce((acc, t) => acc + Number(t.amount), 0);
    const overdueDebt = roundCurrency(
      Math.min(Math.max(0, currentBalance), Math.max(0, dueDebts - Math.max(0, paymentSum - opening)))
    );

    return {
      ...s,
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
  const { error, ctx, db } = await requireBusinessContext('suppliers.create');
  if (error || !ctx || !db || !ctx.business) return error!;

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
  const { data: created, error: insertErr } = await db
    .from('suppliers')
    .insert({
      business_id: ctx.business.id,
      company_name: d.companyName,
      contact_name: d.contactName,
      phone: d.phone,
      email: d.email,
      address: d.address,
      notes: d.notes,
      opening_balance: roundCurrency(d.openingBalance),
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
    action: 'supplier_created',
    entity_type: 'suppliers',
    entity_id: created.id,
    new_values: { company_name: created.company_name, opening_balance: created.opening_balance },
    description: `${created.company_name} toptancısı oluşturuldu.`,
  });

  return NextResponse.json({ supplier: created }, { status: 201 });
}
