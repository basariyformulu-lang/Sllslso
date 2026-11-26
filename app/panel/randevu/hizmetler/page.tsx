'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Clock,
  X,
  Upload,
  Eye,
  EyeOff,
} from 'lucide-react';
import { PanelShell } from '@/components/PanelShell';
import { BookingReadOnlyBanner } from '@/components/BookingReadOnlyBanner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import { formatCurrencyTRY } from '@/lib/format';
import { sanitizeExternalUrl } from '@/lib/booking-helpers';
import type { BookingService } from '@/lib/types';

interface StaffOption {
  id: string;
  full_name: string;
  is_active: boolean;
}

export default function BookingServicesPage() {
  const { showToast } = useToast();
  const [services, setServices] = useState<BookingService[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BookingService | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BookingService | null>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    price: '',
    discountPrice: '',
    durationMinutes: '30',
    imageUrl: '',
    isActive: true,
    staffIds: [] as string[],
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/booking/services', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setServices(json.services ?? []);
        setStaff(json.staff ?? []);
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
      name: '',
      description: '',
      price: '',
      discountPrice: '',
      durationMinutes: '30',
      imageUrl: '',
      isActive: true,
      staffIds: staff.map((s) => s.id),
    });
    setModalOpen(true);
  }

  function openEditModal(srv: BookingService) {
    setEditing(srv);
    setForm({
      name: srv.name,
      description: srv.description || '',
      price: String(srv.price),
      discountPrice: srv.discount_price !== null ? String(srv.discount_price) : '',
      durationMinutes: String(srv.duration_minutes),
      imageUrl: srv.image_url || '',
      isActive: srv.is_active,
      staffIds: srv.staff_ids ?? [],
    });
    setModalOpen(true);
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_400_000) {
      showToast('Görsel boyutu en fazla 1.4 MB olabilir', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setForm((prev) => ({ ...prev, imageUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  }

  function toggleStaffSelection(staffId: string) {
    setForm((prev) => ({
      ...prev,
      staffIds: prev.staffIds.includes(staffId)
        ? prev.staffIds.filter((id) => id !== staffId)
        : [...prev.staffIds, staffId],
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...(editing ? { action: 'update', id: editing.id } : {}),
        name: form.name,
        description: form.description,
        price: Number(form.price),
        discountPrice: form.discountPrice === '' ? null : Number(form.discountPrice),
        durationMinutes: Number(form.durationMinutes),
        imageUrl: form.imageUrl,
        isActive: form.isActive,
        staffIds: form.staffIds,
      };
      const res = await fetch('/api/panel/booking/services', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Hizmet kaydedilemedi', 'error');
        return;
      }
      showToast(editing ? 'Hizmet güncellendi' : 'Yeni hizmet eklendi', 'success');
      setModalOpen(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(srv: BookingService) {
    const res = await fetch('/api/panel/booking/services', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'toggle_active',
        id: srv.id,
        isActive: !srv.is_active,
      }),
    });
    if (res.ok) {
      showToast(srv.is_active ? 'Hizmet pasife alındı' : 'Hizmet aktifleştirildi', 'success');
      await loadData();
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= services.length) return;
    const reordered = [...services];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setServices(reordered);

    await fetch('/api/panel/booking/services', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reorder',
        orderedIds: reordered.map((s) => s.id),
      }),
    });
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/panel/booking/services?id=${deleteTarget.id}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || 'Silinemedi', 'error');
      return;
    }
    showToast('Hizmet silindi', 'success');
    setDeleteTarget(null);
    await loadData();
  }

  const filtered = services.filter((s) =>
    `${s.name} ${s.description}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PanelShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-display">
              Hizmetler ve Fiyatlar
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Online randevu sayfanızda listelenecek hizmetleri, fiyatlarını, sürelerini ve ilgili personelleri yönetin.
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173B5E]"
            >
              <Plus className="h-4 w-4" />
              <span>Yeni Hizmet Ekle</span>
            </button>
          )}
        </div>

        <BookingReadOnlyBanner visible={readOnly} />

        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Hizmet adı veya açıklama ara..."
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-9 pr-3 text-xs focus:border-[#0F2942] focus:outline-none"
            />
          </div>
          <span className="text-xs text-slate-500">Toplam {filtered.length} hizmet</span>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-slate-200 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-sm font-medium text-slate-700">Henüz hizmet tanımlanmamış.</p>
            <p className="mt-1 text-xs text-slate-500">
              Müşterilerinizin randevu alabilmesi için en az bir hizmet ekleyin.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Sıra</th>
                  <th className="px-4 py-3 font-semibold">Hizmet</th>
                  <th className="px-4 py-3 font-semibold">Süre</th>
                  <th className="px-4 py-3 font-semibold">Fiyat</th>
                  <th className="px-4 py-3 font-semibold">Yetkili Personeller</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  {!readOnly && <th className="px-4 py-3 font-semibold text-right">İşlemler</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((srv, idx) => {
                  const img = sanitizeExternalUrl(srv.image_url);
                  const assignedNames = staff
                    .filter((st) => (srv.staff_ids ?? []).includes(st.id))
                    .map((st) => st.full_name);

                  return (
                    <tr key={srv.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {!readOnly && !search ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMove(idx, -1)}
                              className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                              title="Yukarı taşı"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === filtered.length - 1}
                              onClick={() => handleMove(idx, 1)}
                              className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                              title="Aşağı taşı"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <span className="font-mono text-slate-500">{idx + 1}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {img && (
                            <img
                              src={img}
                              alt={srv.name}
                              referrerPolicy="no-referrer"
                              className="h-10 w-10 rounded-lg border border-slate-200 object-cover shrink-0"
                            />
                          )}
                          <div>
                            <p className="font-semibold text-slate-900">{srv.name}</p>
                            {srv.description && (
                              <p className="text-[11px] text-slate-500 line-clamp-1 max-w-xs">
                                {srv.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          {srv.duration_minutes} dk
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono">
                        {srv.discount_price !== null && srv.discount_price < srv.price ? (
                          <div>
                            <span className="text-[11px] text-slate-400 line-through mr-1.5">
                              {formatCurrencyTRY(srv.price)}
                            </span>
                            <span className="font-semibold text-emerald-700">
                              {formatCurrencyTRY(srv.discount_price)}
                            </span>
                          </div>
                        ) : (
                          <span className="font-semibold text-slate-900">
                            {formatCurrencyTRY(srv.price)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs">
                        {assignedNames.length > 0 ? assignedNames.join(', ') : 'Tüm aktif personel'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusText
                          label={srv.is_active ? 'Aktif' : 'Pasif'}
                          tone={srv.is_active ? 'success' : 'neutral'}
                        />
                      </td>
                      {!readOnly && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleActive(srv)}
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              title={srv.is_active ? 'Pasife Al' : 'Aktifleştir'}
                            >
                              {srv.is_active ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(srv)}
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              title="Düzenle"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(srv)}
                              className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                              title="Sil"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Hizmet Ekle / Düzenle Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                {editing ? 'Hizmeti Düzenle' : 'Yeni Hizmet Ekle'}
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
              <div>
                <label className="block font-medium text-slate-700">Hizmet Adı *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Örn: Saç Kesimi ve Fön"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700">Açıklama</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Hizmet kapsamı ve müşteri bilgilendirmesi..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block font-medium text-slate-700">Fiyat (TL) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">İndirimli Fiyat (Ops.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.discountPrice}
                    onChange={(e) => setForm({ ...form, discountPrice: e.target.value })}
                    placeholder="Boş bırakılabilir"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Süre (Dakika) *</label>
                  <input
                    type="number"
                    min="5"
                    max="480"
                    required
                    value={form.durationMinutes}
                    onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700">Hizmet Görseli (URL veya Dosya)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={form.imageUrl}
                    onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                    placeholder="https://... veya dosya yükleyin"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Yükle</span>
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                  </label>
                </div>
              </div>

              {staff.length > 0 && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1.5">
                    Bu Hizmeti Veren Personeller
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 rounded-lg border border-slate-200 p-3 bg-slate-50">
                    {staff.map((st) => (
                      <label key={st.id} className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.staffIds.includes(st.id)}
                          onChange={() => toggleStaffSelection(st.id)}
                          className="rounded border-slate-300"
                        />
                        <span>{st.full_name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border-slate-300"
                />
                <span>Hizmet online randevu sayfasında aktif olarak listelensin</span>
              </label>

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

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hizmeti Sil"
        description={`"${deleteTarget?.name ?? ''}" hizmetini silmek istediğinize emin misiniz? Geçmiş randevulardaki hizmet ve fiyat kayıtları korunacaktır.`}
        confirmLabel="Evet, Sil"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </PanelShell>
  );
}
