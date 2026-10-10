'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, RefreshCw } from 'lucide-react';
import {
  PERMISSION,
  type StatutoryAuditCaro,
  type StatutoryAuditCaroMasterFillResult,
  type StatutoryAuditConsolidation,
  type StatutoryAuditConsolidationMasterFillResult,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Select } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { CaroEvidence } from './caro-evidence';
import { CaroProgramme } from './caro-programme';
import { CaroWorkspace, CARO_OUTCOME_LABEL } from './caro-workspace';
import { ConsolidationBranchAuditors } from './consolidation-branch-auditors';
import { ConsolidationEvidence } from './consolidation-evidence';
import { ConsolidationOtherAuditors } from './consolidation-other-auditors';
import { ConsolidationWorkProgramme } from './consolidation-work-programme';
import { ConsolidationWorkspace } from './consolidation-workspace';
import { MasterFactList } from './master-fact-list';

/**
 * 02.4 CARO and 02.6 consolidation facts, filled from the client master (Guide
 * §1): the group structure, listing, branches and the audit year's figures are
 * shown with their source, so the team confirms instead of typing. The 02.4
 * CARO 2020 workspace (exemption tests, measurement data, CARO-06, work
 * programme) opens inline under the summary; the 02.6 question the master cannot
 * answer — whether a parent files compliant CFS — is asked here.
 */

const caroQk = (id: string) => ['engagement', id, 'statutory-audit-caro'];
const cfsQk = (id: string) => ['engagement', id, 'statutory-audit-consolidation'];

