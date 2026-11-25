-- EsnafTakip: 001_initial_schema.sql
-- Multi-tenant Cari Hesap, Vadeli Satış, Sabit Gider ve Abonelik SaaS Şeması
-- Saat dilimi: Europe/Istanbul | Para birimi: TRY (NUMERIC 14,2)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Kullanıcı Profilleri (Supabase Auth ile senkron)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Sistem Yöneticileri (Tamamen izole yetki tablosu)
CREATE TABLE IF NOT EXISTS public.system_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Sistem Genel Ayarları (Tek satır)
CREATE TABLE IF NOT EXISTS public.system_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  system_name TEXT NOT NULL DEFAULT 'EsnafTakip',
  logo_url TEXT NOT NULL DEFAULT '',
  hero_slogan TEXT NOT NULL DEFAULT 'İşletmenizin tüm borç ve alacakları tek yerde.',
  hero_subheadline TEXT NOT NULL DEFAULT 'Bakkallar, büfeler, marketler ve toptancılar için müşteri alacakları, toptancı borçları, vadeli satışlar ve aylık sabit giderleri zahmetsizce takip edin.',
  contact_email TEXT NOT NULL DEFAULT 'destek@esnaftakip.com',
  contact_phone TEXT NOT NULL DEFAULT '0850 000 00 00',
  pricing_description TEXT NOT NULL DEFAULT 'Tüm özellikler tek pakette. Gizli ücret, modül kısıtı veya kullanıcı sınırı yok.',
  terms_of_service TEXT NOT NULL DEFAULT 'EsnafTakip hizmet kullanım koşulları gereği işletme finansal kayıtlarının doğruluğu işletme sorumluluğundadır. Abonelik aylık dönemler halinde havale/EFT onayı ile aktif edilir.',
  privacy_policy TEXT NOT NULL DEFAULT 'EsnafTakip KVKK ve gizlilik politikası kapsamında her işletmenin cari ve finansal verileri diğer işletmelerden tamamen izole biçimde saklanır ve üçüncü taraflarla paylaşılmaz.',
  updated_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tek Abonelik Paketi (Veritabanı seviyesinde tek kayıt garantisi)
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'EsnafTakip Standart İşletme Paketi',
  description TEXT NOT NULL DEFAULT 'Küçük ve orta ölçekli işletmeler için eksiksiz cari hesap, vadeli satış, sabit gider ve raporlama paketi.',
  monthly_price NUMERIC(14,2) NOT NULL CHECK (monthly_price >= 0),
  duration_days INTEGER NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  effective_from DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Istanbul')::DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_single_subscription_plan
  ON public.subscription_plans ((true));

-- 5. İşletmeler
CREATE TABLE IF NOT EXISTS public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_code TEXT NOT NULL UNIQUE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  subscription_status TEXT NOT NULL DEFAULT 'payment_pending'
    CHECK (subscription_status IN ('active', 'passive', 'payment_pending', 'pending_approval', 'expired', 'suspended')),
  subscription_start_at TIMESTAMPTZ,
  subscription_end_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_businesses_owner ON public.businesses(owner_id);
CREATE INDEX IF NOT EXISTS idx_businesses_sub_status ON public.businesses(subscription_status);

-- 6. Roller & Yetkiler
CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_owner_role BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  label_tr TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 7. İşletme Üyeleri
CREATE TABLE IF NOT EXISTS public.business_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id UUID REFERENCES public.roles(id) ON DELETE SET NULL,
  role_name TEXT NOT NULL DEFAULT 'Personel',
  is_owner BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_members_user ON public.business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_business_members_business ON public.business_members(business_id);

-- 8. Abonelikler (İşletme abonelik durumu ve kilitli fiyat)
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'payment_pending'
    CHECK (status IN ('active', 'passive', 'payment_pending', 'pending_approval', 'expired', 'suspended')),
  locked_price NUMERIC(14,2) NOT NULL CHECK (locked_price >= 0),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  last_payment_at TIMESTAMPTZ,
  updated_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Yönetici Banka / IBAN Hesapları
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name TEXT NOT NULL,
  iban TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_default_bank_account
  ON public.bank_accounts ((true)) WHERE is_default = true;

