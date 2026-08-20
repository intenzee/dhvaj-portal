import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/lib/providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'HSDG Portal',
  description: 'HSDG practice-management and professional-work operating system.',
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-slate-100 text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
