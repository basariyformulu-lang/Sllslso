'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  downloadCSV,
  formatCurrencyTRY,
  formatDateTR,
  getIstanbulMonthBounds,
  getIstanbulTodayISO,
} from '@/lib/format';
import { useToast } from '@/components/ToastProvider';

type ReportKey =
  | 'daily'
  | 'monthly'
  | 'customer_receivables'
  | 'supplier_debts'
  | 'due_receivables'
  | 'due_payables'
  | 'collections'
  | 'supplier_payments'
  | 'recurring_summary'
  | 'recurring_realized'
  | 'movements';

const REPORT_TABS: Array<{ key: ReportKey; label: string }> = [
  { key: 'daily', label: 'Günlük Gelir/Gider' },
  { key: 'monthly', label: 'Aylık Gelir/Gider' },
  { key: 'customer_receivables', label: 'Müşteri Alacakları' },
  { key: 'supplier_debts', label: 'Toptancı Borçları' },
  { key: 'due_receivables', label: 'Vadesi Gelen Alacaklar' },
  { key: 'due_payables', label: 'Vadesi Gelen Borçlar' },
  { key: 'collections', label: 'Tahsilat Geçmişi' },
  { key: 'supplier_payments', label: 'Ödeme Geçmişi' },
  { key: 'recurring_summary', label: 'Aylık Sabit Gider Özeti' },
  { key: 'recurring_realized', label: 'Gerçekleşen Sabit Giderler' },
  { key: 'movements', label: 'Finansal Hareketler' },
];

