'use client';

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Card } from '@/components/ui';
import { FrameworkReferences } from './framework-references';
import { PanelHeading, SourceLink } from './framework-summary-shared';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';

/**
 * 02.8 §5 Triggered Auditing Requirements — every SA / standard the framework
 * switches on (SA 510, 402, 299, 600, 620, CFS, IT environment), with the fact
 * that triggered it, the downstream work it creates and the applicable version
 * of the standard in the Central Authority/Provision Library.
 */
export function FrameworkSummaryTriggers({ summary }: FrameworkSummaryPanelProps): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const rows = summary.triggeredRequirements;
  return (
    <Card className="p-4" aria-label="Triggered Auditing Requirements">
      <PanelHeading
        title="Triggered Auditing Requirements"
        hint="Derived from the 02.1–02.7 conclusions — change the source section to change a trigger."
      />
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No additional auditing standard is triggered.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-faint">
              <tr>
                <th className="py-1 pr-3 font-medium">Requirement</th>
                <th className="py-1 pr-3 font-medium">Trigger</th>
                <th className="py-1 pr-3 font-medium">Source</th>
                <th className="py-1 pr-3 font-medium">Downstream work</th>
                <th className="py-1 font-medium">Standard</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.key} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3 font-medium text-ink">{t.requirement}</td>
                  <td className="py-1.5 pr-3 text-ink-muted">{t.trigger}</td>
                  <td className="py-1.5 pr-3 text-xs">
                    <SourceLink source={t.source} />
                  </td>
                  <td className="py-1.5 pr-3 text-ink-muted">{t.downstreamWork}</td>
                  <td className="py-1.5 text-xs">
                    {t.authorityProvisionId ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-primary-700 hover:underline"
                        aria-expanded={open === t.key}
                        onClick={() => setOpen((k) => (k === t.key ? null : t.key))}
                      >
                        <BookOpen className="h-3.5 w-3.5" /> View Standard
                      </button>
                    ) : (
                      <span className="text-ink-faint">{t.provisionCode ?? '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open &&
        (() => {
          const t = rows.find((r) => r.key === open);
          return t?.authorityProvisionId ? (
            <div className="mt-2">
              <FrameworkReferences
                contextKey={`framework-summary-trigger:${t.key}`}
                provisionIds={[t.authorityProvisionId]}
                anchors={[]}
              />
            </div>
          ) : null;
        })()}
    </Card>
  );
}
