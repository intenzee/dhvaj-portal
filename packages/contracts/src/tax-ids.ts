import {
  GST_STATES,
  isValidGstin,
  isValidPan,
  normalizeGstin,
  panOfGstin,
  stateOfGstin,
} from './credentials';

/**
 * One home for the PAN, GSTIN, state and firm-type rules, used by the API,
 * both client imports and the web forms so the three never drift apart.
 * Everything here is pure.
 */

export { isValidGstin, isValidPan, normalizeGstin, panOfGstin, stateOfGstin } from './credentials';

// ── Reading a GSTIN ──────────────────────────────────────────────────────

export interface ReadGstin {
  /** Upper-cased, spaces, dashes and dots removed. */
  gstin: string;
  valid: boolean;
  /** Characters 3–12 when the shape allows, else null. */
  pan: string | null;
  stateCode: string | null;
  /** From GST_STATES; null when the code is not a state. */
  stateName: string | null;
}

/** A GSTIN as typed — ' 07aadcd1234k1z-5 ' — read into its parts. */
export function readGstin(raw: string | null | undefined): ReadGstin {
  const gstin = normalizeGstin((raw ?? '').replace(/[^0-9A-Za-z]/g, ''));
  const valid = isValidGstin(gstin);
  const pan = gstin.length >= 12 && isValidPan(panOfGstin(gstin)) ? panOfGstin(gstin) : null;
  const code = /^\d{2}/.test(gstin) ? stateOfGstin(gstin) : null;
  return {
    gstin,
    valid,
    pan,
    stateCode: code,
    stateName: code ? (GST_STATES[code] ?? null) : null,
  };
}

/** A PAN as typed: trimmed and upper-cased; null when empty. */
export function cleanPan(raw: string | null | undefined): string | null {
  const pan = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  return pan || null;
}

// ── Checking a client's tax IDs together ─────────────────────────────────

export const TAX_ID_ERROR = {
  panInvalid: 'PAN_INVALID',
  gstinInvalid: 'GSTIN_INVALID',
  panGstinMismatch: 'PAN_GSTIN_MISMATCH',
  gstinsDifferentPan: 'GSTINS_DIFFERENT_PAN',
  stateUnknown: 'STATE_UNKNOWN',
  stateMismatch: 'STATE_MISMATCH',
  typePanMismatch: 'TYPE_PAN_MISMATCH',
} as const;
export type TaxIdErrorCode = (typeof TAX_ID_ERROR)[keyof typeof TAX_ID_ERROR];

/** `block` can never be saved; `confirm` can, after the person says so. */
export type TaxIdSeverity = 'block' | 'confirm';

