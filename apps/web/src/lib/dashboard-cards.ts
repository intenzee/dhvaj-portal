import {
  Briefcase,
  CalendarX2,
  CalendarClock,
  ClipboardCheck,
  ShieldCheck,
  Users,
  AlertTriangle,
  ListTodo,
  type LucideIcon,
} from 'lucide-react';
import type { DashboardSummary, RoleSlug } from '@hsdg/contracts';

export type CardTone = 'neutral' | 'info' | 'warn' | 'danger' | 'success';

export interface CardDef {
  key: string;
  label: string;
  /** Which summary count this card shows. */
  value: keyof DashboardSummary;
  /** Where the card links to. */
  href: string;
  tone: CardTone;
  icon: LucideIcon;
}

/** Every card the dashboard can render, defined once. */
const CARDS: Record<string, CardDef> = {
  activeEngagements: {
    key: 'activeEngagements',
    label: 'Active Engagements',
    value: 'activeEngagements',
    href: '/engagements?status=active',
    tone: 'info',
    icon: Briefcase,
  },
  overdue: {
    key: 'overdue',
    label: 'Overdue',
    value: 'overdueCompliance',
    href: '/compliance?filter=overdue',
    tone: 'danger',
    icon: CalendarX2,
  },
  dueSoon: {
    key: 'dueSoon',
    label: 'Due in 7 days',
    value: 'dueSoonCompliance',
    href: '/compliance?filter=due-soon',
    tone: 'warn',
    icon: CalendarClock,
  },
  pendingReviews: {
    key: 'pendingReviews',
    label: 'Pending Reviews',
    value: 'pendingReviews',
    href: '/reviews',
    tone: 'info',
    icon: ClipboardCheck,
  },
  pendingSignoffs: {
    key: 'pendingSignoffs',
    label: 'Pending Sign-offs',
    value: 'pendingSignoffs',
    href: '/reviews?filter=signoff',
    tone: 'success',
    icon: ShieldCheck,
  },
  clientDependencies: {
    key: 'clientDependencies',
    label: 'Client Dependencies',
    value: 'openClientDependencies',
    href: '/client-dependencies',
    tone: 'info',
    icon: Users,
  },
  highRisk: {
    key: 'highRisk',
    label: 'High Risk',
    value: 'highRisk',
    href: '/reviews?filter=high-risk',
    tone: 'danger',
    icon: AlertTriangle,
  },
  myTasks: {
    key: 'myTasks',
    label: 'My Tasks',
    value: 'myOpenTasks',
    href: '/tasks',
    tone: 'neutral',
    icon: ListTodo,
  },
};

/**
 * Which cards each role sees on Home. One portal, permission-driven experiences
 * (§22): the numbers are already RLS-scoped, so this is purely about emphasis.
 */
const ROLE_CARD_KEYS: Record<RoleSlug, string[]> = {
  managing_partner: [
    'activeEngagements',
    'overdue',
    'dueSoon',
    'pendingReviews',
    'pendingSignoffs',
    'clientDependencies',
    'highRisk',
    'myTasks',
  ],
  partner: [
    'activeEngagements',
    'overdue',
    'dueSoon',
    'pendingReviews',
    'pendingSignoffs',
    'clientDependencies',
    'highRisk',
    'myTasks',
  ],
  manager: [
    'activeEngagements',
    'overdue',
    'dueSoon',
    'pendingReviews',
    'clientDependencies',
    'myTasks',
  ],
  senior: ['myTasks', 'dueSoon', 'clientDependencies'],
  article: ['myTasks', 'dueSoon'],
  admin: ['myTasks'],
};

/** The ordered cards for a role (empty if the role is unknown). */
export function cardsForRole(role: RoleSlug | undefined): CardDef[] {
  if (!role) return [CARDS.myTasks!];
  const keys = ROLE_CARD_KEYS[role] ?? ['myTasks'];
  return keys.map((k) => CARDS[k]!).filter(Boolean);
}

/** The headline metrics for the top stat strip — the role's cards minus My Tasks (its own panel), capped at 6. */
export function stripCardsForRole(role: RoleSlug | undefined): CardDef[] {
  return cardsForRole(role)
    .filter((c) => c.key !== 'myTasks')
    .slice(0, 6);
}
