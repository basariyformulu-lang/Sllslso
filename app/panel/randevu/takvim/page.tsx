'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Clock,
  CreditCard,
  CheckCircle2,
  XCircle,
  RefreshCw,
  X,
  UserPlus,
  Banknote,
} from 'lucide-react';
import { PanelShell } from '@/components/PanelShell';
import { BookingReadOnlyBanner } from '@/components/BookingReadOnlyBanner';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import {
  APPOINTMENT_PAYMENT_LABELS,
  APPOINTMENT_STATUS_LABELS,
  formatTimeHHMM,
} from '@/lib/booking-helpers';
import {
  formatCurrencyTRY,
  formatDateTR,
  getIstanbulTodayISO,
  PAYMENT_METHOD_LABELS,
} from '@/lib/format';
import type {
  Appointment,
  AppointmentPayment,
  BookingCustomer,
  BookingService,
  BookingStaff,
  PaymentMethod,
} from '@/lib/types';

interface EnrichedAppointment extends Appointment {
  payments?: AppointmentPayment[];
}

interface SlotItem {
  time: string;
  availableStaffIds: string[];
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function getMondayOfWeekISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

function getMonthGridBounds(iso: string): {
  year: number;
  month: number;
  startISO: string;
  endISO: string;
  days: string[];
} {
  const [y, m] = iso.split('-').map(Number);
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const firstDow = firstOfMonth.getUTCDay();
  const offsetStart = firstDow === 0 ? -6 : 1 - firstDow;
  const gridStart = new Date(Date.UTC(y, m - 1, 1 + offsetStart));
  const days: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return {
    year: y,
    month: m,
    startISO: days[0],
    endISO: days[days.length - 1],
    days,
  };
}

export default function BookingCalendarPage() {
  const { showToast } = useToast();
  const todayISO = getIstanbulTodayISO();

  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [selectedDate, setSelectedDate] = useState(todayISO);

  const [staffFilter, setStaffFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<EnrichedAppointment[]>([]);
  const [services, setServices] = useState<BookingService[]>([]);
  const [staff, setStaff] = useState<BookingStaff[]>([]);
  const [customers, setCustomers] = useState<BookingCustomer[]>([]);

  // Detay çekmecesi
  const [detailAppt, setDetailAppt] = useState<EnrichedAppointment | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelMode, setCancelMode] = useState(false);
  const [rescheduleMode, setRescheduleMode] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(todayISO);
  const [rescheduleStaffId, setRescheduleStaffId] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState<SlotItem[]>([]);
  const [rescheduleTime, setRescheduleTime] = useState('');

  // Tahsilat / İade formu
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentType: 'collection' as 'collection' | 'refund',
    paymentMethod: 'nakit' as PaymentMethod,
    paymentDate: todayISO,
    notes: '',
  });
  const [busyAction, setBusyAction] = useState(false);

  // Yeni Randevu Modalı
  const [createOpen, setCreateOpen] = useState(false);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [createForm, setCreateForm] = useState({
    bookingCustomerId: '',
    newFirstName: '',
    newLastName: '',
    newPhone: '',
    newEmail: '',
    serviceId: '',
    staffId: 'any',
    appointmentDate: todayISO,
    startTime: '',
    status: 'confirmed' as 'confirmed' | 'pending',
    businessNotes: '',
  });
  const [createSlots, setCreateSlots] = useState<SlotItem[]>([]);
  const [loadingCreateSlots, setLoadingCreateSlots] = useState(false);

  const dateBounds = useMemo(() => {
    if (viewMode === 'daily') {
      return { start: selectedDate, end: selectedDate };
    }
    if (viewMode === 'weekly') {
      const start = getMondayOfWeekISO(selectedDate);
      return { start, end: addDaysISO(start, 6) };
    }
    const mg = getMonthGridBounds(selectedDate);
    return { start: mg.startISO, end: mg.endISO };
  }, [viewMode, selectedDate]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/panel/booking/appointments?startDate=${dateBounds.start}&endDate=${dateBounds.end}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      if (res.ok) {
        const list = (json.appointments ?? []) as EnrichedAppointment[];
        setAppointments(list);
        setServices(json.services ?? []);
        setStaff(json.staff ?? []);
        setCustomers(json.customers ?? []);
        setReadOnly(Boolean(json.readOnly));
        setDetailAppt((prev) => (prev ? list.find((a) => a.id === prev.id) ?? null : null));
      }
    } finally {
      setLoading(false);
    }
  }, [dateBounds.start, dateBounds.end]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  // Yeni randevu slotlarını çek
  useEffect(() => {
    if (!createOpen || !createForm.serviceId || !createForm.appointmentDate) return;
    let active = true;
    void Promise.resolve().then(async () => {
      setLoadingCreateSlots(true);
      try {
        const res = await fetch(
          `/api/panel/booking/appointments?mode=slots&date=${createForm.appointmentDate}&serviceId=${createForm.serviceId}&staffId=${createForm.staffId}`
        );
        const json = await res.json();
        if (active && res.ok) {
          setCreateSlots(json.slots ?? []);
        }
      } finally {
        if (active) setLoadingCreateSlots(false);
      }
    });
    return () => {
      active = false;
    };
  }, [createOpen, createForm.serviceId, createForm.staffId, createForm.appointmentDate]);

  // Yeniden planlama slotlarını çek
  useEffect(() => {
    if (!rescheduleMode || !detailAppt?.service_id || !rescheduleDate) return;
    let active = true;
    void Promise.resolve().then(async () => {
      const staffParam = rescheduleStaffId || detailAppt.staff_id || 'any';
      const res = await fetch(
        `/api/panel/booking/appointments?mode=slots&date=${rescheduleDate}&serviceId=${detailAppt.service_id}&staffId=${staffParam}&ignoreAppointmentId=${detailAppt.id}`
      );
      const json = await res.json();
      if (active && res.ok) {
        setRescheduleSlots(json.slots ?? []);
      }
    });
    return () => {
      active = false;
    };
  }, [rescheduleMode, detailAppt, rescheduleDate, rescheduleStaffId]);

  const filteredAppointments = useMemo(() => {
    return appointments.filter((a) => {
      if (staffFilter !== 'all' && a.staff_id !== staffFilter) return false;
      if (serviceFilter !== 'all' && a.service_id !== serviceFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (search.trim()) {
        const custName = a.customer ? `${a.customer.first_name} ${a.customer.last_name}` : '';
        const phone = a.customer?.phone ?? '';
        const haystack = `${custName} ${phone} ${a.service_name_snapshot} ${a.staff_name_snapshot}`.toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [appointments, staffFilter, serviceFilter, statusFilter, search]);

  function shiftDate(step: number) {
    if (viewMode === 'daily') setSelectedDate(addDaysISO(selectedDate, step));
    else if (viewMode === 'weekly') setSelectedDate(addDaysISO(selectedDate, step * 7));
    else {
      const [y, m] = selectedDate.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1 + step, 1));
      setSelectedDate(dt.toISOString().slice(0, 10));
    }
  }

  function openDetail(appt: EnrichedAppointment) {
    setDetailAppt(appt);
    setNotesDraft(appt.business_notes || '');
    setCancelMode(false);
    setCancelReason('');
    setRescheduleMode(false);
    setRescheduleDate(appt.appointment_date);
    setRescheduleStaffId(appt.staff_id || '');
    setRescheduleTime('');
  }

  function openNewAppointmentModal() {
    const activeSrv = services.filter((s) => s.is_active);
    setNewCustomerMode(customers.length === 0);
    setCreateForm({
      bookingCustomerId: customers[0]?.id ?? '',
      newFirstName: '',
      newLastName: '',
      newPhone: '',
      newEmail: '',
      serviceId: activeSrv[0]?.id ?? '',
      staffId: 'any',
      appointmentDate: selectedDate,
      startTime: '',
      status: 'confirmed',
      businessNotes: '',
    });
    setCreateSlots([]);
    setCreateOpen(true);
  }

  async function handleCreateAppointment(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.startTime) {
      showToast('Lütfen uygun bir randevu saati seçiniz', 'error');
      return;
    }
    setBusyAction(true);
    try {
      const payload = {
        bookingCustomerId: newCustomerMode ? null : createForm.bookingCustomerId || null,
        ...(newCustomerMode
          ? {
              newCustomer: {
                firstName: createForm.newFirstName,
                lastName: createForm.newLastName,
                phone: createForm.newPhone,
                email: createForm.newEmail,
              },
            }
          : {}),
        serviceId: createForm.serviceId,
        staffId: createForm.staffId,
        appointmentDate: createForm.appointmentDate,
        startTime: createForm.startTime,
        status: createForm.status,
        businessNotes: createForm.businessNotes,
      };
      const res = await fetch('/api/panel/booking/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Randevu oluşturulamadı', 'error');
        return;
      }
      showToast('Randevu başarıyla oluşturuldu', 'success');
      setCreateOpen(false);
      await loadData();
    } finally {
      setBusyAction(false);
    }
  }

  async function handleUpdateStatus(
    id: string,
    status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show',
    reason = ''
  ) {
    setBusyAction(true);
    try {
      const res = await fetch('/api/panel/booking/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_status',
          id,
          status,
          cancellationReason: reason,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Durum güncellenemedi', 'error');
        return;
      }
      showToast('Randevu durumu güncellendi', 'success');
      setCancelMode(false);
      await loadData();
    } finally {
      setBusyAction(false);
    }
  }

  async function handleSaveNotes() {
    if (!detailAppt) return;
    setBusyAction(true);
    try {
      const res = await fetch('/api/panel/booking/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_notes',
          id: detailAppt.id,
          businessNotes: notesDraft,
        }),
      });
      if (res.ok) {
        showToast('İşletme notu kaydedildi', 'success');
        await loadData();
      }
    } finally {
      setBusyAction(false);
    }
  }

  async function handleReschedule(e: React.FormEvent) {
    e.preventDefault();
    if (!detailAppt || !rescheduleTime) return;
    setBusyAction(true);
    try {
      const res = await fetch('/api/panel/booking/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reschedule',
          id: detailAppt.id,
          appointmentDate: rescheduleDate,
          startTime: rescheduleTime,
          staffId: rescheduleStaffId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Saat güncellenemedi', 'error');
        return;
      }
      showToast('Randevu yeni tarih/saate taşındı', 'success');
      setRescheduleMode(false);
      await loadData();
    } finally {
      setBusyAction(false);
    }
  }

  function openPaymentModal(type: 'collection' | 'refund') {
    if (!detailAppt) return;
    const remaining = Math.max(
      0,
      Number(detailAppt.service_price_snapshot) - Number(detailAppt.paid_amount)
    );
    setPaymentForm({
      amount:
        type === 'collection'
          ? String(remaining > 0 ? remaining : detailAppt.service_price_snapshot)
          : String(detailAppt.paid_amount),
      paymentType: type,
      paymentMethod: 'nakit',
      paymentDate: todayISO,
      notes: '',
    });
    setPaymentModalOpen(true);
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!detailAppt) return;
    setBusyAction(true);
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? `appt-pay-${crypto.randomUUID()}`
          : `appt-pay-${detailAppt.id}-${Date.now()}`;

      const res = await fetch('/api/panel/booking/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_payment',
          id: detailAppt.id,
          amount: Number(paymentForm.amount),
          paymentType: paymentForm.paymentType,
          paymentMethod: paymentForm.paymentMethod,
          paymentDate: paymentForm.paymentDate,
          notes: paymentForm.notes,
          idempotencyKey,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Ödeme kaydedilemedi', 'error');
        return;
      }
      showToast(
        paymentForm.paymentType === 'refund'
          ? 'İade kaydedildi ve Giderler modülüne işlendi'
          : 'Tahsilat kaydedildi ve Gelirler modülüne işlendi',
        'success'
      );
      setPaymentModalOpen(false);
      await loadData();
    } finally {
      setBusyAction(false);
    }
  }

  const weekDays = useMemo(() => {
    const start = getMondayOfWeekISO(selectedDate);
    return Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));
  }, [selectedDate]);

  const monthGrid = useMemo(() => getMonthGridBounds(selectedDate), [selectedDate]);

  return (
    <PanelShell>
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-display">Randevu Takvimi</h1>
            <p className="mt-1 text-xs text-slate-600">
              Günlük, haftalık ve aylık görünümle tüm randevularınızı yönetin, tahsilatları tek tıkla Gelirler modülüne aktarın.
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={openNewAppointmentModal}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173B5E]"
            >
              <Plus className="h-4 w-4" />
              <span>Yeni Randevu Oluştur</span>
            </button>
          )}
        </div>

        <BookingReadOnlyBanner visible={readOnly} />

        {/* Takvim Araç Çubuğu ve Filtreler */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs font-medium">
              {(
                [
                  ['daily', 'Günlük'],
                  ['weekly', 'Haftalık'],
                  ['monthly', 'Aylık'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setViewMode(m)}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    viewMode === m ? 'bg-white text-[#0F2942] shadow-xs font-semibold' : 'text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => shiftDate(-1)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(todayISO)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Bugün
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono text-slate-800"
              />
              <button
                type="button"
                onClick={() => shiftDate(1)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Müşteri adı veya telefon ara..."
                className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs"
              />
            </div>

            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5"
            >
              <option value="all">Tüm Personeller</option>
              {staff.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.full_name}
                </option>
              ))}
            </select>

            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5"
            >
              <option value="all">Tüm Hizmetler</option>
              {services.map((srv) => (
                <option key={srv.id} value={srv.id}>
                  {srv.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5"
            >
              <option value="all">Tüm Durumlar</option>
              <option value="pending">Beklemede</option>
              <option value="confirmed">Onaylandı</option>
              <option value="completed">Tamamlandı</option>
              <option value="cancelled">İptal Edildi</option>
              <option value="no_show">Gelmedi</option>
            </select>
          </div>
        </div>

        {/* Takvim Görünümü */}
        {loading ? (
          <div className="h-80 rounded-xl bg-slate-200 animate-pulse" />
        ) : viewMode === 'daily' ? (
          <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-[#0F2942]" />
                <span className="text-sm font-bold text-slate-900">
                  {formatDateTR(selectedDate)} Randevuları
                </span>
              </div>
              <span className="text-xs text-slate-500">
                {filteredAppointments.length} randevu
              </span>
            </div>

            {filteredAppointments.length === 0 ? (
              <p className="py-12 text-center text-xs text-slate-500">
                Seçilen gün ve filtreler için randevu bulunamadı.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredAppointments.map((appt) => {
                  const st = APPOINTMENT_STATUS_LABELS[appt.status] ?? {
                    label: appt.status,
                    tone: 'neutral' as const,
                  };
                  const pay = APPOINTMENT_PAYMENT_LABELS[appt.payment_status] ?? {
                    label: appt.payment_status,
                    tone: 'neutral' as const,
                  };
                  const customerName = appt.customer
                    ? `${appt.customer.first_name} ${appt.customer.last_name}`.trim()
                    : 'Müşteri';

                  return (
                    <button
                      key={appt.id}
                      type="button"
                      onClick={() => openDetail(appt)}
                      className="flex w-full flex-wrap items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center shrink-0">
                          <p className="font-mono text-sm font-bold text-[#0F2942]">
                            {formatTimeHHMM(appt.start_time)}
                          </p>
                          <p className="font-mono text-[10px] text-slate-500">
                            {formatTimeHHMM(appt.end_time)}
                          </p>
                        </div>

                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {customerName}{' '}
                            <span className="text-xs font-normal text-slate-500">
                              ({appt.customer?.phone})
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600 truncate">
                            {appt.service_name_snapshot} · {appt.staff_name_snapshot} ·{' '}
                            {appt.source === 'online' ? 'Online Randevu' : 'Panel Kaydı'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-5 shrink-0">
                        <div className="text-right">
                          <p className="font-mono text-sm font-bold text-slate-900">
                            {formatCurrencyTRY(appt.service_price_snapshot)}
                          </p>
                          <p className="text-[11px] text-slate-500">{pay.label}</p>
                        </div>
                        <StatusText label={st.label} tone={st.tone} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : viewMode === 'weekly' ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
            {weekDays.map((dayISO) => {
              const dayAppts = filteredAppointments.filter((a) => a.appointment_date === dayISO);
              const isToday = dayISO === todayISO;
              return (
                <div
                  key={dayISO}
                  className={`flex flex-col rounded-xl border bg-white shadow-xs min-h-[260px] ${
                    isToday ? 'border-[#0F2942]' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5 text-xs">
                    <span className={`font-bold ${isToday ? 'text-[#0F2942]' : 'text-slate-800'}`}>
                      {formatDateTR(dayISO)}
                    </span>
                    <span className="text-[11px] text-slate-400">{dayAppts.length}</span>
                  </div>
                  <div className="flex-1 space-y-1.5 p-2">
                    {dayAppts.length === 0 ? (
                      <p className="py-6 text-center text-[11px] text-slate-400">Randevu yok</p>
                    ) : (
                      dayAppts.map((appt) => (
                        <button
                          key={appt.id}
                          type="button"
                          onClick={() => openDetail(appt)}
                          className={`w-full rounded-lg border p-2 text-left text-[11px] transition-colors ${
                            appt.status === 'cancelled'
                              ? 'border-slate-200 bg-slate-50 text-slate-400 line-through'
                              : appt.status === 'pending'
                              ? 'border-amber-200 bg-amber-50/70 text-amber-950'
                              : 'border-slate-200 bg-slate-50 hover:border-[#0F2942]'
                          }`}
                        >
                          <p className="font-mono font-bold text-[#0F2942]">
                            {formatTimeHHMM(appt.start_time)}
                          </p>
                          <p className="font-semibold text-slate-800 truncate">
                            {appt.customer
                              ? `${appt.customer.first_name} ${appt.customer.last_name}`
                              : 'Müşteri'}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate">
                            {appt.service_name_snapshot}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="grid grid-cols-7 gap-2 border-b border-slate-200 pb-2 text-center text-xs font-semibold text-slate-600">
              {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-2">
              {monthGrid.days.map((dayISO) => {
                const inMonth = Number(dayISO.slice(5, 7)) === monthGrid.month;
                const dayAppts = filteredAppointments.filter((a) => a.appointment_date === dayISO);
                return (
                  <button
                    key={dayISO}
                    type="button"
                    onClick={() => {
                      setSelectedDate(dayISO);
                      setViewMode('daily');
                    }}
                    className={`flex min-h-[84px] flex-col items-start justify-between rounded-lg border p-2 text-left transition-colors hover:border-[#0F2942] ${
                      dayISO === todayISO
                        ? 'border-[#0F2942] bg-slate-50'
                        : inMonth
                        ? 'border-slate-200 bg-white'
                        : 'border-slate-100 bg-slate-50/50 text-slate-400'
                    }`}
                  >
                    <span className="font-mono text-xs font-bold">{Number(dayISO.slice(8, 10))}</span>
                    {dayAppts.length > 0 && (
                      <div className="w-full space-y-0.5">
                        <p className="text-[10px] font-semibold text-emerald-700">
                          {dayAppts.length} randevu
                        </p>
                        {dayAppts.slice(0, 2).map((a) => (
                          <p key={a.id} className="truncate text-[10px] text-slate-600">
                            {formatTimeHHMM(a.start_time)} {a.customer?.first_name}
                          </p>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Randevu Detay Çekmecesi / Modalı */}
      {detailAppt && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50">
          <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Randevu Detayı</h2>
                <p className="text-xs text-slate-500 font-mono">
                  {formatDateTR(detailAppt.appointment_date)} · {formatTimeHHMM(detailAppt.start_time)} -{' '}
                  {formatTimeHHMM(detailAppt.end_time)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailAppt(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {detailAppt.customer
                      ? `${detailAppt.customer.first_name} ${detailAppt.customer.last_name}`.trim()
                      : 'Müşteri'}
                  </p>
                  <p className="mt-0.5 font-mono text-slate-600">{detailAppt.customer?.phone}</p>
                </div>
                <StatusText
                  label={APPOINTMENT_STATUS_LABELS[detailAppt.status]?.label ?? detailAppt.status}
                  tone={APPOINTMENT_STATUS_LABELS[detailAppt.status]?.tone ?? 'neutral'}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-4">
                <div>
                  <p className="text-slate-500">Hizmet (Kayıt Anı)</p>
                  <p className="mt-0.5 font-semibold text-slate-900">
                    {detailAppt.service_name_snapshot}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {detailAppt.service_duration_snapshot} dakika
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Personel</p>
                  <p className="mt-0.5 font-semibold text-slate-900">
                    {detailAppt.staff_name_snapshot}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {detailAppt.source === 'online' ? 'Online alındı' : 'Panelden eklendi'}
                  </p>
                </div>
              </div>

              {detailAppt.customer_notes && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="font-semibold text-slate-700">Müşteri Notu</p>
                  <p className="mt-1 text-slate-600">{detailAppt.customer_notes}</p>
                </div>
              )}

              {/* Hızlı Durum İşlemleri */}
              {!readOnly && (
                <div className="space-y-2">
                  <p className="font-semibold text-slate-800">Durum İşlemleri</p>
                  <div className="flex flex-wrap gap-2">
                    {detailAppt.status !== 'confirmed' && detailAppt.status !== 'completed' && (
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => handleUpdateStatus(detailAppt.id, 'confirmed')}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#0F2942] px-3 py-1.5 font-semibold text-white hover:bg-[#173B5E]"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Onayla</span>
                      </button>
                    )}
                    {detailAppt.status !== 'completed' && detailAppt.status !== 'cancelled' && (
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => handleUpdateStatus(detailAppt.id, 'completed')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Tamamlandı İşaretle</span>
                      </button>
                    )}
                    {['pending', 'confirmed'].includes(detailAppt.status) && (
                      <>
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => setRescheduleMode((p) => !p)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>Saat Değiştir</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => handleUpdateStatus(detailAppt.id, 'no_show')}
                          className="rounded-lg border border-amber-200 px-3 py-1.5 font-medium text-amber-800 hover:bg-amber-50"
                        >
                          Gelmedi
                        </button>
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => setCancelMode((p) => !p)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>İptal Et</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {cancelMode && (
                <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
                  <label className="block font-semibold text-red-900">İptal Sebebi (Opsiyonel)</label>
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Örn: Müşteri talebiyle iptal edildi"
                    className="w-full rounded border border-red-200 bg-white px-2.5 py-1.5"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCancelMode(false)}
                      className="rounded border border-slate-200 bg-white px-3 py-1 text-slate-600"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => handleUpdateStatus(detailAppt.id, 'cancelled', cancelReason)}
                      className="rounded bg-red-600 px-3 py-1 font-semibold text-white"
                    >
                      İptali Onayla
                    </button>
                  </div>
                </div>
              )}

              {rescheduleMode && (
                <form
                  onSubmit={handleReschedule}
                  className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5"
                >
                  <p className="font-bold text-slate-900">Tarih / Saat Güncelle</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      required
                      value={rescheduleDate}
                      onChange={(e) => {
                        setRescheduleDate(e.target.value);
                        setRescheduleTime('');
                      }}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <select
                      value={rescheduleStaffId}
                      onChange={(e) => {
                        setRescheduleStaffId(e.target.value);
                        setRescheduleTime('');
                      }}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    >
                      {staff.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.full_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {rescheduleSlots.length === 0 ? (
                    <p className="text-slate-500">Seçilen tarihte uygun saat bulunamadı.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                      {rescheduleSlots.map((sl) => (
                        <button
                          key={sl.time}
                          type="button"
                          onClick={() => setRescheduleTime(sl.time)}
                          className={`rounded-md border px-2.5 py-1 font-mono ${
                            rescheduleTime === sl.time
                              ? 'border-[#0F2942] bg-[#0F2942] text-white'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          {sl.time}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setRescheduleMode(false)}
                      className="rounded border border-slate-200 bg-white px-3 py-1.5"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="submit"
                      disabled={!rescheduleTime || busyAction}
                      className="rounded bg-[#0F2942] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                    >
                      Yeni Saati Kaydet
                    </button>
                  </div>
                </form>
              )}

              {/* Finansal Tahsilat / Ödeme Yönetimi */}
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900">
                    <CreditCard className="h-4 w-4 text-emerald-700" />
                    <span>Ödeme ve Tahsilat</span>
                  </div>
                  <StatusText
                    label={
                      APPOINTMENT_PAYMENT_LABELS[detailAppt.payment_status]?.label ??
                      detailAppt.payment_status
                    }
                    tone={APPOINTMENT_PAYMENT_LABELS[detailAppt.payment_status]?.tone ?? 'neutral'}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center font-mono">
                  <div>
                    <p className="text-[10px] text-slate-500">Hizmet Tutarı</p>
                    <p className="mt-0.5 font-bold text-slate-900">
                      {formatCurrencyTRY(detailAppt.service_price_snapshot)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">Tahsil Edilen</p>
                    <p className="mt-0.5 font-bold text-emerald-700">
                      {formatCurrencyTRY(detailAppt.paid_amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">Kalan</p>
                    <p className="mt-0.5 font-bold text-amber-700">
                      {formatCurrencyTRY(
                        Math.max(
                          0,
                          Number(detailAppt.service_price_snapshot) - Number(detailAppt.paid_amount)
                        )
                      )}
                    </p>
                  </div>
                </div>

                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    {Number(detailAppt.paid_amount) < Number(detailAppt.service_price_snapshot) && (
                      <button
                        type="button"
                        onClick={() => openPaymentModal('collection')}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-800"
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        <span>Tahsilat Kaydet (Gelirlere İşle)</span>
                      </button>
                    )}
                    {Number(detailAppt.paid_amount) > 0 && (
                      <button
                        type="button"
                        onClick={() => openPaymentModal('refund')}
                        className="rounded-lg border border-red-200 px-3 py-2 font-medium text-red-700 hover:bg-red-50"
                      >
                        İade Kaydet
                      </button>
                    )}
                  </div>
                )}

                {(detailAppt.payments ?? []).length > 0 && (
                  <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
                    {(detailAppt.payments ?? []).map((p) => (
                      <div key={p.id} className="flex items-center justify-between py-1.5 text-[11px]">
                        <span>
                          {formatDateTR(p.payment_date)} ·{' '}
                          {PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            p.payment_type === 'refund' ? 'text-red-600' : 'text-emerald-700'
                          }`}
                        >
                          {p.payment_type === 'refund' ? '-' : '+'}
                          {formatCurrencyTRY(p.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* İşletme Notu */}
              <div className="space-y-2">
                <label className="block font-semibold text-slate-800">İşletme Notları</label>
                <textarea
                  rows={2}
                  disabled={readOnly}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                {!readOnly && (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={handleSaveNotes}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Notu Kaydet
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tahsilat / İade Modal */}
      {paymentModalOpen && detailAppt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              {paymentForm.paymentType === 'refund' ? 'Randevu İadesi Kaydet' : 'Randevu Tahsilatı Kaydet'}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Bu işlem otomatik olarak EsnafTakip {paymentForm.paymentType === 'refund' ? 'Giderler' : 'Gelirler'} modülüne işlenir.
            </p>

            <form onSubmit={handleRecordPayment} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700">Tutar (TL) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700">Ödeme Yöntemi</label>
                  <select
                    value={paymentForm.paymentMethod}
                    onChange={(e) =>
                      setPaymentForm({
                        ...paymentForm,
                        paymentMethod: e.target.value as PaymentMethod,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2"
                  >
                    <option value="nakit">Nakit</option>
                    <option value="kart">Kredi / Banka Kartı</option>
                    <option value="banka">Banka / EFT</option>
                    <option value="diger">Diğer</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Tarih</label>
                  <input
                    type="date"
                    required
                    value={paymentForm.paymentDate}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, paymentDate: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700">Açıklama</label>
                <input
                  type="text"
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  placeholder="Opsiyonel tahsilat notu"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setPaymentModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {busyAction ? 'Kaydediliyor...' : 'Onayla ve Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Yeni Randevu Oluştur Modalı */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-900">Yeni Randevu Oluştur</h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAppointment} className="mt-4 space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-800">Müşteri Bilgisi</label>
                <button
                  type="button"
                  onClick={() => setNewCustomerMode((p) => !p)}
                  className="inline-flex items-center gap-1 font-semibold text-[#0F2942] hover:underline"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>{newCustomerMode ? 'Kayıtlı Müşteri Seç' : 'Yeni Müşteri Ekle'}</span>
                </button>
              </div>

              {newCustomerMode ? (
                <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                  <input
                    type="text"
                    required
                    value={createForm.newFirstName}
                    onChange={(e) => setCreateForm({ ...createForm, newFirstName: e.target.value })}
                    placeholder="Ad *"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                  <input
                    type="text"
                    value={createForm.newLastName}
                    onChange={(e) => setCreateForm({ ...createForm, newLastName: e.target.value })}
                    placeholder="Soyad"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                  <input
                    type="tel"
                    required
                    value={createForm.newPhone}
                    onChange={(e) => setCreateForm({ ...createForm, newPhone: e.target.value })}
                    placeholder="Telefon *"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                  <input
                    type="email"
                    value={createForm.newEmail}
                    onChange={(e) => setCreateForm({ ...createForm, newEmail: e.target.value })}
                    placeholder="E-posta (opsiyonel)"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                </div>
              ) : (
                <select
                  required
                  value={createForm.bookingCustomerId}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, bookingCustomerId: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.first_name} {c.last_name} ({c.phone})
                    </option>
                  ))}
                </select>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700">Hizmet *</label>
                  <select
                    required
                    value={createForm.serviceId}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, serviceId: e.target.value, startTime: '' })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    {services
                      .filter((s) => s.is_active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.duration_minutes} dk · {formatCurrencyTRY(s.discount_price ?? s.price)})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700">Personel *</label>
                  <select
                    value={createForm.staffId}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, staffId: e.target.value, startTime: '' })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="any">Fark etmez (Uygun personeli seç)</option>
                    {staff
                      .filter((st) => st.is_active)
                      .map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.full_name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700">Randevu Tarihi *</label>
                  <input
                    type="date"
                    required
                    value={createForm.appointmentDate}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        appointmentDate: e.target.value,
                        startTime: '',
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Başlangıç Durumu</label>
                  <select
                    value={createForm.status}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        status: e.target.value as 'confirmed' | 'pending',
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="confirmed">Onaylandı</option>
                    <option value="pending">Onay Bekliyor</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-700">
                  <Clock className="h-3.5 w-3.5 text-[#0F2942]" />
                  <span>Uygun Randevu Saatleri *</span>
                </div>
                {loadingCreateSlots ? (
                  <p className="text-slate-500">Uygun saatler hesaplanıyor...</p>
                ) : createSlots.length === 0 ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    Seçilen tarih ve hizmet için uygun saat dilimi bulunamadı. Çalışma saatleri veya personel mesaisini kontrol edin.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2.5">
                    {createSlots.map((slot) => (
                      <button
                        key={slot.time}
                        type="button"
                        onClick={() => setCreateForm({ ...createForm, startTime: slot.time })}
                        className={`rounded-md border px-3 py-1.5 font-mono text-xs transition-colors ${
                          createForm.startTime === slot.time
                            ? 'border-[#0F2942] bg-[#0F2942] font-semibold text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        {slot.time}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-700">Not (Opsiyonel)</label>
                <input
                  type="text"
                  value={createForm.businessNotes}
                  onChange={(e) => setCreateForm({ ...createForm, businessNotes: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={busyAction || !createForm.startTime}
                  className="rounded-lg bg-[#0F2942] px-4 py-2 font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
                >
                  {busyAction ? 'Oluşturuluyor...' : 'Randevuyu Oluştur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
