'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, Wallet, RotateCcw, X } from 'lucide-react';
import {
  formatCurrencyTRY,
  formatDateTR,
  getIstanbulTodayISO,
  PAYMENT_METHOD_LABELS,
} from '@/lib/format';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import type { CreditSale, Customer } from '@/lib/types';

interface CustomerTx {
  id: string;
  transaction_type: 'debt' | 'payment' | 'reversal';
  debt_category: string;
  amount: number;
  transaction_date: string;
  due_date: string | null;
  payment_method: string | null;
  description: string;
  notes: string;
  is_overpayment: boolean;
  is_cancelled: boolean;
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [transactions, setTransactions] = useState<CustomerTx[]>([]);
  const [creditSales, setCreditSales] = useState<CreditSale[]>([]);

  const [debtModal, setDebtModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [overpayConfirmOpen, setOverpayConfirmOpen] = useState(false);
  const [cancelTxId, setCancelTxId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [debtForm, setDebtForm] = useState({
    description: '',
    amount: '',
    transactionDate: getIstanbulTodayISO(),
    dueDate: '',
    debtCategory: 'Veresiye / Cari Borç',
    notes: '',
  });

  const [payForm, setPayForm] = useState({
    amount: '',
    transactionDate: getIstanbulTodayISO(),
    paymentMethod: 'nakit' as 'nakit' | 'banka' | 'kart' | 'diger',
    description: 'Müşteri tahsilatı',
    creditSaleId: '',
  });

  const [editForm, setEditForm] = useState({
    name: '',
    lastName: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
    isActive: true,
  });

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/panel/customers/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCustomer(data.customer);
      setTransactions(data.transactions ?? []);
      setCreditSales(data.creditSales ?? []);
      setEditForm({
        name: data.customer.name ?? '',
        lastName: data.customer.last_name ?? '',
        phone: data.customer.phone ?? '',
        email: data.customer.email ?? '',
        address: data.customer.address ?? '',
        notes: data.customer.notes ?? '',
        isActive: data.customer.is_active,
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Müşteri detayı yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadDetail();
    });
    return () => {
      active = false;
    };
  }, [loadDetail]);

