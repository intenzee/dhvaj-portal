/**
 * Merging two clients that are one legal entity ("3Aces Technologies - Firm"
 * and "3Aces Technologies Private Limited", same PAN). The API decides from
 * the tax IDs and the names; the web shows its verdict in a popup and lets a
 * person choose which client to keep and which values to carry over.
 */

/**
 * - `same`: they share a PAN, GSTIN, TAN or CIN — one legal entity.
 * - `probable`: the names agree once legal form, place and typos are set aside.
 * - `possible`: one name is the start of the other — worth a look.
 * - `different`: different PANs, legal forms that cannot be one, or unrelated names.
 */
export type ClientVerdict = 'same' | 'probable' | 'possible' | 'different';

/** One side of a merge, as the popup shows it. */
export interface MergeClientSide {
  id: string;
  entityCode: string;
  legalName: string;
  pan: string | null;
  typeName: string;
  officeCode: string;
  status: string;
  gstins: string[];
  /** What it holds, by kind: engagements, registrations, contacts, logins, invoices… */
  counts: Record<string, number>;
}

/** A field the two clients disagree on; the keeper's value wins unless `take` names it. */
export interface MergeFieldChoice {
  /** The API's column key, sent back in MergeClientsRequest.take. */
  field: MergeTakeField;
  label: string;
  keep: string | null;
  drop: string | null;
}

export const MERGE_TAKE_FIELDS = [
  'legal_name',
  'display_name',
  'trade_name',
  'short_name',
  'entity_type_id',
  'incorporation_date',
  'legal_status',
  'home_office_id',
] as const;
export type MergeTakeField = (typeof MERGE_TAKE_FIELDS)[number];

/** What will happen to one engagement of the archived client. */
export interface MergeEngagementPlan {
  id: string;
  code: string;
  kind: string;
  label: string;
  status: string;
  /** `move`: to the kept client; `fold`: its filings join the kept client's Compliance engagement; `stay`: stays on the archived client. */
  action: 'move' | 'fold' | 'stay';
  reason: string | null;
}

/** GET /entities/:keepId/merge-preview?with=:dropId */
export interface MergePreview {
  keep: MergeClientSide;
  drop: MergeClientSide;
  verdict: ClientVerdict;
  /** Why, deciding reason first. */
  reasons: string[];
  /** Which of the two the API suggests keeping (more history, a PAN, the fuller name). */
  recommendedKeepId: string;
  fields: MergeFieldChoice[];
  engagements: MergeEngagementPlan[];
  /** Things to know before merging (billing moves, a filing already on the keeper…). */
  warnings: string[];
  /** Why it cannot be merged at all (different PANs). Empty when it can. */
  blockers: string[];
}

/** POST /entities/:keepId/merge */
export interface MergeClientsRequest {
  dropId: string;
  /** Fields to take from the archived client instead of the kept one. */
  take?: MergeTakeField[];
}

export interface MergeClientsResult {
  keptId: string;
  keptCode: string;
  archivedId: string;
  archivedCode: string;
  movedEngagements: number;
  /** The Compliance engagement folded into the kept one, if both had one. */
  folded: {
    from: string;
    into: string;
    filings: number;
    tasks: number;
    filingsLeft: number;
  } | null;
  counts: Record<string, number>;
  /** What stayed on the archived client, and why. */
  stayed: { kind: string; code?: string; count?: number; reason: string }[];
}

/** A pair the API thinks may be one client. GET /entities/duplicates */
export interface DuplicatePair {
  a: { id: string; entityCode: string; legalName: string; pan: string | null; officeCode: string };
  b: { id: string; entityCode: string; legalName: string; pan: string | null; officeCode: string };
  verdict: Exclude<ClientVerdict, 'different'>;
  reasons: string[];
}

/** POST /entities/duplicates/dismiss: "these two are not the same client". */
export interface DismissDuplicateRequest {
  aId: string;
  bId: string;
  note?: string;
}

/**
 * The body of a 409 when a PAN / GSTIN / TAN / CIN is already on another
 * client: `code: 'duplicate_client'`, so the web can offer the merge popup.
 */
export interface DuplicateClientConflict {
  code: 'duplicate_client';
  message: string;
  /** The client asked about (the one being edited, or null when creating). */
  entityId: string | null;
  holder: { id: string; entityCode: string; legalName: string; visible: boolean };
  identifier: { type: string; value: string };
}

/** On an archived client's detail: where it went. */
export interface MergedInto {
  id: string;
  entityCode: string;
  legalName: string;
  mergedAt: string;
}
