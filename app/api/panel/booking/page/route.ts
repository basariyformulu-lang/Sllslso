import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import {
  extractInstagramUsername,
  sanitizeExternalUrl,
  slugifyBookingTitle,
} from '@/lib/booking-helpers';
import { ensureBookingPageMysql, formatBookingPageRow } from '@/lib/booking-mysql';
import { execute, query, queryOne, toBool, toIsoString, toMySqlDateTime } from '@/lib/db';

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

const instagramPostSchema = z.object({
  id: z.string().min(1).max(80),
  image_url: z.string().min(1).max(2_000_000),
  caption: z.string().max(240).optional().default(''),
  post_url: z.string().max(400).optional().default(''),
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
  instagram_username: z.string().trim().max(120).optional(),
  instagram_display_name: z.string().trim().max(160).optional(),
  instagram_avatar_url: z.string().max(2_000_000).optional(),
  instagram_followers_count: z.coerce.number().int().min(0).max(50_000_000).optional(),
  instagram_posts_count: z.coerce.number().int().min(0).max(1_000_000).optional(),
  instagram_posts: z.array(instagramPostSchema).max(6).optional(),
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
      instagram: z.boolean().optional().default(true),
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
    .refine((v) => [30, 45, 60].includes(v), 'Randevu aralığı 30, 45 veya 60 dakika olmalıdır.')
    .optional(),
  min_advance_minutes: z.coerce.number().int().min(0).max(10080).optional(),
  max_advance_days: z.coerce.number().int().min(1).max(180).optional(),
  cancellation_deadline_hours: z.coerce.number().int().min(0).max(168).optional(),
  auto_confirm: z.boolean().optional(),
  status: z.enum(['draft', 'published', 'paused']).optional(),
  service_order_ids: z.array(z.string().uuid()).optional(),
});

