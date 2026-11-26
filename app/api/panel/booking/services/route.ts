import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import { roundCurrency } from '@/lib/format';
import { sanitizeExternalUrl } from '@/lib/booking-helpers';

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
  const { error, ctx, db, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !db || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const [{ data: services }, { data: staff }, { data: staffServices }] = await Promise.all([
    db
      .from('booking_services')
      .select('*')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('booking_staff')
      .select('id, full_name, is_active, avatar_url')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true }),
    db.from('staff_services').select('staff_id, service_id').eq('business_id', businessId),
  ]);

  const enriched = (services ?? []).map((s) => ({
    ...s,
    price: Number(s.price),
    discount_price: s.discount_price !== null ? Number(s.discount_price) : null,
    staff_ids: (staffServices ?? [])
      .filter((ss) => ss.service_id === s.id)
      .map((ss) => ss.staff_id),
  }));

  return NextResponse.json({
    readOnly,
    services: enriched,
    staff: staff ?? [],
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessBookingContext('booking.services');
  if (error || !ctx || !db || !ctx.business) return error!;

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

  const { count } = await db
    .from('booking_services')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.business.id);

  const { data: created, error: createErr } = await db
    .from('booking_services')
    .insert({
      business_id: ctx.business.id,
      name: d.name,
      description: d.description,
      image_url: sanitizeExternalUrl(d.imageUrl) ?? '',
      price,
      discount_price: discountPrice,
      duration_minutes: d.durationMinutes,
      sort_order: count ?? 0,
      is_active: d.isActive,
    })
    .select('*')
    .single();

  if (createErr || !created) {
    return NextResponse.json({ error: createErr?.message ?? 'Hizmet eklenemedi.' }, { status: 500 });
  }

  if (d.staffIds.length > 0) {
    const { data: validStaff } = await db
      .from('booking_staff')
      .select('id')
      .eq('business_id', ctx.business.id)
      .in('id', d.staffIds);
    const validIds = (validStaff ?? []).map((s) => s.id);
    if (validIds.length > 0) {
      await db.from('staff_services').insert(
        validIds.map((staffId) => ({
          business_id: ctx.business!.id,
          staff_id: staffId,
          service_id: created.id,
        }))
      );
    }
  }

  return NextResponse.json({ service: created }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessBookingContext('booking.services');
  if (error || !ctx || !db || !ctx.business) return error!;

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

  if (d.action === 'reorder') {
    await Promise.all(
      d.orderedIds.map((id, idx) =>
        db
          .from('booking_services')
          .update({ sort_order: idx, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('business_id', ctx.business!.id)
      )
    );
    return NextResponse.json({ success: true });
  }

  if (d.action === 'toggle_active') {
    const { error: err } = await db
      .from('booking_services')
      .update({ is_active: d.isActive, updated_at: new Date().toISOString() })
      .eq('id', d.id)
      .eq('business_id', ctx.business.id);
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });
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

  const { data: updated, error: updErr } = await db
    .from('booking_services')
    .update({
      name: d.name,
      description: d.description,
      image_url: sanitizeExternalUrl(d.imageUrl) ?? '',
      price,
      discount_price: discountPrice,
      duration_minutes: d.durationMinutes,
      is_active: d.isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', d.id)
    .eq('business_id', ctx.business.id)
    .select('*')
    .maybeSingle();

  if (updErr || !updated) {
    return NextResponse.json({ error: 'Hizmet güncellenemedi.' }, { status: 400 });
  }

  if (d.staffIds !== undefined) {
    await db
      .from('staff_services')
      .delete()
      .eq('business_id', ctx.business.id)
      .eq('service_id', d.id);

    if (d.staffIds.length > 0) {
      const { data: validStaff } = await db
        .from('booking_staff')
        .select('id')
        .eq('business_id', ctx.business.id)
        .in('id', d.staffIds);
      const validIds = (validStaff ?? []).map((s) => s.id);
      if (validIds.length > 0) {
        await db.from('staff_services').insert(
          validIds.map((staffId) => ({
            business_id: ctx.business!.id,
            staff_id: staffId,
            service_id: d.id,
          }))
        );
      }
    }
  }

  return NextResponse.json({ service: updated });
}

export async function DELETE(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessBookingContext('booking.services');
  if (error || !ctx || !db || !ctx.business) return error!;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Hizmet kimliği gerekli.' }, { status: 400 });

  const { error: delErr } = await db
    .from('booking_services')
    .delete()
    .eq('id', id)
    .eq('business_id', ctx.business.id);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
