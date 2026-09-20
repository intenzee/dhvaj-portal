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
  createdAt: string;
  updatedAt: string;
}
