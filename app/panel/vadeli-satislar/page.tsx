'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Wallet, X, RotateCcw } from 'lucide-react';
import {
  addMonthsToISODate,
  formatCurrencyTRY,
  formatDateTR,
  getIstanbulTodayISO,
} from '@/lib/format';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { getCreditSaleStatusDisplay, StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';

interface CreditSaleRow {
  id: string;
  customer_id: string;
  description: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  sale_date: string;
  due_months: number | null;
  due_date: string;
  computed_status: string;
  customer?: { id: string; name: string; last_name: string; phone: string };
}

export default function CreditSalesPage() {
  const { showToast } = useToast();
  const [sales, setSales] = useState<CreditSaleRow[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; last_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [dueMode, setDueMode] = useState<'months' | 'date'>('months');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customerId: '',
    description: '',
    totalAmount: '',
    saleDate: getIstanbulTodayISO(),
    dueMonths: '4',
    dueDate: '',
    notes: '',
  });

  const [collectTarget, setCollectTarget] = useState<CreditSaleRow | null>(null);
  const [collectForm, setCollectForm] = useState({
    amount: '',
    paymentDate: getIstanbulTodayISO(),
    paymentMethod: 'nakit' as 'nakit' | 'banka' | 'kart' | 'diger',
    description: '',
  });
  const [cancelId, setCancelId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/credit-sales', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSales(data.creditSales ?? []);
      setCustomers(data.customers ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Vadeli satışlar yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const f = new URLSearchParams(window.location.search).get('filtre');
      if (f && ['all', 'vadesi_gelmis', 'vadesi_gelmedi', 'kismen_tahsil', 'tahsil_edildi'].includes(f)) {
        setStatusFilter(f);
      }
      void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  const computedDuePreview = useMemo(() => {
    if (dueMode === 'date') return form.dueDate || '—';
    const m = Number(form.dueMonths);
    if (!m || m < 1) return '—';
    return addMonthsToISODate(form.saleDate, m);
  }, [dueMode, form.dueDate, form.dueMonths, form.saleDate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (statusFilter === 'vadesi_gelmis') {
        if (s.computed_status !== 'gecikmis' && s.computed_status !== 'vadesi_geldi') return false;
      } else if (statusFilter !== 'all' && s.computed_status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const cName = s.customer ? `${s.customer.name} ${s.customer.last_name}` : '';
      return `${cName} ${s.description}`.toLowerCase().includes(q);
    });
  }, [sales, search, statusFilter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/panel/credit-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: form.customerId,
          description: form.description,
          totalAmount: Number(form.totalAmount),
          saleDate: form.saleDate,
          dueMonths: dueMode === 'months' ? Number(form.dueMonths) : null,
          dueDate: dueMode === 'date' ? form.dueDate : null,
          notes: form.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Vadeli satış oluşturulamadı', 'error');
        return;
      }
      showToast('Vadeli satış kaydedildi ve müşteri borcuna işlendi', 'success');
      setCreateOpen(false);
      setForm({
        customerId: '',
        description: '',
        totalAmount: '',
        saleDate: getIstanbulTodayISO(),
        dueMonths: '4',
        dueDate: '',
        notes: '',
      });
      loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handleCollect(e: React.FormEvent) {
    e.preventDefault();
    if (!collectTarget) return;
    setSaving(true);
    try {
      const res = await fetch('/api/panel/credit-sales', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'collect_payment',
          id: collectTarget.id,
          amount: Number(collectForm.amount),
          paymentDate: collectForm.paymentDate,
          paymentMethod: collectForm.paymentMethod,
          description: collectForm.description || `${collectTarget.description} tahsilatı`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Tahsilat kaydedilemedi', 'error');
        return;
      }
      showToast('Vadeli satış tahsilatı kaydedildi', 'success');
      setCollectTarget(null);
      loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!cancelId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/panel/credit-sales', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', id: cancelId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Vadeli satış iptal edilemedi', 'error');
        return;
      }
      showToast('Vadeli satış iptal edildi', 'info');
      setCancelId(null);
      loadData();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Vadeli Satışlar</h1>
          <p className="mt-1 text-sm text-slate-600">
            Ay veya tarih bazlı vade takibi, kısmi tahsilat ve gecikme uyarıları
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E]"
        >
          <Plus className="h-4 w-4" />
          <span>Yeni Vadeli Satış</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Müşteri veya satış açıklaması ara..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          {[
            { id: 'all', label: 'Tümü' },
            { id: 'vadesi_gelmis', label: 'Vadesi Gelen / Gecikmiş' },
            { id: 'vadesi_gelmedi', label: 'Vadesi Gelmedi' },
            { id: 'kismen_tahsil', label: 'Kısmen Tahsil' },
            { id: 'tahsil_edildi', label: 'Tamamen Tahsil' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                statusFilter === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
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
            Seçili filtreye uygun vadeli satış bulunamadı.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Müşteri</th>
                  <th className="px-4 py-3 font-semibold">Satış Açıklaması</th>
                  <th className="px-4 py-3 font-semibold">Satış Tarihi</th>
                  <th className="px-4 py-3 font-semibold">Vade Tarihi</th>
                  <th className="px-4 py-3 text-right font-semibold">Satış Tutarı</th>
                  <th className="px-4 py-3 text-right font-semibold">Tahsil Edilen</th>
                  <th className="px-4 py-3 text-right font-semibold">Kalan</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => {
                  const st = getCreditSaleStatusDisplay(s.computed_status);
                  return (
                    <tr key={s.id}>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {s.customer ? `${s.customer.name} ${s.customer.last_name}`.trim() : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{s.description}</td>
                      <td className="px-4 py-3 font-mono tabular-nums">
                        {formatDateTR(s.sale_date)}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums font-medium">
                        {formatDateTR(s.due_date)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatCurrencyTRY(s.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700">
                        {formatCurrencyTRY(s.paid_amount)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-slate-900">
                        {formatCurrencyTRY(s.remaining_amount)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText label={st.label} tone={st.tone} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {s.remaining_amount > 0 && s.computed_status !== 'iptal' && (
                            <button
                              type="button"
                              onClick={() => {
                                setCollectTarget(s);
                                setCollectForm({
                                  amount: String(s.remaining_amount),
                                  paymentDate: getIstanbulTodayISO(),
                                  paymentMethod: 'nakit',
                                  description: `${s.description} tahsilatı`,
                                });
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800"
                            >
                              <Wallet className="h-3 w-3" />
                              <span>Tahsil Et</span>
                            </button>
                          )}
                          {s.computed_status !== 'iptal' && (
                            <button
                              type="button"
                              onClick={() => setCancelId(s.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-red-700"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>İptal</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Yeni Vadeli Satış Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-semibold text-slate-900">Yeni Vadeli Satış Oluştur</h2>
              <button type="button" onClick={() => setCreateOpen(false)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Müşteri *</label>
                <select
                  required
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Müşteri seçiniz</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.last_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Satış Açıklaması *</label>
                <input
                  type="text"
                  required
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Örn: Toptan gıda satışı"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Satış Tutarı (TL) *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={form.totalAmount}
                    onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Satış Tarihi *</label>
                  <input
                    type="date"
                    required
                    value={form.saleDate}
                    onChange={(e) => setForm({ ...form, saleDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setDueMode('months')}
                    className={`rounded-md px-3 py-1.5 font-medium ${
                      dueMode === 'months' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Ay Seçimi ile Hesapla
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueMode('date')}
                    className={`rounded-md px-3 py-1.5 font-medium ${
                      dueMode === 'date' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Doğrudan Vade Tarihi Gir
                  </button>
                </div>

                {dueMode === 'months' ? (
                  <div className="grid grid-cols-2 gap-3 items-end">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Vade (Ay)</label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        required
                        value={form.dueMonths}
                        onChange={(e) => setForm({ ...form, dueMonths: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                      <span className="text-[11px] text-slate-500">Hesaplanan Vade:</span>
                      <p className="font-mono text-sm font-bold text-[#0F2942] tabular-nums">
                        {computedDuePreview !== '—' ? formatDateTR(computedDuePreview) : '—'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Vade Tarihi *</label>
                    <input
                      type="date"
                      required
                      value={form.dueDate}
                      onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#0F2942] px-5 py-2 text-xs font-semibold text-white"
                >
                  {saving ? 'Kaydediliyor...' : 'Vadeli Satışı Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tahsilat Modal */}
      {collectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Vadeli Satış Tahsilatı</h3>
              <button type="button" onClick={() => setCollectTarget(null)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCollect} className="mt-4 space-y-4">
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs">
                <p className="font-semibold text-slate-900">{collectTarget.description}</p>
                <p className="mt-1 text-slate-600">
                  Kalan Tutar:{' '}
                  <span className="font-mono font-bold tabular-nums">
                    {formatCurrencyTRY(collectTarget.remaining_amount)}
                  </span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Tahsilat Tutarı *</label>
                  <input
                    type="number"
                    min="0.01"
                    max={collectTarget.remaining_amount}
                    step="0.01"
                    required
                    value={collectForm.amount}
                    onChange={(e) => setCollectForm({ ...collectForm, amount: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Tarih *</label>
                  <input
                    type="date"
                    required
                    value={collectForm.paymentDate}
                    onChange={(e) => setCollectForm({ ...collectForm, paymentDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Ödeme Yöntemi</label>
                <select
                  value={collectForm.paymentMethod}
                  onChange={(e) =>
                    setCollectForm({
                      ...collectForm,
                      paymentMethod: e.target.value as typeof collectForm.paymentMethod,
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
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCollectTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white"
                >
                  Tahsilatı Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(cancelId)}
        title="Vadeli Satışı İptal Et"
        description="Bu vadeli satış ve bağlı müşteri borcu iptal olarak işaretlenecektir. Onaylıyor musunuz?"
        confirmLabel="İptal Et"
        loading={saving}
        onConfirm={handleCancel}
        onCancel={() => setCancelId(null)}
      />
    </div>
  );
}
