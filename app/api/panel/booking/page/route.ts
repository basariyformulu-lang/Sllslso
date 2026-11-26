import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_SECTION_VISIBILITY,
  sanitizeExternalUrl,
  slugifyBookingTitle,
} from '@/lib/booking-helpers';

const businessHourSchema = z.object({
  day: z.number().int().min(0).max(6),
  label: z.string().trim().min(1).max(30),
  open: z.string().regex(/^\d{2}:\d{2}$/),
  close: z.string().regex(/^\d{2}:\d{2}$/),
  is_open: z.boolean(),
});

const galleryItemSchema = z.object({
  id: z.string().min(1).max(80),
  url: z.string().min(1).max(2_000_000),
  caption: z.string().max(160).optional().default(''),
  sort_order: z.number().int().min(0),
});

const updatePageSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2, 'Bağlantı adı en az 2 karakter olmalıdır.')
    .max(60)
    .optional(),
  page_title: z.string().trim().min(2, 'İşletme başlığı giriniz.').max(140).optional(),
  description: z.string().trim().max(1500).optional(),
  logo_url: z.string().max(2_000_000).optional(),
  cover_image_url: z.string().max(2_000_000).optional(),
  gallery_images: z.array(galleryItemSchema).max(20).optional(),
  phone: z.string().trim().max(40).optional(),
  whatsapp: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  map_location: z.string().trim().max(500).optional(),
  instagram_url: z.string().trim().max(300).optional(),
  theme_preset: z
    .enum(['classic_navy', 'botanical_emerald', 'warm_atelier', 'minimal_mono', 'soft_rose'])
    .optional(),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  section_visibility: z
    .object({
      hero: z.boolean(),
      services: z.boolean(),
      staff: z.boolean(),
      gallery: z.boolean(),
      reviews: z.boolean(),
      hours: z.boolean(),
      contact: z.boolean(),
    })
    .optional(),
  business_hours: z.array(businessHourSchema).length(7).optional(),
  slot_interval_minutes: z.coerce
    .number()
    .int()
    .refine((v) => [10, 15, 20, 30, 45, 60].includes(v))
    .optional(),
  min_advance_minutes: z.coerce.number().int().min(0).max(10080).optional(),
  max_advance_days: z.coerce.number().int().min(1).max(180).optional(),
  cancellation_deadline_hours: z.coerce.number().int().min(0).max(168).optional(),
  auto_confirm: z.boolean().optional(),
  status: z.enum(['draft', 'published', 'paused']).optional(),
  service_order_ids: z.array(z.string().uuid()).optional(),
});

async function ensureBookingPage(
  db: NonNullable<Awaited<ReturnType<typeof requireBusinessBookingContext>>['db']>,
  business: NonNullable<Awaited<ReturnType<typeof requireBusinessBookingContext>>['ctx']>['business']
) {
  if (!business) return null;
  const { data: existing } = await db
    .from('booking_pages')
    .select('*')
    .eq('business_id', business.id)
    .maybeSingle();

  if (existing) return existing;

  const baseSlug = slugifyBookingTitle(business.name) || business.business_code.toLowerCase();
  let candidate = baseSlug;
  for (let i = 0; i < 6; i++) {
    const { data: clash } = await db
      .from('booking_pages')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!clash) break;
    candidate = `${baseSlug}-${Math.floor(100 + Math.random() * 899)}`;
  }

  const { data: created } = await db
    .from('booking_pages')
    .insert({
      business_id: business.id,
      slug: candidate,
      page_title: business.name,
      phone: business.phone || '',
      address: business.address || '',
      business_hours: DEFAULT_BUSINESS_HOURS,
      section_visibility: DEFAULT_SECTION_VISIBILITY,
      status: 'draft',
    })
    .select('*')
    .single();

  return created;
}

