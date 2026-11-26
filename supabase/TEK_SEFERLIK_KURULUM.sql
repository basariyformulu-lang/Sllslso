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

-- ==========================================================
-- 005 ONLINE RANDEVU MODULU
-- ==========================================================

-- EsnafTakip: 005_online_booking_module.sql
-- Online Randevu Modülü: Sayfalar, Tasarım Editörü, Hizmetler, Personel, Müsaitlik,
-- Atomik Çakışmasız Randevu, Müşteri Portalı, Doğrulanmış Yorumlar ve Finans Entegrasyonu

CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- 1. Mevcut SaaS tablolarına randevu modülü abonelik/erişim alanları
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS booking_module_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_module_mode TEXT NOT NULL DEFAULT 'included'
    CHECK (booking_module_mode IN ('included', 'addon_active', 'addon_locked'));

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS booking_module_default_included BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_module_addon_price NUMERIC(14,2) NOT NULL DEFAULT 0;

-- 2. Yeni Randevu Yetkileri
INSERT INTO public.permissions (code, module, action, label_tr) VALUES
  ('booking.view', 'Online Randevu', 'view', 'Randevu takvimi, genel bakış ve yorumları görüntüleme'),
  ('booking.manage', 'Online Randevu', 'manage', 'Randevu oluşturma, düzenleme, onay ve iptal işlemleri'),
  ('booking.services', 'Online Randevu', 'services', 'Randevu hizmet ve fiyatlarını yönetme'),
  ('booking.staff', 'Online Randevu', 'staff', 'Personel, çalışma saatleri ve izin yönetimi'),
  ('booking.design', 'Online Randevu', 'design', 'Online randevu sayfası tasarımı ve ayarlarını yönetme'),
  ('booking.payments', 'Online Randevu', 'payments', 'Randevu tahsilatı ve iade işlemleri')
ON CONFLICT (code) DO NOTHING;

-- Mevcut işletme sahiplerinin yetki dizisine yeni randevu yetkilerini ekle
UPDATE public.business_members
SET permissions = (
  SELECT jsonb_agg(DISTINCT elem)
  FROM jsonb_array_elements_text(
    COALESCE(permissions, '[]'::jsonb) ||
    '["booking.view","booking.manage","booking.services","booking.staff","booking.design","booking.payments"]'::jsonb
  ) AS elem
)
WHERE is_owner = true;

-- 3. İşletme Online Randevu Sayfası & Tasarım Editörü
CREATE TABLE IF NOT EXISTS public.booking_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  page_title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT NOT NULL DEFAULT '',
  gallery_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  map_location TEXT NOT NULL DEFAULT '',
  instagram_url TEXT NOT NULL DEFAULT '',
  theme_preset TEXT NOT NULL DEFAULT 'classic_navy'
    CHECK (theme_preset IN ('classic_navy', 'botanical_emerald', 'warm_atelier', 'minimal_mono', 'soft_rose')),
  primary_color TEXT NOT NULL DEFAULT '#0F2942',
  secondary_color TEXT NOT NULL DEFAULT '#064E3B',
  section_visibility JSONB NOT NULL DEFAULT '{"hero":true,"services":true,"staff":true,"gallery":true,"reviews":true,"hours":true,"contact":true}'::jsonb,
  business_hours JSONB NOT NULL DEFAULT '[
    {"day":1,"label":"Pazartesi","open":"09:00","close":"19:00","is_open":true},
    {"day":2,"label":"Salı","open":"09:00","close":"19:00","is_open":true},
    {"day":3,"label":"Çarşamba","open":"09:00","close":"19:00","is_open":true},
    {"day":4,"label":"Perşembe","open":"09:00","close":"19:00","is_open":true},
    {"day":5,"label":"Cuma","open":"09:00","close":"19:00","is_open":true},
    {"day":6,"label":"Cumartesi","open":"09:00","close":"19:00","is_open":true},
    {"day":0,"label":"Pazar","open":"10:00","close":"17:00","is_open":false}
  ]'::jsonb,
  slot_interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (slot_interval_minutes IN (10, 15, 20, 30, 45, 60)),
  min_advance_minutes INTEGER NOT NULL DEFAULT 60 CHECK (min_advance_minutes >= 0),
  max_advance_days INTEGER NOT NULL DEFAULT 30 CHECK (max_advance_days BETWEEN 1 AND 180),
  cancellation_deadline_hours INTEGER NOT NULL DEFAULT 2 CHECK (cancellation_deadline_hours >= 0),
  auto_confirm BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_pages_slug ON public.booking_pages(slug);
CREATE INDEX IF NOT EXISTS idx_booking_pages_status ON public.booking_pages(status);

