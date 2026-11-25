import { createServiceRoleSupabase, isServiceRoleConfigured } from '@/lib/supabase/server';
import type { SubscriptionPlan, SystemSettings } from '@/lib/types';

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  id: 1,
  system_name: 'EsnafTakip',
  logo_url: '',
  hero_slogan: 'İşletmenizin tüm borç ve alacakları tek yerde.',
  hero_subheadline:
    'Bakkallar, büfeler, marketler ve toptancılar için müşteri alacakları, toptancı borçları, vadeli satışlar ve aylık sabit giderleri zahmetsizce takip edin.',
  contact_email: 'destek@esnaftakip.com',
  contact_phone: '0850 000 00 00',
  pricing_description:
    'Tüm özellikler tek pakette. Gizli ücret, modül kısıtı veya kullanıcı sınırı yok.',
  terms_of_service:
    'EsnafTakip hizmet kullanım koşulları gereği işletme finansal kayıtlarının doğruluğu işletme sorumluluğundadır. Abonelik aylık dönemler halinde banka havalesi/EFT onayı ile aktif edilir.',
  privacy_policy:
    'EsnafTakip KVKK ve gizlilik politikası kapsamında her işletmenin cari ve finansal verileri diğer işletmelerden tamamen izole biçimde saklanır ve üçüncü taraflarla paylaşılmaz.',
};

export const DEFAULT_SUBSCRIPTION_PLAN: SubscriptionPlan = {
  id: 'default-single-plan',
  name: 'EsnafTakip İşletme Aboneliği',
  description:
    'Müşteri alacakları, toptancı borçları, vadeli satış takibi, gelir-gider ve aylık sabit gider planlama dahil eksiksiz işletme yönetimi.',
  monthly_price: 490,
  duration_days: 30,
  features: [
    'Sınırsız müşteri ve toptancı cari takibi',
    'Otomatik vade hesaplama ve vade uyarı sistemi',
    'Aylık sabit gider planlama ve gerçekleşen gider kaydı',
    'Günlük, aylık ve dönem bazlı CSV/Excel raporları',
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
  if (!isServiceRoleConfigured()) {
    return {
      configured: false,
      settings: DEFAULT_SYSTEM_SETTINGS,
      plan: DEFAULT_SUBSCRIPTION_PLAN,
    };
  }

  try {
    const db = createServiceRoleSupabase()!;
    const [{ data: settingsRow }, { data: planRow }] = await Promise.all([
      db.from('system_settings').select('*').eq('id', 1).maybeSingle(),
      db.from('subscription_plans').select('*').limit(1).maybeSingle(),
    ]);

    return {
      configured: true,
      settings: (settingsRow as SystemSettings) ?? DEFAULT_SYSTEM_SETTINGS,
      plan: planRow
        ? ({
            ...planRow,
            monthly_price: Number(planRow.monthly_price),
            features: Array.isArray(planRow.features) ? planRow.features : [],
          } as SubscriptionPlan)
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
