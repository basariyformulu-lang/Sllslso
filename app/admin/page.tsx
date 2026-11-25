'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { formatCurrencyTRY, formatDateTR } from '@/lib/format';
import { AdminMonthlyCharts } from '@/components/ui/MiniCharts';
import { useToast } from '@/components/ToastProvider';

interface AdminOverviewData {
  metrics: {
    totalBusinesses: number;
    activeBusinesses: number;
    passiveBusinesses: number;
    paymentPendingBusinesses: number;
    pendingApprovalBusinesses: number;
    expiredBusinesses: number;
    activeThisMonthBusinesses: number;
    thisMonthCollectedPayments: number;
    thisMonthPendingPayments: number;
    expiringIn7DaysCount: number;
  };
  expiringSoonList: Array<{
    id: string;
    name: string;
    business_code: string;
    subscription_end_at: string;
  }>;
  monthlySeries: Array<{
    key: string;
    label: string;
    registrations: number;
    revenue: number;
  }>;
}

export default function AdminOverviewPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminOverviewData | null>(null);

  useEffect(() => {
    fetch('/api/admin/overview', { cache: 'no-store' })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error);
        setData(json);
      })
      .catch((e) => showToast(e.message || 'Yönetici verileri alınamadı', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 rounded bg-slate-200 animate-pulse" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div key={idx} className="h-24 rounded-xl bg-slate-200 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const m = data.metrics;
  const kpis = [
    { label: 'Toplam Kayıtlı İşletme', value: m.totalBusinesses, href: '/admin/isletmeler' },
    { label: 'Aktif İşletmeler', value: m.activeBusinesses, href: '/admin/isletmeler?durum=active', tone: 'text-emerald-700' },
    { label: 'Pasif İşletmeler', value: m.passiveBusinesses, href: '/admin/isletmeler?durum=passive' },
    { label: 'Ödeme Bekleyen İşletme', value: m.paymentPendingBusinesses, href: '/admin/isletmeler?durum=payment_pending', tone: 'text-amber-700' },
    { label: 'Ödeme Onayı Bekleyen', value: m.pendingApprovalBusinesses, href: '/admin/odeme-talepleri', tone: 'text-amber-700' },
    { label: 'Aboneliği Sona Erenler', value: m.expiredBusinesses, href: '/admin/isletmeler?durum=expired', tone: 'text-red-700' },
    { label: 'Bu Ay Aktif Abonelik', value: m.activeThisMonthBusinesses, href: '/admin/isletmeler?durum=active' },
    {
      label: 'Bu Ay Alınan Abonelik Ödemesi',
      value: formatCurrencyTRY(m.thisMonthCollectedPayments),
      href: '/admin/odeme-talepleri',
      tone: 'text-emerald-700',
    },
    {
      label: 'Bekleyen Ödeme Tutarı',
      value: formatCurrencyTRY(m.thisMonthPendingPayments),
      href: '/admin/odeme-talepleri',
      tone: 'text-amber-700',
    },
    {
      label: '7 Gün İçinde Bitecek Abonelikler',
      value: m.expiringIn7DaysCount,
      href: '/admin/isletmeler',
      tone: m.expiringIn7DaysCount > 0 ? 'text-red-700' : 'text-slate-900',
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Yönetici Ana Ekranı</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sistem geneli işletme, abonelik ve ödeme hareketleri özeti
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className="group rounded-xl border border-slate-200 bg-white p-4 hover:border-[#0F2942] transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-slate-500">{k.label}</p>
              <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#0F2942] shrink-0" />
            </div>
            <p className={`mt-2.5 font-mono text-xl font-bold tabular-nums ${k.tone || 'text-slate-900'}`}>
              {k.value}
            </p>
          </Link>
        ))}
      </div>

      <AdminMonthlyCharts series={data.monthlySeries} />

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          Aboneliği Önümüzdeki 7 Gün İçinde Sona Erecek İşletmeler
        </h2>
        {data.expiringSoonList.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            Önümüzdeki 7 gün içinde süresi dolacak aktif abonelik bulunmuyor.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">İşletme Adı</th>
                  <th className="px-4 py-2.5 font-semibold">İşletme Kodu</th>
                  <th className="px-4 py-2.5 font-semibold">Bitiş Tarihi</th>
                  <th className="px-4 py-2.5 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.expiringSoonList.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{b.name}</td>
                    <td className="px-4 py-2.5 font-mono">{b.business_code}</td>
                    <td className="px-4 py-2.5 font-mono text-red-700 font-medium tabular-nums">
                      {formatDateTR(b.subscription_end_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/admin/isletmeler/${b.id}`}
                        className="font-semibold text-[#0F2942] hover:underline"
                      >
                        Yönet
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
