/**
 * Authority / Provision Library (Implementation Guide §5).
 *
 * The single, versioned store of legal provisions, standards and guidance notes.
 * Every `View Provision / View Standard / View Guidance` action in the portal
 * resolves through here — no external URL is ever embedded in a UI component.
 *
 * References resolve BY ENGAGEMENT PERIOD: a historical engagement opens the
 * version of a provision that was in force in its audit period, never the
 * current one. Superseding a provision appends a new row and closes the old
 * one's `effectiveTo`; a provision is never mutated in place.
 */

/** The issuing authority for a provision, standard or guidance note. */
export const AUTHORITY_BODY = {
  mca: 'MCA',
  icai: 'ICAI',
  sebi: 'SEBI',
  rbi: 'RBI',
  irdai: 'IRDAI',
  other: 'other',
} as const;
export type AuthorityBody = (typeof AUTHORITY_BODY)[keyof typeof AUTHORITY_BODY];
export const AUTHORITY_BODIES: AuthorityBody[] = Object.values(AUTHORITY_BODY);

/**
 * One legal provision / standard / guidance note, effective-dated. Resolved by
 * `code` + the engagement's audit period. Firm-wide reference data owned by the
 * catalogue (methodology administration).
 */
export interface AuthorityProvisionRecord {
  id: string;
  /** Stable machine code, e.g. 'COS_ACT_2_85', 'CARO_2020', 'SA_600'. */
  code: string;
  authority: AuthorityBody;
  title: string;
  /** Human provision number, e.g. 'Section 2(85)', 'Rule 4', 'SA 600'. */
  provisionNumber: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Citation or in-portal source (never rendered as a raw external link in UI). */
  sourceReference: string | null;
  /** The row that supersedes this one, when closed. */
  supersededById: string | null;
  /** Optional methodology-bundle scope (e.g. 'v2026.1'). */
  methodologyVersionScope: string | null;
  /** Which `View …` action opens it: provision (Act/Rules), standard (SA) or guidance. */
  referenceKind: AuthorityReferenceKind;
  /** Plain-language summary shown in the in-portal viewer. */
  summary: string | null;
  /** The authoritative source (MCA / ICAI), opened from the viewer — never from a component. */
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The `View Provision / View Standard / View Guidance` family (spec 02.1 §3). */
export const AUTHORITY_REFERENCE_KIND = {
  provision: 'provision',
  standard: 'standard',
  guidance: 'guidance',
} as const;
export type AuthorityReferenceKind =
  (typeof AUTHORITY_REFERENCE_KIND)[keyof typeof AUTHORITY_REFERENCE_KIND];
export const AUTHORITY_REFERENCE_KINDS: AuthorityReferenceKind[] =
  Object.values(AUTHORITY_REFERENCE_KIND);

export const AUTHORITY_REFERENCE_ACTION: Record<AuthorityReferenceKind, string> = {
  provision: 'View Provision',
  standard: 'View Standard',
  guidance: 'View Guidance',
};

/**
 * One field → provision citation, resolved for an engagement period through the
 * central reference map (`authority_reference_link`). `provision` is null when
 * the library holds no version in force for the period — the UI says so rather
 * than guessing a link.
 */
export interface AuthorityReference {
  /** The workflow field the reference belongs to, e.g. `small_company`. */
  anchor: string;
  /** Portal label, e.g. 'View Section 2(85) - Small Company'. */
  label: string;
  code: string;
  provision: AuthorityProvisionRecord | null;
}

/** Methodology administration: maintain a provision's viewer content. */
export interface UpdateAuthorityProvisionInput {
  summary?: string | null;
  sourceUrl?: string | null;
}
