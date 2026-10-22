/**
 * ADR-0035 — clients' portal logins (GST, income-tax, TRACES), kept encrypted
 * and shown only on "Show", and the client import that reads the firm's
 * login workbook (its "GST Login" and "TDS Login" sheets) into the portal.
 */

/** Government portals a login can be saved for. */
export const CREDENTIAL_PORTAL = {
  gst: 'gst',
  incomeTax: 'income_tax',
  traces: 'traces',
  mca: 'mca',
  ewayBill: 'eway_bill',
  einvoice: 'einvoice',
} as const;
export type CredentialPortal = (typeof CREDENTIAL_PORTAL)[keyof typeof CREDENTIAL_PORTAL];

export const CREDENTIAL_PORTAL_LABEL: Record<CredentialPortal, string> = {
  gst: 'GST portal',
  income_tax: 'Income-tax portal',
  traces: 'TRACES',
  mca: 'MCA',
  eway_bill: 'E-way bill',
  einvoice: 'E-invoice',
};

/**
 * Which login on a portal: the client's own (its GSTIN's GST login, its PAN's
 * income-tax login), its TAN's income-tax login, or a TRACES deductor /
 * taxpayer login.
 */
export const CREDENTIAL_ACCOUNT = {
  main: 'main',
  tan: 'tan',
  deductor: 'deductor',
  taxpayer: 'taxpayer',
} as const;
export type CredentialAccount = (typeof CREDENTIAL_ACCOUNT)[keyof typeof CREDENTIAL_ACCOUNT];

/** 'GST', 'Income-tax (PAN)', 'TRACES deductor'… Pure — tested. */
export function credentialLabel(portal: CredentialPortal, account: CredentialAccount): string {
  if (portal === 'gst') return 'GST';
  if (portal === 'income_tax') return account === 'tan' ? 'Income-tax (TAN)' : 'Income-tax (PAN)';
  if (portal === 'traces') return account === 'taxpayer' ? 'TRACES taxpayer' : 'TRACES deductor';
  return CREDENTIAL_PORTAL_LABEL[portal];
}

/** How long a revealed login stays on screen. */
export const CREDENTIAL_SHOW_SECONDS = 30;

/** GST return frequency in the firm's sheet: monthly = regular, quarterly = QRMP. */
export const GST_FREQUENCY = { monthly: 'monthly', quarterly: 'quarterly' } as const;
export type GstFrequency = (typeof GST_FREQUENCY)[keyof typeof GST_FREQUENCY];

