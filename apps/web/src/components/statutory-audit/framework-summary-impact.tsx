'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { FrameworkImpactView } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Textarea } from '@/components/form';
import { PanelHeading } from './framework-summary-shared';
import { FRAMEWORK_SUMMARY_QK, type FrameworkSummaryPanelProps } from './framework-summary-types';

const list = (xs: string[]): string => (xs.length ? xs.join('; ') : '—');

/**
 * 02.8 §15–§17 Framework Change Impact — on a reopened revision, the system's
 * first pass of what changed against the approved baseline it supersedes and
 * the downstream work that is affected, new, or completed-but-to-reassess.
 * A professional confirms it before the Manager review; completed work stays
 * linked to the superseded baseline it was performed under.
 */
export function FrameworkSummaryImpact({
  engagementId,
  summary,
  canManage,
  onChanged,
}: FrameworkSummaryPanelProps): JSX.Element | null {
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const isRevision = !!summary.baseline?.reopen;
  const base = `/engagements/${engagementId}/statutory-audit/${summary.workflowInstanceId}/framework-summary/impact`;
  const key = [...FRAMEWORK_SUMMARY_QK(engagementId), 'impact', summary.workflowInstanceId];
  const view = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<FrameworkImpactView>(base),
    enabled: isRevision,
  });
  const a = summary.impact;
  if (!a) return null;
  const superseded = view.data?.supersededWork ?? [];
  const canConfirm = canManage && !a.confirmedAt && summary.baseline?.status === 'draft';

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiFetch<FrameworkImpactView>(`${base}/confirm`, {
        method: 'POST',
        body: { note: note.trim() || null },
      });
      qc.setQueryData(key, res);
      toast('Impact analysis confirmed — affected work owners notified.');
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not confirm the impact analysis.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4" aria-label="Framework Change Impact">
      <PanelHeading
        title="Framework Change Impact"
        hint={`Revision v${a.baselineVersion} against approved v${a.comparedToVersion} — system first pass, professionally confirmed.`}
      />
      {a.items.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No framework conclusion differs from v{a.comparedToVersion} yet. Changes made in the
          reopened sections appear here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-ink-faint">
              <tr>
                <th className="py-1 pr-2 font-medium">Change</th>
                <th className="py-1 pr-2 font-medium">From → To</th>
                <th className="py-1 pr-2 font-medium">Section</th>
                <th className="py-1 pr-2 font-medium">Existing work affected</th>
                <th className="py-1 pr-2 font-medium">New work required</th>
                <th className="py-1 pr-2 font-medium">Completed work to reassess</th>
                <th className="py-1 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody>
              {a.items.map((i) => (
                <tr key={i.key} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 font-medium text-ink">
                    {i.label}
                    {i.approvalRequired && (
                      <Badge tone="warn" className="ml-1">
                        Approval
                      </Badge>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-ink-muted">
                    {i.from ?? '—'} → <span className="text-ink">{i.to ?? '—'}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-ink-muted">{i.affectedSection}</td>
                  <td className="py-1.5 pr-2 text-ink-muted">{list(i.existingWorkAffected)}</td>
                  <td className="py-1.5 pr-2 text-ink-muted">{list(i.newWorkRequired)}</td>
                  <td className="py-1.5 pr-2 text-warning-700">
                    {list(i.completedWorkToReassess)}
                  </td>
                  <td className="py-1.5 text-ink-muted">{i.ownerName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {a.confirmedAt ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-success-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> Confirmed by {a.confirmedByName ?? '—'} on{' '}
          {formatDate(a.confirmedAt)}
          {a.confirmationNote ? ` — ${a.confirmationNote}` : ''}
        </p>
      ) : (
        <div className="mt-2 rounded-md border border-warning-200 bg-warning-50/50 p-2 text-xs">
          <p className="flex items-center gap-1.5 text-warning-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Confirm the impact analysis before the Manager
            review (AF-01). A later change in the source sections re-opens it.
          </p>
          {canConfirm && (
            <div className="mt-2 space-y-2">
              <Field label="Professional judgement (optional)">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Button size="sm" disabled={busy} onClick={() => void confirm()}>
                {busy ? 'Confirming…' : 'Confirm Impact Analysis'}
              </Button>
            </div>
          )}
        </div>
      )}

      {superseded.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Work performed under v{a.comparedToVersion}
          </p>
          <ul className="space-y-1 text-xs">
            {superseded.map((w) => (
              <li
                key={`${w.workKind}:${w.workRef}`}
                className="flex flex-wrap items-center gap-1.5"
              >
                <span className="text-ink">{w.label}</span>
                <span className="text-ink-faint">
                  {w.section} · {w.ownerName ?? '—'}
                </span>
                {w.completed && <Badge tone="success">Completed</Badge>}
                {w.reassessmentRequired && (
                  <Badge tone="warn" className="max-w-full truncate">
                    Reassess{w.reassessmentReason ? `: ${w.reassessmentReason}` : ''}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
