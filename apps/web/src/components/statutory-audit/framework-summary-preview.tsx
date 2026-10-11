'use client';

import { Card } from '@/components/ui';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';

/** 02.8 §6 Downstream Configuration Preview (Track B). PLACEHOLDER. */
export function FrameworkSummaryPreview({ summary }: FrameworkSummaryPanelProps): JSX.Element {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-ink">Downstream Configuration Preview</h3>
      <ul className="mt-2 text-sm text-ink-muted">
        {summary.downstreamPreview.map((p) => (
          <li key={p.key}>
            {p.item}: {p.result}
          </li>
        ))}
      </ul>
    </Card>
  );
}
