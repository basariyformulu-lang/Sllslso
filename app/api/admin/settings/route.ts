import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';

const settingsSchema = z.object({
  systemName: z.string().trim().min(2).max(80),
  logoUrl: z.string().trim().max(500).optional().default(''),
  heroSlogan: z.string().trim().min(5).max(200),
  heroSubheadline: z.string().trim().min(5).max(400),
  contactEmail: z.string().trim().email(),
  contactPhone: z.string().trim().min(5).max(40),
  pricingDescription: z.string().trim().min(5).max(400),
  termsOfService: z.string().trim().min(10).max(10000),
  privacyPolicy: z.string().trim().min(10).max(10000),
});

export async function GET() {
  const { error, db } = await requireSystemAdmin();
  if (error || !db) return error!;

  const { data: settings } = await db.from('system_settings').select('*').eq('id', 1).maybeSingle();
  return NextResponse.json({ settings });
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

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Sistem ayarlarını kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const { data: existing } = await db.from('system_settings').select('*').eq('id', 1).maybeSingle();

  const { data: updated, error: updErr } = await db
    .from('system_settings')
    .upsert({
      id: 1,
      system_name: d.systemName,
      logo_url: d.logoUrl,
      hero_slogan: d.heroSlogan,
      hero_subheadline: d.heroSubheadline,
      contact_email: d.contactEmail,
      contact_phone: d.contactPhone,
      pricing_description: d.pricingDescription,
      terms_of_service: d.termsOfService,
      privacy_policy: d.privacyPolicy,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await db.from('audit_logs').insert({
    scope: 'admin',
    actor_user_id: ctx.userId,
    actor_name: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'system_settings_updated',
    entity_type: 'system_settings',
    entity_id: '1',
    old_values: existing ? { system_name: existing.system_name, hero_slogan: existing.hero_slogan } : null,
    new_values: { system_name: d.systemName, hero_slogan: d.heroSlogan },
    description: 'Genel sistem ayarları ve tanıtım içerikleri güncellendi.',
  });

  return NextResponse.json({ settings: updated });
}
