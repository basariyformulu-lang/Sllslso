import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import { sanitizeExternalUrl, TR_WEEKDAYS } from '@/lib/booking-helpers';
import { execute, query, queryOne, toBool, toIsoString, toMySqlDateTime, uuid } from '@/lib/db';

const workingHourInputSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  is_working: z.boolean(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
});

const createStaffSchema = z.object({
  fullName: z.string().trim().min(2, 'Personel ad soyad giriniz.').max(120),
  avatarUrl: z.string().max(2_000_000).optional().default(''),
  specialties: z.string().trim().max(250).optional().default(''),
  bio: z.string().trim().max(600).optional().default(''),
  isActive: z.boolean().optional().default(true),
  serviceIds: z.array(z.string().uuid()).optional().default([]),
  workingHours: z.array(workingHourInputSchema).optional(),
});

const patchStaffSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_staff'),
    id: z.string().uuid(),
    fullName: z.string().trim().min(2).max(120),
    avatarUrl: z.string().max(2_000_000).optional().default(''),
    specialties: z.string().trim().max(250).optional().default(''),
    bio: z.string().trim().max(600).optional().default(''),
    isActive: z.boolean(),
    serviceIds: z.array(z.string().uuid()).optional(),
    workingHours: z.array(workingHourInputSchema).optional(),
  }),
  z.object({
    action: z.literal('add_break'),
    staffId: z.string().uuid(),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional().default(null),
    title: z.string().trim().min(1).max(80).default('Öğle Molası'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  z.object({
    action: z.literal('delete_break'),
    breakId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('add_leave'),
    staffId: z.string().uuid().nullable().optional().default(null),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().max(200).optional().default(''),
  }),
  z.object({
    action: z.literal('delete_leave'),
    leaveId: z.string().uuid(),
  }),
]);

export async function GET() {
  const { error, ctx, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const [staff, services, staffServices, workingHours, breaks, leaves] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM booking_staff WHERE business_id = ? ORDER BY sort_order ASC, created_at ASC',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT id, name, price, discount_price, duration_minutes, is_active FROM booking_services WHERE business_id = ? ORDER BY sort_order ASC',
      [businessId]
    ),
    query<{ staff_id: string; service_id: string }>(
      'SELECT staff_id, service_id FROM staff_services WHERE business_id = ?',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM staff_working_hours WHERE business_id = ?',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM staff_breaks WHERE business_id = ? ORDER BY start_time ASC',
      [businessId]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM staff_leaves WHERE business_id = ? ORDER BY start_date DESC',
      [businessId]
    ),
  ]);

  const enrichedStaff = staff.map((st) => ({
    ...st,
    is_active: toBool(st.is_active),
    created_at: toIsoString(st.created_at),
    service_ids: staffServices.filter((ss) => ss.staff_id === st.id).map((ss) => ss.service_id),
    working_hours: workingHours
      .filter((wh) => wh.staff_id === st.id)
      .map((wh) => ({
        ...wh,
        is_working: toBool(wh.is_working),
        start_time: String(wh.start_time).slice(0, 5),
        end_time: String(wh.end_time).slice(0, 5),
      })),
    breaks: breaks
      .filter((br) => br.staff_id === st.id)
      .map((br) => ({
        ...br,
        start_time: String(br.start_time).slice(0, 5),
        end_time: String(br.end_time).slice(0, 5),
      })),
  }));

  return NextResponse.json({
    readOnly,
    staff: enrichedStaff,
    services: services.map((s) => ({
      ...s,
      price: Number(s.price),
      discount_price: s.discount_price !== null ? Number(s.discount_price) : null,
      is_active: toBool(s.is_active),
    })),
    leaves: leaves.map((l) => ({ ...l, created_at: toIsoString(l.created_at) })),
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.staff');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = createStaffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Personel bilgilerini kontrol ediniz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const businessId = ctx.business.id;
  const cntRow = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM booking_staff WHERE business_id = ?',
    [businessId]
  );

  const staffId = uuid();
  const nowStr = toMySqlDateTime();
  await execute(
    `INSERT INTO booking_staff
     (id, business_id, full_name, avatar_url, specialties, bio, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      staffId,
      businessId,
      d.fullName,
      sanitizeExternalUrl(d.avatarUrl) ?? '',
      d.specialties,
      d.bio,
      d.isActive ? 1 : 0,
      Number(cntRow?.cnt ?? 0),
      nowStr,
      nowStr,
    ]
  );

  const whSource =
    d.workingHours && d.workingHours.length > 0
      ? d.workingHours
      : TR_WEEKDAYS.map((day) => ({
          day_of_week: day.day,
          is_working: day.day !== 0,
          start_time: day.day === 0 ? '10:00' : '09:00',
          end_time: day.day === 0 ? '17:00' : '19:00',
        }));

  for (const wh of whSource) {
    await execute(
      `INSERT INTO staff_working_hours (id, business_id, staff_id, day_of_week, is_working, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        businessId,
        staffId,
        wh.day_of_week,
        wh.is_working ? 1 : 0,
        `${wh.start_time}:00`,
        `${wh.end_time}:00`,
      ]
    );
  }

  if (d.serviceIds.length > 0) {
    const allServices = await query<{ id: string }>(
      'SELECT id FROM booking_services WHERE business_id = ?',
      [businessId]
    );
    const allowed = new Set(allServices.map((s) => s.id));
    for (const serviceId of d.serviceIds) {
      if (allowed.has(serviceId)) {
        await execute(
          'INSERT IGNORE INTO staff_services (business_id, staff_id, service_id) VALUES (?, ?, ?)',
          [businessId, staffId, serviceId]
        );
      }
    }
  }

  const created = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_staff WHERE id = ? LIMIT 1',
    [staffId]
  );
  return NextResponse.json(
    { staff: created ? { ...created, is_active: toBool(created.is_active) } : null },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.staff');
  if (error || !ctx || !ctx.business) return error!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const parsed = patchStaffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'İşlem verileri geçersiz.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const businessId = ctx.business.id;
  const nowStr = toMySqlDateTime();

  if (d.action === 'add_break') {
    if (d.endTime <= d.startTime) {
      return NextResponse.json(
        { error: 'Mola bitiş saati başlangıçtan sonra olmalıdır.' },
        { status: 400 }
      );
    }
    const id = uuid();
    await execute(
      `INSERT INTO staff_breaks (id, business_id, staff_id, day_of_week, title, start_time, end_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, businessId, d.staffId, d.dayOfWeek ?? null, d.title, `${d.startTime}:00`, `${d.endTime}:00`, nowStr]
    );
    const br = await queryOne<Record<string, unknown>>(
      'SELECT * FROM staff_breaks WHERE id = ? LIMIT 1',
      [id]
    );
    return NextResponse.json({ breakItem: br }, { status: 201 });
  }

  if (d.action === 'delete_break') {
    await execute('DELETE FROM staff_breaks WHERE id = ? AND business_id = ?', [
      d.breakId,
      businessId,
    ]);
    return NextResponse.json({ success: true });
  }

  if (d.action === 'add_leave') {
    if (d.endDate < d.startDate) {
      return NextResponse.json(
        { error: 'Bitiş tarihi başlangıç tarihinden önce olamaz.' },
        { status: 400 }
      );
    }
    const id = uuid();
    await execute(
      `INSERT INTO staff_leaves (id, business_id, staff_id, start_date, end_date, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, businessId, d.staffId ?? null, d.startDate, d.endDate, d.reason, nowStr]
    );
    const lv = await queryOne<Record<string, unknown>>(
      'SELECT * FROM staff_leaves WHERE id = ? LIMIT 1',
      [id]
    );
    return NextResponse.json({ leave: lv }, { status: 201 });
  }

  if (d.action === 'delete_leave') {
    await execute('DELETE FROM staff_leaves WHERE id = ? AND business_id = ?', [
      d.leaveId,
      businessId,
    ]);
    return NextResponse.json({ success: true });
  }

  const res = await execute(
    `UPDATE booking_staff
     SET full_name = ?, avatar_url = ?, specialties = ?, bio = ?, is_active = ?, updated_at = ?
     WHERE id = ? AND business_id = ?`,
    [
      d.fullName,
      sanitizeExternalUrl(d.avatarUrl) ?? '',
      d.specialties,
      d.bio,
      d.isActive ? 1 : 0,
      nowStr,
      d.id,
      businessId,
    ]
  );

  if (res.affectedRows === 0) {
    return NextResponse.json({ error: 'Personel güncellenemedi.' }, { status: 400 });
  }

  if (d.serviceIds !== undefined) {
    await execute('DELETE FROM staff_services WHERE business_id = ? AND staff_id = ?', [
      businessId,
      d.id,
    ]);
    if (d.serviceIds.length > 0) {
      const allServices = await query<{ id: string }>(
        'SELECT id FROM booking_services WHERE business_id = ?',
        [businessId]
      );
      const allowed = new Set(allServices.map((s) => s.id));
      for (const serviceId of d.serviceIds) {
        if (allowed.has(serviceId)) {
          await execute(
            'INSERT IGNORE INTO staff_services (business_id, staff_id, service_id) VALUES (?, ?, ?)',
            [businessId, d.id, serviceId]
          );
        }
      }
    }
  }

  if (d.workingHours && d.workingHours.length > 0) {
    for (const wh of d.workingHours) {
      await execute(
        `INSERT INTO staff_working_hours (id, business_id, staff_id, day_of_week, is_working, start_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           is_working = VALUES(is_working),
           start_time = VALUES(start_time),
           end_time = VALUES(end_time)`,
        [
          uuid(),
          businessId,
          d.id,
          wh.day_of_week,
          wh.is_working ? 1 : 0,
          `${wh.start_time}:00`,
          `${wh.end_time}:00`,
        ]
      );
    }
  }

  const updated = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_staff WHERE id = ? LIMIT 1',
    [d.id]
  );
  return NextResponse.json({
    staff: updated ? { ...updated, is_active: toBool(updated.is_active) } : null,
  });
}

export async function DELETE(req: NextRequest) {
  const { error, ctx } = await requireBusinessBookingContext('booking.staff');
  if (error || !ctx || !ctx.business) return error!;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Personel kimliği gerekli.' }, { status: 400 });

  const cntRow = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM appointments WHERE business_id = ? AND staff_id = ?',
    [ctx.business.id, id]
  );

  if (Number(cntRow?.cnt ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          'Bu personelin geçmiş veya aktif randevuları bulunduğu için silinemez. Bunun yerine pasif duruma alabilirsiniz.',
      },
      { status: 409 }
    );
  }

  await execute('DELETE FROM booking_staff WHERE id = ? AND business_id = ?', [
    id,
    ctx.business.id,
  ]);
  return NextResponse.json({ success: true });
}
