import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessBookingContext } from '@/lib/auth-server';
import { sanitizeExternalUrl, TR_WEEKDAYS } from '@/lib/booking-helpers';

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
  const { error, ctx, db, readOnly } = await requireBusinessBookingContext('booking.view', true);
  if (error || !ctx || !db || !ctx.business) return error!;

  const businessId = ctx.business.id;
  const [
    { data: staff },
    { data: services },
    { data: staffServices },
    { data: workingHours },
    { data: breaks },
    { data: leaves },
  ] = await Promise.all([
    db
      .from('booking_staff')
      .select('*')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('booking_services')
      .select('id, name, price, discount_price, duration_minutes, is_active')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true }),
    db.from('staff_services').select('staff_id, service_id').eq('business_id', businessId),
    db.from('staff_working_hours').select('*').eq('business_id', businessId),
    db.from('staff_breaks').select('*').eq('business_id', businessId).order('start_time', { ascending: true }),
    db.from('staff_leaves').select('*').eq('business_id', businessId).order('start_date', { ascending: false }),
  ]);

  const enrichedStaff = (staff ?? []).map((st) => ({
    ...st,
    service_ids: (staffServices ?? [])
      .filter((ss) => ss.staff_id === st.id)
      .map((ss) => ss.service_id),
    working_hours: (workingHours ?? []).filter((wh) => wh.staff_id === st.id),
    breaks: (breaks ?? []).filter((br) => br.staff_id === st.id),
  }));

  return NextResponse.json({
    readOnly,
    staff: enrichedStaff,
    services: services ?? [],
    leaves: leaves ?? [],
  });
}

export async function POST(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessBookingContext('booking.staff');
  if (error || !ctx || !db || !ctx.business) return error!;

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

  const { count } = await db
    .from('booking_staff')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId);

  const { data: created, error: createErr } = await db
    .from('booking_staff')
    .insert({
      business_id: businessId,
      full_name: d.fullName,
      avatar_url: sanitizeExternalUrl(d.avatarUrl) ?? '',
      specialties: d.specialties,
      bio: d.bio,
      is_active: d.isActive,
      sort_order: count ?? 0,
    })
    .select('*')
    .single();

  if (createErr || !created) {
    return NextResponse.json({ error: createErr?.message ?? 'Personel eklenemedi.' }, { status: 500 });
  }

  // Çalışma saatleri
  const whRows = (d.workingHours && d.workingHours.length > 0
    ? d.workingHours
    : TR_WEEKDAYS.map((day) => ({
        day_of_week: day.day,
        is_working: day.day !== 0,
        start_time: day.day === 0 ? '10:00' : '09:00',
        end_time: day.day === 0 ? '17:00' : '19:00',
      }))
  ).map((wh) => ({
    business_id: businessId,
    staff_id: created.id,
    day_of_week: wh.day_of_week,
    is_working: wh.is_working,
    start_time: wh.start_time,
    end_time: wh.end_time,
  }));

  await db.from('staff_working_hours').insert(whRows);

  if (d.serviceIds.length > 0) {
    const { data: validServices } = await db
      .from('booking_services')
      .select('id')
      .eq('business_id', businessId)
      .in('id', d.serviceIds);
    const validIds = (validServices ?? []).map((s) => s.id);
    if (validIds.length > 0) {
      await db.from('staff_services').insert(
        validIds.map((serviceId) => ({
          business_id: businessId,
          staff_id: created.id,
          service_id: serviceId,
        }))
      );
    }
  }

  return NextResponse.json({ staff: created }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessBookingContext('booking.staff');
  if (error || !ctx || !db || !ctx.business) return error!;

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

  if (d.action === 'add_break') {
    if (d.endTime <= d.startTime) {
      return NextResponse.json({ error: 'Mola bitiş saati başlangıçtan sonra olmalıdır.' }, { status: 400 });
    }
    const { data: br, error: err } = await db
      .from('staff_breaks')
      .insert({
        business_id: businessId,
        staff_id: d.staffId,
        day_of_week: d.dayOfWeek ?? null,
        title: d.title,
        start_time: d.startTime,
        end_time: d.endTime,
      })
      .select('*')
      .single();
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });
    return NextResponse.json({ breakItem: br }, { status: 201 });
  }

  if (d.action === 'delete_break') {
    await db.from('staff_breaks').delete().eq('id', d.breakId).eq('business_id', businessId);
    return NextResponse.json({ success: true });
  }

  if (d.action === 'add_leave') {
    if (d.endDate < d.startDate) {
      return NextResponse.json({ error: 'Bitiş tarihi başlangıç tarihinden önce olamaz.' }, { status: 400 });
    }
    const { data: lv, error: err } = await db
      .from('staff_leaves')
      .insert({
        business_id: businessId,
        staff_id: d.staffId ?? null,
        start_date: d.startDate,
        end_date: d.endDate,
        reason: d.reason,
      })
      .select('*')
      .single();
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });
    return NextResponse.json({ leave: lv }, { status: 201 });
  }

  if (d.action === 'delete_leave') {
    await db.from('staff_leaves').delete().eq('id', d.leaveId).eq('business_id', businessId);
    return NextResponse.json({ success: true });
  }

  const { data: updated, error: updErr } = await db
    .from('booking_staff')
    .update({
      full_name: d.fullName,
      avatar_url: sanitizeExternalUrl(d.avatarUrl) ?? '',
      specialties: d.specialties,
      bio: d.bio,
      is_active: d.isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', d.id)
    .eq('business_id', businessId)
    .select('*')
    .maybeSingle();

  if (updErr || !updated) {
    return NextResponse.json({ error: 'Personel güncellenemedi.' }, { status: 400 });
  }

  if (d.serviceIds !== undefined) {
    await db.from('staff_services').delete().eq('business_id', businessId).eq('staff_id', d.id);
    if (d.serviceIds.length > 0) {
      const { data: validServices } = await db
        .from('booking_services')
        .select('id')
        .eq('business_id', businessId)
        .in('id', d.serviceIds);
      const validIds = (validServices ?? []).map((s) => s.id);
      if (validIds.length > 0) {
        await db.from('staff_services').insert(
          validIds.map((serviceId) => ({
            business_id: businessId,
            staff_id: d.id,
            service_id: serviceId,
          }))
        );
      }
    }
  }

  if (d.workingHours && d.workingHours.length > 0) {
    for (const wh of d.workingHours) {
      await db
        .from('staff_working_hours')
        .upsert(
          {
            business_id: businessId,
            staff_id: d.id,
            day_of_week: wh.day_of_week,
            is_working: wh.is_working,
            start_time: wh.start_time,
            end_time: wh.end_time,
          },
          { onConflict: 'staff_id,day_of_week' }
        );
    }
  }

  return NextResponse.json({ staff: updated });
}

export async function DELETE(req: NextRequest) {
  const { error, ctx, db } = await requireBusinessBookingContext('booking.staff');
  if (error || !ctx || !db || !ctx.business) return error!;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Personel kimliği gerekli.' }, { status: 400 });

  const { count } = await db
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.business.id)
    .eq('staff_id', id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          'Bu personelin geçmiş veya aktif randevuları bulunduğu için silinemez. Bunun yerine pasif duruma alabilirsiniz.',
      },
      { status: 409 }
    );
  }

  const { error: delErr } = await db
    .from('booking_staff')
    .delete()
    .eq('id', id)
    .eq('business_id', ctx.business.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