/** A saved login as lists carry it: never the secret, only a masked user name. */
export interface ClientCredential {
  id: string;
  entityId: string;
  /** The GSTIN or TAN it is for; null for a PAN login or a GST login waiting for its GSTIN. */
  registrationId: string | null;
  registrationNumber: string | null;
  /** The GST state of a GST login (from its GSTIN, or the sheet's "Name (State)"). */
  stateCode: string | null;
  portal: CredentialPortal;
  account: CredentialAccount;
  /** `ab•••yz` */
  usernameHint: string;
  /** The frequency waiting for the GSTIN, on a GST login without one. */
  pendingFrequency: GstFrequency | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** POST /credentials/:id/reveal — kept in component state only, never cached. */
export interface RevealedCredential {
  id: string;
  portal: CredentialPortal;
  account: CredentialAccount;
  username: string;
  password: string;
}

/**
 * PUT /credentials — save or replace one of a client's logins. A GST login
 * names its GSTIN (registrationId) or, until there is one, its state.
 */
export interface SetCredentialInput {
  entityId: string;
  registrationId?: string | null;
  portal: CredentialPortal;
  /** Default `main`. */
  account?: CredentialAccount;
  stateCode?: string | null;
  username: string;
  password: string;
}

/** One reveal, for the partners' "who looked" list. */
export interface CredentialAccess {
  userName: string | null;
  role: string;
  revealedAt: string;
}

/** GET /credentials?entityId= | ?registrationId= */
export interface EntityCredentials {
  /** False when the server has no encryption key: nothing can be saved or shown. */
  vaultReady: boolean;
  items: ClientCredential[];
  /** Recent reveals across the client's logins; empty unless a partner asks. */
  recentAccess: (CredentialAccess & { credentialId: string })[];
}

/** `abcdefgh` → `ab•••gh`; short names keep only their first letter. Pure — tested. */
export function usernameHint(username: string): string {
  const u = username.trim();
  if (u.length <= 4) return `${u.slice(0, 1)}•••`;
  return `${u.slice(0, 2)}•••${u.slice(-2)}`;
}

// ── GSTIN, PAN, TAN ──────────────────────────────────────────────────────

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The GSTIN check digit for its first 14 characters. Pure — tested. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = GSTIN_CHARS.indexOf(first14[i] ?? '');
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

/** Upper-cased, spaces removed. */
export function normalizeGstin(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** A well-formed GSTIN with a correct check digit. Pure — tested. */
export function isValidGstin(gstin: string): boolean {
  return GSTIN_SHAPE.test(gstin) && gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
}

/** The PAN inside a GSTIN (characters 3–12). */
export function panOfGstin(gstin: string): string {
  return gstin.slice(2, 12);
}

/** The GST state code (first two digits). */
export function stateOfGstin(gstin: string): string {
  return gstin.slice(0, 2);
}

export const isValidPan = (pan: string): boolean => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
export const isValidTan = (tan: string): boolean => /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(tan);

/** GST state codes and their names. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

/** Short forms, old names and the big cities people write in brackets. */
const STATE_ALIASES: Record<string, string> = {
  newdelhi: '07',
  nctofdelhi: '07',
  ncr: '07',
  jk: '01',
  jandk: '01',
  jammu: '01',
  kashmir: '01',
  hp: '02',
  pb: '03',
  uk: '05',
  uttaranchal: '05',
  hr: '06',
  gurgaon: '06',
  gurugram: '06',
  faridabad: '06',
  rj: '08',
  jaipur: '08',
  up: '09',
  noida: '09',
  greaternoida: '09',
  ghaziabad: '09',
  lucknow: '09',
  wb: '19',
  bengal: '19',
  kolkata: '19',
  calcutta: '19',
  orissa: '21',
  chattisgarh: '22',
  mp: '23',
  ahmedabad: '24',
  surat: '24',
  daman: '26',
  diu: '26',
  mh: '27',
  mumbai: '27',
  bombay: '27',
  pune: '27',
  ka: '29',
  bangalore: '29',
  bengaluru: '29',
  tn: '33',
  chennai: '33',
  pondicherry: '34',
  ts: '36',
  hyderabad: '36',
  ap: '37',
};

/** 'Delhi', 'New Delhi', 'MH', 'Mumbai' → '07', '27', '27'; null when not a state. Pure — tested. */
export function stateCodeFromName(raw: string): string | null {
  const code = raw.trim();
  if (/^\d{2}$/.test(code)) return GST_STATES[code] ? code : null;
  const key = raw
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z]/g, '');
  if (!key) return null;
  for (const [code, name] of Object.entries(GST_STATES)) {
    if (name.toLowerCase().replace(/[^a-z]/g, '') === key) return code;
  }
  return STATE_ALIASES[key] ?? null;
}

/**
 * The entity type a PAN's fourth letter implies. C is taken as a private
 * company and F as a partnership firm (an LLP or a public company needs the
 * name to say so). Null when the letter says nothing usable. Pure — tested.
 */
export function entityTypeFromPan(pan: string): string | null {
  switch (pan[3]) {
    case 'C':
      return 'private_limited';
    case 'P':
      return 'proprietorship';
    case 'F':
      return 'partnership';
    case 'H':
      return 'huf';
    case 'A':
    case 'B':
      return 'aop';
    case 'T':
      return 'trust';
    default:
      return null;
  }
}

/** A "Constitution of business" cell or a client's name → entity type, or null. Pure — tested. */
export function entityTypeFromConstitution(raw: string): string | null {
  const v = raw.toLowerCase();
  if (!v.trim()) return null;
  if (/one\s*person/.test(v)) return 'opc';
  if (/\bllp\b|limited\s*liability\s*partnership/.test(v)) return 'llp';
  if (/public\s*(ltd|limited)/.test(v)) return 'public_limited';
  if (/private|pvt|company|\bltd\b|limited/.test(v)) return 'private_limited';
  if (/proprietor/.test(v)) return 'proprietorship';
  if (/partnership|firm/.test(v)) return 'partnership';
  if (/\bhuf\b|hindu\s*undivided/.test(v)) return 'huf';
  if (/trust/.test(v)) return 'trust';
  if (/society|co-?operative/.test(v)) return 'society';
  if (/\baop\b|\bboi\b|association|body\s*of\s*individuals/.test(v)) return 'aop';
  if (/individual/.test(v)) return 'individual';
  return null;
}