export async function GET() {
  const { error, ctx, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !ctx.business) return error!;

  let pageRow = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_pages WHERE business_id = ? LIMIT 1',
    [ctx.business.id]
  );

  let page = pageRow ? formatBookingPageRow(pageRow) : null;
  if (!page && !readOnly) {
    page = await ensureBookingPageMysql(ctx.business);
  }

  const [services, staff, reviews] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM booking_services WHERE business_id = ? ORDER BY sort_order ASC, created_at ASC',
      [ctx.business.id]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM booking_staff WHERE business_id = ? ORDER BY sort_order ASC',
      [ctx.business.id]
    ),
    query<Record<string, unknown>>(
      `SELECT id, rating, comment, business_reply, created_at, moderation_status, customer_name
       FROM appointment_reviews
       WHERE business_id = ? AND moderation_status <> 'hidden'
       ORDER BY created_at DESC LIMIT 10`,
      [ctx.business.id]
    ),
  ]);

  return NextResponse.json({
    readOnly,
    page,
    services: services.map((s) => ({
      ...s,
      price: Number(s.price),
      discount_price: s.discount_price !== null ? Number(s.discount_price) : null,
      is_active: toBool(s.is_active),
    })),
    staff: staff.map((st) => ({ ...st, is_active: toBool(st.is_active) })),
    reviews: reviews.map((r) => ({ ...r, created_at: toIsoString(r.created_at) })),
  });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.design');
  if (error || !ctx || !ctx.business) return error!;

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

  const page = await ensureBookingPageMysql(ctx.business);
  if (!page) {
    return NextResponse.json({ error: 'Randevu sayfası oluşturulamadı.' }, { status: 500 });
  }

  const d = parsed.data;
  const setClauses: string[] = ['updated_at = ?'];
  const values: unknown[] = [toMySqlDateTime()];

  if (d.slug !== undefined) {
    const cleanSlug = slugifyBookingTitle(d.slug);
    if (cleanSlug.length < 2) {
      return NextResponse.json(
        { error: 'Bağlantı adı yalnızca harf, rakam ve tire içermelidir.' },
        { status: 400 }
      );
    }
    const clash = await queryOne<{ id: string }>(
      'SELECT id FROM booking_pages WHERE slug = ? AND id <> ? LIMIT 1',
      [cleanSlug, page.id]
    );
    if (clash) {
      return NextResponse.json(
        { error: 'Bu randevu sayfası bağlantısı başka bir işletme tarafından kullanılıyor.' },
        { status: 409 }
      );
    }
    setClauses.push('slug = ?');
    values.push(cleanSlug);
  }

  if (d.page_title !== undefined) {
    setClauses.push('page_title = ?');
    values.push(d.page_title);
  }
  if (d.description !== undefined) {
    setClauses.push('description = ?');
    values.push(d.description);
  }
  if (d.logo_url !== undefined) {
    setClauses.push('logo_url = ?');
    values.push(sanitizeExternalUrl(d.logo_url) ?? '');
  }
  if (d.cover_image_url !== undefined) {
    setClauses.push('cover_image_url = ?');
    values.push(sanitizeExternalUrl(d.cover_image_url) ?? '');
  }
  if (d.gallery_images !== undefined) {
    const cleaned = d.gallery_images
      .map((item, idx) => ({
        id: item.id,
        url: sanitizeExternalUrl(item.url) ?? '',
        caption: item.caption ?? '',
        sort_order: idx,
      }))
      .filter((item) => item.url.length > 0);
    setClauses.push('gallery_images = ?');
    values.push(JSON.stringify(cleaned));
  }
  if (d.phone !== undefined) {
    setClauses.push('phone = ?');
    values.push(d.phone);
  }
  if (d.whatsapp !== undefined) {
    setClauses.push('whatsapp = ?');
    values.push(d.whatsapp);
  }
  if (d.address !== undefined) {
    setClauses.push('address = ?');
    values.push(d.address);
  }
  if (d.map_location !== undefined) {
    setClauses.push('map_location = ?');
    values.push(d.map_location);
  }
  if (d.instagram_url !== undefined) {
    const normalizedUrl = d.instagram_url
      ? (sanitizeExternalUrl(d.instagram_url) ?? d.instagram_url)
      : '';
    setClauses.push('instagram_url = ?');
    values.push(normalizedUrl);
    if (d.instagram_username === undefined && normalizedUrl) {
      const extracted = extractInstagramUsername(normalizedUrl);
      if (extracted) {
        setClauses.push('instagram_username = ?');
        values.push(extracted);
      }
    }
  }
  if (d.instagram_username !== undefined) {
    setClauses.push('instagram_username = ?');
    values.push(extractInstagramUsername(d.instagram_username));
  }
  if (d.instagram_display_name !== undefined) {
    setClauses.push('instagram_display_name = ?');
    values.push(d.instagram_display_name);
  }
  if (d.instagram_avatar_url !== undefined) {
    setClauses.push('instagram_avatar_url = ?');
    values.push(sanitizeExternalUrl(d.instagram_avatar_url) ?? '');
  }
  if (d.instagram_followers_count !== undefined) {
    setClauses.push('instagram_followers_count = ?');
    values.push(d.instagram_followers_count);
  }
  if (d.instagram_posts_count !== undefined) {
    setClauses.push('instagram_posts_count = ?');
    values.push(d.instagram_posts_count);
  }
  if (d.instagram_posts !== undefined) {
    const cleanedPosts = d.instagram_posts
      .slice(0, 6)
      .map((p) => ({
        id: p.id,
        image_url: sanitizeExternalUrl(p.image_url) ?? '',
        caption: p.caption ?? '',
        post_url: p.post_url ? (sanitizeExternalUrl(p.post_url) ?? '') : '',
      }))
      .filter((p) => p.image_url.length > 0);
    setClauses.push('instagram_posts = ?');
    values.push(JSON.stringify(cleanedPosts));
  }
  if (d.theme_preset !== undefined) {
    setClauses.push('theme_preset = ?');
    values.push(d.theme_preset);
  }
  if (d.primary_color !== undefined) {
    setClauses.push('primary_color = ?');
    values.push(d.primary_color);
  }
  if (d.secondary_color !== undefined) {
    setClauses.push('secondary_color = ?');
    values.push(d.secondary_color);
  }
  if (d.section_visibility !== undefined) {
    setClauses.push('section_visibility = ?');
    values.push(JSON.stringify(d.section_visibility));
  }
  if (d.business_hours !== undefined) {
    setClauses.push('business_hours = ?');
    values.push(JSON.stringify(d.business_hours));
  }
  if (d.slot_interval_minutes !== undefined) {
    setClauses.push('slot_interval_minutes = ?');
    values.push(d.slot_interval_minutes);
  }
  if (d.min_advance_minutes !== undefined) {
    setClauses.push('min_advance_minutes = ?');
    values.push(d.min_advance_minutes);
  }
  if (d.max_advance_days !== undefined) {
    setClauses.push('max_advance_days = ?');
    values.push(d.max_advance_days);
  }
  if (d.cancellation_deadline_hours !== undefined) {
    setClauses.push('cancellation_deadline_hours = ?');
    values.push(d.cancellation_deadline_hours);
  }
  if (d.auto_confirm !== undefined) {
    setClauses.push('auto_confirm = ?');
    values.push(d.auto_confirm ? 1 : 0);
  }
  if (d.status !== undefined) {
    setClauses.push('status = ?');
    values.push(d.status);
  }

  values.push(page.id);
  await execute(`UPDATE booking_pages SET ${setClauses.join(', ')} WHERE id = ?`, values);

  if (d.service_order_ids && d.service_order_ids.length > 0) {
    await Promise.all(
      d.service_order_ids.map((sid, idx) =>
        execute(
          'UPDATE booking_services SET sort_order = ? WHERE id = ? AND business_id = ?',
          [idx, sid, ctx.business!.id]
        )
      )
    );
  }

  const updatedRow = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_pages WHERE id = ? LIMIT 1',
    [page.id]
  );

  return NextResponse.json({ page: updatedRow ? formatBookingPageRow(updatedRow) : page });
}
