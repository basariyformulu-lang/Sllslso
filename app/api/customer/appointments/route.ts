import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { formatTimeHHMM, normalizePhoneTR } from '@/lib/booking-helpers';
import { rescheduleAppointmentAtomic } from '@/lib/booking-mysql';
import { dispatchAppointmentNotifications } from '@/lib/booking-notifications';
import { execute, query, queryOne, toIsoString, toMySqlDateTime, uuid } from '@/lib/db';
import { formatDateTR } from '@/lib/format';

const patchPhoneLookupSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('cancel'),
    phone: z.string().trim().min(10),
    appointmentId: z.string().uuid(),
    cancellationReason: z.string().trim().max(300).optional().default(''),
  }),
  z.object({
    action: z.literal('reschedule'),
    phone: z.string().trim().min(10),
    appointmentId: z.string().uuid(),
    appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    staffId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal('review'),
    phone: z.string().trim().min(10),
    appointmentId: z.string().uuid(),
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().min(3, 'Lütfen en az 3 karakter yorum yazınız.').max(1000),
  }),
]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone') || '';
  const phoneNorm = normalizePhoneTR(phone);

  if (phoneNorm.length < 10) {
    return NextResponse.json(
      { error: 'Lütfen 10 haneli cep telefonu numaranızı giriniz (ör. 05XX XXX XX XX).' },
      { status: 400 }
    );
  }

  const appointments = await query<Record<string, unknown>>(
    `SELECT a.*, b.name AS biz_name, bp.slug AS bp_slug, bp.page_title AS bp_title,
            bp.phone AS bp_phone, bp.address AS bp_address, bp.logo_url AS bp_logo,
            bp.cancellation_deadline_hours AS bp_deadline
     FROM appointments a
     LEFT JOIN businesses b ON b.id = a.business_id
     LEFT JOIN booking_pages bp ON bp.business_id = a.business_id
     WHERE a.customer_phone_normalized = ?
     ORDER BY a.start_at DESC`,
    [phoneNorm]
  );

  const reviews = await query<Record<string, unknown>>(
    'SELECT * FROM appointment_reviews WHERE customer_phone_normalized = ?',
    [phoneNorm]
  );

  const reviewByAppt = new Map<string, Record<string, unknown>>();
  reviews.forEach((r) => {
    reviewByAppt.set(String(r.appointment_id), {
      ...r,
      rating: Number(r.rating),
      created_at: toIsoString(r.created_at),
      replied_at: toIsoString(r.replied_at),
    });
  });

  const enrichedAppointments = appointments.map((a) => ({
    ...a,
    service_price_snapshot: Number(a.service_price_snapshot),
    paid_amount: Number(a.paid_amount),
    start_time: String(a.start_time).slice(0, 5),
    end_time: String(a.end_time).slice(0, 5),
    start_at: toIsoString(a.start_at),
    end_at: toIsoString(a.end_at),
    created_at: toIsoString(a.created_at),
    business: {
      id: String(a.business_id),
      name: String(a.bp_title || a.biz_name || 'İşletme'),
      booking_slug: a.bp_slug ? String(a.bp_slug) : null,
      phone: String(a.bp_phone ?? ''),
      address: String(a.bp_address ?? ''),
      logo_url: String(a.bp_logo ?? ''),
      cancellation_deadline_hours: Number(a.bp_deadline ?? 2),
    },
    review: reviewByAppt.get(String(a.id)) ?? null,
  }));

  return NextResponse.json({
    phone: phone.trim(),
    appointments: enrichedAppointments,
  });
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = patchPhoneLookupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'İşlem bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const phoneNorm = normalizePhoneTR(d.phone);
  if (phoneNorm.length < 10) {
    return NextResponse.json({ error: 'Geçerli cep telefonu numarası giriniz.' }, { status: 400 });
  }

  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM appointments WHERE id = ? AND customer_phone_normalized = ? LIMIT 1',
    [d.appointmentId, phoneNorm]
  );

  if (!existing) {
    return NextResponse.json(
      { error: 'Bu telefon numarasına ait randevu bulunamadı.' },
      { status: 404 }
    );
  }

  if (d.action === 'review') {
    if (existing.status !== 'completed') {
      return NextResponse.json(
        { error: 'Yalnızca tamamlanmış randevular için değerlendirme yapılabilir.' },
        { status: 403 }
      );
    }
    const dup = await queryOne<{ id: string }>(
      'SELECT id FROM appointment_reviews WHERE appointment_id = ? LIMIT 1',
      [existing.id]
    );
    if (dup) {
      return NextResponse.json(
        { error: 'Bu randevu için zaten yorum yaptınız.' },
        { status: 409 }
      );
    }

    const rawName = String(existing.customer_name || 'Müşteri').trim();
    const parts = rawName.split(/\s+/);
    const publicName =
      parts.length > 1
        ? `${parts[0]} ${parts[parts.length - 1].slice(0, 1)}.`
        : rawName || 'Müşteri';

    const reviewId = uuid();
    await execute(
      `INSERT INTO appointment_reviews
       (id, business_id, appointment_id, customer_user_id, customer_phone_normalized, customer_name,
        service_id, staff_id, rating, comment, moderation_status, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'published', ?)`,
      [
        reviewId,
        existing.business_id,
        existing.id,
        phoneNorm,
        publicName,
        existing.service_id ?? null,
        existing.staff_id ?? null,
        d.rating,
        d.comment,
        toMySqlDateTime(),
      ]
    );
    return NextResponse.json({ success: true, reviewId });
  }

  if (!['pending', 'confirmed'].includes(String(existing.status))) {
    return NextResponse.json(
      { error: 'Yalnızca bekleyen veya onaylı randevular üzerinde değişiklik yapılabilir.' },
      { status: 400 }
    );
  }

  const page = await queryOne<{ page_title: string; cancellation_deadline_hours: number }>(
    'SELECT page_title, cancellation_deadline_hours FROM booking_pages WHERE business_id = ? LIMIT 1',
    [existing.business_id]
  );

  const deadlineHours = Number(page?.cancellation_deadline_hours ?? 2);
  const startIso = toIsoString(existing.start_at);
  const startMs = startIso ? new Date(startIso).getTime() : 0;
  if (startMs - Date.now() < deadlineHours * 60 * 60 * 1000) {
    return NextResponse.json(
      {
        error: `Randevu saatine ${deadlineHours} saatten az kaldığı için online iptal/değişiklik yapılamaz. Lütfen işletme ile iletişime geçiniz.`,
      },
      { status: 400 }
    );
  }

  if (d.action === 'cancel') {
    await execute(
      `UPDATE appointments
       SET status = 'cancelled', cancelled_by = 'customer', cancellation_reason = ?, updated_at = ?
       WHERE id = ?`,
      [d.cancellationReason, toMySqlDateTime(), existing.id]
    );

    await dispatchAppointmentNotifications({
      businessId: String(existing.business_id),
      appointmentId: String(existing.id),
      customerPhone: String(existing.customer_phone ?? ''),
      type: 'appointment_cancelled',
      businessTitle: 'Müşteri Randevusunu İptal Etti',
      businessMessage: `${formatDateTR(String(existing.appointment_date))} saat ${formatTimeHHMM(String(existing.start_time))} (${existing.service_name_snapshot}) randevusu müşteri tarafından iptal edildi.`,
    });

    return NextResponse.json({ success: true });
  }

  try {
    const res = await rescheduleAppointmentAtomic({
      appointmentId: String(existing.id),
      businessId: String(existing.business_id),
      newDate: d.appointmentDate,
      newStartTime: d.startTime,
      newStaffId: d.staffId ?? null,
    });

    await dispatchAppointmentNotifications({
      businessId: String(existing.business_id),
      appointmentId: String(existing.id),
      customerPhone: String(existing.customer_phone ?? ''),
      type: 'appointment_rescheduled',
      businessTitle: 'Müşteri Randevu Saatini Değiştirdi',
      businessMessage: `${existing.service_name_snapshot} randevusu ${formatDateTR(d.appointmentDate)} saat ${d.startTime} tarihine alındı.`,
    });

    return NextResponse.json({ result: res });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Randevu saati güncellenemedi.' },
      { status: 409 }
    );
  }
}
