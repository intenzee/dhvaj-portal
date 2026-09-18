'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import {
  REASSESSMENT_CHANGE_LABEL,
  REASSESSMENT_CHANGE_TYPE,
  PERMISSION,
  type AuditReassessment,
  type ReassessmentChangeType,
  type StatutoryAuditReassessment,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { Field, Select, Textarea } from '@/components/form';

/**
 * Change-Impact / Reassessment (Audit Spec §29, §30) — SA-9. Controlled change
 * management: raising a reassessment records the change and FLAGS the affected
 * downstream work (framework areas, audit areas, phases) for reconsideration —
 * it never deletes it. Open reassessments are a professional to-do; resolving one
 * records that the flagged work has been addressed. An archived file is locked.
 */

const QK = (id: string) => ['engagement', id, 'statutory-audit-reassessment'];

export function ReassessmentPanel({ engagementId }: { engagementId: string }): JSX.Element | null {
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const query = useQuery({
    queryKey: QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditReassessment[]>(
        `/engagements/${engagementId}/statutory-audit/reassessments`,
      ),
  });

  if (query.isLoading) return <Spinner label="Loading reassessments…" />;
  const file = query.data?.[0];
  if (!file) return null;

  return <ReassessmentFile engagementId={engagementId} file={file} canManage={canManage} />;
}

function ReassessmentFile({
  engagementId,
  file,
  canManage,
}: {
  engagementId: string;
  file: StatutoryAuditReassessment;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [changeType, setChangeType] = useState<ReassessmentChangeType>(
    REASSESSMENT_CHANGE_TYPE.materialityRevised,
  );
  const [reason, setReason] = useState('');

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: QK(engagementId) });
    // Impact touches framework/planning/work/phases + completion — refresh them.
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };

  const raise = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/${file.workflowInstanceId}/reassessments`, {
        method: 'POST',
        body: { changeType, reason },
      }),
    onSuccess: () => {
      toast('Reassessment raised — affected work flagged.');
      setReason('');
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not raise reassessment.'),
  });

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Change Impact &amp; Reassessment</h2>
            <p className="mt-1 text-xs text-ink-muted">
              Controlled change management (§30) — flag affected work; never delete it.
            </p>
          </div>
          {file.openCount > 0 ? (
            <Badge tone="warn">{file.openCount} open</Badge>
          ) : (
            <Badge tone="success">None open</Badge>
          )}
        </div>
      </Card>

      {/* Raise a reassessment */}
      {canManage && !file.locked && (
        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-semibold text-ink">Record a change</h3>
          <Field label="Change type">
            <Select
              value={changeType}
              onChange={(e) => setChangeType(e.target.value as ReassessmentChangeType)}
            >
              {Object.values(REASSESSMENT_CHANGE_TYPE).map((t) => (
                <option key={t} value={t}>
                  {REASSESSMENT_CHANGE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason">
            <Textarea
              rows={2}
              value={reason}
              placeholder="Why is this being reassessed?"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!reason.trim() || raise.isPending}
              onClick={() => raise.mutate()}
            >
              <AlertTriangle className="h-4 w-4" />
              Raise reassessment
            </Button>
          </div>
        </Card>
      )}

      {file.locked && (
        <Card className="p-4">
          <p className="text-xs text-ink-muted">
            This audit file is archived and locked — no further reassessment is possible (§37).
          </p>
        </Card>
      )}

      {/* History */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line bg-surface-raised/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          History
        </div>
        {file.events.length === 0 ? (
          <div className="p-5">
            <EmptyState>No reassessments have been raised on this file.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {file.events.map((ev) => (
              <EventRow
                key={ev.id}
                engagementId={engagementId}
                event={ev}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function EventRow({
  engagementId,
  event,
  canManage,
}: {
  engagementId: string;
  event: AuditReassessment;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const isOpen = event.status === 'open';

  const resolve = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/reassessments/${event.id}/resolve`, {
        method: 'POST',
        body: { version: event.version },
      }),
    onSuccess: () => {
      toast('Reassessment resolved.');
      void qc.invalidateQueries({ queryKey: QK(engagementId) });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not resolve.'),
  });

  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">
              {REASSESSMENT_CHANGE_LABEL[event.changeType]}
            </span>
            <Badge tone={isOpen ? 'warn' : 'success'}>{isOpen ? 'Open' : 'Resolved'}</Badge>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{event.reason}</p>
          {event.affectedSummary && (
            <p className="mt-1 text-xs text-ink-faint">{event.affectedSummary}</p>
          )}
          <p className="mt-1 text-[11px] text-ink-faint">
            {event.raisedByName ?? 'Someone'} · {new Date(event.createdAt).toLocaleDateString()}
            {event.resolvedByName && ` · resolved by ${event.resolvedByName}`}
          </p>
        </div>
        {isOpen && canManage && (
          <Button
            variant="secondary"
            size="sm"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate()}
          >
            <RotateCcw className="h-4 w-4" />
            Resolve
          </Button>
        )}
      </div>
    </li>
  );
}
