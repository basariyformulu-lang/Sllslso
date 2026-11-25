import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';

const updateSettingsSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  phone: z.string().trim().max(30),
  businessName: z.string().trim().min(2).max(120).optional(),
  businessPhone: z.string().trim().max(30).optional(),
  businessAddress: z.string().trim().max(250).optional(),
});

export async function GET() {
  const { error, ctx, db } = await requireBusinessContext();
  if (error || !ctx || !db || !ctx.business) return error!;

  const [{ data: profile }, { data: subscription }, { data: auditLogs }, { data: notifications }] =
    await Promise.all([
      db.from('profiles').select('*').eq('id', ctx.userId).single(),
      db
        .from('subscriptions')
        .select('*, plan:subscription_plans(*)')
        .eq('business_id', ctx.business.id)
        .maybeSingle(),
      db
        .from('audit_logs')
        .select('*')
        .eq('business_id', ctx.business.id)
        .eq('scope', 'business')
        .order('created_at', { ascending: false })
        .limit(30),
      db
        .from('notifications')
        .select('*')
        .eq('business_id', ctx.business.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

  return NextResponse.json({
    profile,
    business: ctx.business,
    member: ctx.member,
    subscription,
    auditLogs: auditLogs ?? [],
    notifications: notifications ?? [],
  });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessContext();
  if (error || !ctx || !db || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  // Bildirim okundu işaretleme
  if (
    typeof body === 'object' &&
    body !== null &&
    'markNotificationsRead' in body &&
    (body as { markNotificationsRead?: boolean }).markNotificationsRead
  ) {
    await db
      .from('notifications')
      .update({ is_read: true })
      .eq('business_id', ctx.business.id)
      .eq('is_read', false);
    return NextResponse.json({ success: true });
  }

  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Profil bilgilerini kontrol ediniz.' }, { status: 400 });
  }

  const d = parsed.data;
  await db
    .from('profiles')
    .update({
      first_name: d.firstName,
      last_name: d.lastName,
      phone: d.phone,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ctx.userId);

  if (ctx.member?.is_owner && d.businessName) {
    await db
      .from('businesses')
      .update({
        name: d.businessName,
        phone: d.businessPhone ?? ctx.business.phone,
        address: d.businessAddress ?? ctx.business.address,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ctx.business.id);
  }

  return NextResponse.json({ success: true });
}
