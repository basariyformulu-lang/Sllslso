import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/auth-server';
import {
  query,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
  uuid,
  withTransaction,
  writeAuditLog,
} from '@/lib/db';
import { addMonthsToISODate, getIstanbulTodayISO, roundCurrency } from '@/lib/format';

const createCreditSaleSchema = z.object({
  customerId: z.string().uuid('Müşteri seçiniz.'),
  description: z.string().trim().min(2, 'Satış açıklaması giriniz.').max(200),
  totalAmount: z.coerce.number().positive('Satış tutarı sıfırdan büyük olmalıdır.'),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçerli bir satış tarihi giriniz.'),
  dueMonths: z.coerce.number().int().min(1).max(60).optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(400).optional().default(''),
});

const patchCreditSaleSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('collect_payment'),
    id: z.string().uuid(),
    amount: z.coerce.number().positive('Tahsilat tutarı sıfırdan büyük olmalıdır.'),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    paymentMethod: z.enum(['nakit', 'banka', 'kart', 'diger']),
    description: z.string().trim().max(200).optional().default('Vadeli satış tahsilatı'),
  }),
  z.object({
    action: z.literal('cancel'),
    id: z.string().uuid(),
  }),
]);

function computeCreditSaleStatus(
  sale: { total_amount: number; paid_amount: number; due_date: string; is_cancelled: boolean },
  todayISO: string
): 'vadesi_gelmedi' | 'vadesi_geldi' | 'kismen_tahsil' | 'tahsil_edildi' | 'gecikmis' | 'iptal' {
  if (sale.is_cancelled) return 'iptal';
  const total = roundCurrency(sale.total_amount);
  const paid = roundCurrency(sale.paid_amount);
  if (paid >= total) return 'tahsil_edildi';
  if (sale.due_date < todayISO) return 'gecikmis';
  if (sale.due_date === todayISO) return 'vadesi_geldi';
  if (paid > 0) return 'kismen_tahsil';
  return 'vadesi_gelmedi';
}

