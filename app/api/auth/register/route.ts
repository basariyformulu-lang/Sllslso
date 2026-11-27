import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashPassword, setSessionCookie } from '@/lib/auth-mysql';
import {
  isDatabaseConfigured,
  queryOne,
  toBool,
  toMySqlDateTime,
  uuid,
  withTransaction,
  writeAuditLog,
} from '@/lib/db';
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
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        error:
          'MySQL veritabanı bağlantısı henüz yapılandırılmamış. Lütfen ortam değişkenlerini kontrol ediniz.',
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

  const existingProfile = await queryOne<{ id: string }>(
    'SELECT id FROM profiles WHERE email = ? LIMIT 1',
    [data.email]
  );
  if (existingProfile) {
    return NextResponse.json(
      { error: 'Bu e-posta adresi ile zaten kayıtlı bir hesap bulunmaktadır.' },
      { status: 409 }
    );
  }

  const existingAdmin = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM system_admins WHERE email = ? LIMIT 1',
    [data.email]
  );
  if (existingAdmin) {
    return NextResponse.json(
      { error: 'Bu e-posta adresi sistem yöneticisi olarak kullanılmaktadır.' },
      { status: 409 }
    );
  }

  const plan = await queryOne<{
    id: string;
    name: string;
    monthly_price: number;
    duration_days: number;
  }>('SELECT id, name, monthly_price, duration_days FROM subscription_plans LIMIT 1');

  const userId = uuid();
  const businessId = uuid();
  const memberId = uuid();
  const subId = uuid();
  const businessCode = generateBusinessCode();
  const passwordHash = hashPassword(data.password);
  const nowStr = toMySqlDateTime();

  const sysCfg = await queryOne<{ booking_module_default_included: number }>(
    'SELECT booking_module_default_included FROM system_settings WHERE id = 1 LIMIT 1'
  );
  const bookingIncluded = sysCfg ? toBool(sysCfg.booking_module_default_included) : true;

  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO profiles (id, first_name, last_name, phone, email, password_hash, email_verified, phone_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      [userId, data.firstName, data.lastName, data.phone, data.email, passwordHash, nowStr, nowStr]
    );

    await conn.execute(
      `INSERT INTO businesses (id, name, business_code, owner_id, phone, email, address, subscription_status, is_active, booking_module_enabled, booking_module_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', 'payment_pending', 1, ?, ?, ?, ?)`,
      [
        businessId,
        data.businessName,
        businessCode,
        userId,
        data.phone,
        data.email,
        bookingIncluded ? 1 : 0,
        bookingIncluded ? 'included' : 'addon_locked',
        nowStr,
        nowStr,
      ]
    );

    await conn.execute(
      `INSERT INTO business_members (id, business_id, user_id, role_name, is_owner, is_active, permissions, created_at)
       VALUES (?, ?, ?, 'İşletme Sahibi', 1, 1, ?, ?)`,
      [memberId, businessId, userId, JSON.stringify(ALL_PERMISSION_CODES), nowStr]
    );

    await conn.execute(
      `INSERT INTO subscriptions (id, business_id, plan_id, plan_name, monthly_price, duration_days, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'payment_pending', ?)`,
      [
        subId,
        businessId,
        plan?.id ?? null,
        plan?.name ?? 'EsnafTakip İşletme Aboneliği',
        Number(plan?.monthly_price ?? 490),
        Number(plan?.duration_days ?? 30),
        nowStr,
      ]
    );

    const expCats = ['Elektrik', 'Su', 'Personel', 'Kira', 'Nakliye', 'Diğer'];
    for (const c of expCats) {
      await conn.execute(
        'INSERT INTO expense_categories (id, business_id, name, is_active) VALUES (?, ?, ?, 1)',
        [uuid(), businessId, c]
      );
    }

    const incCats = ['Peşin Satış', 'Hizmet Geliri', 'Online Randevu', 'Diğer'];
    for (const c of incCats) {
      await conn.execute(
        'INSERT INTO income_categories (id, business_id, name, is_active) VALUES (?, ?, ?, 1)',
        [uuid(), businessId, c]
      );
    }
  });

  await writeAuditLog({
    scope: 'business',
    businessId,
    actorUserId: userId,
    actorName: `${data.firstName} ${data.lastName}`,
    action: 'business_registered',
    entityType: 'businesses',
    entityId: businessId,
    newValues: { name: data.businessName, status: 'payment_pending' },
    description: 'Yeni işletme başvurusu oluşturuldu.',
  });

  const res = NextResponse.json(
    {
      success: true,
      businessId,
      businessCode,
      message: 'Başvurunuz alındı. Ödeme ekranına yönlendiriliyorsunuz.',
    },
    { status: 201 }
  );

  setSessionCookie(res, {
    userId,
    email: data.email,
    role: 'business',
  });

  return res;
}
