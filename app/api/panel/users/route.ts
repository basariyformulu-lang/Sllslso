import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashPassword } from '@/lib/auth-mysql';
import { requireBusinessContext } from '@/lib/auth-server';
import {
  execute,
  parseJsonField,
  query,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
  uuid,
  withTransaction,
  writeAuditLog,
} from '@/lib/db';
import { ALL_PERMISSION_CODES } from '@/lib/permissions';

const createUserSchema = z.object({
  firstName: z.string().trim().min(2, 'Ad giriniz.').max(60),
  lastName: z.string().trim().min(2, 'Soyad giriniz.').max(60),
  email: z.string().trim().email('Geçerli e-posta adresi giriniz.').toLowerCase(),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalıdır.').max(100),
  roleName: z.string().trim().min(2, 'Rol adı giriniz.').max(60),
  permissions: z.array(z.string()).min(1, 'En az bir yetki seçiniz.'),
});

const updateUserSchema = z.object({
  memberId: z.string().uuid(),
  firstName: z.string().trim().min(2).max(60).optional(),
  lastName: z.string().trim().min(2).max(60).optional(),
  roleName: z.string().trim().min(2).max(60).optional(),
  permissions: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const { error, ctx } = await requireBusinessContext('users.manage');
  if (error || !ctx || !ctx.business) return error!;

  const rows = await query<Record<string, unknown>>(
    `SELECT bm.*, p.first_name, p.last_name, p.email, p.phone
     FROM business_members bm
     LEFT JOIN profiles p ON p.id = bm.user_id
     WHERE bm.business_id = ?
     ORDER BY bm.is_owner DESC, bm.created_at ASC`,
    [ctx.business.id]
  );

  const members = rows.map((m) => ({
    id: m.id,
    business_id: m.business_id,
    user_id: m.user_id,
    role_name: m.role_name,
    is_owner: toBool(m.is_owner),
    is_active: toBool(m.is_active),
    permissions: parseJsonField<string[]>(m.permissions, []),
    created_at: toIsoString(m.created_at),
    profile: {
      id: m.user_id,
      first_name: String(m.first_name ?? ''),
      last_name: String(m.last_name ?? ''),
      email: String(m.email ?? ''),
      phone: String(m.phone ?? ''),
    },
  }));

  return NextResponse.json({ members });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessContext('users.manage');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Kullanıcı bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const validPerms = d.permissions.filter((p) => ALL_PERMISSION_CODES.includes(p));

  const existingProfile = await queryOne<{ id: string }>(
    'SELECT id FROM profiles WHERE email = ? LIMIT 1',
    [d.email]
  );
  if (existingProfile) {
    return NextResponse.json(
      { error: 'Bu e-posta adresi sistemde zaten kayıtlıdır.' },
      { status: 409 }
    );
  }

  const newUserId = uuid();
  const memberId = uuid();
  const nowStr = toMySqlDateTime();
  const pwHash = hashPassword(d.password);

  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO profiles (id, first_name, last_name, phone, email, password_hash, email_verified, phone_verified, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, 1, 0, ?, ?)`,
      [newUserId, d.firstName, d.lastName, d.email, pwHash, nowStr, nowStr]
    );

    await conn.execute(
      `INSERT INTO business_members (id, business_id, user_id, role_name, is_owner, is_active, permissions, created_at)
       VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
      [memberId, ctx.business!.id, newUserId, d.roleName, JSON.stringify(validPerms), nowStr]
    );
  });

  await writeAuditLog({
    scope: 'business',
    businessId: ctx.business.id,
    actorUserId: ctx.userId,
    action: 'business_user_created',
    entityType: 'business_members',
    entityId: memberId,
    newValues: { email: d.email, role_name: d.roleName, permissions: validPerms },
    description: `${d.firstName} ${d.lastName} işletme kullanıcısı olarak eklendi.`,
  });

  return NextResponse.json(
    {
      member: {
        id: memberId,
        business_id: ctx.business.id,
        user_id: newUserId,
        role_name: d.roleName,
        is_owner: false,
        is_active: true,
        permissions: validPerms,
        profile: {
          id: newUserId,
          first_name: d.firstName,
          last_name: d.lastName,
          email: d.email,
          phone: '',
        },
      },
    },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const { error, ctx } = await requireBusinessContext('users.manage');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Kullanıcı bilgilerini kontrol ediniz.' }, { status: 400 });
  }

  const d = parsed.data;
  const targetMember = await queryOne<Record<string, unknown>>(
    'SELECT * FROM business_members WHERE id = ? AND business_id = ? LIMIT 1',
    [d.memberId, ctx.business.id]
  );

  if (!targetMember) {
    return NextResponse.json({ error: 'İşletme kullanıcısı bulunamadı.' }, { status: 404 });
  }

  const isOwner = toBool(targetMember.is_owner);
  if (isOwner && d.isActive === false) {
    return NextResponse.json(
      { error: 'İşletmenin ana kullanıcısı pasifleştirilemez.' },
      { status: 400 }
    );
  }

  if (String(targetMember.user_id) === ctx.userId && d.isActive === false) {
    return NextResponse.json(
      { error: 'Kendi hesabınızı pasifleştiremezsiniz.' },
      { status: 400 }
    );
  }

  const nowStr = toMySqlDateTime();

  if (d.firstName || d.lastName) {
    const prof = await queryOne<{ first_name: string; last_name: string }>(
      'SELECT first_name, last_name FROM profiles WHERE id = ? LIMIT 1',
      [String(targetMember.user_id)]
    );
    await execute(
      'UPDATE profiles SET first_name = ?, last_name = ?, updated_at = ? WHERE id = ?',
      [
        d.firstName ?? prof?.first_name ?? '',
        d.lastName ?? prof?.last_name ?? '',
        nowStr,
        String(targetMember.user_id),
      ]
    );
  }

  const nextRole = d.roleName && !isOwner ? d.roleName : String(targetMember.role_name);
  const nextPerms =
    d.permissions && !isOwner
      ? d.permissions.filter((p) => ALL_PERMISSION_CODES.includes(p))
      : parseJsonField<string[]>(targetMember.permissions, []);
  const nextActive =
    d.isActive !== undefined && !isOwner ? (d.isActive ? 1 : 0) : toBool(targetMember.is_active) ? 1 : 0;

  await execute(
    'UPDATE business_members SET role_name = ?, permissions = ?, is_active = ? WHERE id = ?',
    [nextRole, JSON.stringify(nextPerms), nextActive, String(targetMember.id)]
  );

  const row = await queryOne<Record<string, unknown>>(
    `SELECT bm.*, p.first_name, p.last_name, p.email, p.phone
     FROM business_members bm
     LEFT JOIN profiles p ON p.id = bm.user_id
     WHERE bm.id = ? LIMIT 1`,
    [String(targetMember.id)]
  );

  await writeAuditLog({
    scope: 'business',
    businessId: ctx.business.id,
    actorUserId: ctx.userId,
    action: 'business_user_updated',
    entityType: 'business_members',
    entityId: String(targetMember.id),
    oldValues: { role_name: targetMember.role_name, is_active: toBool(targetMember.is_active) },
    newValues: { role_name: nextRole, is_active: Boolean(nextActive) },
    description: 'İşletme kullanıcı bilgileri/yetkileri güncellendi.',
  });

  return NextResponse.json({
    member: row
      ? {
          id: row.id,
          business_id: row.business_id,
          user_id: row.user_id,
          role_name: row.role_name,
          is_owner: toBool(row.is_owner),
          is_active: toBool(row.is_active),
          permissions: parseJsonField<string[]>(row.permissions, []),
          profile: {
            id: row.user_id,
            first_name: String(row.first_name ?? ''),
            last_name: String(row.last_name ?? ''),
            email: String(row.email ?? ''),
            phone: String(row.phone ?? ''),
          },
        }
      : null,
  });
}
