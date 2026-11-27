import {
  execute,
  parseJsonField,
  queryOne,
  toBool,
  toIsoString,
  toMySqlDateTime,
  uuid,
  withNamedLock,
  withTransaction,
} from '@/lib/db';
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_SECTION_VISIBILITY,
  normalizePhoneTR,
  slugifyBookingTitle,
} from '@/lib/booking-helpers';
import { getDayOfWeekFromISO } from '@/lib/booking-slots';
import { roundCurrency } from '@/lib/format';
import type {
  BookingBusinessHour,
  BookingGalleryItem,
  BookingInstagramPost,
  BookingPage,
  BookingSectionVisibility,
  PaymentMethod,
} from '@/lib/types';

function toMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.slice(0, 5).split(':');
  return Number(hStr) * 60 + Number(mStr);
}

function fromMinutesHHMMSS(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function fromMinutesHHMM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatBookingPageRow(row: Record<string, unknown>): BookingPage {
  const visibility = parseJsonField<Partial<BookingSectionVisibility>>(
    row.section_visibility,
    DEFAULT_SECTION_VISIBILITY
  );
  const hours = parseJsonField<BookingBusinessHour[]>(
    row.business_hours,
    DEFAULT_BUSINESS_HOURS
  );
  const gallery = parseJsonField<BookingGalleryItem[]>(row.gallery_images, []);
  const instaPosts = parseJsonField<BookingInstagramPost[]>(row.instagram_posts, []);

  return {
    id: String(row.id),
    business_id: String(row.business_id),
    slug: String(row.slug),
    page_title: String(row.page_title ?? ''),
    description: String(row.description ?? ''),
    logo_url: String(row.logo_url ?? ''),
    cover_image_url: String(row.cover_image_url ?? ''),
    gallery_images: Array.isArray(gallery) ? gallery : [],
    phone: String(row.phone ?? ''),
    whatsapp: String(row.whatsapp ?? ''),
    address: String(row.address ?? ''),
    map_location: String(row.map_location ?? ''),
    instagram_url: String(row.instagram_url ?? ''),
    instagram_username: String(row.instagram_username ?? ''),
    instagram_display_name: String(row.instagram_display_name ?? ''),
    instagram_avatar_url: String(row.instagram_avatar_url ?? ''),
    instagram_followers_count: Number(row.instagram_followers_count ?? 0),
    instagram_posts_count: Number(row.instagram_posts_count ?? 0),
    instagram_posts: Array.isArray(instaPosts) ? instaPosts.slice(0, 6) : [],
    theme_preset: (row.theme_preset as BookingPage['theme_preset']) ?? 'classic_navy',
    primary_color: String(row.primary_color ?? '#0F2942'),
    secondary_color: String(row.secondary_color ?? '#064E3B'),
    section_visibility: {
      ...DEFAULT_SECTION_VISIBILITY,
      ...visibility,
    },
    business_hours: Array.isArray(hours) && hours.length === 7 ? hours : DEFAULT_BUSINESS_HOURS,
    slot_interval_minutes: Math.max(30, Number(row.slot_interval_minutes ?? 30)),
    min_advance_minutes: Number(row.min_advance_minutes ?? 60),
    max_advance_days: Number(row.max_advance_days ?? 30),
    cancellation_deadline_hours: Number(row.cancellation_deadline_hours ?? 2),
    auto_confirm: toBool(row.auto_confirm),
    status: (row.status as BookingPage['status']) ?? 'draft',
    created_at: toIsoString(row.created_at) ?? new Date().toISOString(),
    updated_at: toIsoString(row.updated_at) ?? new Date().toISOString(),
  };
}

export async function ensureBookingPageMysql(business: {
  id: string;
  name: string;
  business_code: string;
  phone: string;
  address: string;
}): Promise<BookingPage | null> {
  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_pages WHERE business_id = ? LIMIT 1',
    [business.id]
  );
  if (existing) return formatBookingPageRow(existing);

  const baseSlug = slugifyBookingTitle(business.name) || business.business_code.toLowerCase();
  let candidate = baseSlug;
  for (let i = 0; i < 8; i++) {
    const clash = await queryOne<{ id: string }>(
      'SELECT id FROM booking_pages WHERE slug = ? LIMIT 1',
      [candidate]
    );
    if (!clash) break;
    candidate = `${baseSlug}-${Math.floor(100 + Math.random() * 899)}`;
  }

  const id = uuid();
  const nowStr = toMySqlDateTime();
  await execute(
    `INSERT INTO booking_pages (
      id, business_id, slug, page_title, description, logo_url, cover_image_url,
      gallery_images, phone, whatsapp, address, map_location, instagram_url,
      instagram_username, instagram_display_name, instagram_avatar_url,
      instagram_followers_count, instagram_posts_count, instagram_posts,
      theme_preset, primary_color, secondary_color, section_visibility,
      business_hours, slot_interval_minutes, min_advance_minutes, max_advance_days,
      cancellation_deadline_hours, auto_confirm, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', '', '', '[]', ?, '', ?, '', '', '', '', '', 0, 0, '[]',
              'classic_navy', '#0F2942', '#064E3B', ?, ?, 30, 60, 30, 2, 0, 'draft', ?, ?)`,
    [
      id,
      business.id,
      candidate,
      business.name,
      business.phone || '',
      business.address || '',
      JSON.stringify(DEFAULT_SECTION_VISIBILITY),
      JSON.stringify(DEFAULT_BUSINESS_HOURS),
      nowStr,
      nowStr,
    ]
  );

  const created = await queryOne<Record<string, unknown>>(
    'SELECT * FROM booking_pages WHERE id = ? LIMIT 1',
    [id]
  );
  return created ? formatBookingPageRow(created) : null;
}

