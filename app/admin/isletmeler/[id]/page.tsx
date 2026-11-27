'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, Trash2, X } from 'lucide-react';
import { formatCurrencyTRY, formatDateTimeTR, formatDateTR } from '@/lib/format';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { getSubscriptionStatusDisplay, StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';

export default function AdminBusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [pwTarget, setPwTarget] = useState<{ userId: string; name: string; email: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    isActive: true,
    subscriptionStatus: 'active',
    subscriptionStartAt: '',
    subscriptionEndAt: '',
    lockedPrice: '0',
    extendDays: '30',
  });

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/businesses/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDetail(data);
      const b = data.business;
      setForm({
        name: b.name ?? '',
        phone: b.phone ?? '',
        email: b.email ?? '',
        address: b.address ?? '',
        isActive: Boolean(b.is_active),
        subscriptionStatus: b.subscription_status ?? 'payment_pending',
        subscriptionStartAt: b.subscription_start_at ? b.subscription_start_at.slice(0, 10) : '',
        subscriptionEndAt: b.subscription_end_at ? b.subscription_end_at.slice(0, 10) : '',
        lockedPrice: String(data.subscription?.locked_price ?? 0),
        extendDays: '30',
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'İşletme detayı alınamadı', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadDetail();
    });
    return () => {
      active = false;
    };
  }, [loadDetail]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/businesses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: form.name,
          phone: form.phone,
          email: form.email,
          address: form.address,
          isActive: form.isActive,
          subscriptionStatus: form.subscriptionStatus,
          subscriptionStartAt: form.subscriptionStartAt
            ? `${form.subscriptionStartAt}T00:00:00+03:00`
            : null,
          subscriptionEndAt: form.subscriptionEndAt
            ? `${form.subscriptionEndAt}T23:59:59+03:00`
            : null,
          lockedPrice: Number(form.lockedPrice),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Güncelleme başarısız', 'error');
        return;
      }
      showToast('İşletme ve abonelik bilgileri güncellendi', 'success');
      loadDetail();
    } finally {
      setSaving(false);
    }
  }

  async function quickAction(
    patch: Record<string, unknown>,
    successMsg: string
  ) {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/businesses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'İşlem başarısız', 'error');
        return;
      }
      showToast(successMsg, 'success');
      loadDetail();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBusiness() {
    if (!detail?.business) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/businesses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          confirmName: detail.business.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'İşletme silinemedi', 'error');
        return;
      }
      showToast('İşletme arşivi alınarak silindi', 'info');
      router.push('/admin/isletmeler');
    } finally {
      setSaving(false);
    }
  }

  async function handleSetMemberPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/businesses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: pwTarget.userId,
          newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Şifre tanımlanamadı', 'error');
        return;
      }
      showToast('Kullanıcı şifresi tanımlandı', 'success');
      setPwTarget(null);
      setNewPassword('');
      await loadDetail();
    } finally {
      setSaving(false);
    }
  }

  if (loading || !detail) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 rounded bg-slate-200 animate-pulse" />
        <div className="h-64 rounded-xl bg-slate-200 animate-pulse" />
      </div>
    );
  }

  const biz = detail.business;
  const st = getSubscriptionStatusDisplay(!biz.is_active ? 'passive' : biz.subscription_status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/admin/isletmeler"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F2942]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>İşletmelere Dön</span>
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">{biz.name}</h1>
            <StatusText label={st.label} tone={st.tone} />
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500">
            Kod: {biz.business_code} · Kayıt: {formatDateTimeTR(biz.created_at)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>İşletmeyi Sil</span>
        </button>
      </div>

      {/* Hızlı Abonelik Aksiyonları */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Hızlı Abonelik İşlemleri</h2>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              quickAction(
                {
                  isActive: true,
                  subscriptionStatus: 'active',
                  extendDays: Number(form.extendDays) || 30,
                  actionNote: `Abonelik ${form.extendDays || 30} gün başlatıldı/uzatıldı.`,
                },
                'Abonelik başlatıldı / uzatıldı'
              )
            }
            className="rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            +{form.extendDays || 30} Gün Uzat / Başlat
          </button>
          <input
            type="number"
            min="1"
            max="365"
            value={form.extendDays}
            onChange={(e) => setForm({ ...form, extendDays: e.target.value })}
            className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
            title="Uzatma gün sayısı"
          />
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              quickAction(
                {
                  subscriptionStatus: 'suspended',
                  actionNote: 'Abonelik yönetici tarafından askıya alındı.',
                },
                'Abonelik askıya alındı'
              )
            }
            className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800"
          >
            Askıya Al
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              quickAction(
                {
                  subscriptionStatus: 'expired',
                  actionNote: 'Abonelik yönetici tarafından sona erdirildi.',
                },
                'Abonelik sona erdirildi'
              )
            }
            className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700"
          >
            Sona Erdir
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              quickAction(
                {
                  isActive: !biz.is_active,
                  subscriptionStatus: !biz.is_active ? 'active' : 'passive',
                  actionNote: !biz.is_active
                    ? 'İşletme yeniden aktif edildi.'
                    : 'İşletme pasif duruma alındı.',
                },
                !biz.is_active ? 'İşletme aktif edildi' : 'İşletme pasif yapıldı'
              )
            }
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {biz.is_active ? 'İşletmeyi Pasif Yap' : 'İşletmeyi Aktif Et'}
          </button>
        </div>
      </div>

      {/* İşletme ve Abonelik Düzenleme Formu */}
      <form onSubmit={handleSave} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-3">
          İşletme ve Abonelik Detayları
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-700">İşletme Adı</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
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
            <label className="block text-xs font-medium text-slate-700">Abonelik Durumu</label>
            <select
              value={form.subscriptionStatus}
              onChange={(e) => setForm({ ...form, subscriptionStatus: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="active">Aktif</option>
              <option value="passive">Pasif</option>
              <option value="payment_pending">Ödeme Bekliyor</option>
              <option value="pending_approval">Onay Bekliyor</option>
              <option value="expired">Süresi Doldu</option>
              <option value="suspended">Yönetici Tarafından Askıya Alındı</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Başlangıç Tarihi</label>
            <input
              type="date"
              value={form.subscriptionStartAt}
              onChange={(e) => setForm({ ...form, subscriptionStartAt: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Bitiş Tarihi</label>
            <input
              type="date"
              value={form.subscriptionEndAt}
              onChange={(e) => setForm({ ...form, subscriptionEndAt: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-700">
              İşletmeye Özel Abonelik Fiyatı (TL)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.lockedPrice}
              onChange={(e) => setForm({ ...form, lockedPrice: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
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
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-[#0F2942] px-5 py-2 text-xs font-semibold text-white hover:bg-[#173B5E]"
        >
          {saving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
        </button>
      </form>

      {/* İşletme Kullanıcıları ve Ödeme Geçmişi */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">İşletme Kullanıcıları</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Ad Soyad</th>
                  <th className="px-3 py-2 font-semibold">E-posta</th>
                  <th className="px-3 py-2 font-semibold">Rol / Şifre</th>
                  <th className="px-3 py-2 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.members.map(
                  (m: any) => (
                    <tr key={m.id}>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {m.profile?.first_name} {m.profile?.last_name}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{m.profile?.email}</td>
                      <td className="px-3 py-2 text-slate-700">
                        <div>{m.role_name}</div>
                        <span
                          className={`text-[10px] font-semibold ${
                            m.has_password ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {m.has_password ? 'Şifre Tanımlı' : 'Şifre Belirlenmemiş'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setPwTarget({
                              userId: m.user_id,
                              name: `${m.profile?.first_name ?? ''} ${m.profile?.last_name ?? ''}`.trim(),
                              email: m.profile?.email ?? '',
                            });
                            setNewPassword('');
                          }}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <KeyRound className="h-3 w-3" />
                          <span>Şifre Tanımla</span>
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Ödeme Geçmişi</h2>
          {detail.payments.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">Henüz ödeme bildirimi yok.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Tarih</th>
                    <th className="px-3 py-2 font-semibold">Gönderen</th>
                    <th className="px-3 py-2 text-right font-semibold">Tutar</th>
                    <th className="px-3 py-2 font-semibold">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.payments.map(
                    (p: any) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 font-mono tabular-nums">
                          {formatDateTR(p.payment_date)}
                        </td>
                        <td className="px-3 py-2">{p.payer_name}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                          {formatCurrencyTRY(p.amount)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusText
                            label={
                              p.status === 'approved'
                                ? 'Onaylandı'
                                : p.status === 'rejected'
                                ? 'Reddedildi'
                                : 'Bekliyor'
                            }
                            tone={
                              p.status === 'approved'
                                ? 'success'
                                : p.status === 'rejected'
                                ? 'danger'
                                : 'warning'
                            }
                          />
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="İşletmeyi Kalıcı Olarak Sil"
        description="Bu işlem işletmeyi ve alt verilerini sistemden kaldırır; finansal ve ödeme özeti denetim arşivinde saklanır. Geri alınamaz."
        confirmLabel="Kalıcı Olarak Sil"
        requireTextMatch={biz.name}
        requireTextLabel={`Onaylamak için işletme adını yazınız (${biz.name}):`}
        loading={saving}
        onConfirm={handleDeleteBusiness}
        onCancel={() => setDeleteOpen(false)}
      />

      {pwTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">Kullanıcı Şifresi Tanımla</h3>
              <button
                type="button"
                onClick={() => setPwTarget(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              <strong>{pwTarget.name}</strong> ({pwTarget.email}) için yeni giriş şifresi belirleyin.
            </p>
            <form onSubmit={handleSetMemberPassword} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700">Yeni Şifre (en az 8 karakter) *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPwTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-700"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#0F2942] px-4 py-2 font-semibold text-white hover:bg-[#173B5E] disabled:opacity-50"
                >
                  {saving ? 'Kaydediliyor...' : 'Şifreyi Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
