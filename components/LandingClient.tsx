'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Menu,
  X,
  ArrowRight,
  Check,
  ChevronDown,
  Mail,
  Phone,
  ShieldCheck,
  CalendarClock,
  Users,
  Truck,
  Repeat,
} from 'lucide-react';
import heroShopImg from '@/src/assets/images/hero_esnaf_shop_1795605464759.jpg';
import wholesaleDepotImg from '@/src/assets/images/feature_wholesale_depot_1795605465063.jpg';
import shopkeeperDeskImg from '@/src/assets/images/feature_shopkeeper_desk_1795605465495.jpg';
import type { SubscriptionPlan, SystemSettings } from '@/lib/types';
import { addMonthsToISODate, formatCurrencyTRY, formatDateTR } from '@/lib/format';

const FAQ_ITEMS = [
  {
    q: 'EsnafTakip bir muhasebe veya barkodlu satış programı mıdır?',
    a: 'Hayır. EsnafTakip karmaşık muhasebe kayıtları veya barkodlu kasa cihazları gerektirmez. Doğrudan müşteri alacaklarınızı, toptancı borçlarınızı, vadeli satışlarınızı ve aylık sabit giderlerinizi takip etmeniz için tasarlanmıştır.',
  },
  {
    q: 'Abonelik ödemesi nasıl yapılır ve ne zaman aktif olur?',
    a: 'Başvurunuzu tamamladıktan sonra ödeme ekranında yer alan banka IBAN bilgilerine havale veya EFT ile abonelik tutarını gönderip ödeme bildirimi yaparsınız. Yönetici onayının ardından paneliniz anında aktif edilir.',
  },
  {
    q: 'Personel veya ortaklarım için ayrı kullanıcı açabilir miyim?',
    a: 'Evet. İşletme sahibi kullanıcı yönetimi ekranından personeline yalnızca görmesi veya işlem yapması gereken modüller için özel yetkiler tanımlayabilir.',
  },
  {
    q: 'Bilgisayar, tablet ve telefondan aynı anda kullanabilir miyim?',
    a: 'Evet. EsnafTakip tamamen web tabanlı ve mobil uyumludur. Kurulum gerektirmez, tarayıcı üzerinden her cihazda aynı güncel verilere ulaşırsınız.',
  },
];

