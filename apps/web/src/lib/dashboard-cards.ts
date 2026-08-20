import type { DashboardSummary, RoleSlug } from '@hsdg/contracts';

export type CardTone = 'neutral' | 'info' | 'warn' | 'danger';

export interface CardDef {
  key: string;
  label: string;
  /** Which summary count this card shows. */
  value: keyof DashboardSummary;
  /** Where the card links to. */
  href: string;
  tone: CardTone;
}

/** Every card the dashboard can render, defined once. */
const CARDS: Record<string, CardDef> = {
  activeEngagements: {
    key: 'activeEngagements',
    label: 'Active Engagements',
    value: 'activeEngagements',
    href: '/engagements?status=active',
    tone: 'info',
  },
  overdue: {
    key: 'overdue',
    label: 'Overdue',
    value: 'overdueCompliance',
    href: '/compliance?filter=overdue',
    tone: 'danger',
  },
  dueSoon: {
    key: 'dueSoon',
    label: 'Due Soon',
    value: 'dueSoonCompliance',
    href: '/compliance?filter=due-soon',
    tone: 'warn',
  },
  pendingReviews: {
    key: 'pendingReviews',
    label: 'Pending Reviews',
    value: 'pendingReviews',
    href: '/reviews',
    tone: 'warn',
  },
  pendingSignoffs: {
    key: 'pendingSignoffs',
    label: 'Pending Sign-offs',
    value: 'pendingSignoffs',
    href: '/reviews?filter=signoff',
    tone: 'warn',
  },
  clientDependencies: {
    key: 'clientDependencies',
    label: 'Client Dependencies',
    value: 'openClientDependencies',
    href: '/my-work?tab=client-dependencies',
    tone: 'info',
  },
  highRisk: {
    key: 'highRisk',
    label: 'High Risk',
    value: 'highRisk',
    href: '/reviews?filter=high-risk',
    tone: 'danger',
  },
  myTasks: {
    key: 'myTasks',
    label: 'My Tasks',
    value: 'myOpenTasks',
    href: '/my-work',
    tone: 'neutral',
  },
};

/**
 * Which cards each role sees on Home. One portal, permission-driven experiences
 * (§22): the numbers are already RLS-scoped, so this is purely about emphasis.
 *
 *   MP / Partner — the full accountability view incl. sign-offs & high risk.
 *   Manager      — review/operational load, no EP sign-off card.
 *   Senior       — personal work + what's due, no governance cards.
 *   Article      — personal work.
 *   Admin        — platform role with no engagement data → just its own tasks.
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
    'pendingSignoffs',
    'pendingReviews',
    'clientDependencies',
    'highRisk',
    'overdue',
    'dueSoon',
    'myTasks',
  ],
  manager: [
    'activeEngagements',
    'pendingReviews',
    'clientDependencies',
    'overdue',
    'dueSoon',
    'myTasks',
  ],
  senior: ['myTasks', 'dueSoon', 'clientDependencies'],
  article: ['myTasks', 'dueSoon'],
  admin: ['myTasks'],
};

/** The ordered cards to render for a role (empty if the role is unknown). */
export function cardsForRole(role: RoleSlug | undefined): CardDef[] {
  if (!role) return [CARDS.myTasks!];
  const keys = ROLE_CARD_KEYS[role] ?? ['myTasks'];
  return keys.map((k) => CARDS[k]!).filter(Boolean);
}
