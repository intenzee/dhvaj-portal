'use client';

import { Card } from '@/components/ui';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';

/** 02.8 §10–§11 Audit Framework Memorandum file card (Track B). PLACEHOLDER. */
export function FrameworkSummaryMemo({ summary }: FrameworkSummaryPanelProps): JSX.Element {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-ink">Audit Framework Memorandum</h3>
      <p className="mt-2 text-sm text-ink-muted">
        {summary.memo ? summary.memo.fileName : 'Not created yet.'}
      </p>
    </Card>
  );
}
