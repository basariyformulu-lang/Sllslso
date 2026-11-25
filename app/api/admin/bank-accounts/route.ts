import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';

const createBankSchema = z.object({
  bankName: z.string().trim().min(2, 'Banka adı giriniz.').max(100),
  iban: z.string().trim().min(10, 'Geçerli bir IBAN giriniz.').max(40),
  accountHolder: z.string().trim().min(2, 'Alıcı adı / unvanı giriniz.').max(140),
  description: z.string().trim().max(250).optional().default(''),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

const updateBankSchema = z.object({
  id: z.string().uuid(),
  bankName: z.string().trim().min(2).max(100).optional(),
  iban: z.string().trim().min(10).max(40).optional(),
  accountHolder: z.string().trim().min(2).max(140).optional(),
  description: z.string().trim().max(250).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  const { error, db } = await requireSystemAdmin();
  if (error || !db) return error!;

  const { data: accounts, error: err } = await db
    .from('bank_accounts')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
  return NextResponse.json({ bankAccounts: accounts ?? [] });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireSystemAdmin();
  if (error || !ctx || !db) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = createBankSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Banka bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  if (d.isDefault) {
    await db.from('bank_accounts').update({ is_default: false }).eq('is_default', true);
  }

  const { data: created, error: insertErr } = await db
    .from('bank_accounts')
    .insert({
      bank_name: d.bankName,
      iban: d.iban.toUpperCase(),
      account_holder: d.accountHolder,
      description: d.description,
      is_active: d.isActive,
      is_default: d.isDefault,
    })
    .select('*')
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  await db.from('audit_logs').insert({
    scope: 'admin',
    actor_user_id: ctx.userId,
    actor_name: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'bank_account_created',
    entity_type: 'bank_accounts',
    entity_id: created.id,
    new_values: { bank_name: created.bank_name, iban: created.iban },
    description: `Yeni banka hesabı eklendi: ${created.bank_name}`,
  });

  return NextResponse.json({ bankAccount: created }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireSystemAdmin();
  if (error || !ctx || !db) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = updateBankSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Banka bilgilerini kontrol ediniz.' }, { status: 400 });
  }

  const d = parsed.data;
  const { data: existing } = await db
    .from('bank_accounts')
    .select('*')
    .eq('id', d.id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: 'Banka hesabı bulunamadı.' }, { status: 404 });

  if (d.isDefault === true) {
    await db.from('bank_accounts').update({ is_default: false }).eq('is_default', true);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.bankName !== undefined) patch.bank_name = d.bankName;
  if (d.iban !== undefined) patch.iban = d.iban.toUpperCase();
  if (d.accountHolder !== undefined) patch.account_holder = d.accountHolder;
  if (d.description !== undefined) patch.description = d.description;
  if (d.isActive !== undefined) patch.is_active = d.isActive;
  if (d.isDefault !== undefined) patch.is_default = d.isDefault;

  const { data: updated, error: updErr } = await db
    .from('bank_accounts')
    .update(patch)
    .eq('id', d.id)
    .select('*')
    .single();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await db.from('audit_logs').insert({
    scope: 'admin',
    actor_user_id: ctx.userId,
    actor_name: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'bank_account_updated',
    entity_type: 'bank_accounts',
    entity_id: d.id,
    old_values: { bank_name: existing.bank_name, iban: existing.iban, is_active: existing.is_active },
    new_values: patch,
    description: `Banka / IBAN bilgisi güncellendi: ${updated.bank_name}`,
  });

  return NextResponse.json({ bankAccount: updated });
}
