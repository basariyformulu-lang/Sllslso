import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { normalizePhoneTR } from '@/lib/booking-helpers';
import { execute, query, queryOne, toMySqlDateTime, uuid } from '@/lib/db';

const phoneReviewSchema = z.object({
  phone: z.string().trim().min(10, 'Geçerli bir cep telefonu numarası giriniz.').max(25),
  appointmentId: z.string().uuid().optional(),
  rating: z.coerce.number().int().min(1, 'En az 1 yıldız veriniz.').max(5),
  comment: z.string().trim().min(3, 'Lütfen kısa bir yorum yazınız.').max(1000),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { searchParams } = new URL(req.url);
  const phoneNorm = normalizePhoneTR(searchParams.get('phone'));

  if (phoneNorm.length < 10) {
    return NextResponse.json(
      { error: 'Lütfen 10 haneli cep telefonu numaranızı giriniz.' },
      { status: 400 }
    );
  }

  const page = await queryOne<{ business_id: string }>(
    'SELECT business_id FROM booking_pages WHERE slug = ? LIMIT 1',
    [slug.toLowerCase()]
  );
  if (!page) {
    return NextResponse.json({ error: 'İşletme bulunamadı.' }, { status: 404 });
  }

  const eligibleAppointments = await query<{
    id: string;
    service_name_snapshot: string;
    staff_name_snapshot: string;
    appointment_date: string;
    start_time: string;
    customer_name: string;
  }>(
    `SELECT a.id, a.service_name_snapshot, a.staff_name_snapshot, a.appointment_date, a.start_time, a.customer_name
     FROM appointments a
     LEFT JOIN appointment_reviews r ON r.appointment_id = a.id
     WHERE a.business_id = ?
       AND a.customer_phone_normalized = ?
       AND a.status = 'completed'
       AND r.id IS NULL
     ORDER BY a.appointment_date DESC, a.start_time DESC`,
    [page.business_id, phoneNorm]
  );

  const anyAppt = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM appointments
     WHERE business_id = ? AND customer_phone_normalized = ?
     ORDER BY appointment_date DESC LIMIT 1`,
    [page.business_id, phoneNorm]
  );

  return NextResponse.json({
    eligibleAppointments: eligibleAppointments.map((a) => ({
      ...a,
      start_time: String(a.start_time).slice(0, 5),
    })),
    hasAnyAppointment: Boolean(anyAppt),
    latestAppointmentStatus: anyAppt?.status ?? null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = phoneReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Değerlendirme bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const phoneNorm = normalizePhoneTR(d.phone);
  if (phoneNorm.length < 10) {
    return NextResponse.json(
      { error: 'Geçerli bir cep telefonu numarası giriniz.' },
      { status: 400 }
    );
  }

  const page = await queryOne<{ business_id: string }>(
    'SELECT business_id FROM booking_pages WHERE slug = ? LIMIT 1',
    [slug.toLowerCase()]
  );
  if (!page) {
    return NextResponse.json({ error: 'İşletme bulunamadı.' }, { status: 404 });
  }

  const appt = d.appointmentId
    ? await queryOne<Record<string, unknown>>(
        `SELECT * FROM appointments
         WHERE id = ? AND business_id = ? AND customer_phone_normalized = ?
         LIMIT 1`,
        [d.appointmentId, page.business_id, phoneNorm]
      )
    : await queryOne<Record<string, unknown>>(
        `SELECT a.*
         FROM appointments a
         LEFT JOIN appointment_reviews r ON r.appointment_id = a.id
         WHERE a.business_id = ?
           AND a.customer_phone_normalized = ?
           AND a.status = 'completed'
           AND r.id IS NULL
         ORDER BY a.appointment_date DESC, a.start_time DESC
         LIMIT 1`,
        [page.business_id, phoneNorm]
      );

  if (!appt) {
    const anyAppt = await queryOne<{ status: string }>(
      `SELECT status FROM appointments
       WHERE business_id = ? AND customer_phone_normalized = ?
       ORDER BY appointment_date DESC LIMIT 1`,
      [page.business_id, phoneNorm]
    );
    if (!anyAppt) {
      return NextResponse.json(
        {
          error:
            'Bu telefon numarası ile işletmemizde tamamlanmış bir randevu bulunamadı. Yalnızca randevusunu tamamlamış müşteriler değerlendirme yapabilir.',
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      {
        error:
          anyAppt.status === 'completed'
            ? 'Tamamlanan randevunuz için zaten değerlendirme yaptınız.'
            : 'Randevunuz işletme tarafından "Tamamlandı" olarak işaretlendikten sonra puanlama yapabilirsiniz.',
      },
      { status: 403 }
    );
  }

  if (appt.status !== 'completed') {
    return NextResponse.json(
      {
        error:
          'Yalnızca tamamlanmış (hizmeti alınmış) randevular için puanlama ve yorum yapılabilir.',
      },
      { status: 403 }
    );
  }

  const existingReview = await queryOne<{ id: string }>(
    'SELECT id FROM appointment_reviews WHERE appointment_id = ? LIMIT 1',
    [appt.id]
  );
  if (existingReview) {
    return NextResponse.json(
      { error: 'Bu randevu için zaten bir değerlendirme gönderdiniz.' },
      { status: 409 }
    );
  }

  const reviewId = uuid();
  const nowStr = toMySqlDateTime();
  const rawName = String(appt.customer_name || 'Müşteri').trim();
  const parts = rawName.split(/\s+/);
  const publicName =
    parts.length > 1
      ? `${parts[0]} ${parts[parts.length - 1].slice(0, 1)}.`
      : rawName || 'Müşteri';

  await execute(
    `INSERT INTO appointment_reviews
     (id, business_id, appointment_id, customer_user_id, customer_phone_normalized, customer_name,
      service_id, staff_id, rating, comment, moderation_status, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'published', ?)`,
    [
      reviewId,
      page.business_id,
      appt.id,
      phoneNorm,
      publicName,
      appt.service_id ?? null,
      appt.staff_id ?? null,
      d.rating,
      d.comment,
      nowStr,
    ]
  );

  return NextResponse.json(
    {
      review: {
        id: reviewId,
        rating: d.rating,
        comment: d.comment,
        customer_name: publicName,
        service_name: String(appt.service_name_snapshot ?? ''),
        staff_name: String(appt.staff_name_snapshot ?? ''),
        created_at: new Date().toISOString(),
        business_reply: null,
      },
    },
    { status: 201 }
  );
}
