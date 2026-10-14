/**
 * ROC / MCA facts the API and the web both work out the same way
 * (docs/roc-mca-filing-spec.md §4, G12, P1-8, P2-4): the small-company test,
 * the XBRL / MGT-8 thresholds, and the late-fee estimate of a ROC form. Every
 * threshold and fee here is marked Verify in the spec (§9 V3, V4) until a
 * partner confirms it against the notification in force.
 */
import type { CinProfileAttributes } from './engagement-restructure';

const CRORE = 10_000_000;

/**
 * s.2(85) small company: paid-up capital and turnover both within the limits
 * (Companies (Specification of Definitions Details) Amendment Rules, 2025). A
 * public company, a holding or subsidiary company, or a s.8 company is never
 * small. Verify.
 */
export const SMALL_COMPANY_LIMITS = { paidUpCapital: 10 * CRORE, turnover: 100 * CRORE } as const;
/** AOC-4 in XBRL: listed, or paid-up ≥ ₹5 cr, or turnover ≥ ₹100 cr (XBRL Rules, 2015). Verify. */
export const XBRL_THRESHOLDS = { paidUpCapital: 5 * CRORE, turnover: 100 * CRORE } as const;
/** MGT-8 by a CS in practice: listed, or paid-up ≥ ₹10 cr, or turnover ≥ ₹50 cr (Rule 11(2)). Verify. */
export const MGT8_THRESHOLDS = { paidUpCapital: 10 * CRORE, turnover: 50 * CRORE } as const;

/** Whether a private company is small on its figures; 'unknown' when a figure is missing. */
export type SmallCompanyTest = 'small' | 'not_small' | 'unknown';

export function smallCompanyTest(input: {
  paidUpCapital: number | null | undefined;
  turnover: number | null | undefined;
  hasSubsidiaries?: boolean | null;
}): SmallCompanyTest {
  if (input.hasSubsidiaries === true) return 'not_small';
  const { paidUpCapital: cap, turnover } = input;
  const over =
    (typeof cap === 'number' && cap > SMALL_COMPANY_LIMITS.paidUpCapital) ||
    (typeof turnover === 'number' && turnover > SMALL_COMPANY_LIMITS.turnover);
  if (over) return 'not_small';
  if (typeof cap !== 'number' || typeof turnover !== 'number') return 'unknown';
  return 'small';
}

/** A threshold met on the figures, or null when they cannot tell. */
function meets(
  limits: { paidUpCapital: number; turnover: number },
  cap: number | null | undefined,
  turnover: number | null | undefined,
): boolean | null {
  if (typeof cap === 'number' && cap >= limits.paidUpCapital) return true;
  if (typeof turnover === 'number' && turnover >= limits.turnover) return true;
  if (typeof cap === 'number' && typeof turnover === 'number') return false;
  return null;
}

/** The company sub-type a client's entity type implies, before its CIN profile says otherwise. */
export function defaultCompanySubtype(entityTypeSlug: string | null | undefined): string {
  if (entityTypeSlug === 'opc') return 'opc';
  if (entityTypeSlug === 'public_limited') return 'unlisted_public';
  return 'private';
}

/** The CIN facts as the rules and checklists read them, with each default and where it came from. */
export interface CinFacts {
  /** null when nothing says (the client's entity type then decides). */
  companySubtype: CinProfileAttributes['companySubtype'] | null;
  /** The sub-type was worked out from paid-up capital and turnover (show Verify). */
  subtypeDerived: boolean;
  xbrlRequired: boolean;
  xbrlDerived: boolean;
  mgt8Required: boolean;
  mgt8Derived: boolean;
  hasSubsidiaries: boolean;
  csrApplicable: boolean;
  secretarialAuditRequired: boolean;
  paidUpCapital: number | null;
  authorisedCapital: number | null;
  turnover: number | null;
}

/**
 * Resolve a CIN profile: stated facts win; a missing sub-type defaults to
 * 'small' for a private company within the limits (G12), and XBRL / MGT-8
 * default from the thresholds when the figures are known. `entitySubtype` is
 * the sub-type the client's entity type implies ('private', 'opc', …).
 */
export function resolveCinFacts(
  attrs: CinProfileAttributes,
  entity: { subtype: string; turnover: number | null },
): CinFacts {
  const turnover = typeof attrs.turnover === 'number' ? attrs.turnover : entity.turnover;
  const cap = attrs.paidUpCapital ?? null;
  const listed = (attrs.companySubtype ?? entity.subtype) === 'listed';
  let companySubtype = attrs.companySubtype ?? null;
  let subtypeDerived = false;
  if (!companySubtype && entity.subtype === 'private') {
    const test = smallCompanyTest({
      paidUpCapital: cap,
      turnover,
      hasSubsidiaries: attrs.hasSubsidiaries ?? null,
    });
    if (test === 'small') {
      companySubtype = 'small';
      subtypeDerived = true;
    }
  }
  const xbrl = attrs.xbrlRequired ?? (listed || meets(XBRL_THRESHOLDS, cap, turnover));
  const mgt8 = attrs.mgt8Required ?? (listed || meets(MGT8_THRESHOLDS, cap, turnover));
  return {
    companySubtype,
    subtypeDerived,
    xbrlRequired: xbrl === true,
    xbrlDerived: attrs.xbrlRequired === undefined && xbrl === true,
    mgt8Required: mgt8 === true,
    mgt8Derived: attrs.mgt8Required === undefined && mgt8 === true,
    hasSubsidiaries: attrs.hasSubsidiaries ?? false,
    csrApplicable: attrs.csrApplicable ?? false,
    secretarialAuditRequired: attrs.secretarialAuditRequired ?? false,
    paidUpCapital: cap,
    authorisedCapital: attrs.authorisedCapital ?? null,
    turnover,
  };
}

