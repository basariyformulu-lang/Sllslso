'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Building2,
  CalendarCheck,
  Clock,
  ExternalLink,
  LogOut,
  RefreshCw,
  Star,
  X,
  XCircle,
} from 'lucide-react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import { APPOINTMENT_STATUS_LABELS, formatTimeHHMM } from '@/lib/booking-helpers';
import { formatCurrencyTRY, formatDateTR, getIstanbulTodayISO } from '@/lib/format';
import type {
  Appointment,
  AppointmentNotification,
  CustomerAccount,
} from '@/lib/types';

interface CustomerAppointmentItem extends Omit<Appointment, 'business'> {
  business?: {
    id: string;
    name: string;
    booking_slug?: string | null;
    phone?: string;
    address?: string;
    logo_url?: string;
    cancellation_deadline_hours?: number;
  };
}

interface VisitedBusiness {
  businessId: string;
  name: string;
  slug: string | null;
  logoUrl: string;
  phone: string;
  address: string;
  appointmentCount: number;
}

interface SlotItem {
  time: string;
  availableStaffIds: string[];
}

export default function CustomerPortalPage() {
  const { showToast } = useToast();
  const todayISO = getIstanbulTodayISO();

  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<CustomerAccount | null>(null);
  const [appointments, setAppointments] = useState<CustomerAppointmentItem[]>([]);
  const [visited, setVisited] = useState<VisitedBusiness[]>([]);
  const [notifications, setNotifications] = useState<AppointmentNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const [tab, setTab] = useState<'upcoming' | 'past' | 'businesses'>('upcoming');

  // Giriş / Kayıt ekranı durumu
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  // İptal / Saat Değiştir / Yorum Modalları
  const [cancelTarget, setCancelTarget] = useState<CustomerAppointmentItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [rescheduleTarget, setRescheduleTarget] = useState<CustomerAppointmentItem | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(todayISO);
  const [rescheduleSlots, setRescheduleSlots] = useState<SlotItem[]>([]);
  const [rescheduleTime, setRescheduleTime] = useState('');

  const [reviewTarget, setReviewTarget] = useState<CustomerAppointmentItem | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/customer/appointments', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        setCustomer(null);
        return;
      }
      const json = await res.json();
      if (res.ok) {
        setCustomer(json.customer ?? null);
        setAppointments(json.appointments ?? []);
        setVisited(json.visitedBusinesses ?? []);
        setNotifications(json.notifications ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadPortal();
    });
    return () => {
      active = false;
    };
  }, [loadPortal]);

  // Saat değişikliği için slot getir
  useEffect(() => {
    if (!rescheduleTarget?.business?.booking_slug || !rescheduleTarget.service_id || !rescheduleDate) {
      return;
    }
    let active = true;
    void Promise.resolve().then(async () => {
      const slug = rescheduleTarget.business!.booking_slug!;
      const res = await fetch(
        `/api/public/booking/${encodeURIComponent(slug)}?slots=1&date=${rescheduleDate}&serviceId=${rescheduleTarget.service_id}&staffId=${rescheduleTarget.staff_id || 'any'}&ignoreAppointmentId=${rescheduleTarget.id}`
      );
      const json = await res.json();
      if (active && res.ok) {
        setRescheduleSlots(json.slots ?? []);
      }
    });
    return () => {
      active = false;
    };
  }, [rescheduleTarget, rescheduleDate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createBrowserSupabase();
    if (!supabase) return;
    setAuthBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginForm.email.trim().toLowerCase(),
        password: loginForm.password,
      });
      if (error) {
        showToast('E-posta veya şifre hatalı', 'error');
        return;
      }
      showToast('Giriş yapıldı', 'success');
      await loadPortal();
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createBrowserSupabase();
    if (!supabase) return;
    setAuthBusy(true);
    try {
      const res = await fetch('/api/customer/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerForm),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Kayıt oluşturulamadı', 'error');
        return;
      }
      await supabase.auth.signInWithPassword({
        email: registerForm.email.trim().toLowerCase(),
        password: registerForm.password,
      });
      showToast('Müşteri hesabınız oluşturuldu', 'success');
      await loadPortal();
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    const supabase = createBrowserSupabase();
    if (supabase) await supabase.auth.signOut();
    setCustomer(null);
  }

  async function handleMarkNotificationsRead() {
    await fetch('/api/customer/appointments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_notifications_read' }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  async function handleCancelSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelTarget) return;
    setBusyAction(true);
    try {
      const res = await fetch('/api/customer/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          appointmentId: cancelTarget.id,
          cancellationReason: cancelReason,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'İptal işlemi başarısız', 'error');
        return;
      }
      showToast('Randevunuz iptal edildi', 'success');
      setCancelTarget(null);
      setCancelReason('');
      await loadPortal();
    } finally {
      setBusyAction(false);
    }
  }

  async function handleRescheduleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rescheduleTarget || !rescheduleTime) return;
    setBusyAction(true);
    try {
      const res = await fetch('/api/customer/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reschedule',
          appointmentId: rescheduleTarget.id,
          appointmentDate: rescheduleDate,
          startTime: rescheduleTime,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Saat güncellenemedi', 'error');
        return;
      }
      showToast('Randevu saatiniz güncellendi', 'success');
      setRescheduleTarget(null);
      setRescheduleTime('');
      await loadPortal();
    } finally {
      setBusyAction(false);
    }
  }

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewTarget) return;
    setBusyAction(true);
    try {
      const res = await fetch('/api/customer/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: reviewTarget.id,
          rating: reviewRating,
          comment: reviewComment,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Yorum kaydedilemedi', 'error');
        return;
      }
      showToast('Değerlendirmeniz için teşekkürler!', 'success');
      setReviewTarget(null);
      setReviewComment('');
      setReviewRating(5);
      await loadPortal();
    } finally {
      setBusyAction(false);
    }
  }

  const upcomingAppointments = useMemo(
    () =>
      appointments.filter(
        (a) =>
          ['pending', 'confirmed'].includes(a.status) && a.appointment_date >= todayISO
      ),
    [appointments, todayISO]
  );

  const pastAppointments = useMemo(
    () =>
      appointments.filter(
        (a) =>
          !['pending', 'confirmed'].includes(a.status) || a.appointment_date < todayISO
      ),
    [appointments, todayISO]
  );

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3">
          <div className="h-8 w-48 rounded bg-slate-200 animate-pulse mx-auto" />
          <div className="h-40 rounded-xl bg-slate-200 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center px-4 py-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 text-center">
            <Link href="/" className="text-2xl font-bold text-[#0F2942] font-display">
              EsnafTakip
            </Link>
            <p className="mt-1 text-sm text-slate-600">Müşteri Randevu Portalı</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
            <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setAuthTab('login')}
                className={`rounded-md py-2 ${
                  authTab === 'login' ? 'bg-white text-[#0F2942] shadow-xs' : 'text-slate-500'
                }`}
              >
                Müşteri Girişi
              </button>
              <button
                type="button"
                onClick={() => setAuthTab('register')}
                className={`rounded-md py-2 ${
                  authTab === 'register' ? 'bg-white text-[#0F2942] shadow-xs' : 'text-slate-500'
                }`}
              >
                Yeni Müşteri Kaydı
              </button>
            </div>

            {authTab === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-medium text-slate-700">E-posta Adresi</label>
                  <input
                    type="email"
                    required
                    value={loginForm.email}
                    onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Şifre</label>
                  <input
                    type="password"
                    required
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full rounded-lg bg-[#0F2942] py-2.5 text-sm font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
                >
                  {authBusy ? 'Giriş Yapılıyor...' : 'Randevularımı Gör'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-medium text-slate-700">Ad *</label>
                    <input
                      type="text"
                      required
                      value={registerForm.firstName}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, firstName: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Soyad *</label>
                    <input
                      type="text"
                      required
                      value={registerForm.lastName}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, lastName: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Telefon *</label>
                  <input
                    type="tel"
                    required
                    value={registerForm.phone}
                    onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">E-posta *</label>
                  <input
                    type="email"
                    required
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-medium text-slate-700">Şifre *</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={registerForm.password}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, password: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Şifre Tekrar *</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={registerForm.confirmPassword}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, confirmPassword: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full rounded-lg bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {authBusy ? 'Hesap Oluşturuluyor...' : 'Müşteri Hesabı Oluştur'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="min-w-0">
            <Link href="/" className="text-lg font-bold text-[#0F2942] font-display">
              EsnafTakip Randevu
            </Link>
            <p className="truncate text-xs text-slate-500">
              Hoş geldiniz, {customer.first_name} {customer.last_name} ({customer.phone})
            </p>
          </div>

          <div className="relative flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setNotifOpen((p) => !p);
                if (!notifOpen && unreadCount > 0) void handleMarkNotificationsRead();
              }}
              className="relative rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
              aria-label="Bildirimler"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Çıkış</span>
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-12 z-40 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                <p className="border-b border-slate-200 pb-2 text-xs font-bold text-slate-900">
                  Randevu Bildirimleriniz
                </p>
                <div className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-500">Henüz bildirim yok.</p>
                  ) : (
                    notifications.map((n) => (
                      <div key={n.id} className="py-2.5 text-xs">
                        <p className="font-semibold text-slate-900">{n.title}</p>
                        <p className="mt-0.5 text-slate-600">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 w-fit text-xs font-semibold">
          <button
            type="button"
            onClick={() => setTab('upcoming')}
            className={`rounded-lg px-4 py-2 ${
              tab === 'upcoming' ? 'bg-[#0F2942] text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Yaklaşan Randevular ({upcomingAppointments.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('past')}
            className={`rounded-lg px-4 py-2 ${
              tab === 'past' ? 'bg-[#0F2942] text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Geçmiş Randevular ({pastAppointments.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('businesses')}
            className={`rounded-lg px-4 py-2 ${
              tab === 'businesses'
                ? 'bg-[#0F2942] text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            İşletmelerim ({visited.length})
          </button>
        </div>

        {/* Yaklaşan Randevular */}
        {tab === 'upcoming' && (
          <div className="space-y-3">
            {upcomingAppointments.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
                Yaklaşan aktif randevunuz bulunmuyor.
              </div>
            ) : (
              upcomingAppointments.map((appt) => {
                const st = APPOINTMENT_STATUS_LABELS[appt.status] ?? {
                  label: appt.status,
                  tone: 'neutral' as const,
                };
                return (
                  <div
                    key={appt.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-sm font-bold text-slate-900">
                          {appt.business?.name ?? 'İşletme'}
                        </h3>
                        <StatusText label={st.label} tone={st.tone} />
                      </div>
                      <p className="text-xs font-medium text-slate-700">
                        {appt.service_name_snapshot} · {appt.staff_name_snapshot}
                      </p>
                      <p className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                        <Clock className="h-3.5 w-3.5" />
                        <span>
                          {formatDateTR(appt.appointment_date)} · {formatTimeHHMM(appt.start_time)} -{' '}
                          {formatTimeHHMM(appt.end_time)}
                        </span>
                        <span>·</span>
                        <span>{formatCurrencyTRY(appt.service_price_snapshot)}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {appt.business?.booking_slug && (
                        <button
                          type="button"
                          onClick={() => {
                            setRescheduleTarget(appt);
                            setRescheduleDate(appt.appointment_date);
                            setRescheduleTime('');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>Saat Değiştir</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setCancelTarget(appt);
                          setCancelReason('');
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>İptal Et</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Geçmiş Randevular */}
        {tab === 'past' && (
          <div className="space-y-3">
            {pastAppointments.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
                Geçmiş randevu kaydınız bulunmuyor.
              </div>
            ) : (
              pastAppointments.map((appt) => {
                const st = APPOINTMENT_STATUS_LABELS[appt.status] ?? {
                  label: appt.status,
                  tone: 'neutral' as const,
                };
                return (
                  <div
                    key={appt.id}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5">
                          <h3 className="text-sm font-bold text-slate-900">
                            {appt.business?.name ?? 'İşletme'}
                          </h3>
                          <StatusText label={st.label} tone={st.tone} />
                        </div>
                        <p className="text-xs text-slate-700">
                          {appt.service_name_snapshot} · {appt.staff_name_snapshot}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                          {formatDateTR(appt.appointment_date)} · {formatTimeHHMM(appt.start_time)} ·{' '}
                          {formatCurrencyTRY(appt.service_price_snapshot)}
                        </p>
                      </div>

                      {appt.status === 'completed' && !appt.review && (
                        <button
                          type="button"
                          onClick={() => {
                            setReviewTarget(appt);
                            setReviewRating(5);
                            setReviewComment('');
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F2942] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173B5E]"
                        >
                          <Star className="h-3.5 w-3.5" />
                          <span>Değerlendir &amp; Yorum Yap</span>
                        </button>
                      )}
                    </div>

                    {appt.review && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-800">Değerlendirmeniz</span>
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star
                                key={s}
                                className={`h-3.5 w-3.5 ${
                                  s <= appt.review!.rating
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-slate-300'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                        <p className="text-slate-700">{appt.review.comment}</p>
                        {appt.review.business_reply && (
                          <p className="mt-1.5 border-t border-slate-200 pt-1.5 text-[11px] text-slate-600">
                            <strong>İşletme Yanıtı:</strong> {appt.review.business_reply}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Ziyaret Edilen İşletmeler */}
        {tab === 'businesses' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {visited.length === 0 ? (
              <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
                Henüz randevu aldığınız bir işletme bulunmuyor.
              </div>
            ) : (
              visited.map((b) => (
                <div
                  key={b.businessId}
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-[#0F2942] shrink-0" />
                      <h3 className="truncate text-sm font-bold text-slate-900">{b.name}</h3>
                    </div>
                    {b.address && <p className="mt-1 truncate text-xs text-slate-500">{b.address}</p>}
                    <p className="mt-1 text-[11px] text-slate-500">
                      {b.appointmentCount} randevu kaydı
                    </p>
                  </div>
                  {b.slug && (
                    <Link
                      href={`/r/${b.slug}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 shrink-0"
                    >
                      <CalendarCheck className="h-3.5 w-3.5" />
                      <span>Randevu Al</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* İptal Modalı */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Randevuyu İptal Et</h3>
            <p className="mt-1 text-xs text-slate-600">
              {cancelTarget.business?.name} · {formatDateTR(cancelTarget.appointment_date)}{' '}
              {formatTimeHHMM(cancelTarget.start_time)} randevunuzu iptal etmek istediğinize emin misiniz?
            </p>
            <form onSubmit={handleCancelSubmit} className="mt-4 space-y-3 text-xs">
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="İptal sebebi (opsiyonel)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCancelTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-700"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busyAction ? 'İptal Ediliyor...' : 'Randevuyu İptal Et'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Saat Değiştir Modalı */}
      {rescheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">Randevu Saatini Değiştir</h3>
              <button
                type="button"
                onClick={() => setRescheduleTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRescheduleSubmit} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700">Yeni Tarih</label>
                <input
                  type="date"
                  min={todayISO}
                  required
                  value={rescheduleDate}
                  onChange={(e) => {
                    setRescheduleDate(e.target.value);
                    setRescheduleTime('');
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1.5">Uygun Saatler</label>
                {rescheduleSlots.length === 0 ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    Seçilen tarihte uygun saat bulunamadı.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                    {rescheduleSlots.map((sl) => (
                      <button
                        key={sl.time}
                        type="button"
                        onClick={() => setRescheduleTime(sl.time)}
                        className={`rounded-lg border px-3 py-1.5 font-mono ${
                          rescheduleTime === sl.time
                            ? 'border-[#0F2942] bg-[#0F2942] text-white'
                            : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        {sl.time}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setRescheduleTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={!rescheduleTime || busyAction}
                  className="rounded-lg bg-[#0F2942] px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                  {busyAction ? 'Güncelleniyor...' : 'Yeni Saati Onayla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Yorum Yap Modalı */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Hizmeti Değerlendirin</h3>
            <p className="mt-1 text-xs text-slate-600">
              {reviewTarget.business?.name} · {reviewTarget.service_name_snapshot}
            </p>

            <form onSubmit={handleReviewSubmit} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1.5">Puanınız</label>
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setReviewRating(s)}
                      className="p-1"
                    >
                      <Star
                        className={`h-6 w-6 ${
                          s <= reviewRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700">Yorumunuz *</label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Aldığınız hizmet deneyiminizi paylaşın..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReviewTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {busyAction ? 'Gönderiliyor...' : 'Yorumu Yayınla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