export interface TaxIdIssue {
  code: TaxIdErrorCode;
  severity: TaxIdSeverity;
  /** 'pan', or 'gstins.0' / 'gstins.0.stateCode' for the first GSTIN. */
  field: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface TaxIdInput {
  pan?: string | null;
  gstins?: { number: string; stateCode?: string | null }[];
}

/**
 * Every problem with a client's PAN and GSTINs taken together. A GSTIN whose
 * characters 3–12 are not the client's PAN belongs to another legal entity
 * and is blocked; a chosen state that differs from the GSTIN's first two
 * digits only needs a confirm (decision D8).
 */
export function checkTaxIds(input: TaxIdInput): TaxIdIssue[] {
  const issues: TaxIdIssue[] = [];
  const pan = cleanPan(input.pan);
  if (pan && !isValidPan(pan))
    issues.push({
      code: TAX_ID_ERROR.panInvalid,
      severity: 'block',
      field: 'pan',
      message: `${pan} is not a valid PAN (five letters, four digits, a letter).`,
      actual: pan,
    });
  const validPan = pan && isValidPan(pan) ? pan : null;

  let firstPan: string | null = null;
  (input.gstins ?? []).forEach((g, i) => {
    const field = `gstins.${i}`;
    const read = readGstin(g.number);
    if (!read.gstin) return;
    if (!read.valid) {
      issues.push({
        code: TAX_ID_ERROR.gstinInvalid,
        severity: 'block',
        field,
        message: `${read.gstin} is not a valid GSTIN — check the 15 characters and the last check digit.`,
        actual: read.gstin,
      });
      return;
    }
    const gPan = read.pan!;
    if (validPan && gPan !== validPan)
      issues.push({
        code: TAX_ID_ERROR.panGstinMismatch,
        severity: 'block',
        field,
        message: `This GSTIN is for PAN ${gPan}, but the client's PAN is ${validPan}.`,
        expected: validPan,
        actual: gPan,
      });
    else if (!validPan && firstPan && gPan !== firstPan)
      issues.push({
        code: TAX_ID_ERROR.gstinsDifferentPan,
        severity: 'block',
        field,
        message: `This GSTIN is for PAN ${gPan}, but the client's other GSTIN is for ${firstPan}. One client has one PAN.`,
        expected: firstPan,
        actual: gPan,
      });
    firstPan ??= gPan;

    if (!read.stateName)
      issues.push({
        code: TAX_ID_ERROR.stateUnknown,
        severity: 'block',
        field,
        message: `${read.stateCode} is not a GST state code.`,
        actual: read.stateCode ?? undefined,
      });
    const chosen = g.stateCode?.trim();
    if (chosen && read.stateName && chosen !== read.stateCode)
      issues.push({
        code: TAX_ID_ERROR.stateMismatch,
        severity: 'confirm',
        field: `${field}.stateCode`,
        message: `The GSTIN starts with ${read.stateCode} (${read.stateName}), but the state chosen is ${chosen} (${GST_STATES[chosen] ?? 'unknown'}).`,
        expected: read.stateCode!,
        actual: chosen,
      });
  });
  return issues;
}

/** The PAN a set of GSTINs implies: the first valid one's. */
export function panFromGstins(gstins: (string | null | undefined)[]): string | null {
  for (const g of gstins) {
    const read = readGstin(g);
    if (read.valid) return read.pan;
  }
  return null;
}

// ── Legal forms in a name ────────────────────────────────────────────────

/** The legal form a name's tail says. `firm` and `proprietor` are loose — people write "Firm" for a company. */
export type LegalForm =
  | 'company'
  | 'llp'
  | 'firm'
  | 'proprietor'
  | 'huf'
  | 'trust'
  | 'society'
  | 'aop';

/** Legal-form phrases, longest first, as regexes over a lower-cased name's tail. */
export const LEGAL_FORMS: readonly (readonly [RegExp, LegalForm])[] = [
  [/one\s*person\s*company(\s*\(?\s*opc\s*\)?)?$|\(?\s*\bopc\s*\)?$/, 'company'],
  [/\(?\s*\bp\s*\)?\s*\.?\s*ltd\.?$/, 'company'],
  [/\bpvt\.?\s*ltd\.?$|\bprivate\s*limited$|\bpvt\.?\s*limited$|\bprivate\s*ltd\.?$/, 'company'],
  [/\bprivatelimited$|\bpvtltd$/, 'company'],
  [/\b(public\s*)?(limited|ltd\.?)$/, 'company'],
  [/\bpvt\.?$/, 'company'],
  [/\bl\.?\s*l\.?\s*p\.?$|\blimited\s*liability\s*partnership$/, 'llp'],
  [/\(?\s*\bhuf\s*\)?$|\bhindu\s*undivided\s*family$/, 'huf'],
  [/\(?\s*\bprop(\.|rietor(ship)?)?\s*\)?$/, 'proprietor'],
  [/\(?\s*\b(partnership\s*)?firm\s*\)?$|\bpartnership$/, 'firm'],
  [/\btrust$/, 'trust'],
  [/\bsociety$/, 'society'],
];

/**
 * Any company form anywhere in a name, however written: "Pvt Ltd",
 * "Pvt. Limited", "Private Ltd", "(P) Ltd", "PvtLtd", "Limited", "OPC".
 */
export const COMPANY_FORMS: readonly RegExp[] = [
  /\bpvt\.?\s*(ltd|limited)\b\.?/i,
  /\bprivate\s*(ltd|limited)\b\.?/i,
  /\bprivatelimited\b|\bpvtltd\b/i,
  /\(\s*p\s*\)\s*\.?\s*(ltd|limited)\b/i,
  /\bp\.?\s*ltd\b\.?/i,
  /\b(public\s*)?(limited|ltd)\b\.?/i,
  /\bone\s*person\s*company\b|\bopc\b/i,
  /\bpvt\b\.?/i,
];

/** The legal form a name carries at its end ('Drift Logistics Pvt. Ltd.' → company), or null. */
export function legalFormOf(name: string): LegalForm | null {
  const lower = name.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const [re, form] of LEGAL_FORMS) if (re.test(lower)) return form;
  return null;
}

