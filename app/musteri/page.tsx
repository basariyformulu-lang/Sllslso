'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  CalendarCheck,
  Clock,
  ExternalLink,
  Phone,
  RefreshCw,
  Search,
  Star,
  X,
  XCircle,
} from 'lucide-react';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import { APPOINTMENT_STATUS_LABELS, formatTimeHHMM } from '@/lib/booking-helpers';
import { formatCurrencyTRY, formatDateTR, getIstanbulTodayISO } from '@/lib/format';
import type { Appointment } from '@/lib/types';

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

interface SlotMatrixItem {
  time: string;
  available: boolean;
  reason?: 'available' | 'booked' | 'past' | 'break' | 'off';
  availableStaffIds: string[];
}

export default function CustomerPhoneLookupPage() {
  const { showToast } = useToast();
  const todayISO = getIstanbulTodayISO();

  const [phoneInput, setPhoneInput] = useState('');
  const [activePhone, setActivePhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [appointments, setAppointments] = useState<CustomerAppointmentItem[]>([]);
  const [tab, setTab] = useState<'upcoming' | 'past' | 'businesses'>('upcoming');

  // İptal / Saat Değiştir / Değerlendirme Modalları
  const [cancelTarget, setCancelTarget] = useState<CustomerAppointmentItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [rescheduleTarget, setRescheduleTarget] = useState<CustomerAppointmentItem | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(todayISO);
  const [rescheduleMatrix, setRescheduleMatrix] = useState<SlotMatrixItem[]>([]);
  const [rescheduleTime, setRescheduleTime] = useState('');

  const [reviewTarget, setReviewTarget] = useState<CustomerAppointmentItem | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  const lookupByPhone = useCallback(
    async (targetPhone: string) => {
      const clean = targetPhone.trim();
      if (!clean) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/customer/appointments?phone=${encodeURIComponent(clean)}`,
          { cache: 'no-store' }
        );
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || 'Randevular sorgulanamadı', 'error');
          return;
        }
        setActivePhone(clean);
        setAppointments(json.appointments ?? []);
        setHasSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [showToast]
  );

  // URL'de ?phone=... varsa otomatik sorgula
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || typeof window === 'undefined') return;
      const qp = new URLSearchParams(window.location.search).get('phone');
      if (qp && qp.trim().length >= 10) {
        setPhoneInput(qp.trim());
        void lookupByPhone(qp.trim());
      }
    });
    return () => {
      active = false;
    };
  }, [lookupByPhone]);

  // Saat değişikliği için 30 dk Yeşil/Kırmızı matrisi çek
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
        if (Array.isArray(json.slotMatrix)) {
          setRescheduleMatrix(json.slotMatrix);
        } else {
          setRescheduleMatrix(
            ((json.slots ?? []) as Array<{ time: string; availableStaffIds: string[] }>).map((s) => ({
              time: s.time,
              available: true,
              reason: 'available',
              availableStaffIds: s.availableStaffIds ?? [],
            }))
          );
        }
      }
    });
    return () => {
      active = false;
    };
  }, [rescheduleTarget, rescheduleDate]);

  async function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    await lookupByPhone(phoneInput);
  }

  async function handleCancelSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelTarget || !activePhone) return;
    setBusyAction(true);
    try {
      const res = await fetch('/api/customer/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          phone: activePhone,
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
      await lookupByPhone(activePhone);
    } finally {
      setBusyAction(false);
    }
  }

  async function handleRescheduleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rescheduleTarget || !rescheduleTime || !activePhone) return;
    setBusyAction(true);
    try {
      const res = await fetch('/api/customer/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reschedule',
          phone: activePhone,
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
      await lookupByPhone(activePhone);
    } finally {
      setBusyAction(false);
    }
  }

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewTarget || !activePhone) return;
    setBusyAction(true);
    try {
      const res = await fetch('/api/customer/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'review',
          phone: activePhone,
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
      showToast('Değerlendirmeniz yayınlandı, teşekkürler!', 'success');
      setReviewTarget(null);
      setReviewComment('');
      setReviewRating(5);
      await lookupByPhone(activePhone);
    } finally {
      setBusyAction(false);
    }
  }

  const upcomingAppointments = useMemo(
    () =>
      appointments.filter(
        (a) => ['pending', 'confirmed'].includes(a.status) && a.appointment_date >= todayISO
      ),
    [appointments, todayISO]
  );

  const pastAppointments = useMemo(
    () =>
      appointments.filter(
        (a) => !['pending', 'confirmed'].includes(a.status) || a.appointment_date < todayISO
      ),
    [appointments, todayISO]
  );

  const visitedBusinesses = useMemo(() => {
    const map = new Map<
      string,
      { businessId: string; name: string; slug: string | null; address: string; count: number }
    >();
    appointments.forEach((a) => {
      if (!a.business) return;
      const existing = map.get(a.business.id);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(a.business.id, {
          businessId: a.business.id,
          name: a.business.name,
          slug: a.business.booking_slug ?? null,
          address: a.business.address ?? '',
          count: 1,
        });
      }
    });
    return Array.from(map.values());
  }, [appointments]);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <header className="border-b border-slate-200 bg-white px-4 py-3.5 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="min-w-0">
            <Link href="/" className="text-lg font-bold text-[#0F2942] font-display">
              EsnafTakip Randevu
            </Link>
            <p className="text-xs text-slate-500">
              Üyelik gerekmeden cep telefonu numaranızla randevularınızı sorgulayın
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Ana Sayfa
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-7 sm:px-6 space-y-6">
        {/* Telefon ile Sorgulama Kutusu */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="max-w-xl">
            <h1 className="text-lg font-bold text-slate-900 font-display">
              Telefon Numarası ile Randevu Sorgula
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Randevu alırken girdiğiniz cep telefonu numarasını yazarak yaklaşan ve geçmiş randevularınızı görebilir, saat değişikliği/iptal yapabilir veya tamamlanan randevularınızı puanlayabilirsiniz.
            </p>
            <form onSubmit={handleSearchSubmit} className="mt-4 flex flex-wrap gap-2.5">
              <div className="relative flex-1 min-w-[220px]">
                <Phone className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="tel"
                  required
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="05XX XXX XX XX"
                  className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 font-mono text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0F2942] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
              >
                <Search className="h-3.5 w-3.5" />
                <span>{loading ? 'Sorgulanıyor...' : 'Randevularımı Getir'}</span>
              </button>
            </form>
          </div>
        </section>

        {hasSearched && (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 w-fit text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab('upcoming')}
                className={`rounded-lg px-4 py-2 ${
                  tab === 'upcoming'
                    ? 'bg-[#0F2942] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Yaklaşan Randevular ({upcomingAppointments.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('past')}
                className={`rounded-lg px-4 py-2 ${
                  tab === 'past'
                    ? 'bg-[#0F2942] text-white'
                    : 'text-slate-600 hover:text-slate-900'
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
                İşletmeler ({visitedBusinesses.length})
              </button>
            </div>

            {tab === 'upcoming' && (
              <div className="space-y-3">
                {upcomingAppointments.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
                    {activePhone} numarasına ait yaklaşan aktif randevu bulunamadı.
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
                              {formatDateTR(appt.appointment_date)} ·{' '}
                              {formatTimeHHMM(appt.start_time)} - {formatTimeHHMM(appt.end_time)}
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

            {tab === 'past' && (
              <div className="space-y-3">
                {pastAppointments.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
                    Geçmiş randevu kaydı bulunamadı.
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
                              {formatDateTR(appt.appointment_date)} ·{' '}
                              {formatTimeHHMM(appt.start_time)} ·{' '}
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

            {tab === 'businesses' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {visitedBusinesses.length === 0 ? (
                  <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
                    Randevu aldığınız işletme kaydı bulunamadı.
                  </div>
                ) : (
                  visitedBusinesses.map((b) => (
                    <div
                      key={b.businessId}
                      className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-[#0F2942] shrink-0" />
                          <h3 className="truncate text-sm font-bold text-slate-900">{b.name}</h3>
                        </div>
                        {b.address && (
                          <p className="mt-1 truncate text-xs text-slate-500">{b.address}</p>
                        )}
                        <p className="mt-1 text-[11px] text-slate-500">{b.count} randevu kaydı</p>
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
          </>
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

      {/* Saat Değiştir Modalı (Yeşil/Kırmızı 30dk Matris) */}
      {rescheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
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
                <div className="mb-2 flex items-center justify-between">
                  <label className="font-medium text-slate-700">Saat Dilimleri</label>
                  <span className="text-[11px] text-slate-500">Yeşil: Müsait · Kırmızı: Dolu</span>
                </div>
                {rescheduleMatrix.length === 0 ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    Seçilen tarihte çalışma saati bulunamadı.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto sm:grid-cols-4">
                    {rescheduleMatrix.map((sl) => {
                      const isSel = rescheduleTime === sl.time && sl.available;
                      return (
                        <button
                          key={sl.time}
                          type="button"
                          disabled={!sl.available}
                          onClick={() => sl.available && setRescheduleTime(sl.time)}
                          className={`rounded-lg border py-2 font-mono text-xs font-semibold ${
                            !sl.available
                              ? 'border-red-300 bg-red-50 text-red-700 cursor-not-allowed opacity-85'
                              : isSel
                              ? 'border-emerald-700 bg-emerald-700 text-white'
                              : 'border-emerald-500 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                          }`}
                        >
                          {sl.time}
                        </button>
                      );
                    })}
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
                  minLength={3}
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
