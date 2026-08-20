'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bell, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { visibleNav } from '@/lib/nav';
import { roleLabel } from '@/lib/principal';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Spinner } from './ui';

/** The single portal shell — permission-driven nav, one app for every role (§22). */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { principal, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !principal) router.replace('/login');
  }, [loading, principal, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading HSDG Portal…" />
      </div>
    );
  }
  if (!principal) return <div className="min-h-screen" />;

  const nav = visibleNav(principal);

  return (
    <div className="flex min-h-screen bg-slate-50 text-ink">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="text-lg font-bold tracking-tight text-brand-700">HSDG</div>
          <div className="text-xs text-ink-faint">Practice Portal</div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {nav.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href.split('?')[0]!);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  'mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition',
                  active ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-slate-100',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
                {!item.ready && (
                  <span className="ml-auto text-[10px] uppercase text-ink-faint">soon</span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="text-sm text-ink-muted md:hidden">
            <span className="font-bold text-brand-700">HSDG</span> Portal
          </div>
          <div className="ml-auto flex items-center gap-4">
            <NotificationBell />
            <div className="text-right">
              <div className="text-sm font-medium text-ink">{principal.displayName}</div>
              <div className="text-xs text-ink-faint">
                {roleLabel(principal.effectiveRole)} · {principal.officeCode}
              </div>
            </div>
            <button
              onClick={logout}
              className="rounded-md p-2 text-ink-muted hover:bg-slate-100"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}

function NotificationBell(): JSX.Element {
  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiFetch<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });
  const unread = data?.unread ?? 0;
  return (
    <div className="relative" title={`${unread} unread notifications`}>
      <Bell className="h-5 w-5 text-ink-muted" aria-label="Notifications" />
      {unread > 0 && (
        <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </div>
  );
}
