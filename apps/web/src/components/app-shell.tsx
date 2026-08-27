'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  MessageSquare,
  HelpCircle,
  LogOut,
  PlusCircle,
  Layers,
  ListTodo,
  ClipboardCheck,
  CalendarClock,
  Upload,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { visibleNav } from '@/lib/nav';
import { roleLabel, initials } from '@/lib/principal';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Spinner } from './ui';
import { GlobalSearch } from './global-search';
import { ThemeToggle } from './theme-toggle';

const SHORTCUTS = [
  { label: 'Create Engagement', href: '/engagements/new', icon: PlusCircle },
  { label: 'My Engagements', href: '/engagements?mine=true', icon: Layers },
  { label: 'My Tasks', href: '/tasks', icon: ListTodo },
  { label: 'Review Queue', href: '/reviews', icon: ClipboardCheck },
  { label: 'Compliance Calendar', href: '/compliance', icon: CalendarClock },
  { label: 'Upload Document', href: '/documents', icon: Upload },
];

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
    <div className="flex min-h-screen bg-canvas text-ink">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-sidebar md:flex">
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-sm font-black text-white">
            H
          </div>
          <div className="text-lg font-bold tracking-tight text-white">
            HSDG <span className="font-medium text-sidebar-muted">Portal</span>
          </div>
        </div>

        <nav className="scroll-slim flex-1 overflow-y-auto px-3 py-2">
          {nav.map((item) => {
            const base = item.href.split('?')[0]!;
            // Exact match or a sub-path — never a prefix-substring, so each item
            // highlights on its own route only.
            const active = pathname === base || pathname.startsWith(base + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  'mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  active
                    ? 'bg-sidebar-active text-white shadow-sm'
                    : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-white',
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
                {!item.ready && (
                  <span className="ml-auto rounded bg-white/5 px-1 text-[9px] uppercase tracking-wide text-sidebar-muted">
                    soon
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border px-3 py-3">
          <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
            Shortcuts
          </div>
          {SHORTCUTS.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.label}
                href={s.href}
                className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13px] text-sidebar-muted transition hover:bg-sidebar-hover hover:text-white"
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{s.label}</span>
              </Link>
            );
          })}
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col md:ml-64">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-line-strong bg-surface px-5 py-2.5">
          <GlobalSearch />

          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <NotificationBell />
            <IconButton title="Messages">
              <MessageSquare className="h-5 w-5" />
            </IconButton>
            <IconButton title="Help">
              <HelpCircle className="h-5 w-5" />
            </IconButton>
            <div className="mx-1 h-8 w-px bg-line-strong" />
            <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-600 text-xs font-semibold text-white">
                {initials(principal.displayName)}
              </div>
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-sm font-semibold text-ink">{principal.displayName}</div>
                <div className="text-xs text-ink-faint">
                  {roleLabel(principal.effectiveRole)} · {principal.officeCode}
                </div>
              </div>
              <button
                onClick={logout}
                className="rounded-lg p-2 text-ink-faint hover:bg-surface-sunken hover:text-ink"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-5 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function IconButton({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      className="relative rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
    >
      {children}
    </button>
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
    <Link
      href="/notifications"
      title={`${unread} unread notifications`}
      aria-label="Notifications"
      className="relative rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
    >
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
