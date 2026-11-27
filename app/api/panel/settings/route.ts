import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
import {
  execute,
  parseJsonField,
  query,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
} from '@/lib/db';

const updateSettingsSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  phone: z.string().trim().max(30),
  businessName: z.string().trim().min(2).max(120).optional(),
  businessPhone: z.string().trim().max(30).optional(),
  businessAddress: z.string().trim().max(250).optional(),
});

export async function GET() {
  const { error, ctx } = await requireBusinessContext();
  if (error || !ctx || !ctx.business) return error!;

  const [profile, subscription, auditLogs, notifications] = await Promise.all([
    queryOne<Record<string, unknown>>(
      'SELECT id, first_name, last_name, phone, email, email_verified, phone_verified, created_at FROM profiles WHERE id = ? LIMIT 1',
      [ctx.userId]
    ),
    queryOne<Record<string, unknown>>(
      `SELECT s.*, sp.name AS p_name, sp.monthly_price AS p_monthly_price, sp.duration_days AS p_duration_days
       FROM subscriptions s
       LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
       WHERE s.business_id = ?
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [ctx.business.id]
    ),
    query<Record<string, unknown>>(
      `SELECT * FROM audit_logs
       WHERE business_id = ? AND scope = 'business'
       ORDER BY created_at DESC LIMIT 30`,
      [ctx.business.id]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM notifications WHERE business_id = ? ORDER BY created_at DESC LIMIT 20',
      [ctx.business.id]
    ),
  ]);

  return NextResponse.json({
    profile,
    business: ctx.business,
    member: ctx.member,
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
    auditLogs: auditLogs.map((l) => ({
      ...l,
      old_values: parseJsonField(l.old_values, null),
      new_values: parseJsonField(l.new_values, null),
      created_at: toIsoString(l.created_at),
    })),
    notifications: notifications.map((n) => ({
      ...n,
      is_read: toBool(n.is_read),
      created_at: toIsoString(n.created_at),
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx } = await requireBusinessContext();
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    'markNotificationsRead' in body &&
    (body as { markNotificationsRead?: boolean }).markNotificationsRead
  ) {
    await execute(
      'UPDATE notifications SET is_read = 1 WHERE business_id = ? AND is_read = 0',
      [ctx.business.id]
    );
    return NextResponse.json({ success: true });
  }

  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Profil bilgilerini kontrol ediniz.' }, { status: 400 });
  }

  const d = parsed.data;
  const nowStr = toMySqlDateTime();

  await execute(
    'UPDATE profiles SET first_name = ?, last_name = ?, phone = ?, updated_at = ? WHERE id = ?',
    [d.firstName, d.lastName, d.phone, nowStr, ctx.userId]
  );

  if (ctx.member?.is_owner && d.businessName) {
    await execute(
      'UPDATE businesses SET name = ?, phone = ?, address = ?, updated_at = ? WHERE id = ?',
      [
        d.businessName,
        d.businessPhone ?? ctx.business.phone,
        d.businessAddress ?? ctx.business.address,
        nowStr,
        ctx.business.id,
      ]
    );
  }

  return NextResponse.json({ success: true });
}
