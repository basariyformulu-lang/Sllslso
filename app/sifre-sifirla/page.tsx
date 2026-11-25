'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, CheckCircle2 } from 'lucide-react';
import { createBrowserSupabase, isSupabaseClientConfigured } from '@/lib/supabase/client';
import { SetupNotice } from '@/components/SetupNotice';

export default function ResetPasswordPage() {
  const configured = isSupabaseClientConfigured();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    const supabase = createBrowserSupabase();
    if (!supabase) return;

    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/giris`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setSent(true);
    } catch {
      setErrorMsg('Şifre sıfırlama talebi gönderilemedi.');
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

        {!configured ? (
          <SetupNotice context="Şifre sıfırlama" />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">Şifre Sıfırlama</h1>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              Kayıtlı e-posta adresinizi girin. Supabase Auth üzerinden şifre sıfırlama bağlantısı
              gönderilecektir.
            </p>

            {sent ? (
              <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Eğer bu e-posta adresi sistemde kayıtlıysa şifre sıfırlama talimatları gönderildi.
                </span>
              </div>
            ) : (
              <form onSubmit={handleReset} className="mt-5 space-y-4">
                {errorMsg && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {errorMsg}
                  </div>
                )}
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
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-[#0F2942] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#173B5E] disabled:opacity-60"
                >
                  {loading ? 'Gönderiliyor...' : 'Sıfırlama Bağlantısı Gönder'}
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
        )}
      </div>
    </div>
  );
}
