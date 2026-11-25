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
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_system_admin() OR EXISTS (
    SELECT 1 FROM public.business_members bm1
    JOIN public.business_members bm2 ON bm1.business_id = bm2.business_id
    WHERE bm1.user_id = auth.uid() AND bm2.user_id = profiles.id AND bm1.is_active = true
  ));

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- System Admins: yalnızca adminler görebilir, normal kullanıcı değiştiremez
CREATE POLICY "system_admins_select" ON public.system_admins
  FOR SELECT USING (user_id = auth.uid() OR public.is_system_admin());

-- System Settings: herkese açık okuma (tanıtım/iletişim), yalnızca admin güncelleme
CREATE POLICY "system_settings_public_read" ON public.system_settings
  FOR SELECT USING (true);
CREATE POLICY "system_settings_admin_write" ON public.system_settings
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Subscription Plans: herkese açık okuma, yalnızca admin yazma
CREATE POLICY "subscription_plans_public_read" ON public.subscription_plans
  FOR SELECT USING (true);
CREATE POLICY "subscription_plans_admin_write" ON public.subscription_plans
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Bank Accounts: giriş yapmış işletmeler aktif hesapları görebilir, admin hepsini yönetir
CREATE POLICY "bank_accounts_read_active" ON public.bank_accounts
  FOR SELECT USING (is_active = true OR public.is_system_admin());
CREATE POLICY "bank_accounts_admin_write" ON public.bank_accounts
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Businesses: üyesi veya admin okuyabilir; normal kullanıcı abonelik alanlarını değiştiremez (backend API/admin yönetir)
CREATE POLICY "businesses_select" ON public.businesses
  FOR SELECT USING (public.is_business_member(id) OR public.is_system_admin());
CREATE POLICY "businesses_admin_all" ON public.businesses
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Subscriptions: üyesi veya admin okuyabilir; yalnızca admin değiştirebilir
CREATE POLICY "subscriptions_select" ON public.subscriptions
  FOR SELECT USING (public.is_business_member(business_id) OR public.is_system_admin());
CREATE POLICY "subscriptions_admin_all" ON public.subscriptions
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Payment Requests: üyesi kendi taleplerini okuyabilir/oluşturabilir (pending), onay/red yalnızca admin
CREATE POLICY "payment_requests_select" ON public.payment_requests
  FOR SELECT USING (public.is_business_member(business_id) OR public.is_system_admin());
CREATE POLICY "payment_requests_insert_member" ON public.payment_requests
  FOR INSERT WITH CHECK (public.is_business_member(business_id) AND status = 'pending');
CREATE POLICY "payment_requests_admin_update" ON public.payment_requests
  FOR UPDATE USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

-- Business Members
CREATE POLICY "business_members_select" ON public.business_members
  FOR SELECT USING (public.is_business_member(business_id) OR public.is_system_admin());

-- Permissions katalogu herkesçe okunabilir
CREATE POLICY "permissions_select_all" ON public.permissions FOR SELECT USING (true);

-- İşletme verileri (aktif abonelik + üyelik + yetki kontrolü)
CREATE POLICY "customers_select" ON public.customers
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'customers.view'));
CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'customers.create'));
CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'customers.edit'));

CREATE POLICY "credit_sales_select" ON public.credit_sales
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'credit_sales.view'));
CREATE POLICY "credit_sales_insert" ON public.credit_sales
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'credit_sales.create'));
CREATE POLICY "credit_sales_update" ON public.credit_sales
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'credit_sales.edit'));

CREATE POLICY "customer_tx_select" ON public.customer_transactions
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'customers.view'));
CREATE POLICY "customer_tx_insert" ON public.customer_transactions
  FOR INSERT WITH CHECK (
    public.has_active_subscription(business_id) AND (
      (transaction_type = 'debt' AND public.has_business_permission(business_id, 'customers.add_debt')) OR
      (transaction_type = 'payment' AND public.has_business_permission(business_id, 'customers.add_payment')) OR
      (transaction_type = 'reversal' AND public.has_business_permission(business_id, 'customers.delete'))
    )
  );

CREATE POLICY "suppliers_select" ON public.suppliers
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'suppliers.view'));
CREATE POLICY "suppliers_insert" ON public.suppliers
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'suppliers.create'));
CREATE POLICY "suppliers_update" ON public.suppliers
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'suppliers.edit'));

CREATE POLICY "supplier_tx_select" ON public.supplier_transactions
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'suppliers.view'));
CREATE POLICY "supplier_tx_insert" ON public.supplier_transactions
  FOR INSERT WITH CHECK (
    public.has_active_subscription(business_id) AND (
      (transaction_type = 'debt' AND public.has_business_permission(business_id, 'suppliers.add_debt')) OR
      (transaction_type = 'payment' AND public.has_business_permission(business_id, 'suppliers.add_payment')) OR
      (transaction_type = 'reversal' AND public.has_business_permission(business_id, 'suppliers.delete'))
    )
  );

CREATE POLICY "income_categories_all" ON public.income_categories
  FOR ALL USING (public.has_active_subscription(business_id) AND public.is_business_member(business_id));
CREATE POLICY "expense_categories_all" ON public.expense_categories
  FOR ALL USING (public.has_active_subscription(business_id) AND public.is_business_member(business_id));

CREATE POLICY "income_tx_select" ON public.income_transactions
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.view'));
CREATE POLICY "income_tx_insert" ON public.income_transactions
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.create'));
CREATE POLICY "income_tx_update" ON public.income_transactions
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.edit'));

CREATE POLICY "expense_tx_select" ON public.expense_transactions
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.view'));
CREATE POLICY "expense_tx_insert" ON public.expense_transactions
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.create'));
CREATE POLICY "expense_tx_update" ON public.expense_transactions
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'finance.edit'));

CREATE POLICY "recurring_expenses_select" ON public.recurring_expenses
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.view'));
CREATE POLICY "recurring_expenses_insert" ON public.recurring_expenses
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.create'));
CREATE POLICY "recurring_expenses_update" ON public.recurring_expenses
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.edit'));

CREATE POLICY "recurring_periods_select" ON public.recurring_expense_periods
  FOR SELECT USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.view'));
CREATE POLICY "recurring_periods_insert" ON public.recurring_expense_periods
  FOR INSERT WITH CHECK (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.view'));
CREATE POLICY "recurring_periods_update" ON public.recurring_expense_periods
  FOR UPDATE USING (public.has_active_subscription(business_id) AND public.has_business_permission(business_id, 'recurring.pay'));

-- Notifications
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (public.is_business_member(business_id) OR user_id = auth.uid() OR public.is_system_admin());
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE USING (public.is_business_member(business_id) OR user_id = auth.uid());

-- Audit Logs: admin kapsamı yalnızca adminlerce görülebilir, işletme kapsamı yalnızca o işletme üyelerince
CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT USING (
    (scope = 'admin' AND public.is_system_admin()) OR
    (scope = 'business' AND public.is_business_member(business_id))
  );

-- Deleted Business Archives: yalnızca admin
CREATE POLICY "deleted_archives_admin_only" ON public.deleted_business_archives
  FOR ALL USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());
