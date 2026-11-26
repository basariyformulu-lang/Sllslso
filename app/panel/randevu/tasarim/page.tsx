'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  Monitor,
  Palette,
  Phone,
  Plus,
  Save,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import { PanelShell } from '@/components/PanelShell';
import { BookingReadOnlyBanner } from '@/components/BookingReadOnlyBanner';
import {
  BookingStorefrontRenderer,
  type StorefrontReview,
} from '@/components/BookingStorefrontRenderer';
import { useToast } from '@/components/ToastProvider';
import {
  BOOKING_THEME_PRESETS,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_SECTION_VISIBILITY,
  type BookingThemePreset,
} from '@/lib/booking-helpers';
import type {
  BookingGalleryItem,
  BookingPage,
  BookingSectionVisibility,
  BookingService,
  BookingStaff,
} from '@/lib/types';

type EditorTab = 'theme' | 'media' | 'sections' | 'contact';

export default function BookingDesignEditorPage() {
  const { showToast } = useToast();
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [tab, setTab] = useState<EditorTab>('theme');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');

  const [page, setPage] = useState<BookingPage | null>(null);
  const [services, setServices] = useState<BookingService[]>([]);
  const [staff, setStaff] = useState<BookingStaff[]>([]);
  const [reviews, setReviews] = useState<StorefrontReview[]>([]);
  const [newGalleryUrl, setNewGalleryUrl] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/booking/page', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setReadOnly(Boolean(json.readOnly));
        setPage(json.page ?? null);
        setServices(json.services ?? []);
        setStaff(json.staff ?? []);
        setReviews(json.reviews ?? []);
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

  function updatePage(patch: Partial<BookingPage>) {
    setPage((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function applyPreset(presetId: BookingThemePreset) {
    const preset = BOOKING_THEME_PRESETS[presetId];
    updatePage({
      theme_preset: presetId,
      primary_color: preset.primaryColor,
      secondary_color: preset.secondaryColor,
    });
  }

  function toggleSection(key: keyof BookingSectionVisibility) {
    if (!page) return;
    updatePage({
      section_visibility: {
        ...page.section_visibility,
        [key]: !page.section_visibility[key],
      },
    });
  }

  function handleFileToField(
    e: React.ChangeEvent<HTMLInputElement>,
    onResult: (dataUrl: string) => void
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_400_000) {
      showToast('Görsel boyutu en fazla 1.4 MB olabilir', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onResult(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function addGalleryItem(url: string) {
    if (!page || !url.trim()) return;
    const item: BookingGalleryItem = {
      id: `gal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      url: url.trim(),
      caption: '',
      sort_order: page.gallery_images.length,
    };
    updatePage({ gallery_images: [...page.gallery_images, item] });
  }

  function moveGallery(idx: number, dir: -1 | 1) {
    if (!page) return;
    const target = idx + dir;
    if (target < 0 || target >= page.gallery_images.length) return;
    const next = [...page.gallery_images];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    updatePage({
      gallery_images: next.map((g, i) => ({ ...g, sort_order: i })),
    });
  }

  function removeGallery(id: string) {
    if (!page) return;
    updatePage({
      gallery_images: page.gallery_images
        .filter((g) => g.id !== id)
        .map((g, i) => ({ ...g, sort_order: i })),
    });
  }

  function moveService(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= services.length) return;
    const next = [...services];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    setServices(next.map((s, i) => ({ ...s, sort_order: i })));
  }

  async function saveChanges(nextStatus?: 'published' | 'draft') {
    if (!page) return;
    setSaving(true);
    try {
      const targetStatus = nextStatus ?? page.status;
      const res = await fetch('/api/panel/booking/page', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_title: page.page_title,
          description: page.description,
          logo_url: page.logo_url,
          cover_image_url: page.cover_image_url,
          gallery_images: page.gallery_images,
          phone: page.phone,
          whatsapp: page.whatsapp,
          address: page.address,
          map_location: page.map_location,
          instagram_url: page.instagram_url,
          theme_preset: page.theme_preset,
          primary_color: page.primary_color,
          secondary_color: page.secondary_color,
          section_visibility: page.section_visibility,
          status: targetStatus,
          service_order_ids: services.map((s) => s.id),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Tasarım kaydedilemedi', 'error');
        return;
      }
      if (json.page) setPage(json.page);
      showToast(
        nextStatus === 'published'
          ? 'Randevu sayfanız kaydedildi ve yayına alındı!'
          : 'Tasarım değişiklikleri kaydedildi',
        'success'
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading || !page) {
    return (
      <PanelShell>
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="h-12 rounded-xl bg-slate-200 animate-pulse" />
          <div className="h-[520px] rounded-xl bg-slate-200 animate-pulse" />
        </div>
      </PanelShell>
    );
  }

  const safePage: BookingPage = {
    ...page,
    section_visibility: page.section_visibility ?? DEFAULT_SECTION_VISIBILITY,
    business_hours: page.business_hours ?? DEFAULT_BUSINESS_HOURS,
    gallery_images: page.gallery_images ?? [],
  };

  return (
    <PanelShell>
      <div className="mx-auto max-w-[1400px] space-y-5">
        {/* Üst Araç Çubuğu */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-xs">
          <div>
            <h1 className="text-lg font-bold text-slate-900 font-display">
              Randevu Sayfası Tasarım Editörü
            </h1>
            <p className="text-xs text-slate-500">
              Temanızı, renklerinizi, görsellerinizi ve sayfa bölümlerinizi canlı önizleyerek düzenleyin.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setPreviewDevice('desktop')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                  previewDevice === 'desktop'
                    ? 'bg-white text-[#0F2942] shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                <span>Masaüstü</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice('mobile')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                  previewDevice === 'mobile'
                    ? 'bg-white text-[#0F2942] shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span>Mobil</span>
              </button>
            </div>

            <Link
              href={`/r/${safePage.slug}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Canlı Sayfa</span>
            </Link>

            {!readOnly && (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveChanges()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Kaydet</span>
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveChanges('published')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>{safePage.status === 'published' ? 'Güncelle & Yayında Tut' : 'Kaydet & Yayınla'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        <BookingReadOnlyBanner visible={readOnly} />

        {/* Sol Editör + Sağ Canlı Önizleme */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Sol Kontroller */}
          <div className="xl:col-span-5 rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden flex flex-col">
            <div className="grid grid-cols-4 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold">
              {[
                { id: 'theme', label: 'Tema & Metin', icon: Palette },
                { id: 'media', label: 'Görsel & Galeri', icon: ImageIcon },
                { id: 'sections', label: 'Bölüm & Sıra', icon: Layers },
                { id: 'contact', label: 'İletişim', icon: Phone },
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id as EditorTab)}
                    className={`flex flex-col items-center gap-1 py-2.5 px-2 transition-colors ${
                      tab === t.id
                        ? 'bg-white text-[#0F2942] border-b-2 border-[#0F2942]'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="p-5 space-y-5 text-xs overflow-y-auto max-h-[72vh]">
              {tab === 'theme' && (
                <>
                  <div>
                    <label className="block font-semibold text-slate-800 mb-2">
                      Hazır Profesyonel Temalar
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      {Object.values(BOOKING_THEME_PRESETS).map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={readOnly}
                          onClick={() => applyPreset(preset.id)}
                          className={`flex items-center justify-between rounded-xl border p-3 text-left transition-colors ${
                            safePage.theme_preset === preset.id
                              ? 'border-[#0F2942] bg-slate-50'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="min-w-0 pr-3">
                            <p className="font-semibold text-slate-900">{preset.name}</p>
                            <p className="text-[11px] text-slate-500">{preset.description}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span
                              style={{ backgroundColor: preset.primaryColor }}
                              className="h-5 w-5 rounded-full border border-slate-200"
                            />
                            <span
                              style={{ backgroundColor: preset.secondaryColor }}
                              className="h-5 w-5 rounded-full border border-slate-200"
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700">Ana Renk</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="color"
                          disabled={readOnly}
                          value={safePage.primary_color}
                          onChange={(e) => updatePage({ primary_color: e.target.value })}
                          className="h-9 w-11 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                        />
                        <input
                          type="text"
                          disabled={readOnly}
                          value={safePage.primary_color}
                          onChange={(e) => updatePage({ primary_color: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700">Yardımcı Renk</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="color"
                          disabled={readOnly}
                          value={safePage.secondary_color}
                          onChange={(e) => updatePage({ secondary_color: e.target.value })}
                          className="h-9 w-11 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                        />
                        <input
                          type="text"
                          disabled={readOnly}
                          value={safePage.secondary_color}
                          onChange={(e) => updatePage({ secondary_color: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700">İşletme Başlığı *</label>
                    <input
                      type="text"
                      disabled={readOnly}
                      value={safePage.page_title}
                      onChange={(e) => updatePage({ page_title: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700">İşletme Açıklaması</label>
                    <textarea
                      rows={4}
                      disabled={readOnly}
                      value={safePage.description}
                      onChange={(e) => updatePage({ description: e.target.value })}
                      placeholder="Müşterilerinize işletmenizi, uzmanlığınızı ve sunduğunuz deneyimi anlatın..."
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs leading-relaxed"
                    />
                  </div>
                </>
              )}

              {tab === 'media' && (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700">İşletme Logosu</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="text"
                        disabled={readOnly}
                        value={safePage.logo_url}
                        onChange={(e) => updatePage({ logo_url: e.target.value })}
                        placeholder="https://... veya yükleyin"
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                      {!readOnly && (
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">
                          <Upload className="h-3.5 w-3.5" />
                          <span>Yükle</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleFileToField(e, (url) => updatePage({ logo_url: url }))}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700">Kapak Görseli</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="text"
                        disabled={readOnly}
                        value={safePage.cover_image_url}
                        onChange={(e) => updatePage({ cover_image_url: e.target.value })}
                        placeholder="https://... veya yükleyin"
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                      {!readOnly && (
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">
                          <Upload className="h-3.5 w-3.5" />
                          <span>Yükle</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) =>
                              handleFileToField(e, (url) => updatePage({ cover_image_url: url }))
                            }
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="font-semibold text-slate-800">
                        İşletme Fotoğraf Galerisi ({safePage.gallery_images.length})
                      </label>
                      {!readOnly && (
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-[#0F2942] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#173B5E]">
                          <Upload className="h-3 w-3" />
                          <span>Dosyadan Ekle</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleFileToField(e, addGalleryItem)}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>

                    {!readOnly && (
                      <div className="flex gap-2">
                        <input
                          type="url"
                          value={newGalleryUrl}
                          onChange={(e) => setNewGalleryUrl(e.target.value)}
                          placeholder="Görsel URL yapıştırın (https://...)"
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            addGalleryItem(newGalleryUrl);
                            setNewGalleryUrl('');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Ekle</span>
                        </button>
                      </div>
                    )}

                    <div className="space-y-2">
                      {safePage.gallery_images.map((item, idx) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 p-2"
                        >
                          <img
                            src={item.url}
                            alt="Galeri"
                            referrerPolicy="no-referrer"
                            className="h-10 w-12 rounded object-cover shrink-0 bg-slate-100"
                          />
                          <input
                            type="text"
                            disabled={readOnly}
                            value={item.caption ?? ''}
                            onChange={(e) => {
                              const next = safePage.gallery_images.map((g) =>
                                g.id === item.id ? { ...g, caption: e.target.value } : g
                              );
                              updatePage({ gallery_images: next });
                            }}
                            placeholder="Fotoğraf açıklaması (opsiyonel)"
                            className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs"
                          />
                          {!readOnly && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moveGallery(idx, -1)}
                                className="rounded border border-slate-200 p-1 disabled:opacity-30"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === safePage.gallery_images.length - 1}
                                onClick={() => moveGallery(idx, 1)}
                                className="rounded border border-slate-200 p-1 disabled:opacity-30"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeGallery(item.id)}
                                className="rounded border border-red-200 p-1 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {tab === 'sections' && (
                <>
                  <div>
                    <label className="block font-semibold text-slate-800 mb-2">
                      Sayfa Bölümlerini Aç / Kapat
                    </label>
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3">
                      {(
                        [
                          ['hero', 'Kapak Görseli ve İşletme Tanıtımı'],
                          ['services', 'Hizmetler ve Fiyatlar'],
                          ['staff', 'Personel / Ekip Bölümü'],
                          ['gallery', 'İşletme Fotoğraf Galerisi'],
                          ['reviews', 'Müşteri Yorumları Bölümü'],
                          ['hours', 'Çalışma Saatleri Tablosu'],
                          ['contact', 'İletişim ve Harita Bilgileri'],
                        ] as Array<[keyof BookingSectionVisibility, string]>
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center justify-between py-2.5 cursor-pointer"
                        >
                          <span className="font-medium text-slate-700">{label}</span>
                          <input
                            type="checkbox"
                            disabled={readOnly}
                            checked={safePage.section_visibility[key]}
                            onChange={() => toggleSection(key)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  {services.length > 0 && (
                    <div className="border-t border-slate-200 pt-4">
                      <label className="block font-semibold text-slate-800 mb-2">
                        Hizmetlerin Gösterim Sırası
                      </label>
                      <div className="space-y-1.5">
                        {services.map((srv, idx) => (
                          <div
                            key={srv.id}
                            className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                          >
                            <span className="font-medium text-slate-800 truncate">
                              {idx + 1}. {srv.name}
                            </span>
                            {!readOnly && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => moveService(idx, -1)}
                                  className="rounded border border-slate-200 p-1 disabled:opacity-30"
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === services.length - 1}
                                  onClick={() => moveService(idx, 1)}
                                  className="rounded border border-slate-200 p-1 disabled:opacity-30"
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === 'contact' && (
                <div className="space-y-4">
                  <div>
                    <label className="block font-semibold text-slate-700">Telefon Numarası</label>
                    <input
                      type="tel"
                      disabled={readOnly}
                      value={safePage.phone}
                      onChange={(e) => updatePage({ phone: e.target.value })}
                      placeholder="05XX XXX XX XX"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700">WhatsApp Numarası</label>
                    <input
                      type="tel"
                      disabled={readOnly}
                      value={safePage.whatsapp}
                      onChange={(e) => updatePage({ whatsapp: e.target.value })}
                      placeholder="05XX XXX XX XX"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700">Instagram Hesabı veya URL</label>
                    <input
                      type="text"
                      disabled={readOnly}
                      value={safePage.instagram_url}
                      onChange={(e) => updatePage({ instagram_url: e.target.value })}
                      placeholder="@isletmeadi veya https://instagram.com/..."
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700">Açık Adres</label>
                    <textarea
                      rows={2}
                      disabled={readOnly}
                      value={safePage.address}
                      onChange={(e) => updatePage({ address: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700">
                      Google Haritalar Bağlantısı veya Konum
                    </label>
                    <input
                      type="text"
                      disabled={readOnly}
                      value={safePage.map_location}
                      onChange={(e) => updatePage({ map_location: e.target.value })}
                      placeholder="https://maps.google.com/... veya ilçe/cadde adı"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sağ Canlı Önizleme */}
          <div className="xl:col-span-7 flex flex-col items-center rounded-xl border border-slate-200 bg-slate-100 p-4">
            <div className="mb-3 flex w-full items-center justify-between text-xs text-slate-500 px-1">
              <span>Canlı Ön İzleme ({previewDevice === 'mobile' ? 'Mobil Görünüm' : 'Masaüstü Görünüm'})</span>
              <span className="font-mono">/r/{safePage.slug}</span>
            </div>

            <div
              className={`w-full overflow-y-auto rounded-2xl border border-slate-300 bg-white shadow-lg transition-all ${
                previewDevice === 'mobile' ? 'max-w-[390px] h-[700px]' : 'h-[700px]'
              }`}
            >
              <BookingStorefrontRenderer
                page={safePage}
                services={services}
                staff={staff}
                reviews={reviews}
                isBookingOpen={true}
                isPreview={true}
                forceMobileLayout={previewDevice === 'mobile'}
              />
            </div>
          </div>
        </div>
      </div>
    </PanelShell>
  );
}
