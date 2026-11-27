'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Phone,
  Scissors,
  Star,
  UserCheck,
  X,
} from 'lucide-react';
import {
  BookingStorefrontRenderer,
  type StorefrontRatingSummary,
  type StorefrontReview,
} from '@/components/BookingStorefrontRenderer';
import { useToast } from '@/components/ToastProvider';
import { formatCurrencyTRY, formatDateTR, getIstanbulTodayISO } from '@/lib/format';
import type { BookingPage, BookingService, BookingStaff } from '@/lib/types';

interface PublicBookingPayload {
  page: BookingPage;
  isBookingOpen: boolean;
  closedReason: string | null;
  services: BookingService[];
  staff: BookingStaff[];
  reviews: StorefrontReview[];
  ratingSummary?: StorefrontRatingSummary;
}

interface SlotMatrixItem {
  time: string;
  endTime?: string;
  available: boolean;
  reason?: 'available' | 'booked' | 'past' | 'break' | 'off';
  availableStaffIds: string[];
  recommendedStaffId?: string | null;
}

interface EligibleReviewAppointment {
  id: string;
  service_name_snapshot: string;
  staff_name_snapshot: string;
  appointment_date: string;
  start_time: string;
  customer_name: string;
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

  // Randevu Sihirbazı Durumu (Hesapsız / Sadece Ad Soyad + Telefon)
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('any');
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [selectedTime, setSelectedTime] = useState('');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');

  const [slotMatrix, setSlotMatrix] = useState<SlotMatrixItem[]>([]);
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

