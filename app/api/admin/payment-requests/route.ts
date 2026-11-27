import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';
import {
  parseJsonField,
  query,
  toIsoString,
  toMySqlDateTime,
  uuid,
  withTransaction,
  writeAuditLog,
} from '@/lib/db';

const reviewSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    requestId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    action: z.literal('reject'),
    requestId: z.string().uuid(),
    rejectedReason: z.string().trim().min(3, 'Reddetme sebebini yazınız.').max(300),
  }),
]);

export async function GET() {
  const { error } = await requireSystemAdmin();
  if (error) return error;

  const rows = await query<Record<string, unknown>>(
    `SELECT pr.*, b.name AS b_name, b.business_code AS b_code, b.email AS b_email, b.phone AS b_phone,
            sp.name AS sp_name, sp.monthly_price AS sp_price
     FROM payment_requests pr
     LEFT JOIN businesses b ON b.id = pr.business_id
     LEFT JOIN subscription_plans sp ON sp.id = pr.plan_id
     ORDER BY pr.created_at DESC`
  );

  const requests = rows.map((r) => ({
    ...r,
    amount: Number(r.amount ?? 0),
    bank_snapshot: parseJsonField(r.bank_snapshot, {}),
    created_at: toIsoString(r.created_at),
    reviewed_at: toIsoString(r.reviewed_at),
    businesses: r.b_name
      ? {
          name: r.b_name,
          business_code: r.b_code,
          email: r.b_email,
          phone: r.b_phone,
        }
      : undefined,
    plan: r.sp_name
      ? {
          name: r.sp_name,
          monthly_price: Number(r.sp_price ?? 0),
        }
      : undefined,
  }));

  return NextResponse.json({ requests });
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

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'İşlem bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const nowStr = toMySqlDateTime();

  try {
    await withTransaction(async (conn) => {
      const [rows] = await conn.execute(
        'SELECT * FROM payment_requests WHERE id = ? FOR UPDATE',
        [payload.requestId]
      );
      const reqRow = (rows as Array<Record<string, unknown>>)[0];
      if (!reqRow) {
        throw new Error('NOT_FOUND:Ödeme talebi bulunamadı.');
      }
      if (reqRow.status !== 'pending') {
        throw new Error('CONFLICT:Bu ödeme talebi zaten sonuçlandırılmış.');
      }

      const businessId = String(reqRow.business_id);

      if (payload.action === 'approve') {
        const startSql = `${payload.startDate} 00:00:00.000`;
        const endSql = `${payload.endDate} 23:59:59.000`;

        await conn.execute(
          `UPDATE payment_requests
           SET status = 'approved', reviewed_by = ?, reviewed_at = ?
           WHERE id = ?`,
          [ctx.userId, nowStr, payload.requestId]
        );

        await conn.execute(
          `UPDATE businesses
           SET subscription_status = 'active', is_active = 1,
               subscription_start_at = ?, subscription_end_at = ?, updated_at = ?
           WHERE id = ?`,
          [startSql, endSql, nowStr, businessId]
        );

        await conn.execute(
          `UPDATE subscriptions
           SET status = 'active', start_at = ?, end_at = ?
           WHERE business_id = ?`,
          [startSql, endSql, businessId]
        );

        await conn.execute(
          `INSERT INTO notifications (id, business_id, recipient_user_id, type, title, message, link, is_read, created_at)
           VALUES (?, ?, NULL, 'payment_approved', 'Aboneliğiniz Aktif Edildi', ?, '/panel', 0, ?)`,
          [
            uuid(),
            businessId,
            `Ödeme talebiniz onaylandı. Aboneliğiniz ${payload.endDate} tarihine kadar aktiftir.`,
            nowStr,
          ]
        );
      } else {
        await conn.execute(
          `UPDATE payment_requests
           SET status = 'rejected', rejected_reason = ?, reviewed_by = ?, reviewed_at = ?
           WHERE id = ?`,
          [payload.rejectedReason, ctx.userId, nowStr, payload.requestId]
        );

        await conn.execute(
          `UPDATE businesses SET subscription_status = 'payment_pending', updated_at = ? WHERE id = ?`,
          [nowStr, businessId]
        );

        await conn.execute(
          `UPDATE subscriptions SET status = 'payment_pending' WHERE business_id = ?`,
          [businessId]
        );

        await conn.execute(
          `INSERT INTO notifications (id, business_id, recipient_user_id, type, title, message, link, is_read, created_at)
           VALUES (?, ?, NULL, 'payment_rejected', 'Ödeme Talebi Reddedildi', ?, '/odeme', 0, ?)`,
          [
            uuid(),
            businessId,
            `Ödeme bildiriminiz reddedildi. Sebep: ${payload.rejectedReason}`,
            nowStr,
          ]
        );
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'İşlem başarısız.';
    if (msg.startsWith('NOT_FOUND:')) {
      return NextResponse.json({ error: msg.slice(10) }, { status: 404 });
    }
    if (msg.startsWith('CONFLICT:')) {
      return NextResponse.json({ error: msg.slice(9) }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await writeAuditLog({
    scope: 'admin',
    actorUserId: ctx.userId,
    actorName: ctx.adminName ?? 'Sistem Yöneticisi',
    action: payload.action === 'approve' ? 'payment_approved' : 'payment_rejected',
    entityType: 'payment_requests',
    entityId: payload.requestId,
    newValues: payload,
    description:
      payload.action === 'approve'
        ? `Ödeme talebi onaylandı (${payload.startDate} - ${payload.endDate}).`
        : `Ödeme talebi reddedildi: ${payload.rejectedReason}`,
  });

  return NextResponse.json({ success: true });
}
