'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  HelpCircle,
  LogOut,
  Plus,
  Layers,
  Building2,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import { PERMISSION, type PermissionSlug } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { isNavActive, visibleNavSections } from '@/lib/nav';
import { roleLabel, initials, can, type Principal } from '@/lib/principal';
import { useTrackOnboardingVisit } from '@/lib/onboarding';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Spinner } from './ui';
import { GlobalSearch } from './global-search';
import { ThemeToggle } from './theme-toggle';
import { RunningTimerBanner } from './time/running-timer-banner';
import { HelpPanel } from './help/help-panel';

/** "New …" quick-create actions, shown only to users who may create that thing. */
const CREATE_ACTIONS: {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: PermissionSlug;
}[] = [
  {
    label: 'New engagement',
    href: '/engagements/new',
    icon: Layers,
    permission: PERMISSION.engagementManage,
  },
  {
    label: 'New client',
    href: '/entities/new',
    icon: Building2,
    permission: PERMISSION.entityManage,
  },
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  useTrackOnboardingVisit(principal, pathname);

  useEffect(() => {
    if (!loading && !principal) router.replace('/login');
  }, [loading, principal, router]);

  // Close the phone menu whenever the route changes.
  useEffect(() => setMobileOpen(false), [pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading Dhvaj Portal…" />
      </div>
    );
  }
  if (!principal) return <div className="min-h-screen" />;

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      {/* Sidebar — desktop */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-20 hidden flex-col bg-sidebar transition-[width] duration-200 md:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <SidebarContent principal={principal} pathname={pathname} collapsed={collapsed} />
      </aside>

      {/* Sidebar — phone drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="flex h-full w-72 max-w-[85vw] flex-col bg-sidebar shadow-pop"
            onClick={(e) => e.stopPropagation()}
            aria-label="Main menu"
          >
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute left-[min(18rem,85vw)] top-3 ml-2 rounded-lg bg-sidebar p-2 text-white"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent principal={principal} pathname={pathname} collapsed={false} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[margin] duration-200',
          collapsed ? 'md:ml-16' : 'md:ml-64',
        )}
      >
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line-strong bg-surface px-3 py-2.5 sm:gap-4 sm:px-5">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            onClick={toggleSidebar}
            className="hidden rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink md:block"
            title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (⌘/Ctrl+B)`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
          <GlobalSearch />

          <div className="ml-auto flex items-center gap-1.5">
            <RunningTimerBanner />
            <ThemeToggle />
            <NotificationBell />
            <button
              onClick={() => setHelpOpen(true)}
              title="Help & quick guide"
              aria-label="Help"
              className="relative rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
            >
              <HelpCircle className="h-5 w-5" />
            </button>
            <div className="mx-1 hidden h-8 w-px bg-line-strong sm:block" />
            <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
              <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-primary-600 text-xs font-semibold text-white sm:flex">
                {initials(principal.displayName)}
              </div>
              <div className="hidden text-right leading-tight lg:block">
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

        <main className="min-w-0 flex-1 p-4 sm:p-5 lg:p-6">{children}</main>
      </div>

      <HelpPanel open={helpOpen} onClose={closeHelp} />
    </div>
  );
}

/** Brand, quick-create and the grouped nav — shared by the desktop sidebar and the phone drawer. */
function SidebarContent({
  principal,
  pathname,
  collapsed,
}: {
  principal: Principal;
  pathname: string;
  collapsed: boolean;
}): JSX.Element {
  const sections = visibleNavSections(principal);
  return (
    <>
      <Link
        href="/"
        className={cn('flex items-center gap-2 py-4', collapsed ? 'justify-center px-0' : 'px-5')}
        title="Home"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-sm font-black text-white">
          H
        </div>
        {!collapsed && (
          <div className="text-lg font-bold tracking-tight text-white">
            Dhvaj <span className="font-medium text-sidebar-muted">Portal</span>
          </div>
        )}
      </Link>

      <QuickCreate principal={principal} collapsed={collapsed} />

      <nav className="scroll-slim flex-1 overflow-y-auto px-3 pb-4 pt-1" aria-label="Main">
        {sections.map((section, i) => (
          <div key={section.title ?? i} className={cn(i > 0 && 'mt-4')}>
            {section.title &&
              (collapsed ? (
                <div className="mx-3 mb-2 border-t border-sidebar-border" aria-hidden />
              ) : (
                <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
                  {section.title}
                </div>
              ))}
            {section.items.map((item) => {
              const active = isNavActive(item, pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? `${item.label} — ${item.hint}` : item.hint}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'mb-0.5 flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    active
                      ? 'bg-sidebar-active text-white shadow-sm'
                      : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-white',
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && !item.ready && (
                    <span className="ml-auto rounded bg-white/5 px-1 text-[9px] uppercase tracking-wide text-sidebar-muted">
                      soon
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </>
  );
}

/** The one "New" button — lists only what this user may create; hidden if nothing. */
function QuickCreate({
  principal,
  collapsed,
}: {
  principal: Principal;
  collapsed: boolean;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const actions = CREATE_ACTIONS.filter((a) => can(principal, a.permission));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className={cn('relative pb-3', collapsed ? 'px-2' : 'px-3')}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Create something new"
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white transition hover:bg-primary-700',
        )}
      >
        <Plus className="h-4 w-4 shrink-0" aria-hidden />
        {!collapsed && 'New'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className={cn(
              'absolute z-40 mt-1 w-52 rounded-lg border border-line-strong bg-surface p-1 shadow-pop',
              collapsed ? 'left-full top-0 ml-2' : 'left-3 right-3 w-auto',
            )}
          >
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <Link
                  key={a.href}
                  href={a.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink hover:bg-surface-sunken"
                >
                  <Icon className="h-4 w-4 text-ink-muted" aria-hidden />
                  {a.label}
                </Link>
              );
            })}
          </div>
        </>
      )}
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
