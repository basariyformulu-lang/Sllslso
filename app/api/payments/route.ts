import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth-server';
import { createServiceRoleSupabase, isServiceRoleConfigured } from '@/lib/supabase/server';
import { roundCurrency } from '@/lib/format';

const submitPaymentSchema = z.object({
  bankAccountId: z.string().uuid('Geçerli bir banka hesabı seçiniz.'),
  payerName: z.string().trim().min(2, 'Ödeme yapan kişi veya firma adını giriniz.').max(150),
  amount: z.coerce.number().positive('Gönderilen tutar sıfırdan büyük olmalıdır.'),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçerli bir ödeme tarihi giriniz.'),
  receiptUrl: z.string().max(2_000_000).optional().nullable(),
  receiptName: z.string().max(200).optional().nullable(),
});

export async function GET() {
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ error: 'Supabase yapılandırılmamış.' }, { status: 503 });
  }

  const ctx = await getAuthContext();
  if (!ctx || !ctx.business) {
    return NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 });
  }

  const db = createServiceRoleSupabase()!;
  const [{ data: plan }, { data: subscription }, { data: bankAccounts }, { data: requests }] =
    await Promise.all([
      db.from('subscription_plans').select('*').limit(1).maybeSingle(),
      db.from('subscriptions').select('*').eq('business_id', ctx.business.id).maybeSingle(),
      db
        .from('bank_accounts')
        .select('*')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true }),
      db
        .from('payment_requests')
        .select('*')
        .eq('business_id', ctx.business.id)
        .order('created_at', { ascending: false }),
    ]);

  return NextResponse.json({
    business: ctx.business,
    isSubscriptionActive: ctx.isSubscriptionActive,
    plan,
    subscription,
    bankAccounts: bankAccounts ?? [],
    requests: requests ?? [],
  });
}

export async function POST(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ error: 'Supabase yapılandırılmamış.' }, { status: 503 });
  }

  const ctx = await getAuthContext();
  if (!ctx || !ctx.business || !ctx.member) {
    return NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = submitPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Ödeme bilgilerini kontrol edin.' },
      { status: 400 }
    );
  }

  const db = createServiceRoleSupabase()!;
  const { data: pendingExisting } = await db
    .from('payment_requests')
    .select('id')
    .eq('business_id', ctx.business.id)
    .eq('status', 'pending')
    .maybeSingle();

  if (pendingExisting) {
    return NextResponse.json(
      {
        error:
          'Zaten incelenmeyi bekleyen bir ödeme talebiniz bulunmaktadır. Aynı ödeme için tekrar talep gönderilemez.',
      },
      { status: 409 }
    );
  }

  const { data: bankAccount } = await db
    .from('bank_accounts')
    .select('*')
    .eq('id', parsed.data.bankAccountId)
    .eq('is_active', true)
    .maybeSingle();

  if (!bankAccount) {
    return NextResponse.json(
      { error: 'Seçilen banka hesabı aktif değil veya bulunamadı.' },
      { status: 400 }
    );
  }

  const { data: plan } = await db.from('subscription_plans').select('*').limit(1).maybeSingle();
  const { data: subscription } = await db
    .from('subscriptions')
    .select('*')
    .eq('business_id', ctx.business.id)
    .maybeSingle();

  if (!plan) {
    return NextResponse.json({ error: 'Abonelik paketi bulunamadı.' }, { status: 500 });
  }

  // Banka bilgilerini talep anında snapshot olarak sakla
  const bankSnapshot = {
    bank_name: bankAccount.bank_name,
    iban: bankAccount.iban,
    account_holder: bankAccount.account_holder,
    description: bankAccount.description,
  };

  const { data: created, error: insertErr } = await db
    .from('payment_requests')
    .insert({
      business_id: ctx.business.id,
      subscription_id: subscription?.id ?? null,
      plan_id: plan.id,
      bank_account_id: bankAccount.id,
      bank_snapshot: bankSnapshot,
      payer_name: parsed.data.payerName,
      amount: roundCurrency(parsed.data.amount),
      payment_date: parsed.data.paymentDate,
      receipt_url: parsed.data.receiptUrl ?? null,
      receipt_name: parsed.data.receiptName ?? null,
      status: 'pending',
    })
    .select('*')
    .single();

  if (insertErr) {
    return NextResponse.json(
      { error: 'Ödeme talebi kaydedilemedi. Zaten bekleyen bir talebiniz olabilir.' },
      { status: 409 }
    );
  }

  await db
    .from('businesses')
    .update({ subscription_status: 'pending_approval', updated_at: new Date().toISOString() })
    .eq('id', ctx.business.id);

  if (subscription) {
    await db
      .from('subscriptions')
      .update({ status: 'pending_approval', updated_at: new Date().toISOString() })
      .eq('id', subscription.id);
  }

  await db.from('audit_logs').insert({
    scope: 'business',
    business_id: ctx.business.id,
    actor_user_id: ctx.userId,
    action: 'payment_request_submitted',
    entity_type: 'payment_requests',
    entity_id: created.id,
    new_values: { amount: created.amount, payer_name: created.payer_name },
    description: 'Havale/EFT ödeme bildirimi gönderildi.',
  });

  return NextResponse.json({ success: true, request: created }, { status: 201 });
}
