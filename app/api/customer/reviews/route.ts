import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCustomerContext } from '@/lib/auth-server';

const createReviewSchema = z.object({
  appointmentId: z.string().uuid(),
  rating: z.coerce.number().int().min(1, 'En az 1 yıldız seçiniz.').max(5),
  comment: z.string().trim().min(5, 'Yorumunuz en az 5 karakter olmalıdır.').max(1000),
});

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireCustomerContext();
  if (error || !ctx || !db) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = createReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Yorum bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const { data: appt } = await db
    .from('appointments')
    .select('*')
    .eq('id', d.appointmentId)
    .eq('customer_user_id', ctx.userId)
    .maybeSingle();

  if (!appt) {
    return NextResponse.json({ error: 'Randevu bulunamadı.' }, { status: 404 });
  }

  if (appt.status !== 'completed') {
    return NextResponse.json(
      { error: 'Yalnızca tamamlanmış olarak işaretlenen randevular için yorum yapılabilir.' },
      { status: 400 }
    );
  }

  const { data: existingReview } = await db
    .from('appointment_reviews')
    .select('id')
    .eq('appointment_id', appt.id)
    .maybeSingle();

  if (existingReview) {
    return NextResponse.json(
      { error: 'Bu randevu için zaten bir değerlendirme yaptınız.' },
      { status: 409 }
    );
  }

  const { data: created, error: revErr } = await db
    .from('appointment_reviews')
    .insert({
      business_id: appt.business_id,
      appointment_id: appt.id,
      customer_user_id: ctx.userId,
      service_id: appt.service_id,
      staff_id: appt.staff_id,
      rating: d.rating,
      comment: d.comment,
      moderation_status: 'published',
    })
    .select('*')
    .single();

  if (revErr) {
    return NextResponse.json({ error: revErr.message }, { status: 500 });
  }

  await db.from('notifications').insert({
    business_id: appt.business_id,
    type: 'new_review',
    title: 'Yeni Müşteri Değerlendirmesi',
    message: `${appt.service_name_snapshot} hizmeti için ${d.rating} yıldızlı yeni bir yorum bırakıldı.`,
    link: '/panel/randevu/yorumlar',
    is_read: false,
  });

  return NextResponse.json({ review: created }, { status: 201 });
}
