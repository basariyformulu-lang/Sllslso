import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
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
  const { error, ctx, db, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !db || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const [{ data: customers }, { data: appointments }] = await Promise.all([
    db
      .from('booking_customers')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false }),
    db
      .from('appointments')
      .select('id, booking_customer_id, status, paid_amount, appointment_date')
      .eq('business_id', businessId)
      .order('appointment_date', { ascending: false }),
  ]);

  const appts = appointments ?? [];
  const enriched = (customers ?? []).map((c) => {
    const custAppts = appts.filter((a) => a.booking_customer_id === c.id);
    const completed = custAppts.filter((a) => a.status === 'completed');
    const totalSpent = roundCurrency(custAppts.reduce((s, a) => s + Number(a.paid_amount ?? 0), 0));
    return {
      ...c,
      appointment_count: custAppts.length,
      completed_count: completed.length,
      total_spent: totalSpent,
      last_appointment_date: custAppts[0]?.appointment_date ?? null,
    };
  });

  return NextResponse.json({ readOnly, customers: enriched });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessBookingContext('booking.manage');
  if (error || !ctx || !db || !ctx.business) return error!;

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
  const { data: created, error: createErr } = await db
    .from('booking_customers')
    .insert({
      business_id: ctx.business.id,
      first_name: d.firstName,
      last_name: d.lastName,
      phone: d.phone,
      email: d.email.toLowerCase(),
      notes: d.notes,
    })
    .select('*')
    .single();

  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
  return NextResponse.json({ customer: created }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessBookingContext('booking.manage');
  if (error || !ctx || !db || !ctx.business) return error!;

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
  const { data: updated, error: updErr } = await db
    .from('booking_customers')
    .update({
      first_name: d.firstName,
      last_name: d.lastName,
      phone: d.phone,
      email: d.email.toLowerCase(),
      notes: d.notes,
      ...(d.isActive !== undefined ? { is_active: d.isActive } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', d.id)
    .eq('business_id', ctx.business.id)
    .select('*')
    .maybeSingle();

  if (updErr || !updated) {
    return NextResponse.json({ error: 'Müşteri güncellenemedi.' }, { status: 400 });
  }

  return NextResponse.json({ customer: updated });
}
