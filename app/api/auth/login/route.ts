import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { setSessionCookie, verifyPassword } from '@/lib/auth-mysql';
import { isDatabaseConfigured, queryOne, toBool, writeAuditLog } from '@/lib/db';

const loginSchema = z.object({
  email: z.string().trim().email('Geçerli bir e-posta adresi giriniz.').toLowerCase(),
  password: z.string().min(1, 'Şifre giriniz.'),
});

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'MySQL veritabanı henüz yapılandırılmamış.' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Giriş bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;

  // 1. Sistem yoneticisi kontrolu
  const adminRow = await queryOne<{
    user_id: string;
    full_name: string;
    email: string;
    password_hash: string;
  }>('SELECT user_id, full_name, email, password_hash FROM system_admins WHERE email = ? LIMIT 1', [
    email,
  ]);

  if (adminRow) {
    if (!verifyPassword(password, adminRow.password_hash)) {
      return NextResponse.json(
        { error: 'E-posta adresi veya şifre hatalı.' },
        { status: 401 }
      );
    }

    const res = NextResponse.json({
      success: true,
      role: 'admin',
      redirectTo: '/admin',
    });
    setSessionCookie(res, {
      userId: adminRow.user_id,
      email: adminRow.email,
      role: 'admin',
    });

    await writeAuditLog({
      scope: 'admin',
      actorUserId: adminRow.user_id,
      actorName: adminRow.full_name,
      action: 'admin_logged_in',
      entityType: 'system_admins',
      entityId: adminRow.user_id,
      description: 'Sistem yöneticisi giriş yaptı.',
    });

    return res;
  }

  // 2. Isletme kullanicisi kontrolu
  const profile = await queryOne<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    password_hash: string | null;
  }>(
    'SELECT id, first_name, last_name, email, password_hash FROM profiles WHERE email = ? LIMIT 1',
    [email]
  );

  if (!profile) {
    return NextResponse.json(
      { error: 'E-posta adresi veya şifre hatalı.' },
      { status: 401 }
    );
  }

  if (!profile.password_hash) {
    return NextResponse.json(
      {
        error:
          'Bu hesap MySQL veritabanına taşınmıştır. İlk giriş için "Şifremi Unuttum" sayfasından telefon veya işletme kodunuzla yeni şifrenizi belirleyiniz.',
        code: 'PASSWORD_RESET_REQUIRED',
      },
      { status: 401 }
    );
  }

  if (!verifyPassword(password, profile.password_hash)) {
    return NextResponse.json(
      { error: 'E-posta adresi veya şifre hatalı.' },
      { status: 401 }
    );
  }

  const membership = await queryOne<{
    business_id: string;
    is_active: number;
    subscription_status: string;
    subscription_end_at: string | null;
    biz_active: number;
  }>(
    `SELECT bm.business_id, bm.is_active, b.subscription_status, b.subscription_end_at, b.is_active AS biz_active
     FROM business_members bm
     INNER JOIN businesses b ON b.id = bm.business_id
     WHERE bm.user_id = ? AND bm.is_active = 1
     LIMIT 1`,
    [profile.id]
  );

  if (!membership) {
    return NextResponse.json(
      { error: 'Aktif işletme üyeliği bulunamadı. İşletme yöneticinizle görüşünüz.' },
      { status: 403 }
    );
  }

  const subActive =
    toBool(membership.biz_active) &&
    membership.subscription_status === 'active' &&
    (!membership.subscription_end_at ||
      new Date(membership.subscription_end_at).getTime() > Date.now());

  const res = NextResponse.json({
    success: true,
    role: 'business',
    redirectTo: subActive ? '/panel' : '/odeme',
  });

  setSessionCookie(res, {
    userId: profile.id,
    email: profile.email,
    role: 'business',
  });

  return res;
}
