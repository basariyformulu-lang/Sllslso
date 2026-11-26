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
