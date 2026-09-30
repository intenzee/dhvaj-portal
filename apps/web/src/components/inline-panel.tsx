'use client';

import type { ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * The +/− toggle shown at the side of every expandable audit-file row (phase,
 * sub-section, task). `+` opens the row's work directly below it; `−`
 * collapses it again — the file is worked in place, never in a pop-up.
 */
export function ExpandToggle({
  open,
  className = '',
}: {
  open: boolean;
  className?: string;
}): JSX.Element {
  const Icon = open ? Minus : Plus;
  return (
    <span
      aria-hidden
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
        open
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-line bg-surface-raised text-ink-muted group-hover:border-primary-600/60 group-hover:text-primary-600'
      } ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

/**
 * An expanded row's work, rendered inline directly under the row that opened
 * it. Drop-in for the former pop-up (same props), so a form or detail view
 * keeps its title, context line and footer actions — only now it opens and
 * collapses in place.
 */
export function InlinePanel({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra classes, e.g. to inset the panel inside a padded list row. */
  className?: string;
  /** Accepted for drop-in compatibility with the old pop-up; width is the row's. */
  size?: 'md' | 'lg' | 'workspace';
  wide?: boolean;
}): JSX.Element | null {
  if (!open) return null;
  return (
    <section
      aria-label={title}
      className={`mt-2 rounded-lg border border-primary-600/30 border-l-4 border-l-primary-600 bg-surface-sunken/40 ${className}`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {description && <p className="text-xs text-ink-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Collapse ${title}`}
          title="Collapse"
          className="group shrink-0"
        >
          <ExpandToggle open />
        </button>
      </header>
      <div className="p-4">{children}</div>
      {footer && <footer className="border-t border-line px-4 py-2.5">{footer}</footer>}
    </section>
  );
}
