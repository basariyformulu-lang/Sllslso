'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Truck,
  CalendarClock,
  TrendingUp,
  TrendingDown,
  Repeat,
  FileBarChart2,
  UserCog,
  Settings,
  Bell,
  LogOut,
  Menu,
  X,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  Scissors,
  UserCheck,
  Clock,
  MessageSquare,
  Palette,
  SlidersHorizontal,
} from 'lucide-react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { hasPermission } from '@/lib/permissions';
import { formatDateTR } from '@/lib/format';
import type { Business, BusinessMember } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/panel', label: 'Genel Bakış', icon: LayoutDashboard, permission: 'reports.view' },
  { href: '/panel/musteriler', label: 'Müşteriler', icon: Users, permission: 'customers.view' },
  { href: '/panel/toptancilar', label: 'Toptancılar', icon: Truck, permission: 'suppliers.view' },
  { href: '/panel/vadeli-satislar', label: 'Vadeli Satışlar', icon: CalendarClock, permission: 'credit_sales.view' },
  { href: '/panel/gelirler', label: 'Gelirler', icon: TrendingUp, permission: 'finance.view' },
  { href: '/panel/giderler', label: 'Giderler', icon: TrendingDown, permission: 'finance.view' },
  { href: '/panel/sabit-giderler', label: 'Sabit Giderler', icon: Repeat, permission: 'recurring.view' },
  { href: '/panel/raporlar', label: 'Raporlar', icon: FileBarChart2, permission: 'reports.view' },
  { href: '/panel/kullanicilar', label: 'Kullanıcı Yönetimi', icon: UserCog, permission: 'users.manage' },
  { href: '/panel/ayarlar', label: 'Profil ve Ayarlar', icon: Settings },
];

const BOOKING_NAV_ITEMS: NavItem[] = [
  { href: '/panel/randevu', label: 'Randevu Genel Bakış', icon: CalendarCheck, permission: 'booking.view' },
  { href: '/panel/randevu/takvim', label: 'Randevu Takvimi', icon: CalendarDays, permission: 'booking.view' },
  { href: '/panel/randevu/hizmetler', label: 'Hizmetler ve Fiyatlar', icon: Scissors, permission: 'booking.view' },
  { href: '/panel/randevu/personel', label: 'Personel Yönetimi', icon: UserCheck, permission: 'booking.view' },
  { href: '/panel/randevu/calisma-saatleri', label: 'Çalışma Saatleri', icon: Clock, permission: 'booking.view' },
  { href: '/panel/randevu/musteriler', label: 'Müşteri Yönetimi', icon: Users, permission: 'booking.view' },
  { href: '/panel/randevu/yorumlar', label: 'Müşteri Yorumları', icon: MessageSquare, permission: 'booking.view' },
  { href: '/panel/randevu/tasarim', label: 'Randevu Sayfası Tasarımı', icon: Palette, permission: 'booking.view' },
  { href: '/panel/randevu/ayarlar', label: 'Randevu Sayfası Ayarları', icon: SlidersHorizontal, permission: 'booking.view' },
];

export interface PanelUserContext {
  id: string;
  email: string;
  member: BusinessMember;
  business: Business;
}

