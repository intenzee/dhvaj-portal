'use client';

import { useQuery } from '@tanstack/react-query';
import { RELAXED_FIRM_CHECKS, type FirmChecks, type WorkflowSettings } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';

/** The query the workflow policy and the firm's checks share. */
export const WORKFLOW_SETTINGS_KEY = ['workflow-settings'] as const;

export const fetchWorkflowSettings = (): Promise<WorkflowSettings> =>
  apiFetch<WorkflowSettings>('/workflow-settings');

/**
 * The firm's checks (Admin → Checks), to show or hide what a check governs.
 * Until they load — or for a role that cannot read them — every check reads
 * off, the firm's starting point; the API enforces the checks regardless.
 */
export function useFirmChecks(): FirmChecks {
  const settings = useQuery({
    queryKey: WORKFLOW_SETTINGS_KEY,
    queryFn: fetchWorkflowSettings,
    staleTime: 60_000,
  });
  return settings.data?.checks ?? RELAXED_FIRM_CHECKS;
}
