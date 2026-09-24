'use client';

import Link from 'next/link';
import { CheckCircle2, Circle, X, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { onboardingSteps, useOnboarding } from '@/lib/onboarding';
import { Card, CardBody } from '@/components/ui';
import { cn } from '@/lib/cn';

/** Wide-screen columns by step count, so the checklist fills one row (static for Tailwind). */
const XL_COLS: Record<number, string> = {
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  5: 'xl:grid-cols-5',
};

/**
 * First-run checklist on Home. Steps tick off as the user visits each place;
 * the card hides when dismissed (Help → "Show the getting-started guide again"
 * brings it back).
 */
export function GettingStarted(): JSX.Element | null {
  const { principal } = useAuth();
  const { state, dismiss } = useOnboarding(principal?.userId);
  const steps = onboardingSteps(principal);

  if (!principal || state.dismissed || steps.length === 0) return null;
  const done = steps.filter((s) => state.visited.includes(s.key)).length;
  const allDone = done === steps.length;

  return (
    <Card className="border-primary-600/30">
      <CardBody className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">
              {allDone ? 'You’re all set 🎉' : 'Getting started'}
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {allDone
                ? 'You’ve seen the main parts of the portal. The Help (?) button at the top is there whenever you need it.'
                : `A quick tour of the places you’ll use most — ${done} of ${steps.length} done.`}
            </p>
          </div>
          <button
            onClick={dismiss}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
            aria-label="Hide getting-started guide"
          >
            {allDone ? 'Close' : 'Hide'} <X className="ml-0.5 inline h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-primary-600 transition-[width]"
            style={{ width: `${Math.round((done / steps.length) * 100)}%` }}
          />
        </div>

        <ol
          className={cn(
            'mt-4 grid grid-cols-1 gap-3 md:grid-cols-2',
            XL_COLS[steps.length] ?? 'xl:grid-cols-4',
          )}
        >
          {steps.map((s, i) => {
            const isDone = state.visited.includes(s.key);
            return (
              <li
                key={s.key}
                className="flex flex-col rounded-lg border border-line bg-surface-sunken/40 p-3"
              >
                <div className="flex items-center gap-2">
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" aria-label="Done" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-ink-faint" aria-label="Not done yet" />
                  )}
                  <span className="text-xs font-medium text-ink-faint">Step {i + 1}</span>
                </div>
                <div
                  className={`mt-1 text-sm font-semibold ${isDone ? 'text-ink-muted' : 'text-ink'}`}
                >
                  {s.title}
                </div>
                <p className="mt-1 flex-1 text-xs leading-relaxed text-ink-muted">{s.body}</p>
                <Link
                  href={s.href}
                  className="mt-2 text-sm font-medium text-primary-600 hover:text-primary-700"
                >
                  {s.cta} →
                </Link>
              </li>
            );
          })}
        </ol>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
          <Search className="h-3.5 w-3.5" aria-hidden />
          Tip: press <kbd className="rounded border border-line-strong px-1 font-mono">
            Ctrl K
          </kbd>{' '}
          anywhere to jump to a client or engagement.
        </p>
      </CardBody>
    </Card>
  );
}
