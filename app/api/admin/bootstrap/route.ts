import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createServiceRoleSupabase, isServiceRoleConfigured } from '@/lib/supabase/server';

const bootstrapSchema = z.object({
  fullName: z.string().trim().min(2, 'Ad soyad giriniz.').max(100),
  email: z.string().trim().email('Geçerli e-posta adresi giriniz.').toLowerCase(),
  password: z.string().min(10, 'Yönetici şifresi en az 10 karakter olmalıdır.').max(120),
  bootstrapSecret: z.string().optional().default(''),
});

function extractSupabaseProjectRef(): string | null {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    const hostParts = url.hostname.split('.');
    return hostParts[0] || null;
  } catch {
    return null;
  }
}

function isMissingTableError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const code = err.code || '';
  const msg = (err.message || '').toLowerCase();
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}

const GRANT_SQL = `GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;`;

function isPermissionDeniedError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const code = err.code || '';
  const msg = (err.message || '').toLowerCase();
  return code === '42501' || msg.includes('permission denied');
}

export async function GET(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({
      configured: false,
      schemaReady: false,
      permissionsReady: false,
      hasAdmin: false,
      requiresSecret: false,
      projectRef: null,
    });
  }

  const db = createServiceRoleSupabase()!;
  const { data: admins, error } = await db
    .from('system_admins')
    .select('id')
    .limit(1);

  const projectRef = extractSupabaseProjectRef();

  if (error && isMissingTableError(error)) {
    let sqlScript: string | undefined;
    if (req.nextUrl.searchParams.get('includeSql') === '1') {
      try {
        sqlScript = await fs.readFile(
          path.join(process.cwd(), 'supabase', 'TEK_SEFERLIK_KURULUM.sql'),
          'utf8'
        );
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
      projectRef,
      sqlScript,
    });
  }

  if (error && isPermissionDeniedError(error)) {
    return NextResponse.json({
      configured: true,
      schemaReady: true,
      permissionsReady: false,
      hasAdmin: false,
      requiresSecret: false,
      projectRef,
      grantSql: req.nextUrl.searchParams.get('includeSql') === '1' ? GRANT_SQL : undefined,
    });
  }

  const { count } = await db
    .from('system_admins')
    .select('id', { count: 'exact', head: true });

  return NextResponse.json({
    configured: true,
    schemaReady: !error,
    permissionsReady: !error,
    hasAdmin: (admins?.length ?? 0) > 0 || (count ?? 0) > 0,
    requiresSecret: Boolean(process.env.ADMIN_BOOTSTRAP_SECRET?.trim()),
    projectRef,
  });
}

export async function POST(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ error: 'Supabase yapılandırılmamış.' }, { status: 503 });
  }

  const db = createServiceRoleSupabase()!;
  const { data: existingAdmins, error: checkErr } = await db
    .from('system_admins')
    .select('id')
    .limit(1);

  if (checkErr && isMissingTableError(checkErr)) {
    return NextResponse.json(
      { error: 'Supabase veritabanı tabloları henüz oluşturulmamış. Önce SQL kurulumunu çalıştırınız.' },
      { status: 503 }
    );
  }

  if ((existingAdmins?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Sistem yöneticisi zaten mevcut. İlk kurulum güvenlik nedeniyle kilitlidir.' },
      { status: 403 }
    );
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
  const parts = fullName.split(/\s+/);
  const firstName = parts[0] ?? fullName;
  const lastName = parts.slice(1).join(' ');

  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });

  if (authErr || !authData.user) {
    return NextResponse.json(
      { error: authErr?.message ?? 'Yönetici hesabı oluşturulamadı.' },
      { status: 400 }
    );
  }

  const userId = authData.user.id;
  await db.from('profiles').upsert({
    id: userId,
    first_name: firstName,
    last_name: lastName,
    email,
    email_verified: true,
  });

  const { error: adminErr } = await db.from('system_admins').insert({
    user_id: userId,
    email,
    full_name: fullName,
    is_active: true,
  });

  if (adminErr) {
    await db.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: adminErr.message }, { status: 500 });
  }

  await db.from('audit_logs').insert({
    scope: 'admin',
    actor_user_id: userId,
    actor_name: fullName,
    action: 'system_admin_bootstrapped',
    entity_type: 'system_admins',
    entity_id: userId,
    new_values: { email, full_name: fullName },
    description: 'İlk sistem yöneticisi güvenli kurulum ile oluşturuldu.',
  });

  return NextResponse.json({ success: true, message: 'İlk sistem yöneticisi oluşturuldu.' }, { status: 201 });
}
