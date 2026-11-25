'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Eye } from 'lucide-react';
import { formatDateTR } from '@/lib/format';
import { getSubscriptionStatusDisplay, StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';

interface AdminBusinessRow {
  id: string;
  name: string;
  business_code: string;
  owner_name: string;
  phone: string;
  email: string;
  created_at: string;
  subscription_status: string;
  subscription_start_at: string | null;
  subscription_end_at: string | null;
  last_payment_date: string | null;
  is_active: boolean;
}

export default function AdminBusinessesPage() {
  const { showToast } = useToast();
  const [businesses, setBusinesses] = useState<AdminBusinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const loadBusinesses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/businesses', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBusinesses(data.businesses ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'İşletmeler yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const durum = new URLSearchParams(window.location.search).get('durum');
      if (durum && ['all', 'active', 'passive', 'payment_pending', 'pending_approval', 'expired'].includes(durum)) {
        setFilter(durum);
      }
      void loadBusinesses();
    });
    return () => {
      active = false;
    };
  }, [loadBusinesses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return businesses.filter((b) => {
      if (filter === 'active' && (!b.is_active || b.subscription_status !== 'active')) return false;
      if (filter === 'passive' && b.is_active && b.subscription_status !== 'passive') return false;
      if (filter === 'payment_pending' && b.subscription_status !== 'payment_pending') return false;
      if (filter === 'pending_approval' && b.subscription_status !== 'pending_approval') return false;
      if (filter === 'expired' && b.subscription_status !== 'expired') return false;
      if (!q) return true;
      return `${b.name} ${b.owner_name} ${b.email} ${b.phone} ${b.business_code}`
        .toLowerCase()
        .includes(q);
    });
  }, [businesses, search, filter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">İşletme Yönetimi</h1>
        <p className="mt-1 text-sm text-slate-600">
          Kayıtlı tüm işletmeleri filtreleyin, abonelik durumlarını ve detaylarını yönetin
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="İşletme, yetkili, e-posta veya kod ara..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          {[
            { id: 'all', label: 'Tüm İşletmeler' },
            { id: 'active', label: 'Aktif' },
            { id: 'passive', label: 'Pasif' },
            { id: 'payment_pending', label: 'Ödeme Bekleyenler' },
            { id: 'pending_approval', label: 'Onay Bekleyenler' },
            { id: 'expired', label: 'Süresi Dolanlar' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                filter === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Seçili filtreye uygun işletme bulunamadı.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">İşletme Adı</th>
                  <th className="px-4 py-3 font-semibold">Yetkili Ad Soyad</th>
                  <th className="px-4 py-3 font-semibold">Telefon / E-posta</th>
                  <th className="px-4 py-3 font-semibold">Kayıt Tarihi</th>
                  <th className="px-4 py-3 font-semibold">Abonelik Durumu</th>
                  <th className="px-4 py-3 font-semibold">Başlangıç / Bitiş</th>
                  <th className="px-4 py-3 font-semibold">Son Ödeme</th>
                  <th className="px-4 py-3 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((b) => {
                  const st = getSubscriptionStatusDisplay(
                    !b.is_active ? 'passive' : b.subscription_status
                  );
                  return (
                    <tr key={b.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{b.name}</p>
                        <p className="font-mono text-[11px] text-slate-500">{b.business_code}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{b.owner_name}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>{b.phone || '—'}</div>
                        <div className="text-[11px] text-slate-500">{b.email}</div>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">
                        {formatDateTR(b.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText label={st.label} tone={st.tone} />
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-slate-600">
                        <div>{formatDateTR(b.subscription_start_at)}</div>
                        <div>{formatDateTR(b.subscription_end_at)}</div>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-600">
                        {formatDateTR(b.last_payment_date)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/isletmeler/${b.id}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Yönet</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
