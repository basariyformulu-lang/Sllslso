import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
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
  const { error, ctx, db } = await requireBusinessContext('users.manage');
  if (error || !ctx || !db || !ctx.business) return error!;

  const { data: members, error: err } = await db
    .from('business_members')
    .select('*, profile:profiles(id, first_name, last_name, email, phone)')
    .eq('business_id', ctx.business.id)
    .order('is_owner', { ascending: false })
    .order('created_at', { ascending: true });

  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  return NextResponse.json({ members: members ?? [] });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessContext('users.manage');
  if (error || !ctx || !db || !ctx.business) return error!;

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

  const { data: existingProfile } = await db
    .from('profiles')
    .select('id')
    .eq('email', d.email)
    .maybeSingle();

  if (existingProfile) {
    return NextResponse.json(
      { error: 'Bu e-posta adresi sistemde zaten kayıtlıdır.' },
      { status: 409 }
    );
  }

  const { data: authCreated, error: authErr } = await db.auth.admin.createUser({
    email: d.email,
    password: d.password,
    email_confirm: true,
    user_metadata: {
      first_name: d.firstName,
      last_name: d.lastName,
    },
  });

  if (authErr || !authCreated.user) {
    return NextResponse.json(
      { error: authErr?.message ?? 'Kullanıcı oluşturulamadı.' },
      { status: 400 }
    );
  }

  const newUserId = authCreated.user.id;
  await db.from('profiles').upsert({
    id: newUserId,
    first_name: d.firstName,
    last_name: d.lastName,
    email: d.email,
  });

  const { data: member, error: memberErr } = await db
    .from('business_members')
    .insert({
      business_id: ctx.business.id,
      user_id: newUserId,
      role_name: d.roleName,
      is_owner: false,
      is_active: true,
      permissions: validPerms,
    })
    .select('*, profile:profiles(id, first_name, last_name, email, phone)')
    .single();

  if (memberErr) {
    await db.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }

  await db.from('audit_logs').insert({
    scope: 'business',
    business_id: ctx.business.id,
    actor_user_id: ctx.userId,
    action: 'business_user_created',
    entity_type: 'business_members',
    entity_id: member.id,
    new_values: { email: d.email, role_name: d.roleName, permissions: validPerms },
    description: `${d.firstName} ${d.lastName} işletme kullanıcısı olarak eklendi.`,
  });

  return NextResponse.json({ member }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessContext('users.manage');
  if (error || !ctx || !db || !ctx.business) return error!;

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
  const { data: targetMember } = await db
    .from('business_members')
    .select('*')
    .eq('id', d.memberId)
    .eq('business_id', ctx.business.id)
    .maybeSingle();

  if (!targetMember) {
    return NextResponse.json({ error: 'İşletme kullanıcısı bulunamadı.' }, { status: 404 });
  }

  // Ana kullanıcı kendi hesabını pasifleştiremez veya tek yönetici olmaktan çıkarılamaz
  if (targetMember.is_owner) {
    if (d.isActive === false) {
      return NextResponse.json(
        { error: 'İşletmenin ana kullanıcısı pasifleştirilemez.' },
        { status: 400 }
      );
    }
  }

  if (targetMember.user_id === ctx.userId && d.isActive === false) {
    return NextResponse.json(
      { error: 'Kendi hesabınızı pasifleştiremezsiniz.' },
      { status: 400 }
    );
  }

  if (d.firstName || d.lastName) {
    const profilePatch: Record<string, string> = {};
    if (d.firstName) profilePatch.first_name = d.firstName;
    if (d.lastName) profilePatch.last_name = d.lastName;
    await db.from('profiles').update(profilePatch).eq('id', targetMember.user_id);
  }

  const memberPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.roleName && !targetMember.is_owner) memberPatch.role_name = d.roleName;
  if (d.permissions && !targetMember.is_owner) {
    memberPatch.permissions = d.permissions.filter((p) => ALL_PERMISSION_CODES.includes(p));
  }
  if (d.isActive !== undefined && !targetMember.is_owner) {
    memberPatch.is_active = d.isActive;
  }

  const { data: updated, error: updErr } = await db
    .from('business_members')
    .update(memberPatch)
    .eq('id', targetMember.id)
    .select('*, profile:profiles(id, first_name, last_name, email, phone)')
    .single();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await db.from('audit_logs').insert({
    scope: 'business',
    business_id: ctx.business.id,
    actor_user_id: ctx.userId,
    action: 'business_user_updated',
    entity_type: 'business_members',
    entity_id: targetMember.id,
    old_values: { role_name: targetMember.role_name, is_active: targetMember.is_active },
    new_values: memberPatch,
    description: 'İşletme kullanıcı bilgileri/yetkileri güncellendi.',
  });

  return NextResponse.json({ member: updated });
}
