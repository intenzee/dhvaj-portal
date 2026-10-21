import { PERMISSION, ROLE, type PermissionSlug, type RoleSlug } from '@hsdg/contracts';
import {
  Home,
  Sun,
  Briefcase,
  Building2,
  Layers,
  MessageSquareWarning,
  ListTodo,
  ListChecks,
  ClipboardCheck,
  CalendarClock,
  FileText,
  FolderOpen,
  Gavel,
  BarChart3,
  Users,
  Wallet,
  Settings,
  Bell,
  Calculator,
  Receipt,
  BadgeCheck,
  Landmark,
  Contact,
  UserPlus,
  GraduationCap,
  CalendarCheck,
  Gauge,
  Banknote,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';
import type { Principal } from './principal';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** One plain-language line on what the screen is for — shown as a tooltip and in the Help panel. */
  hint: string;
  /** Permission required to see the item — any one of a list (undefined ⇒ always visible). */
  permission?: PermissionSlug | PermissionSlug[];
  /** Screens not yet built in this foundation render a "coming soon" placeholder. */
  ready: boolean;
  /**
   * With ff_work_links: hidden when every role the user holds is one of these.
   * Only the sidebar entry goes — the permission (and the page) stay, since
   * other screens rely on it (Staff Workflow WF-107, design rule 6).
   */
  hideFor?: RoleSlug[];
  /** The practice dashboard: hidden from desk-only users (Accountant, HR), who land on their desk. */
  practice?: boolean;
  /** With ff_work_links: folded into this My Work tab; the old route redirects (WF-106). */
  foldedInto?: string;
  /** With ff_work_links: a count pill read from `path` (`{ total }`), e.g. reviews waiting (WF-105). */
  badge?: { queryKey: readonly string[]; path: string };
  /** Shown only while this rollout flag is on (e.g. Today behind ff_today_view). */
  flag?: 'todayView' | 'filingRuns' | 'notices';
}

/** Preparers: their sidebar is trimmed to the client work (WF-107). */
export const PREPARER_ROLES: RoleSlug[] = [ROLE.article, ROLE.senior];

/** Desk roles: no client work; they land on their own desk (accountant-hr-roles spec). */
export const DESK_ROLES: RoleSlug[] = [ROLE.accountant, ROLE.hr];

