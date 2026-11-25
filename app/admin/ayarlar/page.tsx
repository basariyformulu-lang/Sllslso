'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ToastProvider';

export default function AdminSystemSettingsPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    systemName: 'EsnafTakip',
    logoUrl: '',
    heroSlogan: '',
    heroSubheadline: '',
    contactEmail: '',
    contactPhone: '',
    pricingDescription: '',
    termsOfService: '',
    privacyPolicy: '',
  });

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/settings', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.settings) {
        const s = data.settings;
        setForm({
          systemName: s.system_name ?? 'EsnafTakip',
          logoUrl: s.logo_url ?? '',
          heroSlogan: s.hero_slogan ?? '',
          heroSubheadline: s.hero_subheadline ?? '',
          contactEmail: s.contact_email ?? '',
          contactPhone: s.contact_phone ?? '',
          pricingDescription: s.pricing_description ?? '',
          termsOfService: s.terms_of_service ?? '',
          privacyPolicy: s.privacy_policy ?? '',
        });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Sistem ayarları yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadSettings();
    });
    return () => {
      active = false;
    };
  }, [loadSettings]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Ayarlar güncellenemedi', 'error');
        return;
      }
      showToast('Sistem ayarları ve tanıtım içerikleri güncellendi', 'success');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="h-64 rounded-xl bg-slate-200 animate-pulse" />;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Genel Sistem Ayarları</h1>
        <p className="mt-1 text-sm text-slate-600">
          Tanıtım sayfası sloganı, fiyatlandırma açıklaması, iletişim ve yasal metinler buradan
          yönetilir.
        </p>
      </div>

      <form onSubmit={handleSave} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-700">Sistem Adı *</label>
            <input
              type="text"
              required
              value={form.systemName}
              onChange={(e) => setForm({ ...form, systemName: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Logo URL (İsteğe Bağlı)
            </label>
            <input
              type="text"
              value={form.logoUrl}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">
            Tanıtım Sayfası Sloganı *
          </label>
          <input
            type="text"
            required
            value={form.heroSlogan}
            onChange={(e) => setForm({ ...form, heroSlogan: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">
            Tanıtım Alt Açıklaması *
          </label>
          <textarea
            rows={2}
            required
            value={form.heroSubheadline}
            onChange={(e) => setForm({ ...form, heroSubheadline: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-700">
              İletişim E-posta Adresi *
            </label>
            <input
              type="email"
              required
              value={form.contactEmail}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">
              İletişim Telefon Numarası *
            </label>
            <input
              type="text"
              required
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">
            Tanıtım Sayfası Fiyatlandırma Açıklaması *
          </label>
          <textarea
            rows={2}
            required
            value={form.pricingDescription}
            onChange={(e) => setForm({ ...form, pricingDescription: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">Kullanım Koşulları *</label>
          <textarea
            rows={4}
            required
            value={form.termsOfService}
            onChange={(e) => setForm({ ...form, termsOfService: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">Gizlilik Politikası *</label>
          <textarea
            rows={4}
            required
            value={form.privacyPolicy}
            onChange={(e) => setForm({ ...form, privacyPolicy: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-[#0F2942] px-6 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E]"
        >
          {saving ? 'Kaydediliyor...' : 'Sistem Ayarlarını Kaydet'}
        </button>
      </form>
    </div>
  );
}