// ── The firm's login workbook ────────────────────────────────────────────

/**
 * How the import read each sheet: the GST login sheet (logins, GSTINs,
 * frequency and each month's GSTR-1 / 3B / 7 marks), the TDS login sheet
 * (PAN, TAN and TRACES logins, e-mail), or skipped (the ITR sheet, notes).
 */
export const CLIENT_IMPORT_SHEET_KIND = { gst: 'gst', tds: 'tds', skipped: 'skipped' } as const;
export type ClientImportSheetKind =
  (typeof CLIENT_IMPORT_SHEET_KIND)[keyof typeof CLIENT_IMPORT_SHEET_KIND];

export interface ClientImportSheet {
  name: string;
  kind: ClientImportSheetKind;
  /** Client rows read from it. */
  rows: number;
  /** Why it was skipped, or what was left out of it. */
  note: string | null;
}

export const CLIENT_IMPORT_ACTION = {
  /** A new client. */
  createClient: 'create_client',
  /** The client is in the portal: add what the sheet has that it lacks, refresh the logins. */
  updateClient: 'update_client',
  /** The client is in the portal and the sheet adds nothing. */
  unchanged: 'unchanged',
  error: 'error',
} as const;
export type ClientImportAction = (typeof CLIENT_IMPORT_ACTION)[keyof typeof CLIENT_IMPORT_ACTION];

/** A login in the sheet — never the values. */
export interface ClientImportLogin {
  portal: CredentialPortal;
  account: CredentialAccount;
  usernameHint: string;
  /** What it is for: 'GSTIN 07AAACB…', 'Delhi (GSTIN to come)', 'PAN', 'TAN DELA12345B'. */
  target: string;
}

/** One GST registration of the client (a row of the GST sheet). */
export interface ClientImportGst {
  sheet: string;
  row: number;
  gstin: string | null;
  stateCode: string | null;
  frequency: GstFrequency | null;
  /** Months marked filed / NA across GSTR-1, 3B and 7. */
  filed: number;
  notApplicable: number;
}

export interface ClientImportRow {
  /** Stable within one preview: the key the client was grouped by. */
  key: string;
  /** Where the client's rows are, e.g. 'GST Login 5, 6 · TDS Login 9'. */
  source: string;
  /** The first spreadsheet row, for sorting. */
  sheet: string;
  row: number;
  name: string;
  pan: string | null;
  tan: string | null;
  email: string | null;
  typeSlug: string | null;
  /** The type is the default chosen on the page, not read from the PAN or name. */
  typeGuessed: boolean;
  gst: ClientImportGst[];
  logins: ClientImportLogin[];
  action: ClientImportAction;
  entityId: string | null;
  entityName: string | null;
  /** Things the person should know; the row still imports. */
  warnings: string[];
  /** Why the client cannot be imported. */
  error: string | null;
  /** What the import does to the client's GST engagement for the years the sheet marks. */
  gstEngagement: ClientImportGstEngagement | null;
  /** The sheet marks GST returns for it but it has no GSTIN: they cannot go into an engagement. */
  noGstin: boolean;
}

/**
 * The GST engagement the sheet's filed / NA months go into: a new Compliance
 * engagement with GST, a year or the GST stream added to the client's open
 * one, or the one it already has. Its filings for those months are then closed.
 */
export interface ClientImportGstEngagement {
  action: 'create' | 'add_year' | 'add_stream' | 'existing';
  /** The open Compliance engagement it goes into (null when one is created). */
  engagementCode: string | null;
  financialYears: string[];
}

/** POST /client-imports/workbook/preview and POST /client-imports/workbook */
export interface ClientImportRequest {
  filename: string;
  contentBase64: string;
  /** The office the new clients belong to. */
  officeCode: string;
  /** The type for new clients whose PAN and name do not say. */
  defaultTypeSlug?: string;
}

export interface ClientImportPreview {
  sheets: ClientImportSheet[];
  /** The months the GST sheet marks ('2026-04'…). */
  months: string[];
  rows: ClientImportRow[];
  counts: Record<ClientImportAction, number>;
  logins: number;
  /** filed / NA marks in the GST sheet. */
  marks: number;
  /** False when logins cannot be saved on this server (no encryption key). */
  vaultReady: boolean;
  /** Clients that will get a new GST engagement for their filed months. */
  engagementsToCreate: number;
  /** Clients whose GST marks have no GSTIN, so no engagement — the person is told. */
  noGstin: number;
}

