import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import { sanitizeExternalUrl } from '@/lib/booking-helpers';
import { execute, query, queryOne, toBool, toIsoString, toMySqlDateTime, uuid } from '@/lib/db';
import { roundCurrency } from '@/lib/format';

const serviceSchema = z.object({
  name: z.string().trim().min(2, 'Hizmet adı giriniz.').max(140),
  description: z.string().trim().max(600).optional().default(''),
  imageUrl: z.string().max(2_000_000).optional().default(''),
  price: z.coerce.number().min(0, 'Fiyat negatif olamaz.'),
  discountPrice: z.union([z.coerce.number().min(0), z.literal(''), z.null()]).optional(),
  durationMinutes: z.coerce.number().int().min(5, 'Süre en az 5 dakika olmalıdır.').max(480),
  isActive: z.boolean().optional().default(true),
  staffIds: z.array(z.string().uuid()).optional().default([]),
});

const patchServiceSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    id: z.string().uuid(),
    name: z.string().trim().min(2).max(140),
    description: z.string().trim().max(600).optional().default(''),
    imageUrl: z.string().max(2_000_000).optional().default(''),
    price: z.coerce.number().min(0),
    discountPrice: z.union([z.coerce.number().min(0), z.literal(''), z.null()]).optional(),
    durationMinutes: z.coerce.number().int().min(5).max(480),
    isActive: z.boolean(),
    staffIds: z.array(z.string().uuid()).optional(),
  }),
  z.object({
    action: z.literal('toggle_active'),
    id: z.string().uuid(),
    isActive: z.boolean(),
  }),
  z.object({
    action: z.literal('reorder'),
    orderedIds: z.array(z.string().uuid()).min(1),
  }),
]);