/** Whether a name already says it is a company anywhere in it ('Drift Pvt Ltd (Delhi' → true). */
export function hasCompanyForm(name: string): boolean {
  return COMPANY_FORMS.some((re) => re.test(name));
}

// ── Firm type from the PAN ───────────────────────────────────────────────

export interface FirmTypeInput {
  pan?: string | null;
  gstins?: (string | null | undefined)[];
  /** The client's name, or the type the Excel / person typed — read for D1 and D3. */
  nameOrTypedType?: string | null;
  /** Holds a GSTIN or another business registration (D2). */
  hasBusinessRegistration?: boolean;
}

export interface FirmTypeResult {
  /** An entity_types slug. */
  slug: string;
  /** A plain sentence: "PAN AADCD1234K: 4th letter C means a company." */
  reason: string;
}

const PAN_LETTER_TYPE: Record<string, { slug: string; says: string }> = {
  C: { slug: 'private_limited', says: 'a company' },
  P: { slug: 'proprietorship', says: 'an individual' },
  F: { slug: 'partnership', says: 'a firm' },
  H: { slug: 'huf', says: 'a Hindu Undivided Family' },
  A: { slug: 'aop', says: 'an Association of Persons' },
  B: { slug: 'aop', says: 'a Body of Individuals' },
  T: { slug: 'trust', says: 'a trust' },
};

/** The entity types each PAN letter allows (any other type disagrees with the PAN). */
export const PAN_LETTER_ALLOWS: Record<string, readonly string[]> = {
  C: ['private_limited', 'public_limited', 'opc'],
  P: ['proprietorship', 'individual'],
  F: ['partnership', 'llp'],
  H: ['huf'],
  A: ['aop'],
  B: ['aop'],
  T: ['trust'],
};

/** Whether a type agrees with a PAN; true when the PAN says nothing usable. */
export function typeAgreesWithPan(slug: string, pan: string | null | undefined): boolean {
  const allows = pan ? PAN_LETTER_ALLOWS[pan[3] ?? ''] : undefined;
  return !allows || allows.includes(slug);
}

/**
 * The firm type a client's PAN (or a GSTIN's 6th letter) says, after the
 * partners' decisions: D1 a C client named Public Limited or OPC keeps that;
 * D2 a P client is a proprietorship only with a business registration, else
 * an individual; D3 an F client named LLP is an LLP. Null for letters that
 * say nothing (G, L, J …) — the typed type stands.
 */
export function firmTypeFromIds(input: FirmTypeInput): FirmTypeResult | null {
  const typed = input.pan ? cleanPan(input.pan) : null;
  const pan = typed && isValidPan(typed) ? typed : panFromGstins(input.gstins ?? []);
  if (!pan) return null;
  const letter = pan[3]!;
  const base = PAN_LETTER_TYPE[letter];
  if (!base) return null;
  const source = typed && isValidPan(typed) ? `PAN ${pan}` : `GSTIN PAN ${pan}`;
  const reason = `${source}: 4th letter ${letter} means ${base.says}`;
  const text = (input.nameOrTypedType ?? '').toLowerCase();
  const hasGstin = (input.gstins ?? []).some((g) => readGstin(g).valid);

  switch (letter) {
    case 'C':
      if (/one\s*person|\bopc\b/.test(text))
        return { slug: 'opc', reason: `${reason}; the name says One Person Company.` };
      if (/public\s*(ltd|limited)|public_limited/.test(text))
        return { slug: 'public_limited', reason: `${reason}; the name says Public Limited.` };
      return { slug: 'private_limited', reason: `${reason}.` };
    case 'F':
      if (/\bl\.?\s*l\.?\s*p\b|limited\s*liability\s*partnership/.test(text))
        return { slug: 'llp', reason: `${reason}; the name says LLP.` };
      return { slug: 'partnership', reason: `${reason}.` };
    case 'P':
      return input.hasBusinessRegistration || hasGstin
        ? { slug: 'proprietorship', reason: `${reason} with a business registration — a proprietorship.` }
        : { slug: 'individual', reason: `${reason} with no business registration.` };
    default:
      return { slug: base.slug, reason: `${reason}.` };
  }
}

