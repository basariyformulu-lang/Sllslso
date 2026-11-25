'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Star, X } from 'lucide-react';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import type { BankAccount } from '@/lib/types';

export default function AdminBankAccountsPage() {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    bankName: '',
    iban: '',
    accountHolder: '',
    description: '',
    isActive: true,
    isDefault: false,
  });

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/bank-accounts', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAccounts(data.bankAccounts ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Banka hesapları yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadAccounts();
    });
    return () => {
      active = false;
    };
  }, [loadAccounts]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/bank-accounts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: editing.id, ...form } : form),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Banka hesabı kaydedilemedi', 'error');
        return;
      }
      showToast(editing ? 'Banka hesabı güncellendi' : 'Banka hesabı eklendi', 'success');
      setModalOpen(false);
      setEditing(null);
      loadAccounts();
    } finally {
      setSaving(false);
    }
  }

  async function setAsDefault(id: string) {
    const res = await fetch('/api/admin/bank-accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isDefault: true, isActive: true }),
    });
    if (res.ok) {
      showToast('Varsayılan banka hesabı güncellendi', 'success');
      loadAccounts();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Banka Hesapları (IBAN)</h1>
          <p className="mt-1 text-sm text-slate-600">
            İşletme ödeme ekranında yalnızca aktif banka hesapları gösterilir. IBAN değişikliği
            geçmiş ödeme taleplerinin kayıtlarını bozmaz.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setForm({
              bankName: '',
              iban: '',
              accountHolder: '',
              description: '',
              isActive: true,
              isDefault: accounts.length === 0,
            });
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E]"
        >
          <Plus className="h-4 w-4" />
          <span>Yeni Banka Hesabı</span>
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Henüz banka hesabı tanımlanmamış. İşletmelerin havale yapabilmesi için en az bir aktif
            hesap ekleyin.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Banka Adı</th>
                  <th className="px-4 py-3 font-semibold">IBAN</th>
                  <th className="px-4 py-3 font-semibold">Alıcı Adı / Unvanı</th>
                  <th className="px-4 py-3 font-semibold">Varsayılan</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((acc) => (
                  <tr key={acc.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{acc.bank_name}</td>
                    <td className="px-4 py-3 font-mono text-slate-800">{acc.iban}</td>
                    <td className="px-4 py-3 text-slate-700">{acc.account_holder}</td>
                    <td className="px-4 py-3">
                      {acc.is_default ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                          <Star className="h-3.5 w-3.5 fill-emerald-700" />
                          <span>Varsayılan</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAsDefault(acc.id)}
                          className="text-slate-500 hover:text-[#0F2942] hover:underline"
                        >
                          Varsayılan Yap
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText
                        label={acc.is_active ? 'Aktif' : 'Pasif'}
                        tone={acc.is_active ? 'success' : 'neutral'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(acc);
                          setForm({
                            bankName: acc.bank_name,
                            iban: acc.iban,
                            accountHolder: acc.account_holder,
                            description: acc.description,
                            isActive: acc.is_active,
                            isDefault: acc.is_default,
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
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {editing ? 'Banka Hesabını Düzenle' : 'Yeni Banka Hesabı Ekle'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Banka Adı *</label>
                <input
                  type="text"
                  required
                  value={form.bankName}
                  onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  placeholder="Örn: Ziraat Bankası"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">IBAN *</label>
                <input
                  type="text"
                  required
                  value={form.iban}
                  onChange={(e) => setForm({ ...form, iban: e.target.value })}
                  placeholder="TR00 0000 0000 0000 0000 0000 00"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Alıcı Adı / Firma Unvanı *
                </label>
                <input
                  type="text"
                  required
                  value={form.accountHolder}
                  onChange={(e) => setForm({ ...form, accountHolder: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Açıklama</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  />
                  <span>Hesap Aktif</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  />
                  <span>Varsayılan Hesap</span>
                </label>
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
    </div>
  );
}