export async function GET() {
  const { error, ctx, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const [services, staff, staffServices] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM booking_services WHERE business_id = ? ORDER BY sort_order ASC, created_at ASC',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT id, full_name, is_active, avatar_url FROM booking_staff WHERE business_id = ? ORDER BY sort_order ASC',
      [businessId]
    ),
    query<{ staff_id: string; service_id: string }>(
      'SELECT staff_id, service_id FROM staff_services WHERE business_id = ?',
      [businessId]
    ),
  ]);

  const enriched = services.map((s) => ({
    ...s,
    price: Number(s.price),
    discount_price: s.discount_price !== null ? Number(s.discount_price) : null,
    is_active: toBool(s.is_active),
    created_at: toIsoString(s.created_at),
    staff_ids: staffServices.filter((ss) => ss.service_id === s.id).map((ss) => ss.staff_id),
  }));

  return NextResponse.json({
    readOnly,
    services: enriched,
    staff: staff.map((st) => ({ ...st, is_active: toBool(st.is_active) })),
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.services');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = serviceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Hizmet bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const price = roundCurrency(d.price);
  const discountPrice =
    d.discountPrice !== undefined && d.discountPrice !== null && d.discountPrice !== ''
      ? roundCurrency(d.discountPrice)
      : null;

  if (discountPrice !== null && discountPrice > price) {
    return NextResponse.json(
      { error: 'İndirimli fiyat normal fiyattan yüksek olamaz.' },
      { status: 400 }
    );
  }

  const cntRow = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM booking_services WHERE business_id = ?',
    [ctx.business.id]
  );

  const id = uuid();
  const nowStr = toMySqlDateTime();
  await execute(
    `INSERT INTO booking_services
     (id, business_id, name, description, image_url, price, discount_price, duration_minutes, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      ctx.business.id,
      d.name,
      d.description,
      sanitizeExternalUrl(d.imageUrl) ?? '',
      price,
      discountPrice,
      d.durationMinutes,
      Number(cntRow?.cnt ?? 0),
      d.isActive ? 1 : 0,
      nowStr,
      nowStr,
    ]
  );

  if (d.staffIds.length > 0) {
    const allStaff = await query<{ id: string }>(
      'SELECT id FROM booking_staff WHERE business_id = ?',
      [ctx.business.id]
    );
    const allowed = new Set(allStaff.map((s) => s.id));
    for (const staffId of d.staffIds) {
      if (allowed.has(staffId)) {
        await execute(
          'INSERT IGNORE INTO staff_services (business_id, staff_id, service_id) VALUES (?, ?, ?)',
          [ctx.business.id, staffId, id]
        );
      }
    }
  }

  const created = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_services WHERE id = ? LIMIT 1',
    [id]
  );

  return NextResponse.json(
    {
      service: created
        ? {
            ...created,
            price: Number(created.price),
            discount_price: created.discount_price !== null ? Number(created.discount_price) : null,
            is_active: toBool(created.is_active),
          }
        : null,
    },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.services');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = patchServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Hizmet verileri geçersiz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const nowStr = toMySqlDateTime();

  if (d.action === 'reorder') {
    await Promise.all(
      d.orderedIds.map((id, idx) =>
        execute(
          'UPDATE booking_services SET sort_order = ?, updated_at = ? WHERE id = ? AND business_id = ?',
          [idx, nowStr, id, ctx.business!.id]
        )
      )
    );
    return NextResponse.json({ success: true });
  }

  if (d.action === 'toggle_active') {
    await execute(
      'UPDATE booking_services SET is_active = ?, updated_at = ? WHERE id = ? AND business_id = ?',
      [d.isActive ? 1 : 0, nowStr, d.id, ctx.business.id]
    );
    return NextResponse.json({ success: true });
  }

  const price = roundCurrency(d.price);
  const discountPrice =
    d.discountPrice !== undefined && d.discountPrice !== null && d.discountPrice !== ''
      ? roundCurrency(d.discountPrice)
      : null;

  if (discountPrice !== null && discountPrice > price) {
    return NextResponse.json(
      { error: 'İndirimli fiyat normal fiyattan yüksek olamaz.' },
      { status: 400 }
    );
  }

  const res = await execute(
    `UPDATE booking_services
     SET name = ?, description = ?, image_url = ?, price = ?, discount_price = ?, duration_minutes = ?, is_active = ?, updated_at = ?
     WHERE id = ? AND business_id = ?`,
    [
      d.name,
      d.description,
      sanitizeExternalUrl(d.imageUrl) ?? '',
      price,
      discountPrice,
      d.durationMinutes,
      d.isActive ? 1 : 0,
      nowStr,
      d.id,
      ctx.business.id,
    ]
  );

  if (res.affectedRows === 0) {
    return NextResponse.json({ error: 'Hizmet güncellenemedi.' }, { status: 400 });
  }

  if (d.staffIds !== undefined) {
    await execute('DELETE FROM staff_services WHERE business_id = ? AND service_id = ?', [
      ctx.business.id,
      d.id,
    ]);
    if (d.staffIds.length > 0) {
      const allStaff = await query<{ id: string }>(
        'SELECT id FROM booking_staff WHERE business_id = ?',
        [ctx.business.id]
      );
      const allowed = new Set(allStaff.map((s) => s.id));
      for (const staffId of d.staffIds) {
        if (allowed.has(staffId)) {
          await execute(
            'INSERT IGNORE INTO staff_services (business_id, staff_id, service_id) VALUES (?, ?, ?)',
            [ctx.business.id, staffId, d.id]
          );
        }
      }
    }
  }

  const updated = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_services WHERE id = ? LIMIT 1',
    [d.id]
  );
  return NextResponse.json({
    service: updated
      ? {
          ...updated,
          price: Number(updated.price),
          discount_price: updated.discount_price !== null ? Number(updated.discount_price) : null,
          is_active: toBool(updated.is_active),
        }
      : null,
  });
}

export async function DELETE(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.services');
  if (error || !ctx || !ctx.business) return error!;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Hizmet kimliği gerekli.' }, { status: 400 });

  await execute('DELETE FROM booking_services WHERE id = ? AND business_id = ?', [
    id,
    ctx.business.id,
  ]);
  return NextResponse.json({ success: true });
}
