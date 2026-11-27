import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth-server';
import {
  execute,
  isDatabaseConfigured,
  parseJsonField,
  query,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
  uuid,
  writeAuditLog,
} from '@/lib/db';
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
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'MySQL veritabanı yapılandırılmamış.' }, { status: 503 });
  }

  const ctx = await getAuthContext();
  if (!ctx || !ctx.business) {
    return NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 });
  }

  const [planRow, subscription, bankRows, requestRows] = await Promise.all([
    queryOne<Record<string, unknown>>('SELECT * FROM subscription_plans LIMIT 1'),
    queryOne<Record<string, unknown>>(
      'SELECT * FROM subscriptions WHERE business_id = ? ORDER BY created_at DESC LIMIT 1',
      [ctx.business.id]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM bank_accounts WHERE is_active = 1 ORDER BY is_default DESC, created_at ASC'
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM payment_requests WHERE business_id = ? ORDER BY created_at DESC',
      [ctx.business.id]
    ),
  ]);

  return NextResponse.json({
    business: ctx.business,
    isSubscriptionActive: ctx.isSubscriptionActive,
    plan: planRow
      ? {
          ...planRow,
          monthly_price: Number(planRow.monthly_price ?? 0),
          features: parseJsonField<string[]>(planRow.features, []),
          is_active: toBool(planRow.is_active),
        }
      : null,
    subscription,
    bankAccounts: bankRows.map((b) => ({
      ...b,
      is_active: toBool(b.is_active),
      is_default: toBool(b.is_default),
      created_at: toIsoString(b.created_at),
    })),
    requests: requestRows.map((r) => ({
      ...r,
      amount: Number(r.amount ?? 0),
      bank_snapshot: parseJsonField(r.bank_snapshot, {}),
      created_at: toIsoString(r.created_at),
      reviewed_at: toIsoString(r.reviewed_at),
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'MySQL veritabanı yapılandırılmamış.' }, { status: 503 });
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

  const pendingExisting = await queryOne<{ id: string }>(
    'SELECT id FROM payment_requests WHERE business_id = ? AND status = ? LIMIT 1',
    [ctx.business.id, 'pending']
  );

  if (pendingExisting) {
    return NextResponse.json(
      {
        error:
          'Zaten incelenmeyi bekleyen bir ödeme talebiniz bulunmaktadır. Aynı ödeme için tekrar talep gönderilemez.',
      },
      { status: 409 }
    );
  }

  const bankAccount = await queryOne<Record<string, unknown>>(
    'SELECT * FROM bank_accounts WHERE id = ? AND is_active = 1 LIMIT 1',
    [parsed.data.bankAccountId]
  );

  if (!bankAccount) {
    return NextResponse.json(
      { error: 'Seçilen banka hesabı aktif değil veya bulunamadı.' },
      { status: 400 }
    );
  }

  const [plan, subscription] = await Promise.all([
    queryOne<{ id: string }>('SELECT id FROM subscription_plans LIMIT 1'),
    queryOne<{ id: string }>(
      'SELECT id FROM subscriptions WHERE business_id = ? ORDER BY created_at DESC LIMIT 1',
      [ctx.business.id]
    ),
  ]);

  if (!plan) {
    return NextResponse.json({ error: 'Abonelik paketi bulunamadı.' }, { status: 500 });
  }

  const bankSnapshot = {
    bank_name: String(bankAccount.bank_name ?? ''),
    iban: String(bankAccount.iban ?? ''),
    account_holder: String(bankAccount.account_holder ?? ''),
    description: String(bankAccount.description ?? ''),
  };

  const reqId = uuid();
  const amount = roundCurrency(parsed.data.amount);
  const nowStr = toMySqlDateTime();

  await execute(
    `INSERT INTO payment_requests
     (id, business_id, subscription_id, plan_id, bank_account_id, bank_snapshot, payer_name, amount, payment_date, receipt_url, receipt_name, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      reqId,
      ctx.business.id,
      subscription?.id ?? null,
      plan.id,
      String(bankAccount.id),
      JSON.stringify(bankSnapshot),
      parsed.data.payerName,
      amount,
      parsed.data.paymentDate,
      parsed.data.receiptUrl ?? null,
      parsed.data.receiptName ?? null,
      nowStr,
    ]
  );

  await execute(
    'UPDATE businesses SET subscription_status = ?, updated_at = ? WHERE id = ?',
    ['pending_approval', nowStr, ctx.business.id]
  );

  if (subscription) {
    await execute('UPDATE subscriptions SET status = ? WHERE id = ?', [
      'pending_approval',
      subscription.id,
    ]);
  }

  await writeAuditLog({
    scope: 'business',
    businessId: ctx.business.id,
    actorUserId: ctx.userId,
    action: 'payment_request_submitted',
    entityType: 'payment_requests',
    entityId: reqId,
    newValues: { amount, payer_name: parsed.data.payerName },
    description: 'Havale/EFT ödeme bildirimi gönderildi.',
  });

  const created = await queryOne<Record<string, unknown>>(
    'SELECT * FROM payment_requests WHERE id = ? LIMIT 1',
    [reqId]
  );

  return NextResponse.json({ success: true, request: created }, { status: 201 });
}
