'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { createBrowserSupabase, isSupabaseClientConfigured } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import { SetupNotice } from '@/components/SetupNotice';

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const configured = isSupabaseClientConfigured();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    const supabase = createBrowserSupabase();
    if (!supabase) {
      setErrorMsg('Supabase bağlantısı yapılandırılmamış.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        setErrorMsg('E-posta adresi veya şifre hatalı.');
        return;
      }

      const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
      const meData = await meRes.json();

      if (!meData.user) {
        setErrorMsg('Kullanıcı oturumu doğrulanamadı.');
        return;
      }

      showToast('Giriş başarılı', 'success');

      if (meData.user.isSystemAdmin && !meData.user.member) {
        router.push('/admin');
        router.refresh();
        return;
      }

      if (meData.user.isSystemAdmin) {
        router.push('/admin');
        router.refresh();
        return;
      }

      if (!meData.user.member && meData.user.customerAccount) {
        router.push('/musteri');
        router.refresh();
        return;
      }

      if (!meData.user.isSubscriptionActive) {
        router.push('/odeme');
        router.refresh();
        return;
      }

      router.push('/panel');
      router.refresh();
    } catch {
      setErrorMsg('Giriş sırasında bir hata oluştu. Lütfen tekrar deneyin.');
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
          <p className="mt-2 text-sm text-slate-600">
            İşletme yönetim panelinize veya sistem yönetimine giriş yapın
          </p>
        </div>

        {!configured ? (
          <SetupNotice context="Kullanıcı girişi" />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">Hesaba Giriş Yap</h1>

            {errorMsg && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
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
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-700">Şifre</label>
                  <Link
                    href="/sifre-sifirla"
                    className="text-xs font-medium text-[#0F2942] hover:underline"
                  >
                    Şifremi Unuttum
                  </Link>
                </div>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#173B5E] transition-colors disabled:opacity-60"
              >
                <span>{loading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-6 border-t border-slate-200 pt-5 space-y-2 text-center text-xs text-slate-600">
              <p>
                Henüz işletme hesabınız yok mu?{' '}
                <Link href="/basvuru" className="font-semibold text-[#0F2942] hover:underline">
                  Ücretsiz Başvuru Yapın
                </Link>
              </p>
              <p>
                Randevu müşterisi misiniz?{' '}
                <Link href="/musteri" className="font-semibold text-emerald-700 hover:underline">
                  Müşteri Randevu Portalı
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
