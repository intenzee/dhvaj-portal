/**
 * CM-9 · the data check: clients added before the CM-1 to CM-8 rules that
 * break them, each with the fix the portal proposes. Safe fixes apply in bulk
 * after a person has looked at them (decision D10).
 */

export const DATA_CHECKS = [
  'gstin_other_pan',
  'gstin_invalid',
  'state',
  'address_state',
  'firm_type',
  'company_name',
  'offices',
  'fee_period',
  'client_without_team',
  'team_without_partner',
] as const;
export type DataCheck = (typeof DATA_CHECKS)[number];

export interface DataCheckMeta {
  label: string;
  /** One line: why a row is listed. */
  reason: string;
  /** "Apply selected" is offered (the fix is safe in bulk). */
  bulk: boolean;
  /** The apply button's words, e.g. "Use the GSTIN's state". */
  applyLabel?: string;
  /** A second bulk action that keeps what is there on purpose. */
  keepLabel?: string;
}

export const DATA_CHECK_META: Record<DataCheck, DataCheckMeta> = {
  gstin_other_pan: {
    label: 'GSTIN of another PAN',
    reason: "Characters 3–12 of a GSTIN are its holder's PAN; these GSTINs carry a different PAN.",
    bulk: false,
  },
  gstin_invalid: {
    label: 'GSTIN with a wrong check digit',
    reason: 'The last character does not match the other 14: the GSTIN was mistyped.',
    bulk: false,
  },
  state: {
    label: 'State unreadable or not the GSTIN’s',
    reason:
      'The state is not a GST state, or differs from the GSTIN’s first two digits and nobody confirmed it.',
    bulk: true,
    applyLabel: 'Use the GSTIN’s state',
  },
  address_state: {
    label: 'Address state unreadable',
    reason: 'The address’s state could not be read as a GST state.',
    bulk: false,
  },
  firm_type: {
    label: 'Firm type differs from the PAN',
    reason: 'Set before the PAN rules, and the PAN’s 4th letter says another type.',
    bulk: true,
    applyLabel: 'Apply the PAN type',
    keepLabel: 'Keep as it is',
  },
  company_name: {
    label: 'Company name without company wording',
    reason: 'A private limited company whose name does not say Private Limited.',
    bulk: true,
    applyLabel: 'Add “Private Limited”',
  },
  offices: {
    label: 'Offices to combine',
    reason: 'Clients that look like offices of one business.',
    bulk: false,
  },
  fee_period: {
    label: 'Fee period not confirmed',
    reason:
      'A fee typed before fees had a period; it is billed per year until someone confirms it.',
    bulk: true,
    applyLabel: 'Confirm per year',
  },
  client_without_team: {
    label: 'Client without a team',
    reason: 'No client team looks after this client.',
    bulk: true,
    applyLabel: 'Assign team',
  },
  team_without_partner: {
    label: 'Team without an overseeing partner',
    reason: 'Every team needs one partner who oversees it.',
    bulk: false,
  },
};

export interface DataCheckCount {
  check: DataCheck;
  count: number;
}

export interface DataCheckRow {
  /** Unique per row: a client may have several GSTINs listed. */
  id: string;
  /** The client the row belongs to (what apply takes); null for team rows. */
  entityId: string | null;
  code: string | null;
  name: string;
  /** What is wrong, in a sentence. */
  problem: string;
  current: string | null;
  proposed: string | null;
  /** The page to fix it by hand. */
  href: string;
  /** Bulk apply may fix this row. */
  canApply: boolean;
}

export interface ApplyDataCheckInput {
  entityIds: string[];
  /** firm_type: 'keep' records the current type as set by hand. */
  action?: 'apply' | 'keep';
  /** client_without_team: the team to assign. */
  teamId?: string;
}

export interface DataCheckApplyResult {
  entityId: string;
  ok: boolean;
  /** Why it was not fixed, or what changed. */
  message: string;
}

export const DATA_CHECK_PAGE_SIZE = 50;
