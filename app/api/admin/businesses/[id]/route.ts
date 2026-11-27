import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashPassword } from '@/lib/auth-mysql';
import { requireSystemAdmin } from '@/lib/auth-server';
import {
  execute,
  parseJsonField,
  query,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
  writeAuditLog,
} from '@/lib/db';

const resetOwnerPasswordSchema = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(8, 'Yeni şifre en az 8 karakter olmalıdır.').max(100),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireSystemAdmin();
  if (error) return error;

  const { id } = await params;

  const [business, subscription, members, payments, auditLogs] = await Promise.all([
    queryOne<Record<string, unknown>>('SELECT * FROM businesses WHERE id = ? LIMIT 1', [id]),
    queryOne<Record<string, unknown>>(
      `SELECT s.*, sp.name AS p_name, sp.monthly_price AS p_monthly_price, sp.duration_days AS p_duration_days
       FROM subscriptions s
       LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
       WHERE s.business_id = ?
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [id]
    ),
    query<Record<string, unknown>>(
      `SELECT bm.*, p.first_name, p.last_name, p.email, p.phone,
              CASE WHEN p.password_hash IS NULL THEN 0 ELSE 1 END AS has_password
       FROM business_members bm
       LEFT JOIN profiles p ON p.id = bm.user_id
       WHERE bm.business_id = ?
       ORDER BY bm.is_owner DESC`,
      [id]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM payment_requests WHERE business_id = ? ORDER BY created_at DESC',
      [id]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM audit_logs WHERE business_id = ? ORDER BY created_at DESC LIMIT 30',
      [id]
    ),
  ]);

  if (!business) {
    return NextResponse.json({ error: 'İşletme bulunamadı.' }, { status: 404 });
  }

  return NextResponse.json({
    business: {
      ...business,
      is_active: toBool(business.is_active),
      booking_module_enabled: toBool(business.booking_module_enabled),
      subscription_start_at: toIsoString(business.subscription_start_at),
      subscription_end_at: toIsoString(business.subscription_end_at),
      created_at: toIsoString(business.created_at),
    },
    subscription: subscription
      ? {
          ...subscription,
          monthly_price: Number(subscription.monthly_price ?? 0),
          locked_price: Number(subscription.monthly_price ?? 0),
          start_at: toIsoString(subscription.start_at),
          end_at: toIsoString(subscription.end_at),
          plan: {
            id: subscription.plan_id,
            name: subscription.p_name ?? subscription.plan_name,
            monthly_price: Number(subscription.p_monthly_price ?? subscription.monthly_price ?? 0),
            duration_days: Number(subscription.p_duration_days ?? subscription.duration_days ?? 30),
          },
        }
      : null,
    members: members.map((m) => ({
      id: m.id,
      business_id: m.business_id,
      user_id: m.user_id,
      role_name: m.role_name,
      is_owner: toBool(m.is_owner),
      is_active: toBool(m.is_active),
      has_password: toBool(m.has_password),
      permissions: parseJsonField<string[]>(m.permissions, []),
      profile: {
        id: m.user_id,
        first_name: String(m.first_name ?? ''),
        last_name: String(m.last_name ?? ''),
        email: String(m.email ?? ''),
        phone: String(m.phone ?? ''),
      },
    })),
    payments: payments.map((p) => ({
      ...p,
      amount: Number(p.amount ?? 0),
      bank_snapshot: parseJsonField(p.bank_snapshot, {}),
      created_at: toIsoString(p.created_at),
    })),
    auditLogs: auditLogs.map((l) => ({
      ...l,
      old_values: parseJsonField(l.old_values, null),
      new_values: parseJsonField(l.new_values, null),
      created_at: toIsoString(l.created_at),
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireSystemAdmin();
  if (error || !ctx) return error!;

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = resetOwnerPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Bilgileri kontrol ediniz.' },
      { status: 400 }
    );
  }

  const member = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM business_members WHERE business_id = ? AND user_id = ? LIMIT 1',
    [id, parsed.data.userId]
  );
  if (!member) {
    return NextResponse.json({ error: 'Kullanıcı bu işletmeye ait değil.' }, { status: 404 });
  }

  await execute(
    'UPDATE profiles SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL, updated_at = ? WHERE id = ?',
    [hashPassword(parsed.data.newPassword), toMySqlDateTime(), parsed.data.userId]
  );

  await writeAuditLog({
    scope: 'admin',
    businessId: id,
    actorUserId: ctx.userId,
    actorName: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'member_password_reset_by_admin',
    entityType: 'profiles',
    entityId: parsed.data.userId,
    description: 'İşletme kullanıcısı şifresi sistem yöneticisi tarafından tanımlandı.',
  });

  return NextResponse.json({ success: true, message: 'Kullanıcı şifresi güncellendi.' });
}