export interface NavOptions {
  /** ff_work_links: fold duplicate lists into My Work and trim the sidebar by role. */
  workLinks?: boolean;
  /** ff_today_view: the Today screen, and the preparers' landing page (WF-201). */
  todayView?: boolean;
  /** ff_filing_runs: one form and period across every client (WF-301). */
  filingRuns?: boolean;
  /** ff_notices: the notice register (Practice Services PS-102). */
  notices?: boolean;
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
      {
        label: 'Today',
        href: '/today',
        icon: Sun,
        hint: 'Your day in one list — what to prepare, review and chase, overdue first.',
        permission: PERMISSION.engagementRead,
        flag: 'todayView',
        ready: true,
      },
      {
        label: 'Home',
        href: '/',
        icon: Home,
        hint: 'Your dashboard — what needs attention today.',
        practice: true,
        ready: true,
      },
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
      {
        label: 'My pay',
        href: '/me/pay',
        icon: Wallet,
        hint: 'Your payslips, your pay, and your bank account for salary.',
        permission: PERMISSION.payrollReadOwn,
        ready: true,
      },
      {
        label: 'My income tax',
        href: '/me/tax',
        icon: Receipt,
        hint: 'Choose your tax regime, declare investments, upload proofs and get Form 130.',
        permission: PERMISSION.payrollReadOwn,
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
        label: 'Filing runs',
        href: '/compliance/runs',
        icon: ListChecks,
        hint: 'One form and period across every client — assign and remind in bulk, lodge one by one.',
        permission: PERMISSION.engagementRead,
        flag: 'filingRuns',
        ready: true,
      },
      {
        label: 'Notices',
        href: '/notices',
        icon: Gavel,
        hint: 'Department notices served on clients — the reply, hearings, the order and the appeal date.',
        // Managers record them; the engagement team reads them.
        permission: [PERMISSION.noticeManage, PERMISSION.engagementRead],
        flag: 'notices',
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
    title: 'Accounts',
    items: [
      {
        label: 'Accounts desk',
        href: '/accounts',
        icon: Calculator,
        hint: 'Billed, collected and outstanding this month, and today’s billing work queues.',
        permission: PERMISSION.entityReadBilling,
        ready: true,
      },
      {
        label: 'Client statements',
        href: '/billing/statements',
        icon: Receipt,
        hint: 'Each client’s billing profile and running balance: invoices, receipts, credits, TDS.',
        permission: PERMISSION.entityReadBilling,
        ready: true,
      },
      {
        label: 'Approvals sent',
        href: '/billing/approvals',
        icon: BadgeCheck,
        hint: 'Credit notes, write-offs, waivers and invoices waiting for a partner’s decision.',
        permission: PERMISSION.entityReadBilling,
        ready: true,
      },
      {
        label: 'Finance reports',
        href: '/reports/finance',
        icon: Landmark,
        hint: 'GST outward register, books export and bank statement matching.',
        permission: PERMISSION.entityReadBilling,
        ready: true,
      },
      {
        label: 'Payroll to book',
        href: '/payroll/books',
        icon: Banknote,
        hint: 'Approved payroll totals by head, the journal to book, and PF, ESI, PT and TDS challans.',
        permission: PERMISSION.payrollReadSummary,
        ready: true,
      },
    ],
  },
  {
    title: 'People',
    items: [
      {
        label: 'People desk',
        href: '/people',
        icon: Contact,
        hint: 'Headcount, joiners and leavers, and the people who need something done today.',
        permission: PERMISSION.employeeManage,
        ready: true,
      },
      {
        label: 'Employees',
        href: '/people/employees',
        icon: Users,
        hint: 'Every employee’s record, reporting line, login and hours.',
        permission: PERMISSION.employeeManage,
        ready: true,
      },
      {
        label: 'Articles',
        href: '/people/articles',
        icon: GraduationCap,
        hint: 'The articleship register: principal, registration, term, leave and completion.',
        permission: PERMISSION.employeeManage,
        ready: true,
      },
      {
        label: 'Joiners & leavers',
        href: '/people/joiners-leavers',
        icon: UserPlus,
        hint: 'Add a joiner with their login in one go; take a leaver through exit.',
        permission: PERMISSION.employeeManage,
        ready: true,
      },
      {
        label: 'Attendance',
        href: '/people/attendance',
        icon: CalendarCheck,
        hint: 'Each person’s first start, last stop and hours by day — no client names.',
        permission: PERMISSION.timeReadAttendance,
        ready: true,
      },
      {
        label: 'Workload',
        href: '/people/workload',
        icon: Gauge,
        hint: 'Who is overloaded and who has room, as counts — no client names.',
        permission: PERMISSION.reportReadPeople,
        ready: true,
      },
      {
        label: 'People reports',
        href: '/people/reports',
        icon: BarChart3,
        hint: 'Hours, headcount and attrition by office and grade — no client names.',
        permission: PERMISSION.reportReadPeople,
        ready: true,
      },
    ],
  },
  {
    title: 'Payroll',
    items: [
      {
        label: 'Monthly runs',
        href: '/payroll',
        icon: Banknote,
        hint: 'Run the month’s salaries and stipends, get them approved, pay and release payslips.',
        permission: PERMISSION.payrollRead,
        ready: true,
      },
      {
        label: 'Salary structures',
        href: '/payroll/structures',
        icon: ScrollText,
        hint: 'Each person’s pay, effective-dated, with revisions waiting for approval.',
        permission: PERMISSION.payrollRead,
        ready: true,
      },
      {
        label: 'Statutory',
        href: '/payroll/statutory',
        icon: Landmark,
        hint: 'PF, ESI, professional tax and TDS on salary: working, due dates and challans.',
        permission: PERMISSION.payrollRead,
        ready: true,
      },
      {
        label: 'Income tax',
        href: '/payroll/declarations',
        icon: Calculator,
        hint: 'Tax regime choices, investment declarations and proofs, TDS on salary, Form 138 and bonus.',
        permission: PERMISSION.payrollRead,
        ready: true,
      },
      {
        label: 'Full and final',
        href: '/payroll/exits',
        icon: ClipboardCheck,
        hint: 'Settle a leaver’s last pay, leave encashment, gratuity and recoveries, approved by the Managing Partner.',
        permission: PERMISSION.payrollRead,
        ready: true,
      },
      {
        label: 'Registers & payslips',
        href: '/payroll/registers',
        icon: FolderOpen,
        hint: 'Locked salary and stipend registers and every payslip, by month.',
        permission: PERMISSION.payrollRead,
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
        // Billers (incl. the Accountant, who has no report.read) and report readers.
        permission: [PERMISSION.billingManage, PERMISSION.reportRead],
        hideFor: PREPARER_ROLES,
        ready: true,
      },
      {
        label: 'Administration',
        href: '/admin',
        icon: Settings,
        hint: 'Users, roles, offices, firm templates and the firm’s workflow policy.',
        // Partners set the workflow policy without administering users.
        permission: [PERMISSION.userManage, PERMISSION.workflowManage],
        hideFor: PREPARER_ROLES,
        ready: true,
      },
    ],
  },
];

