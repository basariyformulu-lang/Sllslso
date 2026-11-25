import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleSupabase, isServiceRoleConfigured } from '@/lib/supabase/server';
import { ALL_PERMISSION_CODES } from '@/lib/permissions';

const registerSchema = z
  .object({
    businessName: z.string().trim().min(2, 'İşletme adı en az 2 karakter olmalıdır.').max(120),
    firstName: z.string().trim().min(2, 'Ad en az 2 karakter olmalıdır.').max(60),
    lastName: z.string().trim().min(2, 'Soyad en az 2 karakter olmalıdır.').max(60),
    phone: z
      .string()
      .trim()
      .min(10, 'Geçerli bir telefon numarası giriniz.')
      .max(20),
    email: z.string().trim().email('Geçerli bir e-posta adresi giriniz.').toLowerCase(),
    password: z.string().min(8, 'Şifre en az 8 karakter olmalıdır.').max(100),
    confirmPassword: z.string(),
    acceptedTerms: z.boolean().refine((v) => v === true, {
      message: 'Kullanım koşulları ve gizlilik metnini onaylamalısınız.',
    }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Şifreler eşleşmiyor.',
    path: ['confirmPassword'],
  });

function generateBusinessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `ESNAF-${suffix}`;
}

export async function POST(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      {
        error:
          'Veritabanı bağlantısı henüz yapılandırılmamış. Lütfen Supabase ortam değişkenlerini tanımlayın.',
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek gövdesi.' }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Form alanlarını kontrol ediniz.' },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const db = createServiceRoleSupabase()!;

  // Aynı e-posta ile ikinci hesap oluşturulmasını engelle
  const { data: existingProfile } = await db
    .from('profiles')
    .select('id')
    .eq('email', data.email)
    .maybeSingle();

  if (existingProfile) {
    return NextResponse.json(
      { error: 'Bu e-posta adresi ile zaten kayıtlı bir hesap bulunmaktadır.' },
      { status: 409 }
    );
  }

  // Tek aktif abonelik paketini al
  const { data: plan, error: planErr } = await db
    .from('subscription_plans')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (planErr || !plan) {
    return NextResponse.json(
      { error: 'Sistemde tanımlı abonelik paketi bulunamadı. Lütfen yönetici ile iletişime geçin.' },
      { status: 500 }
    );
  }

  // 1. Supabase Auth kullanıcısı oluştur
  const { data: authData, error: authError } = await db.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: {
      first_name: data.firstName,
      last_name: data.lastName,
      phone: data.phone,
    },
  });

  if (authError || !authData.user) {
    const msg = authError?.message?.toLowerCase().includes('already')
      ? 'Bu e-posta adresi ile zaten bir kullanıcı mevcut.'
      : authError?.message ?? 'Kullanıcı hesabı oluşturulamadı.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const userId = authData.user.id;

  try {
    // 2. Profil kaydını garanti et
    await db.from('profiles').upsert({
      id: userId,
      first_name: data.firstName,
      last_name: data.lastName,
      phone: data.phone,
      email: data.email,
      email_verified: false,
      phone_verified: false,
    });

    // 3. İşletme kaydı oluştur (Ödeme Bekliyor)
    const businessCode = generateBusinessCode();
    const { data: business, error: bizErr } = await db
      .from('businesses')
      .insert({
        name: data.businessName,
        business_code: businessCode,
        owner_id: userId,
        phone: data.phone,
        email: data.email,
        subscription_status: 'payment_pending',
        is_active: true,
      })
      .select('*')
      .single();

    if (bizErr || !business) {
      throw new Error(bizErr?.message ?? 'İşletme kaydı oluşturulamadı.');
    }

    // 4. İşletme sahibi üyeliği (tam yetki)
    const { error: memberErr } = await db.from('business_members').insert({
      business_id: business.id,
      user_id: userId,
      role_name: 'İşletme Sahibi',
      is_owner: true,
      is_active: true,
      permissions: ALL_PERMISSION_CODES,
    });
    if (memberErr) throw new Error(memberErr.message);

    // 5. Abonelik kaydı
    const { error: subErr } = await db.from('subscriptions').insert({
      business_id: business.id,
      plan_id: plan.id,
      status: 'payment_pending',
      locked_price: plan.monthly_price,
    });
    if (subErr) throw new Error(subErr.message);

    // 6. Varsayılan gelir ve gider kategorileri
    await db.from('expense_categories').insert([
      { business_id: business.id, name: 'Elektrik', is_default: true },
      { business_id: business.id, name: 'Su', is_default: true },
      { business_id: business.id, name: 'Personel', is_default: true },
      { business_id: business.id, name: 'Kira', is_default: true },
      { business_id: business.id, name: 'Nakliye', is_default: true },
      { business_id: business.id, name: 'Diğer', is_default: true },
    ]);

    await db.from('income_categories').insert([
      { business_id: business.id, name: 'Peşin Satış', is_default: true },
      { business_id: business.id, name: 'Hizmet Geliri', is_default: true },
      { business_id: business.id, name: 'Diğer', is_default: true },
    ]);

    await db.from('audit_logs').insert({
      scope: 'business',
      business_id: business.id,
      actor_user_id: userId,
      actor_name: `${data.firstName} ${data.lastName}`,
      action: 'business_registered',
      entity_type: 'businesses',
      entity_id: business.id,
      new_values: { name: data.businessName, status: 'payment_pending' },
      description: 'Yeni işletme başvurusu oluşturuldu.',
    });

    return NextResponse.json(
      {
        success: true,
        businessId: business.id,
        businessCode: business.business_code,
        message: 'Başvurunuz alındı. Ödeme ekranına yönlendiriliyorsunuz.',
      },
      { status: 201 }
    );
  } catch (err) {
    // Geri alma: auth kullanıcısını temizle
    await db.auth.admin.deleteUser(userId);
    const message = err instanceof Error ? err.message : 'Başvuru işlemi tamamlanamadı.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
