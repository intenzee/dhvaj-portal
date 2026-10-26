/**
 * One client, several offices (CM-6). A legal entity (one PAN) is one
 * client; each GST registration of it is an office, a tab on Client 360.
 */

export interface ClientBranch {
  id: string;
  label: string;
  /** GST state code ('07'), or null for an office without a GSTIN. */
  stateCode: string | null;
  isHeadOffice: boolean;
  archivedAt: string | null;
  version: number;
}

/** A client in an "Offices to combine" card. */
export interface BranchCandidateClient {
  id: string;
  entityCode: string;
  legalName: string;
  pan: string | null;
  officeCode: string;
  /** Open engagements, unpaid invoices and logins that move with it. */
  counts: {
    registrations: number;
    logins: number;
    openEngagements: number;
    unpaidInvoices: number;
  };
}

/** An office the card proposes: one per active GSTIN. */
export interface BranchCandidateOffice {
  registrationId: string;
  gstin: string;
  stateCode: string | null;
  /** The client the GSTIN is on today. */
  entityId: string;
  label: string;
  isHeadOffice: boolean;
}

export type BranchCandidateKind =
  /** Two or more clients of one PAN: combine into one client with offices. */
  | 'combine'
  /** One client with two or more GSTINs and no offices yet. */
  | 'setup';

export interface BranchCandidate {
  kind: BranchCandidateKind;
  pan: string;
  /** The proposed keeper first. */
  clients: BranchCandidateClient[];
  keepId: string;
  /** The kept client's name without the place, with "Private Limited" for a company. */
  proposedName: string;
  offices: BranchCandidateOffice[];
  reasons: string[];
}

export interface CombineBranchesInput {
  /** The clients merged into the kept one (none for a 'setup' card). */
  others: { entityId: string }[];
  offices: { registrationId: string; label: string; isHeadOffice: boolean }[];
  legalName?: string;
}

export interface AddBranchInput {
  label: string;
  stateCode?: string | null;
  /** An existing registration of the client to put under this office. */
  registrationId?: string | null;
  isHeadOffice?: boolean;
}

export interface UpdateBranchInput {
  label?: string;
  isHeadOffice?: boolean;
  /** true closes the office (its tab hides), false reopens it. */
  archived?: boolean;
  version?: number;
}

/** "Delhi office" from a GSTIN's state, or the place in a client's name. */
export function officeLabel(place: string | null, stateName: string | null): string {
  const p = (place ?? '').trim();
  if (p) return /office|branch|unit|plant|factory|godown|warehouse/i.test(p) ? p : `${p} office`;
  return stateName ? `${stateName} office` : 'Office';
}
