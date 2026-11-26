import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';

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
  const { error, ctx, db, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !db || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const { data: reviews } = await db
    .from('appointment_reviews')
    .select(
      '*, appointment:appointments(service_name_snapshot, staff_name_snapshot, appointment_date), profile:profiles!appointment_reviews_customer_user_id_fkey(first_name, last_name)'
    )
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  const list = (reviews ?? []).map((r) => {
    const prof = Array.isArray(r.profile) ? r.profile[0] : r.profile;
    const appt = Array.isArray(r.appointment) ? r.appointment[0] : r.appointment;
    return {
      ...r,
      customer_name: prof ? `${prof.first_name} ${prof.last_name}`.trim() : 'Müşteri',
      service_name: appt?.service_name_snapshot ?? '',
      staff_name: appt?.staff_name_snapshot ?? '',
      appointment_date: appt?.appointment_date ?? null,
    };
  });

  const visible = list.filter((r) => r.moderation_status !== 'hidden');
  const averageRating =
    visible.length > 0
      ? Math.round((visible.reduce((acc, r) => acc + Number(r.rating), 0) / visible.length) * 10) / 10
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
  const { error, ctx, db } = await requireBusinessBookingContext('booking.manage');
  if (error || !ctx || !db || !ctx.business) return error!;

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

  const { data: existing } = await db
    .from('appointment_reviews')
    .select('id, moderation_status')
    .eq('id', d.reviewId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'Yorum bulunamadı.' }, { status: 404 });
  }

  if (d.action === 'reply') {
    const { data: updated, error: updErr } = await db
      .from('appointment_reviews')
      .update({
        business_reply: d.businessReply,
        replied_at: new Date().toISOString(),
        replied_by: ctx.userId,
      })
      .eq('id', d.reviewId)
      .eq('business_id', businessId)
      .select('*')
      .single();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ review: updated });
  }

  // İşletme yorumu silemez veya puanı değiştiremez; yalnızca platform yöneticisine bildirebilir
  const { data: reported, error: repErr } = await db
    .from('appointment_reviews')
    .update({
      moderation_status: 'reported',
      report_reason: d.reportReason,
      reported_at: new Date().toISOString(),
      reported_by: ctx.userId,
    })
    .eq('id', d.reviewId)
    .eq('business_id', businessId)
    .select('*')
    .single();

  if (repErr) return NextResponse.json({ error: repErr.message }, { status: 500 });
  return NextResponse.json({ review: reported });
}
