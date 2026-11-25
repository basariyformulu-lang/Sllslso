-- EsnafTakip: 004_seed_defaults.sql
-- Sistem başlangıç ayarları, tek abonelik paketi ve yetki kataloğu

INSERT INTO public.system_settings (id, system_name, hero_slogan, contact_email, contact_phone)
VALUES (
  1,
  'EsnafTakip',
  'İşletmenizin tüm borç ve alacakları tek yerde.',
  'destek@esnaftakip.com',
  '0850 000 00 00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscription_plans (name, description, monthly_price, duration_days, features, is_active)
VALUES (
  'EsnafTakip İşletme Aboneliği',
  'Müşteri alacakları, toptancı borçları, vadeli satış takibi, gelir-gider ve aylık sabit gider planlama dahil eksiksiz işletme yönetimi.',
  490.00,
  30,
  '["Sınırsız müşteri ve toptancı cari takibi", "Otomatik vadeli satış ve vade uyarı sistemi", "Aylık sabit gider planlama ve gerçekleşme takibi", "Günlük, aylık ve dönem bazlı CSV/Excel raporları", "Yetki bazlı sınırsız işletme alt kullanıcısı", "Mobil, tablet ve masaüstü tam uyumlu panel"]'::jsonb,
  true
)
ON CONFLICT DO NOTHING;

INSERT INTO public.permissions (code, module, action, label_tr) VALUES
  ('reports.view', 'Genel Bakış', 'view', 'Raporları ve özeti görüntüleme'),
  ('customers.view', 'Müşteriler', 'view', 'Müşteri listeleme'),
  ('customers.create', 'Müşteriler', 'create', 'Müşteri ekleme'),
  ('customers.edit', 'Müşteriler', 'edit', 'Müşteri düzenleme'),
  ('customers.delete', 'Müşteriler', 'delete', 'Müşteri silme / iptal'),
  ('customers.add_debt', 'Müşteriler', 'add_debt', 'Müşteriye borç ekleme'),
  ('customers.add_payment', 'Müşteriler', 'add_payment', 'Müşteriden ödeme alma'),
  ('suppliers.view', 'Toptancılar', 'view', 'Toptancı listeleme'),
  ('suppliers.create', 'Toptancılar', 'create', 'Toptancı ekleme'),
  ('suppliers.edit', 'Toptancılar', 'edit', 'Toptancı düzenleme'),
  ('suppliers.delete', 'Toptancılar', 'delete', 'Toptancı silme / iptal'),
  ('suppliers.add_debt', 'Toptancılar', 'add_debt', 'Toptancıya borç ekleme'),
  ('suppliers.add_payment', 'Toptancılar', 'add_payment', 'Toptancıya ödeme yapma'),
  ('credit_sales.view', 'Vadeli Satışlar', 'view', 'Vadeli satış listeleme'),
  ('credit_sales.create', 'Vadeli Satışlar', 'create', 'Vadeli satış ekleme'),
  ('credit_sales.edit', 'Vadeli Satışlar', 'edit', 'Vadeli satış düzenleme'),
  ('credit_sales.delete', 'Vadeli Satışlar', 'delete', 'Vadeli satış iptal'),
  ('finance.view', 'Gelir ve Giderler', 'view', 'Gelir ve gider listeleme'),
  ('finance.create', 'Gelir ve Giderler', 'create', 'Gelir ve gider ekleme'),
  ('finance.edit', 'Gelir ve Giderler', 'edit', 'Gelir ve gider düzenleme'),
  ('finance.delete', 'Gelir ve Giderler', 'delete', 'Gelir ve gider iptal'),
  ('recurring.view', 'Sabit Giderler', 'view', 'Sabit gider görüntüleme'),
  ('recurring.create', 'Sabit Giderler', 'create', 'Sabit gider ekleme'),
  ('recurring.edit', 'Sabit Giderler', 'edit', 'Sabit gider düzenleme'),
  ('recurring.delete', 'Sabit Giderler', 'delete', 'Sabit gider silme / pasifleştirme'),
  ('recurring.pay', 'Sabit Giderler', 'pay', 'Sabit gider ödeme kaydetme'),
  ('users.manage', 'Kullanıcılar', 'manage', 'İşletme kullanıcı ve yetki yönetimi')
ON CONFLICT (code) DO NOTHING;