export async function findOrCreateBookingCustomerByPhone(params: {
  businessId: string;
  fullName: string;
  phone: string;
  email?: string;
}): Promise<{ id: string; fullName: string; phone: string; phoneNormalized: string }> {
  const norm = normalizePhoneTR(params.phone);
  const parts = params.fullName.trim().split(/\s+/);
  const firstName = parts[0] || params.fullName.trim();
  const lastName = parts.slice(1).join(' ');

  const existing = norm
    ? await queryOne<Record<string, unknown>>(
        `SELECT id, first_name, last_name, phone, phone_normalized
         FROM booking_customers
         WHERE business_id = ? AND phone_normalized = ?
         LIMIT 1`,
        [params.businessId, norm]
      )
    : null;

  if (existing) {
    const nowStr = toMySqlDateTime();
    await execute(
      `UPDATE booking_customers
       SET first_name = ?, last_name = ?, phone = ?, updated_at = ?
       WHERE id = ?`,
      [firstName, lastName, params.phone.trim(), nowStr, existing.id]
    );
    return {
      id: String(existing.id),
      fullName: params.fullName.trim(),
      phone: params.phone.trim(),
      phoneNormalized: norm,
    };
  }

  const id = uuid();
  const nowStr = toMySqlDateTime();
  await execute(
    `INSERT INTO booking_customers
     (id, business_id, customer_user_id, first_name, last_name, phone, phone_normalized, email, notes, is_active, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, '', 1, ?, ?)`,
    [
      id,
      params.businessId,
      firstName,
      lastName,
      params.phone.trim(),
      norm,
      (params.email ?? '').toLowerCase(),
      nowStr,
      nowStr,
    ]
  );

  return {
    id,
    fullName: params.fullName.trim(),
    phone: params.phone.trim(),
    phoneNormalized: norm,
  };
}

function buildIstanbulDateTimeUTC(dateISO: string, timeHHMM: string): string {
  const dt = new Date(`${dateISO}T${timeHHMM.slice(0, 5)}:00+03:00`);
  return toMySqlDateTime(dt);
}

