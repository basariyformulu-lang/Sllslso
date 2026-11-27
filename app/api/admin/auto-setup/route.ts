import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { isDatabaseConfigured, queryOne } from '@/lib/db';

export async function POST() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'MySQL bağlantısı yapılandırılmamış.' }, { status: 503 });
  }

  try {
    const existing = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM system_admins');
    if (Number(existing?.c ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Sistem yöneticisi zaten mevcut. Otomatik kurulum kilitlidir.' },
        { status: 403 }
      );
    }
  } catch {
    // Tablolar henuz yoksa kuruluma devam et
  }

  let sqlContent: string;
  try {
    sqlContent = await fs.readFile(path.join(process.cwd(), 'mysql', 'schema.sql'), 'utf8');
  } catch {
    return NextResponse.json({ error: 'mysql/schema.sql dosyası okunamadı.' }, { status: 500 });
  }

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST!.trim(),
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE!.trim(),
    user: process.env.MYSQL_USER!.trim(),
    password: process.env.MYSQL_PASSWORD,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  try {
    await conn.query(sqlContent);
    return NextResponse.json({
      success: true,
      message: 'MySQL veritabanı tabloları başarıyla kuruldu.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'MySQL şema kurulumu başarısız oldu.' },
      { status: 500 }
    );
  } finally {
    await conn.end();
  }
}
