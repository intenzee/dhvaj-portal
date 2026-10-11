'use client';

import { Card } from '@/components/ui';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';

/** 02.8 §5 Triggered Auditing Requirements (Track B). PLACEHOLDER. */
export function FrameworkSummaryTriggers({ summary }: FrameworkSummaryPanelProps): JSX.Element {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-ink">Triggered Auditing Requirements</h3>
      <ul className="mt-2 text-sm text-ink-muted">
        {summary.triggeredRequirements.map((t) => (
          <li key={t.key}>
            {t.requirement} — {t.trigger}
          </li>
        ))}
      </ul>
    </Card>
  );
}