-- 4. Hizmetler ve Fiyatlar
CREATE TABLE IF NOT EXISTS public.booking_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  discount_price NUMERIC(14,2) CHECK (discount_price IS NULL OR discount_price >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_services_business ON public.booking_services(business_id, sort_order);

-- 5. Personel
CREATE TABLE IF NOT EXISTS public.booking_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  specialties TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_staff_business ON public.booking_staff(business_id, sort_order);

-- 6. Personel - Hizmet Eşleştirmesi
CREATE TABLE IF NOT EXISTS public.staff_services (
  staff_id UUID NOT NULL REFERENCES public.booking_staff(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.booking_services(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_services_business ON public.staff_services(business_id);

-- 7. Personel Çalışma Saatleri
CREATE TABLE IF NOT EXISTS public.staff_working_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.booking_staff(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_working BOOLEAN NOT NULL DEFAULT true,
  start_time TIME NOT NULL DEFAULT '09:00',
  end_time TIME NOT NULL DEFAULT '19:00',
  UNIQUE (staff_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_staff_wh_business ON public.staff_working_hours(business_id, staff_id);

-- 8. Personel Mola Saatleri
CREATE TABLE IF NOT EXISTS public.staff_breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.booking_staff(id) ON DELETE CASCADE,
  day_of_week INTEGER CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  title TEXT NOT NULL DEFAULT 'Mola',
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_staff_breaks_staff ON public.staff_breaks(staff_id);

-- 9. İzin ve Tatil Günleri (staff_id NULL ise tüm işletme kapalıdır)
CREATE TABLE IF NOT EXISTS public.staff_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES public.booking_staff(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_leaves_business_dates ON public.staff_leaves(business_id, start_date, end_date);

-- 10. Randevu Müşteri Hesapları (Auth ile bağlı global müşteri profili)
CREATE TABLE IF NOT EXISTS public.customer_accounts (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. İşletme Randevu Müşterileri (İşletme içi müşteri rehberi + online müşteri bağlantısı)
CREATE TABLE IF NOT EXISTS public.booking_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_customers_biz_user
  ON public.booking_customers(business_id, customer_user_id)
  WHERE customer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_customers_business ON public.booking_customers(business_id);

-- 12. Randevular (Sabitlenmiş fiyat/hizmet anlık görüntüsü + eş zamanlı çakışma engeli)
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_customer_id UUID NOT NULL REFERENCES public.booking_customers(id) ON DELETE RESTRICT,
  customer_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  service_id UUID REFERENCES public.booking_services(id) ON DELETE SET NULL,
  staff_id UUID REFERENCES public.booking_staff(id) ON DELETE RESTRICT,
  service_name_snapshot TEXT NOT NULL,
  service_price_snapshot NUMERIC(14,2) NOT NULL CHECK (service_price_snapshot >= 0),
  service_duration_snapshot INTEGER NOT NULL CHECK (service_duration_snapshot > 0),
  staff_name_snapshot TEXT NOT NULL,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded')),
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  customer_notes TEXT NOT NULL DEFAULT '',
  business_notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'panel')),
  cancelled_by TEXT CHECK (cancelled_by IN ('customer', 'business') OR cancelled_by IS NULL),
  cancellation_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_appointments_business_date ON public.appointments(business_id, appointment_date, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_staff_range ON public.appointments(staff_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_appointments_customer_user ON public.appointments(customer_user_id, start_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'excl_no_staff_appointment_overlap'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT excl_no_staff_appointment_overlap
      EXCLUDE USING gist (
        staff_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
      )
      WHERE (staff_id IS NOT NULL AND status IN ('pending', 'confirmed', 'completed'));
  END IF;
END $$;

-- 13. Randevu Ödemeleri (Mevcut Gelir/Gider Tablolarıyla 1-1 Bağlantılı)
CREATE TABLE IF NOT EXISTS public.appointment_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_type TEXT NOT NULL DEFAULT 'collection' CHECK (payment_type IN ('collection', 'refund')),
  payment_method TEXT NOT NULL DEFAULT 'nakit' CHECK (payment_method IN ('nakit', 'banka', 'kart', 'diger')),
  payment_date DATE NOT NULL,
  income_transaction_id UUID UNIQUE REFERENCES public.income_transactions(id) ON DELETE SET NULL,
  expense_transaction_id UUID UNIQUE REFERENCES public.expense_transactions(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointment_payment_idempotency
  ON public.appointment_payments(business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointment_payments_appt ON public.appointment_payments(appointment_id);

-- 14. Doğrulanmış Müşteri Yorumları (Yalnızca tamamlanan randevular için tek yorum)
CREATE TABLE IF NOT EXISTS public.appointment_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
  customer_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_id UUID REFERENCES public.booking_services(id) ON DELETE SET NULL,
  staff_id UUID REFERENCES public.booking_staff(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  business_reply TEXT,
  replied_at TIMESTAMPTZ,
  replied_by UUID REFERENCES public.profiles(id),
  moderation_status TEXT NOT NULL DEFAULT 'published' CHECK (moderation_status IN ('published', 'reported', 'hidden')),
  report_reason TEXT,
  reported_at TIMESTAMPTZ,
  reported_by UUID REFERENCES public.profiles(id),
  moderated_by UUID REFERENCES public.profiles(id),
  moderated_at TIMESTAMPTZ,
  moderation_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_reviews_business ON public.appointment_reviews(business_id, moderation_status, created_at DESC);

-- 15. Randevu Bildirimleri (Müşteri + İşletme + İleri Kanal Hazırlığı)
CREATE TABLE IF NOT EXISTS public.appointment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('business', 'customer')),
  recipient_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (
    notification_type IN ('new_appointment', 'appointment_confirmed', 'appointment_cancelled', 'appointment_rescheduled', 'appointment_reminder')
  ),
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email_queued', 'sms_queued', 'whatsapp_queued')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'pending_provider', 'skipped')),
  is_read BOOLEAN NOT NULL DEFAULT false,
  scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appt_notif_recipient ON public.appointment_notifications(recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appt_notif_business ON public.appointment_notifications(business_id, created_at DESC);

-- =====================================================================
-- ATOMİK VERİTABANI FONKSİYONLARI
-- =====================================================================

-- 1. Atomik Randevu Oluşturma (Saat dilimi: Europe/Istanbul, Eş zamanlı çakışma korumalı)
CREATE OR REPLACE FUNCTION public.create_appointment_atomic(
  p_business_id UUID,
  p_booking_customer_id UUID,
  p_customer_user_id UUID,
  p_service_id UUID,
  p_staff_id UUID,
  p_appointment_date DATE,
  p_start_time TIME,
  p_customer_notes TEXT DEFAULT '',
  p_business_notes TEXT DEFAULT '',
  p_source TEXT DEFAULT 'online',
  p_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz public.businesses%ROWTYPE;
  v_page public.booking_pages%ROWTYPE;
  v_service public.booking_services%ROWTYPE;
  v_staff public.booking_staff%ROWTYPE;
  v_wh public.staff_working_hours%ROWTYPE;
  v_dow INTEGER;
  v_day_cfg JSONB;
  v_biz_open TIME;
  v_biz_close TIME;
  v_biz_is_open BOOLEAN;
  v_end_time TIME;
  v_start_at TIMESTAMPTZ;
  v_end_at TIMESTAMPTZ;
  v_final_price NUMERIC(14,2);
  v_final_status TEXT;
  v_appt_id UUID;
BEGIN
  -- 1. İşletme ve abonelik kontrolü
  SELECT * INTO v_biz FROM public.businesses WHERE id = p_business_id;
  IF NOT FOUND OR NOT v_biz.is_active OR v_biz.subscription_status <> 'active'
     OR (v_biz.subscription_end_at IS NOT NULL AND v_biz.subscription_end_at <= NOW()) THEN
    RAISE EXCEPTION 'İşletmenin aktif aboneliği bulunmuyor.';
  END IF;

  IF NOT v_biz.booking_module_enabled OR v_biz.booking_module_mode = 'addon_locked' THEN
    RAISE EXCEPTION 'Bu işletme için online randevu modülü aktif değil.';
  END IF;

  -- 2. Sayfa durumu kontrolü
  SELECT * INTO v_page FROM public.booking_pages WHERE business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'İşletmenin randevu sayfası henüz oluşturulmamış.';
  END IF;

  IF p_source = 'online' AND v_page.status <> 'published' THEN
    RAISE EXCEPTION 'İşletme şu anda online randevu alımına kapalıdır.';
  END IF;

  -- 3. Hizmet kontrolü ve fiyat/süre sabitleme (snapshot)
  SELECT * INTO v_service FROM public.booking_services
  WHERE id = p_service_id AND business_id = p_business_id;
  IF NOT FOUND OR (p_source = 'online' AND NOT v_service.is_active) THEN
    RAISE EXCEPTION 'Seçilen hizmet bulunamadı veya aktif değil.';
  END IF;

  v_final_price := COALESCE(v_service.discount_price, v_service.price);

  -- 4. Personel kontrolü
  SELECT * INTO v_staff FROM public.booking_staff
  WHERE id = p_staff_id AND business_id = p_business_id;
  IF NOT FOUND OR (p_source = 'online' AND NOT v_staff.is_active) THEN
    RAISE EXCEPTION 'Seçilen personel bulunamadı veya aktif değil.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.staff_services WHERE staff_id = p_staff_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.staff_services WHERE staff_id = p_staff_id AND service_id = p_service_id) THEN
      RAISE EXCEPTION 'Seçilen personel bu hizmeti sunmamaktadır.';
    END IF;
  END IF;

  -- 5. Eş zamanlı yarış engeli için transaction-scoped advisory lock
  PERFORM pg_advisory_xact_lock(hashtext(p_staff_id::TEXT || ':' || p_appointment_date::TEXT));

  -- 6. Zaman hesaplama (Europe/Istanbul)
  v_end_time := p_start_time + make_interval(mins => v_service.duration_minutes);
  IF v_end_time <= p_start_time THEN
    RAISE EXCEPTION 'Randevu bitiş saati gün sonunu aşamaz.';
  END IF;

  v_start_at := ((p_appointment_date::TEXT || ' ' || p_start_time::TEXT)::TIMESTAMP AT TIME ZONE 'Europe/Istanbul');
  v_end_at := v_start_at + make_interval(mins => v_service.duration_minutes);

  IF p_source = 'online' THEN
    IF v_start_at < NOW() + make_interval(mins => v_page.min_advance_minutes) THEN
      RAISE EXCEPTION 'Seçilen saat için minimum randevu alma süresi geçmiş.';
    END IF;
    IF p_appointment_date > ((NOW() AT TIME ZONE 'Europe/Istanbul')::DATE + v_page.max_advance_days) THEN
      RAISE EXCEPTION 'Bu kadar ileri bir tarih için henüz randevu açılamaz.';
    END IF;
  END IF;

  -- 7. İşletme tatil / personel izin kontrolü
  IF EXISTS (
    SELECT 1 FROM public.staff_leaves
    WHERE business_id = p_business_id
      AND (staff_id IS NULL OR staff_id = p_staff_id)
      AND p_appointment_date BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION 'Seçilen tarihte işletme veya personel izinli/kapalıdır.';
  END IF;

  -- 8. İşletme çalışma saati ve personel çalışma saati kontrolü
  v_dow := EXTRACT(DOW FROM p_appointment_date)::INTEGER;

  SELECT elem INTO v_day_cfg
  FROM jsonb_array_elements(v_page.business_hours) AS elem
  WHERE (elem->>'day')::INTEGER = v_dow
  LIMIT 1;

  IF v_day_cfg IS NOT NULL THEN
    v_biz_is_open := COALESCE((v_day_cfg->>'is_open')::BOOLEAN, false);
    IF NOT v_biz_is_open THEN
      RAISE EXCEPTION 'İşletme seçilen günde kapalıdır.';
    END IF;
    v_biz_open := (v_day_cfg->>'open')::TIME;
    v_biz_close := (v_day_cfg->>'close')::TIME;
    IF p_start_time < v_biz_open OR v_end_time > v_biz_close THEN
      RAISE EXCEPTION 'Seçilen saat işletme çalışma saatleri dışındadır.';
    END IF;
  END IF;

  SELECT * INTO v_wh FROM public.staff_working_hours
  WHERE staff_id = p_staff_id AND day_of_week = v_dow;
  IF FOUND THEN
    IF NOT v_wh.is_working OR p_start_time < v_wh.start_time OR v_end_time > v_wh.end_time THEN
      RAISE EXCEPTION 'Seçilen saat personelin çalışma saatleri dışındadır.';
    END IF;
  END IF;

  -- 9. Personel mola kontrolü
  IF EXISTS (
    SELECT 1 FROM public.staff_breaks b
    WHERE b.staff_id = p_staff_id
      AND (b.day_of_week IS NULL OR b.day_of_week = v_dow)
      AND p_start_time < b.end_time
      AND v_end_time > b.start_time
  ) THEN
    RAISE EXCEPTION 'Seçilen saat personelin mola aralığı ile çakışmaktadır.';
  END IF;

  -- 10. Mevcut randevu çakışma kontrolü
  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.staff_id = p_staff_id
      AND a.status IN ('pending', 'confirmed', 'completed')
      AND a.start_at < v_end_at
      AND a.end_at > v_start_at
  ) THEN
    RAISE EXCEPTION 'Seçilen saatte bu personelin başka bir randevusu bulunmaktadır.';
  END IF;

  v_final_status := COALESCE(p_status, CASE WHEN v_page.auto_confirm THEN 'confirmed' ELSE 'pending' END);

  INSERT INTO public.appointments (
    business_id, booking_customer_id, customer_user_id, service_id, staff_id,
    service_name_snapshot, service_price_snapshot, service_duration_snapshot, staff_name_snapshot,
    appointment_date, start_time, end_time, start_at, end_at,
    status, customer_notes, business_notes, source
  ) VALUES (
    p_business_id, p_booking_customer_id, p_customer_user_id, p_service_id, p_staff_id,
    v_service.name, v_final_price, v_service.duration_minutes, v_staff.full_name,
    p_appointment_date, p_start_time, v_end_time, v_start_at, v_end_at,
    v_final_status, COALESCE(p_customer_notes, ''), COALESCE(p_business_notes, ''), p_source
  )
  RETURNING id INTO v_appt_id;

  RETURN jsonb_build_object(
    'id', v_appt_id,
    'status', v_final_status,
    'service_name', v_service.name,
    'price', v_final_price,
    'duration_minutes', v_service.duration_minutes,
    'staff_name', v_staff.full_name,
    'start_at', v_start_at,
    'end_at', v_end_at
  );
END;
$$;

-- 2. Atomik Randevu Saat/Personel Değiştirme
CREATE OR REPLACE FUNCTION public.reschedule_appointment_atomic(
  p_appointment_id UUID,
  p_new_date DATE,
  p_new_start_time TIME,
  p_new_staff_id UUID DEFAULT NULL,
  p_actor TEXT DEFAULT 'business'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_page public.booking_pages%ROWTYPE;
  v_staff public.booking_staff%ROWTYPE;
  v_wh public.staff_working_hours%ROWTYPE;
  v_target_staff_id UUID;
  v_dow INTEGER;
  v_day_cfg JSONB;
  v_end_time TIME;
  v_start_at TIMESTAMPTZ;
  v_end_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Randevu bulunamadı.';
  END IF;

  IF v_appt.status IN ('completed', 'cancelled', 'no_show') THEN
    RAISE EXCEPTION 'Tamamlanmış veya iptal edilmiş randevunun saati değiştirilemez.';
  END IF;

  SELECT * INTO v_page FROM public.booking_pages WHERE business_id = v_appt.business_id;
  v_target_staff_id := COALESCE(p_new_staff_id, v_appt.staff_id);

  SELECT * INTO v_staff FROM public.booking_staff
  WHERE id = v_target_staff_id AND business_id = v_appt.business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Personel bulunamadı.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_target_staff_id::TEXT || ':' || p_new_date::TEXT));

  v_end_time := p_new_start_time + make_interval(mins => v_appt.service_duration_snapshot);
  IF v_end_time <= p_new_start_time THEN
    RAISE EXCEPTION 'Randevu bitiş saati gün sonunu aşamaz.';
  END IF;

  v_start_at := ((p_new_date::TEXT || ' ' || p_new_start_time::TEXT)::TIMESTAMP AT TIME ZONE 'Europe/Istanbul');
  v_end_at := v_start_at + make_interval(mins => v_appt.service_duration_snapshot);

  IF p_actor = 'customer' THEN
    IF v_start_at < NOW() + make_interval(mins => COALESCE(v_page.min_advance_minutes, 60)) THEN
      RAISE EXCEPTION 'Yeni randevu saati minimum önceden alma süresinin dışında.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_leaves
    WHERE business_id = v_appt.business_id
      AND (staff_id IS NULL OR staff_id = v_target_staff_id)
      AND p_new_date BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION 'Seçilen tarihte işletme veya personel izinli/kapalıdır.';
  END IF;

  v_dow := EXTRACT(DOW FROM p_new_date)::INTEGER;
  IF v_page.business_hours IS NOT NULL THEN
    SELECT elem INTO v_day_cfg
    FROM jsonb_array_elements(v_page.business_hours) AS elem
    WHERE (elem->>'day')::INTEGER = v_dow
    LIMIT 1;
    IF v_day_cfg IS NOT NULL THEN
      IF NOT COALESCE((v_day_cfg->>'is_open')::BOOLEAN, false)
         OR p_new_start_time < (v_day_cfg->>'open')::TIME
         OR v_end_time > (v_day_cfg->>'close')::TIME THEN
        RAISE EXCEPTION 'Seçilen saat işletme çalışma saatleri dışındadır.';
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_wh FROM public.staff_working_hours
  WHERE staff_id = v_target_staff_id AND day_of_week = v_dow;
  IF FOUND THEN
    IF NOT v_wh.is_working OR p_new_start_time < v_wh.start_time OR v_end_time > v_wh.end_time THEN
      RAISE EXCEPTION 'Seçilen saat personelin çalışma saatleri dışındadır.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_breaks b
    WHERE b.staff_id = v_target_staff_id
      AND (b.day_of_week IS NULL OR b.day_of_week = v_dow)
      AND p_new_start_time < b.end_time
      AND v_end_time > b.start_time
  ) THEN
    RAISE EXCEPTION 'Seçilen saat personelin mola aralığı ile çakışmaktadır.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id <> p_appointment_id
      AND a.staff_id = v_target_staff_id
      AND a.status IN ('pending', 'confirmed', 'completed')
      AND a.start_at < v_end_at
      AND a.end_at > v_start_at
  ) THEN
    RAISE EXCEPTION 'Seçilen saatte bu personelin başka bir randevusu bulunmaktadır.';
  END IF;

  UPDATE public.appointments
  SET staff_id = v_target_staff_id,
      staff_name_snapshot = v_staff.full_name,
      appointment_date = p_new_date,
      start_time = p_new_start_time,
      end_time = v_end_time,
      start_at = v_start_at,
      end_at = v_end_at,
      updated_at = NOW()
  WHERE id = p_appointment_id;

  RETURN jsonb_build_object('success', true, 'start_at', v_start_at, 'end_at', v_end_at);
END;
$$;

-- 3. Atomik Randevu Tahsilatı ve İade (Gelir/Gider Tabloları ile Birebir Entegre)
CREATE OR REPLACE FUNCTION public.record_appointment_payment(
  p_appointment_id UUID,
  p_business_id UUID,
  p_user_id UUID,
  p_amount NUMERIC(14,2),
  p_payment_type TEXT,
  p_payment_method TEXT,
  p_payment_date DATE,
  p_notes TEXT DEFAULT '',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_cust_name TEXT;
  v_cat_id UUID;
  v_income_id UUID;
  v_expense_id UUID;
  v_pay_id UUID;
  v_new_paid NUMERIC(14,2);
  v_new_status TEXT;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'İşlem tutarı sıfırdan büyük olmalıdır.';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.appointment_payments
    WHERE business_id = p_business_id AND idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'Bu tahsilat işlemi zaten kaydedilmiş.';
  END IF;

  SELECT * INTO v_appt
  FROM public.appointments
  WHERE id = p_appointment_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Randevu bulunamadı.';
  END IF;

  SELECT TRIM(first_name || ' ' || last_name) INTO v_cust_name
  FROM public.booking_customers WHERE id = v_appt.booking_customer_id;

  IF p_payment_type = 'collection' THEN
    IF v_appt.payment_status = 'paid' THEN
      RAISE EXCEPTION 'Bu randevunun ücreti zaten tamamen tahsil edilmiş.';
    END IF;
    IF v_appt.service_price_snapshot > 0 AND (v_appt.paid_amount + p_amount) > (v_appt.service_price_snapshot + 0.01) THEN
      RAISE EXCEPTION 'Tahsilat tutarı kalan randevu ücretini aşamaz.';
    END IF;

    SELECT id INTO v_cat_id FROM public.income_categories
    WHERE business_id = p_business_id AND name = 'Hizmet Geliri' LIMIT 1;

    INSERT INTO public.income_transactions (
      business_id, category_id, category_name, title, amount, transaction_date, description, created_by
    ) VALUES (
      p_business_id,
      v_cat_id,
      'Hizmet Geliri',
      'Randevu Tahsilatı: ' || v_appt.service_name_snapshot || COALESCE(' (' || v_cust_name || ')', ''),
      p_amount,
      p_payment_date,
      COALESCE(NULLIF(p_notes, ''), 'Online randevu hizmet tahsilatı'),
      p_user_id
    )
    RETURNING id INTO v_income_id;

    v_new_paid := v_appt.paid_amount + p_amount;
    v_new_status := CASE
      WHEN v_new_paid >= v_appt.service_price_snapshot THEN 'paid'
      ELSE 'partial'
    END;

    INSERT INTO public.appointment_payments (
      business_id, appointment_id, amount, payment_type, payment_method, payment_date,
      income_transaction_id, idempotency_key, notes, created_by
    ) VALUES (
      p_business_id, p_appointment_id, p_amount, 'collection', p_payment_method, p_payment_date,
      v_income_id, p_idempotency_key, COALESCE(p_notes, ''), p_user_id
    )
    RETURNING id INTO v_pay_id;

    UPDATE public.appointments
    SET paid_amount = v_new_paid,
        payment_status = v_new_status,
        updated_at = NOW()
    WHERE id = p_appointment_id;

  ELSIF p_payment_type = 'refund' THEN
    IF v_appt.paid_amount <= 0 OR p_amount > v_appt.paid_amount THEN
      RAISE EXCEPTION 'İade tutarı tahsil edilmiş tutardan büyük olamaz.';
    END IF;

    SELECT id INTO v_cat_id FROM public.expense_categories
    WHERE business_id = p_business_id AND name = 'Diğer' LIMIT 1;

    INSERT INTO public.expense_transactions (
      business_id, category_id, category_name, title, amount, transaction_date, payment_method, description, created_by
    ) VALUES (
      p_business_id,
      v_cat_id,
      'Diğer',
      'Randevu İadesi: ' || v_appt.service_name_snapshot || COALESCE(' (' || v_cust_name || ')', ''),
      p_amount,
      p_payment_date,
      p_payment_method,
      COALESCE(NULLIF(p_notes, ''), 'Randevu tahsilat iadesi'),
      p_user_id
    )
    RETURNING id INTO v_expense_id;

    v_new_paid := GREATEST(0, v_appt.paid_amount - p_amount);
    v_new_status := CASE WHEN v_new_paid = 0 THEN 'refunded' ELSE 'partial' END;

    INSERT INTO public.appointment_payments (
      business_id, appointment_id, amount, payment_type, payment_method, payment_date,
      expense_transaction_id, idempotency_key, notes, created_by
    ) VALUES (
      p_business_id, p_appointment_id, p_amount, 'refund', p_payment_method, p_payment_date,
      v_expense_id, p_idempotency_key, COALESCE(p_notes, ''), p_user_id
    )
    RETURNING id INTO v_pay_id;

    UPDATE public.appointments
    SET paid_amount = v_new_paid,
        payment_status = v_new_status,
        updated_at = NOW()
    WHERE id = p_appointment_id;
  ELSE
    RAISE EXCEPTION 'Geçersiz ödeme işlem tipi.';
  END IF;

  INSERT INTO public.audit_logs (
    scope, business_id, actor_user_id, action, entity_type, entity_id, new_values, description
  ) VALUES (
    'business', p_business_id, p_user_id,
    CASE WHEN p_payment_type = 'collection' THEN 'appointment_payment_collected' ELSE 'appointment_payment_refunded' END,
    'appointments', p_appointment_id::TEXT,
    jsonb_build_object('amount', p_amount, 'payment_method', p_payment_method, 'payment_status', v_new_status),
    CASE WHEN p_payment_type = 'collection' THEN 'Randevu tahsilatı gelir kaydına işlendi.' ELSE 'Randevu tahsilat iadesi gider kaydına işlendi.' END
  );

  RETURN jsonb_build_object(
    'payment_id', v_pay_id,
    'paid_amount', v_new_paid,
    'payment_status', v_new_status,
    'income_transaction_id', v_income_id,
    'expense_transaction_id', v_expense_id
  );
END;
$$;

-- =====================================================================
-- ROW LEVEL SECURITY (RLS) & İZİNLER
-- =====================================================================

ALTER TABLE public.booking_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_working_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_notifications ENABLE ROW LEVEL SECURITY;

-- Public storefront okumaları (yalnızca yayındaki sayfalar)
DROP POLICY IF EXISTS "booking_pages_public_or_member" ON public.booking_pages;
CREATE POLICY "booking_pages_public_or_member" ON public.booking_pages
  FOR SELECT USING (
    status = 'published'
    OR public.is_business_member(business_id)
    OR public.is_system_admin()
  );
DROP POLICY IF EXISTS "booking_pages_manage" ON public.booking_pages;
CREATE POLICY "booking_pages_manage" ON public.booking_pages
  FOR ALL USING (
    (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'booking.design'))
    OR public.is_system_admin()
  );

DROP POLICY IF EXISTS "booking_services_select" ON public.booking_services;
CREATE POLICY "booking_services_select" ON public.booking_services
  FOR SELECT USING (
    (is_active = true AND EXISTS (SELECT 1 FROM public.booking_pages bp WHERE bp.business_id = booking_services.business_id AND bp.status = 'published'))
    OR public.is_business_member(business_id)
    OR public.is_system_admin()
  );
DROP POLICY IF EXISTS "booking_services_manage" ON public.booking_services;
CREATE POLICY "booking_services_manage" ON public.booking_services
  FOR ALL USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'booking.services'));

DROP POLICY IF EXISTS "booking_staff_select" ON public.booking_staff;
CREATE POLICY "booking_staff_select" ON public.booking_staff
  FOR SELECT USING (
    (is_active = true AND EXISTS (SELECT 1 FROM public.booking_pages bp WHERE bp.business_id = booking_staff.business_id AND bp.status = 'published'))
    OR public.is_business_member(business_id)
    OR public.is_system_admin()
  );
DROP POLICY IF EXISTS "booking_staff_manage" ON public.booking_staff;
CREATE POLICY "booking_staff_manage" ON public.booking_staff
  FOR ALL USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'booking.staff'));

DROP POLICY IF EXISTS "staff_services_select" ON public.staff_services;
CREATE POLICY "staff_services_select" ON public.staff_services
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.booking_pages bp WHERE bp.business_id = staff_services.business_id AND bp.status = 'published')
    OR public.is_business_member(business_id)
  );
DROP POLICY IF EXISTS "staff_services_manage" ON public.staff_services;
CREATE POLICY "staff_services_manage" ON public.staff_services
  FOR ALL USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'booking.staff'));

DROP POLICY IF EXISTS "staff_wh_select" ON public.staff_working_hours;
CREATE POLICY "staff_wh_select" ON public.staff_working_hours
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.booking_pages bp WHERE bp.business_id = staff_working_hours.business_id AND bp.status = 'published')
    OR public.is_business_member(business_id)
  );
