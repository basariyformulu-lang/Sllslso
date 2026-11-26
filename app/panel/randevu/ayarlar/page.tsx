'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Check, ExternalLink, Globe, Save, ShieldCheck } from 'lucide-react';
import { PanelShell } from '@/components/PanelShell';
import { BookingReadOnlyBanner } from '@/components/BookingReadOnlyBanner';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import { BOOKING_PAGE_STATUS_LABELS, slugifyBookingTitle } from '@/lib/booking-helpers';

export default function BookingSettingsPage() {
  const { showToast } = useToast();
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    slug: '',
    status: 'draft' as 'draft' | 'published' | 'paused',
    min_advance_minutes: 60,
    max_advance_days: 30,
    cancellation_deadline_hours: 2,
    auto_confirm: false,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/booking/page', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok && json.page) {
        setReadOnly(Boolean(json.readOnly));
        setForm({
          slug: json.page.slug || '',
          status: json.page.status || 'draft',
          min_advance_minutes: json.page.min_advance_minutes ?? 60,
          max_advance_days: json.page.max_advance_days ?? 30,
          cancellation_deadline_hours: json.page.cancellation_deadline_hours ?? 2,
          auto_confirm: Boolean(json.page.auto_confirm),
        });
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/panel/booking/page', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Ayarlar kaydedilemedi', 'error');
        return;
      }
      if (json.page) {
        setForm((prev) => ({ ...prev, slug: json.page.slug, status: json.page.status }));
      }
      showToast('Randevu sayfası ayarları güncellendi', 'success');
    } finally {
      setSaving(false);
    }
  }

  function handleCopy() {
    const url = `${window.location.origin}/r/${form.slug}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      showToast('Bağlantı panoya kopyalandı', 'success');
      setTimeout(() => setCopied(false), 2500);
    });
  }

  const statusMeta = BOOKING_PAGE_STATUS_LABELS[form.status] ?? {
    label: form.status,
    tone: 'neutral' as const,
  };

  return (
    <PanelShell>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-display">
              Randevu Sayfası Ayarları
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              İşletmenize özel randevu bağlantısını, yayın durumunu ve randevu kurallarını yapılandırın.
            </p>
          </div>
          <StatusText label={statusMeta.label} tone={statusMeta.tone} />
        </div>

        <BookingReadOnlyBanner visible={readOnly} />

        {loading ? (
          <div className="h-64 rounded-xl bg-slate-200 animate-pulse" />
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            {/* Bağlantı ve Yayın Durumu */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Globe className="h-4 w-4 text-[#0F2942]" />
                <h2 className="text-sm font-bold text-slate-900">Sayfa Bağlantısı ve Yayın Durumu</h2>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">
                  Benzersiz Randevu Bağlantısı (Slug) *
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-1 min-w-[240px] items-center rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs">
                    <span className="text-slate-500 font-mono select-none">/r/</span>
                    <input
                      type="text"
                      required
                      disabled={readOnly}
                      value={form.slug}
                      onChange={(e) =>
                        setForm({ ...form, slug: slugifyBookingTitle(e.target.value) })
                      }
                      className="ml-1 flex-1 bg-transparent font-mono font-semibold text-[#0F2942] focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>Kopyala</span>
                  </button>
                  <Link
                    href={`/r/${form.slug}`}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Önizle</span>
                  </Link>
                </div>
                <p className="text-[11px] text-slate-500">
                  Yalnızca küçük İngilizce harfler, rakamlar ve tire (-) kullanılabilir. Örn: ali-berber
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">Yayın Durumu</label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                  {[
                    {
                      value: 'published',
                      title: 'Yayında',
                      desc: 'Müşteriler sayfayı görür ve online randevu alabilir.',
                    },
                    {
                      value: 'paused',
                      title: 'Geçici Olarak Kapalı',
                      desc: 'Sayfa görünür ancak yeni randevu alımı durdurulur.',
                    },
                    {
                      value: 'draft',
                      title: 'Taslak (Yayından Kaldır)',
                      desc: 'Sayfa müşterilere kapalıdır, yalnızca siz düzenlersiniz.',
                    },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`cursor-pointer rounded-xl border p-3.5 transition-colors ${
                        form.status === opt.value
                          ? 'border-[#0F2942] bg-slate-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold text-slate-900">
                        <input
                          type="radio"
                          name="page_status"
                          disabled={readOnly}
                          checked={form.status === opt.value}
                          onChange={() =>
                            setForm({
                              ...form,
                              status: opt.value as 'draft' | 'published' | 'paused',
                            })
                          }
                        />
                        <span>{opt.title}</span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                        {opt.desc}
                      </p>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Randevu Alma Kuralları */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                <h2 className="text-sm font-bold text-slate-900">Randevu ve İptal Kuralları</h2>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700">
                    En Az Kaç Dakika Önceden Alınabilsin?
                  </label>
                  <select
                    disabled={readOnly}
                    value={form.min_advance_minutes}
                    onChange={(e) =>
                      setForm({ ...form, min_advance_minutes: Number(e.target.value) })
                    }
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  >
                    <option value={0}>Anında alınabilir (0 dk)</option>
                    <option value={30}>30 dakika önce</option>
                    <option value={60}>1 saat önce</option>
                    <option value={120}>2 saat önce</option>
                    <option value={240}>4 saat önce</option>
                    <option value={1440}>1 gün (24 saat) önce</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700">
                    En Fazla Kaç Gün İleriye Randevu Açılsın?
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    disabled={readOnly}
                    value={form.max_advance_days}
                    onChange={(e) =>
                      setForm({ ...form, max_advance_days: Number(e.target.value) })
                    }
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700">
                    Müşteri İptal / Değişiklik Süresi (Saat)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={168}
                    disabled={readOnly}
                    value={form.cancellation_deadline_hours}
                    onChange={(e) =>
                      setForm({ ...form, cancellation_deadline_hours: Number(e.target.value) })
                    }
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Randevuya bu süreden az kalınca müşteri online iptal yapamaz.
                  </p>
                </div>
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={form.auto_confirm}
                  onChange={(e) => setForm({ ...form, auto_confirm: e.target.checked })}
                  className="mt-0.5 rounded border-slate-300"
                />
                <div>
                  <span className="font-semibold text-slate-900">
                    Online randevuları otomatik onayla
                  </span>
                  <p className="mt-0.5 text-[11px] text-slate-600">
                    İşaretlenirse müşterilerin aldığı randevular doğrudan &ldquo;Onaylandı&rdquo; durumunda kaydedilir. Kapalıysa sizin onayınıza düşer.
                  </p>
                </div>
              </label>

              {!readOnly && (
                <div className="flex justify-end border-t border-slate-200 pt-4">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{saving ? 'Kaydediliyor...' : 'Ayarları Kaydet'}</span>
                  </button>
                </div>
              )}
            </div>
          </form>
        )}
      </div>
    </PanelShell>
  );
}
