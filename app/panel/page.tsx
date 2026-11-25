'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarClock,
  AlertCircle,
} from 'lucide-react';
import { formatCurrencyTRY, formatDateTR } from '@/lib/format';

interface OverviewData {
  cards: {
    totalCustomerReceivable: number;
    totalSupplierDebt: number;
    dueReceivables: number;
    dueSupplierDebt: number;
    monthlyRecurringTotal: number;
    thisMonthExpenses: number;
    thisMonthCollections: number;
    thisMonthSupplierPayments: number;
    cashSummary: number;
  };
  upcomingCreditSales: Array<{
    id: string;
    description: string;
    total_amount: number;
    paid_amount: number;
    due_date: string;
    customer?: { name: string; last_name: string };
  }>;
}

export default function PanelOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/panel/overview', { cache: 'no-store' })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || 'Veriler yüklenemedi.');
        setData(json);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-56 rounded-lg bg-slate-200 animate-pulse" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, idx) => (
            <div key={idx} className="h-28 rounded-xl bg-slate-200 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-white p-6 text-sm text-red-700">
        {error || 'Genel bakış verileri alınamadı.'}
      </div>
    );
  }

  const c = data.cards;

  const summaryCards = [
    {
      title: 'Toplam Müşteri Alacağı',
      value: formatCurrencyTRY(c.totalCustomerReceivable),
      subtitle: 'Tüm müşterilerin işletmeye güncel borcu',
      href: '/panel/musteriler',
      tone: 'text-emerald-700',
    },
    {
      title: 'Toplam Toptancı Borcu',
      value: formatCurrencyTRY(c.totalSupplierDebt),
      subtitle: 'Toptancı ve tedarikçilere güncel borç',
      href: '/panel/toptancilar',
      tone: 'text-red-700',
    },
    {
      title: 'Vadesi Gelen Alacaklar',
      value: formatCurrencyTRY(c.dueReceivables),
      subtitle: 'Bugün ve geçmiş vadeli tahsil edilmemiş alacaklar',
      href: '/panel/vadeli-satislar?filtre=vadesi_gelmis',
      tone: c.dueReceivables > 0 ? 'text-amber-700' : 'text-slate-900',
    },
    {
      title: 'Vadesi Gelen Borçlar',
      value: formatCurrencyTRY(c.dueSupplierDebt),
      subtitle: 'Bugün ve geçmiş vadeli ödenmemiş toptancı borçları',
      href: '/panel/toptancilar?filtre=vadesi_gelen',
      tone: c.dueSupplierDebt > 0 ? 'text-red-700' : 'text-slate-900',
    },
    {
      title: 'Aylık Sabit Giderler',
      value: formatCurrencyTRY(c.monthlyRecurringTotal),
      subtitle: 'Planlanan aylık sabit gider yükü (tahmini)',
      href: '/panel/sabit-giderler',
      tone: 'text-[#0F2942]',
    },
    {
      title: 'Bu Ay Gerçekleşen Giderler',
      value: formatCurrencyTRY(c.thisMonthExpenses),
      subtitle: 'İlgili ayda ödenmiş/kaydedilmiş gerçek giderler',
      href: '/panel/giderler',
      tone: 'text-slate-900',
    },
    {
      title: 'Bu Ay Tahsil Edilen',
      value: formatCurrencyTRY(c.thisMonthCollections),
      subtitle: 'Müşterilerden bu ay alınan toplam tahsilat',
      href: '/panel/musteriler',
      tone: 'text-emerald-700',
    },
    {
      title: 'Bu Ay Yapılan Toptancı Ödemeleri',
      value: formatCurrencyTRY(c.thisMonthSupplierPayments),
      subtitle: 'Toptancılara bu ay yapılan toplam ödeme',
      href: '/panel/toptancilar',
      tone: 'text-slate-900',
    },
    {
      title: 'Kasa Özeti',
      value: formatCurrencyTRY(c.cashSummary),
      subtitle: 'Sistemde kayıtlı nakit giriş ve çıkış bakiyesi',
      href: '/panel/raporlar',
      tone: c.cashSummary >= 0 ? 'text-emerald-700' : 'text-red-700',
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Genel Bakış</h1>
          <p className="mt-1 text-sm text-slate-600">
            İşletmenizin güncel alacak, borç, vade ve kasa özeti
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/panel/vadeli-satislar"
            className="rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173B5E] whitespace-nowrap"
          >
            + Yeni Vadeli Satış
          </Link>
          <Link
            href="/panel/musteriler"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            Müşteri Tahsilatı Al
          </Link>
        </div>
      </div>

      {/* 9 Tıklanabilir Finansal Özet Kartı */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaryCards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="group rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-[#0F2942]"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium text-slate-600">{card.title}</p>
              <ArrowUpRight className="h-4 w-4 text-slate-400 group-hover:text-[#0F2942] shrink-0" />
            </div>
            <p className={`mt-3 font-mono text-2xl font-bold tabular-nums ${card.tone}`}>
              {card.value}
            </p>
            <p className="mt-2 text-xs text-slate-500">{card.subtitle}</p>
          </Link>
        ))}
      </div>

      {/* Yaklaşan ve Gecikmiş Vadeler */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-[#0F2942]" />
            <h2 className="text-sm font-semibold text-slate-900">
              Vadesi Yaklaşan veya Gecikmiş Vadeli Satışlar
            </h2>
          </div>
          <Link
            href="/panel/vadeli-satislar"
            className="text-xs font-semibold text-[#0F2942] hover:underline whitespace-nowrap"
          >
            Tümünü Gör
          </Link>
        </div>

        {data.upcomingCreditSales.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Önümüzdeki 7 gün içinde vadesi gelen veya gecikmiş vadeli satış bulunmuyor.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Müşteri</th>
                  <th className="py-2 pr-4 font-semibold">Açıklama</th>
                  <th className="py-2 pr-4 font-semibold">Vade Tarihi</th>
                  <th className="py-2 text-right font-semibold">Kalan Tutar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.upcomingCreditSales.map((cs) => {
                  const rem = Number(cs.total_amount) - Number(cs.paid_amount);
                  return (
                    <tr key={cs.id}>
                      <td className="py-2.5 pr-4 font-medium text-slate-900">
                        {cs.customer ? `${cs.customer.name} ${cs.customer.last_name}`.trim() : '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">{cs.description}</td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums text-amber-700 font-medium">
                        <span className="inline-flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {formatDateTR(cs.due_date)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {formatCurrencyTRY(rem)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
