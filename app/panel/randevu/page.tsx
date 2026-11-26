'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarCheck,
  CalendarDays,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Palette,
  Scissors,
  SlidersHorizontal,
  Star,
  TrendingUp,
  UserCheck,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { PanelShell } from '@/components/PanelShell';
import { BookingReadOnlyBanner } from '@/components/BookingReadOnlyBanner';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import {
  APPOINTMENT_PAYMENT_LABELS,
  APPOINTMENT_STATUS_LABELS,
  BOOKING_PAGE_STATUS_LABELS,
  formatTimeHHMM,
} from '@/lib/booking-helpers';
import { formatCurrencyTRY, formatDateTR } from '@/lib/format';
import type { Appointment, BookingPage } from '@/lib/types';

interface OverviewResponse {
  readOnly: boolean;
  moduleEnabled: boolean;
  suggestedSlug: string;
  page: BookingPage | null;
  metrics: {
    todayCount: number;
    pendingCount: number;
    monthCount: number;
    completedThisMonth: number;
    monthRevenue: number;
    activeServices: number;
    activeStaff: number;
    totalCustomers: number;
    averageRating: number;
    reviewCount: number;
  };
  todayAppointments: Appointment[];
  upcomingPending: Appointment[];
}

export default function BookingOverviewPage() {
  const { showToast } = useToast();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/booking/overview', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  async function handleQuickStatus(id: string, status: 'confirmed' | 'cancelled') {
    setBusyId(id);
    try {
      const res = await fetch('/api/panel/booking/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_status',
          id,
          status,
          cancellationReason: status === 'cancelled' ? 'İşletme tarafından iptal edildi' : '',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'İşlem başarısız', 'error');
        return;
      }
      showToast(
        status === 'confirmed' ? 'Randevu onaylandı' : 'Randevu iptal edildi',
        'success'
      );
      await loadData();
    } finally {
      setBusyId(null);
    }
  }

  function handleCopyLink(slug: string) {
    const fullUrl = `${window.location.origin}/r/${slug}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      showToast('Randevu bağlantısı kopyalandı', 'success');
      setTimeout(() => setCopied(false), 2500);
    });
  }

  const slug = data?.page?.slug || data?.suggestedSlug || 'isletme';
  const pageStatus = data?.page
    ? BOOKING_PAGE_STATUS_LABELS[data.page.status] ?? { label: 'Taslak', tone: 'neutral' as const }
    : { label: 'Henüz Oluşturulmadı', tone: 'neutral' as const };

  return (
    <PanelShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-display">
              Online Randevu Genel Bakış
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Randevu takviminizi, aktif sayfa durumunuzu ve aylık performansınızı tek ekrandan takip edin.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/panel/randevu/takvim"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F2942] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173B5E]"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Randevu Takvimi</span>
            </Link>
            <Link
              href="/panel/randevu/tasarim"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Palette className="h-3.5 w-3.5" />
              <span>Sayfa Tasarımı</span>
            </Link>
          </div>
        </div>

        <BookingReadOnlyBanner visible={data?.readOnly} />

        {/* Sayfa Bağlantısı Kartı */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Müşteri Randevu Bağlantınız
                </span>
                <StatusText label={pageStatus.label} tone={pageStatus.tone} />
              </div>
              <p className="font-mono text-sm font-semibold text-[#0F2942]">/r/{slug}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopyLink(slug)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Kopyalandı' : 'Bağlantıyı Kopyala'}</span>
              </button>
              <Link
                href={`/r/${slug}`}
                target="_blank"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Sayfayı Görüntüle</span>
              </Link>
              <Link
                href="/panel/randevu/ayarlar"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Yayın &amp; Ayarlar</span>
              </Link>
            </div>
          </div>
        </div>

        {loading || !data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 rounded-xl bg-slate-200 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* KPI Kartları */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Bugünkü Randevular</span>
                  <CalendarCheck className="h-4 w-4 text-[#0F2942]" />
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900 font-mono">
                  {data.metrics.todayCount}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Bekleyen onay: {data.metrics.pendingCount}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Bu Ay Randevu</span>
                  <CalendarDays className="h-4 w-4 text-emerald-700" />
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900 font-mono">
                  {data.metrics.monthCount}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Tamamlanan: {data.metrics.completedThisMonth}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Aylık Randevu Tahsilatı</span>
                  <TrendingUp className="h-4 w-4 text-emerald-700" />
                </div>
                <p className="mt-2 text-2xl font-bold text-emerald-700 font-mono">
                  {formatCurrencyTRY(data.metrics.monthRevenue)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Gelirler modülüne otomatik işlenir
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Hizmet / Personel / Puan</span>
                  <Star className="h-4 w-4 text-amber-500" />
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900 font-mono">
                  {data.metrics.averageRating > 0 ? `${data.metrics.averageRating} / 5` : '—'}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {data.metrics.activeServices} hizmet · {data.metrics.activeStaff} personel ·{' '}
                  {data.metrics.reviewCount} yorum
                </p>
              </div>
            </div>

            {/* Hızlı Kurulum / Yönetim Bağlantıları */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Link
                href="/panel/randevu/hizmetler"
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-[#0F2942]">
                  <Scissors className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Hizmetler ve Fiyatlar</p>
                  <p className="text-xs text-slate-500">
                    {data.metrics.activeServices} aktif hizmet tanımlı
                  </p>
                </div>
              </Link>

              <Link
                href="/panel/randevu/personel"
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-emerald-700">
                  <UserCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Personel Yönetimi</p>
                  <p className="text-xs text-slate-500">
                    {data.metrics.activeStaff} aktif uzman · mola &amp; izinler
                  </p>
                </div>
              </Link>

              <Link
                href="/panel/randevu/calisma-saatleri"
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-amber-700">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Çalışma Saatleri</p>
                  <p className="text-xs text-slate-500">
                    Slot aralıkları ve kapalı günler
                  </p>
                </div>
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Bugünkü Randevular */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">Bugünkü Randevular</h2>
                  <Link
                    href="/panel/randevu/takvim"
                    className="text-xs font-medium text-[#0F2942] hover:underline"
                  >
                    Takvime Git →
                  </Link>
                </div>

                {data.todayAppointments.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500">
                    Bugün için kayıtlı randevu bulunmuyor.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {data.todayAppointments.map((appt) => {
                      const st = APPOINTMENT_STATUS_LABELS[appt.status] ?? {
                        label: appt.status,
                        tone: 'neutral' as const,
                      };
                      const pay = APPOINTMENT_PAYMENT_LABELS[appt.payment_status] ?? {
                        label: appt.payment_status,
                        tone: 'neutral' as const,
                      };
                      return (
                        <div key={appt.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">
                              {formatTimeHHMM(appt.start_time)} - {appt.service_name_snapshot}
                            </p>
                            <p className="text-xs text-slate-500 truncate">
                              {appt.customer
                                ? `${appt.customer.first_name} ${appt.customer.last_name}`.trim()
                                : 'Müşteri'}{' '}
                              · {appt.staff_name_snapshot}
                            </p>
                          </div>
                          <div className="text-right shrink-0 space-y-0.5">
                            <StatusText label={st.label} tone={st.tone} />
                            <p className="text-[11px] text-slate-500">{pay.label}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Onay Bekleyenler */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">
                    Onay Bekleyen Randevu Talepleri
                  </h2>
                  <span className="text-xs text-slate-500">
                    {data.upcomingPending.length} talep
                  </span>
                </div>

                {data.upcomingPending.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500">
                    Onay bekleyen yeni randevu talebi bulunmuyor.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {data.upcomingPending.map((appt) => (
                      <div key={appt.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">
                            {formatDateTR(appt.appointment_date)} · {formatTimeHHMM(appt.start_time)}
                          </p>
                          <p className="text-xs text-slate-600">
                            {appt.service_name_snapshot} · {appt.staff_name_snapshot}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {appt.customer
                              ? `${appt.customer.first_name} ${appt.customer.last_name} (${appt.customer.phone})`
                              : ''}
                          </p>
                        </div>

                        {!data.readOnly && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={busyId === appt.id}
                              onClick={() => handleQuickStatus(appt.id, 'confirmed')}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Onayla</span>
                            </button>
                            <button
                              type="button"
                              disabled={busyId === appt.id}
                              onClick={() => handleQuickStatus(appt.id, 'cancelled')}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              <span>Reddet</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </PanelShell>
  );
}
