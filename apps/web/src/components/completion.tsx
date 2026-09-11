'use client';

import { CheckCircle2 } from 'lucide-react';

/**
 * A compact "X of Y done" progress bar. Used for a task list's completion and
 * for a recurring component's per-period progress, so "what's done / what's
 * left" reads the same everywhere.
 */
export function CompletionBar({
  done,
  total,
  label = 'done',
  className,
}: {
  done: number;
  total: number;
  label?: string;
  className?: string;
}): JSX.Element {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = total > 0 && done === total;
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <div
        className="h-2 w-28 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div
          className={`h-full rounded-full transition-all ${complete ? 'bg-success-600' : 'bg-primary-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="flex items-center gap-1 whitespace-nowrap text-xs font-medium text-ink-muted">
        {complete && <CheckCircle2 className="h-3.5 w-3.5 text-success-600" />}
        {done}/{total} {label}
      </span>
    </div>
  );
}
