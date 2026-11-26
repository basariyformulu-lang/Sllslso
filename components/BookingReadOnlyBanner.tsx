'use client';

import React from 'react';
import { Lock } from 'lucide-react';

export function BookingReadOnlyBanner({ visible }: { visible?: boolean }) {
  if (!visible) return null;

  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <div className="text-xs leading-relaxed">
        <p className="font-semibold">Salt Okunur Mod (Online Randevu Modülü Kısıtlı)</p>
        <p className="mt-0.5 text-amber-900/85">
          Online randevu modülünüz şu anda platform yöneticisi tarafından kilitlenmiş veya pasife
          alınmıştır. Geçmiş randevu, müşteri ve ödeme verileriniz güvenle korunmaktadır ancak yeni
          değişiklik ve online randevu alımı durdurulmuştur.
        </p>
      </div>
    </div>
  );
}
