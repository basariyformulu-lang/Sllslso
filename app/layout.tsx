import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/ToastProvider';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600', '700'],
  variable: '--font-jakarta',
});

const dmSans = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains',
});

export const metadata: Metadata = {
  title: 'EsnafTakip — Küçük İşletmeler İçin Cari Hesap ve Finans Yönetim Sistemi',
  description:
    'Küçük işletmeler, bakkallar, büfeler ve toptancılar için müşteri alacakları, toptancı borçları, vadeli satışlar ve aylık sabit gider yönetim sistemi.',
  openGraph: {
    title: 'EsnafTakip — Küçük İşletmeler İçin Cari Hesap ve Finans Yönetim Sistemi',
    description:
      'İşletmenizin tüm borç ve alacakları tek yerde. Müşteri alacakları, toptancı borçları, vadeli satış ve sabit gider takibi.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'EsnafTakip — Cari Hesap ve Finans Yönetim Sistemi',
    description:
      'Küçük işletmeler için modern, mobil uyumlu borç, alacak, vadeli satış ve sabit gider yönetim platformu.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="tr"
      className={`${jakarta.variable} ${dmSans.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-screen bg-[#F8FAFC] text-slate-900" suppressHydrationWarning>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
