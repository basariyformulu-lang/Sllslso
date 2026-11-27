'use client';

import React from 'react';
import Link from 'next/link';
import { Database, ArrowLeft } from 'lucide-react';

export function SetupNotice({ context = 'sistem' }: { context?: string }) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
          <Database className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            MySQL Veritabanı Bağlantısı Yapılandırılmamış
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
            {context} işlemlerinin gerçek veritabanı ve kimlik doğrulama ile çalışabilmesi için
            sunucu ortam değişkenlerinin tanımlanması gerekiyor.
          </p>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700 space-y-1">
            <div>MYSQL_HOST</div>
            <div>MYSQL_DATABASE</div>
            <div>MYSQL_USER</div>
            <div>MYSQL_PASSWORD</div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Ortam değişkenleri eklendikten sonra <code className="font-mono">/admin</code>{' '}
            sayfasından tek tıkla <code className="font-mono">mysql/schema.sql</code> tablolarını
            kurabilirsiniz.
          </p>
          <div className="mt-4">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F2942] hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Ana Sayfaya Dön</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
