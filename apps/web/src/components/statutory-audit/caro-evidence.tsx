'use client';

import { useQuery } from '@tanstack/react-query';
import { type StatutoryAuditCaro } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { Spinner } from '@/components/ui';
import { FrameworkEvidence } from './framework-evidence';

/**
 * 02.4 Evidence / Technical Assessment (DHVAJ 02.4 spec §16). Routine CARO
 * applicability is documented by the structured assessment itself; the CARO
 * Applicability Memo is suggested only for complexity, an override, an
 * unusual interpretation or consultation (or created on demand). Add File /
 * Link Existing File / Open / Version History run through the shared Section 02
 * evidence plumbing, SharePoint-backed; an approved Section 02 is read-only
 * until reopened through its workflow.
 */
export function CaroEvidence({
  engagementId,
  workflowInstanceId,
  canManage,
}: {
  engagementId: string;
  workflowInstanceId: string;
  canManage: boolean;
}): JSX.Element {
  const q = useQuery({
    queryKey: ['engagement', engagementId, 'caro'],
    queryFn: () =>
      apiFetch<StatutoryAuditCaro[]>(`/engagements/${engagementId}/statutory-audit/caro`),
  });
  if (q.isLoading) return <Spinner label="Loading evidence…" />;
  const caro = q.data?.find((c) => c.workflowInstanceId === workflowInstanceId);
  if (q.isError || !caro) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Open 02.4 before adding evidence.'}
      </p>
    );
  }
  const a = caro.assessment;
  const memoSuggested =
    a.isOverridden ||
    a.systemOutcome === 'further_assessment' ||
    a.conclusion === 'further_assessment' ||
    a.systemOutcome === 'information_insufficient';
  return (
    <section className="space-y-1.5" aria-label="CARO evidence and memo">
      <h4 className="text-sm font-semibold text-ink">Evidence / Technical Assessment</h4>
      <FrameworkEvidence
        engagementId={engagementId}
        workflowInstanceId={workflowInstanceId}
        subAssessmentId={a.id}
        memoSuggested={memoSuggested}
        readOnly={!canManage}
      />
    </section>
  );
}
