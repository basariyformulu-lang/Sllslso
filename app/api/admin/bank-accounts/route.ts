import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';
import {
  execute,
  query,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
  uuid,
  writeAuditLog,
} from '@/lib/db';

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
  const { error } = await requireSystemAdmin();
  if (error) return error;

  const accounts = await query<Record<string, unknown>>(
    'SELECT * FROM bank_accounts ORDER BY is_default DESC, created_at DESC'
  );

  return NextResponse.json({
    bankAccounts: accounts.map((a) => ({
      ...a,
      is_active: toBool(a.is_active),
      is_default: toBool(a.is_default),
      created_at: toIsoString(a.created_at),
    })),
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireSystemAdmin();
  if (error || !ctx) return error!;

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
    await execute('UPDATE bank_accounts SET is_default = 0 WHERE is_default = 1');
  }

  const id = uuid();
  const nowStr = toMySqlDateTime();
  await execute(
    `INSERT INTO bank_accounts (id, bank_name, iban, account_holder, description, is_active, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      d.bankName,
      d.iban.toUpperCase(),
      d.accountHolder,
      d.description,
      d.isActive ? 1 : 0,
      d.isDefault ? 1 : 0,
      nowStr,
    ]
  );

  const created = await queryOne<Record<string, unknown>>(
    'SELECT * FROM bank_accounts WHERE id = ? LIMIT 1',
    [id]
  );

  await writeAuditLog({
    scope: 'admin',
    actorUserId: ctx.userId,
    actorName: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'bank_account_created',
    entityType: 'bank_accounts',
    entityId: id,
    newValues: { bank_name: d.bankName, iban: d.iban.toUpperCase() },
    description: `Yeni banka hesabı eklendi: ${d.bankName}`,
  });

  return NextResponse.json(
    {
      bankAccount: created
        ? {
            ...created,
            is_active: toBool(created.is_active),
            is_default: toBool(created.is_default),
          }
        : null,
    },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const { error, ctx } = await requireSystemAdmin();
  if (error || !ctx) return error!;

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
  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM bank_accounts WHERE id = ? LIMIT 1',
    [d.id]
  );

  if (!existing) return NextResponse.json({ error: 'Banka hesabı bulunamadı.' }, { status: 404 });

  if (d.isDefault === true) {
    await execute('UPDATE bank_accounts SET is_default = 0 WHERE is_default = 1');
  }

  await execute(
    `UPDATE bank_accounts
     SET bank_name = ?, iban = ?, account_holder = ?, description = ?, is_active = ?, is_default = ?
     WHERE id = ?`,
    [
      d.bankName ?? String(existing.bank_name),
      (d.iban ?? String(existing.iban)).toUpperCase(),
      d.accountHolder ?? String(existing.account_holder),
      d.description ?? String(existing.description ?? ''),
      d.isActive !== undefined ? (d.isActive ? 1 : 0) : toBool(existing.is_active) ? 1 : 0,
      d.isDefault !== undefined ? (d.isDefault ? 1 : 0) : toBool(existing.is_default) ? 1 : 0,
      d.id,
    ]
  );

  const updated = await queryOne<Record<string, unknown>>(
    'SELECT * FROM bank_accounts WHERE id = ? LIMIT 1',
    [d.id]
  );

  await writeAuditLog({
    scope: 'admin',
    actorUserId: ctx.userId,
    actorName: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'bank_account_updated',
    entityType: 'bank_accounts',
    entityId: d.id,
    oldValues: { bank_name: existing.bank_name, iban: existing.iban },
    newValues: d,
    description: `Banka / IBAN bilgisi güncellendi: ${String(updated?.bank_name ?? d.bankName ?? '')}`,
  });

  return NextResponse.json({
    bankAccount: updated
      ? {
          ...updated,
          is_active: toBool(updated.is_active),
          is_default: toBool(updated.is_default),
        }
      : null,
  });
}
