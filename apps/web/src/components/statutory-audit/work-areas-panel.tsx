'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Lock, ChevronRight } from 'lucide-react';
import {
  PERMISSION,
  type AuditWorkArea,
  type SectionPack,
  type StatutoryAuditWorkGeneration,
  type WorkAreaState,
  type WorkSuggestionResult,
} from '@hsdg/contracts';
import type { TeamMember } from '@/lib/types';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { AuditAreaScreen } from './audit-area-panel';
import { useAuditAnchor } from './audit-file-nav';
import { SectionPackChecks } from './section-pack-card';

/**
 * Audit work (Phases 05–06) — Framework → Dynamic Work Generation (§20) plus
 * the planning areas. Once the framework is approved the work builds itself on
 * first open by a lead: a work area per framework workstream, per 03.5 audit
 * area and for the overall responses, with owner, reviewer, risk level,
 * materiality, due date and figures filled in and procedures suggested.
 * "Refresh suggested work" picks up later changes; a deleted suggestion never
 * comes back. Areas a later framework change makes not-applicable are shown
 * as inactive, never removed (§20).
 *
 * `only` narrows the list to some workstreams (Phase 05 shows the controls
 * work: IFC and internal-audit reliance). Above the list, what finishing the
 * work needs — each open item links to the area it sits in (`area-<id>`).
 */

const STATE_TONE: Record<WorkAreaState, string> = {
  not_started: 'neutral',
  in_progress: 'info',
  complete: 'success',
  needs_attention: 'danger',
  locked: 'neutral',
};

const STATE_LABEL: Record<WorkAreaState, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  needs_attention: 'Needs attention',
  locked: 'Not started',
};

const WORK_QK = (id: string) => ['engagement', id, 'statutory-audit-work-areas'];
const PROC_QK = (id: string) => ['engagement', id, 'statutory-audit-procedures'];

const RISK_TONE: Record<string, string> = {
  low: 'neutral',
  moderate: 'info',
  high: 'warn',
  significant: 'danger',
};

