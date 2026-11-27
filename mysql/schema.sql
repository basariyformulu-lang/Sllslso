-- EsnafTakip - Tam MySQL / MariaDB Kurulum Semasi (Cari + Finans + Abonelik + Online Randevu)

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS system_admins (
  user_id CHAR(36) PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  id INT PRIMARY KEY DEFAULT 1,
  system_name VARCHAR(160) NOT NULL DEFAULT 'EsnafTakip',
  logo_url LONGTEXT NOT NULL,
  hero_slogan VARCHAR(255) NOT NULL DEFAULT 'İşletmenizin tüm borç ve alacakları tek yerde.',
  hero_subheadline TEXT NOT NULL,
  contact_email VARCHAR(191) NOT NULL DEFAULT 'destek@esnaftakip.com',
  contact_phone VARCHAR(40) NOT NULL DEFAULT '',
  pricing_description TEXT NOT NULL,
  terms_of_service LONGTEXT NOT NULL,
  privacy_policy LONGTEXT NOT NULL,
  booking_module_default_included TINYINT(1) NOT NULL DEFAULT 1,
  booking_module_addon_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(140) NOT NULL,
  description TEXT NOT NULL,
  monthly_price DECIMAL(14,2) NOT NULL DEFAULT 299.00,
  duration_days INT NOT NULL DEFAULT 30,
  features LONGTEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  effective_from DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bank_accounts (
  id CHAR(36) PRIMARY KEY,
  bank_name VARCHAR(140) NOT NULL,
  iban VARCHAR(60) NOT NULL,
  account_holder VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profiles (
  id CHAR(36) PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL DEFAULT '',
  last_name VARCHAR(100) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  reset_token VARCHAR(120) NULL,
  reset_token_expires_at DATETIME(3) NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 1,
  phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS businesses (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  business_code VARCHAR(40) NOT NULL UNIQUE,
  owner_id CHAR(36) NOT NULL,
  phone VARCHAR(40) NOT NULL DEFAULT '',
  email VARCHAR(191) NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  subscription_status VARCHAR(32) NOT NULL DEFAULT 'pending_approval',
  subscription_start_at DATETIME(3) NULL,
  subscription_end_at DATETIME(3) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  booking_module_enabled TINYINT(1) NOT NULL DEFAULT 1,
  booking_module_mode VARCHAR(32) NOT NULL DEFAULT 'included',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_businesses_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriptions (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NULL,
  plan_name VARCHAR(140) NOT NULL,
  monthly_price DECIMAL(14,2) NOT NULL,
  duration_days INT NOT NULL DEFAULT 30,
  status VARCHAR(32) NOT NULL DEFAULT 'payment_pending',
  start_at DATETIME(3) NULL,
  end_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_subs_business (business_id),
  CONSTRAINT fk_subs_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_requests (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  subscription_id CHAR(36) NULL,
  plan_id CHAR(36) NULL,
  bank_account_id CHAR(36) NULL,
  bank_snapshot LONGTEXT NOT NULL,
  payer_name VARCHAR(160) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  payment_date DATE NOT NULL,
  receipt_url LONGTEXT NULL,
  receipt_name VARCHAR(255) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  rejected_reason TEXT NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_payreq_business (business_id),
  CONSTRAINT fk_payreq_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  code VARCHAR(80) PRIMARY KEY,
  label VARCHAR(160) NOT NULL,
  module VARCHAR(80) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_members (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role_name VARCHAR(100) NOT NULL DEFAULT 'İşletme Sahibi',
  is_owner TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  permissions LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_bm_business_user (business_id, user_id),
  INDEX idx_bm_user (user_id),
  CONSTRAINT fk_bm_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  email VARCHAR(191) NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  notes TEXT NOT NULL,
  opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  registered_at DATE NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NULL,
  INDEX idx_customers_business (business_id),
  CONSTRAINT fk_customers_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suppliers (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  company_name VARCHAR(180) NOT NULL,
  contact_name VARCHAR(140) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  email VARCHAR(191) NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  notes TEXT NOT NULL,
  opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NULL,
  INDEX idx_suppliers_business (business_id),
  CONSTRAINT fk_suppliers_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_sales (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  description TEXT NOT NULL,
  total_amount DECIMAL(14,2) NOT NULL,
  paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  sale_date DATE NOT NULL,
  due_months INT NULL,
  due_date DATE NOT NULL,
  notes TEXT NOT NULL,
  is_cancelled TINYINT(1) NOT NULL DEFAULT 0,
  cancelled_at DATETIME(3) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NULL,
  INDEX idx_cs_business (business_id),
  INDEX idx_cs_customer (customer_id),
  CONSTRAINT fk_cs_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_cs_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_transactions (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  credit_sale_id CHAR(36) NULL,
  transaction_type VARCHAR(24) NOT NULL,
  debt_category VARCHAR(80) NOT NULL DEFAULT 'Cari',
  amount DECIMAL(14,2) NOT NULL,
  signed_amount DECIMAL(14,2) NOT NULL,
  transaction_date DATE NOT NULL,
  due_date DATE NULL,
  payment_method VARCHAR(24) NULL,
  description TEXT NOT NULL,
  notes TEXT NOT NULL,
  is_overpayment TINYINT(1) NOT NULL DEFAULT 0,
  is_cancelled TINYINT(1) NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_ct_business (business_id),
  INDEX idx_ct_customer (customer_id),
  CONSTRAINT fk_ct_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_ct_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_sale_payments (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  credit_sale_id CHAR(36) NULL,
  customer_id CHAR(36) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  payment_method VARCHAR(24) NOT NULL DEFAULT 'nakit',
  payment_date DATE NOT NULL,
  notes TEXT NOT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_csp_business (business_id),
  INDEX idx_csp_customer (customer_id),
  CONSTRAINT fk_csp_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_csp_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_transactions (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  supplier_id CHAR(36) NOT NULL,
  transaction_type VARCHAR(24) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  signed_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  transaction_date DATE NOT NULL,
  due_date DATE NULL,
  payment_method VARCHAR(24) NOT NULL DEFAULT 'nakit',
  description TEXT NOT NULL,
  notes TEXT NULL,
  is_overpayment TINYINT(1) NOT NULL DEFAULT 0,
  is_cancelled TINYINT(1) NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_st_business (business_id),
  INDEX idx_st_supplier (supplier_id),
  CONSTRAINT fk_st_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_st_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS income_categories (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_inccat_business (business_id),
  CONSTRAINT fk_inccat_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS income_transactions (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  category_id CHAR(36) NULL,
  category_name VARCHAR(100) NOT NULL DEFAULT 'Diğer',
  title VARCHAR(180) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  is_cancelled TINYINT(1) NOT NULL DEFAULT 0,
  cancelled_at DATETIME(3) NULL,
  cancelled_by CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NULL,
  INDEX idx_inctx_business_date (business_id, transaction_date),
  CONSTRAINT fk_inctx_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expense_categories (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_expcat_business (business_id),
  CONSTRAINT fk_expcat_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expense_transactions (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  category_id CHAR(36) NULL,
  category_name VARCHAR(100) NOT NULL DEFAULT 'Diğer',
  title VARCHAR(180) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  transaction_date DATE NOT NULL,
  payment_method VARCHAR(24) NOT NULL DEFAULT 'nakit',
  description TEXT NOT NULL,
  is_cancelled TINYINT(1) NOT NULL DEFAULT 0,
  cancelled_at DATETIME(3) NULL,
  cancelled_by CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NULL,
  INDEX idx_exptx_business_date (business_id, transaction_date),
  CONSTRAINT fk_exptx_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  category VARCHAR(80) NOT NULL,
  title VARCHAR(180) NOT NULL,
  monthly_amount DECIMAL(14,2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  payment_day INT NOT NULL DEFAULT 1,
  frequency VARCHAR(24) NOT NULL DEFAULT 'monthly',
  description TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NULL,
  INDEX idx_re_business (business_id),
  CONSTRAINT fk_re_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recurring_expense_periods (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  recurring_expense_id CHAR(36) NOT NULL,
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  due_date DATE NOT NULL,
  planned_amount DECIMAL(14,2) NOT NULL,
  paid_amount DECIMAL(14,2) NULL,
  paid_date DATE NULL,
  payment_method VARCHAR(24) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  expense_transaction_id CHAR(36) NULL,
  UNIQUE KEY uq_rep_period (recurring_expense_id, period_year, period_month),
  INDEX idx_rep_business (business_id),
  CONSTRAINT fk_rep_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_rep_expense FOREIGN KEY (recurring_expense_id) REFERENCES recurring_expenses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NULL,
  recipient_user_id CHAR(36) NULL,
  type VARCHAR(60) NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  link VARCHAR(255) NOT NULL DEFAULT '/panel',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_notif_business (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  scope VARCHAR(24) NOT NULL DEFAULT 'business',
  business_id CHAR(36) NULL,
  actor_user_id CHAR(36) NULL,
  actor_name VARCHAR(160) NOT NULL DEFAULT '',
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(120) NULL,
  old_values LONGTEXT NULL,
  new_values LONGTEXT NULL,
  description TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_audit_scope_date (scope, created_at),
  INDEX idx_audit_business (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- ONLINE RANDEVU MODULU TABLOLARI
-- =====================================================================

CREATE TABLE IF NOT EXISTS booking_pages (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL UNIQUE,
  slug VARCHAR(80) NOT NULL UNIQUE,
  page_title VARCHAR(160) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  logo_url LONGTEXT NOT NULL,
  cover_image_url LONGTEXT NOT NULL,
  gallery_images LONGTEXT NOT NULL,
  phone VARCHAR(40) NOT NULL DEFAULT '',
  whatsapp VARCHAR(40) NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  map_location TEXT NOT NULL,
  instagram_url VARCHAR(300) NOT NULL DEFAULT '',
  instagram_username VARCHAR(120) NOT NULL DEFAULT '',
  instagram_display_name VARCHAR(160) NOT NULL DEFAULT '',
  instagram_avatar_url LONGTEXT NOT NULL,
  instagram_followers_count INT NOT NULL DEFAULT 0,
  instagram_posts_count INT NOT NULL DEFAULT 0,
  instagram_posts LONGTEXT NOT NULL,
  theme_preset VARCHAR(40) NOT NULL DEFAULT 'classic_navy',
  primary_color VARCHAR(16) NOT NULL DEFAULT '#0F2942',
  secondary_color VARCHAR(16) NOT NULL DEFAULT '#064E3B',
  section_visibility LONGTEXT NOT NULL,
  business_hours LONGTEXT NOT NULL,
  slot_interval_minutes INT NOT NULL DEFAULT 30,
  min_advance_minutes INT NOT NULL DEFAULT 60,
  max_advance_days INT NOT NULL DEFAULT 30,
  cancellation_deadline_hours INT NOT NULL DEFAULT 2,
  auto_confirm TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'draft',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_bp_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_services (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  image_url LONGTEXT NOT NULL,
  price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_price DECIMAL(14,2) NULL,
  duration_minutes INT NOT NULL DEFAULT 30,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_bs_business (business_id, sort_order),
  CONSTRAINT fk_bs_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_staff (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  full_name VARCHAR(140) NOT NULL,
  avatar_url LONGTEXT NOT NULL,
  specialties VARCHAR(255) NOT NULL DEFAULT '',
  bio TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_bst_business (business_id, sort_order),
  CONSTRAINT fk_bst_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_services (
  business_id CHAR(36) NOT NULL,
  staff_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  PRIMARY KEY (staff_id, service_id),
  INDEX idx_ss_business (business_id),
  CONSTRAINT fk_ss_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_ss_staff FOREIGN KEY (staff_id) REFERENCES booking_staff(id) ON DELETE CASCADE,
  CONSTRAINT fk_ss_service FOREIGN KEY (service_id) REFERENCES booking_services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_working_hours (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  staff_id CHAR(36) NOT NULL,
  day_of_week TINYINT NOT NULL,
  is_working TINYINT(1) NOT NULL DEFAULT 1,
  start_time TIME NOT NULL DEFAULT '09:00:00',
  end_time TIME NOT NULL DEFAULT '19:00:00',
  UNIQUE KEY uq_swh_staff_day (staff_id, day_of_week),
  INDEX idx_swh_business (business_id),
  CONSTRAINT fk_swh_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_swh_staff FOREIGN KEY (staff_id) REFERENCES booking_staff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_breaks (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  staff_id CHAR(36) NOT NULL,
  day_of_week TINYINT NULL,
  title VARCHAR(100) NOT NULL DEFAULT 'Mola',
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_sbr_staff (staff_id),
  CONSTRAINT fk_sbr_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_sbr_staff FOREIGN KEY (staff_id) REFERENCES booking_staff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_leaves (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  staff_id CHAR(36) NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason VARCHAR(240) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_sl_business_dates (business_id, start_date, end_date),
  CONSTRAINT fk_sl_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_sl_staff FOREIGN KEY (staff_id) REFERENCES booking_staff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_customers (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  customer_user_id CHAR(36) NULL,
  first_name VARCHAR(100) NOT NULL DEFAULT '',
  last_name VARCHAR(100) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL,
  phone_normalized VARCHAR(20) NOT NULL DEFAULT '',
  email VARCHAR(191) NOT NULL DEFAULT '',
  notes TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_bc_business_phone (business_id, phone_normalized),
  CONSTRAINT fk_bc_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointments (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  booking_customer_id CHAR(36) NOT NULL,
  customer_user_id CHAR(36) NULL,
  customer_name VARCHAR(160) NOT NULL DEFAULT '',
  customer_phone VARCHAR(40) NOT NULL DEFAULT '',
  customer_phone_normalized VARCHAR(20) NOT NULL DEFAULT '',
  service_id CHAR(36) NULL,
  staff_id CHAR(36) NULL,
  service_name_snapshot VARCHAR(180) NOT NULL,
  service_price_snapshot DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  service_duration_snapshot INT NOT NULL DEFAULT 30,
  staff_name_snapshot VARCHAR(160) NOT NULL,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_at DATETIME(3) NOT NULL,
  end_at DATETIME(3) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid',
  paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  customer_notes TEXT NOT NULL,
  business_notes TEXT NOT NULL,
  source VARCHAR(24) NOT NULL DEFAULT 'online',
  cancelled_by VARCHAR(24) NULL,
  cancellation_reason TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_appt_biz_date (business_id, appointment_date),
  INDEX idx_appt_staff_range (staff_id, start_at, end_at),
  INDEX idx_appt_phone_norm (customer_phone_normalized),
  CONSTRAINT fk_appt_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_appt_customer FOREIGN KEY (booking_customer_id) REFERENCES booking_customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointment_payments (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  appointment_id CHAR(36) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  payment_type VARCHAR(24) NOT NULL DEFAULT 'collection',
  payment_method VARCHAR(24) NOT NULL DEFAULT 'nakit',
  payment_date DATE NOT NULL,
  income_transaction_id CHAR(36) NULL,
  expense_transaction_id CHAR(36) NULL,
  idempotency_key VARCHAR(120) NULL,
  notes TEXT NOT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ap_idem (business_id, idempotency_key),
  INDEX idx_ap_appt (appointment_id),
  CONSTRAINT fk_ap_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_ap_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointment_reviews (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  appointment_id CHAR(36) NOT NULL UNIQUE,
  customer_user_id CHAR(36) NULL,
  customer_phone_normalized VARCHAR(20) NOT NULL DEFAULT '',
  customer_name VARCHAR(160) NOT NULL DEFAULT 'Müşteri',
  service_id CHAR(36) NULL,
  staff_id CHAR(36) NULL,
  rating TINYINT NOT NULL,
  comment TEXT NOT NULL,
  business_reply TEXT NULL,
  replied_at DATETIME(3) NULL,
  replied_by CHAR(36) NULL,
  moderation_status VARCHAR(24) NOT NULL DEFAULT 'published',
  report_reason TEXT NULL,
  reported_at DATETIME(3) NULL,
  reported_by CHAR(36) NULL,
  moderation_note TEXT NULL,
  moderated_at DATETIME(3) NULL,
  moderated_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_rev_business (business_id, created_at),
  CONSTRAINT fk_rev_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_rev_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointment_notifications (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  appointment_id CHAR(36) NULL,
  recipient_type VARCHAR(24) NOT NULL,
  recipient_user_id CHAR(36) NULL,
  recipient_phone VARCHAR(40) NOT NULL DEFAULT '',
  notification_type VARCHAR(60) NOT NULL,
  channel VARCHAR(24) NOT NULL DEFAULT 'in_app',
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  delivery_status VARCHAR(24) NOT NULL DEFAULT 'sent',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_an_business (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Varsayilan Sistem Ayarlari ve Yetki Listesi
INSERT IGNORE INTO system_settings (
  id, system_name, logo_url, hero_slogan, hero_subheadline, contact_email, contact_phone,
  pricing_description, terms_of_service, privacy_policy, booking_module_default_included, booking_module_addon_price
) VALUES (
  1,
  'EsnafTakip',
  '',
  'İşletmenizin tüm borç ve alacakları tek yerde.',
  'Müşteri alacakları, toptancı borçları, vadeli satışlar, gelir-gider ve online randevu süreçlerinizi kolayca yönetin.',
  'destek@esnaftakip.com',
  '',
  'Tüm işletmeler için şeffaf aylık abonelik.',
  'EsnafTakip hizmet kullanım şartları.',
  'EsnafTakip gizlilik ve veri koruma politikası.',
  1,
  0.00
);

INSERT IGNORE INTO permissions (code, label, module) VALUES
  ('customers.view', 'Müşterileri Görüntüleme', 'Müşteriler'),
  ('customers.create', 'Müşteri Ekleme', 'Müşteriler'),
  ('customers.edit', 'Müşteri Düzenleme', 'Müşteriler'),
  ('customers.delete', 'Müşteri Silme / Pasife Alma', 'Müşteriler'),
  ('suppliers.view', 'Toptancıları Görüntüleme', 'Toptancılar'),
  ('suppliers.create', 'Toptancı Ekleme', 'Toptancılar'),
  ('suppliers.edit', 'Toptancı Düzenleme', 'Toptancılar'),
  ('suppliers.delete', 'Toptancı Silme / Pasife Alma', 'Toptancılar'),
  ('credit_sales.view', 'Vadeli Satışları Görüntüleme', 'Vadeli Satışlar'),
  ('credit_sales.create', 'Vadeli Satış ve Tahsilat Ekleme', 'Vadeli Satışlar'),
  ('credit_sales.edit', 'Vadeli Satış Düzenleme / İptal', 'Vadeli Satışlar'),
  ('finance.view', 'Gelir ve Giderleri Görüntüleme', 'Finans'),
  ('finance.create', 'Gelir ve Gider Kaydı Ekleme', 'Finans'),
  ('finance.edit', 'Gelir ve Gider Düzenleme / İptal', 'Finans'),
  ('recurring.view', 'Sabit Giderleri Görüntüleme', 'Sabit Giderler'),
  ('recurring.manage', 'Sabit Gider Ekleme ve Ödeme', 'Sabit Giderler'),
  ('reports.view', 'Raporları Görüntüleme', 'Raporlar'),
  ('users.manage', 'İşletme Kullanıcılarını Yönetme', 'Kullanıcılar'),
  ('booking.view', 'Online Randevuları Görüntüleme', 'Online Randevu'),
  ('booking.manage', 'Randevu Onay, İptal ve Müşteri Yönetimi', 'Online Randevu'),
  ('booking.services', 'Randevu Hizmet ve Fiyat Yönetimi', 'Online Randevu'),
  ('booking.staff', 'Personel, Mola ve İzin Yönetimi', 'Online Randevu'),
  ('booking.design', 'Randevu Sayfası Tasarım ve Yayın Ayarları', 'Online Randevu'),
  ('booking.payments', 'Randevu Tahsilatı ve İade Kaydı', 'Online Randevu');