/** Forms whose additional fee is ₹100 per day of delay (s.403; LLP Rules). */
export const ROC_PER_DAY_FEE_RULES: readonly string[] = [
  'ROC_AOC4',
  'ROC_MGT7',
  'LLP_FORM11',
  'LLP_FORM8',
];
export const ROC_PER_DAY_FEE = 100;

/** Normal-fee forms: the late fee is a multiple of the normal fee (P2-4). Verify. */
export const ROC_NORMAL_FEE_RULES: readonly string[] = [
  'ROC_ADT1',
  'ROC_FIRST_ADT1',
  'ROC_DPT3',
  'ROC_DIR12',
  'ROC_PAS3',
  'ROC_PAS6',
  'ROC_MGT14',
  'ROC_CHG1',
  'ROC_INC22',
  'ROC_SH7',
];

/**
 * Normal fee by nominal (authorised) share capital — Companies (Registration
 * Offices and Fees) Rules, 2014, Table of fees. Verify (V3).
 */
export const ROC_NORMAL_FEE_TABLE: ReadonlyArray<{ below: number | null; fee: number }> = [
  { below: 100_000, fee: 200 },
  { below: 500_000, fee: 300 },
  { below: 2_500_000, fee: 400 },
  { below: 10_000_000, fee: 500 },
  { below: null, fee: 600 },
];

/** Multiple of the normal fee by days late (Rule 12, as amended 2018). Verify (V3). */
export const ROC_LATE_MULTIPLE_SLABS: ReadonlyArray<{ upToDays: number | null; multiple: number }> =
  [
    { upToDays: 30, multiple: 2 },
    { upToDays: 60, multiple: 4 },
    { upToDays: 90, multiple: 6 },
    { upToDays: 180, multiple: 10 },
    { upToDays: null, multiple: 12 },
  ];

export function rocNormalFee(authorisedCapital: number): number {
  return ROC_NORMAL_FEE_TABLE.find((r) => r.below === null || authorisedCapital < r.below)!.fee;
}

export function rocLateMultiple(daysLate: number): number {
  return ROC_LATE_MULTIPLE_SLABS.find((s) => s.upToDays === null || daysLate <= s.upToDays)!
    .multiple;
}

/** How an indicative late charge was worked out. */
export type LateChargeBasis = 'gst' | 'per_day' | 'slab';

export interface LateChargeEstimate {
  daysLate: number;
  lateFee: number;
  interest: number | null;
  basis?: LateChargeBasis;
  /** Slab estimates: the normal fee and the multiple applied. */
  normalFee?: number;
  multiple?: number;
  /** The rate or slab is not yet confirmed (spec §9). */
  verify?: boolean;
}

/**
 * The indicative additional fee of a ROC form filed (or still unfiled) `asOf`.
 * Per-day forms: ₹100 × days (E16: 10 days → ₹1,000). Normal-fee forms: the
 * slab multiple × the normal fee, when the authorised capital is known. Null
 * when not late or when the form has no estimate (the rule's note stands).
 */
export function rocLateCharges(input: {
  ruleCode: string;
  dueDate: string;
  asOf: string;
  authorisedCapital: number | null;
}): LateChargeEstimate | null {
  const daysLate = Math.round((Date.parse(input.asOf) - Date.parse(input.dueDate)) / 86_400_000);
  if (!(daysLate > 0)) return null;
  if (ROC_PER_DAY_FEE_RULES.includes(input.ruleCode)) {
    const isLlp = input.ruleCode.startsWith('LLP_');
    return {
      daysLate,
      lateFee: daysLate * ROC_PER_DAY_FEE,
      interest: null,
      basis: 'per_day',
      ...(isLlp ? { verify: true } : {}),
    };
  }
  if (ROC_NORMAL_FEE_RULES.includes(input.ruleCode) && input.authorisedCapital !== null) {
    const normalFee = rocNormalFee(input.authorisedCapital);
    const multiple = rocLateMultiple(daysLate);
    return {
      daysLate,
      lateFee: normalFee * multiple,
      interest: null,
      basis: 'slab',
      normalFee,
      multiple,
      verify: true,
    };
  }
  return null;
}

/** A director's DSC that lapses before (or within `withinDays` of) an item's due date. */
export function dscLapses(
  directors: ReadonlyArray<{ din: string; name: string; dscExpiresOn?: string }>,
  dueDate: string,
  today: string,
): Array<{ din: string; name: string; dscExpiresOn: string; expired: boolean }> {
  return directors
    .filter((d): d is typeof d & { dscExpiresOn: string } => !!d.dscExpiresOn)
    .filter((d) => d.dscExpiresOn <= dueDate)
    .map((d) => ({
      din: d.din,
      name: d.name,
      dscExpiresOn: d.dscExpiresOn,
      expired: d.dscExpiresOn < today,
    }));
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** '2026-11-12' → '12 Nov 2026'. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTH_ABBR[Number(m) - 1]} ${y}`;
}

/**
 * The warning a due ROC item carries when a director's DSC lapses on or
 * before its due date (P2-5): "DSC of A Kumar expires 12 Nov 2026", or
 * "expired" once past; several directors are joined. Null when none lapse.
 */
export function dscWarningText(
  directors: ReadonlyArray<{ din: string; name: string; dscExpiresOn?: string }>,
  dueDate: string,
  today: string,
): string | null {
  const lapses = dscLapses(directors, dueDate, today);
  if (lapses.length === 0) return null;
  return lapses
    .map(
      (l) => `DSC of ${l.name} ${l.expired ? 'expired' : 'expires'} ${shortDate(l.dscExpiresOn)}`,
    )
    .join('; ');
}
