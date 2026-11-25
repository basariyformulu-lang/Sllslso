# EsnafTakip — Kurulum, Supabase Veritabanı ve Yönetici Hesabı Rehberi

## 1. Ortam Değişkenleri (`.env.local`)
Aşağıdaki ortam değişkenlerini `.env.local` dosyasına (veya barındırma panelinize) ekleyin:

```env
NEXT_PUBLIC_SUPABASE_URL="https://PROJE_ID.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="SUPABASE_ANON_PUBLIC_KEY"
SUPABASE_SERVICE_ROLE_KEY="SUPABASE_SERVICE_ROLE_SECRET_KEY"
ADMIN_BOOTSTRAP_SECRET="GUCLU_ILK_YONETICI_KURULUM_ANAHTARI"
APP_URL="http://localhost:3000"
```

> **Güvenlik Notu:** `SUPABASE_SERVICE_ROLE_KEY` ve `ADMIN_BOOTSTRAP_SECRET` yalnızca sunucu tarafında (`app/api/*`) kullanılır; asla `NEXT_PUBLIC_` ile öneklendirilmemelidir.

---

## 2. Supabase Veritabanı Kurulumu (SQL Sırası)
Supabase Dashboard -> **SQL Editor** bölümünden `/supabase/migrations/` klasöründeki dosyaları aşağıdaki sırayla çalıştırın:

1. `supabase/migrations/001_initial_schema.sql` — 23 temel tablo (`NUMERIC(14,2)` para alanları, tek abonelik paketi kısıtı, tek varsayılan banka hesabı kısıtı, işletme başına tek bekleyen ödeme talebi kısıtı, sabit gider ay bazlı çift ödeme engeli) ve indeksler.
2. `supabase/migrations/002_rls_policies.sql` — Tüm tablolarda Row Level Security (RLS) kuralları ve yardımcı fonksiyonlar (`is_system_admin`, `is_business_member`, `has_active_subscription`, `has_business_permission`).
3. `supabase/migrations/003_functions_and_triggers.sql` — Yeni Auth kullanıcısı profil tetikleyicisi (`handle_new_user`) ve atomik işlemler (`admin_approve_payment_request`, `pay_recurring_expense_period`).
4. `supabase/migrations/004_seed_defaults.sql` — Varsayılan tanıtım ayarları, tek standart abonelik paketi (`499,00 TL/Ay`) ve 27 granüler yetki tanımı.

### Dekont Depolama Alanı (Opsiyonel)
Banka dekontlarını yüklemek için Supabase Storage içinde `receipts` adında private bir bucket oluşturun veya mevcut URL/dosya yükleme akışını kullanın.

---

## 3. İlk Sistem Yöneticisi Hesabı Oluşturma
1. Sunucuyu başlatın (`npm run dev`) ve tarayıcıda `/admin` adresine gidin.
2. Sistemde henüz kayıtlı sistem yöneticisi yoksa `/admin` ekranı otomatik olarak **"İlk Sistem Yöneticisi Kurulumu"** formunu açar.
3. Ad, soyad, e-posta, şifre ve `ADMIN_BOOTSTRAP_SECRET` değerini girerek ilk Sistem Yöneticisini oluşturun.
4. İlk yönetici oluşturulduktan sonra kurulum ucu (`/api/admin/bootstrap`) kalıcı olarak kilitlenir ve sonraki girişlerde normal yönetici kimlik doğrulaması gerekir.

---

## 4. Yerel Çalıştırma
```bash
npm install
npm run dev
```
Uygulama `http://localhost:3000` adresinde çalışır.