DROP POLICY IF EXISTS "staff_wh_manage" ON public.staff_working_hours;
CREATE POLICY "staff_wh_manage" ON public.staff_working_hours
  FOR ALL USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'booking.staff'));

DROP POLICY IF EXISTS "staff_breaks_select" ON public.staff_breaks;
CREATE POLICY "staff_breaks_select" ON public.staff_breaks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.booking_pages bp WHERE bp.business_id = staff_breaks.business_id AND bp.status = 'published')
    OR public.is_business_member(business_id)
  );
DROP POLICY IF EXISTS "staff_breaks_manage" ON public.staff_breaks;
CREATE POLICY "staff_breaks_manage" ON public.staff_breaks
  FOR ALL USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'booking.staff'));

DROP POLICY IF EXISTS "staff_leaves_select" ON public.staff_leaves;
CREATE POLICY "staff_leaves_select" ON public.staff_leaves
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.booking_pages bp WHERE bp.business_id = staff_leaves.business_id AND bp.status = 'published')
    OR public.is_business_member(business_id)
  );
DROP POLICY IF EXISTS "staff_leaves_manage" ON public.staff_leaves;
CREATE POLICY "staff_leaves_manage" ON public.staff_leaves
  FOR ALL USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'booking.staff'));

-- Müşteri hesapları: yalnızca kendi hesabını görebilir/güncelleyebilir
DROP POLICY IF EXISTS "customer_accounts_own" ON public.customer_accounts;
CREATE POLICY "customer_accounts_own" ON public.customer_accounts
  FOR ALL USING (user_id = auth.uid() OR public.is_system_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_system_admin());

