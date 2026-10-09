'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcceptanceFilesView } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Section 01 file slots (consent certificate, communication to the previous
 * auditor, engagement letter, evidence …). One query per audit file, shared by
 * every file card, the 01.7 engagement-letter section and 01.8's readiness.
 */
export const acceptanceFilesKey = (engagementId: string, workflowInstanceId: string) => [
  'engagement',
  engagementId,
  'statutory-audit-acceptance-files',
  workflowInstanceId,
];

export const acceptanceSignoffKey = (engagementId: string, workflowInstanceId: string) => [
  'engagement',
  engagementId,
  'statutory-audit-acceptance-signoff',
  workflowInstanceId,
];

export const acceptanceFilesBase = (engagementId: string, workflowInstanceId: string): string =>
  `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/acceptance/files`;

export function useAcceptanceFiles(engagementId: string, workflowInstanceId: string) {
  return useQuery({
    queryKey: acceptanceFilesKey(engagementId, workflowInstanceId),
    queryFn: () => apiFetch<AcceptanceFilesView>(acceptanceFilesBase(engagementId, workflowInstanceId)),
  });
}

/**
 * After a file write: take the view the API returned, and refresh what derives
 * from file statuses (segment states, 01.8 readiness, the documents list).
 */
export function useAcceptanceFilesRefresh(engagementId: string, workflowInstanceId: string) {
  const qc = useQueryClient();
  return (view?: AcceptanceFilesView): void => {
    if (view) qc.setQueryData(acceptanceFilesKey(engagementId, workflowInstanceId), view);
    else void qc.invalidateQueries({ queryKey: acceptanceFilesKey(engagementId, workflowInstanceId) });
    void qc.invalidateQueries({ queryKey: acceptanceSignoffKey(engagementId, workflowInstanceId) });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'statutory-audit-acceptance'] });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'documents'] });
  };
}
