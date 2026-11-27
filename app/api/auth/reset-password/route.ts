import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '@/lib/auth-mysql';
import { getAuthContext } from '@/lib/auth-server';
import { normalizePhoneTR } from '@/lib/booking-helpers';
import { execute, isDatabaseConfigured, queryOne, toMySqlDateTime } from '@/lib/db';

const verifySchema = z.object({
  action: z.literal('verify'),
  email: z.string().trim().email('Geçerli bir e-posta adresi giriniz.').toLowerCase(),
  phoneOrCode: z
    .string()
    .trim()
    .min(4, 'Kayıtlı telefon numaranızı veya ESNAF-... işletme kodunuzu giriniz.'),
});

const confirmSchema = z
  .object({
    action: z.literal('confirm'),
    email: z.string().trim().email('Geçerli e-posta giriniz.').toLowerCase(),
    token: z.string().trim().min(10, 'Doğrulama anahtarı geçersiz.'),
    password: z.string().min(8, 'Yeni şifre en az 8 karakter olmalıdır.').max(100),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Şifreler eşleşmiyor.',
    path: ['confirmPassword'],
  });

const changeSelfSchema = z
  .object({
    action: z.literal('change_self'),
    currentPassword: z.string().optional().default(''),
    password: z.string().min(8, 'Yeni şifre en az 8 karakter olmalıdır.').max(100),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Şifreler eşleşmiyor.',
    path: ['confirmPassword'],
  });

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'MySQL veritabanı yapılandırılmamış.' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const rawAction = (body as { action?: string } | null)?.action;

  if (rawAction === 'change_self') {
    const ctx = await getAuthContext();
    if (!ctx) {
      return NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 });
    }
    const parsed = changeSelfSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Şifre bilgilerini kontrol ediniz.' },
        { status: 400 }
      );
    }

    const newHash = hashPassword(parsed.data.password);
    const nowStr = toMySqlDateTime();

    if (ctx.isSystemAdmin) {
      const admin = await queryOne<{ password_hash: string }>(
        'SELECT password_hash FROM system_admins WHERE user_id = ?',
        [ctx.userId]
      );
      if (
        admin?.password_hash &&
        parsed.data.currentPassword &&
        !verifyPassword(parsed.data.currentPassword, admin.password_hash)
      ) {
        return NextResponse.json({ error: 'Mevcut şifreniz hatalı.' }, { status: 400 });
      }
      await execute('UPDATE system_admins SET password_hash = ? WHERE user_id = ?', [
        newHash,
        ctx.userId,
      ]);
    } else {
      await execute(
        'UPDATE profiles SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL, updated_at = ? WHERE id = ?',
        [newHash, nowStr, ctx.userId]
      );
    }

    return NextResponse.json({ success: true, message: 'Şifreniz başarıyla güncellendi.' });
  }

  if (rawAction === 'verify') {
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Bilgileri kontrol ediniz.' },
        { status: 400 }
      );
    }

    const profile = await queryOne<{
      id: string;
      phone: string;
      email: string;
    }>('SELECT id, phone, email FROM profiles WHERE email = ? LIMIT 1', [parsed.data.email]);

    if (!profile) {
      return NextResponse.json(
        { error: 'E-posta veya doğrulama bilgisi eşleşmedi.' },
        { status: 404 }
      );
    }

    const inputNormPhone = normalizePhoneTR(parsed.data.phoneOrCode);
    const storedNormPhone = normalizePhoneTR(profile.phone);
    const phoneMatches = Boolean(inputNormPhone && storedNormPhone && inputNormPhone === storedNormPhone);

    let codeMatches = false;
    const upperInput = parsed.data.phoneOrCode.trim().toUpperCase();
    if (upperInput.startsWith('ESNAF-')) {
      const biz = await queryOne<{ id: string }>(
        `SELECT b.id
         FROM businesses b
         INNER JOIN business_members bm ON bm.business_id = b.id
         WHERE bm.user_id = ? AND UPPER(b.business_code) = ?
         LIMIT 1`,
        [profile.id, upperInput]
      );
      codeMatches = Boolean(biz);
    }

    if (!phoneMatches && !codeMatches) {
      return NextResponse.json(
        {
          error:
            'Kayıtlı telefon numarası veya işletme kodu doğrulanamadı. Emin değilseniz sistem yöneticinizden şifre sıfırlama isteyebilirsiniz.',
        },
        { status: 403 }
      );
    }

    const resetToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = toMySqlDateTime(new Date(Date.now() + 15 * 60 * 1000));

    await execute(
      'UPDATE profiles SET reset_token = ?, reset_token_expires_at = ?, updated_at = ? WHERE id = ?',
      [resetToken, expiresAt, toMySqlDateTime(), profile.id]
    );

    return NextResponse.json({
      success: true,
      resetToken,
      message: 'Hesap doğrulandı. Şimdi yeni şifrenizi belirleyebilirsiniz.',
    });
  }

  if (rawAction === 'confirm') {
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Form bilgilerini kontrol ediniz.' },
        { status: 400 }
      );
    }

    const profile = await queryOne<{
      id: string;
      reset_token: string | null;
      reset_token_expires_at: string | null;
    }>(
      'SELECT id, reset_token, reset_token_expires_at FROM profiles WHERE email = ? LIMIT 1',
      [parsed.data.email]
    );

    if (
      !profile ||
      !profile.reset_token ||
      profile.reset_token !== parsed.data.token ||
      !profile.reset_token_expires_at ||
      new Date(profile.reset_token_expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()
    ) {
      return NextResponse.json(
        { error: 'Doğrulama süresi dolmuş veya geçersiz. Lütfen tekrar doğrulayın.' },
        { status: 400 }
      );
    }

    const newHash = hashPassword(parsed.data.password);
    await execute(
      'UPDATE profiles SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL, updated_at = ? WHERE id = ?',
      [newHash, toMySqlDateTime(), profile.id]
    );

    return NextResponse.json({
      success: true,
      message: 'Yeni şifreniz kaydedildi. Şimdi giriş yapabilirsiniz.',
    });
  }

  return NextResponse.json({ error: 'Geçersiz işlem türü.' }, { status: 400 });
}
