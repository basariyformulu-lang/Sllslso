'use client';

import React, { useState } from 'react';
import { formatCurrencyTRY } from '@/lib/format';

interface SeriesPoint {
  key: string;
  label: string;
  registrations: number;
  revenue: number;
}

export function AdminMonthlyCharts({ series }: { series: SeriesPoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxRev = Math.max(1, ...series.map((s) => s.revenue));
  const maxReg = Math.max(1, ...series.map((s) => s.registrations));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Aylık Abonelik Tahsilatı */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Aylık Abonelik Tahsilatları
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">Son 6 ay onaylanan ödemeler (TRY)</p>
          </div>
          {hoveredIdx !== null && series[hoveredIdx] && (
            <span className="font-mono text-xs font-semibold text-[#0F2942] tabular-nums">
              {series[hoveredIdx].label}: {formatCurrencyTRY(series[hoveredIdx].revenue)}
            </span>
          )}
        </div>

        <div className="mt-6 flex h-44 items-end gap-3">
          {series.map((item, idx) => {
            const pct = Math.max(4, Math.round((item.revenue / maxRev) * 100));
            return (
              <div
                key={item.key}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="flex flex-1 flex-col items-center gap-2"
              >
                <div className="flex h-32 w-full items-end justify-center">
                  <div
                    className="w-full max-w-[44px] rounded-t-md bg-[#0F2942] transition-all duration-150 hover:bg-[#173B5E]"
                    style={{ height: `${pct}%` }}
                    title={`${item.label}: ${formatCurrencyTRY(item.revenue)}`}
                  />
                </div>
                <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Aylık Yeni İşletme Kayıtları */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Yeni İşletme Başvuruları
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">Son 6 ay kayıt olan işletme sayısı</p>
          </div>
          <span className="font-mono text-xs font-medium text-emerald-700 tabular-nums">
            Toplam: {series.reduce((a, b) => a + b.registrations, 0)} işletme
          </span>
        </div>

        <div className="mt-6 flex h-44 items-end gap-3">
          {series.map((item) => {
            const pct = Math.max(6, Math.round((item.registrations / maxReg) * 100));
            return (
              <div key={item.key} className="flex flex-1 flex-col items-center gap-2">
                <span className="font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
                  {item.registrations}
                </span>
                <div className="flex h-28 w-full items-end justify-center">
                  <div
                    className="w-full max-w-[44px] rounded-t-md bg-emerald-700 transition-all duration-150 hover:bg-emerald-800"
                    style={{ height: `${pct}%` }}
                  />
                </div>
                <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
