'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { X, RotateCcw } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { visibleNavSections } from '@/lib/nav';
import { useOnboarding } from '@/lib/onboarding';
import { Button } from '@/components/ui';

/** Plain-language meanings of the words the portal uses most. */
const GLOSSARY: { term: string; meaning: string }[] = [
  {
    term: 'Client',
    meaning: 'A company, LLP, firm or individual we work for (sometimes called an “entity”).',
  },
  {
    term: 'Engagement',
    meaning:
      'One job for one client for one period — e.g. the FY 2025-26 statutory audit of a company.',
  },
  { term: 'EP', meaning: 'Engagement Partner — the partner responsible for an engagement.' },
  {
    term: 'Task',
    meaning: 'A piece of work inside an engagement, assigned to a person with a due date.',
  },
  {
    term: 'Client dependency',
    meaning:
      'Something we have asked the client for and are still waiting on (data, documents, confirmations).',
  },
  {
    term: 'Review point',
    meaning: 'A query a reviewer raises on the work that must be cleared before sign-off.',
  },
  {
    term: 'Sign-off',
    meaning: 'The partner’s final approval that the engagement’s work is complete.',
  },
  {
    term: 'Compliance obligation',
    meaning:
      'A return or filing with a due date — statutory (the law’s deadline) and internal (our target date).',
  },
  {
    term: 'PBC',
    meaning: '“Prepared by client” — the list of schedules and documents the client must provide.',
  },
];

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl / ⌘ + K', action: 'Search clients and engagements' },
  { keys: 'Ctrl / ⌘ + B', action: 'Show or hide the sidebar' },
  { keys: 'Esc', action: 'Close a pop-up' },
];

/** Slide-over help: where things live, what words mean, and shortcuts. */
export function HelpPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const { principal } = useAuth();
  const { restart } = useOnboarding(principal?.userId);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const sections = visibleNavSections(principal);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        className="scroll-slim flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line-strong bg-surface shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-surface px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Help &amp; quick guide</h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              Where to find things and what they mean.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-faint hover:bg-surface-sunken hover:text-ink"
            aria-label="Close help"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-5 py-4">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Where things are
            </h3>
            <div className="space-y-4">
              {sections.map((s, i) => (
                <div key={s.title ?? i}>
                  {s.title && <div className="mb-1 text-sm font-semibold text-ink">{s.title}</div>}
                  <ul className="space-y-1">
                    {s.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={onClose}
                            className="flex gap-3 rounded-lg px-2 py-1.5 transition hover:bg-surface-sunken"
                          >
                            <Icon
                              className="mt-0.5 h-4 w-4 shrink-0 text-primary-600"
                              aria-hidden
                            />
                            <span className="text-sm">
                              <span className="font-medium text-ink">{item.label}</span>
                              <span className="block text-ink-muted">{item.hint}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Common terms
            </h3>
            <dl className="space-y-2 text-sm">
              {GLOSSARY.map((g) => (
                <div key={g.term}>
                  <dt className="font-medium text-ink">{g.term}</dt>
                  <dd className="text-ink-muted">{g.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Keyboard shortcuts
            </h3>
            <ul className="space-y-1.5 text-sm">
              {SHORTCUTS.map((s) => (
                <li key={s.keys} className="flex items-center justify-between gap-3">
                  <span className="text-ink-muted">{s.action}</span>
                  <kbd className="rounded border border-line-strong bg-surface-sunken px-1.5 py-0.5 font-mono text-xs text-ink">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </section>

          <section className="border-t border-line pt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                restart();
                onClose();
              }}
            >
              <RotateCcw className="h-4 w-4" /> Show the getting-started guide again
            </Button>
            <p className="mt-2 text-xs text-ink-faint">It appears at the top of Home.</p>
          </section>
        </div>
      </aside>
    </div>
  );
}
