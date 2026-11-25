import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';
import { roundCurrency } from '@/lib/format';

const planUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Paket adı giriniz.').max(120),
  description: z.string().trim().min(2).max(500),
  monthlyPrice: z.coerce.number().min(0, 'Ücret negatif olamaz.'),
  durationDays: z.coerce.number().int().min(1).max(365),
  features: z.array(z.string().trim().min(1)).min(1),
  isActive: z.boolean(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET() {
  const { error, db } = await requireSystemAdmin();
  if (error || !db) return error!;

  const { data: plan, error: err } = await db
    .from('subscription_plans')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
  return NextResponse.json({ plan });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireSystemAdmin();
  if (error || !ctx || !db) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = planUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Paket bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const { data: existing } = await db
    .from('subscription_plans')
    .select('*')
    .limit(1)
    .maybeSingle();

  const newPrice = roundCurrency(d.monthlyPrice);

  if (!existing) {
    const { data: created, error: createErr } = await db
      .from('subscription_plans')
      .insert({
        name: d.name,
        description: d.description,
        monthly_price: newPrice,
        duration_days: d.durationDays,
        features: d.features,
        is_active: d.isActive,
        effective_from: d.effectiveFrom,
      })
      .select('*')
      .single();
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
    return NextResponse.json({ plan: created });
  }

  const { data: updated, error: updErr } = await db
    .from('subscription_plans')
    .update({
      name: d.name,
      description: d.description,
      monthly_price: newPrice,
      duration_days: d.durationDays,
      features: d.features,
      is_active: d.isActive,
      effective_from: d.effectiveFrom,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .select('*')
    .single();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Mevcut aktif aboneliği devam eden işletmelerin kilitli fiyatı (locked_price) korunur.
  await db.from('audit_logs').insert({
    scope: 'admin',
    actor_user_id: ctx.userId,
    actor_name: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'subscription_plan_updated',
    entity_type: 'subscription_plans',
    entity_id: existing.id,
    old_values: {
      name: existing.name,
      monthly_price: existing.monthly_price,
      is_active: existing.is_active,
      effective_from: existing.effective_from,
    },
    new_values: {
      name: d.name,
      monthly_price: newPrice,
      is_active: d.isActive,
      effective_from: d.effectiveFrom,
    },
    description: `Tek abonelik paketi güncellendi (Yeni fiyat: ${newPrice} TL, Geçerlilik: ${d.effectiveFrom}).`,
  });

  return NextResponse.json({ plan: updated });
}