export default function ReportsPage() {
  const { showToast } = useToast();
  const { start: defaultStart } = getIstanbulMonthBounds();
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(getIstanbulTodayISO());
  const [activeTab, setActiveTab] = useState<ReportKey>('daily');
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState<any>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/panel/reports?startDate=${startDate}&endDate=${endDate}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReportData(data);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Raporlar yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadReports();
    });
    return () => {
      active = false;
    };
  }, [loadReports]);

  function handleExportCSV() {
    if (!reportData) return;
    if (activeTab === 'daily') {
      downloadCSV(
        `gunluk-gelir-gider-${startDate}-${endDate}`,
        ['Tarih', 'Gelir (TL)', 'Gider (TL)', 'Net (TL)'],
        reportData.dailySummary.map((r: { date: string; income: number; expense: number }) => [
          formatDateTR(r.date),
          r.income,
          r.expense,
          r.income - r.expense,
        ])
      );
    } else if (activeTab === 'monthly') {
      downloadCSV(
        `aylik-gelir-gider-${startDate}-${endDate}`,
        ['Ay', 'Gelir (TL)', 'Gider (TL)', 'Net (TL)'],
        reportData.monthlySummary.map((r: { month: string; income: number; expense: number }) => [
          r.month,
          r.income,
          r.expense,
          r.income - r.expense,
        ])
      );
    } else if (activeTab === 'customer_receivables') {
      downloadCSV(
        'musteri-alacak-raporu',
        ['Müşteri', 'Telefon', 'Toplam Borç', 'Toplam Ödeme', 'Kalan Alacak'],
        reportData.customerReport.map(
          (r: { name: string; phone: string; totalDebt: number; totalPayment: number; balance: number }) => [
            r.name,
            r.phone,
            r.totalDebt,
            r.totalPayment,
            r.balance,
          ]
        )
      );
    } else if (activeTab === 'supplier_debts') {
      downloadCSV(
        'toptanci-borc-raporu',
        ['Toptancı', 'Telefon', 'Toplam Borç', 'Yapılan Ödeme', 'Kalan Borç'],
        reportData.supplierReport.map(
          (r: { companyName: string; phone: string; totalDebt: number; totalPayment: number; balance: number }) => [
            r.companyName,
            r.phone,
            r.totalDebt,
            r.totalPayment,
            r.balance,
          ]
        )
      );
    } else if (activeTab === 'due_receivables') {
      downloadCSV(
        'vadesi-gelen-alacaklar',
        ['Müşteri', 'Açıklama', 'Vade Tarihi', 'Kalan Tutar'],
        reportData.dueReceivables.map(
          (r: { customerName: string; description: string; dueDate: string; remainingAmount: number }) => [
            r.customerName,
            r.description,
            formatDateTR(r.dueDate),
            r.remainingAmount,
          ]
        )
      );
    } else if (activeTab === 'due_payables') {
      downloadCSV(
        'vadesi-gelen-borclar',
        ['Toptancı', 'Açıklama', 'Vade Tarihi', 'Tutar'],
        reportData.duePayables.map(
          (r: { supplierName: string; description: string; dueDate: string; amount: number }) => [
            r.supplierName,
            r.description,
            formatDateTR(r.dueDate),
            r.amount,
          ]
        )
      );
    } else if (activeTab === 'collections') {
      downloadCSV(
        'tahsilat-gecmisi',
        ['Tarih', 'Müşteri', 'Açıklama', 'Tutar'],
        reportData.collectionHistory.map(
          (r: {
            transaction_date: string;
            description: string;
            amount: number;
            customer?: { name: string; last_name: string };
          }) => [
            formatDateTR(r.transaction_date),
            r.customer ? `${r.customer.name} ${r.customer.last_name}`.trim() : '—',
            r.description,
            r.amount,
          ]
        )
      );
    } else if (activeTab === 'supplier_payments') {
      downloadCSV(
        'toptanci-odeme-gecmisi',
        ['Tarih', 'Toptancı', 'Açıklama', 'Tutar'],
        reportData.supplierPaymentHistory.map(
          (r: {
            transaction_date: string;
            description: string;
            amount: number;
            supplier?: { company_name: string };
          }) => [
            formatDateTR(r.transaction_date),
            r.supplier?.company_name ?? '—',
            r.description,
            r.amount,
          ]
        )
      );
    } else if (activeTab === 'recurring_summary') {
      downloadCSV(
        'aylik-sabit-gider-ozeti',
        ['Kategori', 'Gider Adı', 'Aylık Tutar', 'Ödeme Günü'],
        reportData.recurringSummary.map(
          (r: { category: string; title: string; monthly_amount: number; payment_day: number }) => [
            r.category,
            r.title,
            r.monthly_amount,
            r.payment_day,
          ]
        )
      );
    } else if (activeTab === 'recurring_realized') {
      downloadCSV(
        'gerceklesen-sabit-giderler',
        ['Dönem', 'Gider', 'Ödeme Tarihi', 'Ödenen Tutar'],
        reportData.recurringRealized.map(
          (r: {
            period_month: number;
            period_year: number;
            paid_date: string;
            paid_amount: number;
            recurring_expense?: { title: string };
          }) => [
            `${r.period_month}.${r.period_year}`,
            r.recurring_expense?.title ?? '—',
            formatDateTR(r.paid_date),
            r.paid_amount,
          ]
        )
      );
    } else {
      downloadCSV(
        `finansal-hareketler-${startDate}-${endDate}`,
        ['Tarih', 'İşlem Türü', 'Taraf / Kategori', 'Açıklama', 'Yön', 'Tutar'],
        reportData.allMovements.map(
          (r: {
            date: string;
            type: string;
            party: string;
            description: string;
            direction: string;
            amount: number;
          }) => [formatDateTR(r.date), r.type, r.party, r.description, r.direction, r.amount]
        )
      );
    }
    showToast('CSV raporu indirildi', 'success');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Finansal Raporlar</h1>
          <p className="mt-1 text-sm text-slate-600">
            Tarih aralığına göre detaylı cari, gelir-gider ve sabit gider raporları
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCSV}
          disabled={!reportData}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          <span>CSV / Excel İndir</span>
        </button>
      </div>

      {/* Tarih Aralığı */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600">Başlangıç Tarihi</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Bitiş Tarihi</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
      </div>

      {/* 11 Rapor Sekmesi */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-2">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-[#0F2942] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Rapor Tablosu */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading || !reportData ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {activeTab === 'daily' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Tarih</th>
                    <th className="px-4 py-3 text-right font-semibold">Gelir</th>
                    <th className="px-4 py-3 text-right font-semibold">Gider</th>
                    <th className="px-4 py-3 text-right font-semibold">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.dailySummary.map(
                    (r: { date: string; income: number; expense: number }) => (
                      <tr key={r.date}>
                        <td className="px-4 py-3 font-mono tabular-nums">
                          {formatDateTR(r.date)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700 tabular-nums">
                          {formatCurrencyTRY(r.income)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-red-700 tabular-nums">
                          {formatCurrencyTRY(r.expense)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                          {formatCurrencyTRY(r.income - r.expense)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'monthly' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Ay</th>
                    <th className="px-4 py-3 text-right font-semibold">Gelir</th>
                    <th className="px-4 py-3 text-right font-semibold">Gider</th>
                    <th className="px-4 py-3 text-right font-semibold">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.monthlySummary.map(
                    (r: { month: string; income: number; expense: number }) => (
                      <tr key={r.month}>
                        <td className="px-4 py-3 font-mono tabular-nums">{r.month}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700 tabular-nums">
                          {formatCurrencyTRY(r.income)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-red-700 tabular-nums">
                          {formatCurrencyTRY(r.expense)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                          {formatCurrencyTRY(r.income - r.expense)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'customer_receivables' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Müşteri</th>
                    <th className="px-4 py-3 font-semibold">Telefon</th>
                    <th className="px-4 py-3 text-right font-semibold">Toplam Borç</th>
                    <th className="px-4 py-3 text-right font-semibold">Toplam Tahsilat</th>
                    <th className="px-4 py-3 text-right font-semibold">Kalan Alacak</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.customerReport.map(
                    (r: {
                      id: string;
                      name: string;
                      phone: string;
                      totalDebt: number;
                      totalPayment: number;
                      balance: number;
                    }) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-semibold">{r.name}</td>
                        <td className="px-4 py-3 font-mono">{r.phone || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {formatCurrencyTRY(r.totalDebt)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700 tabular-nums">
                          {formatCurrencyTRY(r.totalPayment)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-red-700 tabular-nums">
                          {formatCurrencyTRY(r.balance)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'supplier_debts' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Toptancı</th>
                    <th className="px-4 py-3 font-semibold">Telefon</th>
                    <th className="px-4 py-3 text-right font-semibold">Toplam Borç</th>
                    <th className="px-4 py-3 text-right font-semibold">Yapılan Ödeme</th>
                    <th className="px-4 py-3 text-right font-semibold">Kalan Borç</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.supplierReport.map(
                    (r: {
                      id: string;
                      companyName: string;
                      phone: string;
                      totalDebt: number;
                      totalPayment: number;
                      balance: number;
                    }) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-semibold">{r.companyName}</td>
                        <td className="px-4 py-3 font-mono">{r.phone || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {formatCurrencyTRY(r.totalDebt)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700 tabular-nums">
                          {formatCurrencyTRY(r.totalPayment)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-red-700 tabular-nums">
                          {formatCurrencyTRY(r.balance)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'due_receivables' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Müşteri</th>
                    <th className="px-4 py-3 font-semibold">Açıklama</th>
                    <th className="px-4 py-3 font-semibold">Vade Tarihi</th>
                    <th className="px-4 py-3 text-right font-semibold">Kalan Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.dueReceivables.map(
                    (r: {
                      id: string;
                      customerName: string;
                      description: string;
                      dueDate: string;
                      remainingAmount: number;
                      isOverdue: boolean;
                    }) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-semibold">{r.customerName}</td>
                        <td className="px-4 py-3">{r.description}</td>
                        <td
                          className={`px-4 py-3 font-mono tabular-nums ${
                            r.isOverdue ? 'text-red-700 font-semibold' : ''
                          }`}
                        >
                          {formatDateTR(r.dueDate)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                          {formatCurrencyTRY(r.remainingAmount)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'due_payables' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Toptancı</th>
                    <th className="px-4 py-3 font-semibold">Açıklama</th>
                    <th className="px-4 py-3 font-semibold">Vade Tarihi</th>
                    <th className="px-4 py-3 text-right font-semibold">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.duePayables.map(
                    (r: {
                      id: string;
                      supplierName: string;
                      description: string;
                      dueDate: string;
                      amount: number;
                    }) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-semibold">{r.supplierName}</td>
                        <td className="px-4 py-3">{r.description}</td>
                        <td className="px-4 py-3 font-mono tabular-nums">
                          {formatDateTR(r.dueDate)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                          {formatCurrencyTRY(r.amount)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'collections' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Tarih</th>
                    <th className="px-4 py-3 font-semibold">Müşteri</th>
                    <th className="px-4 py-3 font-semibold">Açıklama</th>
                    <th className="px-4 py-3 text-right font-semibold">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.collectionHistory.map(
                    (r: {
                      id: string;
                      transaction_date: string;
                      description: string;
                      amount: number;
                      customer?: { name: string; last_name: string };
                    }) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-mono tabular-nums">
                          {formatDateTR(r.transaction_date)}
                        </td>
                        <td className="px-4 py-3 font-semibold">
                          {r.customer ? `${r.customer.name} ${r.customer.last_name}`.trim() : '—'}
                        </td>
                        <td className="px-4 py-3">{r.description}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700 tabular-nums">
                          {formatCurrencyTRY(r.amount)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'supplier_payments' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Tarih</th>
                    <th className="px-4 py-3 font-semibold">Toptancı</th>
                    <th className="px-4 py-3 font-semibold">Açıklama</th>
                    <th className="px-4 py-3 text-right font-semibold">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.supplierPaymentHistory.map(
                    (r: {
                      id: string;
                      transaction_date: string;
                      description: string;
                      amount: number;
                      supplier?: { company_name: string };
                    }) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-mono tabular-nums">
                          {formatDateTR(r.transaction_date)}
                        </td>
                        <td className="px-4 py-3 font-semibold">
                          {r.supplier?.company_name ?? '—'}
                        </td>
                        <td className="px-4 py-3">{r.description}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-red-700 tabular-nums">
                          {formatCurrencyTRY(r.amount)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'recurring_summary' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Kategori</th>
                    <th className="px-4 py-3 font-semibold">Sabit Gider Adı</th>
                    <th className="px-4 py-3 font-semibold">Ödeme Günü</th>
                    <th className="px-4 py-3 text-right font-semibold">Aylık Planlanan Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.recurringSummary.map(
                    (r: {
                      id: string;
                      category: string;
                      title: string;
                      payment_day: number;
                      monthly_amount: number;
                    }) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3">{r.category}</td>
                        <td className="px-4 py-3 font-semibold">{r.title}</td>
                        <td className="px-4 py-3">Her ayın {r.payment_day}. günü</td>
                        <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                          {formatCurrencyTRY(r.monthly_amount)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'recurring_realized' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Dönem</th>
                    <th className="px-4 py-3 font-semibold">Gider</th>
                    <th className="px-4 py-3 font-semibold">Ödeme Tarihi</th>
                    <th className="px-4 py-3 text-right font-semibold">Ödenen Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.recurringRealized.map(
                    (r: {
                      id: string;
                      period_month: number;
                      period_year: number;
                      paid_date: string;
                      paid_amount: number;
                      recurring_expense?: { title: string; category: string };
                    }) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-mono tabular-nums">
                          {String(r.period_month).padStart(2, '0')}.{r.period_year}
                        </td>
                        <td className="px-4 py-3 font-semibold">
                          {r.recurring_expense?.title ?? '—'}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums">
                          {formatDateTR(r.paid_date)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                          {formatCurrencyTRY(r.paid_amount)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'movements' && (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Tarih</th>
                    <th className="px-4 py-3 font-semibold">İşlem Türü</th>
                    <th className="px-4 py-3 font-semibold">Taraf / Kategori</th>
                    <th className="px-4 py-3 font-semibold">Açıklama</th>
                    <th className="px-4 py-3 text-right font-semibold">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.allMovements.map(
                    (r: {
                      id: string;
                      date: string;
                      type: string;
                      party: string;
                      description: string;
                      direction: '+' | '-';
                      amount: number;
                    }) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-mono tabular-nums">
                          {formatDateTR(r.date)}
                        </td>
                        <td className="px-4 py-3 font-medium">{r.type}</td>
                        <td className="px-4 py-3 text-slate-600">{r.party}</td>
                        <td className="px-4 py-3">{r.description}</td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${
                            r.direction === '+' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {r.direction}
                          {formatCurrencyTRY(r.amount)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
