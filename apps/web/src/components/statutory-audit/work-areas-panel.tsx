'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wand2, Lock, ChevronRight } from 'lucide-react';
import {
  PERMISSION,
  type AuditWorkArea,
  type StatutoryAuditWorkGeneration,
  type WorkAreaState,
} from '@hsdg/contracts';
import type { TeamMember } from '@/lib/types';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { AuditAreaScreen } from './audit-area-panel';

/**
 * Audit Areas (Phase 06) screen — Framework → Dynamic Work Generation (§20). The
 * approved framework conclusions drive WHAT work exists: "APPROVED FRAMEWORK →
 * APPLICABLE WORK AREAS". Generation is idempotent; areas a later framework
 * change makes not-applicable are shown as inactive, never removed (§20).
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
  locked: 'Locked',
};

const WORK_QK = (id: string) => ['engagement', id, 'statutory-audit-work-areas'];

export function WorkAreasPanel({
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: WORK_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditWorkGeneration[]>(
        `/engagements/${engagementId}/statutory-audit/work-areas`,
      ),
  });

  const generate = useMutation({
    mutationFn: (workflowInstanceId: string) =>
      apiFetch<StatutoryAuditWorkGeneration>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/work-areas/generate`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      toast('Applicable work areas generated from the approved framework.');
      void qc.invalidateQueries({ queryKey: WORK_QK(engagementId) });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not generate work.'),
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

  const active = gen.areas.filter((a) => a.isActive);
  const inactive = gen.areas.filter((a) => !a.isActive);

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Audit Areas · Phase 06</h2>
          <p className="text-xs text-ink-muted">
            {!gen.frameworkApproved ? (
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                Approve the Framework Memo (Phase 02) to generate applicable work.
              </span>
            ) : gen.areas.length === 0 ? (
              'Framework approved — generate the applicable work areas.'
            ) : (
              <>
                {gen.activeCount} applicable work area(s)
                {gen.generatedFromVersion ? ` · from framework v${gen.generatedFromVersion}` : ''}
              </>
            )}
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => generate.mutate(gen.workflowInstanceId)}
            disabled={generate.isPending || !gen.frameworkApproved}
            title={!gen.frameworkApproved ? 'The framework must be approved first' : undefined}
          >
            <Wand2 className="mr-1.5 h-4 w-4" />
            {gen.areas.length === 0 ? 'Generate work' : 'Regenerate'}
          </Button>
        )}
      </Card>

      {gen.frameworkApproved && gen.areas.length === 0 && (
        <Card className="p-5">
          <EmptyState>No work areas generated yet.</EmptyState>
        </Card>
      )}

      {active.map((a) => (
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

function WorkAreaCard({ area, onOpen }: { area: AuditWorkArea; onOpen?: () => void }): JSX.Element {
  const body = (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-ink">{area.title}</p>
        {area.scope && <p className="mt-0.5 text-xs text-ink-muted">{area.scope}</p>}
      </div>
      <div className="flex items-center gap-2">
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