-- 10. Ödeme Talepleri (Havale / EFT Onay Süreci)
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  bank_snapshot JSONB NOT NULL,
  payer_name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  receipt_url TEXT,
  receipt_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejected_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_pending_payment_per_business
  ON public.payment_requests (business_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON public.payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_business ON public.payment_requests(business_id);

-- 11. Müşteriler
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  registered_at DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Istanbul')::DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_business ON public.customers(business_id);

-- 12. Vadeli Satışlar
CREATE TABLE IF NOT EXISTS public.credit_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  sale_date DATE NOT NULL,
  due_months INTEGER,
  due_date DATE NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  cancelled_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_sales_business ON public.credit_sales(business_id);
CREATE INDEX IF NOT EXISTS idx_credit_sales_customer ON public.credit_sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_sales_due_date ON public.credit_sales(due_date);

-- 13. Müşteri Cari Hareketleri (Borç / Tahsilat / Ters Kayıt)
CREATE TABLE IF NOT EXISTS public.customer_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  credit_sale_id UUID REFERENCES public.credit_sales(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('debt', 'payment', 'reversal')),
  debt_category TEXT NOT NULL DEFAULT 'Cari Borç',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  signed_amount NUMERIC(14,2) NOT NULL,
  transaction_date DATE NOT NULL,
  due_date DATE,
  payment_method TEXT CHECK (payment_method IN ('nakit', 'banka', 'kart', 'diger') OR payment_method IS NULL),
  description TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  is_overpayment BOOLEAN NOT NULL DEFAULT false,
  reversed_transaction_id UUID REFERENCES public.customer_transactions(id),
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cust_tx_business ON public.customer_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_cust_tx_customer ON public.customer_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_tx_date ON public.customer_transactions(transaction_date);

-- 14. Toptancılar / Tedarikçiler
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_business ON public.suppliers(business_id);

-- 15. Toptancı Cari Hareketleri (Borç / Ödeme / Ters Kayıt)
CREATE TABLE IF NOT EXISTS public.supplier_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('debt', 'payment', 'reversal')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  signed_amount NUMERIC(14,2) NOT NULL,
  transaction_date DATE NOT NULL,
  due_date DATE,
  payment_method TEXT CHECK (payment_method IN ('nakit', 'banka', 'kart', 'diger') OR payment_method IS NULL),
  description TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  is_overpayment BOOLEAN NOT NULL DEFAULT false,
  reversed_transaction_id UUID REFERENCES public.supplier_transactions(id),
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supp_tx_business ON public.supplier_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_supp_tx_supplier ON public.supplier_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supp_tx_date ON public.supplier_transactions(transaction_date);

-- 16. Gelir & Gider Kategorileri
CREATE TABLE IF NOT EXISTS public.income_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, name)
);

-- 17. Gelir Hareketleri
CREATE TABLE IF NOT EXISTS public.income_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.income_categories(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL DEFAULT 'Diğer',
  title TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES public.profiles(id),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_income_tx_business ON public.income_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_income_tx_date ON public.income_transactions(transaction_date);

-- 18. Gider Hareketleri
CREATE TABLE IF NOT EXISTS public.expense_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL DEFAULT 'Diğer',
  title TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  transaction_date DATE NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'nakit' CHECK (payment_method IN ('nakit', 'banka', 'kart', 'diger')),
  description TEXT NOT NULL DEFAULT '',
  recurring_period_id UUID,
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES public.profiles(id),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_tx_business ON public.expense_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_expense_tx_date ON public.expense_transactions(transaction_date);

-- 19. Sabit Gider Kartları
CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('Kira', 'Elektrik', 'Su', 'İnternet', 'Personel', 'Muhasebe Ücreti', 'Diğer')),
  title TEXT NOT NULL,
  monthly_amount NUMERIC(14,2) NOT NULL CHECK (monthly_amount > 0),
  start_date DATE NOT NULL,
  end_date DATE,
  payment_day INTEGER NOT NULL CHECK (payment_day BETWEEN 1 AND 31),
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
  description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_business ON public.recurring_expenses(business_id);

-- 20. Sabit Gider Aylık Dönemleri (Çifte ödeme korumalı)
CREATE TABLE IF NOT EXISTS public.recurring_expense_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recurring_expense_id UUID NOT NULL REFERENCES public.recurring_expenses(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  due_date DATE NOT NULL,
  planned_amount NUMERIC(14,2) NOT NULL CHECK (planned_amount > 0),
  paid_amount NUMERIC(14,2),
  paid_date DATE,
  payment_method TEXT CHECK (payment_method IN ('nakit', 'banka', 'kart', 'diger') OR payment_method IS NULL),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'skipped')),
  expense_transaction_id UUID REFERENCES public.expense_transactions(id) ON DELETE SET NULL,
  paid_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recurring_expense_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_rec_periods_business ON public.recurring_expense_periods(business_id);

-- 21. Bildirimler
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_business ON public.notifications(business_id);

-- 22. Denetim Kayıtları (Audit Logs)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('business', 'admin')),
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  old_values JSONB,
  new_values JSONB,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_scope ON public.audit_logs(scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_business ON public.audit_logs(business_id, created_at DESC);

-- 23. Silinen İşletme Arşivi (Hukuki/Denetim Saklama)
CREATE TABLE IF NOT EXISTS public.deleted_business_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_business_id UUID NOT NULL,
  business_name TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT '',
  snapshot JSONB NOT NULL,
  deleted_by UUID REFERENCES public.profiles(id),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