export function GroupCaroCard({ engagementId }: { engagementId: string }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const caroQ = useQuery({
    queryKey: caroQk(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditCaro[]>(`/engagements/${engagementId}/statutory-audit/caro`),
  });
  const cfsQ = useQuery({
    queryKey: cfsQk(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditConsolidation[]>(
        `/engagements/${engagementId}/statutory-audit/consolidation`,
      ),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: caroQk(engagementId) });
    void qc.invalidateQueries({ queryKey: cfsQk(engagementId) });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };
  const fail = (e: unknown, what: string) =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`);

  const caro = caroQ.data?.[0];
  const cfs = cfsQ.data?.[0];
  const wf = caro?.workflowInstanceId ?? cfs?.workflowInstanceId;

  const fill = useMutation({
    mutationFn: async () => {
      const base = `/engagements/${engagementId}/statutory-audit/${wf}`;
      const a = await apiFetch<StatutoryAuditCaroMasterFillResult>(
        `${base}/caro/fill-from-master`,
        {
          method: 'POST',
          body: {},
        },
      );
      const b = await apiFetch<StatutoryAuditConsolidationMasterFillResult>(
        `${base}/consolidation/fill-from-master`,
        { method: 'POST', body: {} },
      );
      return [...a.filled, ...b.filled];
    },
    onSuccess: (filled) => {
      toast(
        filled.length
          ? `Filled from the client master: ${filled.join(', ')}.`
          : 'Nothing new on the client master — your entries are unchanged.',
      );
      refresh();
    },
    onError: (e) => fail(e, 'fill from the client master'),
  });

  const [caroOpen, setCaroOpen] = useState(false);
  const [cfsOpen, setCfsOpen] = useState(false);

  const saveParentCfs = useMutation({
    mutationFn: (value: boolean | null) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/${wf}/consolidation/facts`, {
        method: 'POST',
        body: { parentFilesCompliantCfs: value, version: cfs!.assessment.version },
      }),
    onSuccess: () => {
      toast('Saved.');
      refresh();
    },
    onError: (e) => fail(e, 'save'),
  });

  if (!caro && !cfs) return null;
  const decided = (s?: string) =>
    s === 'applicable' || s === 'not_applicable' || s === 'overridden' || s === 'approved';
  const editable = canManage && !!wf;
  const hasParent =
    !!cfs &&
    (cfs.capturedFacts.isWhollyOwnedSubsidiary || cfs.capturedFacts.isPartiallyOwnedSubsidiary);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Network className="h-4 w-4 text-ink-faint" aria-hidden />
          CARO &amp; group facts · 02.4 / 02.6
        </h3>
        {editable && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fill.mutate()}
            disabled={fill.isPending}
            title="Fill blank facts from the client master; never overwrites your entries"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Fill from client master
          </Button>
        )}
      </div>

      {caro && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">CARO 2020</span>
            {caro.assessment.systemOutcome && (
              <Badge tone="info">
                System:{' '}
                {CARO_OUTCOME_LABEL[
                  caro.assessment.systemOutcome as keyof typeof CARO_OUTCOME_LABEL
                ] ?? humanize(caro.assessment.systemOutcome)}
              </Badge>
            )}
            {decided(caro.assessment.state) && caro.assessment.conclusion && (
              <Badge tone="success">
                Concluded:{' '}
                {CARO_OUTCOME_LABEL[
                  caro.assessment.conclusion as keyof typeof CARO_OUTCOME_LABEL
                ] ?? humanize(caro.assessment.conclusion)}
              </Badge>
            )}
            {caro.completion?.complete && <Badge tone="success">02.4 COMPLETE</Badge>}
            {caro.assessment.needsReevaluation && (
              <Badge tone="warn">02.4 needs re-evaluation</Badge>
            )}
          </div>
          <Facts facts={caro.masterFacts} />
          {caro.assessment.systemBasis && (
            <p className="text-xs text-ink-muted">{caro.assessment.systemBasis}</p>
          )}
          <button
            type="button"
            aria-expanded={caroOpen}
            onClick={() => setCaroOpen((o) => !o)}
            className="group flex items-center gap-2.5 text-left text-sm font-medium text-ink"
          >
            <ExpandToggle open={caroOpen} />
            {caroOpen ? 'Hide the 02.4 CARO workspace' : 'Open the 02.4 CARO workspace'}
          </button>
          {caroOpen && (
            <CaroWorkspace
              engagementId={engagementId}
              caro={caro}
              canManage={canManage}
              programme={
                <CaroProgramme
                  engagementId={engagementId}
                  workflowInstanceId={caro.workflowInstanceId}
                  canManage={canManage}
                />
              }
              evidence={
                <CaroEvidence
                  engagementId={engagementId}
                  workflowInstanceId={caro.workflowInstanceId}
                  canManage={canManage}
                />
              }
            />
          )}
        </section>
      )}

      {cfs && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">Consolidation</span>
            {cfs.assessment.systemOutcome && (
              <Badge tone="info">Suggested: {humanize(cfs.assessment.systemOutcome)}</Badge>
            )}
            {decided(cfs.assessment.state) && cfs.assessment.conclusion && (
              <Badge tone="success">Concluded: {humanize(cfs.assessment.conclusion)}</Badge>
            )}
            {cfs.completion?.complete && <Badge tone="success">02.6 COMPLETE</Badge>}
            {cfs.assessment.needsReevaluation && (
              <Badge tone="warn">02.6 needs re-evaluation</Badge>
            )}
            {cfs.partnerApproval?.required && !cfs.partnerApproval.approvedAt && (
              <Badge tone="warn">Partner approval pending</Badge>
            )}
          </div>
          <Facts facts={cfs.masterFacts} />
          {cfs.assessment.systemBasis && (
            <p className="text-xs text-ink-muted">{cfs.assessment.systemBasis}</p>
          )}
          {editable && hasParent && !decided(cfs.assessment.state) && (
            <Field
              label="Does a parent file Companies-Act-compliant CFS? (Rule 6)"
              hint="The client master cannot answer this one."
            >
              <Select
                value={
                  cfs.capturedFacts.parentFilesCompliantCfs == null
                    ? ''
                    : String(cfs.capturedFacts.parentFilesCompliantCfs)
                }
                onChange={(e) =>
                  saveParentCfs.mutate(e.target.value === '' ? null : e.target.value === 'true')
                }
                disabled={saveParentCfs.isPending}
              >
                <option value="">Not known yet</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            </Field>
          )}
          <button
            type="button"
            aria-expanded={cfsOpen}
            onClick={() => setCfsOpen((o) => !o)}
            className="group flex items-center gap-2.5 text-left text-sm font-medium text-ink"
          >
            <ExpandToggle open={cfsOpen} />
            {cfsOpen
              ? 'Hide the 02.6 Consolidation workspace'
              : 'Open the 02.6 Consolidation workspace'}
          </button>
          {cfsOpen && (
            <ConsolidationWorkspace
              engagementId={engagementId}
              consolidation={cfs}
              canManage={canManage}
              otherAuditors={
                <ConsolidationOtherAuditors
                  engagementId={engagementId}
                  workflowInstanceId={cfs.workflowInstanceId}
                  canManage={canManage}
                />
              }
              branchAuditors={
                <ConsolidationBranchAuditors
                  engagementId={engagementId}
                  workflowInstanceId={cfs.workflowInstanceId}
                  canManage={canManage}
                />
              }
              workProgramme={
                <ConsolidationWorkProgramme
                  engagementId={engagementId}
                  workflowInstanceId={cfs.workflowInstanceId}
                />
              }
              evidence={
                <ConsolidationEvidence
                  engagementId={engagementId}
                  consolidation={cfs}
                  readOnly={!canManage || !!cfs.approved}
                />
              }
            />
          )}
        </section>
      )}
    </Card>
  );
}

/** The shared fact list (with fix links), kept under its old name for the sibling cards. */
export const Facts = MasterFactList;
