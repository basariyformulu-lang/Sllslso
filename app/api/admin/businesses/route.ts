import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';
import {
  execute,
  query,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
  withTransaction,
  writeAuditLog,
} from '@/lib/db';
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
  const { error } = await requireSystemAdmin();
  if (error) return error;

  const [businesses, owners, subscriptions, payments] = await Promise.all([
    query<Record<string, unknown>>('SELECT * FROM businesses ORDER BY created_at DESC'),
    query<{
      business_id: string;
      user_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    }>(
      `SELECT bm.business_id, bm.user_id, p.first_name, p.last_name, p.email, p.phone
       FROM business_members bm
       LEFT JOIN profiles p ON p.id = bm.user_id
       WHERE bm.is_owner = 1`
    ),
    query<Record<string, unknown>>('SELECT * FROM subscriptions'),
    query<{ business_id: string; payment_date: string; amount: number }>(
      `SELECT business_id, payment_date, amount
       FROM payment_requests
       WHERE status = 'approved'
       ORDER BY payment_date DESC`
    ),
  ]);

  const enriched = businesses.map((b) => {
    const bizId = String(b.id);
    const owner = owners.find((o) => o.business_id === bizId);
    const sub = subscriptions.find((s) => String(s.business_id) === bizId) ?? null;
    const lastPayment = payments.find((p) => p.business_id === bizId);
    return {
      ...b,
      is_active: toBool(b.is_active),
      booking_module_enabled: toBool(b.booking_module_enabled),
      subscription_start_at: toIsoString(b.subscription_start_at),
      subscription_end_at: toIsoString(b.subscription_end_at),
      created_at: toIsoString(b.created_at),
      owner_name: owner
        ? `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim() || '—'
        : '—',
      owner_email: owner?.email ?? String(b.email ?? ''),
      subscription: sub
        ? {
            ...sub,
            monthly_price: Number(sub.monthly_price ?? 0),
            locked_price: Number(sub.monthly_price ?? 0),
          }
        : null,
      last_payment_date: lastPayment?.payment_date ?? null,
    };
  });

  return NextResponse.json({ businesses: enriched });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx } = await requireSystemAdmin();
  if (error || !ctx) return error!;

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
  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM businesses WHERE id = ? LIMIT 1',
    [d.id]
  );

  if (!existing) {
    return NextResponse.json({ error: 'İşletme bulunamadı.' }, { status: 404 });
  }

  let nextStartIso =
    d.subscriptionStartAt !== undefined
      ? d.subscriptionStartAt
      : toIsoString(existing.subscription_start_at);
  let nextEndIso =
    d.subscriptionEndAt !== undefined
      ? d.subscriptionEndAt
      : toIsoString(existing.subscription_end_at);
  let nextSubStatus = d.subscriptionStatus ?? String(existing.subscription_status);

  if (d.extendDays) {
    const existingEnd = toIsoString(existing.subscription_end_at);
    const baseDate =
      existingEnd && new Date(existingEnd).getTime() > Date.now()
        ? new Date(existingEnd)
        : new Date();
    if (!nextStartIso) nextStartIso = new Date().toISOString();
    nextEndIso = new Date(baseDate.getTime() + d.extendDays * 24 * 60 * 60 * 1000).toISOString();
    nextSubStatus = 'active';
  }

  const startSql = nextStartIso ? toMySqlDateTime(new Date(nextStartIso)) : null;
  const endSql = nextEndIso ? toMySqlDateTime(new Date(nextEndIso)) : null;
  const nowStr = toMySqlDateTime();

  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE businesses
       SET name = ?, phone = ?, email = ?, address = ?, is_active = ?,
           subscription_status = ?, subscription_start_at = ?, subscription_end_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        d.name ?? String(existing.name),
        d.phone ?? String(existing.phone ?? ''),
        d.email ?? String(existing.email ?? ''),
        d.address ?? String(existing.address ?? ''),
        d.isActive !== undefined ? (d.isActive ? 1 : 0) : toBool(existing.is_active) ? 1 : 0,
        nextSubStatus,
        startSql,
        endSql,
        nowStr,
        d.id,
      ]
    );

    if (d.lockedPrice !== undefined) {
      await conn.execute(
        `UPDATE subscriptions
         SET status = ?, start_at = ?, end_at = ?, monthly_price = ?
         WHERE business_id = ?`,
        [nextSubStatus, startSql, endSql, roundCurrency(d.lockedPrice), d.id]
      );
    } else {
      await conn.execute(
        `UPDATE subscriptions SET status = ?, start_at = ?, end_at = ? WHERE business_id = ?`,
        [nextSubStatus, startSql, endSql, d.id]
      );
    }
  });

  const updated = await queryOne<Record<string, unknown>>(
    'SELECT * FROM businesses WHERE id = ? LIMIT 1',
    [d.id]
  );

  await writeAuditLog({
    scope: 'admin',
    businessId: d.id,
    actorUserId: ctx.userId,
    actorName: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'business_updated',
    entityType: 'businesses',
    entityId: d.id,
    old_values: {
      name: existing.name,
      is_active: toBool(existing.is_active),
      subscription_status: existing.subscription_status,
    },
    new_values: {
      name: d.name ?? existing.name,
      is_active: d.isActive ?? toBool(existing.is_active),
      subscription_status: nextSubStatus,
      subscription_end_at: nextEndIso,
    },
    description: d.actionNote || `${String(existing.name)} işletmesi yönetici tarafından güncellendi.`,
  } as Parameters<typeof writeAuditLog>[0]);

  return NextResponse.json({
    business: updated
      ? {
          ...updated,
          is_active: toBool(updated.is_active),
          subscription_start_at: toIsoString(updated.subscription_start_at),
          subscription_end_at: toIsoString(updated.subscription_end_at),
        }
      : null,
  });
}

export async function DELETE(req: NextRequest) {
  const { error, ctx } = await requireSystemAdmin();
  if (error || !ctx) return error!;

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
  const biz = await queryOne<Record<string, unknown>>(
    'SELECT * FROM businesses WHERE id = ? LIMIT 1',
    [id]
  );
  if (!biz) return NextResponse.json({ error: 'İşletme bulunamadı.' }, { status: 404 });

  if (String(biz.name).trim() !== confirmName.trim()) {
    return NextResponse.json(
      { error: 'Onay için yazdığınız işletme adı kayıtla eşleşmiyor.' },
      { status: 400 }
    );
  }

  await writeAuditLog({
    scope: 'admin',
    businessId: null,
    actorUserId: ctx.userId,
    actorName: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'business_deleted',
    entityType: 'businesses',
    entityId: id,
    oldValues: {
      name: biz.name,
      business_code: biz.business_code,
      email: biz.email,
    },
    description: `${String(biz.name)} işletmesi yönetici tarafından kalıcı olarak silindi.`,
  });

  await execute('DELETE FROM businesses WHERE id = ?', [id]);

  return NextResponse.json({ success: true });
}
