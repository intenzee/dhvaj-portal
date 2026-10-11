'use client';

import { Card } from '@/components/ui';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';

/** 02.8 §7 Framework Matters / Exceptions (Track B). PLACEHOLDER. */
export function FrameworkSummaryMatters({ summary }: FrameworkSummaryPanelProps): JSX.Element {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-ink">Framework Matters</h3>
      <ul className="mt-2 text-sm text-ink-muted">
        {summary.matters.map((m) => (
          <li key={m.id}>
            {m.code} {m.title}
          </li>
        ))}
      </ul>
    </Card>
  );
}
