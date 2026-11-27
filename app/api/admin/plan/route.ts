import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSystemAdmin } from '@/lib/auth-server';
import {
  execute,
  parseJsonField,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
  uuid,
  writeAuditLog,
} from '@/lib/db';
import { roundCurrency } from '@/lib/format';

const planUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Paket adı giriniz.').max(120),
  description: z.string().trim().min(2).max(500),
  monthlyPrice: z.coerce.number().min(0, 'Ücret negatif olamaz.'),
  durationDays: z.coerce.number().int().min(1).max(365),
  features: z.array(z.string().trim().min(1)).min(1),
  isActive: z.boolean(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET() {
  const { error } = await requireSystemAdmin();
  if (error) return error;

  const plan = await queryOne<Record<string, unknown>>('SELECT * FROM subscription_plans LIMIT 1');
  return NextResponse.json({
    plan: plan
      ? {
          ...plan,
          monthly_price: Number(plan.monthly_price ?? 0),
          features: parseJsonField<string[]>(plan.features, []),
          is_active: toBool(plan.is_active),
          effective_from: String(plan.effective_from ?? '').slice(0, 10),
          updated_at: toIsoString(plan.updated_at),
        }
      : null,
  });
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

  const parsed = planUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Paket bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const existing = await queryOne<Record<string, unknown>>('SELECT * FROM subscription_plans LIMIT 1');
  const newPrice = roundCurrency(d.monthlyPrice);
  const nowStr = toMySqlDateTime();
  const effectiveSql = `${d.effectiveFrom} 00:00:00.000`;

  if (!existing) {
    const planId = uuid();
    await execute(
      `INSERT INTO subscription_plans
       (id, name, description, monthly_price, duration_days, features, is_active, effective_from, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        planId,
        d.name,
        d.description,
        newPrice,
        d.durationDays,
        JSON.stringify(d.features),
        d.isActive ? 1 : 0,
        effectiveSql,
        nowStr,
        nowStr,
      ]
    );
    const created = await queryOne<Record<string, unknown>>(
      'SELECT * FROM subscription_plans WHERE id = ? LIMIT 1',
      [planId]
    );
    return NextResponse.json({
      plan: created
        ? {
            ...created,
            monthly_price: Number(created.monthly_price ?? 0),
            features: parseJsonField<string[]>(created.features, []),
            is_active: toBool(created.is_active),
            effective_from: d.effectiveFrom,
          }
        : null,
    });
  }

  await execute(
    `UPDATE subscription_plans
     SET name = ?, description = ?, monthly_price = ?, duration_days = ?, features = ?,
         is_active = ?, effective_from = ?, updated_at = ?
     WHERE id = ?`,
    [
      d.name,
      d.description,
      newPrice,
      d.durationDays,
      JSON.stringify(d.features),
      d.isActive ? 1 : 0,
      effectiveSql,
      nowStr,
      String(existing.id),
    ]
  );

  const updated = await queryOne<Record<string, unknown>>(
    'SELECT * FROM subscription_plans WHERE id = ? LIMIT 1',
    [String(existing.id)]
  );

  await writeAuditLog({
    scope: 'admin',
    actorUserId: ctx.userId,
    actorName: ctx.adminName ?? 'Sistem Yöneticisi',
    action: 'subscription_plan_updated',
    entityType: 'subscription_plans',
    entityId: String(existing.id),
    oldValues: {
      name: existing.name,
      monthly_price: existing.monthly_price,
      is_active: toBool(existing.is_active),
    },
    new_values: {
      name: d.name,
      monthly_price: newPrice,
      is_active: d.isActive,
      effective_from: d.effectiveFrom,
    },
    description: `Tek abonelik paketi güncellendi (Yeni fiyat: ${newPrice} TL, Geçerlilik: ${d.effectiveFrom}).`,
  } as Parameters<typeof writeAuditLog>[0]);

  return NextResponse.json({
    plan: updated
      ? {
          ...updated,
          monthly_price: Number(updated.monthly_price ?? 0),
          features: parseJsonField<string[]>(updated.features, []),
          is_active: toBool(updated.is_active),
          effective_from: d.effectiveFrom,
        }
      : null,
  });
}