  async function handleAddDebt(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/panel/customers/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_debt',
          ...debtForm,
          amount: Number(debtForm.amount),
          dueDate: debtForm.dueDate || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Borç eklenemedi', 'error');
        return;
      }
      showToast('Müşteriye borç eklendi', 'success');
      setDebtModal(false);
      setDebtForm({
        description: '',
        amount: '',
        transactionDate: getIstanbulTodayISO(),
        dueDate: '',
        debtCategory: 'Veresiye / Cari Borç',
        notes: '',
      });
      loadDetail();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPayment(allowOverpayment: boolean) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/panel/customers/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_payment',
          amount: Number(payForm.amount),
          transactionDate: payForm.transactionDate,
          paymentMethod: payForm.paymentMethod,
          description: payForm.description,
          creditSaleId: payForm.creditSaleId || null,
          allowOverpayment,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.requiresOverpaymentConfirm) {
        setOverpayConfirmOpen(true);
        return;
      }
      if (!res.ok) {
        showToast(data.error || 'Ödeme kaydedilemedi', 'error');
        return;
      }
      showToast('Tahsilat kaydedildi', 'success');
      setOverpayConfirmOpen(false);
      setPaymentModal(false);
      setPayForm({
        amount: '',
        transactionDate: getIstanbulTodayISO(),
        paymentMethod: 'nakit',
        description: 'Müşteri tahsilatı',
        creditSaleId: '',
      });
      loadDetail();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateCustomer(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/panel/customers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Güncelleme başarısız', 'error');
        return;
      }
      showToast('Müşteri bilgileri güncellendi', 'success');
      setEditModal(false);
      loadDetail();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReverseTransaction() {
    if (!cancelTxId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/panel/customers/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reverse_transaction',
          transactionId: cancelTxId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Hareket iptal edilemedi', 'error');
        return;
      }
      showToast('Hareket iptal edildi', 'info');
      setCancelTxId(null);
      loadDetail();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !customer) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded bg-slate-200 animate-pulse" />
        <div className="h-40 rounded-xl bg-slate-200 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/panel/musteriler"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F2942]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Müşterilere Dön</span>
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">
              {customer.name} {customer.last_name}
            </h1>
            <StatusText
              label={customer.is_active ? 'Aktif' : 'Pasif'}
              tone={customer.is_active ? 'success' : 'neutral'}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {customer.phone || 'Telefon yok'} · {customer.address || 'Adres belirtilmemiş'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditModal(true)}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Düzenle / Durum
          </button>
          <button
            type="button"
            onClick={() => setDebtModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Borç Ekle</span>
          </button>
          <button
            type="button"
            onClick={() => setPaymentModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            <Wallet className="h-3.5 w-3.5" />
            <span>Ödeme Al</span>
          </button>
        </div>
      </div>

      {/* Bakiye Kartları */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Toplam Borç (Açılış + Hareket)</p>
          <p className="mt-2 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {formatCurrencyTRY(customer.total_debt)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Toplam Tahsilat</p>
          <p className="mt-2 font-mono text-xl font-bold text-emerald-700 tabular-nums">
            {formatCurrencyTRY(customer.total_payment)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Güncel Kalan Alacak</p>
          <p
            className={`mt-2 font-mono text-xl font-bold tabular-nums ${
              (customer.current_balance ?? 0) > 0 ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {formatCurrencyTRY(customer.current_balance)}
          </p>
        </div>
      </div>

      {/* Cari Hareket Tablosu */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Borç ve Ödeme Hareketleri</h2>
        </div>

        {transactions.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            Henüz borç veya ödeme hareketi kaydedilmemiş.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Tarih</th>
                  <th className="px-4 py-3 font-semibold">Tür</th>
                  <th className="px-4 py-3 font-semibold">Açıklama</th>
                  <th className="px-4 py-3 font-semibold">Vade / Yöntem</th>
                  <th className="px-4 py-3 text-right font-semibold">Tutar</th>
                  <th className="px-4 py-3 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((t) => (
                  <tr key={t.id} className={t.is_cancelled ? 'opacity-50 line-through' : ''}>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {formatDateTR(t.transaction_date)}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {t.transaction_type === 'debt' ? (
                        <span className="text-red-700">Borç ({t.debt_category})</span>
                      ) : (
                        <span className="text-emerald-700">
                          Tahsilat {t.is_overpayment ? '(Fazla Ödeme)' : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{t.description}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {t.transaction_type === 'debt'
                        ? t.due_date
                          ? `Vade: ${formatDateTR(t.due_date)}`
                          : '—'
                        : PAYMENT_METHOD_LABELS[t.payment_method ?? 'nakit']}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${
                        t.transaction_type === 'debt' ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {t.transaction_type === 'debt' ? '+' : '-'}
                      {formatCurrencyTRY(t.amount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!t.is_cancelled && (
                        <button
                          type="button"
                          onClick={() => setCancelTxId(t.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-700"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>İptal Et</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Borç Ekle Modal */}
      {debtModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Müşteriye Borç Ekle</h3>
              <button type="button" onClick={() => setDebtModal(false)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleAddDebt} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Borç Açıklaması *</label>
                <input
                  type="text"
                  required
                  value={debtForm.description}
                  onChange={(e) => setDebtForm({ ...debtForm, description: e.target.value })}
                  placeholder="Örn: Haftalık veresiye ürün"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Borç Tutarı (TL) *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={debtForm.amount}
                    onChange={(e) => setDebtForm({ ...debtForm, amount: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Borç Türü</label>
                  <input
                    type="text"
                    value={debtForm.debtCategory}
                    onChange={(e) => setDebtForm({ ...debtForm, debtCategory: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">İşlem Tarihi *</label>
                  <input
                    type="date"
                    required
                    value={debtForm.transactionDate}
                    onChange={(e) => setDebtForm({ ...debtForm, transactionDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Vade Tarihi</label>
                  <input
                    type="date"
                    value={debtForm.dueDate}
                    onChange={(e) => setDebtForm({ ...debtForm, dueDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Not (İsteğe Bağlı)</label>
                <input
                  type="text"
                  value={debtForm.notes}
                  onChange={(e) => setDebtForm({ ...debtForm, notes: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDebtModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0F2942] px-5 py-2 text-xs font-semibold text-white"
                >
                  {submitting ? 'Kaydediliyor...' : 'Borcu Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ödeme Al Modal */}
      {paymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Müşteriden Ödeme Al</h3>
              <button
                type="button"
                onClick={() => setPaymentModal(false)}
                className="p-1 text-slate-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitPayment(false);
              }}
              className="mt-4 space-y-4"
            >
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs">
                Güncel Borç Bakiyesi:{' '}
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {formatCurrencyTRY(customer.current_balance)}
                </span>
              </div>

              {creditSales.filter((cs) => cs.total_amount > cs.paid_amount).length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Bağlı Vadeli Satış (İsteğe Bağlı)
                  </label>
                  <select
                    value={payForm.creditSaleId}
                    onChange={(e) => setPayForm({ ...payForm, creditSaleId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">Genel Cari Tahsilat</option>
                    {creditSales
                      .filter((cs) => cs.total_amount > cs.paid_amount)
                      .map((cs) => (
                        <option key={cs.id} value={cs.id}>
                          {cs.description} (Kalan:{' '}
                          {formatCurrencyTRY(cs.total_amount - cs.paid_amount)})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Ödeme Tutarı (TL) *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={payForm.amount}
                    onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Ödeme Tarihi *</label>
                  <input
                    type="date"
                    required
                    value={payForm.transactionDate}
                    onChange={(e) => setPayForm({ ...payForm, transactionDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Ödeme Yöntemi</label>
                <select
                  value={payForm.paymentMethod}
                  onChange={(e) =>
                    setPayForm({
                      ...payForm,
                      paymentMethod: e.target.value as typeof payForm.paymentMethod,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="nakit">Nakit</option>
                  <option value="banka">Banka / EFT</option>
                  <option value="kart">Kredi / Banka Kartı</option>
                  <option value="diger">Diğer</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Açıklama</label>
                <input
                  type="text"
                  value={payForm.description}
                  onChange={(e) => setPayForm({ ...payForm, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPaymentModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white"
                >
                  {submitting ? 'Kaydediliyor...' : 'Tahsilatı Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Düzenle Modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Müşteri Bilgilerini Düzenle</h3>
              <button type="button" onClick={() => setEditModal(false)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateCustomer} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Adı / Firma *</label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Soyadı</label>
                  <input
                    type="text"
                    value={editForm.lastName}
                    onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Telefon</label>
                <input
                  type="text"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Adres</label>
                <input
                  type="text"
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                />
                <span>Müşteri Aktif</span>
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0F2942] px-5 py-2 text-xs font-semibold text-white"
                >
                  Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fazla Ödeme Onayı */}
      <ConfirmDialog
        open={overpayConfirmOpen}
        title="Borçtan Fazla Ödeme Uyarısı"
        description={`Girilen tutar müşterinin mevcut borcundan (${formatCurrencyTRY(
          customer.current_balance
        )}) fazladır. Ayrı bir fazla ödeme kaydı olarak devam etmek istiyor musunuz?`}
        confirmLabel="Fazla Ödeme Olarak Kaydet"
        variant="primary"
        loading={submitting}
        onConfirm={() => submitPayment(true)}
        onCancel={() => setOverpayConfirmOpen(false)}
      />

      {/* Hareket İptal Onayı */}
      <ConfirmDialog
        open={Boolean(cancelTxId)}
        title="Cari Hareketi İptal Et"
        description="Finansal tutarlılık için kayıt silinmez, iptal olarak işaretlenir ve bakiye güncellenir. Onaylıyor musunuz?"
        confirmLabel="Hareketi İptal Et"
        loading={submitting}
        onConfirm={handleReverseTransaction}
        onCancel={() => setCancelTxId(null)}
      />
    </div>
  );
}
