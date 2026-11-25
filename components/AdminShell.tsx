'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  PackageCheck,
  Landmark,
  Sliders,
  History,
  LogOut,
  Menu,
  X,
  ShieldAlert,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Database,
} from 'lucide-react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import { SetupNotice } from '@/components/SetupNotice';

const ADMIN_NAV = [
  { href: '/admin', label: 'Yönetici Ana Ekranı', icon: LayoutDashboard },
  { href: '/admin/isletmeler', label: 'İşletme Yönetimi', icon: Building2 },
  { href: '/admin/odeme-talepleri', label: 'Ödeme Talepleri', icon: CreditCard },
  { href: '/admin/abonelik-ayarlari', label: 'Abonelik Ayarları', icon: PackageCheck },
  { href: '/admin/banka-hesaplari', label: 'Banka Hesapları (IBAN)', icon: Landmark },
  { href: '/admin/ayarlar', label: 'Sistem Ayarları', icon: Sliders },
  { href: '/admin/islem-gecmisi', label: 'Yönetici İşlem Geçmişi', icon: History },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();

  const [state, setState] = useState<
    'loading' | 'unconfigured' | 'needs_schema' | 'needs_bootstrap' | 'unauthorized' | 'ready'
  >('loading');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [requiresSecret, setRequiresSecret] = useState(false);
  const [projectRef, setProjectRef] = useState<string | null>(null);
  const [sqlScript, setSqlScript] = useState('');
  const [sqlCopied, setSqlCopied] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [bootForm, setBootForm] = useState({
    fullName: '',
    email: '',
    password: '',
    bootstrapSecret: '',
  });
  const [bootSaving, setBootSaving] = useState(false);

  const verifyAdmin = useCallback(async () => {
    try {
      const [meRes, bootRes] = await Promise.all([
        fetch('/api/auth/me', { cache: 'no-store' }),
        fetch('/api/admin/bootstrap?includeSql=1', { cache: 'no-store' }),
      ]);
      const meData = await meRes.json();
      const bootData = await bootRes.json();

      if (!meData.configured || !bootData.configured) {
        setState('unconfigured');
        return;
      }

      if (bootData.schemaReady === false) {
        setProjectRef(bootData.projectRef || null);
        setSqlScript(bootData.sqlScript || '');
        setState('needs_schema');
        return;
      }

      if (!bootData.hasAdmin) {
        setRequiresSecret(Boolean(bootData.requiresSecret));
        setState('needs_bootstrap');
        return;
      }

      if (!meData.user) {
        router.push('/giris');
        return;
      }

      if (!meData.user.isSystemAdmin) {
        setState('unauthorized');
        return;
      }

      setAdminName(meData.user.adminName || 'Sistem Yöneticisi');
      setAdminEmail(meData.user.email || '');
      setState('ready');
    } catch {
      setState('unauthorized');
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void verifyAdmin();
    });
    return () => {
      active = false;
    };
  }, [verifyAdmin]);

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setBootSaving(true);
    try {
      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bootForm),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Yönetici oluşturulamadı', 'error');
        return;
      }

      const supabase = createBrowserSupabase();
      if (supabase) {
        await supabase.auth.signInWithPassword({
          email: bootForm.email.trim().toLowerCase(),
          password: bootForm.password,
        });
      }
      showToast('Sistem yöneticisi oluşturuldu', 'success');
      await verifyAdmin();
    } finally {
      setBootSaving(false);
    }
  }

  async function handleLogout() {
    const supabase = createBrowserSupabase();
    if (supabase) await supabase.auth.signOut();
    router.push('/giris');
  }

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3">
          <div className="h-8 w-48 rounded bg-slate-200 animate-pulse mx-auto" />
          <div className="h-32 rounded-xl bg-slate-200 animate-pulse" />
        </div>
      </div>
    );
  }

  if (state === 'unconfigured') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <SetupNotice context="Sistem Yöneticisi Paneli" />
      </div>
    );
  }

  if (state === 'needs_schema') {
    const sqlEditorUrl = projectRef
      ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
      : 'https://supabase.com/dashboard';

    async function handleCopySql() {
      if (!sqlScript) return;
      try {
        await navigator.clipboard.writeText(sqlScript);
        setSqlCopied(true);
        showToast('Kurulum SQL kodu kopyalandı', 'success', 'Supabase SQL Editor içine yapıştırıp Run butonuna basınız.');
        setTimeout(() => setSqlCopied(false), 3000);
      } catch {
        showToast('Kopyalama için aşağıdaki kutudan seçip Ctrl+C yapabilirsiniz.', 'info');
      }
    }

    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#0F2942]">
            <Database className="h-4 w-4 text-emerald-700" />
            <span>Supabase Bağlantısı Aktif — Son Adım: Tablo Kurulumu</span>
          </div>
          <h1 className="mt-2 text-xl font-bold text-slate-900">
            Veritabanı Tablolarını Tek Seferde Oluşturun
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Supabase anahtarlarınız bağlandı ancak veritabanında henüz EsnafTakip tabloları
            bulunmuyor. Aşağıdaki 3 adımı uyguladıktan sonra yönetici hesabınızı oluşturabilirsiniz:
          </p>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={handleCopySql}
              disabled={!sqlScript}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E] disabled:opacity-60"
            >
              {sqlCopied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
              <span>{sqlCopied ? 'Kopyalandı!' : '1. SQL Kodunu Kopyala'}</span>
            </button>

            <a
              href={sqlEditorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" />
              <span>2. SQL Editor&apos;ü Aç &amp; Run Yap</span>
            </a>

            <button
              type="button"
              onClick={() => verifyAdmin()}
              className="flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              <RefreshCw className="h-4 w-4" />
              <span>3. Kurulumu Kontrol Et</span>
            </button>
          </div>

          {sqlScript && (
            <div className="mt-5">
              <label className="block text-[11px] font-medium text-slate-500">
                Tek Seferlik Kurulum SQL İçeriği (`supabase/TEK_SEFERLIK_KURULUM.sql`)
              </label>
              <textarea
                readOnly
                rows={8}
                value={sqlScript}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (state === 'needs_bootstrap') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
          <p className="text-xs font-semibold text-emerald-700">İlk Kurulum (Tek Seferlik)</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">
            Sistem Yöneticisi Hesabı Oluştur
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Sistemde henüz tanımlı bir yönetici bulunmadığı için ilk sistem yöneticisi hesabını
            buradan güvenli şekilde oluşturabilirsiniz. İlk yönetici kaydedildikten sonra bu ekran
            otomatik olarak kilitlenir.
          </p>

          <form onSubmit={handleBootstrap} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Ad Soyad *</label>
              <input
                type="text"
                required
                value={bootForm.fullName}
                onChange={(e) => setBootForm({ ...bootForm, fullName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Yönetici E-posta *</label>
              <input
                type="email"
                required
                value={bootForm.email}
                onChange={(e) => setBootForm({ ...bootForm, email: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Yönetici Şifresi (En az 10 karakter) *
              </label>
              <input
                type="password"
                required
                minLength={10}
                value={bootForm.password}
                onChange={(e) => setBootForm({ ...bootForm, password: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            {requiresSecret && (
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Kurulum Güvenlik Anahtarı (ADMIN_BOOTSTRAP_SECRET) *
                </label>
                <input
                  type="password"
                  required
                  value={bootForm.bootstrapSecret}
                  onChange={(e) => setBootForm({ ...bootForm, bootstrapSecret: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            )}
            <button
              type="submit"
              disabled={bootSaving}
              className="w-full rounded-lg bg-[#064E3B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#065F46] disabled:opacity-60"
            >
              {bootSaving ? 'Oluşturuluyor...' : 'İlk Sistem Yöneticisini Oluştur'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (state === 'unauthorized') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-10 w-10 text-red-600" />
          <h1 className="mt-4 text-lg font-bold text-slate-900">Erişim Yetkiniz Yok</h1>
          <p className="mt-2 text-sm text-slate-600">
            Bu alan yalnızca sistem sahibine özeldir. İşletme kullanıcıları yönetici paneline
            erişemez.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/panel"
              className="rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white"
            >
              İşletme Paneline Dön
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
            >
              Çıkış Yap
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sidebar = (
    <div className="flex h-full flex-col justify-between bg-[#0B192C] text-slate-100">
      <div>
        <div className="border-b border-slate-700/60 px-5 py-5">
          <Link href="/admin" className="text-lg font-bold tracking-tight text-white font-display">
            EsnafTakip
          </Link>
          <p className="mt-1 text-xs font-medium text-emerald-400">Sistem Yöneticisi Paneli</p>
        </div>

        <nav className="mt-4 space-y-1 px-3">
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-700/30 text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-slate-700/60 p-4 text-xs">
        <p className="font-semibold text-white truncate">{adminName}</p>
        <p className="text-slate-400 truncate">{adminEmail}</p>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Güvenli Çıkış</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      <aside className="hidden lg:block lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 w-64 max-w-[80vw] h-full">{sidebar}</div>
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-lg border border-slate-200 p-2 text-slate-700 lg:hidden"
                aria-label="Menüyü aç"
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
              <span className="text-sm font-semibold text-slate-900">
                EsnafTakip Sistem Yönetimi
              </span>
            </div>
            <Link href="/" className="text-xs font-medium text-slate-600 hover:text-[#0F2942]">
              Tanıtım Sitesini Gör
            </Link>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
