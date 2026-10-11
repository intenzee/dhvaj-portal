'use client';

import { Card } from '@/components/ui';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';

/** 02.8 §16 Framework Change Impact Analysis (Track B). PLACEHOLDER. */
export function FrameworkSummaryImpact({
  summary,
}: FrameworkSummaryPanelProps): JSX.Element | null {
  if (!summary.impact) return null;
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-ink">Framework Change Impact</h3>
      <p className="mt-2 text-sm text-ink-muted">{summary.impact.items.length} impact item(s)</p>
    </Card>
  );
}
