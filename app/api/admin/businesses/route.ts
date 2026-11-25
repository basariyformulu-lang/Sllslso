import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';
import { roundCurrency } from '@/lib/format';

const updateBusinessSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(140).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().or(z.literal('')).optional(),
  address: z.string().trim().max(250).optional(),
  isActive: z.boolean().optional(),
  subscriptionStatus: z
    .enum(['active', 'passive', 'payment_pending', 'pending_approval', 'expired', 'suspended'])
    .optional(),
  subscriptionStartAt: z.string().optional().nullable(),
  subscriptionEndAt: z.string().optional().nullable(),
  extendDays: z.coerce.number().int().min(1).max(3650).optional(),
  lockedPrice: z.coerce.number().min(0).optional(),
  actionNote: z.string().trim().max(250).optional(),
});

const deleteBusinessSchema = z.object({
  id: z.string().uuid(),
  confirmName: z.string().trim().min(1),
});

export async function GET() {
  const { error, db } = await requireSystemAdmin();
  if (error || !db) return error!;

  const [{ data: businesses }, { data: owners }, { data: subscriptions }, { data: payments }] =
    await Promise.all([
      db.from('businesses').select('*').order('created_at', { ascending: false }),
      db
        .from('business_members')
        .select('business_id, user_id, profile:profiles(first_name, last_name, email, phone)')
        .eq('is_owner', true),
      db.from('subscriptions').select('*'),
      db
        .from('payment_requests')
        .select('business_id, payment_date, status, amount')
        .eq('status', 'approved')
        .order('payment_date', { ascending: false }),
    ]);

  const enriched = (businesses ?? []).map((b) => {
    const owner = (owners ?? []).find((o) => o.business_id === b.id);
    const sub = (subscriptions ?? []).find((s) => s.business_id === b.id);
    const lastPayment = (payments ?? []).find((p) => p.business_id === b.id);
    const ownerProfile = Array.isArray(owner?.profile) ? owner?.profile[0] : owner?.profile;
    return {
      ...b,
      owner_name: ownerProfile
        ? `${ownerProfile.first_name} ${ownerProfile.last_name}`.trim()
        : '—',
      owner_email: ownerProfile?.email ?? b.email,
      subscription: sub ?? null,
      last_payment_date: lastPayment?.payment_date ?? sub?.last_payment_at ?? null,
    };
  });

  return NextResponse.json({ businesses: enriched });
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

  const parsed = updateBusinessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'İşletme güncelleme verileri geçersiz.' }, { status: 400 });
  }

  const d = parsed.data;
  const { data: existing } = await db
    .from('businesses')
    .select('*')
    .eq('id', d.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'İşletme bulunamadı.' }, { status: 404 });
  }

  let nextStart = d.subscriptionStartAt !== undefined ? d.subscriptionStartAt : existing.subscription_start_at;
  let nextEnd = d.subscriptionEndAt !== undefined ? d.subscriptionEndAt : existing.subscription_end_at;
  let nextSubStatus = d.subscriptionStatus ?? existing.subscription_status;

  if (d.extendDays) {
    const baseDate =
      existing.subscription_end_at && new Date(existing.subscription_end_at).getTime() > Date.now()
        ? new Date(existing.subscription_end_at)
        : new Date();
    if (!nextStart) nextStart = new Date().toISOString();
    nextEnd = new Date(baseDate.getTime() + d.extendDays * 24 * 60 * 60 * 1000).toISOString();
    nextSubStatus = 'active';
  }

  const bizPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    subscription_status: nextSubStatus,
    subscription_start_at: nextStart,
    subscription_end_at: nextEnd,
  };
  if (d.name !== undefined) bizPatch.name = d.name;
  if (d.phone !== undefined) bizPatch.phone = d.phone;
  if (d.email !== undefined) bizPatch.email = d.email;
  if (d.address !== undefined) bizPatch.address = d.address;
  if (d.isActive !== undefined) bizPatch.is_active = d.isActive;

  const { data: updated, error: updErr } = await db
    .from('businesses')
    .update(bizPatch)
    .eq('id', d.id)
    .select('*')
    .single();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const subPatch: Record<string, unknown> = {
    status: nextSubStatus,
    start_date: nextStart,
    end_date: nextEnd,
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  };
  if (d.lockedPrice !== undefined) subPatch.locked_price = roundCurrency(d.lockedPrice);

  await db.from('subscriptions').update(subPatch).eq('business_id', d.id);

  await db.from('audit_logs').insert({
    scope: 'admin',
    business_id: d.id,
    actor_user_id: ctx.userId,
    actor_name: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'business_updated',
    entity_type: 'businesses',
    entity_id: d.id,
    old_values: {
      name: existing.name,
      is_active: existing.is_active,
      subscription_status: existing.subscription_status,
      subscription_start_at: existing.subscription_start_at,
      subscription_end_at: existing.subscription_end_at,
    },
    new_values: bizPatch,
    description: d.actionNote || `${existing.name} işletmesi yönetici tarafından güncellendi.`,
  });

  return NextResponse.json({ business: updated });
}

export async function DELETE(req: NextRequest) {
  const { error, ctx, db } = await requireSystemAdmin();
  if (error || !ctx || !db) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = deleteBusinessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Silme onayı geçersiz.' }, { status: 400 });
  }

  const { id, confirmName } = parsed.data;
  const { data: biz } = await db.from('businesses').select('*').eq('id', id).maybeSingle();
  if (!biz) return NextResponse.json({ error: 'İşletme bulunamadı.' }, { status: 404 });

  if (biz.name.trim() !== confirmName.trim()) {
    return NextResponse.json(
      { error: 'Onay için yazdığınız işletme adı kayıtla eşleşmiyor.' },
      { status: 400 }
    );
  }

  // Hukuki/denetim amaçlı finansal özet arşivi sakla
  const [{ data: payments }, { data: incomes }, { data: expenses }, { data: sub }] =
    await Promise.all([
      db.from('payment_requests').select('*').eq('business_id', id),
      db.from('income_transactions').select('id, title, amount, transaction_date').eq('business_id', id),
      db.from('expense_transactions').select('id, title, amount, transaction_date').eq('business_id', id),
      db.from('subscriptions').select('*').eq('business_id', id).maybeSingle(),
    ]);

  await db.from('deleted_business_archives').insert({
    original_business_id: biz.id,
    business_name: biz.name,
    owner_email: biz.email,
    deleted_by: ctx.userId,
    snapshot: {
      business: biz,
      subscription: sub,
      payment_requests: payments ?? [],
      income_count: (incomes ?? []).length,
      expense_count: (expenses ?? []).length,
    },
  });

  await db.from('audit_logs').insert({
    scope: 'admin',
    business_id: null,
    actor_user_id: ctx.userId,
    actor_name: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'business_deleted',
    entity_type: 'businesses',
    entity_id: biz.id,
    old_values: { name: biz.name, business_code: biz.business_code, email: biz.email },
    description: `${biz.name} işletmesi denetim arşivi alınarak kalıcı olarak silindi.`,
  });

  const { error: delErr } = await db.from('businesses').delete().eq('id', id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
