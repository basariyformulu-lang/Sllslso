-- EsnafTakip Tek Seferlik Tam Kurulum SQL (001 + 002 + 003 + 004)
-- Bu dosyanin tamamini Supabase SQL Editor icine yapistirip Run butonuna basabilirsiniz.

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


-- EsnafTakip: 002_rls_policies.sql
-- Katı Çok-İşletmeli İzolasyon ve Sistem Yöneticisi Güvenlik Politikaları

-- Helper: Sistem yöneticisi mi?
CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.system_admins
    WHERE user_id = auth.uid() AND is_active = true
  );
$$;

-- Helper: Belirli bir işletmenin aktif üyesi mi?
CREATE OR REPLACE FUNCTION public.is_business_member(target_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = target_business_id
      AND user_id = auth.uid()
      AND is_active = true
  );
$$;

-- Helper: İşletmenin aboneliği aktif mi?
CREATE OR REPLACE FUNCTION public.has_active_subscription(target_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = target_business_id
      AND is_active = true
      AND subscription_status = 'active'
      AND (subscription_end_at IS NULL OR subscription_end_at > NOW())
  );
$$;

-- Helper: Kullanıcının belirli bir yetkisi var mı?
CREATE OR REPLACE FUNCTION public.has_business_permission(target_business_id UUID, perm_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.business_members%ROWTYPE;
BEGIN
  SELECT * INTO v_member
  FROM public.business_members
  WHERE business_id = target_business_id
    AND user_id = auth.uid()
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_member.is_owner THEN
    RETURN true;
  END IF;

  RETURN (v_member.permissions ? perm_code);
END;
$$;

-- Tüm tablolarda RLS aktif
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_expense_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_business_archives ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_system_admin() OR EXISTS (
    SELECT 1 FROM public.business_members bm1
    JOIN public.business_members bm2 ON bm1.business_id = bm2.business_id
    WHERE bm1.user_id = auth.uid() AND bm2.user_id = profiles.id AND bm1.is_active = true
  ));

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- System Admins: yalnızca adminler görebilir, normal kullanıcı değiştiremez
DROP POLICY IF EXISTS "system_admins_select" ON public.system_admins;
CREATE POLICY "system_admins_select" ON public.system_admins
  FOR SELECT USING (user_id = auth.uid() OR public.is_system_admin());

-- System Settings: herkese açık okuma (tanıtım/iletişim), yalnızca admin güncelleme
DROP POLICY IF EXISTS "system_settings_public_read" ON public.system_settings;
CREATE POLICY "system_settings_public_read" ON public.system_settings
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "system_settings_admin_write" ON public.system_settings;
CREATE POLICY "system_settings_admin_write" ON public.system_settings
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Subscription Plans: herkese açık okuma, yalnızca admin yazma
DROP POLICY IF EXISTS "subscription_plans_public_read" ON public.subscription_plans;
CREATE POLICY "subscription_plans_public_read" ON public.subscription_plans
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "subscription_plans_admin_write" ON public.subscription_plans;
CREATE POLICY "subscription_plans_admin_write" ON public.subscription_plans
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Bank Accounts: giriş yapmış işletmeler aktif hesapları görebilir, admin hepsini yönetir
DROP POLICY IF EXISTS "bank_accounts_read_active" ON public.bank_accounts;
CREATE POLICY "bank_accounts_read_active" ON public.bank_accounts
  FOR SELECT USING (is_active = true OR public.is_system_admin());
DROP POLICY IF EXISTS "bank_accounts_admin_write" ON public.bank_accounts;
CREATE POLICY "bank_accounts_admin_write" ON public.bank_accounts
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Businesses: üyesi veya admin okuyabilir; normal kullanıcı abonelik alanlarını değiştiremez (backend API/admin yönetir)
DROP POLICY IF EXISTS "businesses_select" ON public.businesses;
CREATE POLICY "businesses_select" ON public.businesses
  FOR SELECT USING (public.is_business_member(id) OR public.is_system_admin());
DROP POLICY IF EXISTS "businesses_admin_all" ON public.businesses;
CREATE POLICY "businesses_admin_all" ON public.businesses
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Subscriptions: üyesi veya admin okuyabilir; yalnızca admin değiştirebilir
DROP POLICY IF EXISTS "subscriptions_select" ON public.subscriptions;
CREATE POLICY "subscriptions_select" ON public.subscriptions
  FOR SELECT USING (public.is_business_member(business_id) OR public.is_system_admin());