/** Every nav item, flattened in display order. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

function onlyIn(principal: Principal | null, roles: RoleSlug[]): boolean {
  if (!principal) return false;
  const held = principal.effectiveRole ? [principal.effectiveRole] : principal.roles;
  return held.length > 0 && held.every((r) => roles.includes(r));
}

function canSee(item: NavItem, principal: Principal | null, opts: NavOptions): boolean {
  if (item.permission) {
    const held = principal?.permissions ?? [];
    const needed = Array.isArray(item.permission) ? item.permission : [item.permission];
    if (!needed.some((p) => held.includes(p))) return false;
  }
  if (item.flag && !opts[item.flag]) return false;
  if (item.practice && isDeskOnly(principal)) return false;
  if (!opts.workLinks) return true;
  if (item.foldedInto) return false;
  return !(item.hideFor && onlyIn(principal, item.hideFor));
}

/**
 * Holds only desk roles (Accountant, HR): no practice dashboard, no client work.
 * Every held role counts, so a Senior who is also the Accountant is not desk-only.
 */
export function isDeskOnly(principal: Principal | null): boolean {
  const held = principal?.roles ?? [];
  return held.length > 0 && held.every((r) => DESK_ROLES.includes(r));
}

/**
 * Where sign-in lands (WF-201): Today for preparers (article / senior) once
 * ff_today_view is on for their office; the Accounts or People desk for the
 * desk roles (Accountant, HR) when that is all they hold; Home for everyone else.
 */
export function landingPath(principal: Principal | null, opts: NavOptions = {}): string {
  // Desk roles only: the Accounts desk or the People desk.
  if (isDeskOnly(principal)) {
    return principal!.roles.includes(ROLE.accountant) ? '/accounts' : '/people';
  }
  const canRead = (principal?.permissions ?? []).includes(PERMISSION.engagementRead);
  return opts.todayView && canRead && onlyIn(principal, PREPARER_ROLES) ? '/today' : '/';
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

/**
 * Where an old route lands now that it lives in My Work, keeping the link's
 * own query (e.g. /reviews?filter=signoff → /my-work?tab=to-review&filter=signoff);
 * the target's params win. Null when the route was not folded. Pure — tested.
 */
export function foldedTarget(from: string, search: string): string | null {
  const to = NAV_ITEMS.find((i) => i.href === from)?.foldedInto;
  if (!to) return null;
  const [path = to, query = ''] = to.split('?');
  const params = new URLSearchParams(search);
  new URLSearchParams(query).forEach((v, k) => params.set(k, v));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * A link to an old list route, sent straight to its My Work tab once
 * ff_work_links is on, so a click skips the redirect hop (WF-106).
 */
export function foldedHref(href: string, workLinks: boolean): string {
  if (!workLinks) return href;
  const [path = href, query = ''] = href.split('?');
  return foldedTarget(path, query) ?? href;
}

/** Is this nav item the current page? Exact match or a sub-path, never a prefix-substring. */
export function isNavActive(item: NavItem, pathname: string): boolean {
  const base = item.href.split('?')[0]!;
  if (base === '/') return pathname === '/';
  return pathname === base || pathname.startsWith(base + '/');
}

/** The one item to mark current: the most specific match (Filing runs, not Compliance, on /compliance/runs). */
export function activeNavHref(items: readonly NavItem[], pathname: string): string | null {
  const hits = items.filter((i) => isNavActive(i, pathname));
  hits.sort((a, b) => b.href.split('?')[0]!.length - a.href.split('?')[0]!.length);
  return hits[0]?.href ?? null;
}
