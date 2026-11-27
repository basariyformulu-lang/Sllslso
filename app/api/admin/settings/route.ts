import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';
import { execute, queryOne, toBool, toMySqlDateTime, writeAuditLog } from '@/lib/db';

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
  const { error } = await requireSystemAdmin();
  if (error) return error;

  const settings = await queryOne<Record<string, unknown>>(
    'SELECT * FROM system_settings WHERE id = 1 LIMIT 1'
  );
  return NextResponse.json({
    settings: settings
      ? {
          ...settings,
          booking_module_default_included: toBool(settings.booking_module_default_included),
        }
      : null,
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

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Sistem ayarlarını kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM system_settings WHERE id = 1 LIMIT 1'
  );
  const nowStr = toMySqlDateTime();

  await execute(
    `INSERT INTO system_settings
     (id, system_name, logo_url, hero_slogan, hero_subheadline, contact_email, contact_phone, pricing_description, terms_of_service, privacy_policy, updated_by, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       system_name = VALUES(system_name),
       logo_url = VALUES(logo_url),
       hero_slogan = VALUES(hero_slogan),
       hero_subheadline = VALUES(hero_subheadline),
       contact_email = VALUES(contact_email),
       contact_phone = VALUES(contact_phone),
       pricing_description = VALUES(pricing_description),
       terms_of_service = VALUES(terms_of_service),
       privacy_policy = VALUES(privacy_policy),
       updated_by = VALUES(updated_by),
       updated_at = VALUES(updated_at)`,
    [
      d.systemName,
      d.logoUrl,
      d.heroSlogan,
      d.heroSubheadline,
      d.contactEmail,
      d.contactPhone,
      d.pricingDescription,
      d.termsOfService,
      d.privacyPolicy,
      ctx.userId,
      nowStr,
    ]
  );

  const updated = await queryOne<Record<string, unknown>>(
    'SELECT * FROM system_settings WHERE id = 1 LIMIT 1'
  );

  await writeAuditLog({
    scope: 'admin',
    actorUserId: ctx.userId,
    actorName: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'system_settings_updated',
    entityType: 'system_settings',
    entityId: '1',
    oldValues: existing ? { system_name: existing.system_name, hero_slogan: existing.hero_slogan } : null,
    newValues: { system_name: d.systemName, hero_slogan: d.heroSlogan },
    description: 'Genel sistem ayarları ve tanıtım içerikleri güncellendi.',
  });

  return NextResponse.json({ settings: updated });
}