export function LandingClient({
  settings,
  plan,
}: {
  settings: SystemSettings;
  plan: SubscriptionPlan;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const [legalModal, setLegalModal] = useState<'terms' | 'privacy' | null>(null);

  // Canlı Vadeli Satış Vade Hesaplayıcı Önizlemesi (gerçek vade algoritmasıyla)
  const [previewAmount, setPreviewAmount] = useState(40000);
  const [previewMonths, setPreviewMonths] = useState(4);
  const previewSaleDate = '2026-11-25';
  const previewDueDate = useMemo(
    () => addMonthsToISODate(previewSaleDate, previewMonths),
    [previewMonths]
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      {/* Top Bar: 3-Zone Contract */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-[#0F2942] whitespace-nowrap shrink-0 font-display"
          >
            {settings.system_name || 'EsnafTakip'}
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a
              href="#ozellikler"
              className="hover:text-[#0F2942] transition-colors whitespace-nowrap shrink-0"
            >
              Özellikler
            </a>
            <a
              href="#nasil-calisir"
              className="hover:text-[#0F2942] transition-colors whitespace-nowrap shrink-0"
            >
              Nasıl Çalışır?
            </a>
            <a
              href="#fiyatlandirma"
              className="hover:text-[#0F2942] transition-colors whitespace-nowrap shrink-0"
            >
              Fiyatlandırma
            </a>
            <Link
              href="/giris"
              className="hover:text-[#0F2942] transition-colors whitespace-nowrap shrink-0"
            >
              Giriş Yap
            </Link>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/basvuru"
              className="hidden sm:inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173B5E] transition-colors whitespace-nowrap shrink-0"
            >
              <span>Ücretsiz Başvuru</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="inline-flex md:hidden items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
              aria-label="Menüyü aç"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 py-4 md:hidden">
            <div className="flex flex-col gap-3 text-sm font-medium text-slate-700">
              <a href="#ozellikler" onClick={() => setMobileMenuOpen(false)} className="py-1.5">
                Özellikler
              </a>
              <a href="#nasil-calisir" onClick={() => setMobileMenuOpen(false)} className="py-1.5">
                Nasıl Çalışır?
              </a>
              <a href="#fiyatlandirma" onClick={() => setMobileMenuOpen(false)} className="py-1.5">
                Fiyatlandırma
              </a>
              <Link href="/giris" onClick={() => setMobileMenuOpen(false)} className="py-1.5">
                Giriş Yap
              </Link>
              <Link
                href="/basvuru"
                onClick={() => setMobileMenuOpen(false)}
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-sm font-semibold text-white"
              >
                Ücretsiz Başvuru
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* 1. Hero Section */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-20">
          <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12">
            <div className="flex flex-col justify-center lg:col-span-6">
              <p className="text-xs font-semibold tracking-wide text-emerald-700">
                Küçük İşletmeler İçin Cari Hesap &amp; Finans Yönetimi
              </p>
              <h1
                className="mt-3 font-bold tracking-tight text-[#0F2942] leading-[1.1]"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', textWrap: 'balance' }}
              >
                {settings.hero_slogan}
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
                {settings.hero_subheadline}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/basvuru"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-6 py-3 text-sm font-semibold text-white hover:bg-[#173B5E] transition-colors whitespace-nowrap"
                >
                  <span>İşletme Başvurusu Yap</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/giris"
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  Panele Giriş Yap
                </Link>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-72 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-96 lg:h-full lg:min-h-[380px]">
                <Image
                  src={heroShopImg}
                  alt="EsnafTakip kullanan işletme sahibi finansal tabloları incelerken"
                  fill
                  priority
                  referrerPolicy="no-referrer"
                  className="object-cover"
                />
              </div>
            </div>
          </div>

          {/* 4-Column Summary Strip Below Hero */}
          <div className="mt-12 grid grid-cols-1 gap-4 border-t border-slate-200 pt-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Hedef İşletmeler</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                Bakkal, Büfe, Market ve Toptancı
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Finansal İzolasyon</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                Her İşletmeye Özel Şifreli Veritabanı
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Para Birimi &amp; Saat</p>
              <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">
                TRY (TL) · Europe/Istanbul
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Abonelik Modeli</p>
              <p className="mt-1 text-sm font-semibold text-emerald-700 tabular-nums">
                Tek Paket · Aylık {formatCurrencyTRY(plan.monthly_price)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Capabilities & Interactive UI Preview */}
      <section id="ozellikler" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-emerald-700">Neler Sunar?</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Karmaşık muhasebe terimleri olmadan tam finansal kontrol
          </h2>
          <p className="mt-3 text-base text-slate-600">
            İşletme sahibi sisteme girdiği anda kimden ne kadar alacağı olduğunu, kime ne zaman ödeme
            yapacağını ve aylık sabit gider yükünü tek bakışta görür.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Sol geniş kart: Canlı Arayüz Önizleme + Vadeli Satış Hesaplayıcı */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  01. Vadeli Satış ve Otomatik Vade Hesaplama Önizlemesi
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Vade süresini ay olarak seçin; sistem ay sonu günlerini dikkate alarak vade tarihini
                  hesaplar ve müşteri borcuna işler.
                </p>
              </div>
              <CalendarClock className="h-5 w-5 text-[#0F2942] shrink-0" />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Örnek Satış Tutarı (TL)
                </label>
                <input
                  type="number"
                  min={1000}
                  step={500}
                  value={previewAmount}
                  onChange={(e) => setPreviewAmount(Number(e.target.value) || 0)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-[#0F2942] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Vade Süresi (Ay)</label>
                <select
                  value={previewMonths}
                  onChange={(e) => setPreviewMonths(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                >
                  {[1, 2, 3, 4, 6, 9, 12].map((m) => (
                    <option key={m} value={m}>
                      {m} Ay Vade
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
                <p className="text-xs text-slate-500">Hesaplanan Vade Tarihi</p>
                <p className="mt-1 font-mono text-base font-bold text-[#0F2942] tabular-nums">
                  {formatDateTR(previewDueDate)}
                </p>
              </div>
            </div>

            <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-3.5 py-2.5 font-semibold">Örnek Cari Kaydı</th>
                    <th className="px-3.5 py-2.5 font-semibold">Satış Tarihi</th>
                    <th className="px-3.5 py-2.5 font-semibold">Vade</th>
                    <th className="px-3.5 py-2.5 font-semibold text-right">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="px-3.5 py-2.5 font-medium text-slate-900">Ahmet Yılmaz</td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-600 tabular-nums">
                      {formatDateTR(previewSaleDate)}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-amber-700 font-medium tabular-nums">
                      {formatDateTR(previewDueDate)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrencyTRY(previewAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Sağ kart: Toptancı & Alacak görselli */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
            <div>
              <div className="relative h-44 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                <Image
                  src={wholesaleDepotImg}
                  alt="Toptancı ve tedarikçi depo yönetimi"
                  fill
                  referrerPolicy="no-referrer"
                  className="object-cover"
                />
              </div>
              <h3 className="mt-5 text-base font-semibold text-slate-900">
                02. Toptancı Borçları ve Kısmi Ödemeler
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Toptancılara olan fatura ve cari borçlarınızı vade tarihleriyle kaydedin. Kısmi
                ödeme yaptığınızda kalan borç ve vadesi gelen tutar otomatik olarak düşer.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Truck className="h-4 w-4 text-[#0F2942]" /> Toptancı Hareketleri
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4 text-emerald-700" /> Müşteri Tahsilatları
              </span>
            </div>
          </div>

          {/* Alt sol kart: Sabit Giderler */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
            <div className="relative h-44 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
              <Image
                src={shopkeeperDeskImg}
                alt="Aylık sabit gider planlama ve fatura takibi"
                fill
                referrerPolicy="no-referrer"
                className="object-cover"
              />
            </div>
            <h3 className="mt-5 text-base font-semibold text-slate-900">
              03. Aylık Sabit Gider Planlama
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Kira, elektrik, su, internet ve personel giderlerinizi kart olarak tanımlayın.
              Ödenen dönemleri tek tıkla “Ödendi” işaretleyin; aynı ayın iki kez ödenmesi sistem
              tarafından engellenir.
            </p>
          </div>

          {/* Alt sağ kart: Yetkilendirme & Raporlama */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
            <div>
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    04. Gelir-Gider, CSV/Excel Raporları ve Yetkili Personel
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    11 farklı finansal raporu tarih aralığına göre inceleyin ve Excel uyumlu CSV
                    olarak indirin.
                  </p>
                </div>
                <Repeat className="h-5 w-5 text-emerald-700 shrink-0" />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-900">9 Kartlı Finansal Özet</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Toplam müşteri alacağı, toptancı borcu, vadesi gelenler, kasa özeti ve aylık
                    tahsilatlar anlık hesaplanır.
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-900">Modül Bazlı Personel Yetkisi</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Yalnızca görüntüleme yetkisi verdiğiniz kullanıcı kayıt silemez veya değiştiremez.
                    Yetkiler sunucuda doğrulanır.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500">
              <span>Ters kayıt mantığı ile güvenli finansal tutarlılık</span>
              <Link href="/basvuru" className="font-semibold text-[#0F2942] hover:underline">
                Hemen Başvur &rarr;
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Nasıl Çalışır (3 Adım) */}
      <section id="nasil-calisir" className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold text-emerald-700">Nasıl Çalışır?</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Üç adımda işletmenizi sisteme taşıyın
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-3">
            <div className="border-t border-slate-200 pt-5">
              <span className="font-mono text-xs font-semibold text-[#0F2942]">01. ADIM</span>
              <h3 className="mt-2 text-base font-semibold text-slate-900">
                İşletme Başvurusu Oluşturun
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Firma adı, yetkili bilgileri ve e-posta adresinizle 1 dakikada işletme hesabınızı
                oluşturun.
              </p>
            </div>
            <div className="border-t border-slate-200 pt-5">
              <span className="font-mono text-xs font-semibold text-[#0F2942]">02. ADIM</span>
              <h3 className="mt-2 text-base font-semibold text-slate-900">
                Havale / EFT ile Aboneliği Başlatın
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Ödeme ekranında yer alan banka IBAN bilgilerine abonelik tutarını gönderip dekont
                bildiriminde bulunun.
              </p>
            </div>
            <div className="border-t border-slate-200 pt-5">
              <span className="font-mono text-xs font-semibold text-[#0F2942]">03. ADIM</span>
              <h3 className="mt-2 text-base font-semibold text-slate-900">
                Cari ve Giderleri Yönetin
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Onay sonrası müşteri alacaklarını, toptancı borçlarını, vadeli satışları ve sabit
                giderleri anında takip edin.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Tek Abonelik Paketi Fiyatlandırması */}
      <section id="fiyatlandirma" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 sm:p-10">
          <div className="flex flex-col justify-between gap-6 border-b border-slate-200 pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-semibold text-emerald-700">Şeffaf Tek Paket Abonelik</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#0F2942] sm:text-3xl">
                {plan.name}
              </h2>
              <p className="mt-2 max-w-md text-sm text-slate-600">
                {settings.pricing_description || plan.description}
              </p>
            </div>
            <div className="sm:text-right shrink-0">
              <div className="font-mono text-3xl font-bold text-[#0F2942] tabular-nums sm:text-4xl">
                {formatCurrencyTRY(plan.monthly_price)}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {plan.duration_days} Günlük Abonelik · KDV Dahil
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {(plan.features ?? []).map((feat, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-sm text-slate-700">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <span>{feat}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-6">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" />
              <span>Banka Havalesi / EFT ile güvenli manuel onay süreci</span>
            </div>
            <Link
              href="/basvuru"
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-6 py-3 text-sm font-semibold text-white hover:bg-[#173B5E] transition-colors whitespace-nowrap"
            >
              <span>Hemen Başvuru Yap</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 5. Sık Sorulan Sorular */}
      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Sıkça Sorulan Sorular
          </h2>
          <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaqIdx === idx;
              return (
                <div key={idx} className="py-4">
                  <button
                    type="button"
                    onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 text-left text-sm font-semibold text-slate-900 hover:text-[#0F2942]"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. İletişim ve Footer */}
      <footer className="border-t border-slate-200 bg-[#0F2942] text-slate-200">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <div>
              <p className="text-lg font-bold text-white font-display">{settings.system_name}</p>
              <p className="mt-2 text-sm text-slate-300 leading-relaxed">{settings.hero_slogan}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-300">İletişim</p>
              <div className="mt-3 space-y-2 text-sm">
                <a
                  href={`mailto:${settings.contact_email}`}
                  className="flex items-center gap-2 text-slate-200 hover:text-white"
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  <span>{settings.contact_email}</span>
                </a>
                <div className="flex items-center gap-2 text-slate-200">
                  <Phone className="h-4 w-4 shrink-0" />
                  <span className="tabular-nums">{settings.contact_phone}</span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-300">Hızlı Erişim</p>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                <Link href="/giris" className="hover:text-white">
                  İşletme Girişi
                </Link>
                <Link href="/basvuru" className="hover:text-white">
                  Ücretsiz Başvuru
                </Link>
                <button
                  type="button"
                  onClick={() => setLegalModal('terms')}
                  className="text-left hover:text-white"
                >
                  Kullanım Koşulları
                </button>
                <button
                  type="button"
                  onClick={() => setLegalModal('privacy')}
                  className="text-left hover:text-white"
                >
                  Gizlilik Politikası
                </button>
              </div>
            </div>
          </div>
          <div className="mt-10 border-t border-slate-700/60 pt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
            <span>
              &copy; {new Date().getFullYear()} {settings.system_name}. Tüm hakları saklıdır.
            </span>
            <Link href="/admin" className="text-slate-400 hover:text-white">
              Sistem Yönetimi
            </Link>
          </div>
        </div>
      </footer>

      {legalModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {legalModal === 'terms' ? 'Kullanım Koşulları' : 'Gizlilik Politikası'}
              </h3>
              <button
                type="button"
                onClick={() => setLegalModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-600">
              {legalModal === 'terms' ? settings.terms_of_service : settings.privacy_policy}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
