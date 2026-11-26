'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  CalendarCheck,
  Clock,
  MapPin,
  Phone,
  MessageCircle,
  Instagram,
  Star,
  UserCheck,
  Scissors,
  Image as ImageIcon,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import type {
  BookingPage,
  BookingService,
  BookingStaff,
  AppointmentReview,
} from '@/lib/types';
import { BOOKING_THEME_PRESETS, sanitizeExternalUrl } from '@/lib/booking-helpers';
import { formatCurrencyTRY, formatDateTR } from '@/lib/format';

export interface StorefrontReview {
  id: string;
  rating: number;
  comment: string;
  business_reply: string | null;
  replied_at?: string | null;
  created_at: string;
  customer_name?: string;
  service_name?: string;
  staff_name?: string;
}

interface BookingStorefrontRendererProps {
  page: BookingPage;
  services: BookingService[];
  staff: BookingStaff[];
  reviews: StorefrontReview[] | AppointmentReview[];
  isBookingOpen?: boolean;
  closedReason?: string | null;
  isPreview?: boolean;
  forceMobileLayout?: boolean;
  onStartBooking?: (preselectedServiceId?: string, preselectedStaffId?: string) => void;
}

export function BookingStorefrontRenderer({
  page,
  services,
  staff,
  reviews,
  isBookingOpen = true,
  closedReason = null,
  isPreview = false,
  forceMobileLayout = false,
  onStartBooking,
}: BookingStorefrontRendererProps) {
  const preset = BOOKING_THEME_PRESETS[page.theme_preset] ?? BOOKING_THEME_PRESETS.classic_navy;
  const primary = page.primary_color || preset.primaryColor;
  const secondary = page.secondary_color || preset.secondaryColor;
  const vis = page.section_visibility;

  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  const activeServices = services.filter((s) => s.is_active !== false);
  const activeStaff = staff.filter((s) => s.is_active !== false);
  const gallery = [...(page.gallery_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  const logoSrc = sanitizeExternalUrl(page.logo_url);
  const coverSrc = sanitizeExternalUrl(page.cover_image_url);

  const avgRating =
    reviews.length > 0
      ? Math.round((reviews.reduce((sum, r) => sum + Number(r.rating), 0) / reviews.length) * 10) / 10
      : 0;

  const cleanWhatsappDigits = (page.whatsapp || '').replace(/\D+/g, '');
  const whatsappHref = cleanWhatsappDigits
    ? `https://wa.me/${cleanWhatsappDigits.startsWith('90') ? cleanWhatsappDigits : cleanWhatsappDigits.startsWith('0') ? `9${cleanWhatsappDigits}` : `90${cleanWhatsappDigits}`}`
    : null;

  const mapHref = (() => {
    const loc = (page.map_location || '').trim();
    if (loc && /^https?:\/\//i.test(loc)) return loc;
    const query = loc || page.address || page.page_title;
    return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
  })();

  const instagramHref = (() => {
    const ig = (page.instagram_url || '').trim();
    if (!ig) return null;
    if (/^https?:\/\//i.test(ig)) return ig;
    const handle = ig.replace(/^@/, '').trim();
    return handle ? `https://instagram.com/${handle}` : null;
  })();

  const containerCols = forceMobileLayout ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2';
  const staffCols = forceMobileLayout ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  const galleryCols = forceMobileLayout ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3';

  return (
    <div style={{ backgroundColor: preset.surfaceBg }} className="min-h-full text-slate-900">
      {/* Üst Bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            {logoSrc ? (
              <img
                src={logoSrc}
                alt={page.page_title}
                referrerPolicy="no-referrer"
                className="h-9 w-9 rounded-lg border border-slate-200 object-cover shrink-0 bg-white"
              />
            ) : (
              <div
                style={{ backgroundColor: primary }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
              >
                {(page.page_title || 'İ').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 font-display">
                {page.page_title || 'İşletme Randevu Sayfası'}
              </p>
              {page.address && (
                <p className="truncate text-[11px] text-slate-500">{page.address}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isPreview && (
              <Link
                href="/musteri"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Randevularım
              </Link>
            )}
            <button
              type="button"
              disabled={!isBookingOpen && !isPreview}
              onClick={() => onStartBooking?.()}
              style={{ backgroundColor: primary }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              <CalendarCheck className="h-3.5 w-3.5" />
              <span>Randevu Al</span>
            </button>
          </div>
        </div>
      </header>

      {/* Geçici Kapalı veya Yayında Değil Uyarısı */}
      {!isBookingOpen && closedReason && (
        <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-6">
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <p className="font-medium leading-relaxed">{closedReason}</p>
          </div>
        </div>
      )}

      {/* Hero / Kapak Bölümü */}
      {vis.hero && (
        <section className="mx-auto max-w-5xl px-4 pt-5 sm:px-6">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="relative h-48 sm:h-64 w-full bg-slate-100">
              {coverSrc ? (
                <img
                  src={coverSrc}
                  alt={`${page.page_title} kapak görseli`}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  style={{
                    background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
                  }}
                  className="flex h-full w-full items-center justify-center px-6 text-center text-white/90"
                >
                  <div>
                    <p className="text-xs uppercase tracking-widest text-white/75">
                      Online Randevu
                    </p>
                    <p className="mt-1 text-2xl font-bold font-display">{page.page_title}</p>
                  </div>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/20 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6 text-white">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight font-display">
                      {page.page_title}
                    </h1>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-200">
                      {reviews.length > 0 && (
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                          <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />
                          {avgRating} ({reviews.length} yorum)
                        </span>
                      )}
                      {page.phone && <span>{page.phone}</span>}
                      {page.address && <span className="truncate max-w-md">{page.address}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!isBookingOpen && !isPreview}
                    onClick={() => onStartBooking?.()}
                    style={{ backgroundColor: secondary }}
                    className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50 whitespace-nowrap"
                  >
                    <CalendarCheck className="h-4 w-4" />
                    <span>Hemen Randevu Al</span>
                  </button>
                </div>
              </div>
            </div>

            {page.description && (
              <div className="border-t border-slate-100 px-5 py-4 sm:px-6">
                <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-line">
                  {page.description}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="mx-auto max-w-5xl space-y-8 px-4 py-7 sm:px-6">
        {/* Hizmetler */}
        {vis.services && (
          <section id="hizmetler">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scissors className="h-4 w-4" style={{ color: primary }} />
                <h2 className="text-lg font-bold text-slate-900 font-display">
                  Hizmetler ve Fiyatlar
                </h2>
              </div>
              <span className="text-xs text-slate-500">{activeServices.length} hizmet</span>
            </div>

            {activeServices.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                Henüz aktif hizmet tanımlanmamış.
              </div>
            ) : (
              <div className={`grid gap-3.5 ${containerCols}`}>
                {activeServices.map((srv) => {
                  const hasDiscount =
                    srv.discount_price !== null &&
                    srv.discount_price !== undefined &&
                    Number(srv.discount_price) < Number(srv.price);
                  const effectivePrice = hasDiscount ? Number(srv.discount_price) : Number(srv.price);
                  const imgSrc = sanitizeExternalUrl(srv.image_url);

                  return (
                    <div
                      key={srv.id}
                      className="flex items-start justify-between gap-3.5 rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-colors hover:border-slate-300"
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        {imgSrc && (
                          <img
                            src={imgSrc}
                            alt={srv.name}
                            referrerPolicy="no-referrer"
                            className="h-14 w-14 rounded-lg border border-slate-200 object-cover shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-slate-900">{srv.name}</h3>
                          {srv.description && (
                            <p className="mt-1 text-xs leading-relaxed text-slate-600 line-clamp-2">
                              {srv.description}
                            </p>
                          )}
                          <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500">
                            <Clock className="h-3.5 w-3.5" />
                            <span>{srv.duration_minutes} dakika</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="text-right">
                          {hasDiscount && (
                            <p className="text-[11px] text-slate-400 line-through">
                              {formatCurrencyTRY(srv.price)}
                            </p>
                          )}
                          <p className="text-sm font-bold text-slate-900 font-mono">
                            {formatCurrencyTRY(effectivePrice)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!isBookingOpen && !isPreview}
                          onClick={() => onStartBooking?.(srv.id)}
                          style={{ borderColor: primary, color: primary }}
                          className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          Seç &amp; Al
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Personel */}
        {vis.staff && activeStaff.length > 0 && (
          <section id="ekip">
            <div className="mb-4 flex items-center gap-2">
              <UserCheck className="h-4 w-4" style={{ color: primary }} />
              <h2 className="text-lg font-bold text-slate-900 font-display">Uzman Ekibimiz</h2>
            </div>

            <div className={`grid gap-3.5 ${staffCols}`}>
              {activeStaff.map((member) => {
                const avatar = sanitizeExternalUrl(member.avatar_url);
                return (
                  <div
                    key={member.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
                  >
                    <div className="flex items-start gap-3">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={member.full_name}
                          referrerPolicy="no-referrer"
                          className="h-12 w-12 rounded-full border border-slate-200 object-cover shrink-0"
                        />
                      ) : (
                        <div
                          style={{ backgroundColor: `${primary}18`, color: primary }}
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                        >
                          {member.full_name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 truncate">
                          {member.full_name}
                        </h3>
                        {member.specialties && (
                          <p className="mt-0.5 text-xs font-medium text-slate-600">
                            {member.specialties}
                          </p>
                        )}
                        {member.bio && (
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-500 line-clamp-3">
                            {member.bio}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!isBookingOpen && !isPreview}
                      onClick={() => onStartBooking?.(undefined, member.id)}
                      className="mt-3 w-full rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Bu Personelden Randevu Al
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Galeri */}
        {vis.gallery && gallery.length > 0 && (
          <section id="galeri">
            <div className="mb-4 flex items-center gap-2">
              <ImageIcon className="h-4 w-4" style={{ color: primary }} />
              <h2 className="text-lg font-bold text-slate-900 font-display">İşletme Galerisi</h2>
            </div>

            <div className={`grid gap-3 ${galleryCols}`}>
              {gallery.map((item) => {
                const imgUrl = sanitizeExternalUrl(item.url);
                if (!imgUrl) return null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLightboxImg(imgUrl)}
                    className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-left"
                  >
                    <img
                      src={imgUrl}
                      alt={item.caption || page.page_title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    {item.caption && (
                      <span className="absolute inset-x-0 bottom-0 bg-slate-950/60 px-2.5 py-1.5 text-[11px] text-white truncate">
                        {item.caption}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Müşteri Yorumları */}
        {vis.reviews && (
          <section id="yorumlar">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                <h2 className="text-lg font-bold text-slate-900 font-display">
                  Müşteri Değerlendirmeleri
                </h2>
              </div>
              {reviews.length > 0 && (
                <span className="text-xs font-semibold text-slate-700">
                  Ortalama {avgRating} / 5 ({reviews.length} onaylı yorum)
                </span>
              )}
            </div>

            {reviews.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                Henüz müşteri değerlendirmesi bulunmuyor.
              </div>
            ) : (
              <div className={`grid gap-3.5 ${containerCols}`}>
                {reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {rev.customer_name || 'Müşteri'}
                      </p>
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`h-3.5 w-3.5 ${
                              star <= Number(rev.rating)
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-slate-200'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    {(rev.service_name || rev.staff_name) && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        {[rev.service_name, rev.staff_name].filter(Boolean).join(' · ')} ·{' '}
                        {formatDateTR(rev.created_at)}
                      </p>
                    )}

                    <p className="mt-2 text-xs leading-relaxed text-slate-700">{rev.comment}</p>

                    {rev.business_reply && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-[11px] font-semibold text-slate-800">İşletme Yanıtı</p>
                        <p className="mt-0.5 text-xs text-slate-600">{rev.business_reply}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Çalışma Saatleri ve İletişim */}
        {(vis.hours || vis.contact) && (
          <section className={`grid gap-4 ${vis.hours && vis.contact && !forceMobileLayout ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            {vis.hours && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4" style={{ color: primary }} />
                  <h2 className="text-base font-bold text-slate-900 font-display">
                    Çalışma Saatleri
                  </h2>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  {(page.business_hours ?? []).map((h) => (
                    <div key={h.day} className="flex items-center justify-between py-2">
                      <span className="font-medium text-slate-700">{h.label}</span>
                      <span className={h.is_open ? 'font-mono text-slate-900' : 'text-slate-400'}>
                        {h.is_open ? `${h.open} - ${h.close}` : 'Kapalı'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {vis.contact && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <MapPin className="h-4 w-4" style={{ color: primary }} />
                    <h2 className="text-base font-bold text-slate-900 font-display">
                      İletişim ve Konum
                    </h2>
                  </div>

                  <div className="space-y-3 text-xs text-slate-700">
                    {page.address && (
                      <div className="flex items-start gap-2.5">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <span>{page.address}</span>
                      </div>
                    )}
                    {page.phone && (
                      <div className="flex items-center gap-2.5">
                        <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                        <a href={`tel:${page.phone}`} className="font-medium hover:underline">
                          {page.phone}
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {whatsappHref && (
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      <span>WhatsApp</span>
                    </a>
                  )}
                  {instagramHref && (
                    <a
                      href={instagramHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      <Instagram className="h-3.5 w-3.5" />
                      <span>Instagram</span>
                    </a>
                  )}
                  {mapHref && (
                    <a
                      href={mapHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Haritada Aç</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Görsel Büyütme (Lightbox) */}
      {lightboxImg && (
        <div
          onClick={() => setLightboxImg(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
        >
          <img
            src={lightboxImg}
            alt="İşletme fotoğrafı"
            referrerPolicy="no-referrer"
            className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
          />
        </div>
      )}

      <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-[11px] text-slate-500">
        {page.page_title} · EsnafTakip Online Randevu Sistemi
      </footer>
    </div>
  );
}
