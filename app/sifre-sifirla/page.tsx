'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, CheckCircle2, ShieldCheck, KeyRound } from 'lucide-react';

export default function ResetPasswordPage() {
  const [step, setStep] = useState<'verify' | 'confirm' | 'done'>('verify');
  const [email, setEmail] = useState('');
  const [phoneOrCode, setPhoneOrCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify',
          email: email.trim().toLowerCase(),
          phoneOrCode: phoneOrCode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Doğrulama başarısız.');
        return;
      }
      setResetToken(data.resetToken);
      setStep('confirm');
    } catch {
      setErrorMsg('Doğrulama sırasında bağlantı hatası oluştu.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    if (password.length < 8) {
      setErrorMsg('Yeni şifre en az 8 karakter olmalıdır.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Şifreler eşleşmiyor.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          email: email.trim().toLowerCase(),
          token: resetToken,
          password,
          confirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Şifre güncellenemedi.');
        return;
      }
      setStep('done');
    } catch {
      setErrorMsg('Şifre güncelleme sırasında hata oluştu.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="text-2xl font-bold tracking-tight text-[#0F2942] font-display">
            EsnafTakip
          </Link>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Şifre Sıfırlama / Yeni Şifre Belirleme</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            Kayıtlı e-posta adresinizi ve telefon numaranızı (veya ESNAF-... işletme kodunuzu)
            doğrulayarak şifrenizi hemen yenileyebilirsiniz.
          </p>

          {errorMsg && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          {step === 'done' ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Yeni şifreniz kaydedildi. Artık e-posta ve yeni şifrenizle giriş yapabilirsiniz.</span>
              </div>
              <Link
                href="/giris"
                className="flex w-full items-center justify-center rounded-lg bg-[#0F2942] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#173B5E]"
              >
                Giriş Sayfasına Git
              </Link>
            </div>
          ) : step === 'confirm' ? (
            <form onSubmit={handleConfirm} className="mt-5 space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Hesap doğrulandı ({email}). Yeni şifrenizi belirleyin.
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Yeni Şifre (En az 8 karakter)
                </label>
                <div className="relative mt-1.5">
                  <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Yeni Şifre Tekrar</label>
                <div className="relative mt-1.5">
                  <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#064E3B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#065F46] disabled:opacity-60"
              >
                {loading ? 'Kaydediliyor...' : 'Yeni Şifreyi Kaydet'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">E-posta Adresi</label>
                <div className="relative mt-1.5">
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ornek@isletme.com"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Kayıtlı Telefon veya İşletme Kodu (ESNAF-...)
                </label>
                <div className="relative mt-1.5">
                  <ShieldCheck className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={phoneOrCode}
                    onChange={(e) => setPhoneOrCode(e.target.value)}
                    placeholder="05XX XXX XX XX veya ESNAF-XXXXXX"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#0F2942] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#173B5E] disabled:opacity-60"
              >
                {loading ? 'Doğrulanıyor...' : 'Hesabımı Doğrula ve Devam Et'}
              </button>
            </form>
          )}

          <div className="mt-6 border-t border-slate-200 pt-4">
            <Link
              href="/giris"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F2942]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Giriş Ekranına Dön</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
