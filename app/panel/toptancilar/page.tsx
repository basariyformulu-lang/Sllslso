'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Eye, X } from 'lucide-react';
import { formatCurrencyTRY } from '@/lib/format';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import type { Supplier } from '@/lib/types';

export default function SuppliersPage() {
  const { showToast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'due' | 'passive' | 'all'>('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    companyName: '',
    contactName: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
    openingBalance: '0',
  });

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/suppliers', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuppliers(data.suppliers ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Toptancılar yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const f = new URLSearchParams(window.location.search).get('filtre');
      if (f === 'vadesi_gelen') setFilter('due');
      else if (f === 'passive' || f === 'all' || f === 'active' || f === 'due') setFilter(f);
      void loadSuppliers();
    });
    return () => {
      active = false;
    };
  }, [loadSuppliers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (filter === 'active' && !s.is_active) return false;
      if (filter === 'passive' && s.is_active) return false;
      if (filter === 'due' && (!s.is_active || (s.overdue_debt ?? 0) <= 0)) return false;
      if (!q) return true;
      return `${s.company_name} ${s.contact_name} ${s.phone}`.toLowerCase().includes(q);
    });
  }, [suppliers, search, filter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/panel/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          openingBalance: Number(form.openingBalance) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Toptancı eklenemedi', 'error');
        return;
      }
      showToast('Toptancı kaydedildi', 'success');
      setModalOpen(false);
      setForm({
        companyName: '',
        contactName: '',
        phone: '',
        email: '',
        address: '',
        notes: '',
        openingBalance: '0',
      });
      loadSuppliers();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Toptancılar ve Tedarikçiler</h1>
          <p className="mt-1 text-sm text-slate-600">
            Tedarikçi borçları, vadesi gelen ödemeler ve cari hesap takibi
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E]"
        >
          <Plus className="h-4 w-4" />
          <span>Yeni Toptancı Ekle</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Firma adı, yetkili veya telefon ara..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {[
            { id: 'active', label: 'Aktif' },
            { id: 'due', label: 'Vadesi Gelen' },
            { id: 'passive', label: 'Pasif' },
            { id: 'all', label: 'Tümü' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as typeof filter)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                filter === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
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
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">Toptancı kaydı bulunamadı.</p>
            <p className="mt-1 text-xs text-slate-500">
              Yeni toptancı ekleyerek borç ve ödeme planlaması yapabilirsiniz.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Firma Adı</th>
                  <th className="px-4 py-3 font-semibold text-right">Toplam Borç</th>
                  <th className="px-4 py-3 font-semibold text-right">Yapılan Ödemeler</th>
                  <th className="px-4 py-3 font-semibold text-right">Güncel Borç</th>
                  <th className="px-4 py-3 font-semibold text-right">Vadesi Gelen Borç</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <Link
                        href={`/panel/toptancilar/${s.id}`}
                        className="font-semibold text-slate-900 hover:underline"
                      >
                        {s.company_name}
                      </Link>
                      {s.contact_name && (
                        <p className="text-[11px] text-slate-500">{s.contact_name}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                      {formatCurrencyTRY(s.total_debt)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700">
                      {formatCurrencyTRY(s.total_payment)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-slate-900">
                      {formatCurrencyTRY(s.current_balance)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${
                        (s.overdue_debt ?? 0) > 0 ? 'text-red-700' : 'text-slate-500'
                      }`}
                    >
                      {formatCurrencyTRY(s.overdue_debt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText
                        label={s.is_active ? 'Aktif' : 'Pasif'}
                        tone={s.is_active ? 'success' : 'neutral'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/panel/toptancilar/${s.id}`}
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

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-semibold text-slate-900">Yeni Toptancı Ekle</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Firma Adı *</label>
                <input
                  type="text"
                  required
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Yetkili Adı</label>
                  <input
                    type="text"
                    value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Telefon</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">E-posta</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Başlangıç Borcu (TL)
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
                  className="rounded-lg bg-[#0F2942] px-5 py-2 text-xs font-semibold text-white"
                >
                  {saving ? 'Kaydediliyor...' : 'Toptancıyı Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
