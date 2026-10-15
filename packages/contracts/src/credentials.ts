/**
 * ADR-0035 — clients' portal logins (GST today), kept encrypted and shown only
 * on "Show", and the GST client import that brings a spreadsheet of clients,
 * GSTINs and logins into the portal.
 */

/** Government portals a login can be saved for. Only GST is used today. */
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

/** How long a revealed login stays on screen. */
export const CREDENTIAL_SHOW_SECONDS = 30;

/** A saved login as lists carry it: never the secret, only a masked user name. */
export interface RegistrationCredential {
  id: string;
  registrationId: string;
  portal: CredentialPortal;
  /** `ab•••yz` */
  usernameHint: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** POST /credentials/:id/reveal — kept in component state only, never cached. */
export interface RevealedCredential {
  id: string;
  portal: CredentialPortal;
  username: string;
  password: string;
}

/** PUT /credentials — save or replace a registration's login. */
export interface SetCredentialInput {
  registrationId: string;
  /** Default `gst`. */
  portal?: CredentialPortal;
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
  items: RegistrationCredential[];
  /** Recent reveals across the client's logins; empty unless a partner asks. */
  recentAccess: (CredentialAccess & { credentialId: string })[];
}

/** `abcdefgh` → `ab•••gh`; short names keep only their first letter. Pure — tested. */
export function usernameHint(username: string): string {
  const u = username.trim();
  if (u.length <= 4) return `${u.slice(0, 1)}•••`;
  return `${u.slice(0, 2)}•••${u.slice(-2)}`;
}

// ── GSTIN ────────────────────────────────────────────────────────────────

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

/**
 * The entity type a PAN's fourth letter implies. C is taken as a private
 * company and F as a partnership firm (an LLP or a public company needs the
 * Constitution column). Null when the letter says nothing usable. Pure — tested.
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

/** A "Constitution of business" cell → entity type, or null. Pure — tested. */
export function entityTypeFromConstitution(raw: string): string | null {
  const v = raw.toLowerCase();
  if (!v.trim()) return null;
  if (/one\s*person/.test(v)) return 'opc';
  if (/\bllp\b|limited\s*liability\s*partnership/.test(v)) return 'llp';
  if (/public\s*(ltd|limited)/.test(v)) return 'public_limited';
  if (/private|pvt|company|\bltd\b|limited/.test(v)) return 'private_limited';
  if (/proprietor/.test(v)) return 'proprietorship';
  if (/partnership|firm/.test(v)) return 'partnership';
  if (/huf|hindu\s*undivided/.test(v)) return 'huf';
  if (/trust/.test(v)) return 'trust';
  if (/society|co-?operative/.test(v)) return 'society';
  if (/\baop\b|\bboi\b|association|body\s*of\s*individuals/.test(v)) return 'aop';
  if (/individual/.test(v)) return 'individual';
  return null;
}

// ── GST client import ────────────────────────────────────────────────────

/** The columns the import reads. Only GSTIN and the name are required. */
export const GST_IMPORT_FIELDS = [
  'gstin',
  'legalName',
  'tradeName',
  'username',
  'password',
  'email',
  'phone',
  'constitution',
] as const;
export type GstImportField = (typeof GST_IMPORT_FIELDS)[number];

export const GST_IMPORT_FIELD_LABEL: Record<GstImportField, string> = {
  gstin: 'GSTIN',
  legalName: 'Client (legal) name',
  tradeName: 'Trade name',
  username: 'GST user name',
  password: 'GST password',
  email: 'E-mail',
  phone: 'Mobile',
  constitution: 'Constitution',
};

/** Field → the header it is read from (null: not in the file). */
export type GstImportMapping = Record<GstImportField, string | null>;

/** POST /client-imports/gst/preview and POST /client-imports/gst */
export interface GstImportRequest {
  filename: string;
  contentBase64: string;
  /** The office the new clients belong to. */
  officeCode: string;
  /** Overrides the detected mapping, field by field. */
  mapping?: Partial<GstImportMapping>;
}

export const GST_IMPORT_ACTION = {
  /** A new client with this GSTIN (rows sharing a PAN make one client). */
  createClient: 'create_client',
  /** The PAN's client exists: add this GSTIN to it. */
  addRegistration: 'add_registration',
  /** The GSTIN is already in the portal: save its login. */
  updateLogin: 'update_login',
  /** The GSTIN is already in the portal and the row has no login. */
  unchanged: 'unchanged',
  error: 'error',
} as const;
export type GstImportAction = (typeof GST_IMPORT_ACTION)[keyof typeof GST_IMPORT_ACTION];

export interface GstImportRow {
  /** The spreadsheet row number, as the person sees it. */
  row: number;
  gstin: string;
  legalName: string;
  tradeName: string | null;
  pan: string | null;
  stateCode: string | null;
  typeSlug: string | null;
  /** The row carries a user name + password (never the values). */
  hasLogin: boolean;
  usernameHint: string | null;
  email: string | null;
  phone: string | null;
  action: GstImportAction;
  /** The existing client, for add / update. */
  entityId: string | null;
  entityName: string | null;
  /** Why the row is an error, or a warning on a good row. */
  message: string | null;
}

export interface GstImportPreview {
  sheet: string;
  /** The header row's cells, for changing the mapping. */
  headers: string[];
  mapping: GstImportMapping;
  rows: GstImportRow[];
  counts: Record<GstImportAction, number>;
  /** False when logins cannot be saved on this server (no encryption key). */
  vaultReady: boolean;
}

export interface GstImportResult {
  clientsCreated: number;
  registrationsAdded: number;
  loginsSaved: number;
  unchanged: number;
  failed: { row: number; gstin: string; message: string }[];
}