DROP POLICY IF EXISTS "subscriptions_admin_all" ON public.subscriptions;
CREATE POLICY "subscriptions_admin_all" ON public.subscriptions
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Payment Requests: üyesi kendi taleplerini okuyabilir/oluşturabilir (pending), onay/red yalnızca admin
DROP POLICY IF EXISTS "payment_requests_select" ON public.payment_requests;
CREATE POLICY "payment_requests_select" ON public.payment_requests
  FOR SELECT USING (public.is_business_member(business_id) OR public.is_system_admin());
DROP POLICY IF EXISTS "payment_requests_insert_member" ON public.payment_requests;
CREATE POLICY "payment_requests_insert_member" ON public.payment_requests
  FOR INSERT WITH CHECK (public.is_business_member(business_id) AND status = 'pending');
DROP POLICY IF EXISTS "payment_requests_admin_update" ON public.payment_requests;
CREATE POLICY "payment_requests_admin_update" ON public.payment_requests
  FOR UPDATE USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Business Members
DROP POLICY IF EXISTS "business_members_select" ON public.business_members;
CREATE POLICY "business_members_select" ON public.business_members
  FOR SELECT USING (public.is_business_member(business_id) OR public.is_system_admin());

-- Permissions katalogu herkesçe okunabilir
DROP POLICY IF EXISTS "permissions_select_all" ON public.permissions;
CREATE POLICY "permissions_select_all" ON public.permissions FOR SELECT USING (true);

-- İşletme verileri (aktif abonelik + üyelik + yetki kontrolü)
DROP POLICY IF EXISTS "customers_select" ON public.customers;
CREATE POLICY "customers_select" ON public.customers
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'customers.view'));
DROP POLICY IF EXISTS "customers_insert" ON public.customers;
CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'customers.create'));
DROP POLICY IF EXISTS "customers_update" ON public.customers;
CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'customers.edit'));

DROP POLICY IF EXISTS "credit_sales_select" ON public.credit_sales;
CREATE POLICY "credit_sales_select" ON public.credit_sales
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'credit_sales.view'));
DROP POLICY IF EXISTS "credit_sales_insert" ON public.credit_sales;
CREATE POLICY "credit_sales_insert" ON public.credit_sales
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'credit_sales.create'));
DROP POLICY IF EXISTS "credit_sales_update" ON public.credit_sales;
CREATE POLICY "credit_sales_update" ON public.credit_sales
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'credit_sales.edit'));

DROP POLICY IF EXISTS "customer_tx_select" ON public.customer_transactions;
CREATE POLICY "customer_tx_select" ON public.customer_transactions
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'customers.view'));
DROP POLICY IF EXISTS "customer_tx_insert" ON public.customer_transactions;
CREATE POLICY "customer_tx_insert" ON public.customer_transactions
  FOR INSERT WITH CHECK (
    public.has_active_subscription(business_id) AND (
      (transaction_type = 'debt' AND public.has_business_permission(business_id, 'customers.add_debt')) OR
      (transaction_type = 'payment' AND public.has_business_permission(business_id, 'customers.add_payment')) OR
      (transaction_type = 'reversal' AND public.has_business_permission(business_id, 'customers.delete'))
    )
  );

DROP POLICY IF EXISTS "suppliers_select" ON public.suppliers;
CREATE POLICY "suppliers_select" ON public.suppliers
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'suppliers.view'));
DROP POLICY IF EXISTS "suppliers_insert" ON public.suppliers;
CREATE POLICY "suppliers_insert" ON public.suppliers
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'suppliers.create'));
DROP POLICY IF EXISTS "suppliers_update" ON public.suppliers;
CREATE POLICY "suppliers_update" ON public.suppliers
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'suppliers.edit'));

DROP POLICY IF EXISTS "supplier_tx_select" ON public.supplier_transactions;
CREATE POLICY "supplier_tx_select" ON public.supplier_transactions
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'suppliers.view'));
DROP POLICY IF EXISTS "supplier_tx_insert" ON public.supplier_transactions;
CREATE POLICY "supplier_tx_insert" ON public.supplier_transactions
  FOR INSERT WITH CHECK (
    public.has_active_subscription(business_id) AND (
      (transaction_type = 'debt' AND public.has_business_permission(business_id, 'suppliers.add_debt')) OR
      (transaction_type = 'payment' AND public.has_business_permission(business_id, 'suppliers.add_payment')) OR
      (transaction_type = 'reversal' AND public.has_business_permission(business_id, 'suppliers.delete'))
    )
  );

DROP POLICY IF EXISTS "income_categories_all" ON public.income_categories;
CREATE POLICY "income_categories_all" ON public.income_categories
  FOR ALL USING (public.has_active_subscription(business_id) AND public.is_business_member(business_id));
