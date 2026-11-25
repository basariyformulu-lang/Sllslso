'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, RotateCcw, X } from 'lucide-react';
import { formatCurrencyTRY, formatDateTR, getIstanbulTodayISO } from '@/lib/format';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';

interface IncomeRow {
  id: string;
  title: string;
  amount: number;
  transaction_date: string;
  category_name: string;
  description: string;
  is_cancelled: boolean;
}

export default function IncomesPage() {
  const { showToast } = useToast();
  const [incomes, setIncomes] = useState<IncomeRow[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IncomeRow | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: '',
    amount: '',
    transactionDate: getIstanbulTodayISO(),
    categoryName: 'Peşin Satış',
    description: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/finance', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIncomes(data.incomes ?? []);
      setCategories(data.incomeCategories ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gelirler yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return incomes.filter((i) => {
      if (i.is_cancelled) return false;
      if (catFilter !== 'all' && i.category_name !== catFilter) return false;
      if (!q) return true;
      return `${i.title} ${i.category_name} ${i.description}`.toLowerCase().includes(q);
    });
  }, [incomes, search, catFilter]);

  const totalVisible = useMemo(
    () => filtered.reduce((acc, i) => acc + Number(i.amount), 0),
    [filtered]
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/panel/finance', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editing
            ? {
                action: 'update_income',
                id: editing.id,
                ...form,
                amount: Number(form.amount),
              }
            : {
                kind: 'income',
                ...form,
                amount: Number(form.amount),
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Gelir kaydedilemedi', 'error');
        return;
      }
      showToast(editing ? 'Gelir güncellendi' : 'Gelir kaydedildi', 'success');
      setModalOpen(false);
      setEditing(null);
      loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCategory() {
    if (!newCategory.trim()) return;
    const res = await fetch('/api/panel/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'income_category', name: newCategory.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Kategori eklenemedi', 'error');
      return;
    }
    showToast('Gelir kategorisi eklendi', 'success');
    setNewCategory('');
    loadData();
  }

  async function handleCancel() {
    if (!cancelId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/panel/finance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_income', id: cancelId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Gelir iptal edilemedi', 'error');
        return;
      }
      showToast('Gelir kaydı iptal edildi', 'info');
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
          <h1 className="text-xl font-bold text-slate-900">Gelirler</h1>
          <p className="mt-1 text-sm text-slate-600">
            Listelenen Toplam Gelir:{' '}
            <span className="font-mono font-bold text-emerald-700 tabular-nums">
              {formatCurrencyTRY(totalVisible)}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setForm({
              title: '',
              amount: '',
              transactionDate: getIstanbulTodayISO(),
              categoryName: categories[0]?.name ?? 'Diğer',
              description: '',
            });
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E]"
        >
          <Plus className="h-4 w-4" />
          <span>Yeni Gelir Ekle</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Gelir adı veya açıklama ara..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
          >
            <option value="all">Tüm Kategoriler</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Yeni kategori..."
              className="w-36 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Ekle
            </button>
          </div>
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
            Kayıtlı gelir bulunamadı.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Tarih</th>
                  <th className="px-4 py-3 font-semibold">Gelir Adı</th>
                  <th className="px-4 py-3 font-semibold">Kategori</th>
                  <th className="px-4 py-3 font-semibold">Açıklama</th>
                  <th className="px-4 py-3 text-right font-semibold">Tutar</th>
                  <th className="px-4 py-3 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {formatDateTR(item.transaction_date)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{item.title}</td>
                    <td className="px-4 py-3 text-slate-600">{item.category_name}</td>
                    <td className="px-4 py-3 text-slate-500">{item.description || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700 tabular-nums">
                      {formatCurrencyTRY(item.amount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(item);
                            setForm({
                              title: item.title,
                              amount: String(item.amount),
                              transactionDate: item.transaction_date,
                              categoryName: item.category_name,
                              description: item.description,
                            });
                            setModalOpen(true);
                          }}
                          className="text-slate-600 hover:text-[#0F2942]"
                          title="Düzenle"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelId(item.id)}
                          className="text-slate-500 hover:text-red-700"
                          title="İptal Et"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                {editing ? 'Geliri Düzenle' : 'Yeni Gelir Ekle'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Gelir Adı *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Tutar (TL) *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Tarih *</label>
                  <input
                    type="date"
                    required
                    value={form.transactionDate}
                    onChange={(e) => setForm({ ...form, transactionDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Kategori</label>
                <select
                  value={form.categoryName}
                  onChange={(e) => setForm({ ...form, categoryName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                  <option value="Diğer">Diğer</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Açıklama</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                  {saving ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(cancelId)}
        title="Gelir Kaydını İptal Et"
        description="Bu gelir kaydı iptal olarak işaretlenecektir. Onaylıyor musunuz?"
        confirmLabel="İptal Et"
        loading={saving}
        onConfirm={handleCancel}
        onCancel={() => setCancelId(null)}
      />
    </div>
  );
}
