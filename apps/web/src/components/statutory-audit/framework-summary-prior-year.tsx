'use client';

import { Card } from '@/components/ui';
import { PanelHeading, SourceLink } from './framework-summary-shared';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';

/**
 * 02.8 §8 Changes from Prior Year — only meaningful differences against the
 * prior year's approved framework baseline (classification, framework, CARO,
 * ICFR, group structure, other auditors, reporting, systems, law/methodology).
 */
export function FrameworkSummaryPriorYear({ summary }: FrameworkSummaryPanelProps): JSX.Element {
  const py = summary.priorYear;
  return (
    <Card className="p-4" aria-label="Changes from Prior Year">
      <PanelHeading
        title="Changes from Prior Year"
        hint={
          py.available
            ? `Against ${py.priorPeriodLabel ?? 'the prior year'}${py.priorBaselineVersion ? ` · framework v${py.priorBaselineVersion}` : ''}.`
            : undefined
        }
      />
      {!py.available ? (
        <p className="text-sm text-ink-muted">
          {py.reason ?? 'No prior-year framework to compare.'}
        </p>
      ) : py.changes.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No meaningful change from the prior-year framework.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-faint">
              <tr>
                <th className="py-1 pr-3 font-medium">Change</th>
                <th className="py-1 pr-3 font-medium">Prior year</th>
                <th className="py-1 pr-3 font-medium">Current year</th>
                <th className="py-1 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {py.changes.map((c, i) => (
                <tr key={`${c.changeType}:${i}`} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3 text-ink">{c.label}</td>
                  <td className="py-1.5 pr-3 text-ink-muted">{c.previous ?? '—'}</td>
                  <td className="py-1.5 pr-3 font-medium text-ink">{c.current ?? '—'}</td>
                  <td className="py-1.5 text-xs">
                    <SourceLink source={c.source} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
