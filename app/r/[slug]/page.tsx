'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Lock,
  Scissors,
  UserCheck,
  X,
} from 'lucide-react';
import {
  BookingStorefrontRenderer,
  type StorefrontReview,
} from '@/components/BookingStorefrontRenderer';
import { useToast } from '@/components/ToastProvider';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { formatCurrencyTRY, formatDateTR, getIstanbulTodayISO } from '@/lib/format';
import type {
  BookingPage,
  BookingService,
  BookingStaff,
  CustomerAccount,
} from '@/lib/types';

interface PublicBookingPayload {
  page: BookingPage;
  isBookingOpen: boolean;
  closedReason: string | null;
  services: BookingService[];
  staff: BookingStaff[];
  reviews: StorefrontReview[];
}

interface SlotItem {
  time: string;
  availableStaffIds: string[];
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export default function PublicBookingStorefrontPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug || '').toLowerCase();
  const { showToast } = useToast();
  const todayISO = getIstanbulTodayISO();

  const [loading, setLoading] = useState(true);
  const [notFoundErr, setNotFoundErr] = useState(false);
  const [payload, setPayload] = useState<PublicBookingPayload | null>(null);
  const [customerAcc, setCustomerAcc] = useState<CustomerAccount | null>(null);

  // Randevu Sihirbazı Durumu
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('any');
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [selectedTime, setSelectedTime] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');

  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedAppt, setConfirmedAppt] = useState<{
    id: string;
    service_name: string;
    staff_name: string;
    appointment_date: string;
    start_time: string;
    status: string;
  } | null>(null);

  // Adım 4: Müşteri Giriş / Kayıt
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

  const loadStorefront = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const [pubRes, meRes] = await Promise.all([
        fetch(`/api/public/booking/${encodeURIComponent(slug)}`, { cache: 'no-store' }),
        fetch('/api/auth/me', { cache: 'no-store' }),
      ]);
      if (!pubRes.ok) {
        setNotFoundErr(true);
        return;
      }
      const pubJson = (await pubRes.json()) as PublicBookingPayload;
      setPayload(pubJson);

      if (meRes.ok) {
        const meJson = await meRes.json();
        setCustomerAcc(meJson.user?.customerAccount ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadStorefront();
    });
    return () => {
      active = false;
    };
  }, [loadStorefront]);

  // Tarih/Hizmet/Personel değiştikçe uygun saatleri getir
  useEffect(() => {
    if (!wizardOpen || step !== 3 || !selectedServiceId || !selectedDate || !slug) return;
    let active = true;
    void Promise.resolve().then(async () => {
      setLoadingSlots(true);
      try {
        const res = await fetch(
          `/api/public/booking/${encodeURIComponent(slug)}?slots=1&date=${selectedDate}&serviceId=${selectedServiceId}&staffId=${selectedStaffId}`
        );
        const json = await res.json();
        if (active && res.ok) {
          setSlots(json.slots ?? []);
        }
      } finally {
        if (active) setLoadingSlots(false);
      }
    });
    return () => {
      active = false;
    };
  }, [wizardOpen, step, slug, selectedDate, selectedServiceId, selectedStaffId]);

  const selectedService = useMemo(
    () => payload?.services.find((s) => s.id === selectedServiceId) ?? null,
    [payload, selectedServiceId]
  );

  const qualifiedStaff = useMemo(() => {
    if (!payload) return [];
    if (!selectedService) return payload.staff;
    const mapped = selectedService.staff_ids ?? [];
    if (mapped.length === 0) return payload.staff;
    const set = new Set(mapped);
    return payload.staff.filter((st) => set.has(st.id));
  }, [payload, selectedService]);

  const selectedStaffName = useMemo(() => {
    if (selectedStaffId === 'any') return 'Fark etmez (Uygun personel)';
    return payload?.staff.find((s) => s.id === selectedStaffId)?.full_name ?? 'Personel';
  }, [payload, selectedStaffId]);

  function openBookingWizard(preselectedServiceId?: string, preselectedStaffId?: string) {
    if (!payload?.isBookingOpen) return;
    setConfirmedAppt(null);
    setSelectedTime('');
    setCustomerNotes('');
    setSelectedDate(todayISO);

    const srvId = preselectedServiceId || '';
    setSelectedServiceId(srvId);
    setSelectedStaffId(preselectedStaffId || 'any');
    setStep(srvId ? (preselectedStaffId ? 3 : 2) : 1);
    setWizardOpen(true);
  }

  async function handleCustomerLogin(e: React.FormEvent) {
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
      const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
      const meJson = await meRes.json();
      if (!meJson.user?.customerAccount) {
        showToast(
          'Bu hesap müşteri hesabı değil. Lütfen müşteri hesabıyla giriş yapın veya kayıt olun.',
          'error'
        );
        return;
      }
      setCustomerAcc(meJson.user.customerAccount);
      showToast('Müşteri oturumu açıldı', 'success');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleCustomerRegister(e: React.FormEvent) {
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
        showToast(json.error || 'Kayıt tamamlanamadı', 'error');
        return;
      }
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: registerForm.email.trim().toLowerCase(),
        password: registerForm.password,
      });
      if (signErr) {
        showToast('Hesap oluşturuldu, lütfen giriş sekmesinden oturum açın', 'info');
        setAuthTab('login');
        return;
      }
      const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
      const meJson = await meRes.json();
      setCustomerAcc(meJson.user?.customerAccount ?? null);
      showToast('Müşteri hesabınız oluşturuldu', 'success');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleConfirmBooking() {
    if (!customerAcc) {
      showToast('Randevuyu onaylamak için müşteri hesabınıza giriş yapmalısınız', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/customer/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          serviceId: selectedServiceId,
          staffId: selectedStaffId,
          appointmentDate: selectedDate,
          startTime: selectedTime,
          customerNotes,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Randevu oluşturulamadı', 'error');
        return;
      }
      setConfirmedAppt(json.appointment);
      setStep(5);
      showToast('Randevunuz oluşturuldu!', 'success');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="h-14 rounded-xl bg-slate-200 animate-pulse" />
          <div className="h-64 rounded-2xl bg-slate-200 animate-pulse" />
        </div>
      </div>
    );
  }

  if (notFoundErr || !payload) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Randevu Sayfası Bulunamadı</h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Aradığınız işletme bağlantısı mevcut değil veya henüz aktif edilmemiş.
          </p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white"
          >
            Ana Sayfaya Dön
          </Link>
        </div>
      </div>
    );
  }

  const maxDateISO = addDaysISO(todayISO, payload.page.max_advance_days ?? 30);

  return (
    <div className="min-h-screen">
      <BookingStorefrontRenderer
        page={payload.page}
        services={payload.services}
        staff={payload.staff}
        reviews={payload.reviews}
        isBookingOpen={payload.isBookingOpen}
        closedReason={payload.closedReason}
        onStartBooking={openBookingWizard}
      />

      {/* Adım Adım Randevu Alma Sihirbazı */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[1px]">
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                {step > 1 && step < 5 && (
                  <button
                    type="button"
                    onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : 1))}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    {step === 1 && '1. Adım: Hizmet Seçin'}
                    {step === 2 && '2. Adım: Personel Seçin'}
                    {step === 3 && '3. Adım: Tarih ve Saat Seçin'}
                    {step === 4 && '4. Adım: Doğrulama ve Onay'}
                    {step === 5 && 'Randevunuz Alındı'}
                  </h2>
                  <p className="text-[11px] text-slate-500">{payload.page.page_title}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWizardOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 text-xs">
              {/* ADIM 1: HİZMET */}
              {step === 1 && (
                <div className="space-y-2.5">
                  {payload.services.length === 0 ? (
                    <p className="py-8 text-center text-slate-500">
                      Bu işletmede henüz online hizmet tanımlanmamış.
                    </p>
                  ) : (
                    payload.services.map((srv) => {
                      const effPrice =
                        srv.discount_price !== null && srv.discount_price < srv.price
                          ? srv.discount_price
                          : srv.price;
                      return (
                        <button
                          key={srv.id}
                          type="button"
                          onClick={() => {
                            setSelectedServiceId(srv.id);
                            setSelectedStaffId('any');
                            setSelectedTime('');
                            setStep(2);
                          }}
                          className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                            selectedServiceId === srv.id
                              ? 'border-[#0F2942] bg-slate-50'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                              <Scissors className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              <span className="truncate">{srv.name}</span>
                            </p>
                            <p className="mt-1 text-slate-500">{srv.duration_minutes} dakika</p>
                          </div>
                          <span className="font-mono text-sm font-bold text-[#0F2942] shrink-0">
                            {formatCurrencyTRY(effPrice)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              {/* ADIM 2: PERSONEL */}
              {step === 2 && (
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStaffId('any');
                      setSelectedTime('');
                      setStep(3);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border p-3.5 text-left transition-colors ${
                      selectedStaffId === 'any'
                        ? 'border-[#0F2942] bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        Fark etmez, uygun personeli seç
                      </p>
                      <p className="mt-0.5 text-slate-500">
                        Seçtiğiniz saatte müsait olan uzman otomatik atanır
                      </p>
                    </div>
                    <UserCheck className="h-4 w-4 text-emerald-700 shrink-0" />
                  </button>

                  {qualifiedStaff.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        setSelectedStaffId(st.id);
                        setSelectedTime('');
                        setStep(3);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl border p-3.5 text-left transition-colors ${
                        selectedStaffId === st.id
                          ? 'border-[#0F2942] bg-slate-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{st.full_name}</p>
                        {st.specialties && (
                          <p className="mt-0.5 text-slate-500">{st.specialties}</p>
                        )}
                      </div>
                      <span className="text-[11px] font-semibold text-[#0F2942]">Seç →</span>
                    </button>
                  ))}
                </div>
              )}

              {/* ADIM 3: TARİH & SAAT */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      Randevu Tarihi
                    </label>
                    <input
                      type="date"
                      min={todayISO}
                      max={maxDateISO}
                      value={selectedDate}
                      onChange={(e) => {
                        setSelectedDate(e.target.value);
                        setSelectedTime('');
                      }}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-mono"
                    />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-700">
                      <Clock className="h-3.5 w-3.5 text-[#0F2942]" />
                      <span>Müsait Saat Dilimleri ({formatDateTR(selectedDate)})</span>
                    </div>

                    {loadingSlots ? (
                      <div className="grid grid-cols-4 gap-2">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                          <div key={i} className="h-9 rounded-lg bg-slate-100 animate-pulse" />
                        ))}
                      </div>
                    ) : slots.length === 0 ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-amber-900">
                        Seçilen tarihte uygun randevu saati bulunmamaktadır. Lütfen başka bir tarih veya personel seçiniz.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {slots.map((sl) => (
                          <button
                            key={sl.time}
                            type="button"
                            onClick={() => {
                              setSelectedTime(sl.time);
                              setStep(4);
                            }}
                            className={`rounded-lg border py-2 font-mono text-xs font-semibold transition-colors ${
                              selectedTime === sl.time
                                ? 'border-[#0F2942] bg-[#0F2942] text-white'
                                : 'border-slate-200 bg-white text-slate-800 hover:border-[#0F2942]'
                            }`}
                          >
                            {sl.time}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ADIM 4: MÜŞTERİ GİRİŞ/KAYIT VE ONAY */}
              {step === 4 && selectedService && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Randevu Özeti
                    </p>
                    <p className="text-sm font-bold text-slate-900">{selectedService.name}</p>
                    <p className="text-slate-700">
                      Tarih &amp; Saat:{' '}
                      <strong className="font-mono">
                        {formatDateTR(selectedDate)} · {selectedTime}
                      </strong>
                    </p>
                    <p className="text-slate-700">Personel: {selectedStaffName}</p>
                    <p className="text-slate-700">
                      Tutar:{' '}
                      <strong className="font-mono text-[#0F2942]">
                        {formatCurrencyTRY(selectedService.discount_price ?? selectedService.price)}
                      </strong>{' '}
                      ({selectedService.duration_minutes} dk)
                    </p>
                  </div>

                  {!customerAcc ? (
                    <div className="rounded-xl border border-slate-200 p-4 space-y-4">
                      <div className="flex items-center gap-2 text-slate-800">
                        <Lock className="h-4 w-4 text-[#0F2942]" />
                        <p className="font-semibold">
                          Randevunuzu tamamlamak için müşteri hesabınızla devam edin
                        </p>
                      </div>

                      <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1 font-semibold">
                        <button
                          type="button"
                          onClick={() => setAuthTab('login')}
                          className={`rounded-md py-1.5 ${
                            authTab === 'login' ? 'bg-white text-[#0F2942] shadow-xs' : 'text-slate-500'
                          }`}
                        >
                          Giriş Yap
                        </button>
                        <button
                          type="button"
                          onClick={() => setAuthTab('register')}
                          className={`rounded-md py-1.5 ${
                            authTab === 'register' ? 'bg-white text-[#0F2942] shadow-xs' : 'text-slate-500'
                          }`}
                        >
                          Hızlı Üye Ol
                        </button>
                      </div>

                      {authTab === 'login' ? (
                        <form onSubmit={handleCustomerLogin} className="space-y-2.5">
                          <input
                            type="email"
                            required
                            value={loginForm.email}
                            onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                            placeholder="E-posta adresiniz"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2"
                          />
                          <input
                            type="password"
                            required
                            value={loginForm.password}
                            onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                            placeholder="Şifreniz"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2"
                          />
                          <button
                            type="submit"
                            disabled={authBusy}
                            className="w-full rounded-lg bg-[#0F2942] py-2 font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
                          >
                            {authBusy ? 'Giriş Yapılıyor...' : 'Giriş Yap ve Devam Et'}
                          </button>
                        </form>
                      ) : (
                        <form onSubmit={handleCustomerRegister} className="space-y-2.5">
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              required
                              value={registerForm.firstName}
                              onChange={(e) =>
                                setRegisterForm({ ...registerForm, firstName: e.target.value })
                              }
                              placeholder="Ad *"
                              className="rounded-lg border border-slate-300 px-3 py-2"
                            />
                            <input
                              type="text"
                              required
                              value={registerForm.lastName}
                              onChange={(e) =>
                                setRegisterForm({ ...registerForm, lastName: e.target.value })
                              }
                              placeholder="Soyad *"
                              className="rounded-lg border border-slate-300 px-3 py-2"
                            />
                          </div>
                          <input
                            type="tel"
                            required
                            value={registerForm.phone}
                            onChange={(e) =>
                              setRegisterForm({ ...registerForm, phone: e.target.value })
                            }
                            placeholder="Telefon numaranız *"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2"
                          />
                          <input
                            type="email"
                            required
                            value={registerForm.email}
                            onChange={(e) =>
                              setRegisterForm({ ...registerForm, email: e.target.value })
                            }
                            placeholder="E-posta adresiniz *"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="password"
                              required
                              minLength={6}
                              value={registerForm.password}
                              onChange={(e) =>
                                setRegisterForm({ ...registerForm, password: e.target.value })
                              }
                              placeholder="Şifre (en az 6) *"
                              className="rounded-lg border border-slate-300 px-3 py-2"
                            />
                            <input
                              type="password"
                              required
                              minLength={6}
                              value={registerForm.confirmPassword}
                              onChange={(e) =>
                                setRegisterForm({
                                  ...registerForm,
                                  confirmPassword: e.target.value,
                                })
                              }
                              placeholder="Şifre Tekrar *"
                              className="rounded-lg border border-slate-300 px-3 py-2"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={authBusy}
                            className="w-full rounded-lg bg-emerald-700 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                          >
                            {authBusy ? 'Hesap Oluşturuluyor...' : 'Ücretsiz Üye Ol ve Devam Et'}
                          </button>
                        </form>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-emerald-950">
                        Müşteri: <strong>{customerAcc.first_name} {customerAcc.last_name}</strong> ({customerAcc.phone})
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700 mb-1">
                          İşletmeye Notunuz (Opsiyonel)
                        </label>
                        <textarea
                          rows={2}
                          value={customerNotes}
                          onChange={(e) => setCustomerNotes(e.target.value)}
                          placeholder="Varsa özel isteğinizi yazabilirsiniz..."
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                      </div>

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={handleConfirmBooking}
                        style={{ backgroundColor: payload.page.primary_color }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                      >
                        <CalendarCheck className="h-4 w-4" />
                        <span>{submitting ? 'Randevu Oluşturuluyor...' : 'Randevuyu Onayla'}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ADIM 5: BAŞARI */}
              {step === 5 && confirmedAppt && (
                <div className="py-4 text-center space-y-4">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      {confirmedAppt.status === 'confirmed'
                        ? 'Randevunuz Onaylandı!'
                        : 'Randevu Talebiniz Alındı!'}
                    </h3>
                    <p className="mt-1 text-slate-600">
                      {formatDateTR(confirmedAppt.appointment_date)} ·{' '}
                      {confirmedAppt.start_time.slice(0, 5)} tarihinde{' '}
                      <strong>{confirmedAppt.service_name}</strong> ({confirmedAppt.staff_name}) için kaydınız oluşturuldu.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    <Link
                      href="/musteri"
                      className="rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E]"
                    >
                      Randevularımı Görüntüle
                    </Link>
                    <button
                      type="button"
                      onClick={() => setWizardOpen(false)}
                      className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-medium text-slate-700"
                    >
                      Sayfaya Dön
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