-- İşletme randevu müşterileri: yalnızca ilgili işletme veya müşterinin kendisi
DROP POLICY IF EXISTS "booking_customers_select" ON public.booking_customers;
CREATE POLICY "booking_customers_select" ON public.booking_customers
  FOR SELECT USING (
    customer_user_id = auth.uid()
    OR (public.is_business_member(business_id) AND public.has_business_permission(business_id, 'booking.view'))
    OR public.is_system_admin()
  );
DROP POLICY IF EXISTS "booking_customers_manage" ON public.booking_customers;
CREATE POLICY "booking_customers_manage" ON public.booking_customers
  FOR ALL USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'booking.manage'));

-- Randevular: müşteri yalnızca kendi randevusunu, işletme yalnızca kendi randevularını görür
DROP POLICY IF EXISTS "appointments_select" ON public.appointments;
CREATE POLICY "appointments_select" ON public.appointments
  FOR SELECT USING (
    customer_user_id = auth.uid()
    OR (public.is_business_member(business_id) AND public.has_business_permission(business_id, 'booking.view'))
    OR public.is_system_admin()
  );
DROP POLICY IF EXISTS "appointments_manage" ON public.appointments;
CREATE POLICY "appointments_manage" ON public.appointments
  FOR ALL USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'booking.manage'));

