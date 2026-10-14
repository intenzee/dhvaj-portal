import { PERMISSION, ROLE, type PermissionSlug, type RoleSlug } from '@hsdg/contracts';
import {
  Home,
  Briefcase,
  Building2,
  Layers,
  MessageSquareWarning,
  ListTodo,
  ClipboardCheck,
  CalendarClock,
  FileText,
  FolderOpen,
  BarChart3,
  Users,
  Wallet,
  Settings,
  Bell,
  type LucideIcon,
} from 'lucide-react';
import type { Principal } from './principal';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** One plain-language line on what the screen is for — shown as a tooltip and in the Help panel. */
  hint: string;
  /** Permission required to see the item (undefined ⇒ always visible). */
  permission?: PermissionSlug;
  /** Screens not yet built in this foundation render a "coming soon" placeholder. */
  ready: boolean;
  /**
   * With ff_work_links: hidden when every role the user holds is one of these.
   * Only the sidebar entry goes — the permission (and the page) stay, since
   * other screens rely on it (Staff Workflow WF-107, design rule 6).
   */
  hideFor?: RoleSlug[];
  /** With ff_work_links: folded into this My Work tab; the old route redirects (WF-106). */
  foldedInto?: string;
  /** With ff_work_links: a count pill read from `path` (`{ total }`), e.g. reviews waiting (WF-105). */
  badge?: { queryKey: readonly string[]; path: string };
}

/** Preparers: their sidebar is trimmed to the client work (WF-107). */
export const PREPARER_ROLES: RoleSlug[] = [ROLE.article, ROLE.senior];

export interface NavOptions {
  /** ff_work_links: fold duplicate lists into My Work and trim the sidebar by role. */
  workLinks?: boolean;
}

export interface NavSection {
  /** Section heading (omitted for the top, un-headed group). */
  title?: string;
  items: NavItem[];
}

/**
 * Primary navigation (§22), grouped so a first-time user sees three short lists
 * — their day, the client work, and the practice back-office — instead of one
 * long one. Gated by permission and build status.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Home', href: '/', icon: Home, hint: 'Your dashboard — what needs attention today.', ready: true },
      {
        label: 'My Work',
        href: '/my-work',
        icon: Briefcase,
        hint: 'Your tasks, client follow-ups and items waiting for your review, in one place.',
        permission: PERMISSION.engagementRead,
        ready: true,
        badge: { queryKey: ['work', 'reviews', 'count'], path: '/work/reviews/count' },
      },
      {
        label: 'Notifications',
        href: '/notifications',
        icon: Bell,
        hint: 'Updates on the engagements you work on.',
        permission: PERMISSION.notificationRead,
        ready: true,
      },
    ],
  },
  {
    title: 'Client work',
    items: [
      {
        label: 'Engagements',
        href: '/engagements',
        icon: Layers,
        hint: 'Every job the firm does for a client (an audit, a return, a filing). Open one to work on it.',
        permission: PERMISSION.engagementRead,
        ready: true,
      },
      {
        label: 'Clients',
        href: '/entities',
        icon: Building2,
        hint: 'Client companies, firms and individuals, with everything we do for each.',
        permission: PERMISSION.entityRead,
        ready: true,
      },
      {
        label: 'Tasks',
        href: '/tasks',
        icon: ListTodo,
        hint: 'Tasks assigned to you across all engagements.',
        permission: PERMISSION.engagementRead,
        foldedInto: '/my-work?tab=tasks',
        ready: true,
      },
      {
        label: 'Client Dependencies',
        href: '/client-dependencies',
        icon: MessageSquareWarning,
        hint: 'Information or documents we are still waiting to receive from clients.',
        permission: PERMISSION.engagementRead,
        foldedInto: '/my-work?tab=client-dependencies',
        ready: true,
      },
      {
        label: 'Reviews & Sign-offs',
        href: '/reviews',
        icon: ClipboardCheck,
        hint: 'Engagements waiting for a reviewer or a partner sign-off.',
        permission: PERMISSION.engagementRead,
        foldedInto: '/my-work?tab=to-review',
        ready: true,
      },
      {
        label: 'Compliance',
        href: '/compliance',
        icon: CalendarClock,
        hint: 'Due dates for returns and filings — what is overdue and what is due soon.',
        permission: PERMISSION.complianceRead,
        ready: true,
      },
      {
        label: 'Documents',
        href: '/documents',
        icon: FolderOpen,
        hint: 'Working papers and client documents across your engagements.',
        permission: PERMISSION.engagementRead,
        ready: true,
      },
    ],
  },
  {
    title: 'Practice',
    items: [
      {
        label: 'Services',
        href: '/services',
        icon: FileText,
        hint: 'The catalogue of services the firm offers, and their templates.',
        permission: PERMISSION.serviceRead,
        hideFor: PREPARER_ROLES,
        ready: true,
      },
      {
        label: 'Reports & MIS',
        href: '/reports',
        icon: BarChart3,
        hint: 'Management reports across the practice.',
        permission: PERMISSION.reportRead,
        hideFor: PREPARER_ROLES,
        ready: true,
      },
      {
        label: 'Resource Management',
        href: '/resources',
        icon: Users,
        hint: 'Who is working on what, and who has capacity.',
        permission: PERMISSION.employeeRead,
        hideFor: PREPARER_ROLES,
        ready: true,
      },
      {
        label: 'Billing & Collections',
        href: '/billing',
        icon: Wallet,
        hint: 'Invoices, payments received and amounts outstanding.',
        permission: PERMISSION.reportRead,
        hideFor: PREPARER_ROLES,
        ready: true,
      },
      {
        label: 'Administration',
        href: '/admin',
        icon: Settings,
        hint: 'Users, roles, offices and firm templates.',
        permission: PERMISSION.userManage,
        hideFor: PREPARER_ROLES,
        ready: true,
      },
    ],
  },
];

/** Every nav item, flattened in display order. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Does the principal act only in these roles (its effective role, else every held role)? */
function onlyIn(principal: Principal | null, roles: RoleSlug[]): boolean {
  if (!principal) return false;
  const held = principal.effectiveRole ? [principal.effectiveRole] : principal.roles;
  return held.length > 0 && held.every((r) => roles.includes(r));
}

function canSee(item: NavItem, principal: Principal | null, opts: NavOptions): boolean {
  if (item.permission && !(principal?.permissions ?? []).includes(item.permission)) return false;
  if (!opts.workLinks) return true;
  if (item.foldedInto) return false;
  return !(item.hideFor && onlyIn(principal, item.hideFor));
}

/** The nav items a principal may see. */
export function visibleNav(principal: Principal | null, opts: NavOptions = {}): NavItem[] {
  return NAV_ITEMS.filter((item) => canSee(item, principal, opts));
}

/** The nav sections a principal may see, with empty sections dropped. */
export function visibleNavSections(
  principal: Principal | null,
  opts: NavOptions = {},
): NavSection[] {
  return NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => canSee(i, principal, opts)),
  })).filter((s) => s.items.length > 0);
}

/** Is this nav item the current page? Exact match or a sub-path, never a prefix-substring. */
export function isNavActive(item: NavItem, pathname: string): boolean {
  const base = item.href.split('?')[0]!;
  if (base === '/') return pathname === '/';
  return pathname === base || pathname.startsWith(base + '/');
}
