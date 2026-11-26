'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, X, Users } from 'lucide-react';
import { PanelShell } from '@/components/PanelShell';
import { BookingReadOnlyBanner } from '@/components/BookingReadOnlyBanner';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import { formatCurrencyTRY, formatDateTR } from '@/lib/format';
import type { BookingCustomer } from '@/lib/types';

export default function BookingCustomersPage() {
  const { showToast } = useToast();
  const [customers, setCustomers] = useState<BookingCustomer[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BookingCustomer | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    notes: '',
    isActive: true,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/booking/customers', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setCustomers(json.customers ?? []);
        setReadOnly(Boolean(json.readOnly));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  function openNewModal() {
    setEditing(null);
    setForm({
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
      notes: '',
      isActive: true,
    });
    setModalOpen(true);
  }

  function openEditModal(cust: BookingCustomer) {
    setEditing(cust);
    setForm({
      firstName: cust.first_name,
      lastName: cust.last_name || '',
      phone: cust.phone,
      email: cust.email || '',
      notes: cust.notes || '',
      isActive: cust.is_active,
    });
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/panel/booking/customers', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editing ? { id: editing.id } : {}),
          ...form,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Müşteri kaydedilemedi', 'error');
        return;
      }
      showToast(editing ? 'Müşteri bilgileri güncellendi' : 'Yeni randevu müşterisi eklendi', 'success');
      setModalOpen(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  const filtered = customers.filter((c) =>
    `${c.first_name} ${c.last_name} ${c.phone} ${c.email}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <PanelShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-display">Müşteri Yönetimi</h1>
            <p className="mt-1 text-xs text-slate-600">
              Online randevu alan veya panelden eklediğiniz müşterilerin ziyaret geçmişini ve toplam harcamalarını görüntüleyin.
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173B5E]"
            >
              <Plus className="h-4 w-4" />
              <span>Yeni Müşteri Ekle</span>
            </button>
          )}
        </div>

        <BookingReadOnlyBanner visible={readOnly} />

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ad, soyad, telefon veya e-posta ara..."
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-9 pr-3 text-xs focus:border-[#0F2942] focus:outline-none"
            />
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Users className="h-3.5 w-3.5" />
            <span>{filtered.length} müşteri</span>
          </span>
        </div>

        {loading ? (
          <div className="h-56 rounded-xl bg-slate-200 animate-pulse" />
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
            Eşleşen randevu müşterisi bulunamadı.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Müşteri</th>
                  <th className="px-4 py-3 font-semibold">Telefon / E-posta</th>
                  <th className="px-4 py-3 font-semibold">Randevu</th>
                  <th className="px-4 py-3 font-semibold">Toplam Harcama</th>
                  <th className="px-4 py-3 font-semibold">Son Ziyaret</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  {!readOnly && <th className="px-4 py-3 font-semibold text-right">İşlem</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((cust) => (
                  <tr key={cust.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">
                        {cust.first_name} {cust.last_name}
                      </p>
                      {cust.notes && (
                        <p className="text-[11px] text-slate-500 line-clamp-1 max-w-xs">
                          {cust.notes}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-slate-800">{cust.phone}</p>
                      {cust.email && <p className="text-[11px] text-slate-500">{cust.email}</p>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-700">
                      {cust.appointment_count ?? 0} ({cust.completed_count ?? 0} tamamlandı)
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono font-semibold text-emerald-700">
                      {formatCurrencyTRY(cust.total_spent ?? 0)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {cust.last_appointment_date ? formatDateTR(cust.last_appointment_date) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusText
                        label={cust.is_active ? 'Aktif' : 'Pasif'}
                        tone={cust.is_active ? 'success' : 'neutral'}
                      />
                    </td>
                    {!readOnly && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditModal(cust)}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                          title="Düzenle"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
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
              <h2 className="text-base font-bold text-slate-900">
                {editing ? 'Müşteriyi Düzenle' : 'Yeni Müşteri Ekle'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700">Ad *</label>
                  <input
                    type="text"
                    required
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Soyad</label>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700">Telefon *</label>
                <input
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700">E-posta</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700">Notlar</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              {editing && (
                <label className="flex items-center gap-2 font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="rounded border-slate-300"
                  />
                  <span>Müşteri aktif</span>
                </label>
              )}

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
                >
                  {saving ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