DROP POLICY IF EXISTS "expense_categories_all" ON public.expense_categories;
CREATE POLICY "expense_categories_all" ON public.expense_categories
  FOR ALL USING (public.has_active_subscription(business_id) AND public.is_business_member(business_id));

DROP POLICY IF EXISTS "income_tx_select" ON public.income_transactions;
CREATE POLICY "income_tx_select" ON public.income_transactions
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.view'));
DROP POLICY IF EXISTS "income_tx_insert" ON public.income_transactions;
CREATE POLICY "income_tx_insert" ON public.income_transactions
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.create'));
DROP POLICY IF EXISTS "income_tx_update" ON public.income_transactions;
CREATE POLICY "income_tx_update" ON public.income_transactions
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.edit'));

DROP POLICY IF EXISTS "expense_tx_select" ON public.expense_transactions;
CREATE POLICY "expense_tx_select" ON public.expense_transactions
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.view'));
DROP POLICY IF EXISTS "expense_tx_insert" ON public.expense_transactions;
CREATE POLICY "expense_tx_insert" ON public.expense_transactions
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.create'));
DROP POLICY IF EXISTS "expense_tx_update" ON public.expense_transactions;
CREATE POLICY "expense_tx_update" ON public.expense_transactions
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.edit'));

DROP POLICY IF EXISTS "recurring_expenses_select" ON public.recurring_expenses;
CREATE POLICY "recurring_expenses_select" ON public.recurring_expenses
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.view'));
DROP POLICY IF EXISTS "recurring_expenses_insert" ON public.recurring_expenses;
CREATE POLICY "recurring_expenses_insert" ON public.recurring_expenses
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.create'));
DROP POLICY IF EXISTS "recurring_expenses_update" ON public.recurring_expenses;
CREATE POLICY "recurring_expenses_update" ON public.recurring_expenses
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.edit'));

DROP POLICY IF EXISTS "recurring_periods_select" ON public.recurring_expense_periods;
CREATE POLICY "recurring_periods_select" ON public.recurring_expense_periods
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.view'));
DROP POLICY IF EXISTS "recurring_periods_insert" ON public.recurring_expense_periods;
CREATE POLICY "recurring_periods_insert" ON public.recurring_expense_periods
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.view'));
DROP POLICY IF EXISTS "recurring_periods_update" ON public.recurring_expense_periods;
CREATE POLICY "recurring_periods_update" ON public.recurring_expense_periods
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.pay'));

-- Notifications
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (public.is_business_member(business_id) OR user_id = auth.uid() OR public.is_system_admin());
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE USING (public.is_business_member(business_id) OR user_id = auth.uid());

-- Audit Logs: admin kapsamı yalnızca adminlerce görülebilir, işletme kapsamı yalnızca o işletme üyelerince
DROP POLICY IF EXISTS "audit_logs_select" ON public.audit_logs;
CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT USING (
    (scope = 'admin' AND public.is_system_admin()) OR
    (scope = 'business' AND public.is_business_member(business_id))
  );

-- Deleted Business Archives: yalnızca admin
DROP POLICY IF EXISTS "deleted_archives_admin_only" ON public.deleted_business_archives;
CREATE POLICY "deleted_archives_admin_only" ON public.deleted_business_archives
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());


-- EsnafTakip: 003_functions_and_triggers.sql
-- Atomik finansal işlemler, ödeme onayı ve sabit gider dönem ödeme fonksiyonları

