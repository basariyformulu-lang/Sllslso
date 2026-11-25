'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, FileText, X } from 'lucide-react';
import {
  addMonthsToISODate,
  formatCurrencyTRY,
  formatDateTimeTR,
  formatDateTR,
  getIstanbulTodayISO,
} from '@/lib/format';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import type { PaymentRequest } from '@/lib/types';

export default function AdminPaymentRequestsPage() {
  const { showToast } = useToast();
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');

  const [approveTarget, setApproveTarget] = useState<PaymentRequest | null>(null);
  const [startDate, setStartDate] = useState(getIstanbulTodayISO());
  const [endDate, setEndDate] = useState(addMonthsToISODate(getIstanbulTodayISO(), 1));

  const [rejectTarget, setRejectTarget] = useState<PaymentRequest | null>(null);
  const [rejectedReason, setRejectedReason] = useState('');
  const [receiptPreview, setReceiptPreview] = useState<PaymentRequest | null>(null);
  const [processing, setProcessing] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payment-requests', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRequests(data.requests ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ödeme talepleri yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadRequests();
    });
    return () => {
      active = false;
    };
  }, [loadRequests]);

  const filtered = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  async function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    if (!approveTarget) return;
    setProcessing(true);
    try {
      const res = await fetch('/api/admin/payment-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          requestId: approveTarget.id,
          startDate,
          endDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Ödeme onaylanamadı', 'error');
        return;
      }
      showToast('Ödeme onaylandı ve işletme aboneliği aktif edildi', 'success');
      setApproveTarget(null);
      loadRequests();
    } finally {
      setProcessing(false);
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectTarget) return;
    setProcessing(true);
    try {
      const res = await fetch('/api/admin/payment-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          requestId: rejectTarget.id,
          rejectedReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Ödeme reddedilemedi', 'error');
        return;
      }
      showToast('Ödeme talebi reddedildi', 'info');
      setRejectTarget(null);
      setRejectedReason('');
      loadRequests();
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Ödeme Talepleri Yönetimi</h1>
        <p className="mt-1 text-sm text-slate-600">
          İşletmelerin havale / EFT ödeme bildirimlerini inceleyin, onaylayın veya reddedin
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 w-fit">
        {[
          { id: 'pending', label: 'Bekliyor' },
          { id: 'approved', label: 'Onaylandı' },
          { id: 'rejected', label: 'Reddedildi' },
          { id: 'all', label: 'Tümü' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id as typeof filter)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium ${
              filter === tab.id ? 'bg-[#0F2942] text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Seçili durumda ödeme talebi bulunmuyor.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">İşletme</th>
                  <th className="px-4 py-3 font-semibold">Ödeme Yapan</th>
                  <th className="px-4 py-3 font-semibold">Banka (Talep Anı)</th>
                  <th className="px-4 py-3 font-semibold">Ödeme Tarihi</th>
                  <th className="px-4 py-3 text-right font-semibold">Tutar</th>
                  <th className="px-4 py-3 font-semibold">Dekont</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">
                        {r.businesses?.name ?? '—'}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500">
                        {r.businesses?.business_code}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.payer_name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{r.bank_snapshot?.bank_name}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {r.bank_snapshot?.iban}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      <div>{formatDateTR(r.payment_date)}</div>
                      <div className="text-[11px] text-slate-400">
                        Talep: {formatDateTimeTR(r.created_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-[#0F2942] tabular-nums">
                      {formatCurrencyTRY(r.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {r.receipt_url ? (
                        <button
                          type="button"
                          onClick={() => setReceiptPreview(r)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#0F2942] hover:underline"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span>Görüntüle</span>
                        </button>
                      ) : (
                        <span className="text-slate-400">Yok</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText
                        label={
                          r.status === 'approved'
                            ? 'Onaylandı'
                            : r.status === 'rejected'
                            ? 'Reddedildi'
                            : 'Bekliyor'
                        }
                        tone={
                          r.status === 'approved'
                            ? 'success'
                            : r.status === 'rejected'
                            ? 'danger'
                            : 'warning'
                        }
                      />
                      {r.rejected_reason && (
                        <p className="mt-1 text-[11px] text-red-600">{r.rejected_reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.status === 'pending' && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const today = getIstanbulTodayISO();
                              setStartDate(today);
                              setEndDate(addMonthsToISODate(today, 1));
                              setApproveTarget(r);
                            }}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Onayla</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectedReason('');
                              setRejectTarget(r);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Reddet</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Onayla Modal */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Ödemeyi Onayla</h3>
              <button type="button" onClick={() => setApproveTarget(null)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleApprove} className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <p className="font-semibold text-slate-900">{approveTarget.businesses?.name}</p>
                <p className="mt-1 text-slate-600">
                  Tutar:{' '}
                  <span className="font-mono font-bold tabular-nums">
                    {formatCurrencyTRY(approveTarget.amount)}
                  </span>{' '}
                  · Gönderen: {approveTarget.payer_name}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Abonelik Başlangıç *
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Abonelik Bitiş *
                  </label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setApproveTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white"
                >
                  {processing ? 'Onaylanıyor...' : 'Ödemeyi Onayla ve Aktif Et'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reddet Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Ödeme Talebini Reddet</h3>
              <button type="button" onClick={() => setRejectTarget(null)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleReject} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Reddetme Sebebi *
                </label>
                <textarea
                  rows={3}
                  required
                  value={rejectedReason}
                  onChange={(e) => setRejectedReason(e.target.value)}
                  placeholder="İşletme sahibine gösterilecek açıklamayı yazınız..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="rounded-lg bg-red-600 px-5 py-2 text-xs font-semibold text-white"
                >
                  {processing ? 'Reddediliyor...' : 'Talebi Reddet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dekont Görüntüleme Modal */}
      {receiptPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Banka Dekontu — {receiptPreview.receipt_name || 'Belge'}
              </h3>
              <button
                type="button"
                onClick={() => setReceiptPreview(null)}
                className="p-1 text-slate-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4">
              {receiptPreview.receipt_url?.startsWith('data:image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={receiptPreview.receipt_url}
                  alt="Banka dekontu"
                  className="max-h-[60vh] w-full object-contain rounded-lg border border-slate-200"
                />
              ) : receiptPreview.receipt_url ? (
                <a
                  href={receiptPreview.receipt_url}
                  download={receiptPreview.receipt_name || 'dekont.pdf'}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white"
                >
                  Dekont Dosyasını İndir
                </a>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
