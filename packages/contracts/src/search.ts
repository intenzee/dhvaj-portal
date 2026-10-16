import type { WorkItemRef } from './work-links';

/**
 * Staff Workflow WF-304 — Ctrl K search across clients, engagements, filings,
 * tasks, documents and notices (GET /search?q=; notices by reference number,
 * client or form — PS-102, when ff_notices is on). The query understands forms and
 * months: "bharat gstr1 sep" is the client "bharat", the form GSTR-1 and
 * period 2026-09 (the current financial year unless a year is given).
 * Behind ff_filing_runs.
 */

export const SEARCH_GROUP = {
  clients: 'clients',
  engagements: 'engagements',
  filings: 'filings',
  tasks: 'tasks',
  documents: 'documents',
  notices: 'notices',
} as const;
export type SearchGroup = (typeof SEARCH_GROUP)[keyof typeof SEARCH_GROUP];

export const SEARCH_GROUP_LABEL: Record<SearchGroup, string> = {
  clients: 'Clients',
  engagements: 'Engagements',
  filings: 'Filings',
  tasks: 'Tasks',
  documents: 'Documents',
  notices: 'Notices',
};

export interface SearchHit {
  group: SearchGroup;
  id: string;
  title: string;
  subtitle: string;
  /** Where the hit opens (`workItemHref(link)`, or the client's page). */
  href: string;
  /** The work it points at; null for a client. */
  link: WorkItemRef | null;
}

/** What the query was read as — shown under the box ("GSTR-1 · Sep 2026"). */
export interface SearchUnderstood {
  /** Words matched against names, codes and titles. */
  text: string[];
  /** Normalised form tokens (`gstr1`, `gstr3b`, `24q`, `mgt7`). */
  forms: string[];
  /** A period key (`2026-09`, `2026-27:Q2`) or a financial year (`2026-27`). */
  period: string | null;
  periodLabel: string | null;
}

/** GET /search — non-empty groups in display order (filings first when a form is named). */
export interface SearchResponse {
  q: string;
  understood: SearchUnderstood;
  groups: { group: SearchGroup; items: SearchHit[] }[];
}
