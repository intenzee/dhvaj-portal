import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from './api';
import type { ComplianceRow } from './types';

/** Shared query descriptor so panels reusing open-compliance data hit the cache once. */
export const openComplianceQuery = {
  queryKey: ['compliance', 'open', 'dashboard'] as const,
  queryFn: () => apiFetch<Paginated<ComplianceRow>>('/compliance?status=open&limit=100'),
};
