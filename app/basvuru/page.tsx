'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Info, X } from 'lucide-react';
import { createBrowserSupabase, isSupabaseClientConfigured } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import { SetupNotice } from '@/components/SetupNotice';

export default function BasvuruPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const configured = isSupabaseClientConfigured();

  const [form, setForm] = useState({
    businessName: '',
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
    acceptedTerms: false,
  });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [termsText, setTermsText] = useState('');
  const [privacyText, setPrivacyText] = useState('');
  const [legalModal, setLegalModal] = useState<'terms' | 'privacy' | null>(null);

  useEffect(() => {
    fetch('/api/public/site')
      .then((r) => r.json())
      .then((d) => {
        if (d?.settings) {
          setTermsText(d.settings.terms_of_service || '');
          setPrivacyText(d.settings.privacy_policy || '');
        }
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    if (form.password !== form.confirmPassword) {
      setErrorMsg('Şifreler eşleşmiyor.');
      return;
    }

    if (!form.acceptedTerms) {
      setErrorMsg('Kullanım koşulları ve gizlilik metnini onaylamanız gerekiyor.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || 'Başvuru oluşturulamadı.');
        return;
      }

      const supabase = createBrowserSupabase();
      if (supabase) {
        await supabase.auth.signInWithPassword({
          email: form.email.trim().toLowerCase(),
          password: form.password,
        });
      }

      showToast('İşletme başvurunuz oluşturuldu', 'success', 'Ödeme ekranına yönlendiriliyorsunuz.');
      router.push('/odeme');
      router.refresh();
    } catch {
      setErrorMsg('Başvuru sırasında bağlantı hatası oluştu.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-8 text-center">
          <Link href="/" className="text-2xl font-bold tracking-tight text-[#0F2942] font-display">
            EsnafTakip
          </Link>
          <h1 className="mt-3 text-xl font-bold text-slate-900">İşletme Abonelik Başvurusu</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            İşletme kaydınızı oluşturun, ardından banka havalesi / EFT ile aboneliğinizi başlatın.
          </p>
        </div>

        {!configured ? (
          <SetupNotice context="İşletme başvurusu" />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
            {errorMsg && (
              <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Firma / İşletme Adı *
                </label>
                <input
                  type="text"
                  required
                  value={form.businessName}
                  onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                  placeholder="Örn: Yılmaz Market ve Gıda"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Yetkili Adı *</label>
                  <input
                    type="text"
                    required
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    placeholder="Ad"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Yetkili Soyadı *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    placeholder="Soyad"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Telefon Numarası *
                  </label>
                  <input
                    type="tel"
                    required
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="05XX XXX XX XX"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    E-posta Adresi *
                  </label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="ornek@isletme.com"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Şifre (En az 8 karakter) *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Şifre Tekrar *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={form.confirmPassword}
                    onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                    placeholder="••••••••"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#0F2942] focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-start gap-2.5 text-xs text-slate-600">
                <Info className="h-4 w-4 text-[#0F2942] shrink-0 mt-0.5" />
                <span>
                  Başvuru sonrası hesabınız “Ödeme Bekliyor” durumunda açılır. SMS ve e-posta
                  doğrulama kayıtları veritabanında tutulur; doğrulama gönderimi için yalnızca
                  gerçek sağlayıcı bağlandığında bildirim gönderilir.
                </span>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.acceptedTerms}
                  onChange={(e) => setForm({ ...form, acceptedTerms: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0F2942]"
                />
                <span>
                  <button
                    type="button"
                    onClick={() => setLegalModal('terms')}
                    className="font-semibold text-[#0F2942] underline"
                  >
                    Kullanım Koşulları
                  </button>{' '}
                  ve{' '}
                  <button
                    type="button"
                    onClick={() => setLegalModal('privacy')}
                    className="font-semibold text-[#0F2942] underline"
                  >
                    Gizlilik Politikası
                  </button>{' '}
                  metnini okudum ve onaylıyorum.
                </span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#173B5E] transition-colors disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>{loading ? 'Başvuru Oluşturuluyor...' : 'Başvuruyu Tamamla'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-6 border-t border-slate-200 pt-5 text-center text-xs text-slate-600">
              Zaten hesabınız var mı?{' '}
              <Link href="/giris" className="font-semibold text-[#0F2942] hover:underline">
                Giriş Yapın
              </Link>
            </div>
          </div>
        )}
      </div>

      {legalModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {legalModal === 'terms' ? 'Kullanım Koşulları' : 'Gizlilik Politikası'}
              </h3>
              <button
                type="button"
                onClick={() => setLegalModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-600">
              {legalModal === 'terms' ? termsText : privacyText}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
