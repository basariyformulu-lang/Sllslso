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
