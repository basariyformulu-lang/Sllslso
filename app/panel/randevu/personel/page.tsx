'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Clock,
  Coffee,
  CalendarOff,
  Upload,
  X,
} from 'lucide-react';
import { PanelShell } from '@/components/PanelShell';
import { BookingReadOnlyBanner } from '@/components/BookingReadOnlyBanner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import { TR_WEEKDAYS, sanitizeExternalUrl, formatTimeHHMM } from '@/lib/booking-helpers';
import { formatDateTR, getIstanbulTodayISO } from '@/lib/format';
import type { BookingStaff, StaffLeave, StaffWorkingHour } from '@/lib/types';

interface ServiceOption {
  id: string;
  name: string;
}

const DEFAULT_STAFF_HOURS: StaffWorkingHour[] = TR_WEEKDAYS.map((d) => ({
  staff_id: '',
  day_of_week: d.day,
  is_working: d.day !== 0,
  start_time: d.day === 0 ? '10:00' : '09:00',
  end_time: d.day === 0 ? '17:00' : '19:00',
}));

export default function BookingStaffPage() {
  const { showToast } = useToast();
  const [staffList, setStaffList] = useState<BookingStaff[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [leaves, setLeaves] = useState<StaffLeave[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BookingStaff | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BookingStaff | null>(null);

  const [scheduleTarget, setScheduleTarget] = useState<BookingStaff | null>(null);
  const [breakForm, setBreakForm] = useState({
    dayOfWeek: '' as string,
    title: 'Öğle Molası',
    startTime: '12:30',
    endTime: '13:30',
  });
  const [leaveForm, setLeaveForm] = useState({
    startDate: getIstanbulTodayISO(),
    endDate: getIstanbulTodayISO(),
    reason: 'Yıllık İzin',
  });

  const [form, setForm] = useState({
    fullName: '',
    avatarUrl: '',
    specialties: '',
    bio: '',
    isActive: true,
    serviceIds: [] as string[],
    workingHours: DEFAULT_STAFF_HOURS,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/booking/staff', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        const list = (json.staff ?? []) as BookingStaff[];
        setStaffList(list);
        setServices(json.services ?? []);
        setLeaves(json.leaves ?? []);
        setReadOnly(Boolean(json.readOnly));
        setScheduleTarget((prev) => (prev ? list.find((s) => s.id === prev.id) ?? null : null));
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
      fullName: '',
      avatarUrl: '',
      specialties: '',
      bio: '',
      isActive: true,
      serviceIds: services.map((s) => s.id),
      workingHours: DEFAULT_STAFF_HOURS,
    });
    setModalOpen(true);
  }

  function openEditModal(st: BookingStaff) {
    setEditing(st);
    const mergedHours = TR_WEEKDAYS.map((d) => {
      const found = (st.working_hours ?? []).find((wh) => wh.day_of_week === d.day);
      return found
        ? {
            staff_id: st.id,
            day_of_week: d.day,
            is_working: found.is_working,
            start_time: formatTimeHHMM(found.start_time),
            end_time: formatTimeHHMM(found.end_time),
          }
        : {
            staff_id: st.id,
            day_of_week: d.day,
            is_working: d.day !== 0,
            start_time: d.day === 0 ? '10:00' : '09:00',
            end_time: d.day === 0 ? '17:00' : '19:00',
          };
    });

    setForm({
      fullName: st.full_name,
      avatarUrl: st.avatar_url || '',
      specialties: st.specialties || '',
      bio: st.bio || '',
      isActive: st.is_active,
      serviceIds: st.service_ids ?? [],
      workingHours: mergedHours,
    });
    setModalOpen(true);
  }

  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_400_000) {
      showToast('Görsel boyutu en fazla 1.4 MB olabilir', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setForm((prev) => ({ ...prev, avatarUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  }

  function toggleService(serviceId: string) {
    setForm((prev) => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(serviceId)
        ? prev.serviceIds.filter((id) => id !== serviceId)
        : [...prev.serviceIds, serviceId],
    }));
  }

  function updateHour(dayOfWeek: number, patch: Partial<StaffWorkingHour>) {
    setForm((prev) => ({
      ...prev,
      workingHours: prev.workingHours.map((wh) =>
        wh.day_of_week === dayOfWeek ? { ...wh, ...patch } : wh
      ),
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...(editing ? { action: 'update_staff', id: editing.id } : {}),
        fullName: form.fullName,
        avatarUrl: form.avatarUrl,
        specialties: form.specialties,
        bio: form.bio,
        isActive: form.isActive,
        serviceIds: form.serviceIds,
        workingHours: form.workingHours.map((wh) => ({
          day_of_week: wh.day_of_week,
          is_working: wh.is_working,
          start_time: wh.start_time,
          end_time: wh.end_time,
        })),
      };

      const res = await fetch('/api/panel/booking/staff', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Personel kaydedilemedi', 'error');
        return;
      }
      showToast(editing ? 'Personel güncellendi' : 'Yeni personel eklendi', 'success');
      setModalOpen(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handleAddBreak(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduleTarget) return;
    const res = await fetch('/api/panel/booking/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_break',
        staffId: scheduleTarget.id,
        dayOfWeek: breakForm.dayOfWeek === '' ? null : Number(breakForm.dayOfWeek),
        title: breakForm.title,
        startTime: breakForm.startTime,
        endTime: breakForm.endTime,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || 'Mola eklenemedi', 'error');
      return;
    }
    showToast('Mola eklendi', 'success');
    await loadData();
  }

  async function handleDeleteBreak(breakId: string) {
    const res = await fetch('/api/panel/booking/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_break', breakId }),
    });
    if (res.ok) {
      showToast('Mola silindi', 'success');
      await loadData();
    }
  }

  async function handleAddLeave(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduleTarget) return;
    const res = await fetch('/api/panel/booking/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_leave',
        staffId: scheduleTarget.id,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        reason: leaveForm.reason,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || 'İzin eklenemedi', 'error');
      return;
    }
    showToast('Personel izni eklendi', 'success');
    await loadData();
  }

  async function handleDeleteLeave(leaveId: string) {
    const res = await fetch('/api/panel/booking/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_leave', leaveId }),
    });
    if (res.ok) {
      showToast('İzin kaldırıldı', 'success');
      await loadData();
    }
  }

  async function handleDeleteStaff() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/panel/booking/staff?id=${deleteTarget.id}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || 'Silinemedi', 'error');
      setDeleteTarget(null);
      return;
    }
    showToast('Personel silindi', 'success');
    setDeleteTarget(null);
    await loadData();
  }

  return (
    <PanelShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-display">Personel Yönetimi</h1>
            <p className="mt-1 text-xs text-slate-600">
              Uzman personellerinizi, verebilecekleri hizmetleri, haftalık mesai saatlerini, molalarını ve izin günlerini yönetin.
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173B5E]"
            >
              <Plus className="h-4 w-4" />
              <span>Yeni Personel Ekle</span>
            </button>
          )}
        </div>

        <BookingReadOnlyBanner visible={readOnly} />

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-xl bg-slate-200 animate-pulse" />
            ))}
          </div>
        ) : staffList.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-sm font-medium text-slate-700">Henüz personel eklenmemiş.</p>
            <p className="mt-1 text-xs text-slate-500">
              Müşterilerin randevu sırasında seçim yapabilmesi için en az bir personel tanımlayın.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {staffList.map((st) => {
              const avatar = sanitizeExternalUrl(st.avatar_url);
              const staffLeaves = leaves.filter((l) => l.staff_id === st.id);
              const assignedCount = (st.service_ids ?? []).length;

              return (
                <div
                  key={st.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={st.full_name}
                            referrerPolicy="no-referrer"
                            className="h-12 w-12 rounded-full border border-slate-200 object-cover shrink-0"
                          />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-[#0F2942]">
                            {st.full_name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-bold text-slate-900">
                            {st.full_name}
                          </h3>
                          {st.specialties && (
                            <p className="truncate text-xs text-slate-500">{st.specialties}</p>
                          )}
                        </div>
                      </div>
                      <StatusText
                        label={st.is_active ? 'Aktif' : 'Pasif'}
                        tone={st.is_active ? 'success' : 'neutral'}
                      />
                    </div>

                    {st.bio && (
                      <p className="mt-3 text-xs leading-relaxed text-slate-600 line-clamp-2">
                        {st.bio}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      <span>{assignedCount} hizmet yetkisi</span>
                      <span>·</span>
                      <span>{(st.breaks ?? []).length} mola</span>
                      <span>·</span>
                      <span>{staffLeaves.length} izin kaydı</span>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => setScheduleTarget(st)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Coffee className="h-3.5 w-3.5" />
                      <span>Mola &amp; İzin</span>
                    </button>
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditModal(st)}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                          title="Düzenle"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(st)}
                          className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                          title="Sil"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Personel Ekle / Düzenle Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                {editing ? 'Personeli Düzenle' : 'Yeni Personel Ekle'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-5 text-xs">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700">Ad Soyad *</label>
                  <input
                    type="text"
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Uzmanlık Alanı</label>
                  <input
                    type="text"
                    value={form.specialties}
                    onChange={(e) => setForm({ ...form, specialties: e.target.value })}
                    placeholder="Örn: Saç Tasarım & Sakal Bakım"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700">Kısa Tanıtım / Biyografi</label>
                <textarea
                  rows={2}
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700">Profil Fotoğrafı (URL veya Yükle)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={form.avatarUrl}
                    onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })}
                    placeholder="https://... veya fotoğraf yükleyin"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Yükle</span>
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                  </label>
                </div>
              </div>

              {services.length > 0 && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1.5">
                    Verebileceği Hizmetler
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    {services.map((srv) => (
                      <label key={srv.id} className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.serviceIds.includes(srv.id)}
                          onChange={() => toggleService(srv.id)}
                          className="rounded border-slate-300"
                        />
                        <span>{srv.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center gap-1.5 font-medium text-slate-700">
                  <Clock className="h-3.5 w-3.5 text-[#0F2942]" />
                  <span>Haftalık Mesai Saatleri</span>
                </div>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-3">
                  {TR_WEEKDAYS.map((day) => {
                    const wh = form.workingHours.find((w) => w.day_of_week === day.day);
                    if (!wh) return null;
                    return (
                      <div key={day.day} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <label className="flex items-center gap-2 font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={wh.is_working}
                            onChange={(e) => updateHour(day.day, { is_working: e.target.checked })}
                            className="rounded border-slate-300"
                          />
                          <span>{day.label}</span>
                        </label>
                        {wh.is_working ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="time"
                              value={wh.start_time}
                              onChange={(e) => updateHour(day.day, { start_time: e.target.value })}
                              className="rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                            />
                            <span>—</span>
                            <input
                              type="time"
                              value={wh.end_time}
                              onChange={(e) => updateHour(day.day, { end_time: e.target.value })}
                              className="rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                            />
                          </div>
                        ) : (
                          <span className="text-slate-400">İzinli</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border-slate-300"
                />
                <span>Personel aktif ve randevu alabilir durumda</span>
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

      {/* Mola & İzin Yönetimi Modal */}
      {scheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {scheduleTarget.full_name} — Molalar ve İzinler
                </h2>
                <p className="text-xs text-slate-500">
                  Tanımlanan mola ve izin saatlerinde müşterilere randevu slotu açılmaz.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScheduleTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 text-xs">
              {/* Molalar */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 font-bold text-slate-800">
                  <Coffee className="h-4 w-4 text-amber-700" />
                  <span>Günlük / Haftalık Molalar</span>
                </div>

                {!readOnly && (
                  <form onSubmit={handleAddBreak} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <input
                      type="text"
                      required
                      value={breakForm.title}
                      onChange={(e) => setBreakForm({ ...breakForm, title: e.target.value })}
                      placeholder="Mola adı (Örn: Öğle Molası)"
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <select
                      value={breakForm.dayOfWeek}
                      onChange={(e) => setBreakForm({ ...breakForm, dayOfWeek: e.target.value })}
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    >
                      <option value="">Her Gün</option>
                      {TR_WEEKDAYS.map((d) => (
                        <option key={d.day} value={d.day}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="time"
                        required
                        value={breakForm.startTime}
                        onChange={(e) => setBreakForm({ ...breakForm, startTime: e.target.value })}
                        className="rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                      />
                      <input
                        type="time"
                        required
                        value={breakForm.endTime}
                        onChange={(e) => setBreakForm({ ...breakForm, endTime: e.target.value })}
                        className="rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-[#0F2942] py-1.5 font-semibold text-white hover:bg-[#173B5E]"
                    >
                      Mola Ekle
                    </button>
                  </form>
                )}

                <div className="divide-y divide-slate-100">
                  {(scheduleTarget.breaks ?? []).length === 0 ? (
                    <p className="py-3 text-slate-500">Tanımlı mola yok.</p>
                  ) : (
                    (scheduleTarget.breaks ?? []).map((br) => {
                      const dayLabel =
                        br.day_of_week === null
                          ? 'Her Gün'
                          : TR_WEEKDAYS.find((d) => d.day === br.day_of_week)?.label ?? '';
                      return (
                        <div key={br.id} className="flex items-center justify-between py-2">
                          <div>
                            <p className="font-semibold text-slate-800">{br.title}</p>
                            <p className="text-[11px] text-slate-500 font-mono">
                              {dayLabel} · {formatTimeHHMM(br.start_time)} - {formatTimeHHMM(br.end_time)}
                            </p>
                          </div>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleDeleteBreak(br.id)}
                              className="rounded p-1 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* İzinler */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 font-bold text-slate-800">
                  <CalendarOff className="h-4 w-4 text-red-600" />
                  <span>İzin / Tatil Tarihleri</span>
                </div>

                {!readOnly && (
                  <form onSubmit={handleAddLeave} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        required
                        value={leaveForm.startDate}
                        onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                        className="rounded border border-slate-300 bg-white px-2 py-1.5"
                      />
                      <input
                        type="date"
                        required
                        value={leaveForm.endDate}
                        onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                        className="rounded border border-slate-300 bg-white px-2 py-1.5"
                      />
                    </div>
                    <input
                      type="text"
                      value={leaveForm.reason}
                      onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                      placeholder="İzin açıklaması"
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-emerald-700 py-1.5 font-semibold text-white hover:bg-emerald-800"
                    >
                      İzin Ekle
                    </button>
                  </form>
                )}

                <div className="divide-y divide-slate-100">
                  {leaves.filter((l) => l.staff_id === scheduleTarget.id).length === 0 ? (
                    <p className="py-3 text-slate-500">Tanımlı izin kaydı yok.</p>
                  ) : (
                    leaves
                      .filter((l) => l.staff_id === scheduleTarget.id)
                      .map((lv) => (
                        <div key={lv.id} className="flex items-center justify-between py-2">
                          <div>
                            <p className="font-semibold text-slate-800 font-mono">
                              {formatDateTR(lv.start_date)}
                              {lv.end_date !== lv.start_date ? ` - ${formatDateTR(lv.end_date)}` : ''}
                            </p>
                            {lv.reason && <p className="text-[11px] text-slate-500">{lv.reason}</p>}
                          </div>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleDeleteLeave(lv.id)}
                              className="rounded p-1 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Personeli Sil"
        description={`"${deleteTarget?.full_name ?? ''}" personel kaydını silmek istediğinize emin misiniz?`}
        confirmLabel="Evet, Sil"
        onConfirm={handleDeleteStaff}
        onCancel={() => setDeleteTarget(null)}
      />
    </PanelShell>
  );
}
