import type {
  BookingBusinessHour,
  StaffBreak,
  StaffLeave,
  StaffWorkingHour,
} from '@/lib/types';

export interface ExistingApptInterval {
  id: string;
  staff_id: string;
  start_time: string; // HH:MM or HH:MM:SS
  end_time: string;
  status: string;
}

export interface ComputedSlot {
  time: string; // HH:MM
  endTime: string; // HH:MM
  availableStaffIds: string[];
  recommendedStaffId: string;
}

function toMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.slice(0, 5).split(':');
  return Number(hStr) * 60 + Number(mStr);
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getIstanbulNowParts(): { dateISO: string; minutesSinceMidnight: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const min = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  return {
    dateISO: `${y}-${m}-${d}`,
    minutesSinceMidnight: (h === 24 ? 0 : h) * 60 + min,
  };
}

export function getDayOfWeekFromISO(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDaysToISODate(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function computeAvailableSlots(params: {
  dateISO: string;
  serviceDurationMinutes: number;
  slotIntervalMinutes: number;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  businessHours: BookingBusinessHour[];
  candidateStaffIds: string[];
  staffWorkingHours: StaffWorkingHour[];
  staffBreaks: StaffBreak[];
  staffLeaves: StaffLeave[];
  existingAppointments: ExistingApptInterval[];
  ignoreAppointmentId?: string;
  enforceAdvanceRules?: boolean;
}): ComputedSlot[] {
  const {
    dateISO,
    serviceDurationMinutes,
    slotIntervalMinutes,
    minAdvanceMinutes,
    maxAdvanceDays,
    businessHours,
    candidateStaffIds,
    staffWorkingHours,
    staffBreaks,
    staffLeaves,
    existingAppointments,
    ignoreAppointmentId,
    enforceAdvanceRules = true,
  } = params;

  if (candidateStaffIds.length === 0) return [];

  const nowParts = getIstanbulNowParts();
  if (enforceAdvanceRules) {
    if (dateISO < nowParts.dateISO) return [];
    const maxDateISO = addDaysToISODate(nowParts.dateISO, maxAdvanceDays);
    if (dateISO > maxDateISO) return [];
  }

  // Tüm işletme tatili kontrolü
  const businessClosedOnDate = staffLeaves.some(
    (l) => !l.staff_id && dateISO >= l.start_date && dateISO <= l.end_date
  );
  if (businessClosedOnDate) return [];

  const dow = getDayOfWeekFromISO(dateISO);
  const bizDay = businessHours.find((h) => h.day === dow);
  if (!bizDay || !bizDay.is_open) return [];

  const bizOpenMin = toMinutes(bizDay.open);
  const bizCloseMin = toMinutes(bizDay.close);
  if (bizCloseMin <= bizOpenMin) return [];

  // Gün içindeki randevu yoğunluğuna göre personel dengeleme
  const apptCountByStaff = new Map<string, number>();
  candidateStaffIds.forEach((id) => apptCountByStaff.set(id, 0));
  existingAppointments.forEach((a) => {
    if (
      a.id !== ignoreAppointmentId &&
      ['pending', 'confirmed', 'completed'].includes(a.status)
    ) {
      apptCountByStaff.set(a.staff_id, (apptCountByStaff.get(a.staff_id) ?? 0) + 1);
    }
  });

  const minAllowedTodayMin =
    enforceAdvanceRules && dateISO === nowParts.dateISO
      ? nowParts.minutesSinceMidnight + minAdvanceMinutes
      : -1;

  const slots: ComputedSlot[] = [];

  for (
    let startMin = bizOpenMin;
    startMin + serviceDurationMinutes <= bizCloseMin;
    startMin += slotIntervalMinutes
  ) {
    const endMin = startMin + serviceDurationMinutes;
    if (minAllowedTodayMin >= 0 && startMin < minAllowedTodayMin) {
      continue;
    }

    const availableForSlot: string[] = [];

    for (const staffId of candidateStaffIds) {
      // 1. Personel izni
      const onLeave = staffLeaves.some(
        (l) => l.staff_id === staffId && dateISO >= l.start_date && dateISO <= l.end_date
      );
      if (onLeave) continue;

      // 2. Personel çalışma saati
      const wh = staffWorkingHours.find(
        (w) => w.staff_id === staffId && w.day_of_week === dow
      );
      if (wh) {
        if (!wh.is_working) continue;
        const staffOpen = toMinutes(wh.start_time);
        const staffClose = toMinutes(wh.end_time);
        if (startMin < staffOpen || endMin > staffClose) continue;
      }

      // 3. Personel mola saati çakışması
      const hitsBreak = staffBreaks.some((b) => {
        if (b.staff_id !== staffId) return false;
        if (b.day_of_week !== null && b.day_of_week !== dow) return false;
        const bStart = toMinutes(b.start_time);
        const bEnd = toMinutes(b.end_time);
        return startMin < bEnd && endMin > bStart;
      });
      if (hitsBreak) continue;

      // 4. Mevcut randevu çakışması
      const hitsAppt = existingAppointments.some((a) => {
        if (a.id === ignoreAppointmentId) return false;
        if (a.staff_id !== staffId) return false;
        if (!['pending', 'confirmed', 'completed'].includes(a.status)) return false;
        const aStart = toMinutes(a.start_time);
        const aEnd = toMinutes(a.end_time);
        return startMin < aEnd && endMin > aStart;
      });
      if (hitsAppt) continue;

      availableForSlot.push(staffId);
    }

    if (availableForSlot.length > 0) {
      const sorted = [...availableForSlot].sort(
        (a, b) => (apptCountByStaff.get(a) ?? 0) - (apptCountByStaff.get(b) ?? 0)
      );
      slots.push({
        time: fromMinutes(startMin),
        endTime: fromMinutes(endMin),
        availableStaffIds: sorted,
        recommendedStaffId: sorted[0],
      });
    }
  }

  return slots;
}
