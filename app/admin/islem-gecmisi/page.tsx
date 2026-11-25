'use client';

import React, { useEffect, useState } from 'react';
import { formatDateTimeTR } from '@/lib/format';
import { useToast } from '@/components/ToastProvider';

interface AdminAuditLog {
  id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  description: string;
  created_at: string;
  businesses?: { name: string; business_code: string } | null;
}

export default function AdminAuditLogsPage() {
  const { showToast } = useToast();
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/audit-logs', { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setLogs(data.logs ?? []);
      })
      .catch((e) => showToast(e.message || 'İşlem geçmişi yüklenemedi', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Yönetici İşlem Geçmişi</h1>
        <p className="mt-1 text-sm text-slate-600">
          Tüm abonelik, ödeme onayı, IBAN, paket fiyatı ve işletme değişikliklerinin denetim
          kayıtları
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Henüz yönetici işlem kaydı bulunmuyor.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Tarih</th>
                  <th className="px-4 py-3 font-semibold">Yönetici</th>
                  <th className="px-4 py-3 font-semibold">İşlem Türü</th>
                  <th className="px-4 py-3 font-semibold">Etkilenen İşletme</th>
                  <th className="px-4 py-3 font-semibold">Açıklama</th>
                  <th className="px-4 py-3 font-semibold">Değişiklik Özeti</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-3 font-mono tabular-nums whitespace-nowrap text-slate-500">
                      {formatDateTimeTR(log.created_at)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {log.actor_name || 'Sistem Yöneticisi'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-[#0F2942]">
                      {log.action}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {log.businesses?.name ?? 'Sistem Geneli'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{log.description}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500 max-w-xs truncate">
                      {log.old_values ? `Eski: ${JSON.stringify(log.old_values)} ` : ''}
                      {log.new_values ? `Yeni: ${JSON.stringify(log.new_values)}` : ''}
                    </td>
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
