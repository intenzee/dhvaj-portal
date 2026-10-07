'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditMatterRecord, MatterSection, MatterStatus } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';
import { Textarea } from '@/components/form';

const OPEN: MatterStatus[] = ['open', 'under_review', 'blocking'];

/**
 * A section's matters, raised by the file (an adverse acceptance answer, a
 * framework override or missing figure). Each is resolved where it is shown —
 * the basis is drafted from what the answer or area already records, so
 * accepting it is one step. Anchored as `<section>-matters` for "Go to" links.
 */
export function MattersCard({
  engagementId,
  workflowInstanceId,
  section,
  canManage,
}: {
  engagementId: string;
  workflowInstanceId: string;
  section: MatterSection;
  canManage: boolean;
}): JSX.Element | null {
  const query = useQuery({
    queryKey: ['engagement', engagementId, 'matters', workflowInstanceId, section],
    queryFn: () =>
      apiFetch<AuditMatterRecord[]>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/matters?section=${section}`,
      ),
  });
  const matters = query.data ?? [];
  const open = matters.filter((m) => OPEN.includes(m.status));
  const closed = matters.filter((m) => !OPEN.includes(m.status));
  const [showClosed, setShowClosed] = useState(false);

  if (matters.length === 0) return <div id={`audit-anchor-${section}-matters`} />;

  return (
    <Card id={`audit-anchor-${section}-matters`} className="space-y-2 p-4">
      <p className="text-xs font-medium text-ink">
        Matters{open.length > 0 ? ` — ${open.length} open` : ' — none open'}
      </p>
      {open.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {open.map((m) => (
            <MatterRow key={m.id} engagementId={engagementId} matter={m} canManage={canManage} />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <div>
          <button
            type="button"
            className="text-xs text-ink-muted hover:text-ink hover:underline"
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? 'Hide' : 'Show'} {closed.length} closed
          </button>
          {showClosed && (
            <ul className="mt-1 space-y-1 text-xs text-ink-muted">
              {closed.map((m) => (
                <li key={m.id}>
                  <span className="font-medium text-ink">{m.matterCode}</span> {m.title} —{' '}
                  {humanize(m.status)}
                  {m.resolution ? `: ${m.resolution}` : ''}
                  {m.approverName ? ` (${m.approverName})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function MatterRow({
  engagementId,
  matter,
  canManage,
}: {
  engagementId: string;
  matter: AuditMatterRecord;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [basis, setBasis] = useState(matter.resolution ?? matter.suggestedResolution ?? '');
  const update = useMutation({
    mutationFn: (status: MatterStatus) =>
      apiFetch<AuditMatterRecord>(
        `/engagements/${engagementId}/statutory-audit/matters/${matter.id}`,
        {
          method: 'POST',
          body: { status, resolution: basis.trim() || null, version: matter.version },
        },
      ),
    onSuccess: (_res, status) => {
      toast(
        status === 'accepted_with_approval'
          ? `${matter.matterCode} accepted with approval.`
          : `${matter.matterCode} resolved.`,
      );
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not update the matter.', 'error'),
  });

  return (
    <li className="space-y-1.5 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-ink">{matter.matterCode}</span>
        {matter.isBlocking && <Badge tone="danger">Blocks approval</Badge>}
        {matter.severity && <Badge tone="neutral">{humanize(matter.severity)}</Badge>}
      </div>
      <p className="text-ink">{matter.title}</p>
      {canManage && (
        <>
          <Textarea
            rows={2}
            value={basis}
            aria-label={`Basis for ${matter.matterCode}`}
            placeholder="Safeguard / basis for accepting it"
            onChange={(e) => setBasis(e.target.value)}
          />
          {matter.suggestedResolution && basis === matter.suggestedResolution && (
            <p className="text-[11px] text-ink-faint">
              Drafted from the explanation already on the file.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={update.isPending || !basis.trim()}
              title={!basis.trim() ? 'Record the basis first' : undefined}
              onClick={() => update.mutate('accepted_with_approval')}
            >
              Accept with approval
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={update.isPending}
              onClick={() => update.mutate('resolved')}
            >
              Mark resolved
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
