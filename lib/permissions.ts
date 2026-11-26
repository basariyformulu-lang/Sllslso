export interface PermissionDef {
  code: string;
  module: string;
  label: string;
}

export const ALL_PERMISSIONS: PermissionDef[] = [
  { code: 'reports.view', module: 'Genel Bakış ve Raporlar', label: 'Raporları ve finansal özeti görüntüleme' },
  { code: 'customers.view', module: 'Müşteriler', label: 'Müşteri listeleme ve detay görme' },
  { code: 'customers.create', module: 'Müşteriler', label: 'Müşteri ekleme' },
  { code: 'customers.edit', module: 'Müşteriler', label: 'Müşteri düzenleme ve pasifleştirme' },
  { code: 'customers.delete', module: 'Müşteriler', label: 'Müşteri hareketi iptal / silme' },
  { code: 'customers.add_debt', module: 'Müşteriler', label: 'Müşteriye borç ekleme' },
  { code: 'customers.add_payment', module: 'Müşteriler', label: 'Müşteriden ödeme alma' },
  { code: 'suppliers.view', module: 'Toptancılar', label: 'Toptancı listeleme ve detay görme' },
  { code: 'suppliers.create', module: 'Toptancılar', label: 'Toptancı ekleme' },
  { code: 'suppliers.edit', module: 'Toptancılar', label: 'Toptancı düzenleme ve pasifleştirme' },
  { code: 'suppliers.delete', module: 'Toptancılar', label: 'Toptancı hareketi iptal / silme' },
  { code: 'suppliers.add_debt', module: 'Toptancılar', label: 'Toptancıya borç ekleme' },
  { code: 'suppliers.add_payment', module: 'Toptancılar', label: 'Toptancıya ödeme yapma' },
  { code: 'credit_sales.view', module: 'Vadeli Satışlar', label: 'Vadeli satış listeleme' },
  { code: 'credit_sales.create', module: 'Vadeli Satışlar', label: 'Vadeli satış oluşturma' },
  { code: 'credit_sales.edit', module: 'Vadeli Satışlar', label: 'Vadeli satış düzenleme' },
  { code: 'credit_sales.delete', module: 'Vadeli Satışlar', label: 'Vadeli satış iptal etme' },
  { code: 'finance.view', module: 'Gelir ve Giderler', label: 'Gelir ve gider listeleme' },
  { code: 'finance.create', module: 'Gelir ve Giderler', label: 'Gelir ve gider ekleme' },
  { code: 'finance.edit', module: 'Gelir ve Giderler', label: 'Gelir ve gider düzenleme' },
  { code: 'finance.delete', module: 'Gelir ve Giderler', label: 'Gelir ve gider iptal etme' },
  { code: 'recurring.view', module: 'Sabit Giderler', label: 'Sabit gider görüntüleme' },
  { code: 'recurring.create', module: 'Sabit Giderler', label: 'Sabit gider kartı ekleme' },
  { code: 'recurring.edit', module: 'Sabit Giderler', label: 'Sabit gider kartı düzenleme' },
  { code: 'recurring.delete', module: 'Sabit Giderler', label: 'Sabit gider pasifleştirme' },
  { code: 'recurring.pay', module: 'Sabit Giderler', label: 'Sabit gider ödemesi kaydetme' },
  { code: 'users.manage', module: 'Kullanıcı Yönetimi', label: 'İşletme kullanıcılarını ve yetkilerini yönetme' },
  { code: 'booking.view', module: 'Online Randevu', label: 'Randevu takvimi, genel bakış ve yorumları görüntüleme' },
  { code: 'booking.manage', module: 'Online Randevu', label: 'Randevu oluşturma, düzenleme, onay ve iptal işlemleri' },
  { code: 'booking.services', module: 'Online Randevu', label: 'Randevu hizmet ve fiyatlarını yönetme' },
  { code: 'booking.staff', module: 'Online Randevu', label: 'Personel, çalışma saatleri ve izin yönetimi' },
  { code: 'booking.design', module: 'Online Randevu', label: 'Online randevu sayfası tasarımı ve ayarlarını yönetme' },
  { code: 'booking.payments', module: 'Online Randevu', label: 'Randevu tahsilatı ve iade işlemleri' },
];

export const ALL_PERMISSION_CODES = ALL_PERMISSIONS.map((p) => p.code);

export function hasPermission(
  member: { is_owner: boolean; permissions: string[] } | null | undefined,
  code: string
): boolean {
  if (!member) return false;
  if (member.is_owner) return true;
  return Array.isArray(member.permissions) && member.permissions.includes(code);
}
