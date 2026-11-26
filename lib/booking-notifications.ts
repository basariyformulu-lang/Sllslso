import type { SupabaseClient } from '@supabase/supabase-js';

export type AppointmentNotificationType =
  | 'new_appointment'
  | 'appointment_confirmed'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'appointment_reminder';

export async function dispatchAppointmentNotifications(
  db: SupabaseClient,
  params: {
    businessId: string;
    appointmentId: string;
    customerUserId?: string | null;
    type: AppointmentNotificationType;
    businessTitle?: string;
    businessMessage?: string;
    customerTitle?: string;
    customerMessage?: string;
    businessLink?: string;
  }
) {
  const {
    businessId,
    appointmentId,
    customerUserId,
    type,
    businessTitle,
    businessMessage,
    customerTitle,
    customerMessage,
    businessLink = '/panel/randevu/takvim',
  } = params;

  const inserts: Array<Record<string, unknown>> = [];

  if (businessTitle && businessMessage) {
    inserts.push({
      business_id: businessId,
      appointment_id: appointmentId,
      recipient_type: 'business',
      recipient_user_id: null,
      notification_type: type,
      channel: 'in_app',
      title: businessTitle,
      message: businessMessage,
      delivery_status: 'sent',
      is_read: false,
    });

    // Mevcut yönetim panelindeki bildirim ziline de yansıt
    await db.from('notifications').insert({
      business_id: businessId,
      type,
      title: businessTitle,
      message: businessMessage,
      link: businessLink,
      is_read: false,
    });
  }

  if (customerUserId && customerTitle && customerMessage) {
    inserts.push({
      business_id: businessId,
      appointment_id: appointmentId,
      recipient_type: 'customer',
      recipient_user_id: customerUserId,
      notification_type: type,
      channel: 'in_app',
      title: customerTitle,
      message: customerMessage,
      delivery_status: 'sent',
      is_read: false,
    });
  }

  if (inserts.length > 0) {
    await db.from('appointment_notifications').insert(inserts);
  }
}