export async function GET() {
  const { error, ctx } = await requireBusinessContext('credit_sales.view');
  if (error || !ctx || !ctx.business) return error!;

  const today = getIstanbulTodayISO();
  const [sales, customers] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT cs.*, c.name AS c_name, c.last_name AS c_last_name, c.phone AS c_phone
       FROM credit_sales cs
       LEFT JOIN customers c ON c.id = cs.customer_id
       WHERE cs.business_id = ?
       ORDER BY cs.due_date ASC`,
      [ctx.business.id]
    ),
    query<Record<string, unknown>>(
      'SELECT id, name, last_name, phone, is_active FROM customers WHERE business_id = ? AND is_active = 1 ORDER BY name ASC',
      [ctx.business.id]
    ),
  ]);

  const enriched = sales.map((s) => {
    const total = roundCurrency(Number(s.total_amount));
    const paid = roundCurrency(Number(s.paid_amount));
    const isCancelled = toBool(s.is_cancelled);
    const dueDate = String(s.due_date ?? '');
    return {
      ...s,
      is_cancelled: isCancelled,
      total_amount: total,
      paid_amount: paid,
      remaining_amount: roundCurrency(Math.max(0, total - paid)),
      created_at: toIsoString(s.created_at),
      customer: s.c_name
        ? {
            id: String(s.customer_id),
            name: String(s.c_name),
            last_name: String(s.c_last_name ?? ''),
            phone: String(s.c_phone ?? ''),
          }
        : undefined,
      computed_status: computeCreditSaleStatus(
        { total_amount: total, paid_amount: paid, due_date: dueDate, is_cancelled: isCancelled },
        today
      ),
    };
  });

  return NextResponse.json({
    creditSales: enriched,
    customers: customers.map((c) => ({ ...c, is_active: toBool(c.is_active) })),
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessContext('credit_sales.create');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = createCreditSaleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Vadeli satış bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const computedDueDate = d.dueDate
    ? d.dueDate
    : d.dueMonths
    ? addMonthsToISODate(d.saleDate, d.dueMonths)
    : null;

  if (!computedDueDate) {
    return NextResponse.json(
      { error: 'Vade süresi (ay) veya vade tarihi belirtilmelidir.' },
      { status: 400 }
    );
  }

  const customer = await queryOne<{ id: string; name: string; last_name: string }>(
    'SELECT id, name, last_name FROM customers WHERE id = ? AND business_id = ? LIMIT 1',
    [d.customerId, ctx.business.id]
  );

  if (!customer) {
    return NextResponse.json({ error: 'Seçilen müşteri bulunamadı.' }, { status: 404 });
  }

  const totalAmount = roundCurrency(d.totalAmount);
  const saleId = uuid();
  const nowStr = toMySqlDateTime();

  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO credit_sales
       (id, business_id, customer_id, description, total_amount, paid_amount, sale_date, due_months, due_date, notes, is_cancelled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        saleId,
        ctx.business!.id,
        d.customerId,
        d.description,
        totalAmount,
        d.saleDate,
        d.dueMonths ?? null,
        computedDueDate,
        d.notes,
        ctx.userId,
        nowStr,
        nowStr,
      ]
    );

    await conn.execute(
      `INSERT INTO customer_transactions
       (id, business_id, customer_id, credit_sale_id, transaction_type, debt_category, amount, signed_amount, transaction_date, due_date, description, notes, is_overpayment, is_cancelled, created_by, created_at)
       VALUES (?, ?, ?, ?, 'debt', 'Vadeli Satış', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [
        uuid(),
        ctx.business!.id,
        d.customerId,
        saleId,
        totalAmount,
        totalAmount,
        d.saleDate,
        computedDueDate,
        d.description,
        d.notes,
        ctx.userId,
        nowStr,
      ]
    );

    await conn.execute(
      `INSERT INTO notifications
       (id, business_id, recipient_user_id, type, title, message, link, is_read, created_at)
       VALUES (?, ?, NULL, 'credit_sale_created', 'Yeni Vadeli Satış Kaydedildi', ?, '/panel/vadeli-satislar', 0, ?)`,
      [
        uuid(),
        ctx.business!.id,
        `${customer.name} ${customer.last_name} için ${totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL tutarında vadeli satış oluşturuldu (Vade: ${computedDueDate}).`,
        nowStr,
      ]
    );
  });

  const sale = await queryOne<Record<string, unknown>>(
    'SELECT * FROM credit_sales WHERE id = ? LIMIT 1',
    [saleId]
  );

  return NextResponse.json({ creditSale: sale }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = patchCreditSaleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'İşlem bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const requiredPerm =
    payload.action === 'collect_payment' ? 'customers.add_payment' : 'credit_sales.delete';
  const { error, ctx } = await requireBusinessContext(requiredPerm);
  if (error || !ctx || !ctx.business) return error!;

  const nowStr = toMySqlDateTime();

  if (payload.action === 'collect_payment') {
    const amt = roundCurrency(payload.amount);
    try {
      const newPaid = await withTransaction(async (conn) => {
        const [rows] = await conn.execute(
          'SELECT * FROM credit_sales WHERE id = ? AND business_id = ? FOR UPDATE',
          [payload.id, ctx.business!.id]
        );
        const sale = (rows as Array<Record<string, unknown>>)[0];
        if (!sale || toBool(sale.is_cancelled)) {
          throw new Error('NOT_FOUND:Aktif vadeli satış bulunamadı.');
        }

        const remaining = roundCurrency(Number(sale.total_amount) - Number(sale.paid_amount));
        if (amt > remaining) {
          throw new Error(
            `BAD:Tahsilat tutarı bu vadeli satışın kalan bakiyesinden (${remaining.toFixed(2)} TL) fazla olamaz.`
          );
        }

        await conn.execute(
          `INSERT INTO customer_transactions
           (id, business_id, customer_id, credit_sale_id, transaction_type, debt_category, amount, signed_amount, transaction_date, payment_method, description, notes, is_overpayment, is_cancelled, created_by, created_at)
           VALUES (?, ?, ?, ?, 'payment', 'Vadeli Satış Tahsilatı', ?, ?, ?, ?, ?, '', 0, 0, ?, ?)`,
          [
            uuid(),
            ctx.business!.id,
            String(sale.customer_id),
            String(sale.id),
            amt,
            -amt,
            payload.paymentDate,
            payload.paymentMethod,
            payload.description || `${String(sale.description)} tahsilatı`,
            ctx.userId,
            nowStr,
          ]
        );

        const nextPaid = roundCurrency(Number(sale.paid_amount) + amt);
        await conn.execute(
          'UPDATE credit_sales SET paid_amount = ?, updated_at = ? WHERE id = ?',
          [nextPaid, nowStr, String(sale.id)]
        );
        return nextPaid;
      });

      return NextResponse.json({ success: true, paidAmount: newPaid });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'İşlem başarısız.';
      if (msg.startsWith('NOT_FOUND:')) return NextResponse.json({ error: msg.slice(10) }, { status: 404 });
      if (msg.startsWith('BAD:')) return NextResponse.json({ error: msg.slice(4) }, { status: 400 });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const sale = await queryOne<Record<string, unknown>>(
    'SELECT * FROM credit_sales WHERE id = ? AND business_id = ? LIMIT 1',
    [payload.id, ctx.business.id]
  );

  if (!sale || toBool(sale.is_cancelled)) {
    return NextResponse.json({ error: 'Aktif vadeli satış bulunamadı.' }, { status: 404 });
  }

  await withTransaction(async (conn) => {
    await conn.execute(
      'UPDATE credit_sales SET is_cancelled = 1, cancelled_at = ?, updated_at = ? WHERE id = ?',
      [nowStr, nowStr, String(sale.id)]
    );
    await conn.execute(
      'UPDATE customer_transactions SET is_cancelled = 1 WHERE credit_sale_id = ? AND business_id = ?',
      [String(sale.id), ctx.business!.id]
    );
  });

  await writeAuditLog({
    scope: 'business',
    businessId: ctx.business.id,
    actorUserId: ctx.userId,
    action: 'credit_sale_cancelled',
    entityType: 'credit_sales',
    entityId: String(sale.id),
    oldValues: { total_amount: sale.total_amount },
    description: `Vadeli satış iptal edildi: ${String(sale.description)}`,
  });

  return NextResponse.json({ success: true });
}
