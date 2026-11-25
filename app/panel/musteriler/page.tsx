'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Eye, X } from 'lucide-react';
import { formatCurrencyTRY, getIstanbulTodayISO } from '@/lib/format';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import type { Customer } from '@/lib/types';

export default function CustomersPage() {
  const { showToast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'debtors' | 'passive'>('active');
  const [sortBy, setSortBy] = useState<'name' | 'balance_desc'>('balance_desc');

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    lastName: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
    openingBalance: '0',
    registeredAt: getIstanbulTodayISO(),
  });

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/customers', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCustomers(data.customers ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Müşteriler yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadCustomers();
    });
    return () => {
      active = false;
    };
  }, [loadCustomers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers
      .filter((c) => {
        if (statusFilter === 'active' && !c.is_active) return false;
        if (statusFilter === 'passive' && c.is_active) return false;
        if (statusFilter === 'debtors' && (!c.is_active || (c.current_balance ?? 0) <= 0)) return false;
        if (!q) return true;
        return `${c.name} ${c.last_name} ${c.phone} ${c.email}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sortBy === 'balance_desc') {
          return (b.current_balance ?? 0) - (a.current_balance ?? 0);
        }
        return a.name.localeCompare(b.name, 'tr');
      });
  }, [customers, search, statusFilter, sortBy]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/panel/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          openingBalance: Number(form.openingBalance) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Müşteri eklenemedi', 'error');
        return;
      }
      showToast('Müşteri kaydedildi', 'success');
      setModalOpen(false);
      setForm({
        name: '',
        lastName: '',
        phone: '',
        email: '',
        address: '',
        notes: '',
        openingBalance: '0',
        registeredAt: getIstanbulTodayISO(),
      });
      loadCustomers();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Müşteriler</h1>
          <p className="mt-1 text-sm text-slate-600">
            Müşteri alacakları, tahsilatlar ve cari bakiye takibi
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E] whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>Yeni Müşteri Ekle</span>
        </button>
      </div>

      {/* Arama ve Filtreleme */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Müşteri adı veya telefon ara..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-[#0F2942] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {[
              { id: 'active', label: 'Aktif' },
              { id: 'debtors', label: 'Borçlu' },
              { id: 'passive', label: 'Pasif' },
              { id: 'all', label: 'Tümü' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as typeof statusFilter)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            <option value="balance_desc">Bakiyeye Göre (Yüksekten)</option>
            <option value="name">Ada Göre (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Tablo */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">Kayıtlı müşteri bulunamadı.</p>
            <p className="mt-1 text-xs text-slate-500">
              İlk müşterinizi ekleyerek borç ve tahsilat takibine başlayabilirsiniz.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Müşteri Adı</th>
                  <th className="px-4 py-3 font-semibold">Telefon</th>
                  <th className="px-4 py-3 font-semibold text-right">Toplam Borç</th>
                  <th className="px-4 py-3 font-semibold text-right">Toplam Ödeme</th>
                  <th className="px-4 py-3 font-semibold text-right">Güncel Bakiye</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      <Link href={`/panel/musteriler/${c.id}`} className="hover:underline">
                        {c.name} {c.last_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 tabular-nums">
                      {c.phone || '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                      {formatCurrencyTRY(c.total_debt)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700">
                      {formatCurrencyTRY(c.total_payment)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${
                        (c.current_balance ?? 0) > 0 ? 'text-red-700' : 'text-slate-900'
                      }`}
                    >
                      {formatCurrencyTRY(c.current_balance)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText
                        label={c.is_active ? 'Aktif' : 'Pasif'}
                        tone={c.is_active ? 'success' : 'neutral'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/panel/musteriler/${c.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Detay</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Yeni Müşteri Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-semibold text-slate-900">Yeni Müşteri Ekle</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Adı / Firma Adı *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Soyadı</label>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Telefon</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">E-posta</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Başlangıç Bakiyesi (TL)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.openingBalance}
                    onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Kayıt Tarihi</label>
                  <input
                    type="date"
                    value={form.registeredAt}
                    onChange={(e) => setForm({ ...form, registeredAt: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Adres</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Açıklama</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#0F2942] px-5 py-2 text-xs font-semibold text-white hover:bg-[#173B5E] disabled:opacity-60"
                >
                  {saving ? 'Kaydediliyor...' : 'Müşteriyi Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