-- 1. Yeni Auth kullanıcısında otomatik profil oluşturma
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Yönetici Ödeme Talebi Onaylama (Atomik, Çifte Onay Korumalı)
CREATE OR REPLACE FUNCTION public.admin_approve_payment_request(
  p_request_id UUID,
  p_admin_id UUID,
  p_start_at TIMESTAMPTZ,
  p_end_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.payment_requests%ROWTYPE;
  v_biz public.businesses%ROWTYPE;
  v_admin_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.system_admins WHERE user_id = p_admin_id AND is_active = true) THEN
    RAISE EXCEPTION 'Yetkisiz işlem: Sistem yöneticisi değilsiniz.';
  END IF;

  SELECT full_name INTO v_admin_name FROM public.system_admins WHERE user_id = p_admin_id;

  SELECT * INTO v_req FROM public.payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ödeme talebi bulunamadı.';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Bu ödeme talebi zaten işleme alınmış (Durum: %).', v_req.status;
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE id = v_req.business_id FOR UPDATE;

  UPDATE public.payment_requests
  SET status = 'approved',
      reviewed_by = p_admin_id,
      reviewed_at = NOW()
  WHERE id = p_request_id;

  UPDATE public.businesses
  SET subscription_status = 'active',
      subscription_start_at = p_start_at,
      subscription_end_at = p_end_at,
      is_active = true,
      updated_at = NOW()
  WHERE id = v_req.business_id;

  UPDATE public.subscriptions
  SET status = 'active',
      start_date = p_start_at,
      end_date = p_end_at,
      last_payment_at = NOW(),
      updated_by = p_admin_id,
      updated_at = NOW()
  WHERE business_id = v_req.business_id;

  INSERT INTO public.notifications (business_id, type, title, message, link)
  VALUES (
    v_req.business_id,
    'payment_approved',
    'Ödemeniz Onaylandı',
    'Abonelik ödemeniz onaylandı ve işletme paneliniz aktif hale getirildi.',
    '/panel'
  );

  INSERT INTO public.audit_logs (scope, business_id, actor_user_id, actor_name, action, entity_type, entity_id, old_values, new_values, description)
  VALUES (
    'admin',
    v_req.business_id,
    p_admin_id,
    COALESCE(v_admin_name, 'Sistem Yöneticisi'),
    'payment_approved',
    'payment_requests',
    p_request_id::TEXT,
    jsonb_build_object('status', v_req.status, 'subscription_status', v_biz.subscription_status),
    jsonb_build_object('status', 'approved', 'subscription_status', 'active', 'start_at', p_start_at, 'end_at', p_end_at, 'amount', v_req.amount),
    'Ödeme talebi onaylandı ve abonelik aktif edildi.'
  );

  RETURN jsonb_build_object('success', true, 'business_id', v_req.business_id);
END;
$$;

-- 3. Sabit Gider Dönemi Ödeme (Atomik, Aynı Aya Çifte Ödeme Korumalı)
CREATE OR REPLACE FUNCTION public.pay_recurring_expense_period(
  p_period_id UUID,
  p_business_id UUID,
  p_user_id UUID,
  p_paid_amount NUMERIC(14,2),
  p_paid_date DATE,
  p_payment_method TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period public.recurring_expense_periods%ROWTYPE;
  v_rec public.recurring_expenses%ROWTYPE;
  v_exp_id UUID;
  v_cat_id UUID;
BEGIN
  SELECT * INTO v_period
  FROM public.recurring_expense_periods
  WHERE id = p_period_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sabit gider dönemi bulunamadı.';
  END IF;

  IF v_period.status = 'paid' THEN
    RAISE EXCEPTION 'Bu aya ait sabit gider zaten ödenmiş olarak kaydedilmiş.';
  END IF;

  SELECT * INTO v_rec FROM public.recurring_expenses WHERE id = v_period.recurring_expense_id;

  SELECT id INTO v_cat_id
  FROM public.expense_categories
  WHERE business_id = p_business_id AND name = v_rec.category
  LIMIT 1;

  INSERT INTO public.expense_transactions (
    business_id, category_id, category_name, title, amount, transaction_date,
    payment_method, description, recurring_period_id, created_by
  ) VALUES (
    p_business_id,
    v_cat_id,
    v_rec.category,
    v_rec.title || ' (' || LPAD(v_period.period_month::TEXT, 2, '0') || '.' || v_period.period_year::TEXT || ')',
    p_paid_amount,
    p_paid_date,
    p_payment_method,
    'Sabit gider dönem ödemesi',
    p_period_id,
    p_user_id
  )
  RETURNING id INTO v_exp_id;

  UPDATE public.recurring_expense_periods
  SET status = 'paid',
      paid_amount = p_paid_amount,
      paid_date = p_paid_date,
      payment_method = p_payment_method,
      expense_transaction_id = v_exp_id,
      paid_by = p_user_id,
      updated_at = NOW()
  WHERE id = p_period_id;

  INSERT INTO public.audit_logs (scope, business_id, actor_user_id, action, entity_type, entity_id, new_values, description)
  VALUES (
    'business',
    p_business_id,
    p_user_id,
    'recurring_period_paid',
    'recurring_expense_periods',
    p_period_id::TEXT,
    jsonb_build_object('paid_amount', p_paid_amount, 'paid_date', p_paid_date, 'expense_id', v_exp_id),
    'Sabit gider dönem ödemesi gerçekleştirildi.'
  );

  RETURN jsonb_build_object('success', true, 'expense_transaction_id', v_exp_id);
END;
$$;


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

-- Supabase API Rolleri için Şema ve Tablo Erişim İzinleri (42501 hatasını önler)
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;

