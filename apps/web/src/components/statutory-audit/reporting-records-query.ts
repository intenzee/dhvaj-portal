'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StatutoryAuditReportingRecords } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';

/**
 * The 02.7 Track B records (Fraud Matters, §164(2) directors, cross-references,
 * per-card evidence) — one query shared by every panel that shows them, so a
 * change in one (an evidence link on a director) updates the others in place.
 */
export function reportingRecordsKey(engagementId: string, workflowInstanceId: string) {
  return ['engagement', engagementId, 'reporting-records', workflowInstanceId] as const;
}

export type RecordsAct = (
  fn: (base: string) => Promise<StatutoryAuditReportingRecords>,
  ok?: string,
) => Promise<boolean>;

export function useReportingRecords(
  engagementId: string,
  workflowInstanceId: string,
): {
  q: ReturnType<typeof useQuery<StatutoryAuditReportingRecords>>;
  base: string;
  busy: boolean;
  act: RecordsAct;
} {
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/reporting-records`;
  const key = reportingRecordsKey(engagementId, workflowInstanceId);
  const q = useQuery<StatutoryAuditReportingRecords>({
    queryKey: key,
    queryFn: () => apiFetch<StatutoryAuditReportingRecords>(base),
  });
  const [busy, setBusy] = useState(false);
  const act: RecordsAct = async (fn, ok) => {
    setBusy(true);
    try {
      qc.setQueryData(key, await fn(base));
      // The 02.7 cards show the fraud / director status and evidence counts.
      void qc.invalidateQueries({
        queryKey: ['engagement', engagementId, 'statutory-audit-other-reporting'],
      });
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save the change.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { q, base, busy, act };
}

/** Empty strings back to null for the API. */
export const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);
