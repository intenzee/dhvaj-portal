import { COMPANY_SUBTYPES, type ProfileScope } from '@hsdg/contracts';

/**
 * Validation of registration_compliance_profiles.attributes per scope (pure).
 * The column is free jsonb so new attributes need no migration; this is the
 * gate that keeps what the generator's conditions read well-typed. Unknown
 * keys are rejected rather than silently stored — a typo would otherwise make
 * a rule quietly not apply.
 */

type Check = (value: unknown) => string | null;

const bool: Check = (v) => (typeof v === 'boolean' ? null : 'must be true or false');
const rupees: Check = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? null : 'must be a non-negative amount';
const subtype: Check = (v) =>
  typeof v === 'string' && (COMPANY_SUBTYPES as readonly string[]).includes(v)
    ? null
    : `must be one of ${COMPANY_SUBTYPES.join(', ')}`;

const DIN = /^[0-9]{8}$/;
const FY = /^([0-9]{4})-([0-9]{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIRECTOR_FIELDS = ['din', 'name', 'kycCycleStartFy', 'dscExpiresOn'];

const directors: Check = (v) => {
  if (!Array.isArray(v)) return 'must be a list';
  const seen = new Set<string>();
  for (const [i, d] of v.entries()) {
    if (typeof d !== 'object' || d === null) return `entry ${i + 1} must be an object`;
    const { din, name, kycCycleStartFy } = d as Record<string, unknown>;
    if (typeof din !== 'string' || !DIN.test(din)) return `entry ${i + 1}: DIN must be 8 digits`;
    if (seen.has(din)) return `DIN ${din} is listed twice`;
    seen.add(din);
    if (typeof name !== 'string' || name.trim() === '') return `entry ${i + 1}: name is required`;
    const fy = typeof kycCycleStartFy === 'string' ? FY.exec(kycCycleStartFy) : null;
    if (!fy || (Number(fy[1]) + 1) % 100 !== Number(fy[2])) {
      return `entry ${i + 1}: KYC cycle start must be a financial year like 2025-26`;
    }
    const { dscExpiresOn } = d as Record<string, unknown>;
    if (
      dscExpiresOn !== undefined &&
      dscExpiresOn !== null &&
      (typeof dscExpiresOn !== 'string' ||
        !ISO_DATE.test(dscExpiresOn) ||
        Number.isNaN(Date.parse(dscExpiresOn)))
    ) {
      return `entry ${i + 1}: DSC expiry must be a date (YYYY-MM-DD)`;
    }
    const extra = Object.keys(d).filter((k) => !DIRECTOR_FIELDS.includes(k));
    if (extra.length) return `entry ${i + 1}: unknown field ${extra.join(', ')}`;
  }
  return null;
};

export const PROFILE_ATTRIBUTE_SCHEMA: Record<ProfileScope, Record<string, Check>> = {
  gstin: {
    eInvoicing: bool,
    exporter: bool,
    jobWork: bool,
    importer: bool,
    annualTurnover: rupees,
    optingCompositionNextFy: bool,
    monthlyDataRequest: bool,
  },
  tan: { employer: bool, paysNonResidents: bool, tcsCollector: bool, propertyOrRentDeductor: bool },
  pan: {
    auditCase: bool,
    taxAudit: bool,
    tpTransactions: bool,
    advanceTaxLiable: bool,
    trustOrInstitution: bool,
  },
  cin: {
    companySubtype: subtype,
    msmeDuesOver45Days: bool,
    depositsOrExemptedLoans: bool,
    // Retired (G5): still accepted so older profiles save; the card no longer offers it.
    auditorAppointedAtAgm: bool,
    xbrlRequired: bool,
    hasSubsidiaries: bool,
    mgt8Required: bool,
    csrApplicable: bool,
    secretarialAuditRequired: bool,
    paidUpCapital: rupees,
    authorisedCapital: rupees,
    turnover: rupees,
    directors,
  },
  llpin: {},
};

/** Problems with `attributes` for `scope`; empty when valid. */
export function profileAttributeErrors(
  scope: ProfileScope,
  attributes: Record<string, unknown>,
): string[] {
  const schema = PROFILE_ATTRIBUTE_SCHEMA[scope];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    const check = schema[key];
    if (!check) {
      errors.push(`${key} is not a ${scope.toUpperCase()} profile attribute`);
      continue;
    }
    // null clears an attribute (stored as absent).
    if (value === null) continue;
    const problem = check(value);
    if (problem) errors.push(`${key} ${problem}`);
  }
  return errors;
}

/** Drop null-valued keys (null = "clear this attribute"). */
export function compactAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, v]) => v !== null && v !== undefined),
  );
}

/** The previous day (ISO), for closing the prior profile row. */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Today in India (the firm's statutory calendar), as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
