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
import type { TeamMember } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Button, Spinner } from '@/components/ui';
import { Textarea } from '@/components/form';
import { PlanningIntelligencePanel } from './planning-intelligence-panel';
import { BusinessUnderstandingPanel } from './business-understanding-panel';
import { MaterialityPanel } from './materiality-panel';
import { ScopeApproachPanel } from './scope-approach-panel';
import { AuditAreasPanel } from './audit-areas-panel';

/** The sub-area backed by the full 03.1 Planning Intelligence workflow. */
const INTELLIGENCE_ITEM_KEY = 'audit_strategy';
const UNDERSTANDING_ITEM_KEY = 'engagement_understanding';
const MATERIALITY_ITEM_KEY = 'materiality';
/** 03.4 Audit Scope & Approach backs both the audit-approach and overall-audit-plan rows. */
const SCOPE_ITEM_KEY = 'audit_approach';
const SCOPE_COVERED_ITEM_KEY = 'overall_audit_plan';
const AREAS_ITEM_KEY = 'areas_and_assertions';

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

export function PlanningPanel({
  engagementId,
  team,
}: {
  engagementId: string;
  team: TeamMember[];
}): JSX.Element | null {
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

  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  // Default to the first sub-area still needing work, so the pop-up opens on
  // the next thing to do.
  const selected =
    planning.items.find((i) => i.id === selectedId) ??
    planning.items.find((i) => i.state !== 'complete') ??
    planning.items[0];

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

      <PublishedMaterialityCard materiality={planning.materiality} />

      {/* Sub-areas as a compact index; the selected one is worked on beside it,
          so the planning file never becomes one long scrolling page. */}
      <div className="grid gap-3 md:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="self-start overflow-hidden p-0 md:sticky md:top-0">
          <ol className="divide-y divide-line" aria-label="Planning sub-areas">
            {planning.items.map((item) => {
              const isSelected = item.id === selected?.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`flex w-full flex-col gap-1 px-3.5 py-2.5 text-left transition hover:bg-surface-sunken ${
                      isSelected
                        ? 'bg-surface-sunken shadow-[inset_3px_0_0] shadow-primary-600'
                        : ''
                    }`}
                  >
                    <span className="flex items-start gap-2">
                      <span className="mt-0.5 font-mono text-[11px] text-ink-faint">
                        {String(item.sortOrder).padStart(2, '0')}
                      </span>
                      <span className="text-sm font-medium leading-snug text-ink">
                        {planningItemTitle(item)}
                      </span>
                    </span>
                    <span className="pl-6">
                      <Badge tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state]}</Badge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>

        {selected && (
          <PlanningItemWork
            key={selected.id}
            engagementId={engagementId}
            workflowInstanceId={planning.workflowInstanceId}
            team={team}
            item={selected}
            editable={editable}
            canManage={canManage}
            onChanged={invalidate}
          />
        )}
      </div>
    </div>
  );
}

/** Display title of a planning sub-area (03.1 – 03.5 carry their section numbers). */
function planningItemTitle(item: PlanningItem): string {
  switch (item.itemKey) {
    case INTELLIGENCE_ITEM_KEY:
      return '03.1 Planning Intelligence & Overall Audit Strategy';
    case UNDERSTANDING_ITEM_KEY:
      return '03.2 Business Understanding & Preliminary Analytics';
    case MATERIALITY_ITEM_KEY:
      return '03.3 Materiality';
    case SCOPE_ITEM_KEY:
      return '03.4 Audit Scope & Approach';
    case SCOPE_COVERED_ITEM_KEY:
      return `${item.title} (via 03.4)`;
    case AREAS_ITEM_KEY:
      return '03.5 Audit Areas & Assertions';
    default:
      return item.title;
  }
}

