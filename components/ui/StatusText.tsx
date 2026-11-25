import React from 'react';
import { CheckCircle2, Clock, AlertCircle, XCircle, Ban } from 'lucide-react';

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

export function StatusText({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: Tone;
}) {
  const styles: Record<Tone, string> = {
    success: 'text-emerald-700',
    warning: 'text-amber-700',
    danger: 'text-red-700',
    neutral: 'text-slate-600',
  };

  const Icon =
    tone === 'success'
      ? CheckCircle2
      : tone === 'warning'
      ? Clock
      : tone === 'danger'
      ? AlertCircle
      : Ban;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${styles[tone]}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export function getSubscriptionStatusDisplay(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'active':
      return { label: 'Aktif', tone: 'success' };
    case 'pending_approval':
      return { label: 'Onay Bekliyor', tone: 'warning' };
    case 'payment_pending':
      return { label: 'Ödeme Bekliyor', tone: 'warning' };
    case 'expired':
      return { label: 'Süresi Doldu', tone: 'danger' };
    case 'suspended':
      return { label: 'Askıya Alındı', tone: 'danger' };
    default:
      return { label: 'Pasif', tone: 'neutral' };
  }
}

export function getCreditSaleStatusDisplay(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'tahsil_edildi':
      return { label: 'Tamamen Tahsil Edildi', tone: 'success' };
    case 'kismen_tahsil':
      return { label: 'Kısmen Tahsil Edildi', tone: 'warning' };
    case 'vadesi_geldi':
      return { label: 'Vadesi Geldi', tone: 'warning' };
    case 'gecikmis':
      return { label: 'Gecikmiş', tone: 'danger' };
    case 'iptal':
      return { label: 'İptal Edildi', tone: 'neutral' };
    default:
      return { label: 'Vadesi Gelmedi', tone: 'neutral' };
  }
}

export { XCircle };