const amount = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function WorkAreasPanel({
  engagementId,
  team,
  only,
}: {
  engagementId: string;
  team: TeamMember[];
  only?: readonly string[];
}): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const phaseKey = only ? 'controls' : 'audit_areas';
  useAuditAnchor(phaseKey, (anchor) => {
    if (anchor.startsWith('area-')) setSelectedId(anchor.slice('area-'.length));
  });

  const query = useQuery({
    queryKey: WORK_QK(engagementId),
    queryFn: async () => {
      // Opening the list may build the work (first open by a lead), so the
      // procedures read afterwards must not come from an older cache.
      const data = await apiFetch<StatutoryAuditWorkGeneration[]>(
        `/engagements/${engagementId}/statutory-audit/work-areas`,
      );
      void qc.invalidateQueries({ queryKey: PROC_QK(engagementId) });
      return data;
    },
  });

  const refresh = useMutation({
    mutationFn: (workflowInstanceId: string) =>
      apiFetch<WorkSuggestionResult>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/work-areas/suggest`,
        { method: 'POST', body: {} },
      ),
    onSuccess: (r) => {
      const parts = [
        r.areasAdded ? `${r.areasAdded} area(s)` : null,
        r.proceduresAdded ? `${r.proceduresAdded} procedure(s)` : null,
        r.detailsFilled ? `${r.detailsFilled} blank field(s) filled` : null,
      ].filter(Boolean);
      toast(parts.length ? `Added ${parts.join(', ')}.` : 'Nothing new to suggest.');
      void qc.invalidateQueries({ queryKey: WORK_QK(engagementId) });
      void qc.invalidateQueries({ queryKey: PROC_QK(engagementId) });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not refresh suggested work.'),
  });

  if (query.isLoading) return <Spinner label="Loading work areas…" />;
  const gen = query.data?.[0];
  if (!gen) return null;

  const selected = selectedId ? gen.areas.find((a) => a.id === selectedId) ?? null : null;
  if (selected) {
    return (
      <AuditAreaScreen
        engagementId={engagementId}
        area={selected}
        allAreas={gen.areas}
        team={team}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  const shown = only ? gen.areas.filter((a) => only.includes(a.workAreaKey)) : gen.areas;
  const active = shown.filter((a) => a.isActive);
  const inactive = shown.filter((a) => !a.isActive);
  const isPlanningArea = (a: AuditWorkArea) => a.source === 'planning:03.5';
  const streams = active.filter((a) => !isPlanningArea(a));
  const fsAreas = active.filter(isPlanningArea);

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {only ? 'Controls work · Phase 05' : 'Audit work · Phases 05–06'}
          </h2>
          <p className="text-xs text-ink-muted">
            {!gen.frameworkApproved ? (
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                Approve the Framework Memo (Phase 02) — the audit work then builds itself.
              </span>
            ) : gen.areas.length === 0 ? (
              'Framework approved — the partner or manager opening this builds the work.'
            ) : (
              <>
                {active.length} work area(s)
                {gen.generatedFromVersion ? ` · from framework v${gen.generatedFromVersion}` : ''}
                {' · '}owners, risk levels, materiality and procedures filled in from Sections
                03–04
              </>
            )}
          </p>
        </div>
        {canManage && gen.frameworkApproved && (
          <Button
            variant="secondary"
            onClick={() => refresh.mutate(gen.workflowInstanceId)}
            disabled={refresh.isPending}
            title="Add work areas and procedures Sections 03–04 now point to. Never overwrites what the team entered."
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh suggested work
          </Button>
        )}
      </Card>

      <WorkPackCard pack={only ? gen.controlsPack : gen.pack} controls={!!only} />

      {gen.frameworkApproved && active.length === 0 && (
        <Card className="p-5">
          <EmptyState>
            {only
              ? 'No controls workstream applies — IFC reporting and internal-audit reliance are not applicable in the framework. Controls work, where planned, sits in each area’s procedures.'
              : 'No work areas yet.'}
          </EmptyState>
        </Card>
      )}

      {streams.length > 0 && fsAreas.length > 0 && (
        <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Workstreams
        </p>
      )}
      {streams.map((a) => (
        <WorkAreaCard key={a.id} area={a} onOpen={() => setSelectedId(a.id)} />
      ))}
      {fsAreas.length > 0 && (
        <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Financial statement areas (from 03.5)
        </p>
      )}
      {fsAreas.map((a) => (
        <WorkAreaCard key={a.id} area={a} onOpen={() => setSelectedId(a.id)} />
      ))}

      {inactive.length > 0 && (
        <div className="space-y-2 pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            No longer applicable (retained)
          </p>
          {inactive.map((a) => (
            <WorkAreaCard key={a.id} area={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkPackCard({
  pack,
  controls,
}: {
  pack: SectionPack;
  controls: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(!pack.ready);
  return (
    <Card className="space-y-3 p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-ink">
          {controls ? 'Is the controls work finished?' : 'Is the audit work finished?'}
        </span>
        <span className="flex items-center gap-2">
          {pack.attention > 0 && <Badge tone="warn">{pack.attention} to note</Badge>}
          <Badge tone={pack.ready ? 'success' : 'neutral'}>
            {pack.ready ? 'Ready for completion' : 'Work open'}
          </Badge>
          <ChevronRight className={`h-4 w-4 text-ink-faint transition ${open ? 'rotate-90' : ''}`} />
        </span>
      </button>
      {open && <SectionPackChecks pack={pack} needsTitle="What finishing the work needs" />}
    </Card>
  );
}

function WorkAreaCard({ area, onOpen }: { area: AuditWorkArea; onOpen?: () => void }): JSX.Element {
  const body = (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-ink">{area.title}</p>
        {area.scope && <p className="mt-0.5 text-xs text-ink-muted">{area.scope}</p>}
        <p className="mt-0.5 text-xs text-ink-faint">
          Owner: {area.detail.ownerName ?? '—'} · Reviewer: {area.detail.reviewerName ?? '—'}
          {area.detail.financialCurrent != null && (
            <> · CY {amount(area.detail.financialCurrent)}</>
          )}
          {area.detail.financialPrior != null && <> · PY {amount(area.detail.financialPrior)}</>}
          {area.detail.materiality != null && <> · PM {amount(area.detail.materiality)}</>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {area.detail.riskLevel && (
          <Badge tone={RISK_TONE[area.detail.riskLevel]}>
            {area.detail.riskLevel[0]!.toUpperCase() + area.detail.riskLevel.slice(1)} risk
          </Badge>
        )}
        <Badge tone={STATE_TONE[area.state]}>{STATE_LABEL[area.state]}</Badge>
        {onOpen && <ChevronRight className="h-4 w-4 text-ink-faint" />}
      </div>
    </div>
  );
  if (!onOpen) return <Card className="p-4 opacity-60">{body}</Card>;
  return (
    <Card className="p-0">
      <button type="button" onClick={onOpen} className="block w-full rounded-xl p-4 text-left hover:bg-surface-muted">
        {body}
      </button>
    </Card>
  );
}