-- Randevu ödemeleri: yalnızca ilgili işletme veya admin
DROP POLICY IF EXISTS "appointment_payments_select" ON public.appointment_payments;
CREATE POLICY "appointment_payments_select" ON public.appointment_payments
  FOR SELECT USING (
    (public.is_business_member(business_id) AND public.has_business_permission(business_id, 'booking.view'))
    OR public.is_system_admin()
  );

-- Yorumlar: yayınlanan yorumlar herkese görünür; ekleme yalnızca tamamlanan randevunun müşterisi; işletme silemez
DROP POLICY IF EXISTS "appointment_reviews_select" ON public.appointment_reviews;
CREATE POLICY "appointment_reviews_select" ON public.appointment_reviews
  FOR SELECT USING (
    moderation_status IN ('published', 'reported')
    OR customer_user_id = auth.uid()
    OR public.is_business_member(business_id)
    OR public.is_system_admin()
  );
DROP POLICY IF EXISTS "appointment_reviews_insert_customer" ON public.appointment_reviews;
CREATE POLICY "appointment_reviews_insert_customer" ON public.appointment_reviews
  FOR INSERT WITH CHECK (
    customer_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_reviews.appointment_id
        AND a.customer_user_id = auth.uid()
        AND a.status = 'completed'
    )
  );
DROP POLICY IF EXISTS "appointment_reviews_admin_all" ON public.appointment_reviews;
CREATE POLICY "appointment_reviews_admin_all" ON public.appointment_reviews
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Bildirimler
DROP POLICY IF EXISTS "appointment_notifications_select" ON public.appointment_notifications;
CREATE POLICY "appointment_notifications_select" ON public.appointment_notifications
  FOR SELECT USING (
    recipient_user_id = auth.uid()
    OR public.is_business_member(business_id)
    OR public.is_system_admin()
  );

-- API rolleri için GRANT izinleri
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
