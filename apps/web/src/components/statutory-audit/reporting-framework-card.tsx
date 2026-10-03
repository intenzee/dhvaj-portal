'use client';

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
import { Facts } from './group-caro-card';

/**
 * 02.2 Applicable financial reporting framework facts (Guide §1): SME-exchange
 * listing, Ind AS in a prior year and the Rule 4 group trigger are read off the
 * client master and earlier audit files and shown with their source. The team
 * is asked only whether the company voluntarily adopts Ind AS this year. The
 * 02.3 Schedule III Division routed from it is shown alongside (provisional until
 * 02.2 is concluded).
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

  const setVoluntary = useMutation({
    mutationFn: (voluntaryIndAs: boolean) =>
      apiFetch(`${base}/financial-reporting/facts`, {
        method: 'POST',
        body: { voluntaryIndAs, version: fr!.assessment.version },
      }),
    onSuccess: () => {
      toast('Saved.');
      refresh();
    },
    onError: (e) => fail(e, 'save'),
  });

  if (!fr) return null;
  const editable = canManage && !decided(fr.assessment.state);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <BookOpen className="h-4 w-4 text-ink-faint" aria-hidden />
          Reporting framework &amp; Schedule III · 02.2 / 02.3
        </h3>
        <div className="flex flex-wrap items-center gap-2">
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
      {editable && (
        <label className="inline-flex items-center gap-1.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={fr.capturedFacts.voluntaryIndAs}
            disabled={setVoluntary.isPending}
            onChange={(e) => setVoluntary.mutate(e.target.checked)}
          />
          The company voluntarily adopts Ind AS this year
        </label>
      )}
    </Card>
  );
}
