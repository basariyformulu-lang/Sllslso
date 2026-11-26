import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleSupabase, isServiceRoleConfigured } from '@/lib/supabase/server';

const customerRegisterSchema = z
  .object({
    firstName: z.string().trim().min(2, 'Ad en az 2 karakter olmalıdır.').max(60),
    lastName: z.string().trim().min(2, 'Soyad en az 2 karakter olmalıdır.').max(60),
    phone: z.string().trim().min(10, 'Geçerli bir telefon numarası giriniz.').max(25),
    email: z.string().trim().email('Geçerli bir e-posta adresi giriniz.').toLowerCase(),
    password: z.string().min(6, 'Şifre en az 6 karakter olmalıdır.').max(100),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Şifreler eşleşmiyor.',
    path: ['confirmPassword'],
  });

export async function POST(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ error: 'Veritabanı bağlantısı yapılandırılmamış.' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek gövdesi.' }, { status: 400 });
  }

  const parsed = customerRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Kayıt bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const db = createServiceRoleSupabase()!;

  const { data: existingProfile } = await db
    .from('profiles')
    .select('id')
    .eq('email', d.email)
    .maybeSingle();

  if (existingProfile) {
    return NextResponse.json(
      { error: 'Bu e-posta adresi ile zaten kayıtlı bir hesap var. Lütfen giriş yapın.' },
      { status: 409 }
    );
  }

  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email: d.email,
    password: d.password,
    email_confirm: true,
    user_metadata: {
      first_name: d.firstName,
      last_name: d.lastName,
      phone: d.phone,
      account_type: 'customer',
    },
  });

  if (authErr || !authData.user) {
    return NextResponse.json(
      { error: authErr?.message ?? 'Müşteri hesabı oluşturulamadı.' },
      { status: 400 }
    );
  }

  const userId = authData.user.id;
  try {
    await db.from('profiles').upsert({
      id: userId,
      first_name: d.firstName,
      last_name: d.lastName,
      phone: d.phone,
      email: d.email,
      email_verified: false,
      phone_verified: false,
    });

    const { error: custAccErr } = await db.from('customer_accounts').upsert({
      user_id: userId,
      first_name: d.firstName,
      last_name: d.lastName,
      phone: d.phone,
      email: d.email,
    });
    if (custAccErr) throw new Error(custAccErr.message);

    return NextResponse.json(
      {
        success: true,
        userId,
        message: 'Müşteri hesabınız oluşturuldu.',
      },
      { status: 201 }
    );
  } catch (err) {
    await db.auth.admin.deleteUser(userId);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Kayıt tamamlanamadı.' },
      { status: 500 }
    );
  }
}