export interface ClientImportResult {
  clientsCreated: number;
  clientsUpdated: number;
  unchanged: number;
  registrationsAdded: number;
  loginsSaved: number;
  /** GSTINs whose monthly / quarterly scheme was set from the sheet. */
  schemesSet: number;
  /** Filings marked filed / not applicable. */
  marksApplied: number;
  /** Marks whose filing was already filed or not applicable. */
  marksAlreadyDone: number;
  /** Marks with no filing in the portal yet (no GST engagement for that month). */
  marksWithoutFiling: number;
  /**
   * Marks left for the engagement's partner or manager. Always 0 now: a mark
   * closes its filing on any engagement (the firm's record of the return).
   */
  marksNotAllowed: number;
  /** filed / NA marks kept as the clients' GST return history (new or changed). */
  marksRecorded: number;
  /** GST engagements created for clients the sheet marks returns for. */
  engagementsCreated: number;
  /** Open Compliance engagements that got the GST stream or a year for the marks. */
  engagementsExtended: number;
  failed: { source: string; name: string; message: string }[];
  /** Imported, with something to know (a scheme kept, a step not allowed). */
  notes: { source: string; name: string; message: string }[];
}

// ── The firm's GST return history (from its login workbook) ──────────────

export const RETURN_FORM = { gstr1: 'GSTR1', gstr3b: 'GSTR3B', gstr7: 'GSTR7' } as const;
export type ReturnForm = (typeof RETURN_FORM)[keyof typeof RETURN_FORM];
export const RETURN_FORMS: ReturnForm[] = ['GSTR1', 'GSTR3B', 'GSTR7'];
export const RETURN_FORM_LABEL: Record<ReturnForm, string> = {
  GSTR1: 'GSTR-1',
  GSTR3B: 'GSTR-3B',
  GSTR7: 'GSTR-7',
};

export const RETURN_MARK = { filed: 'filed', notApplicable: 'not_applicable' } as const;
export type ReturnMark = (typeof RETURN_MARK)[keyof typeof RETURN_MARK];

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

/** A return period's last month: '2026-04' → '2026-04', '2026-27:Q1' → '2026-06'. For sorting. */
export function returnPeriodEnd(key: string): string {
  const q = /^(\d{4})-\d{2}:Q([1-4])$/.exec(key);
  if (!q) return key;
  const start = Number(q[1]);
  const month = Number(q[2]) * 3 + 3;
  return month > 12
    ? `${start + 1}-${String(month - 12).padStart(2, '0')}`
    : `${start}-${String(month).padStart(2, '0')}`;
}

/** The financial year a return period is in: '2026-04' → '2026-27', '2027-02' → '2026-27', '2026-27:Q1' → '2026-27'. */
export function returnPeriodFinancialYear(key: string): string | null {
  const q = /^(\d{4}-\d{2}):Q[1-4]$/.exec(key);
  if (q) return q[1]!;
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const start = Number(m[2]) >= 4 ? Number(m[1]) : Number(m[1]) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** '2026-04' → 'Apr-26'; '2026-27:Q1' → 'Q1 26-27'. */
export function returnPeriodLabel(key: string): string {
  const q = /^\d{2}(\d{2})-(\d{2}):Q([1-4])$/.exec(key);
  if (q) return `Q${q[3]} ${q[1]}-${q[2]}`;
  const m = /^\d{2}(\d{2})-(\d{2})$/.exec(key);
  if (m) return `${MONTH_ABBR[Number(m[2]) - 1] ?? m[2]}-${m[1]}`;
  return key;
}

/** One GSTIN (or one state / the client, while the sheet has no GSTIN) and its marks. */
export interface ClientReturnLine {
  entityId: string;
  entityCode: string;
  entityName: string;
  registrationId: string | null;
  gstin: string | null;
  stateCode: string | null;
  /** period key → form → filed / NA */
  marks: Record<string, Partial<Record<ReturnForm, ReturnMark>>>;
  /** When the marks were last imported. */
  updatedAt: string;
}

/** GET /client-returns */
export interface ClientReturns {
  /** The periods with a mark, in order ('2026-04', …, '2026-27:Q1'). */
  periods: string[];
  /** The forms with a mark, in RETURN_FORMS order. */
  forms: ReturnForm[];
  lines: ClientReturnLine[];
}
