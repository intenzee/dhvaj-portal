'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Lock, Calculator } from 'lucide-react';
import {
  PERMISSION,
  type Materiality,
  type PlanningItem,
  type PlanningItemState,
  type StatutoryAuditPlanning,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Textarea } from '@/components/form';

/**
 * Planning (Phase 03) screen (Audit Spec §21). A structured planning file of
 * sub-areas plus the materiality record. Approving Planning (framework must be
 * approved, every sub-area complete) freezes it, completes Phase 03 and unlocks
 * Risk (Phase 04).
 */

const STATE_TONE: Record<PlanningItemState, string> = {
  not_started: 'neutral',
  in_progress: 'info',
  complete: 'success',
  needs_attention: 'danger',
};
const STATE_LABEL: Record<PlanningItemState, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  needs_attention: 'Needs attention',
};

const PLANNING_QK = (id: string) => ['engagement', id, 'statutory-audit-planning'];

export function PlanningPanel({ engagementId }: { engagementId: string }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const query = useQuery({
    queryKey: PLANNING_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditPlanning[]>(`/engagements/${engagementId}/statutory-audit/planning`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: PLANNING_QK(engagementId) });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'statutory-audit'] });
  };

  const approve = useMutation({
    mutationFn: (workflowInstanceId: string) =>
      apiFetch<StatutoryAuditPlanning>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/planning/approve`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      toast('Planning approved — Phase 03 complete, Risk unlocked.');
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not approve planning.'),
  });

  if (query.isLoading) return <Spinner label="Loading planning…" />;
  const planning = query.data?.[0];
  if (!planning) return null;

  const approved = planning.approval != null;
  const ready = planning.frameworkApproved && planning.incompleteCount === 0;
  const editable = canManage && !approved;

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Planning · Phase 03</h2>
          <p className="text-xs text-ink-muted">
            {approved ? (
              <>
                Approved
                {planning.approval?.version ? ` (v${planning.approval.version})` : ''}
                {planning.approval?.approvedByName ? ` · ${planning.approval.approvedByName}` : ''}
              </>
            ) : !planning.frameworkApproved ? (
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                Approve the Framework (Phase 02) before approving Planning.
              </span>
            ) : planning.incompleteCount === 0 ? (
              'All sub-areas complete — ready to approve.'
            ) : (
              `${planning.incompleteCount} sub-area(s) not yet complete.`
            )}
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => approve.mutate(planning.workflowInstanceId)}
            disabled={approve.isPending || approved || !ready}
            title={!ready ? 'Framework approved + every sub-area complete first' : undefined}
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {approved ? 'Approved' : 'Approve planning'}
          </Button>
        )}
      </Card>

      <MaterialityCard
        engagementId={engagementId}
        workflowInstanceId={planning.workflowInstanceId}
        materiality={planning.materiality}
        editable={editable}
        onChanged={invalidate}
      />

      {planning.items.map((item) => (
        <PlanningItemCard
          key={item.id}
          engagementId={engagementId}
          item={item}
          editable={editable}
          onChanged={invalidate}
        />
      ))}
    </div>
  );
}

function PlanningItemCard({
  engagementId,
  item,
  editable,
  onChanged,
}: {
  engagementId: string;
  item: PlanningItem;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [narrative, setNarrative] = useState(item.narrative ?? '');

  const save = useMutation({
    mutationFn: (state: PlanningItemState) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/planning/${item.id}`, {
        method: 'POST',
        body: { state, narrative: narrative || undefined, version: item.version },
      }),
    onSuccess: () => {
      toast(`${item.title}: saved.`);
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.'),
  });

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2.5">
          <span className="font-mono text-xs text-ink-faint">
            {String(item.sortOrder).padStart(2, '0')}
          </span>
          <span className="text-sm font-medium text-ink">{item.title}</span>
        </span>
        <Badge tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state]}</Badge>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          {editable ? (
            <>
              <Textarea
                rows={3}
                placeholder="Planning narrative for this sub-area…"
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => save.mutate('in_progress')} disabled={save.isPending}>
                  Save · In progress
                </Button>
                <Button variant="secondary" onClick={() => save.mutate('complete')} disabled={save.isPending}>
                  Save · Complete
                </Button>
                <Button variant="secondary" onClick={() => save.mutate('needs_attention')} disabled={save.isPending}>
                  Needs attention
                </Button>
              </div>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-ink-muted">
              {item.narrative || <span className="text-ink-faint">No narrative recorded.</span>}
            </p>
          )}
          {item.updatedByName && (
            <p className="text-[11px] text-ink-faint">Last updated by {item.updatedByName}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function MaterialityCard({
  engagementId,
  workflowInstanceId,
  materiality,
  editable,
  onChanged,
}: {
  engagementId: string;
  workflowInstanceId: string;
  materiality: Materiality | null;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [overall, setOverall] = useState(materiality?.overallMateriality?.toString() ?? '');
  const [performance, setPerformance] = useState(
    materiality?.performanceMateriality?.toString() ?? '',
  );
  const [trivial, setTrivial] = useState(materiality?.clearlyTrivialThreshold?.toString() ?? '');
  const [benchmark, setBenchmark] = useState(materiality?.benchmark ?? '');
  const [basis, setBasis] = useState(materiality?.basis ?? '');

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/planning/materiality`, {
        method: 'POST',
        body: {
          overallMateriality: overall ? Number(overall) : undefined,
          performanceMateriality: performance ? Number(performance) : undefined,
          clearlyTrivialThreshold: trivial ? Number(trivial) : undefined,
          benchmark: benchmark || undefined,
          basis: basis || undefined,
          version: materiality?.version,
        },
      }),
    onSuccess: () => {
      toast('Materiality saved.');
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save materiality.'),
  });

  const fmt = (n: number | null) =>
    n == null ? '—' : `₹${n.toLocaleString('en-IN')}`;

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2.5">
          <Calculator className="h-4 w-4 text-ink-faint" />
          <span className="text-sm font-medium text-ink">Materiality</span>
        </span>
        <span className="text-xs text-ink-muted">
          Overall {fmt(materiality?.overallMateriality ?? null)}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          {editable ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Overall materiality (₹)">
                  <Input type="number" min={0} value={overall} onChange={(e) => setOverall(e.target.value)} />
                </Field>
                <Field label="Performance materiality (₹)">
                  <Input type="number" min={0} value={performance} onChange={(e) => setPerformance(e.target.value)} />
                </Field>
                <Field label="Clearly-trivial (₹)">
                  <Input type="number" min={0} value={trivial} onChange={(e) => setTrivial(e.target.value)} />
                </Field>
              </div>
              <Field label="Benchmark">
                <Input placeholder="e.g. 5% of profit before tax" value={benchmark} onChange={(e) => setBenchmark(e.target.value)} />
              </Field>
              <Field label="Basis">
                <Textarea rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} />
              </Field>
              <Button variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}>
                Save materiality
              </Button>
            </>
          ) : (
            <div className="grid gap-2 text-sm text-ink-muted sm:grid-cols-3">
              <div>Overall: <span className="text-ink">{fmt(materiality?.overallMateriality ?? null)}</span></div>
              <div>Performance: <span className="text-ink">{fmt(materiality?.performanceMateriality ?? null)}</span></div>
              <div>Clearly-trivial: <span className="text-ink">{fmt(materiality?.clearlyTrivialThreshold ?? null)}</span></div>
              {materiality?.benchmark && <div className="sm:col-span-3">Benchmark: <span className="text-ink">{materiality.benchmark}</span></div>}
              {materiality?.basis && <div className="sm:col-span-3">Basis: <span className="text-ink">{materiality.basis}</span></div>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