export async function createAppointmentAtomic(params: {
  businessId: string;
  bookingCustomerId: string;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  staffId: string;
  appointmentDate: string;
  startTime: string;
  customerNotes?: string;
  businessNotes?: string;
  source?: 'online' | 'panel';
  status?: 'pending' | 'confirmed' | null;
}) {
  const {
    businessId,
    bookingCustomerId,
    customerName,
    customerPhone,
    serviceId,
    staffId,
    appointmentDate,
    startTime,
    customerNotes = '',
    businessNotes = '',
    source = 'online',
    status = null,
  } = params;

  const phoneNorm = normalizePhoneTR(customerPhone);

  return withNamedLock(`appt_${businessId}_${appointmentDate}`, async (conn) => {
    const [svcRows] = await conn.execute<any[]>(
      'SELECT * FROM booking_services WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
      [serviceId, businessId]
    );
    const service = svcRows[0];
    if (!service) {
      throw new Error('Seçilen hizmet bulunamadı veya aktif değil.');
    }

    const [stRows] = await conn.execute<any[]>(
      'SELECT * FROM booking_staff WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
      [staffId, businessId]
    );
    const staff = stRows[0];
    if (!staff) {
      throw new Error('Seçilen personel bulunamadı veya aktif değil.');
    }

    const [pageRows] = await conn.execute<any[]>(
      'SELECT auto_confirm FROM booking_pages WHERE business_id = ? LIMIT 1',
      [businessId]
    );
    const autoConfirm = toBool(pageRows[0]?.auto_confirm);

    const duration = Number(service.duration_minutes || 30);
    const startMin = toMinutes(startTime);
    const endMin = startMin + duration;
    const startTimeSql = fromMinutesHHMMSS(startMin);
    const endTimeSql = fromMinutesHHMMSS(endMin);
    const endTimeHHMM = fromMinutesHHMM(endMin);

    const [leaveRows] = await conn.execute<any[]>(
      `SELECT id FROM staff_leaves
       WHERE business_id = ? AND (staff_id IS NULL OR staff_id = ?)
         AND start_date <= ? AND end_date >= ?
       LIMIT 1`,
      [businessId, staffId, appointmentDate, appointmentDate]
    );
    if (leaveRows.length > 0) {
      throw new Error('Seçilen personel bu tarihte izinli veya işletme kapalı.');
    }

    const dow = getDayOfWeekFromISO(appointmentDate);
    const [whRows] = await conn.execute<any[]>(
      'SELECT is_working, start_time, end_time FROM staff_working_hours WHERE business_id = ? AND staff_id = ? AND day_of_week = ? LIMIT 1',
      [businessId, staffId, dow]
    );
    if (whRows.length > 0) {
      const wh = whRows[0];
      if (!toBool(wh.is_working)) {
        throw new Error('Personel seçilen günde çalışmamaktadır.');
      }
      if (startMin < toMinutes(String(wh.start_time)) || endMin > toMinutes(String(wh.end_time))) {
        throw new Error('Seçilen saat personelin çalışma saatleri dışındadır.');
      }
    }

    const [breakRows] = await conn.execute<any[]>(
      `SELECT start_time, end_time FROM staff_breaks
       WHERE business_id = ? AND staff_id = ? AND (day_of_week IS NULL OR day_of_week = ?)`,
      [businessId, staffId, dow]
    );
    for (const br of breakRows) {
      const bStart = toMinutes(String(br.start_time));
      const bEnd = toMinutes(String(br.end_time));
      if (startMin < bEnd && endMin > bStart) {
        throw new Error('Seçilen saat personelin mola aralığına denk geliyor.');
      }
    }

    const [overlapRows] = await conn.execute<any[]>(
      `SELECT id FROM appointments
       WHERE business_id = ? AND staff_id = ? AND appointment_date = ?
         AND status IN ('pending', 'confirmed', 'completed')
         AND start_time < ? AND end_time > ?
       LIMIT 1`,
      [businessId, staffId, appointmentDate, endTimeSql, startTimeSql]
    );
    if (overlapRows.length > 0) {
      throw new Error('Seçilen saat dilimi az önce doldu. Lütfen başka bir saat seçiniz.');
    }

    const effectivePrice =
      service.discount_price !== null && service.discount_price !== undefined
        ? Number(service.discount_price)
        : Number(service.price);
    const finalStatus = status ?? (autoConfirm ? 'confirmed' : 'pending');
    const id = uuid();
    const nowStr = toMySqlDateTime();
    const startAtStr = buildIstanbulDateTimeUTC(appointmentDate, startTime);
    const endAtStr = buildIstanbulDateTimeUTC(appointmentDate, endTimeHHMM);

    await conn.execute(
      `INSERT INTO appointments (
        id, business_id, booking_customer_id, customer_user_id,
        customer_name, customer_phone, customer_phone_normalized,
        service_id, staff_id, service_name_snapshot, service_price_snapshot,
        service_duration_snapshot, staff_name_snapshot,
        appointment_date, start_time, end_time, start_at, end_at,
        status, payment_status, paid_amount, customer_notes, business_notes,
        source, cancelled_by, cancellation_reason, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 0.00, ?, ?, ?, NULL, '', ?, ?)`,
      [
        id,
        businessId,
        bookingCustomerId,
        customerName.trim(),
        customerPhone.trim(),
        phoneNorm,
        service.id,
        staff.id,
        service.name,
        roundCurrency(effectivePrice),
        duration,
        staff.full_name,
        appointmentDate,
        startTimeSql,
        endTimeSql,
        startAtStr,
        endAtStr,
        finalStatus,
        customerNotes,
        businessNotes,
        source,
        nowStr,
        nowStr,
      ]
    );

    return {
      id,
      business_id: businessId,
      booking_customer_id: bookingCustomerId,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      service_id: service.id,
      service_name: String(service.name),
      service_name_snapshot: String(service.name),
      service_price_snapshot: roundCurrency(effectivePrice),
      service_duration_snapshot: duration,
      staff_id: staff.id,
      staff_name_snapshot: String(staff.full_name),
      appointment_date: appointmentDate,
      start_time: startTime,
      end_time: endTimeHHMM,
      start_at: toIsoString(startAtStr),
      end_at: toIsoString(endAtStr),
      status: finalStatus,
    };
  });
}

