'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { PERMISSION } from '@hsdg/contracts';
import { can, hasRole, type Principal } from './principal';

/**
 * First-run guidance. A short, role-aware checklist on Home that ticks itself off
 * as the user visits each place, and hides once dismissed. State is a per-user,
 * per-browser convenience only — losing it just shows the guide again.
 */

export interface OnboardingStep {
  key: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  /** Visiting a path starting with this marks the step done. */
  donePath: string;
}

/** The steps for this user, in order — only places they can actually open. */
export function onboardingSteps(principal: Principal | null): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  if (can(principal, PERMISSION.engagementRead)) {
    steps.push({
      key: 'my-work',
      title: 'See what’s on your plate',
      body: 'My Work lists your tasks, the client follow-ups you own, and anything waiting for your review.',
      href: '/my-work',
      cta: 'Open My Work',
      donePath: '/my-work',
    });
    steps.push({
      key: 'engagement',
      title: 'Open an engagement',
      body: 'An engagement is one job for one client. Inside it, use the Work tab for tasks, Documents for files and Time to log hours.',
      href: '/engagements',
      cta: 'Browse engagements',
      donePath: '/engagements/',
    });
  }
  if (can(principal, PERMISSION.complianceRead)) {
    steps.push({
      key: 'compliance',
      title: 'Check upcoming due dates',
      body: 'Compliance shows every return and filing that is overdue or due soon for your clients.',
      href: '/compliance',
      cta: 'View due dates',
      donePath: '/compliance',
    });
  }
  if (
    hasRole(principal, 'managing_partner', 'partner', 'manager') &&
    can(principal, PERMISSION.engagementRead)
  ) {
    steps.push({
      key: 'reviews',
      title: 'Review and sign off',
      body: 'Reviews & Sign-offs lists the engagements waiting on you as reviewer or partner.',
      href: '/reviews',
      cta: 'Open review queue',
      donePath: '/reviews',
    });
  }
  if (can(principal, PERMISSION.userManage)) {
    steps.push({
      key: 'admin',
      title: 'Set up your team',
      body: 'Administration is where you add users, give them roles and assign offices.',
      href: '/admin',
      cta: 'Open Administration',
      donePath: '/admin',
    });
  }
  return steps;
}

interface OnboardingState {
  dismissed: boolean;
  visited: string[];
}

const EMPTY: OnboardingState = { dismissed: false, visited: [] };
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; state: OnboardingState }>();

const storageKey = (userId: string): string => `dhvaj-onboarding:${userId}`;

function read(userId: string): OnboardingState {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey(userId));
  } catch {
    /* storage unavailable — fall back to the empty state */
  }
  const hit = cache.get(userId);
  if (hit && hit.raw === raw) return hit.state;
  let state = EMPTY;
  try {
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OnboardingState>;
      state = {
        dismissed: parsed.dismissed === true,
        visited: Array.isArray(parsed.visited)
          ? parsed.visited.filter((v) => typeof v === 'string')
          : [],
      };
    }
  } catch {
    /* corrupt value — start fresh */
  }
  cache.set(userId, { raw, state });
  return state;
}

function write(userId: string, next: OnboardingState): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* ignore — guidance is a convenience */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The user's onboarding state, plus actions to update it. */
export function useOnboarding(userId: string | undefined): {
  state: OnboardingState;
  dismiss: () => void;
  restart: () => void;
} {
  const state = useSyncExternalStore(
    subscribe,
    () => (userId ? read(userId) : EMPTY),
    () => EMPTY,
  );
  const dismiss = useCallback(() => {
    if (userId) write(userId, { ...read(userId), dismissed: true });
  }, [userId]);
  const restart = useCallback(() => {
    if (userId) write(userId, { dismissed: false, visited: [] });
  }, [userId]);
  return { state, dismiss, restart };
}

/** Records page visits so the checklist ticks itself off. Mount once, in the shell. */
export function useTrackOnboardingVisit(principal: Principal | null, pathname: string): void {
  const userId = principal?.userId;
  useEffect(() => {
    if (!userId) return;
    const current = read(userId);
    if (current.dismissed) return;
    const hits = onboardingSteps(principal)
      .filter((s) => pathname.startsWith(s.donePath) && !current.visited.includes(s.key))
      .map((s) => s.key);
    if (hits.length > 0) write(userId, { ...current, visited: [...current.visited, ...hits] });
    // principal identity is stable per session; re-run on navigation only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, pathname]);
}
