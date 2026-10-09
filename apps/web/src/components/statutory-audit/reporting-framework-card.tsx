'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, RefreshCw } from 'lucide-react';
import {
  PERMISSION,
  type StatutoryAuditFinancialReporting,
  type StatutoryAuditFinancialReportingMasterFillResult,
  type StatutoryAuditScheduleIii,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';
import { ExpandToggle } from '@/components/inline-panel';
import { Facts } from './group-caro-card';
import { FinancialReportingWorkspace } from './financial-reporting-workspace';

/**
 * 02.2 Applicable financial reporting framework (Guide §1, Section 02.2 spec):
 * the header shows the completion status, the current conclusion and the
 * system suggestion, with the client-master facts and the 02.3 Schedule III
 * Division routed from it (provisional until 02.2 is concluded). The full
 * 02.2 workspace — framework tests, SMC, FRF-01..06, Partner approval and the
 * completion checklist — opens in place under the header (+/−).
 */

const qk = (id: string) => ['engagement', id, 'statutory-audit-financial-reporting'];
const decided = (s?: string) =>
  s === 'applicable' || s === 'not_applicable' || s === 'overridden' || s === 'approved';

export function ReportingFrameworkCard({
  engagementId,
}: {
  engagementId: string;
}): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const query = useQuery({
    queryKey: qk(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditFinancialReporting[]>(
        `/engagements/${engagementId}/statutory-audit/financial-reporting`,
      ),
  });
  const sch = useQuery({
    queryKey: ['engagement', engagementId, 'statutory-audit-schedule-iii'],
    queryFn: () =>
      apiFetch<StatutoryAuditScheduleIii[]>(
        `/engagements/${engagementId}/statutory-audit/schedule-iii`,
      ),
  }).data?.[0];
  const fr = query.data?.[0];
  const base = `/engagements/${engagementId}/statutory-audit/${fr?.workflowInstanceId}`;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  const fail = (e: unknown, what: string) =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`);

  const fill = useMutation({
    mutationFn: () =>
      apiFetch<StatutoryAuditFinancialReportingMasterFillResult>(
        `${base}/financial-reporting/fill-from-master`,
        { method: 'POST', body: {} },
      ),
    onSuccess: (res) => {
      toast(
        res.filled.length
          ? `Filled from the portal: ${res.filled.join(', ')}.`
          : 'Nothing new on the portal — your entries are unchanged.',
      );
      refresh();
    },
    onError: (e) => fail(e, 'fill from the client master'),
  });

  const [open, setOpen] = useState(false);

  if (!fr) return null;
  const approved = fr.approved ?? fr.assessment.state === 'approved';
  const editable = canManage && !approved;
  const status = approved
    ? 'Approved'
    : fr.completion?.complete
      ? '02.2 COMPLETE'
      : decided(fr.assessment.state)
        ? 'Concluded — checklist open'
        : 'In progress';

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <BookOpen className="h-4 w-4 text-ink-faint" aria-hidden />
          Reporting framework &amp; Schedule III · 02.2 / 02.3
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={approved || fr.completion?.complete ? 'success' : 'warn'}>{status}</Badge>
          {decided(fr.assessment.state) && fr.assessment.conclusion && (
            <Badge tone="neutral">Concluded: {humanize(fr.assessment.conclusion)}</Badge>
          )}
          {fr.blockingReviewOpen && <Badge tone="danger">Framework Review open</Badge>}
          {fr.assessment.systemOutcome && (
            <Badge tone="info">Suggested: {humanize(fr.assessment.systemOutcome)}</Badge>
          )}
          {editable && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fill.mutate()}
              disabled={fill.isPending}
              title="Fill blank facts from the portal; never overwrites your entries"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Fill from client master
            </Button>
          )}
        </div>
      </div>
      <Facts facts={fr.masterFacts} />
      {sch?.assessment.systemOutcome && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <Badge tone="info">
            02.3 Schedule III: {humanize(sch.assessment.systemOutcome)}
            {sch.upstreamReady ? '' : ' (provisional)'}
          </Badge>
          {sch.detail?.cashFlowRequired === false && sch.detail.cashFlowExemptionReason && (
            <span>Cash-flow statement not required — {sch.detail.cashFlowExemptionReason}</span>
          )}
        </p>
      )}
      {fr.assessment.systemBasis && (
        <p className="text-xs text-ink-muted">{fr.assessment.systemBasis}</p>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex items-center gap-2.5 text-left text-sm font-medium text-ink"
      >
        <ExpandToggle open={open} />
        {open ? 'Hide the 02.2 workspace' : 'Open the 02.2 workspace'}
      </button>
      {open && (
        <FinancialReportingWorkspace engagementId={engagementId} fr={fr} canManage={canManage} />
      )}
    </Card>
  );
}
