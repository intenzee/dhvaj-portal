import { PERMISSION, type PermissionSlug } from '@hsdg/contracts';
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
  BarChart3,
  Users,
  Wallet,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { Principal } from './principal';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Permission required to see the item (undefined ⇒ always visible). */
  permission?: PermissionSlug;
  /** Screens not yet built in this foundation render a "coming soon" placeholder. */
  ready: boolean;
}

/** Primary navigation (§22), in order. Gated by permission and build status. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', icon: Home, ready: true },
  { label: 'My Work', href: '/my-work', icon: Briefcase, permission: PERMISSION.engagementRead, ready: true },
  { label: 'Engagements', href: '/engagements', icon: Layers, permission: PERMISSION.engagementRead, ready: true },
  { label: 'Entities', href: '/entities', icon: Building2, permission: PERMISSION.entityRead, ready: true },
  { label: 'Services', href: '/services', icon: FileText, permission: PERMISSION.serviceRead, ready: false },
  { label: 'Client Dependencies', href: '/client-dependencies', icon: MessageSquareWarning, permission: PERMISSION.engagementRead, ready: true },
  { label: 'Tasks', href: '/tasks', icon: ListTodo, permission: PERMISSION.engagementRead, ready: true },
  { label: 'Reviews & Sign-offs', href: '/reviews', icon: ClipboardCheck, permission: PERMISSION.engagementRead, ready: true },
  { label: 'Compliance', href: '/compliance', icon: CalendarClock, permission: PERMISSION.complianceRead, ready: true },
  { label: 'Documents', href: '/documents', icon: FileText, permission: PERMISSION.engagementRead, ready: false },
  { label: 'Reports & MIS', href: '/reports', icon: BarChart3, permission: PERMISSION.auditRead, ready: false },
  { label: 'Resource Management', href: '/resources', icon: Users, permission: PERMISSION.employeeRead, ready: false },
  { label: 'Billing & Collections', href: '/billing', icon: Wallet, ready: false },
  { label: 'Administration', href: '/admin', icon: Settings, permission: PERMISSION.userManage, ready: false },
];

/** The nav items a principal may see. */
export function visibleNav(principal: Principal | null): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.permission || (principal?.permissions ?? []).includes(item.permission));
}
