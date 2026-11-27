import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';
import {
  execute,
  parseJsonField,
  query,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
  writeAuditLog,
} from '@/lib/db';
import { roundCurrency } from '@/lib/format';

const adminBookingPatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('toggle_business_module'),
    businessId: z.string().uuid(),
    bookingModuleEnabled: z.boolean(),
    bookingModuleMode: z.enum(['included', 'addon_active', 'addon_locked']),
  }),
  z.object({
    action: z.literal('toggle_page_status'),
    businessId: z.string().uuid(),
    status: z.enum(['draft', 'published', 'paused']),
  }),
  z.object({
    action: z.literal('update_global_settings'),
    defaultIncluded: z.boolean(),
    addonPrice: z.coerce.number().min(0),
  }),
  z.object({
    action: z.literal('moderate_review'),
    reviewId: z.string().uuid(),
    moderationStatus: z.enum(['published', 'hidden']),
    moderationNote: z.string().trim().max(300).optional().default(''),
  }),
]);

export async function GET() {
  const { error } = await requireSystemAdmin();
  if (error) return error;

  const [businesses, pages, appointments, reviews, settings] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT id, name, business_code, subscription_status, is_active, booking_module_enabled, booking_module_mode FROM businesses ORDER BY created_at DESC'
    ),
    query<Record<string, unknown>>('SELECT * FROM booking_pages'),
    query<{ id: string; business_id: string; status: string }>(
      'SELECT id, business_id, status FROM appointments'
    ),
    query<Record<string, unknown>>(
      `SELECT r.*, b.name AS business_name, a.service_name_snapshot AS service_name, a.staff_name_snapshot AS staff_name
       FROM appointment_reviews r
       LEFT JOIN businesses b ON b.id = r.business_id
       LEFT JOIN appointments a ON a.id = r.appointment_id
       ORDER BY r.created_at DESC
       LIMIT 100`
    ),
    queryOne<{
      booking_module_default_included: number;
      booking_module_addon_price: number;
    }>('SELECT booking_module_default_included, booking_module_addon_price FROM system_settings WHERE id = 1 LIMIT 1'),
  ]);

  const pageMap = new Map<string, Record<string, unknown>>();
  pages.forEach((p) => pageMap.set(String(p.business_id), p));

  const businessRows = businesses.map((b) => {
    const bizId = String(b.id);
    const page = pageMap.get(bizId) ?? null;
    const bizAppts = appointments.filter((a) => a.business_id === bizId);
    const bizReviews = reviews.filter(
      (r) => String(r.business_id) === bizId && r.moderation_status !== 'hidden'
    );
    const avgRating =
      bizReviews.length > 0
        ? Math.round(
            (bizReviews.reduce((acc, r) => acc + Number(r.rating), 0) / bizReviews.length) * 10
          ) / 10
        : 0;
    return {
      ...b,
      is_active: toBool(b.is_active),
      booking_module_enabled: toBool(b.booking_module_enabled),
      page: page
        ? {
            ...page,
            gallery_images: parseJsonField(page.gallery_images, []),
            section_visibility: parseJsonField(page.section_visibility, {}),
            business_hours: parseJsonField(page.business_hours, []),
            auto_confirm: toBool(page.auto_confirm),
          }
        : null,
      totalAppointments: bizAppts.length,
      completedAppointments: bizAppts.filter((a) => a.status === 'completed').length,
      reviewCount: bizReviews.length,
      averageRating: avgRating,
    };
  });

  const formattedReviews = reviews.map((r) => ({
    ...r,
    rating: Number(r.rating ?? 5),
    business_name: String(r.business_name ?? '—'),
    service_name: String(r.service_name ?? '—'),
    staff_name: String(r.staff_name ?? '—'),
    customer_name: String(r.customer_name ?? 'Müşteri'),
    created_at: toIsoString(r.created_at),
  }));

  return NextResponse.json({
    businesses: businessRows,
    reviews: formattedReviews,
    globalSettings: {
      defaultIncluded: settings ? toBool(settings.booking_module_default_included) : true,
      addonPrice: Number(settings?.booking_module_addon_price ?? 0),
    },
  });
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

  const parsed = adminBookingPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Yönetici işlem verileri geçersiz.' }, { status: 400 });
  }

  const d = parsed.data;
  const nowStr = toMySqlDateTime();

  if (d.action === 'toggle_business_module') {
    await execute(
      'UPDATE businesses SET booking_module_enabled = ?, booking_module_mode = ?, updated_at = ? WHERE id = ?',
      [d.bookingModuleEnabled ? 1 : 0, d.bookingModuleMode, nowStr, d.businessId]
    );

    await writeAuditLog({
      scope: 'admin',
      businessId: d.businessId,
      actorUserId: ctx.userId,
      actorName: ctx.adminName ?? 'Sistem Yöneticisi',
      action: 'booking_module_access_updated',
      entityType: 'businesses',
      entityId: d.businessId,
      newValues: {
        booking_module_enabled: d.bookingModuleEnabled,
        booking_module_mode: d.bookingModuleMode,
      },
      description: 'İşletme online randevu modülü erişimi güncellendi.',
    });

    return NextResponse.json({ success: true });
  }

  if (d.action === 'toggle_page_status') {
    await execute(
      'UPDATE booking_pages SET status = ?, updated_at = ? WHERE business_id = ?',
      [d.status, nowStr, d.businessId]
    );
    return NextResponse.json({ success: true });
  }

  if (d.action === 'update_global_settings') {
    await execute(
      `UPDATE system_settings
       SET booking_module_default_included = ?, booking_module_addon_price = ?, updated_by = ?, updated_at = ?
       WHERE id = 1`,
      [d.defaultIncluded ? 1 : 0, roundCurrency(d.addonPrice), ctx.userId, nowStr]
    );
    return NextResponse.json({ success: true });
  }

  await execute(
    `UPDATE appointment_reviews
     SET moderation_status = ?, moderation_note = ?, moderated_by = ?, moderated_at = ?
     WHERE id = ?`,
    [d.moderationStatus, d.moderationNote, ctx.userId, nowStr, d.reviewId]
  );

  await writeAuditLog({
    scope: 'admin',
    actorUserId: ctx.userId,
    actorName: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'review_moderated',
    entityType: 'appointment_reviews',
    entityId: d.reviewId,
    newValues: { moderation_status: d.moderationStatus, moderation_note: d.moderationNote },
    description: 'Müşteri yorumu platform yöneticisi tarafından incelendi.',
  });

  return NextResponse.json({ success: true });
}
