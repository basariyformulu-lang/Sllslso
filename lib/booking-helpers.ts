export type BookingThemePreset =
  | 'classic_navy'
  | 'botanical_emerald'
  | 'warm_atelier'
  | 'minimal_mono'
  | 'soft_rose';

export const BOOKING_THEME_PRESETS: Record<
  BookingThemePreset,
  {
    id: BookingThemePreset;
    name: string;
    description: string;
    primaryColor: string;
    secondaryColor: string;
    surfaceBg: string;
    cardBg: string;
  }
> = {
  classic_navy: {
    id: 'classic_navy',
    name: 'Klasik Lacivert',
    description: 'Berberler ve kurumsal bakım merkezleri için dengeli lacivert görünüm',
    primaryColor: '#0F2942',
    secondaryColor: '#064E3B',
    surfaceBg: '#F8FAFC',
    cardBg: '#FFFFFF',
  },
  botanical_emerald: {
    id: 'botanical_emerald',
    name: 'Doğal Zümrüt',
    description: 'Spa, bakım ve terapi merkezleri için sakin yeşil tonlar',
    primaryColor: '#064E3B',
    secondaryColor: '#0F766E',
    surfaceBg: '#F7FAF9',
    cardBg: '#FFFFFF',
  },
  warm_atelier: {
    id: 'warm_atelier',
    name: 'Sıcak Atölye',
    description: 'Butik kuaför ve stüdyolar için koyu kahve ve kehribar vurgusu',
    primaryColor: '#292524',
    secondaryColor: '#B45309',
    surfaceBg: '#FAFAF9',
    cardBg: '#FFFFFF',
  },
  minimal_mono: {
    id: 'minimal_mono',
    name: 'Modern Monokrom',
    description: 'Yüksek kontrastlı siyah ve arduvaz çizgili modern tasarım',
    primaryColor: '#111827',
    secondaryColor: '#374151',
    surfaceBg: '#F9FAFB',
    cardBg: '#FFFFFF',
  },
  soft_rose: {
    id: 'soft_rose',
    name: 'Zarif Bordo',
    description: 'Güzellik salonları ve estetik merkezleri için rafine tonlar',
    primaryColor: '#881337',
    secondaryColor: '#9F1239',
    surfaceBg: '#FDF8F9',
    cardBg: '#FFFFFF',
  },
};

export const TR_WEEKDAYS = [
  { day: 1, label: 'Pazartesi', short: 'Pzt' },
  { day: 2, label: 'Salı', short: 'Sal' },
  { day: 3, label: 'Çarşamba', short: 'Çar' },
  { day: 4, label: 'Perşembe', short: 'Per' },
  { day: 5, label: 'Cuma', short: 'Cum' },
  { day: 6, label: 'Cumartesi', short: 'Cmt' },
  { day: 0, label: 'Pazar', short: 'Paz' },
] as const;

export const DEFAULT_BUSINESS_HOURS = TR_WEEKDAYS.map((d) => ({
  day: d.day,
  label: d.label,
  open: d.day === 0 ? '10:00' : '09:00',
  close: d.day === 0 ? '17:00' : '19:00',
  is_open: d.day !== 0,
}));

export const DEFAULT_SECTION_VISIBILITY = {
  hero: true,
  services: true,
  staff: true,
  gallery: true,
  reviews: true,
  hours: true,
  contact: true,
};

export const APPOINTMENT_STATUS_LABELS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  pending: { label: 'Beklemede', tone: 'warning' },
  confirmed: { label: 'Onaylandı', tone: 'success' },
  completed: { label: 'Tamamlandı', tone: 'success' },
  cancelled: { label: 'İptal Edildi', tone: 'neutral' },
  no_show: { label: 'Gelmedi', tone: 'danger' },
};

export const APPOINTMENT_PAYMENT_LABELS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  unpaid: { label: 'Ödenmedi', tone: 'warning' },
  partial: { label: 'Kısmi Ödendi', tone: 'warning' },
  paid: { label: 'Ödendi', tone: 'success' },
  refunded: { label: 'İade Edildi', tone: 'neutral' },
};

export const BOOKING_PAGE_STATUS_LABELS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  published: { label: 'Yayında', tone: 'success' },
  paused: { label: 'Geçici Olarak Kapalı', tone: 'warning' },
  draft: { label: 'Taslak (Yayında Değil)', tone: 'neutral' },
};

export function slugifyBookingTitle(input: string): string {
  const trMap: Record<string, string> = {
    ç: 'c',
    Ç: 'c',
    ğ: 'g',
    Ğ: 'g',
    ı: 'i',
    İ: 'i',
    ö: 'o',
    Ö: 'o',
    ş: 's',
    Ş: 's',
    ü: 'u',
    Ü: 'u',
  };
  const replaced = input
    .split('')
    .map((ch) => trMap[ch] ?? ch)
    .join('')
    .toLowerCase();

  return replaced
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function sanitizeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('data:image/')) return trimmed;
  return null;
}

export function formatTimeHHMM(timeStr: string | null | undefined): string {
  if (!timeStr) return '—';
  return timeStr.slice(0, 5);
}
