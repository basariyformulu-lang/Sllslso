'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { formatCurrencyTRY, formatDateTimeTR, formatDateTR } from '@/lib/format';
import { getSubscriptionStatusDisplay, StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';

export default function BusinessSettingsPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    businessName: '',
    businessPhone: '',
    businessAddress: '',
  });
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [subscription, setSubscription] = useState<any>(null);
  const [business, setBusiness] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/settings', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIsOwner(Boolean(data.member?.is_owner));
      setBusiness(data.business);
      setSubscription(data.subscription);
      setAuditLogs(data.auditLogs ?? []);
      setProfileForm({
        firstName: data.profile?.first_name ?? '',
        lastName: data.profile?.last_name ?? '',
        phone: data.profile?.phone ?? '',
        email: data.profile?.email ?? '',
        businessName: data.business?.name ?? '',
        businessPhone: data.business?.phone ?? '',
        businessAddress: data.business?.address ?? '',
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ayarlar yüklenemedi', 'error');
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

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/panel/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileForm),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Bilgiler güncellenemedi', 'error');
        return;
      }
      showToast('Profil ve işletme bilgileri güncellendi', 'success');
      loadSettings();
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      showToast('Yeni şifre en az 8 karakter olmalıdır.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Şifreler eşleşmiyor.', 'error');
      return;
    }
    const supabase = createBrowserSupabase();
    if (!supabase) return;
    setPwSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        showToast(error.message, 'error');
        return;
      }
      showToast('Şifreniz güncellendi', 'success');
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setPwSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded bg-slate-200 animate-pulse" />
        <div className="h-48 rounded-xl bg-slate-200 animate-pulse" />
      </div>
    );
  }

  const subSt = getSubscriptionStatusDisplay(business?.subscription_status ?? 'active');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Profil ve Ayarlar</h1>
        <p className="mt-1 text-sm text-slate-600">
          Kişisel hesap bilgileriniz, şifre güvenliği ve abonelik durumunuz
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Profil & İşletme Bilgileri */}
        <form
          onSubmit={handleSaveProfile}
          className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 lg:col-span-7"
        >
          <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-3">
            Kullanıcı ve İşletme Bilgileri
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Ad *</label>
              <input
                type="text"
                required
                value={profileForm.firstName}
                onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Soyad *</label>
              <input
                type="text"
                required
                value={profileForm.lastName}
                onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">E-posta</label>
              <input
                type="email"
                disabled
                value={profileForm.email}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Telefon</label>
              <input
                type="text"
                value={profileForm.phone}
                onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {isOwner && (
            <div className="border-t border-slate-200 pt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">İşletme Adı</label>
                <input
                  type="text"
                  required
                  value={profileForm.businessName}
                  onChange={(e) => setProfileForm({ ...profileForm, businessName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    İşletme Telefonu
                  </label>
                  <input
                    type="text"
                    value={profileForm.businessPhone}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, businessPhone: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Adres</label>
                  <input
                    type="text"
                    value={profileForm.businessAddress}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, businessAddress: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#0F2942] px-5 py-2 text-xs font-semibold text-white hover:bg-[#173B5E]"
            >
              {saving ? 'Kaydediliyor...' : 'Bilgileri Güncelle'}
            </button>
          </div>
        </form>

        {/* Şifre & Abonelik */}
        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-sm font-semibold text-slate-900">Abonelik Durumu</h2>
              <StatusText label={subSt.label} tone={subSt.tone} />
            </div>
            <div className="mt-4 space-y-2 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Paket:</span>
                <span className="font-semibold text-slate-900">
                  {subscription?.plan?.name ?? 'Standart Paket'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Kayıtlı Abonelik Ücreti:</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatCurrencyTRY(subscription?.locked_price ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Başlangıç:</span>
                <span className="font-mono tabular-nums">
                  {formatDateTR(business?.subscription_start_at)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Bitiş Tarihi:</span>
                <span className="font-mono font-semibold text-[#0F2942] tabular-nums">
                  {formatDateTR(business?.subscription_end_at)}
                </span>
              </div>
            </div>
          </div>

          <form
            onSubmit={handlePasswordChange}
            className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
          >
            <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-3">
              Şifre Değiştir
            </h2>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Yeni Şifre (En az 8 karakter)
              </label>
              <input
                type="password"
                minLength={8}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Yeni Şifre Tekrar</label>
              <input
                type="password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={pwSaving}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              {pwSaving ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}
            </button>
          </form>
        </div>
      </div>

      {/* İşletme Denetim Geçmişi */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Son İşletme İşlem Kayıtları</h2>
        {auditLogs.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">Henüz kayıt bulunmuyor.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Tarih</th>
                  <th className="px-3 py-2 font-semibold">İşlem</th>
                  <th className="px-3 py-2 font-semibold">Açıklama</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-500">
                      {formatDateTimeTR(log.created_at)}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">{log.action}</td>
                    <td className="px-3 py-2 text-slate-600">{log.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
