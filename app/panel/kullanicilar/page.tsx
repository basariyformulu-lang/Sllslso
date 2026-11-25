'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, X } from 'lucide-react';
import { ALL_PERMISSIONS } from '@/lib/permissions';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import type { BusinessMember } from '@/lib/types';

export default function BusinessUsersPage() {
  const { showToast } = useToast();
  const [members, setMembers] = useState<BusinessMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessMember | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    roleName: 'Kasiyer / Satış Sorumlusu',
    permissions: ['reports.view', 'customers.view'] as string[],
    isActive: true,
  });

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/users', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMembers(data.members ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Kullanıcılar yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadMembers();
    });
    return () => {
      active = false;
    };
  }, [loadMembers]);

  function togglePerm(code: string) {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(code)
        ? prev.permissions.filter((p) => p !== code)
        : [...prev.permissions, code],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/panel/users', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editing
            ? {
                memberId: editing.id,
                firstName: form.firstName,
                lastName: form.lastName,
                roleName: form.roleName,
                permissions: form.permissions,
                isActive: form.isActive,
              }
            : {
                firstName: form.firstName,
                lastName: form.lastName,
                email: form.email,
                password: form.password,
                roleName: form.roleName,
                permissions: form.permissions,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'İşlem başarısız', 'error');
        return;
      }
      showToast(editing ? 'Kullanıcı güncellendi' : 'Yeni kullanıcı eklendi', 'success');
      setModalOpen(false);
      setEditing(null);
      loadMembers();
    } finally {
      setSaving(false);
    }
  }

  const groupedPerms = ALL_PERMISSIONS.reduce<Record<string, typeof ALL_PERMISSIONS>>(
    (acc, perm) => {
      acc[perm.module] = acc[perm.module] || [];
      acc[perm.module].push(perm);
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">İşletme Kullanıcı Yönetimi</h1>
          <p className="mt-1 text-sm text-slate-600">
            İşletmenize bağlı kullanıcıları ve modül bazlı işlem yetkilerini yönetin
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setForm({
              firstName: '',
              lastName: '',
              email: '',
              password: '',
              roleName: 'Personel',
              permissions: ['reports.view', 'customers.view'],
              isActive: true,
            });
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E]"
        >
          <Plus className="h-4 w-4" />
          <span>Yeni Kullanıcı Ekle</span>
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Ad Soyad</th>
                  <th className="px-4 py-3 font-semibold">E-posta</th>
                  <th className="px-4 py-3 font-semibold">Rol</th>
                  <th className="px-4 py-3 font-semibold">Yetki Kapsamı</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {m.profile?.first_name} {m.profile?.last_name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{m.profile?.email}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{m.role_name}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {m.is_owner ? 'Tüm Yetkiler (Ana Kullanıcı)' : `${m.permissions?.length ?? 0} yetki`}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText
                        label={m.is_active ? 'Aktif' : 'Pasif'}
                        tone={m.is_active ? 'success' : 'neutral'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(m);
                          setForm({
                            firstName: m.profile?.first_name ?? '',
                            lastName: m.profile?.last_name ?? '',
                            email: m.profile?.email ?? '',
                            password: '',
                            roleName: m.role_name,
                            permissions: m.permissions ?? [],
                            isActive: m.is_active,
                          });
                          setModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Düzenle</span>
                      </button>
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
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                {editing ? 'Kullanıcı Yetkilerini Düzenle' : 'Yeni İşletme Kullanıcısı Oluştur'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Ad *</label>
                  <input
                    type="text"
                    required
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Soyad *</label>
                  <input
                    type="text"
                    required
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {!editing && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">E-posta *</label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Şifre (En az 8 karakter) *
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}

              {!editing?.is_owner && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Kullanıcı Rolü *</label>
                    <input
                      type="text"
                      required
                      value={form.roleName}
                      onChange={(e) => setForm({ ...form, roleName: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-800 mb-2">Modül ve İşlem Yetkileri</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {Object.entries(groupedPerms).map(([moduleName, perms]) => (
                        <div key={moduleName} className="space-y-1.5">
                          <p className="text-xs font-semibold text-[#0F2942]">{moduleName}</p>
                          {perms.map((p) => (
                            <label
                              key={p.code}
                              className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={form.permissions.includes(p.code)}
                                onChange={() => togglePerm(p.code)}
                              />
                              <span>{p.label}</span>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {editing && !editing.is_owner && (
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  />
                  <span>Kullanıcı Aktif</span>
                </label>
              )}

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
    </div>
  );
}
