'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Clock, Plus, Save, Trash2 } from 'lucide-react';
import { PanelShell } from '@/components/PanelShell';
import { BookingReadOnlyBanner } from '@/components/BookingReadOnlyBanner';
import { useToast } from '@/components/ToastProvider';
import { DEFAULT_BUSINESS_HOURS } from '@/lib/booking-helpers';
import { formatDateTR, getIstanbulTodayISO } from '@/lib/format';
import type { BookingBusinessHour, StaffLeave } from '@/lib/types';

export default function BookingHoursPage() {
  const { showToast } = useToast();
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [hours, setHours] = useState<BookingBusinessHour[]>(DEFAULT_BUSINESS_HOURS);
  const [slotInterval, setSlotInterval] = useState(30);
  const [globalLeaves, setGlobalLeaves] = useState<StaffLeave[]>([]);

  const [holidayForm, setHolidayForm] = useState({
    startDate: getIstanbulTodayISO(),
    endDate: getIstanbulTodayISO(),
    reason: 'Resmi Tatil / İşletme Kapalı',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pageRes, staffRes] = await Promise.all([
        fetch('/api/panel/booking/page', { cache: 'no-store' }),
        fetch('/api/panel/booking/staff', { cache: 'no-store' }),
      ]);
      const pageJson = await pageRes.json();
      const staffJson = await staffRes.json();

      if (pageRes.ok && pageJson.page) {
        setHours(pageJson.page.business_hours ?? DEFAULT_BUSINESS_HOURS);
        setSlotInterval(Math.max(30, pageJson.page.slot_interval_minutes ?? 30));
        setReadOnly(Boolean(pageJson.readOnly));
      }
      if (staffRes.ok) {
        const leaves = (staffJson.leaves ?? []) as StaffLeave[];
        setGlobalLeaves(leaves.filter((l) => l.staff_id === null));
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

  function updateHour(day: number, patch: Partial<BookingBusinessHour>) {
    setHours((prev) => prev.map((h) => (h.day === day ? { ...h, ...patch } : h)));
  }

  async function handleSaveHours(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/panel/booking/page', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_hours: hours,
          slot_interval_minutes: slotInterval,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Çalışma saatleri kaydedilemedi', 'error');
        return;
      }
      showToast('Çalışma saatleri ve randevu aralığı güncellendi', 'success');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/panel/booking/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_leave',
        staffId: null,
        startDate: holidayForm.startDate,
        endDate: holidayForm.endDate,
        reason: holidayForm.reason,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || 'Kapalı gün eklenemedi', 'error');
      return;
    }
    showToast('İşletme kapalı günü eklendi', 'success');
    await loadData();
  }

  async function handleDeleteHoliday(leaveId: string) {
    const res = await fetch('/api/panel/booking/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete_leave',
        leaveId,
      }),
    });
    if (res.ok) {
      showToast('Kapalı gün kaldırıldı', 'success');
      await loadData();
    }
  }

  return (
    <PanelShell>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 font-display">Çalışma Saatleri</h1>
          <p className="mt-1 text-xs text-slate-600">
            İşletmenizin haftalık açık olduğu günleri, randevu slot aralıklarını ve işletme geneli tatil günlerini ayarlayın.
          </p>
        </div>

        <BookingReadOnlyBanner visible={readOnly} />

        {loading ? (
          <div className="h-64 rounded-xl bg-slate-200 animate-pulse" />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Haftalık Saatler */}
            <form
              onSubmit={handleSaveHours}
              className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-[#0F2942]" />
                  <h2 className="text-sm font-bold text-slate-900">Haftalık Çalışma Saatleri</h2>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <label className="font-medium text-slate-700">Slot Aralığı:</label>
                  <select
                    disabled={readOnly}
                    value={slotInterval}
                    onChange={(e) => setSlotInterval(Number(e.target.value))}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
                  >
                    {[30, 45, 60].map((v) => (
                      <option key={v} value={v}>
                        {v === 30 ? '30 dakika (Önerilen)' : `${v} dakika`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {hours.map((item) => (
                  <div
                    key={item.day}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                  >
                    <label className="flex items-center gap-2.5 min-w-[140px] font-medium text-slate-800">
                      <input
                        type="checkbox"
                        disabled={readOnly}
                        checked={item.is_open}
                        onChange={(e) => updateHour(item.day, { is_open: e.target.checked })}
                        className="rounded border-slate-300"
                      />
                      <span>{item.label}</span>
                    </label>

                    {item.is_open ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          disabled={readOnly}
                          value={item.open}
                          onChange={(e) => updateHour(item.day, { open: e.target.value })}
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                        />
                        <span className="text-slate-400">—</span>
                        <input
                          type="time"
                          disabled={readOnly}
                          value={item.close}
                          onChange={(e) => updateHour(item.day, { close: e.target.value })}
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                        />
                      </div>
                    ) : (
                      <span className="text-slate-400">Kapalı</span>
                    )}
                  </div>
                ))}
              </div>

              {!readOnly && (
                <div className="flex justify-end border-t border-slate-200 pt-4">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{saving ? 'Kaydediliyor...' : 'Saatleri Kaydet'}</span>
                  </button>
                </div>
              )}
            </form>

            {/* İşletme Kapalı Günleri / Resmi Tatiller */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <CalendarOff className="h-4 w-4 text-amber-700" />
                <h2 className="text-sm font-bold text-slate-900">Kapalı Günler / Tatiller</h2>
              </div>

              {!readOnly && (
                <form onSubmit={handleAddHoliday} className="space-y-3 text-xs">
                  <div>
                    <label className="block font-medium text-slate-700">Başlangıç Tarihi</label>
                    <input
                      type="date"
                      required
                      value={holidayForm.startDate}
                      onChange={(e) => setHolidayForm({ ...holidayForm, startDate: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Bitiş Tarihi</label>
                    <input
                      type="date"
                      required
                      value={holidayForm.endDate}
                      onChange={(e) => setHolidayForm({ ...holidayForm, endDate: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700">Açıklama</label>
                    <input
                      type="text"
                      value={holidayForm.reason}
                      onChange={(e) => setHolidayForm({ ...holidayForm, reason: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Kapalı Gün Ekle</span>
                  </button>
                </form>
              )}

              <div className="divide-y divide-slate-100 pt-2">
                {globalLeaves.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-500">
                    Kayıtlı özel kapalı gün bulunmuyor.
                  </p>
                ) : (
                  globalLeaves.map((lv) => (
                    <div key={lv.id} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 font-mono">
                          {formatDateTR(lv.start_date)}
                          {lv.end_date !== lv.start_date ? ` - ${formatDateTR(lv.end_date)}` : ''}
                        </p>
                        {lv.reason && <p className="text-[11px] text-slate-500 truncate">{lv.reason}</p>}
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => handleDeleteHoliday(lv.id)}
                          className="rounded p-1 text-red-600 hover:bg-red-50"
                          title="Kaldır"
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
        )}
      </div>
    </PanelShell>
  );
}