export async function GET() {
  const { error, ctx, db, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !db || !ctx.business) return error!;

  let page = await db
    .from('booking_pages')
    .select('*')
    .eq('business_id', ctx.business.id)
    .maybeSingle()
    .then((r) => r.data);

  if (!page && !readOnly) {
    page = await ensureBookingPage(db, ctx.business);
  }

  const [{ data: services }, { data: staff }, { data: reviews }] = await Promise.all([
    db
      .from('booking_services')
      .select('*')
      .eq('business_id', ctx.business.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('booking_staff')
      .select('*')
      .eq('business_id', ctx.business.id)
      .order('sort_order', { ascending: true }),
    db
      .from('appointment_reviews')
      .select('id, rating, comment, business_reply, created_at, moderation_status')
      .eq('business_id', ctx.business.id)
      .neq('moderation_status', 'hidden')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({
    readOnly,
    page,
    services: services ?? [],
    staff: staff ?? [],
    reviews: reviews ?? [],
  });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessBookingContext('booking.design');
  if (error || !ctx || !db || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = updatePageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Sayfa bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const page = await ensureBookingPage(db, ctx.business);
  if (!page) {
    return NextResponse.json({ error: 'Randevu sayfası oluşturulamadı.' }, { status: 500 });
  }

  const d = parsed.data;
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (d.slug !== undefined) {
    const cleanSlug = slugifyBookingTitle(d.slug);
    if (cleanSlug.length < 2) {
      return NextResponse.json(
        { error: 'Bağlantı adı yalnızca harf, rakam ve tire içermelidir.' },
        { status: 400 }
      );
    }
    const { data: clash } = await db
      .from('booking_pages')
      .select('id')
      .eq('slug', cleanSlug)
      .neq('id', page.id)
      .maybeSingle();
    if (clash) {
      return NextResponse.json(
        { error: 'Bu randevu sayfası bağlantısı başka bir işletme tarafından kullanılıyor.' },
        { status: 409 }
      );
    }
    patch.slug = cleanSlug;
  }

  if (d.page_title !== undefined) patch.page_title = d.page_title;
  if (d.description !== undefined) patch.description = d.description;
  if (d.logo_url !== undefined) patch.logo_url = sanitizeExternalUrl(d.logo_url) ?? '';
  if (d.cover_image_url !== undefined) patch.cover_image_url = sanitizeExternalUrl(d.cover_image_url) ?? '';
  if (d.gallery_images !== undefined) {
    patch.gallery_images = d.gallery_images
      .map((item, idx) => ({
        id: item.id,
        url: sanitizeExternalUrl(item.url) ?? '',
        caption: item.caption ?? '',
        sort_order: idx,
      }))
      .filter((item) => item.url.length > 0);
  }
  if (d.phone !== undefined) patch.phone = d.phone;
  if (d.whatsapp !== undefined) patch.whatsapp = d.whatsapp;
  if (d.address !== undefined) patch.address = d.address;
  if (d.map_location !== undefined) patch.map_location = d.map_location;
  if (d.instagram_url !== undefined) {
    patch.instagram_url = d.instagram_url ? (sanitizeExternalUrl(d.instagram_url) ?? d.instagram_url) : '';
  }
  if (d.theme_preset !== undefined) patch.theme_preset = d.theme_preset;
  if (d.primary_color !== undefined) patch.primary_color = d.primary_color;
  if (d.secondary_color !== undefined) patch.secondary_color = d.secondary_color;
  if (d.section_visibility !== undefined) patch.section_visibility = d.section_visibility;
  if (d.business_hours !== undefined) patch.business_hours = d.business_hours;
  if (d.slot_interval_minutes !== undefined) patch.slot_interval_minutes = d.slot_interval_minutes;
  if (d.min_advance_minutes !== undefined) patch.min_advance_minutes = d.min_advance_minutes;
  if (d.max_advance_days !== undefined) patch.max_advance_days = d.max_advance_days;
  if (d.cancellation_deadline_hours !== undefined) {
    patch.cancellation_deadline_hours = d.cancellation_deadline_hours;
  }
  if (d.auto_confirm !== undefined) patch.auto_confirm = d.auto_confirm;
  if (d.status !== undefined) patch.status = d.status;

  const { data: updated, error: updErr } = await db
    .from('booking_pages')
    .update(patch)
    .eq('id', page.id)
    .select('*')
    .single();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  if (d.service_order_ids && d.service_order_ids.length > 0) {
    await Promise.all(
      d.service_order_ids.map((sid, idx) =>
        db
          .from('booking_services')
          .update({ sort_order: idx })
          .eq('id', sid)
          .eq('business_id', ctx.business!.id)
      )
    );
  }

  return NextResponse.json({ page: updated });
}
