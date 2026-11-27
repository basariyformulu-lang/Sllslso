import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { hashPassword, setSessionCookie } from '@/lib/auth-mysql';
import {
  execute,
  isDatabaseConfigured,
  queryOne,
  toMySqlDateTime,
  uuid,
  writeAuditLog,
} from '@/lib/db';

const bootstrapSchema = z.object({
  fullName: z.string().trim().min(2, 'Ad soyad giriniz.').max(100),
  email: z.string().trim().email('Geçerli e-posta adresi giriniz.').toLowerCase(),
  password: z.string().min(8, 'Yönetici şifresi en az 8 karakter olmalıdır.').max(120),
  bootstrapSecret: z.string().optional().default(''),
});

function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === 'ER_NO_SUCH_TABLE' ||
    (e.message ?? '').toLowerCase().includes("doesn't exist")
  );
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({
      configured: false,
      schemaReady: false,
      permissionsReady: false,
      hasAdmin: false,
      requiresSecret: false,
      dbEngine: 'mysql',
    });
  }

  try {
    const countRow = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM system_admins');
    const hasAdmin = Number(countRow?.c ?? 0) > 0;
    return NextResponse.json({
      configured: true,
      schemaReady: true,
      permissionsReady: true,
      hasAdmin,
      requiresSecret: Boolean(process.env.ADMIN_BOOTSTRAP_SECRET?.trim()),
      dbEngine: 'mysql',
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      let sqlScript: string | undefined;
      if (req.nextUrl.searchParams.get('includeSql') === '1') {
        try {
          sqlScript = await fs.readFile(path.join(process.cwd(), 'mysql', 'schema.sql'), 'utf8');
        } catch {
          sqlScript = undefined;
        }
      }
      return NextResponse.json({
        configured: true,
        schemaReady: false,
        permissionsReady: false,
        hasAdmin: false,
        requiresSecret: false,
        dbEngine: 'mysql',
        sqlScript,
      });
    }
    return NextResponse.json({
      configured: false,
      schemaReady: false,
      permissionsReady: false,
      hasAdmin: false,
      requiresSecret: false,
      dbEngine: 'mysql',
      error: err instanceof Error ? err.message : 'Veritabanı bağlantı hatası.',
    });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'MySQL veritabanı yapılandırılmamış.' }, { status: 503 });
  }

  try {
    const countRow = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM system_admins');
    if (Number(countRow?.c ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Sistem yöneticisi zaten mevcut. İlk kurulum güvenlik nedeniyle kilitlidir.' },
        { status: 403 }
      );
    }
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json(
        { error: 'MySQL veritabanı tabloları henüz oluşturulmamış. Önce otomatik kurulumu çalıştırınız.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Veritabanı bağlantı hatası.' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = bootstrapSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Bilgileri kontrol ediniz.' },
      { status: 400 }
    );
  }

  const expectedSecret = process.env.ADMIN_BOOTSTRAP_SECRET?.trim();
  if (expectedSecret) {
    const providedBuf = Buffer.from(parsed.data.bootstrapSecret);
    const expectedBuf = Buffer.from(expectedSecret);
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return NextResponse.json({ error: 'Kurulum güvenlik anahtarı geçersiz.' }, { status: 403 });
    }
  }

  const { fullName, email, password } = parsed.data;
  const userId = uuid();
  const passwordHash = hashPassword(password);
  const nowStr = toMySqlDateTime();

  await execute(
    `INSERT INTO system_admins (user_id, full_name, email, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, fullName, email, passwordHash, nowStr]
  );

  // Varsayilan abonelik plani yoksa olustur
  const existingPlan = await queryOne<{ id: string }>('SELECT id FROM subscription_plans LIMIT 1');
  if (!existingPlan) {
    await execute(
      `INSERT INTO subscription_plans (id, name, description, monthly_price, duration_days, features, is_active, effective_from, created_at, updated_at)
       VALUES (?, 'EsnafTakip İşletme Aboneliği', 'Cari hesap, finans ve online randevu dahil eksiksiz işletme yönetimi.', 490.00, 30, ?, 1, ?, ?, ?)`,
      [
        uuid(),
        JSON.stringify([
          'Sınırsız müşteri ve toptancı cari takibi',
          'Otomatik vade hesaplama ve uyarı sistemi',
          'Online randevu sayfası ve takvim yönetimi',
          'Gelir-gider ve aylık sabit gider takibi',
        ]),
        nowStr,
        nowStr,
        nowStr,
      ]
    );
  }

  await writeAuditLog({
    scope: 'admin',
    actorUserId: userId,
    actorName: fullName,
    action: 'system_admin_bootstrapped',
    entityType: 'system_admins',
    entityId: userId,
    newValues: { email, full_name: fullName },
    description: 'İlk sistem yöneticisi MySQL üzerinde oluşturuldu.',
  });

  const res = NextResponse.json(
    { success: true, message: 'Sistem yöneticisi hesabınız oluşturuldu.' },
    { status: 201 }
  );

  setSessionCookie(res, {
    userId,
    email,
    role: 'admin',
  });

  return res;
}
