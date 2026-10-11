'use client';

import { Card } from '@/components/ui';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';

/** 02.8 §8 Changes from Prior Year (Track B). PLACEHOLDER. */
export function FrameworkSummaryPriorYear({ summary }: FrameworkSummaryPanelProps): JSX.Element {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-ink">Changes from Prior Year</h3>
      <p className="mt-2 text-sm text-ink-muted">
        {summary.priorYear.available
          ? `${summary.priorYear.changes.length} change(s)`
          : summary.priorYear.reason}
      </p>
    </Card>
  );
}
