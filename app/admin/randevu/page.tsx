'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  ExternalLink,
  Eye,
  EyeOff,
  Save,
  Search,
  Sliders,
  Star,
} from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import { BOOKING_PAGE_STATUS_LABELS } from '@/lib/booking-helpers';
import { formatDateTR } from '@/lib/format';
import type { BookingPage } from '@/lib/types';

interface AdminBusinessRow {
  id: string;
  name: string;
  business_code: string;
  subscription_status: string;
  is_active: boolean;
  booking_module_enabled: boolean;
  booking_module_mode: 'included' | 'addon_active' | 'addon_locked';
  page: BookingPage | null;
  totalAppointments: number;
  completedAppointments: number;
  reviewCount: number;
  averageRating: number;
}

interface AdminReviewRow {
  id: string;
  rating: number;
  comment: string;
  moderation_status: 'published' | 'reported' | 'hidden';
  report_reason: string | null;
  moderation_note: string | null;
  created_at: string;
  business_name: string;
  service_name: string;
  staff_name: string;
  customer_name: string;
}

export default function AdminBookingModulePage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'businesses' | 'reviews'>('businesses');
  const [search, setSearch] = useState('');
  const [reviewFilter, setReviewFilter] = useState<'all' | 'reported' | 'hidden'>('all');

  const [businesses, setBusinesses] = useState<AdminBusinessRow[]>([]);
  const [reviews, setReviews] = useState<AdminReviewRow[]>([]);
  const [globalSettings, setGlobalSettings] = useState({
    defaultIncluded: true,
    addonPrice: 0,
  });
  const [savingGlobal, setSavingGlobal] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/booking', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setBusinesses(json.businesses ?? []);
        setReviews(json.reviews ?? []);
        if (json.globalSettings) setGlobalSettings(json.globalSettings);
      }
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

  async function handleSaveGlobal(e: React.FormEvent) {
    e.preventDefault();
    setSavingGlobal(true);
    try {
      const res = await fetch('/api/admin/booking', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_global_settings',
          defaultIncluded: globalSettings.defaultIncluded,
          addonPrice: Number(globalSettings.addonPrice),
        }),
      });
      if (!res.ok) {
        showToast('Ayarlar güncellenemedi', 'error');
        return;
      }
      showToast('Global randevu modülü ayarları güncellendi', 'success');
    } finally {
      setSavingGlobal(false);
    }
  }

  async function handleModuleModeChange(
    businessId: string,
    mode: 'included' | 'addon_active' | 'addon_locked'
  ) {
    const res = await fetch('/api/admin/booking', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'toggle_business_module',
        businessId,
        bookingModuleEnabled: mode !== 'addon_locked',
        bookingModuleMode: mode,
      }),
    });
    if (!res.ok) {
      showToast('Modül durumu güncellenemedi', 'error');
      return;
    }
    showToast('İşletme randevu modülü erişimi güncellendi', 'success');
    await loadData();
  }

  async function handlePageStatusChange(
    businessId: string,
    status: 'published' | 'paused' | 'draft'
  ) {
    const res = await fetch('/api/admin/booking', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'toggle_page_status',
        businessId,
        status,
      }),
    });
    if (!res.ok) {
      showToast('Sayfa durumu değiştirilemedi', 'error');
      return;
    }
    showToast('Randevu sayfası durumu güncellendi', 'success');
    await loadData();
  }

  async function handleModerateReview(reviewId: string, status: 'published' | 'hidden') {
    const res = await fetch('/api/admin/booking', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'moderate_review',
        reviewId,
        moderationStatus: status,
        moderationNote:
          status === 'hidden'
            ? 'Platform yöneticisi tarafından yayından gizlendi.'
            : 'Platform yöneticisi tarafından yayında tutuldu.',
      }),
    });
    if (!res.ok) {
      showToast('Moderasyon işlemi başarısız', 'error');
      return;
    }
    showToast(status === 'hidden' ? 'Yorum gizlendi' : 'Yorum yayında tutuluyor', 'success');
    await loadData();
  }

  const filteredBusinesses = businesses.filter((b) =>
    `${b.name} ${b.business_code} ${b.page?.slug ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const filteredReviews = reviews.filter((r) => {
    if (reviewFilter === 'reported' && r.moderation_status !== 'reported') return false;
    if (reviewFilter === 'hidden' && r.moderation_status !== 'hidden') return false;
    return true;
  });

  const reportedBadgeCount = reviews.filter((r) => r.moderation_status === 'reported').length;

  return (
    <AdminShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 font-display">
            Online Randevu Modülü Yönetimi
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            İşletmelerin online randevu sayfalarını, modül abonelik erişimlerini ve bildirilen müşteri yorumlarını yönetin.
          </p>
        </div>

        {/* Global Modül Ayarları */}
        <form
          onSubmit={handleSaveGlobal}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-wrap items-end justify-between gap-4 text-xs"
        >
          <div className="space-y-3 flex-1 min-w-[260px]">
            <div className="flex items-center gap-2 font-bold text-slate-900">
              <Sliders className="h-4 w-4 text-[#0F2942]" />
              <span>Yeni İşletmeler İçin Varsayılan Modül Politikası</span>
            </div>
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={globalSettings.defaultIncluded}
                onChange={(e) =>
                  setGlobalSettings({ ...globalSettings, defaultIncluded: e.target.checked })
                }
                className="rounded border-slate-300"
              />
              <span>Yeni kayıt olan işletmelere Online Randevu modülü varsayılan olarak açık gelsin</span>
            </label>
          </div>

          <div className="flex items-end gap-3">
            <div>
              <label className="block font-medium text-slate-700">Ek Modül Referans Fiyatı (TL/Ay)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={globalSettings.addonPrice}
                onChange={(e) =>
                  setGlobalSettings({ ...globalSettings, addonPrice: Number(e.target.value) })
                }
                className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={savingGlobal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F2942] px-4 py-2 font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{savingGlobal ? 'Kaydediliyor...' : 'Kaydet'}</span>
            </button>
          </div>
        </form>

        {/* Sekmeler */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTab('businesses')}
              className={`rounded-lg px-4 py-2 ${
                tab === 'businesses' ? 'bg-[#0F2942] text-white' : 'text-slate-600'
              }`}
            >
              İşletmeler ({businesses.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('reviews')}
              className={`rounded-lg px-4 py-2 ${
                tab === 'reviews' ? 'bg-[#0F2942] text-white' : 'text-slate-600'
              }`}
            >
              Yorum Moderasyonu ({reportedBadgeCount} bildirilen)
            </button>
          </div>

          {tab === 'businesses' ? (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="İşletme adı, kodu veya slug ara..."
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs">
              {(
                [
                  ['all', 'Tümü'],
                  ['reported', 'Bildirilenler'],
                  ['hidden', 'Gizlenenler'],
                ] as const
              ).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setReviewFilter(val)}
                  className={`rounded-md px-3 py-1 font-medium ${
                    reviewFilter === val ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="h-64 rounded-xl bg-slate-200 animate-pulse" />
        ) : tab === 'businesses' ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">İşletme</th>
                  <th className="px-4 py-3 font-semibold">Randevu Sayfası</th>
                  <th className="px-4 py-3 font-semibold">Sayfa Durumu</th>
                  <th className="px-4 py-3 font-semibold">Randevu / Puan</th>
                  <th className="px-4 py-3 font-semibold">Modül Erişimi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBusinesses.map((b) => {
                  const pageMeta = b.page
                    ? BOOKING_PAGE_STATUS_LABELS[b.page.status] ?? {
                        label: b.page.status,
                        tone: 'neutral' as const,
                      }
                    : null;
                  return (
                    <tr key={b.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                          <div>
                            <p className="font-semibold text-slate-900">{b.name}</p>
                            <p className="font-mono text-[11px] text-slate-500">{b.business_code}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        {b.page ? (
                          <Link
                            href={`/r/${b.page.slug}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 font-mono font-medium text-[#0F2942] hover:underline"
                          >
                            <span>/r/{b.page.slug}</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-slate-400">Oluşturulmadı</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {b.page ? (
                          <div className="flex items-center gap-2">
                            {pageMeta && <StatusText label={pageMeta.label} tone={pageMeta.tone} />}
                            <select
                              value={b.page.status}
                              onChange={(e) =>
                                handlePageStatusChange(
                                  b.id,
                                  e.target.value as 'published' | 'paused' | 'draft'
                                )
                              }
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                            >
                              <option value="published">Yayında</option>
                              <option value="paused">Geçici Kapalı</option>
                              <option value="draft">Taslak</option>
                            </select>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>

                      <td className="px-4 py-3 font-mono text-slate-700">
                        {b.totalAppointments} randevu ({b.completedAppointments} tamamlandı) ·{' '}
                        {b.averageRating > 0 ? `${b.averageRating}★` : '—'}
                      </td>

                      <td className="px-4 py-3">
                        <select
                          value={b.booking_module_mode ?? 'included'}
                          onChange={(e) =>
                            handleModuleModeChange(
                              b.id,
                              e.target.value as 'included' | 'addon_active' | 'addon_locked'
                            )
                          }
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                            b.booking_module_mode === 'addon_locked'
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          }`}
                        >
                          <option value="included">Pakete Dahil (Aktif)</option>
                          <option value="addon_active">Ek Modül (Aktif)</option>
                          <option value="addon_locked">Kilitli (Salt Okunur)</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReviews.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
                Seçilen filtrede müşteri yorumu bulunmuyor.
              </div>
            ) : (
              filteredReviews.map((rev) => {
                const modMeta =
                  rev.moderation_status === 'hidden'
                    ? { label: 'Gizlendi', tone: 'neutral' as const }
                    : rev.moderation_status === 'reported'
                    ? { label: 'İşletme Bildirdi', tone: 'warning' as const }
                    : { label: 'Yayında', tone: 'success' as const };
                return (
                  <div
                    key={rev.id}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {rev.business_name}
                          </span>
                          <StatusText label={modMeta.label} tone={modMeta.tone} />
                        </div>
                        <p className="mt-0.5 text-slate-500">
                          Müşteri: {rev.customer_name} · {rev.service_name} ({rev.staff_name}) ·{' '}
                          {formatDateTR(rev.created_at)}
                        </p>
                      </div>

                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={`h-4 w-4 ${
                              s <= rev.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    <p className="text-sm text-slate-800">{rev.comment}</p>

                    {rev.report_reason && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
                        <span className="font-semibold">İşletme Bildirim Nedeni:</span>{' '}
                        {rev.report_reason}
                      </div>
                    )}

                    <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
                      {rev.moderation_status !== 'published' && (
                        <button
                          type="button"
                          onClick={() => handleModerateReview(rev.id, 'published')}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Yayında Tut / Yayınla</span>
                        </button>
                      )}
                      {rev.moderation_status !== 'hidden' && (
                        <button
                          type="button"
                          onClick={() => handleModerateReview(rev.id, 'hidden')}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                          <span>Yorumu Gizle</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