export function PanelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userCtx, setUserCtx] = useState<PanelUserContext | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bookingExpanded, setBookingExpanded] = useState<boolean>(() =>
    pathname.startsWith('/panel/randevu')
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<
    Array<{ id: string; title: string; message: string; link: string; is_read: boolean; created_at: string }>
  >([]);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = await res.json();
      if (!data.configured) {
        router.push('/giris');
        return;
      }
      if (!data.user) {
        router.push('/giris');
        return;
      }
      if (!data.user.member || !data.user.business) {
        if (data.user.isSystemAdmin) {
          router.push('/admin');
        } else {
          router.push('/giris');
        }
        return;
      }
      if (!data.user.isSubscriptionActive) {
        router.push('/odeme');
        return;
      }
      setUserCtx({
        id: data.user.id,
        email: data.user.email,
        member: data.user.member,
        business: data.user.business,
      });
      setUnreadCount(data.user.unreadNotifications ?? 0);
    } catch {
      router.push('/giris');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void checkSession();
    });
    return () => {
      active = false;
    };
  }, [checkSession]);

  async function toggleNotifications() {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) {
      const res = await fetch('/api/panel/settings');
      const data = await res.json();
      if (data.notifications) setNotifications(data.notifications);
    }
  }

  async function markAllRead() {
    await fetch('/api/panel/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markNotificationsRead: true }),
    });
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  async function handleLogout() {
    const supabase = createBrowserSupabase();
    if (supabase) await supabase.auth.signOut();
    router.push('/giris');
  }

  if (loading || !userCtx) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3">
          <div className="h-8 w-48 rounded-lg bg-slate-200 animate-pulse mx-auto" />
          <div className="h-32 rounded-xl bg-slate-200 animate-pulse" />
        </div>
      </div>
    );
  }

  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(userCtx.member, item.permission)
  );
  const visibleBookingNav = BOOKING_NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(userCtx.member, item.permission)
  );
  const isBookingRoute = pathname.startsWith('/panel/randevu');
  const showBookingList = bookingExpanded || isBookingRoute;

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-[#0F2942] text-slate-100">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-slate-700/60 px-5 py-5">
          <Link href="/panel" className="text-lg font-bold tracking-tight text-white font-display">
            EsnafTakip
          </Link>
          <p className="mt-1 truncate text-xs text-slate-300">{userCtx.business.name}</p>
        </div>

        <nav className="mt-3 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {visibleNav.slice(0, 8).map((item) => {
            const Icon = item.icon;
            const active =
              item.href === '/panel'
                ? pathname === '/panel'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {visibleBookingNav.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setBookingExpanded((prev) => !prev)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  isBookingRoute
                    ? 'bg-emerald-700/35 text-white'
                    : 'text-emerald-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3 whitespace-nowrap">
                  <CalendarCheck className="h-4 w-4 shrink-0 text-emerald-300" />
                  <span>Online Randevu</span>
                </span>
                {showBookingList ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-300" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                )}
              </button>

              {showBookingList && (
                <div className="mt-1 ml-3 space-y-0.5 border-l border-slate-700/70 pl-2.5">
                  {visibleBookingNav.map((item) => {
                    const Icon = item.icon;
                    const active =
                      item.href === '/panel/randevu'
                        ? pathname === '/panel/randevu'
                        : pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-white/15 text-white'
                            : 'text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="pt-2">
            {visibleNav.slice(8).map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white/15 text-white'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      <div className="shrink-0 border-t border-slate-700/60 p-4 text-xs">
        <div className="mb-3">
          <p className="font-semibold text-white truncate">
            {userCtx.member.profile?.first_name} {userCtx.member.profile?.last_name}
          </p>
          <p className="text-slate-300 truncate">{userCtx.member.role_name}</p>
          {userCtx.business.subscription_end_at && (
            <p className="mt-1 text-[11px] text-slate-400">
              Abonelik Bitiş: {formatDateTR(userCtx.business.subscription_end_at)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Çıkış Yap</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Masaüstü Sol Kenar Çubuğu */}
      <aside className="hidden lg:block lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen">
        {sidebarContent}
      </aside>

      {/* Mobil Çekmece Menü */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 w-64 max-w-[80vw] h-full">{sidebarContent}</div>
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 lg:hidden"
                aria-label="Menüyü aç"
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {userCtx.business.name}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  Kod: {userCtx.business.business_code}
                </p>
              </div>
            </div>

            <div className="relative flex items-center gap-3">
              <button
                type="button"
                onClick={toggleNotifications}
                className="relative rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
                aria-label="Bildirimler"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-12 z-40 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="text-xs font-semibold text-slate-900">Bildirimler</span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="text-[11px] font-medium text-[#0F2942] hover:underline"
                      >
                        Tümünü Okundu İşaretle
                      </button>
                    )}
                  </div>
                  <div className="mt-2 max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <p className="py-4 text-center text-xs text-slate-500">
                        Henüz bildirim bulunmuyor.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} className="py-2.5">
                          <p className="text-xs font-semibold text-slate-900">{n.title}</p>
                          <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                            {n.message}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
