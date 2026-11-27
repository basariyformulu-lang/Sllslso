import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import { execute, query, queryOne, toIsoString, toMySqlDateTime } from '@/lib/db';

const reviewActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('reply'),
    reviewId: z.string().uuid(),
    businessReply: z.string().trim().min(2, 'Yanıt metni giriniz.').max(1000),
  }),
  z.object({
    action: z.literal('report'),
    reviewId: z.string().uuid(),
    reportReason: z.string().trim().min(5, 'Bildirim sebebini en az 5 karakter yazınız.').max(500),
  }),
]);

export async function GET() {
  const { error, ctx, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const rows = await query<Record<string, unknown>>(
    `SELECT r.*, a.service_name_snapshot, a.staff_name_snapshot, a.appointment_date, a.customer_name AS appt_customer_name
     FROM appointment_reviews r
     LEFT JOIN appointments a ON a.id = r.appointment_id
     WHERE r.business_id = ?
     ORDER BY r.created_at DESC`,
    [businessId]
  );

  const list = rows.map((r) => ({
    ...r,
    rating: Number(r.rating),
    created_at: toIsoString(r.created_at),
    replied_at: toIsoString(r.replied_at),
    reported_at: toIsoString(r.reported_at),
    customer_name: String(r.customer_name || r.appt_customer_name || 'Müşteri'),
    service_name: String(r.service_name_snapshot ?? ''),
    staff_name: String(r.staff_name_snapshot ?? ''),
    appointment_date: r.appointment_date ?? null,
    moderation_status: String(r.moderation_status ?? 'published'),
  }));

  const visible = list.filter((r) => r.moderation_status !== 'hidden');
  const averageRating =
    visible.length > 0
      ? Math.round((visible.reduce((acc, r) => acc + Number(r.rating), 0) / visible.length) * 10) /
        10
      : 0;

  return NextResponse.json({
    readOnly,
    reviews: list,
    summary: {
      totalCount: visible.length,
      averageRating,
      reportedCount: list.filter((r) => r.moderation_status === 'reported').length,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.manage');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = reviewActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Yorum işlem bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const businessId = ctx.business.id;
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM appointment_reviews WHERE id = ? AND business_id = ? LIMIT 1',
    [d.reviewId, businessId]
  );

  if (!existing) {
    return NextResponse.json({ error: 'Yorum bulunamadı.' }, { status: 404 });
  }

  const nowStr = toMySqlDateTime();

  if (d.action === 'reply') {
    await execute(
      `UPDATE appointment_reviews
       SET business_reply = ?, replied_at = ?, replied_by = ?
       WHERE id = ? AND business_id = ?`,
      [d.businessReply, nowStr, ctx.userId, d.reviewId, businessId]
    );
    const updated = await queryOne<Record<string, unknown>>(
      'SELECT * FROM appointment_reviews WHERE id = ? LIMIT 1',
      [d.reviewId]
    );
    return NextResponse.json({ review: updated });
  }

  await execute(
    `UPDATE appointment_reviews
     SET moderation_status = 'reported', report_reason = ?, reported_at = ?, reported_by = ?
     WHERE id = ? AND business_id = ?`,
    [d.reportReason, nowStr, ctx.userId, d.reviewId, businessId]
  );
  const reported = await queryOne<Record<string, unknown>>(
    'SELECT * FROM appointment_reviews WHERE id = ? LIMIT 1',
    [d.reviewId]
  );
  return NextResponse.json({ review: reported });
}
