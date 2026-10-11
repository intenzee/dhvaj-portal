'use client';

import type { DownstreamPreviewItem } from '@hsdg/contracts';
import { Badge, Card } from '@/components/ui';
import { PanelHeading, SourceLink } from './framework-summary-shared';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';

const ACTION: Record<DownstreamPreviewItem['action'], { label: string; tone: string }> = {
  create: { label: 'Create', tone: 'info' },
  activate: { label: 'Activate', tone: 'success' },
  deactivate: { label: 'Deactivate', tone: 'neutral' },
  parameterise: { label: 'Parameterise', tone: 'info' },
  none: { label: '—', tone: 'neutral' },
};

/**
 * 02.8 §6 Downstream Configuration Preview — what the approved framework will
 * configure in Planning, Audit Work and Reporting. Read-only: an incorrect
 * result is corrected in the originating assessment, never overridden here.
 */
export function FrameworkSummaryPreview({ summary }: FrameworkSummaryPanelProps): JSX.Element {
  const reviewed = summary.baseline?.previewReviewedAt;
  return (
    <Card className="p-4" aria-label="Downstream Configuration Preview">
      <PanelHeading
        title="Downstream Configuration Preview"
        hint={
          reviewed
            ? `Reviewed by ${summary.baseline?.previewReviewedByName ?? '—'} at the Manager confirmation.`
            : 'Applied once the framework is approved. Correct a result in its source section.'
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-faint">
            <tr>
              <th className="py-1 pr-3 font-medium">Configuration item</th>
              <th className="py-1 pr-3 font-medium">Result</th>
              <th className="py-1 pr-3 font-medium">Action</th>
              <th className="py-1 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {summary.downstreamPreview.map((p) => (
              <tr key={p.key} className="border-t border-line align-top">
                <td className="py-1.5 pr-3 text-ink">{p.item}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{p.result}</td>
                <td className="py-1.5 pr-3">
                  <Badge tone={ACTION[p.action].tone}>{ACTION[p.action].label}</Badge>
                </td>
                <td className="py-1.5 text-xs">
                  <SourceLink source={p.source} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