function PlanningItemWork({
  engagementId,
  workflowInstanceId,
  team,
  item,
  editable,
  canManage,
  onChanged,
}: {
  engagementId: string;
  workflowInstanceId: string;
  team: TeamMember[];
  item: PlanningItem;
  editable: boolean;
  canManage: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [narrative, setNarrative] = useState(item.narrative ?? '');
  // 03.1 – 03.5 replace these sub-areas' free-text narrative; their state rolls up.
  const isIntelligence = item.itemKey === INTELLIGENCE_ITEM_KEY;
  const isUnderstanding = item.itemKey === UNDERSTANDING_ITEM_KEY;
  const isMateriality = item.itemKey === MATERIALITY_ITEM_KEY;
  const isScope = item.itemKey === SCOPE_ITEM_KEY;
  const isScopeCovered = item.itemKey === SCOPE_COVERED_ITEM_KEY;
  const isAreas = item.itemKey === AREAS_ITEM_KEY;

  const save = useMutation({
    mutationFn: (state: PlanningItemState) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/planning/${item.id}`, {
        method: 'POST',
        // Send narrative as-is (empty string clears it); the API leaves an
        // omitted field unchanged, so a full-replace must send the value.
        body: { state, narrative, version: item.version },
      }),
    onSuccess: () => {
      toast(`${item.title}: saved.`);
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.'),
  });

  return (
    <Card className="min-w-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{planningItemTitle(item)}</h3>
        <Badge tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state]}</Badge>
      </div>

      {isIntelligence && (
        <div className="mt-3 border-t border-line pt-3">
          <PlanningIntelligencePanel
            engagementId={engagementId}
            workflowInstanceId={workflowInstanceId}
            team={team}
            editable={editable}
            onChanged={onChanged}
          />
        </div>
      )}

      {isUnderstanding && (
        <div className="mt-3 border-t border-line pt-3">
          <BusinessUnderstandingPanel
            engagementId={engagementId}
            workflowInstanceId={workflowInstanceId}
            team={team}
            editable={editable}
            onChanged={onChanged}
          />
        </div>
      )}

      {isMateriality && (
        <div className="mt-3 border-t border-line pt-3">
          <MaterialityPanel
            engagementId={engagementId}
            workflowInstanceId={workflowInstanceId}
            team={team}
            editable={editable}
            canRevise={canManage}
            onChanged={onChanged}
          />
        </div>
      )}

      {isScope && (
        <div className="mt-3 border-t border-line pt-3">
          <ScopeApproachPanel
            engagementId={engagementId}
            workflowInstanceId={workflowInstanceId}
            team={team}
            editable={editable}
            canRevise={canManage}
            onChanged={onChanged}
          />
        </div>
      )}

      {isAreas && (
        <div className="mt-3 border-t border-line pt-3">
          <AuditAreasPanel
            engagementId={engagementId}
            workflowInstanceId={workflowInstanceId}
            team={team}
            editable={editable}
            canManage={canManage}
            onChanged={onChanged}
          />
        </div>
      )}

      {isScopeCovered && (
        <p className="mt-3 border-t border-line pt-3 text-sm text-ink-muted">
          The overall audit plan (strategic scope, approach, timing pattern and evidence strategy)
          is recorded in 03.4 Audit Scope &amp; Approach — this row follows its status.
        </p>
      )}

      {!isIntelligence &&
        !isUnderstanding &&
        !isMateriality &&
        !isScope &&
        !isScopeCovered &&
        !isAreas && (
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
                  <Button
                    variant="secondary"
                    onClick={() => save.mutate('in_progress')}
                    disabled={save.isPending}
                  >
                    Save · In progress
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => save.mutate('complete')}
                    disabled={save.isPending}
                  >
                    Save · Complete
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => save.mutate('needs_attention')}
                    disabled={save.isPending}
                  >
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

/**
 * The published (current-version) materiality, read-only. 03.3 Materiality
 * owns the determination and publishes it here when a version is completed.
 */
function PublishedMaterialityCard({
  materiality,
}: {
  materiality: Materiality | null;
}): JSX.Element {
  const fmt = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <span className="flex items-center gap-2.5">
        <Calculator className="h-4 w-4 text-ink-faint" />
        <span className="text-sm font-medium text-ink">Materiality in use</span>
      </span>
      {materiality?.overallMateriality != null ? (
        <span className="text-xs text-ink-muted">
          OM {fmt(materiality.overallMateriality)} · PM {fmt(materiality.performanceMateriality)} ·
          Clearly trivial {fmt(materiality.clearlyTrivialThreshold)}
          {materiality.benchmark ? ` · ${materiality.benchmark}` : ''}
        </span>
      ) : (
        <span className="text-xs text-ink-muted">
          Not yet determined — complete 03.3 Materiality.
        </span>
      )}
    </Card>
  );
}