export async function rescheduleAppointmentAtomic(params: {
  appointmentId: string;
  businessId: string;
  newDate: string;
  newStartTime: string;
  newStaffId?: string | null;
}) {
  const { appointmentId, businessId, newDate, newStartTime, newStaffId } = params;

  return withNamedLock(`appt_${businessId}_${newDate}`, async (conn) => {
    const [apptRows] = await conn.execute<any[]>(
      'SELECT * FROM appointments WHERE id = ? AND business_id = ? LIMIT 1',
      [appointmentId, businessId]
    );
    const existing = apptRows[0];
    if (!existing) {
      throw new Error('Randevu bulunamadı.');
    }

    const targetStaffId = newStaffId || existing.staff_id;
    const [stRows] = await conn.execute<any[]>(
      'SELECT id, full_name FROM booking_staff WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
      [targetStaffId, businessId]
    );
    const staff = stRows[0];
    if (!staff) {
      throw new Error('Seçilen personel aktif değil.');
    }

    const duration = Number(existing.service_duration_snapshot || 30);
    const startMin = toMinutes(newStartTime);
    const endMin = startMin + duration;
    const startTimeSql = fromMinutesHHMMSS(startMin);
    const endTimeSql = fromMinutesHHMMSS(endMin);
    const endTimeHHMM = fromMinutesHHMM(endMin);

    const [leaveRows] = await conn.execute<any[]>(
      `SELECT id FROM staff_leaves
       WHERE business_id = ? AND (staff_id IS NULL OR staff_id = ?)
         AND start_date <= ? AND end_date >= ?
       LIMIT 1`,
      [businessId, targetStaffId, newDate, newDate]
    );
    if (leaveRows.length > 0) {
      throw new Error('Seçilen tarihte personel izinli veya işletme kapalı.');
    }

    const dow = getDayOfWeekFromISO(newDate);
    const [whRows] = await conn.execute<any[]>(
      'SELECT is_working, start_time, end_time FROM staff_working_hours WHERE business_id = ? AND staff_id = ? AND day_of_week = ? LIMIT 1',
      [businessId, targetStaffId, dow]
    );
    if (whRows.length > 0) {
      const wh = whRows[0];
      if (!toBool(wh.is_working)) {
        throw new Error('Personel seçilen günde çalışmıyor.');
      }
      if (startMin < toMinutes(String(wh.start_time)) || endMin > toMinutes(String(wh.end_time))) {
        throw new Error('Seçilen saat personelin çalışma saatleri dışındadır.');
      }
    }

    const [overlapRows] = await conn.execute<any[]>(
      `SELECT id FROM appointments
       WHERE business_id = ? AND staff_id = ? AND appointment_date = ?
         AND id <> ?
         AND status IN ('pending', 'confirmed', 'completed')
         AND start_time < ? AND end_time > ?
       LIMIT 1`,
      [businessId, targetStaffId, newDate, appointmentId, endTimeSql, startTimeSql]
    );
    if (overlapRows.length > 0) {
      throw new Error('Seçilen yeni saat dilimi doludur.');
    }

    const nowStr = toMySqlDateTime();
    const startAtStr = buildIstanbulDateTimeUTC(newDate, newStartTime);
    const endAtStr = buildIstanbulDateTimeUTC(newDate, endTimeHHMM);

    await conn.execute(
      `UPDATE appointments
       SET appointment_date = ?, start_time = ?, end_time = ?, start_at = ?, end_at = ?,
           staff_id = ?, staff_name_snapshot = ?, updated_at = ?
       WHERE id = ? AND business_id = ?`,
      [
        newDate,
        startTimeSql,
        endTimeSql,
        startAtStr,
        endAtStr,
        staff.id,
        staff.full_name,
        nowStr,
        appointmentId,
        businessId,
      ]
    );

    return {
      id: appointmentId,
      appointment_date: newDate,
      start_time: newStartTime,
      end_time: endTimeHHMM,
      staff_id: staff.id,
      staff_name_snapshot: staff.full_name,
    };
  });
}

