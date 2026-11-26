import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';
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
  const { error, db } = await requireSystemAdmin();
  if (error || !db) return error!;

  const [
    { data: businesses },
    { data: pages },
    { data: appointments },
    { data: reviews },
    { data: settings },
  ] = await Promise.all([
    db
      .from('businesses')
      .select('id, name, business_code, subscription_status, is_active, booking_module_enabled, booking_module_mode')
      .order('created_at', { ascending: false }),
    db.from('booking_pages').select('*'),
    db.from('appointments').select('id, business_id, status'),
    db
      .from('appointment_reviews')
      .select(
        '*, business:businesses(name, business_code), appointment:appointments(service_name_snapshot, staff_name_snapshot), profile:profiles!appointment_reviews_customer_user_id_fkey(first_name, last_name)'
      )
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('system_settings')
      .select('booking_module_default_included, booking_module_addon_price')
      .eq('id', 1)
      .maybeSingle(),
  ]);

  const pageMap = new Map<string, NonNullable<typeof pages>[number]>();
  (pages ?? []).forEach((p) => pageMap.set(p.business_id, p));

  const businessRows = (businesses ?? []).map((b) => {
    const page = pageMap.get(b.id) ?? null;
    const bizAppts = (appointments ?? []).filter((a) => a.business_id === b.id);
    const bizReviews = (reviews ?? []).filter(
      (r) => r.business_id === b.id && r.moderation_status !== 'hidden'
    );
    const avgRating =
      bizReviews.length > 0
        ? Math.round(
            (bizReviews.reduce((acc, r) => acc + Number(r.rating), 0) / bizReviews.length) * 10
          ) / 10
        : 0;
    return {
      ...b,
      page,
      totalAppointments: bizAppts.length,
      completedAppointments: bizAppts.filter((a) => a.status === 'completed').length,
      reviewCount: bizReviews.length,
      averageRating: avgRating,
    };
  });

  const formattedReviews = (reviews ?? []).map((r) => {
    const biz = Array.isArray(r.business) ? r.business[0] : r.business;
    const appt = Array.isArray(r.appointment) ? r.appointment[0] : r.appointment;
    const prof = Array.isArray(r.profile) ? r.profile[0] : r.profile;
    return {
      ...r,
      business_name: biz?.name ?? '—',
      service_name: appt?.service_name_snapshot ?? '—',
      staff_name: appt?.staff_name_snapshot ?? '—',
      customer_name: prof ? `${prof.first_name} ${prof.last_name}`.trim() : 'Müşteri',
    };
  });

  return NextResponse.json({
    businesses: businessRows,
    reviews: formattedReviews,
    globalSettings: {
      defaultIncluded: settings?.booking_module_default_included !== false,
      addonPrice: Number(settings?.booking_module_addon_price ?? 0),
    },
  });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireSystemAdmin();
  if (error || !ctx || !db) return error!;

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

  if (d.action === 'toggle_business_module') {
    const { error: err } = await db
      .from('businesses')
      .update({
        booking_module_enabled: d.bookingModuleEnabled,
        booking_module_mode: d.bookingModuleMode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', d.businessId);
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });

    await db.from('audit_logs').insert({
      scope: 'admin',
      business_id: d.businessId,
      actor_user_id: ctx.userId,
      actor_name: ctx.adminName ?? 'Sistem Yöneticisi',
      action: 'booking_module_access_updated',
      entity_type: 'businesses',
      entity_id: d.businessId,
      new_values: {
        booking_module_enabled: d.bookingModuleEnabled,
        booking_module_mode: d.bookingModuleMode,
      },
      description: 'İşletme online randevu modülü erişimi güncellendi.',
    });

    return NextResponse.json({ success: true });
  }

  if (d.action === 'toggle_page_status') {
    const { error: err } = await db
      .from('booking_pages')
      .update({ status: d.status, updated_at: new Date().toISOString() })
      .eq('business_id', d.businessId);
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (d.action === 'update_global_settings') {
    const { error: err } = await db
      .from('system_settings')
      .update({
        booking_module_default_included: d.defaultIncluded,
        booking_module_addon_price: roundCurrency(d.addonPrice),
        updated_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const { error: revErr } = await db
    .from('appointment_reviews')
    .update({
      moderation_status: d.moderationStatus,
      moderation_note: d.moderationNote,
      moderated_by: ctx.userId,
      moderated_at: new Date().toISOString(),
    })
    .eq('id', d.reviewId);

  if (revErr) return NextResponse.json({ error: revErr.message }, { status: 500 });

  await db.from('audit_logs').insert({
    scope: 'admin',
    actor_user_id: ctx.userId,
    actor_name: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'review_moderated',
    entity_type: 'appointment_reviews',
    entity_id: d.reviewId,
    new_values: { moderation_status: d.moderationStatus, moderation_note: d.moderationNote },
    description: 'Müşteri yorumu platform yöneticisi tarafından incelendi.',
  });

  return NextResponse.json({ success: true });
}
