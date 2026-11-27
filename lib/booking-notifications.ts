import { execute, toMySqlDateTime, uuid } from '@/lib/db';

export type AppointmentNotificationType =
  | 'new_appointment'
  | 'appointment_confirmed'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'appointment_reminder';

export async function dispatchAppointmentNotifications(params: {
  businessId: string;
  appointmentId: string;
  customerUserId?: string | null;
  customerPhone?: string;
  type: AppointmentNotificationType;
  businessTitle?: string;
  businessMessage?: string;
  customerTitle?: string;
  customerMessage?: string;
  businessLink?: string;
}) {
  const {
    businessId,
    appointmentId,
    customerUserId = null,
    customerPhone = '',
    type,
    businessTitle,
    businessMessage,
    customerTitle,
    customerMessage,
    businessLink = '/panel/randevu/takvim',
  } = params;

  const nowStr = toMySqlDateTime();

  if (businessTitle && businessMessage) {
    await execute(
      `INSERT INTO appointment_notifications
       (id, business_id, appointment_id, recipient_type, recipient_user_id, recipient_phone, notification_type, channel, title, message, delivery_status, is_read, created_at)
       VALUES (?, ?, ?, 'business', NULL, '', ?, 'in_app', ?, ?, 'sent', 0, ?)`,
      [uuid(), businessId, appointmentId, type, businessTitle, businessMessage, nowStr]
    );

    await execute(
      `INSERT INTO notifications
       (id, business_id, recipient_user_id, type, title, message, link, is_read, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 0, ?)`,
      [uuid(), businessId, type, businessTitle, businessMessage, businessLink, nowStr]
    );
  }

  if (customerTitle && customerMessage) {
    await execute(
      `INSERT INTO appointment_notifications
       (id, business_id, appointment_id, recipient_type, recipient_user_id, recipient_phone, notification_type, channel, title, message, delivery_status, is_read, created_at)
       VALUES (?, ?, ?, 'customer', ?, ?, ?, 'in_app', ?, ?, 'sent', 0, ?)`,
      [
        uuid(),
        businessId,
        appointmentId,
        customerUserId,
        customerPhone,
        type,
        customerTitle,
        customerMessage,
        nowStr,
      ]
    );
  }
}
