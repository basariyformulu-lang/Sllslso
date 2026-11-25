'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { formatCurrencyTRY, getIstanbulTodayISO } from '@/lib/format';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';

export default function AdminPlanSettingsPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    description: '',
    monthlyPrice: '490',
    durationDays: '30',
    featuresText: '',
    isActive: true,
    effectiveFrom: getIstanbulTodayISO(),
  });

  const loadPlan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/plan', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.plan) {
        const p = data.plan;
        setForm({
          name: p.name ?? '',
          description: p.description ?? '',
          monthlyPrice: String(p.monthly_price ?? 490),
          durationDays: String(p.duration_days ?? 30),
          featuresText: Array.isArray(p.features) ? p.features.join('\n') : '',
          isActive: Boolean(p.is_active),
          effectiveFrom: p.effective_from ?? getIstanbulTodayISO(),
        });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Paket bilgisi yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadPlan();
    });
    return () => {
      active = false;
    };
  }, [loadPlan]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const features = form.featuresText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const res = await fetch('/api/admin/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          monthlyPrice: Number(form.monthlyPrice),
          durationDays: Number(form.durationDays),
          features,
          isActive: form.isActive,
          effectiveFrom: form.effectiveFrom,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Paket güncellenemedi', 'error');
        return;
      }
      showToast('Tek abonelik paketi güncellendi', 'success');
      loadPlan();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="h-64 rounded-xl bg-slate-200 animate-pulse" />;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Abonelik Ayarları (Tek Paket)</h1>
          <p className="mt-1 text-sm text-slate-600">
            Sistemde aynı anda yalnızca tek bir standart abonelik paketi bulunur.
          </p>
        </div>
        <StatusText
          label={form.isActive ? 'Paket Aktif' : 'Paket Pasif'}
          tone={form.isActive ? 'success' : 'neutral'}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
        Fiyat değiştirildiğinde yalnızca yeni başvuru yapacak işletmeler yeni fiyat üzerinden ödeme
        yapar. Önceden ödeme yapmış ve aboneliği devam eden işletmelerin mevcut fiyatı, işletme
        detayından özellikle değiştirilmediği sürece korunur.
      </div>

      <form onSubmit={handleSave} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700">Paket Adı *</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Aylık Abonelik Ücreti (TL) *
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.monthlyPrice}
              onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              Önizleme: {formatCurrencyTRY(form.monthlyPrice)}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Abonelik Süresi (Gün) *
            </label>
            <input
              type="number"
              min="1"
              max="365"
              required
              value={form.durationDays}
              onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Yeni Fiyat Geçerlilik Tarihi *
            </label>
            <input
              type="date"
              required
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">Paket Açıklaması *</label>
          <textarea
            rows={2}
            required
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">
            Paket Özellikleri (Her satıra bir özellik) *
          </label>
          <textarea
            rows={6}
            required
            value={form.featuresText}
            onChange={(e) => setForm({ ...form, featuresText: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          <span>Abonelik Paketi Aktif (Pasif edilirse mevcut abonelikler korunur)</span>
        </label>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#0F2942] px-6 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E]"
          >
            {saving ? 'Kaydediliyor...' : 'Abonelik Paketini Güncelle'}
          </button>
        </div>
      </form>
    </div>
  );
}
