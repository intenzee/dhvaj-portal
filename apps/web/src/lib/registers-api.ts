/**
 * The firm's registers (Practice Services PS-304 UDIN, PS-305 DSC): the API
 * calls in one place.
 */
import type {
  CreateUdinInput,
  RevokeUdinInput,
  UdinDocumentKind,
  UdinEntry,
  UdinListResponse,
  UdinPartnerOption,
  UdinPendingResponse,
  UdinStatus,
} from '@hsdg/contracts';
import { apiFetch } from './api';

export const udinKey = ['registers', 'udin'] as const;

export interface UdinFilters {
  search: string;
  documentKind: UdinDocumentKind | '';
  status: UdinStatus | '';
  financialYear: string;
  /** One entry, from a work link (?u=). */
  id: string;
}

/** The list path for these filters (empty ones left out). Pure — tested. */
export function udinListPath(f: UdinFilters, base = '/registers/udin'): string {
  const p = new URLSearchParams();
  if (f.id) p.set('id', f.id);
  if (f.search.trim()) p.set('search', f.search.trim());
  if (f.documentKind) p.set('documentKind', f.documentKind);
  if (f.status) p.set('status', f.status);
  if (f.financialYear) p.set('financialYear', f.financialYear);
  p.set('limit', '200');
  return `${base}?${p.toString()}`;
}

export const fetchUdins = (f: UdinFilters) => apiFetch<UdinListResponse>(udinListPath(f));
export const fetchUdinPending = (view: 'all' | 'overdue') =>
  apiFetch<UdinPendingResponse>(`/registers/udin/pending?view=${view}&limit=200`);
export const fetchUdinPartners = () => apiFetch<UdinPartnerOption[]>('/registers/udin/partners');
export const createUdin = (body: CreateUdinInput) =>
  apiFetch<UdinEntry>('/registers/udin', { method: 'POST', body });
export const revokeUdin = (id: string, body: RevokeUdinInput) =>
  apiFetch<UdinEntry>(`/registers/udin/${id}/revoke`, { method: 'POST', body });