/** Where a client's firm type came from. Precedence: manual > pan > import > legacy (CM-3). */
export const ENTITY_TYPE_SOURCE = {
  pan: 'pan',
  manual: 'manual',
  import: 'import',
  legacy: 'legacy',
} as const;
export type EntityTypeSource = (typeof ENTITY_TYPE_SOURCE)[keyof typeof ENTITY_TYPE_SOURCE];

export const ENTITY_TYPE_SOURCE_LABEL: Record<EntityTypeSource, string> = {
  pan: 'From PAN',
  manual: 'Set by hand',
  import: 'From import',
  legacy: 'Set before PAN rules',
};

// ── "Private Limited" on company names ───────────────────────────────────

const PLACE_TAIL = /^(.*?)(\s*(?:[([]\s*[^()[\]]+[)\]]?|\s[-–]\s*[A-Za-z .&]+))\s*$/;

/**
 * The name with "Private Limited" added when the client is a private company
 * and no form of it is written yet (decision D4). A trailing place stays last:
 * 'Drift Logistics (Delhi' → 'Drift Logistics Private Limited (Delhi'.
 * Any other type, or a name already saying Pvt Ltd / Limited / OPC, is
 * returned unchanged.
 */
export function withCompanySuffix(name: string, typeSlug: string | null | undefined): string {
  const tidy = name.replace(/\s+/g, ' ').trim();
  if (typeSlug !== 'private_limited' || !tidy || hasCompanyForm(tidy)) return name;
  const m = PLACE_TAIL.exec(tidy);
  if (m?.[1] && m[1].trim() && /[([]|\s[-–]\s*/.test(m[2] ?? '')) {
    const tail = m[2]!.trim();
    // Only a tail that reads as a place moves; "Sharma - Sons" is part of the name.
    if (isPlace(tail)) return `${m[1].trim()} Private Limited ${tail}`;
  }
  return `${tidy} Private Limited`;
}

function isPlace(tail: string): boolean {
  const word = tail.replace(/^[-–\s([]+|[)\]\s]+$/g, '').trim();
  if (!word) return false;
  const key = word.toLowerCase().replace(/[^a-z]/g, '');
  if (Object.values(GST_STATES).some((s) => s.toLowerCase().replace(/[^a-z]/g, '') === key))
    return true;
  return PLACE_WORDS.has(key);
}

/** Office words and big cities people put in brackets after a client's name. */
const PLACE_WORDS = new Set([
  'ho',
  'headoffice',
  'branch',
  'newdelhi',
  'gurgaon',
  'gurugram',
  'noida',
  'mumbai',
  'bombay',
  'bangalore',
  'bengaluru',
  'chennai',
  'madras',
  'kolkata',
  'calcutta',
  'hyderabad',
  'pune',
  'ahmedabad',
  'jaipur',
  'lucknow',
  'ludhiana',
  'faridabad',
  'ghaziabad',
  'surat',
  'indore',
  'kanpur',
  'nagpur',
]);

// ── State options for dropdowns ──────────────────────────────────────────

export interface GstStateOption {
  code: string;
  name: string;
  /** '07 · Delhi' */
  label: string;
}

/** Every GST state as a dropdown option, sorted by code. */
export function gstStateOptions(): GstStateOption[] {
  return Object.entries(GST_STATES)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, name]) => ({ code, name, label: `${code} · ${name}` }));
}