  // Telefon Doğrulamalı Puan & Yorum Modalı
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewPhone, setReviewPhone] = useState('');
  const [reviewChecking, setReviewChecking] = useState(false);
  const [reviewCheckDone, setReviewCheckDone] = useState(false);
  const [eligibleAppts, setEligibleAppts] = useState<EligibleReviewAppointment[]>([]);
  const [reviewCheckMessage, setReviewCheckMessage] = useState('');
  const [selectedReviewApptId, setSelectedReviewApptId] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const loadStorefront = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const pubRes = await fetch(`/api/public/booking/${encodeURIComponent(slug)}`, {
        cache: 'no-store',
      });
      if (!pubRes.ok) {
        setNotFoundErr(true);
        return;
      }
      const pubJson = (await pubRes.json()) as PublicBookingPayload;
      setPayload(pubJson);
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

  // Tarih/Hizmet/Personel değiştikçe 30 dk Yeşil/Kırmızı slot matrisini getir
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
          if (Array.isArray(json.slotMatrix)) {
            setSlotMatrix(json.slotMatrix);
          } else {
            const fallback = ((json.slots ?? []) as Array<{ time: string; availableStaffIds: string[] }>).map(
              (s) => ({
                time: s.time,
                available: true,
                reason: 'available' as const,
                availableStaffIds: s.availableStaffIds ?? [],
              })
            );
            setSlotMatrix(fallback);
          }
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

  function openReviewModal() {
    setReviewPhone(phone || '');
    setReviewCheckDone(false);
    setEligibleAppts([]);
    setReviewCheckMessage('');
    setSelectedReviewApptId('');
    setReviewRating(5);
    setReviewComment('');
    setReviewModalOpen(true);
  }

  async function handleConfirmBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !phone.trim()) {
      showToast('Lütfen ad soyad ve cep telefonu numaranızı giriniz.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/booking/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          serviceId: selectedServiceId,
          staffId: selectedStaffId,
          appointmentDate: selectedDate,
          startTime: selectedTime,
          customerNotes: customerNotes.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Randevu oluşturulamadı', 'error');
        return;
      }
      setConfirmedAppt(json.appointment);
      setStep(5);
      showToast('Randevunuz başarıyla oluşturuldu!', 'success');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyPhoneForReview(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewPhone.trim()) return;
    setReviewChecking(true);
    setReviewCheckMessage('');
    try {
      const res = await fetch(
        `/api/public/booking/${encodeURIComponent(slug)}/reviews?phone=${encodeURIComponent(
          reviewPhone.trim()
        )}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      setReviewCheckDone(true);
      if (!res.ok) {
        setEligibleAppts([]);
        setReviewCheckMessage(json.error || 'Telefon doğrulanamadı.');
        return;
      }
      const list = (json.eligibleAppointments ?? []) as EligibleReviewAppointment[];
      setEligibleAppts(list);
      if (list.length > 0) {
        setSelectedReviewApptId(list[0].id);
      } else if (!json.hasAnyAppointment) {
        setReviewCheckMessage(
          'Bu telefon numarası ile işletmemizde tamamlanmış bir randevu kaydı bulunamadı.'
        );
      } else if (json.latestAppointmentStatus === 'completed') {
        setReviewCheckMessage('Tamamlanmış randevularınız için zaten değerlendirme yaptınız.');
      } else {
        setReviewCheckMessage(
          'Randevunuz işletme tarafından "Tamamlandı" olarak işaretlendikten sonra puanlama ve yorum yapabilirsiniz.'
        );
      }
    } finally {
      setReviewChecking(false);
    }
  }

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedReviewApptId || !reviewComment.trim()) return;
    setReviewSubmitting(true);
    try {
      const res = await fetch(`/api/public/booking/${encodeURIComponent(slug)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: reviewPhone.trim(),
          appointmentId: selectedReviewApptId,
          rating: reviewRating,
          comment: reviewComment.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Değerlendirme gönderilemedi', 'error');
        return;
      }
      showToast('Değerlendirmeniz yayınlandı, teşekkür ederiz!', 'success');
      setReviewModalOpen(false);
      await loadStorefront();
    } finally {
      setReviewSubmitting(false);
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
        ratingSummary={payload.ratingSummary}
        isBookingOpen={payload.isBookingOpen}
        closedReason={payload.closedReason}
        onStartBooking={openBookingWizard}
        onOpenReviewModal={openReviewModal}
      />

      {/* Adım Adım Telefon ile Hızlı Randevu Sihirbazı */}
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
                    {step === 4 && '4. Adım: İletişim Bilgileri ve Onay'}
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

              {/* ADIM 3: 30 DK YEŞİL / KIRMIZI SAAT KUTUCUKLARI */}
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
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                        <Clock className="h-3.5 w-3.5 text-[#0F2942]" />
                        <span>Saat Seçimi ({formatDateTR(selectedDate)})</span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] font-medium">
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <span className="h-2.5 w-2.5 rounded-xs bg-emerald-500" />
                          Müsait
                        </span>
                        <span className="inline-flex items-center gap-1 text-red-700">
                          <span className="h-2.5 w-2.5 rounded-xs bg-red-500" />
                          Dolu / Kapalı
                        </span>
                      </div>
                    </div>

                    {loadingSlots ? (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                          <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
                        ))}
                      </div>
                    ) : slotMatrix.length === 0 ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-amber-900">
                        Seçilen tarihte işletme kapalı veya uygun çalışma saati tanımlanmamış. Lütfen başka bir tarih seçiniz.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                        {slotMatrix.map((sl) => {
                          const isSelected = selectedTime === sl.time && sl.available;
                          const unavailableLabel =
                            sl.reason === 'past'
                              ? 'Geçti'
                              : sl.reason === 'break'
                              ? 'Mola'
                              : sl.reason === 'off'
                              ? 'Kapalı'
                              : 'Dolu';

                          return (
                            <button
                              key={sl.time}
                              type="button"
                              disabled={!sl.available}
                              onClick={() => {
                                if (!sl.available) return;
                                setSelectedTime(sl.time);
                                setStep(4);
                              }}
                              className={`flex flex-col items-center justify-center rounded-xl border py-2.5 px-2 transition-all ${
                                !sl.available
                                  ? 'border-red-300 bg-red-50 text-red-700 cursor-not-allowed opacity-90'
                                  : isSelected
                                  ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm'
                                  : 'border-emerald-500 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                              }`}
                            >
                              <span className="font-mono text-sm font-bold">{sl.time}</span>
                              <span
                                className={`mt-0.5 text-[10px] font-semibold ${
                                  !sl.available
                                    ? 'text-red-600'
                                    : isSelected
                                    ? 'text-emerald-100'
                                    : 'text-emerald-700'
                                }`}
                              >
                                {sl.available ? 'Müsait' : unavailableLabel}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ADIM 4: SADECE AD SOYAD + CEP TELEFONU + ONAY (HESAPSIZ) */}
              {step === 4 && selectedService && (
                <form onSubmit={handleConfirmBooking} className="space-y-4">
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

                  <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Phone className="h-4 w-4 text-emerald-700" />
                      <p className="font-semibold">
                        Randevuyu tamamlamak için iletişim bilgilerinizi girin
                      </p>
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Ad Soyad *</label>
                      <input
                        type="text"
                        required
                        minLength={2}
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Örn: Ahmet Yılmaz"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Cep Telefonu Numaranız *
                      </label>
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="05XX XXX XX XX"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Kayıt veya şifre gerekmez. Randevu sorgulama ve işlem sonrası puanlama bu numara ile yapılır.
                      </p>
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
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    style={{ backgroundColor: payload.page.primary_color }}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                  >
                    <CalendarCheck className="h-4 w-4" />
                    <span>{submitting ? 'Randevu Oluşturuluyor...' : 'Randevuyu Onayla'}</span>
                  </button>
                </form>
              )}

              {/* ADIM 5: BAŞARI */}
              {step === 5 && confirmedAppt && (
                <div className="py-4 text-center space-y-4">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      {confirmedAppt.status === 'confirmed'
                        ? 'Randevunuz Onaylandı!'
                        : 'Randevunuz Alındı!'}
                    </h3>
                    <p className="mt-1 text-slate-600">
                      {formatDateTR(confirmedAppt.appointment_date)} ·{' '}
                      {confirmedAppt.start_time.slice(0, 5)} tarihinde{' '}
                      <strong>{confirmedAppt.service_name}</strong> ({confirmedAppt.staff_name}) için kaydınız oluşturuldu.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    <Link
                      href={`/musteri?phone=${encodeURIComponent(phone.trim())}`}
                      className="rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E]"
                    >
                      Telefon ile Randevumu Sorgula
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

      {/* Telefon Doğrulamalı Puanlama ve Yorum Modalı */}
      {reviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Hizmeti Değerlendirin</h3>
                <p className="text-[11px] text-slate-500">
                  Yalnızca randevusunu tamamlamış müşteriler puanlama yapabilir
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleVerifyPhoneForReview} className="mt-4 space-y-3 text-xs">
              <label className="block font-medium text-slate-700">
                Randevu Aldığınız Cep Telefonu *
              </label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  required
                  value={reviewPhone}
                  onChange={(e) => {
                    setReviewPhone(e.target.value);
                    setReviewCheckDone(false);
                    setEligibleAppts([]);
                    setReviewCheckMessage('');
                  }}
                  placeholder="05XX XXX XX XX"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                />
                <button
                  type="submit"
                  disabled={reviewChecking}
                  className="rounded-lg bg-[#0F2942] px-4 py-2 font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
                >
                  {reviewChecking ? 'Kontrol...' : 'Doğrula'}
                </button>
              </div>
            </form>

            {reviewCheckDone && reviewCheckMessage && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950">
                {reviewCheckMessage}
              </div>
            )}

            {eligibleAppts.length > 0 && (
              <form onSubmit={handleSubmitReview} className="mt-4 space-y-4 border-t border-slate-200 pt-4 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Değerlendirilecek Tamamlanmış Randevu
                  </label>
                  <select
                    value={selectedReviewApptId}
                    onChange={(e) => setSelectedReviewApptId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    {eligibleAppts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {formatDateTR(a.appointment_date)} {a.start_time} · {a.service_name_snapshot} ({a.staff_name_snapshot})
                      </option>
                    ))}
                  </select>
                </div>

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
                          className={`h-7 w-7 ${
                            s <= reviewRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Yorumunuz *</label>
                  <textarea
                    rows={3}
                    required
                    minLength={3}
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Hizmet deneyiminizi paylaşın..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReviewModalOpen(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-700"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    disabled={reviewSubmitting}
                    className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {reviewSubmitting ? 'Gönderiliyor...' : 'Yorumu Yayınla'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
