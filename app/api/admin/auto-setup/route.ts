import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createServiceRoleSupabase, isServiceRoleConfigured } from '@/lib/supabase/server';

const autoSetupSchema = z.object({
  accessToken: z
    .string()
    .trim()
    .min(20, 'Geçerli bir Supabase Access Token (sbp_...) giriniz.')
    .refine((val) => val.startsWith('sbp_'), {
      message: 'Supabase Access Token "sbp_" ile başlamalıdır.',
    }),
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

export async function POST(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ error: 'Supabase bağlantısı yapılandırılmamış.' }, { status: 503 });
  }

  const projectRef = extractSupabaseProjectRef();
  if (!projectRef) {
    return NextResponse.json({ error: 'Supabase proje referansı okunamadı.' }, { status: 400 });
  }

  const db = createServiceRoleSupabase()!;
  const { data: existingAdmins, error: checkErr } = await db
    .from('system_admins')
    .select('id')
    .limit(1);

  if (!checkErr && (existingAdmins?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Sistem yöneticisi zaten mevcut. Otomatik SQL kurulumu güvenlik nedeniyle kilitlidir.' },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = autoSetupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Token formatı geçersiz.' },
      { status: 400 }
    );
  }

  let sqlContent: string;
  try {
    sqlContent = await fs.readFile(
      path.join(process.cwd(), 'supabase', 'TEK_SEFERLIK_KURULUM.sql'),
      'utf8'
    );
  } catch {
    return NextResponse.json({ error: 'Kurulum SQL dosyası okunamadı.' }, { status: 500 });
  }

  const mgmtRes = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${parsed.data.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sqlContent }),
    }
  );

  if (!mgmtRes.ok) {
    const errText = await mgmtRes.text().catch(() => '');
    let errMsg = 'Supabase SQL çalıştırma isteği başarısız oldu.';
    try {
      const parsedErr = JSON.parse(errText) as { message?: string };
      if (parsedErr.message) errMsg = parsedErr.message;
    } catch {
      if (errText) errMsg = errText.slice(0, 200);
    }
    return NextResponse.json(
      { error: `Supabase otomatik kurulum hatası: ${errMsg}` },
      { status: mgmtRes.status === 401 || mgmtRes.status === 403 ? 401 : 500 }
    );
  }

  const { error: verifyErr } = await db.from('system_admins').select('id').limit(1);
  if (verifyErr) {
    return NextResponse.json(
      {
        error: `SQL çalıştırıldı ancak doğrulama hatası alındı: ${verifyErr.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Veritabanı tabloları, fonksiyonlar ve izinler otomatik olarak kuruldu.',
  });
}