export async function recordAppointmentPaymentAtomic(params: {
  appointmentId: string;
  businessId: string;
  userId: string;
  amount: number;
  paymentType: 'collection' | 'refund';
  paymentMethod: PaymentMethod;
  paymentDate: string;
  notes?: string;
  idempotencyKey?: string | null;
}) {
  const {
    appointmentId,
    businessId,
    userId,
    amount,
    paymentType,
    paymentMethod,
    paymentDate,
    notes = '',
    idempotencyKey = null,
  } = params;

  return withTransaction(async (conn) => {
    if (idempotencyKey) {
      const [dupRows] = await conn.execute<any[]>(
        'SELECT * FROM appointment_payments WHERE business_id = ? AND idempotency_key = ? LIMIT 1',
        [businessId, idempotencyKey]
      );
      if (dupRows.length > 0) {
        return dupRows[0];
      }
    }

    const [apptRows] = await conn.execute<any[]>(
      'SELECT * FROM appointments WHERE id = ? AND business_id = ? FOR UPDATE',
      [appointmentId, businessId]
    );
    const appt = apptRows[0];
    if (!appt) {
      throw new Error('Randevu bulunamadı.');
    }

    const cleanAmount = roundCurrency(amount);
    const currentPaid = roundCurrency(appt.paid_amount);
    const totalPrice = roundCurrency(appt.service_price_snapshot);
    const nowStr = toMySqlDateTime();

    let newPaid = currentPaid;
    let newPayStatus = String(appt.payment_status);
    let incomeId: string | null = null;
    let expenseId: string | null = null;

    if (paymentType === 'collection') {
      newPaid = roundCurrency(currentPaid + cleanAmount);
      newPayStatus = totalPrice > 0 && newPaid >= totalPrice ? 'paid' : 'partial';

      incomeId = uuid();
      await conn.execute(
        `INSERT INTO income_transactions
         (id, business_id, category_id, category_name, title, amount, transaction_date, description, is_cancelled, created_by, created_at, updated_at)
         VALUES (?, ?, NULL, 'Online Randevu', ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          incomeId,
          businessId,
          `Randevu Tahsilatı: ${appt.service_name_snapshot}`,
          cleanAmount,
          paymentDate,
          notes || `${appt.customer_name || 'Müşteri'} (${appt.appointment_date})`,
          userId,
          nowStr,
          nowStr,
        ]
      );
    } else {
      if (cleanAmount > currentPaid) {
        throw new Error('İade tutarı tahsil edilen toplam tutardan büyük olamaz.');
      }
      newPaid = roundCurrency(currentPaid - cleanAmount);
      newPayStatus = newPaid <= 0 ? 'refunded' : 'partial';

      expenseId = uuid();
      await conn.execute(
        `INSERT INTO expense_transactions
         (id, business_id, category_id, category_name, title, amount, transaction_date, payment_method, description, is_cancelled, created_by, created_at, updated_at)
         VALUES (?, ?, NULL, 'Randevu İadesi', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          expenseId,
          businessId,
          `Randevu İadesi: ${appt.service_name_snapshot}`,
          cleanAmount,
          paymentDate,
          paymentMethod,
          notes || `${appt.customer_name || 'Müşteri'} (${appt.appointment_date})`,
          userId,
          nowStr,
          nowStr,
        ]
      );
    }

    await conn.execute(
      'UPDATE appointments SET paid_amount = ?, payment_status = ?, updated_at = ? WHERE id = ?',
      [newPaid, newPayStatus, nowStr, appointmentId]
    );

    const payId = uuid();
    await conn.execute(
      `INSERT INTO appointment_payments
       (id, business_id, appointment_id, amount, payment_type, payment_method, payment_date, income_transaction_id, expense_transaction_id, idempotency_key, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payId,
        businessId,
        appointmentId,
        cleanAmount,
        paymentType,
        paymentMethod,
        paymentDate,
        incomeId,
        expenseId,
        idempotencyKey,
        notes,
        userId,
        nowStr,
      ]
    );

    return {
      id: payId,
      appointment_id: appointmentId,
      amount: cleanAmount,
      payment_type: paymentType,
      payment_method: paymentMethod,
      payment_date: paymentDate,
      income_transaction_id: incomeId,
      expense_transaction_id: expenseId,
      paid_amount: newPaid,
      payment_status: newPayStatus,
    };
  });
}
