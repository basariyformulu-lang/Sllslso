import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import { normalizePhoneTR } from '@/lib/booking-helpers';
import { execute, query, queryOne, toBool, toIsoString, toMySqlDateTime, uuid } from '@/lib/db';
import { roundCurrency } from '@/lib/format';

const customerSchema = z.object({
  firstName: z.string().trim().min(2, 'Müşteri adı giriniz.').max(80),
  lastName: z.string().trim().max(80).optional().default(''),
  phone: z.string().trim().min(7, 'Telefon numarası giriniz.').max(30),
  email: z.string().trim().email('Geçerli e-posta giriniz.').or(z.literal('')).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

const patchCustomerSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().max(80).optional().default(''),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().or(z.literal('')).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const { error, ctx, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const [customers, appointments] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM booking_customers WHERE business_id = ? ORDER BY created_at DESC',
      [businessId]
    ),
    query<{
      id: string;
      booking_customer_id: string;
      status: string;
      paid_amount: number;
      appointment_date: string;
    }>(
      `SELECT id, booking_customer_id, status, paid_amount, appointment_date
       FROM appointments
       WHERE business_id = ?
       ORDER BY appointment_date DESC`,
      [businessId]
    ),
  ]);

  const enriched = customers.map((c) => {
    const custAppts = appointments.filter((a) => a.booking_customer_id === c.id);
    const completed = custAppts.filter((a) => a.status === 'completed');
    const totalSpent = roundCurrency(
      custAppts.reduce((s, a) => s + Number(a.paid_amount ?? 0), 0)
    );
    return {
      ...c,
      is_active: toBool(c.is_active),
      created_at: toIsoString(c.created_at),
      appointment_count: custAppts.length,
      completed_count: completed.length,
      total_spent: totalSpent,
      last_appointment_date: custAppts[0]?.appointment_date ?? null,
    };
  });

  return NextResponse.json({ readOnly, customers: enriched });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.manage');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Müşteri bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const id = uuid();
  const nowStr = toMySqlDateTime();
  await execute(
    `INSERT INTO booking_customers
     (id, business_id, customer_user_id, first_name, last_name, phone, phone_normalized, email, notes, is_active, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      ctx.business.id,
      d.firstName,
      d.lastName,
      d.phone,
      normalizePhoneTR(d.phone),
      d.email.toLowerCase(),
      d.notes,
      nowStr,
      nowStr,
    ]
  );

  const created = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_customers WHERE id = ? LIMIT 1',
    [id]
  );
  return NextResponse.json(
    { customer: created ? { ...created, is_active: toBool(created.is_active) } : null },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.manage');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = patchCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Müşteri bilgilerini kontrol ediniz.' }, { status: 400 });
  }

  const d = parsed.data;
  const nowStr = toMySqlDateTime();
  const res = await execute(
    `UPDATE booking_customers
     SET first_name = ?, last_name = ?, phone = ?, phone_normalized = ?, email = ?, notes = ?,
         is_active = COALESCE(?, is_active), updated_at = ?
     WHERE id = ? AND business_id = ?`,
    [
      d.firstName,
      d.lastName,
      d.phone,
      normalizePhoneTR(d.phone),
      d.email.toLowerCase(),
      d.notes,
      d.isActive !== undefined ? (d.isActive ? 1 : 0) : null,
      nowStr,
      d.id,
      ctx.business.id,
    ]
  );

  if (res.affectedRows === 0) {
    return NextResponse.json({ error: 'Müşteri güncellenemedi.' }, { status: 400 });
  }

  const updated = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_customers WHERE id = ? LIMIT 1',
    [d.id]
  );
  return NextResponse.json({
    customer: updated ? { ...updated, is_active: toBool(updated.is_active) } : null,
  });
}
