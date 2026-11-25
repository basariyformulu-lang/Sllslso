'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Copy,
  Check,
  Building2,
  Clock,
  AlertCircle,
  LogOut,
  Upload,
  ArrowRight,
} from 'lucide-react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { formatCurrencyTRY, formatDateTR, getIstanbulTodayISO } from '@/lib/format';
import { getSubscriptionStatusDisplay, StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import type { BankAccount, Business, PaymentRequest, SubscriptionPlan } from '@/lib/types';

export default function OdemePage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [business, setBusiness] = useState<Business | null>(null);
  const [plan, setPlan] = useState<SubscriptionPlan | null>(null);
  const [subscriptionPrice, setSubscriptionPrice] = useState<number>(0);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [payerName, setPayerName] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(getIstanbulTodayISO());
  const [receiptData, setReceiptData] = useState<string | null>(null);
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/payments', { cache: 'no-store' });
      if (res.status === 401) {
        router.push('/giris');
        return;
      }
      const data = await res.json();
      if (data.isSubscriptionActive) {
        router.push('/panel');
        return;
      }
      setBusiness(data.business ?? null);
      setPlan(data.plan ?? null);
      const effectivePrice = Number(
        data.subscription?.locked_price ?? data.plan?.monthly_price ?? 0
      );
      setSubscriptionPrice(effectivePrice);
      setAmount(String(effectivePrice));
      const accounts: BankAccount[] = data.bankAccounts ?? [];
      setBankAccounts(accounts);
      if (accounts.length > 0) {
        const def = accounts.find((a) => a.is_default) ?? accounts[0];
        setSelectedBankId(def.id);
      }
      setRequests(data.requests ?? []);
    } catch {
      showToast('Ödeme bilgileri yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [router, showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  async function handleLogout() {
    const supabase = createBrowserSupabase();
    if (supabase) await supabase.auth.signOut();
    router.push('/giris');
  }

  function handleCopyIban(id: string, iban: string) {
    navigator.clipboard?.writeText(iban);
    setCopiedId(id);
    showToast('IBAN panoya kopyalandı', 'info');
    setTimeout(() => setCopiedId(null), 2000);
  }

  function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_400_000) {
      showToast('Dekont dosyası 1.4 MB boyutundan küçük olmalıdır.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setReceiptData(typeof reader.result === 'string' ? reader.result : null);
      setReceiptName(file.name);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmitPayment(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountId: selectedBankId,
          payerName,
          amount: Number(amount),
          paymentDate,
          receiptUrl: receiptData,
          receiptName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Ödeme talebi gönderilemedi.', 'error');
        return;
      }
      showToast('Ödeme bildiriminiz alındı', 'success', 'Yönetici onayı sonrası paneliniz açılacaktır.');
      setShowForm(false);
      await loadData();
    } catch {
      showToast('Bağlantı hatası oluştu.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const pendingReq = requests.find((r) => r.status === 'pending');
  const latestRejected = !pendingReq ? requests.find((r) => r.status === 'rejected') : null;
  const subStatus = getSubscriptionStatusDisplay(business?.subscription_status ?? 'payment_pending');

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] p-6 flex items-center justify-center">
        <div className="w-full max-w-3xl space-y-4">
          <div className="h-12 rounded-xl bg-slate-200 animate-pulse" />
          <div className="h-64 rounded-xl bg-slate-200 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="text-lg font-bold text-[#0F2942] font-display">
            EsnafTakip
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-xs font-medium text-slate-600">
              {business?.name}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Çıkış Yap</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <p className="text-xs font-medium text-slate-500">Abonelik Aktivasyon Ekranı</p>
              <h1 className="mt-1 text-xl font-bold text-slate-900">
                {business?.name} — Havale / EFT Ödeme Bilgileri
              </h1>
            </div>
            <StatusText label={subStatus.label} tone={subStatus.tone} />
          </div>

          {pendingReq && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <Clock className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-950">
                <p className="font-semibold">Ödeme Bildiriminiz Onay Bekliyor</p>
                <p className="mt-1 text-xs leading-relaxed">
                  {formatDateTR(pendingReq.payment_date)} tarihli{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {formatCurrencyTRY(pendingReq.amount)}
                  </span>{' '}
                  tutarındaki ödeme talebiniz sistem yöneticisi tarafından incelenmektedir. Onay
                  tamamlanana kadar yeni talep gönderilemez.
                </p>
              </div>
            </div>
          )}

          {latestRejected && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-700 shrink-0 mt-0.5" />
              <div className="text-sm text-red-950">
                <p className="font-semibold">Önceki Ödeme Talebiniz Reddedildi</p>
                <p className="mt-1 text-xs">
                  Reddetme Sebebi: <span className="font-semibold">{latestRejected.rejected_reason}</span>
                </p>
              </div>
            </div>
          )}

          {/* Paket Özeti */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="text-xs text-slate-500">Abonelik Paketi</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{plan?.name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Ödenecek Tutar</p>
              <p className="mt-1 font-mono text-base font-bold text-[#0F2942] tabular-nums">
                {formatCurrencyTRY(subscriptionPrice)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Abonelik Süresi</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {plan?.duration_days ?? 30} Gün
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Havale Açıklama Kodu</p>
              <p className="mt-1 font-mono text-sm font-bold text-emerald-700">
                {business?.business_code}
              </p>
            </div>
          </div>

          {/* Aktif Banka Hesapları */}
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-slate-900">
              Ödeme Yapılacak Banka Hesapları
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Havale veya EFT açıklamasına{' '}
              <span className="font-mono font-semibold text-slate-800">
                {business?.business_code}
              </span>{' '}
              kodunu yazmanız onay sürecini hızlandırır.
            </p>

            {bankAccounts.length === 0 ? (
              <div className="mt-4 rounded-lg border border-slate-200 p-6 text-center text-sm text-slate-600">
                Henüz sistem yöneticisi tarafından aktif edilmiş bir banka hesabı bulunmuyor.
                Lütfen yönetici ile iletişime geçiniz.
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {bankAccounts.map((acc) => (
                  <div
                    key={acc.id}
                    className={`rounded-xl border p-4 ${
                      acc.is_default ? 'border-[#0F2942] bg-slate-50/70' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-[#0F2942]" />
                        <span className="text-sm font-semibold text-slate-900">{acc.bank_name}</span>
                      </div>
                      {acc.is_default && (
                        <span className="text-[11px] font-semibold text-emerald-700">
                          Varsayılan Hesap
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Alıcı: <span className="font-medium text-slate-900">{acc.account_holder}</span>
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <span className="font-mono text-xs font-semibold text-slate-900 truncate">
                        {acc.iban}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyIban(acc.id, acc.iban)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#0F2942] hover:underline shrink-0"
                      >
                        {copiedId === acc.id ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Kopyalandı</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Kopyala</span>
                          </>
                        )}
                      </button>
                    </div>
                    {acc.description && (
                      <p className="mt-2 text-xs text-slate-500">{acc.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ödemeyi Gerçekleştirdim Butonu / Formu */}
          {!pendingReq && bankAccounts.length > 0 && (
            <div className="mt-8 border-t border-slate-200 pt-6">
              {!showForm ? (
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-6 py-3 text-sm font-semibold text-white hover:bg-[#173B5E]"
                >
                  <span>Ödemeyi Gerçekleştirdim</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <form
                  onSubmit={handleSubmitPayment}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-4"
                >
                  <h3 className="text-sm font-semibold text-slate-900">
                    Ödeme Bildirim Formu
                  </h3>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Ödeme Yapılan Banka Hesabı *
                      </label>
                      <select
                        required
                        value={selectedBankId}
                        onChange={(e) => setSelectedBankId(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                      >
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.bank_name} — {a.account_holder}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Ödeme Yapan Kişi / Firma Unvanı *
                      </label>
                      <input
                        type="text"
                        required
                        value={payerName}
                        onChange={(e) => setPayerName(e.target.value)}
                        placeholder="Dekontta görünen gönderen adı"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Gönderilen Tutar (TL) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        required
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-[#0F2942] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Ödeme Tarihi *
                      </label>
                      <input
                        type="date"
                        required
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Banka Dekontu (İsteğe Bağlı)
                      </label>
                      <label className="mt-1.5 flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
                        <Upload className="h-4 w-4 text-slate-500 shrink-0" />
                        <span className="truncate">
                          {receiptName || 'PDF veya Görsel Seç'}
                        </span>
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={handleReceiptChange}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      İptal
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                    >
                      {submitting ? 'Gönderiliyor...' : 'Ödeme Talebini Gönder'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Geçmiş Ödeme Talepleri */}
          {requests.length > 0 && (
            <div className="mt-8 border-t border-slate-200 pt-6">
              <h3 className="text-sm font-semibold text-slate-900">Ödeme Talepleriniz</h3>
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Ödeme Tarihi</th>
                      <th className="px-4 py-2.5 font-semibold">Gönderen</th>
                      <th className="px-4 py-2.5 font-semibold">Banka</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Tutar</th>
                      <th className="px-4 py-2.5 font-semibold">Durum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {requests.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2.5 font-mono tabular-nums">
                          {formatDateTR(r.payment_date)}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{r.payer_name}</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {r.bank_snapshot?.bank_name ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                          {formatCurrencyTRY(r.amount)}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusText
                            label={
                              r.status === 'approved'
                                ? 'Onaylandı'
                                : r.status === 'rejected'
                                ? 'Reddedildi'
                                : 'Onay Bekliyor'
                            }
                            tone={
                              r.status === 'approved'
                                ? 'success'
                                : r.status === 'rejected'
                                ? 'danger'
                                : 'warning'
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
