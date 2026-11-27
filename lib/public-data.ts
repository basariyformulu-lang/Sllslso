import { isDatabaseConfigured, parseJsonField, queryOne, toBool } from '@/lib/db';
import type { SubscriptionPlan, SystemSettings } from '@/lib/types';

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  id: 1,
  system_name: 'EsnafTakip',
  logo_url: '',
  hero_slogan: 'İşletmenizin tüm borç ve alacakları tek yerde.',
  hero_subheadline:
    'Bakkallar, büfeler, marketler, berberler ve güzellik salonları için cari hesap, finans ve online randevu süreçlerinizi tek merkezden yönetin.',
  contact_email: 'destek@esnaftakip.com',
  contact_phone: '0850 000 00 00',
  pricing_description:
    'Tüm özellikler tek pakette. Gizli ücret, modül kısıtı veya kullanıcı sınırı yok.',
  terms_of_service:
    'EsnafTakip hizmet kullanım koşulları gereği işletme finansal kayıtlarının doğruluğu işletme sorumluluğundadır. Abonelik aylık dönemler halinde banka havalesi/EFT onayı ile aktif edilir.',
  privacy_policy:
    'EsnafTakip KVKK ve gizlilik politikası kapsamında her işletmenin cari ve finansal verileri diğer işletmelerden tamamen izole biçimde saklanır ve üçüncü taraflarla paylaşılmaz.',
  booking_module_default_included: true,
  booking_module_addon_price: 0,
};

export const DEFAULT_SUBSCRIPTION_PLAN: SubscriptionPlan = {
  id: 'default-single-plan',
  name: 'EsnafTakip İşletme Aboneliği',
  description:
    'Müşteri alacakları, toptancı borçları, vadeli satış takibi, gelir-gider, aylık sabit gider planlama ve online randevu dahil eksiksiz işletme yönetimi.',
  monthly_price: 490,
  duration_days: 30,
  features: [
    'Sınırsız müşteri ve toptancı cari takibi',
    'Otomatik vade hesaplama ve vade uyarı sistemi',
    'Aylık sabit gider planlama ve gerçekleşen gider kaydı',
    'Online randevu sayfası, personel ve takvim yönetimi',
    'Yetki bazlı sınırsız işletme alt kullanıcısı',
    'Mobil, tablet ve masaüstü tam uyumlu yönetim paneli',
  ],
  is_active: true,
  effective_from: '2026-01-01',
};

export async function getPublicSiteData(): Promise<{
  configured: boolean;
  settings: SystemSettings;
  plan: SubscriptionPlan;
}> {
  if (!isDatabaseConfigured()) {
    return {
      configured: false,
      settings: DEFAULT_SYSTEM_SETTINGS,
      plan: DEFAULT_SUBSCRIPTION_PLAN,
    };
  }

  try {
    const [settingsRow, planRow] = await Promise.all([
      queryOne<Record<string, unknown>>('SELECT * FROM system_settings WHERE id = 1 LIMIT 1'),
      queryOne<Record<string, unknown>>('SELECT * FROM subscription_plans LIMIT 1'),
    ]);

    return {
      configured: true,
      settings: settingsRow
        ? {
            id: Number(settingsRow.id ?? 1),
            system_name: String(settingsRow.system_name ?? 'EsnafTakip'),
            logo_url: String(settingsRow.logo_url ?? ''),
            hero_slogan: String(settingsRow.hero_slogan ?? DEFAULT_SYSTEM_SETTINGS.hero_slogan),
            hero_subheadline: String(
              settingsRow.hero_subheadline ?? DEFAULT_SYSTEM_SETTINGS.hero_subheadline
            ),
            contact_email: String(settingsRow.contact_email ?? 'destek@esnaftakip.com'),
            contact_phone: String(settingsRow.contact_phone ?? ''),
            pricing_description: String(settingsRow.pricing_description ?? ''),
            terms_of_service: String(settingsRow.terms_of_service ?? ''),
            privacy_policy: String(settingsRow.privacy_policy ?? ''),
            booking_module_default_included: toBool(settingsRow.booking_module_default_included),
            booking_module_addon_price: Number(settingsRow.booking_module_addon_price ?? 0),
          }
        : DEFAULT_SYSTEM_SETTINGS,
      plan: planRow
        ? {
            id: String(planRow.id),
            name: String(planRow.name),
            description: String(planRow.description ?? ''),
            monthly_price: Number(planRow.monthly_price ?? 490),
            duration_days: Number(planRow.duration_days ?? 30),
            features: parseJsonField<string[]>(planRow.features, []),
            is_active: toBool(planRow.is_active),
            effective_from: String(planRow.effective_from ?? '2026-01-01'),
          }
        : DEFAULT_SUBSCRIPTION_PLAN,
    };
  } catch {
    return {
      configured: false,
      settings: DEFAULT_SYSTEM_SETTINGS,
      plan: DEFAULT_SUBSCRIPTION_PLAN,
    };
  }
}
