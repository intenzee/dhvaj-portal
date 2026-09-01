'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { visibleNav } from '@/lib/nav';
import { roleLabel, initials } from '@/lib/principal';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Spinner } from './ui';
import { GlobalSearch } from './global-search';
import { ThemeToggle } from './theme-toggle';
import { RunningTimerBanner } from './time/running-timer-banner';

const SHORTCUTS = [
  { label: 'Create Engagement', href: '/engagements/new', icon: PlusCircle },
  { label: 'My Engagements', href: '/engagements?mine=true', icon: Layers },
  { label: 'My Tasks', href: '/tasks', icon: ListTodo },
  { label: 'Review Queue', href: '/reviews', icon: ClipboardCheck },
  { label: 'Compliance Calendar', href: '/compliance', icon: CalendarClock },
  { label: 'Upload Document', href: '/documents', icon: Upload },
];

const SIDEBAR_KEY = 'dhvaj-sidebar-collapsed';

/** Persisted collapse state for the sidebar, with a keyboard shortcut (⌘/Ctrl+B). */
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);

  // Restore the saved preference after mount (avoids an SSR hydration mismatch).
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === '1');
    } catch {
      /* storage unavailable — keep the expanded default */
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return [collapsed, toggle];
}

/** The single portal shell — permission-driven nav, one app for every role (§22). */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { principal, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, toggleSidebar] = useSidebarCollapsed();

  useEffect(() => {
    if (!loading && !principal) router.replace('/login');
  }, [loading, principal, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading Dhvaj Portal…" />
      </div>
    );
  }
  if (!principal) return <div className="min-h-screen" />;

  const nav = visibleNav(principal);

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-20 w-64 flex-col bg-sidebar',
          collapsed ? 'hidden' : 'hidden md:flex',
        )}
      >
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-sm font-black text-white">
            H
          </div>
          <div className="text-lg font-bold tracking-tight text-white">
            Dhvaj <span className="font-medium text-sidebar-muted">Portal</span>
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
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[margin] duration-200',
          collapsed ? 'md:ml-0' : 'md:ml-64',
        )}
      >
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-line-strong bg-surface px-5 py-2.5">
          <button
            onClick={toggleSidebar}
            className="rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
            title={`${collapsed ? 'Show' : 'Hide'} sidebar (⌘/Ctrl+B)`}
            aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-pressed={collapsed}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
          <GlobalSearch />

          <div className="ml-auto flex items-center gap-1.5">
            <RunningTimerBanner />
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
