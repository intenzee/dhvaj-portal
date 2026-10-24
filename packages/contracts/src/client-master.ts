/**
 * The Client Master workbook: every client's master details on one sheet, so
 * GSTIN, PAN, TAN, contact and address are collected once. Export gives the
 * firm's clients in it; the person fills the gaps (or adds rows for new
 * clients) and imports it back. A row can also ask for the client's
 * Compliance engagement: a financial year and Yes per service.
 *
 * The headings are the contract with the template the export fills
 * (scripts/client-master/build_template.py) — change one, change both.
 */
import type { ClientVerdict } from './client-merge';
import type { ClientImportAction, CredentialAccount, CredentialPortal } from './credentials';
import type { Stream } from './engagement-restructure';

/** 'Clients' sheet headings (row 4), in column order from A. */
export const CLIENT_MASTER_COLUMNS = {
  code: 'Client code',
  legalName: 'Legal name *',
  tradeName: 'Trade name',
  entityType: 'Entity type',
  pan: 'PAN',
  gstin: 'GSTIN (main)',
  otherGstins: 'Other GSTINs',
  tan: 'TAN',
  cinLlpin: 'CIN / LLPIN',
  incorporationDate: 'Date of incorporation / birth',
  legalStatus: 'Legal status',
  officeCode: 'Home office code',
  contactName: 'Contact person',
  designation: 'Designation',
  email: 'Email',
  mobile: 'Mobile',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  city: 'City',
  state: 'State',
  pincode: 'Pincode',
  financialYear: 'Financial year',
  gst: 'GST',
  gstFrequency: 'GST return frequency',
  tds: 'TDS / TCS',
  incomeTax: 'Income Tax',
  roc: 'ROC / MCA',
  bookkeeping: 'Bookkeeping',
  mis: 'MIS',
  partnerEmail: 'Engagement partner (email)',
  leadEmail: 'Lead / in-charge (email)',
  // The client's main logins, on its own row (v2). Others: the Logins sheet.
  gstUser: 'GST user ID',
  gstPassword: 'GST password',
  itUser: 'Income-tax user ID (PAN)',
  itPassword: 'Income-tax password (PAN)',
  itTanUser: 'Income-tax user ID (TAN)',
  itTanPassword: 'Income-tax password (TAN)',
  tracesUser: 'TRACES user ID (TAN)',
  tracesPassword: 'TRACES password',
  mcaUser: 'MCA user ID',
  mcaPassword: 'MCA password',
  ewayUser: 'E-way bill user ID',
  ewayPassword: 'E-way bill password',
} as const;
export type ClientMasterField = keyof typeof CLIENT_MASTER_COLUMNS;
export const CLIENT_MASTER_FIELDS = Object.keys(CLIENT_MASTER_COLUMNS) as ClientMasterField[];

/**
 * The login columns of the Clients sheet: each pair is the client's main
 * login on that portal — the main GSTIN's, the PAN's, the main TAN's.
 */
export const CLIENT_MASTER_LOGIN_CELLS: readonly {
  portal: CredentialPortal;
  account: CredentialAccount;
  user: ClientMasterField;
  password: ClientMasterField;
}[] = [
  { portal: 'gst', account: 'main', user: 'gstUser', password: 'gstPassword' },
  { portal: 'income_tax', account: 'main', user: 'itUser', password: 'itPassword' },
  { portal: 'income_tax', account: 'tan', user: 'itTanUser', password: 'itTanPassword' },
  { portal: 'traces', account: 'deductor', user: 'tracesUser', password: 'tracesPassword' },
  { portal: 'mca', account: 'main', user: 'mcaUser', password: 'mcaPassword' },
  { portal: 'eway_bill', account: 'main', user: 'ewayUser', password: 'ewayPassword' },
];

/** The Yes / No service columns and the stream each opens. */
export const CLIENT_MASTER_STREAM_FIELDS: Record<Stream, ClientMasterField> = {
  gst: 'gst',
  tds: 'tds',
  income_tax: 'incomeTax',
  roc: 'roc',
  bookkeeping: 'bookkeeping',
  mis: 'mis',
};

/** 'Logins' sheet headings (row 3), in column order from A. */
export const CLIENT_MASTER_LOGIN_COLUMNS = {
  code: 'Client code',
  name: 'Legal name (as on Clients)',
  portal: 'Portal',
  target: 'For GSTIN / TAN',
  username: 'User ID',
  password: 'Password',
} as const;
export type ClientMasterLoginField = keyof typeof CLIENT_MASTER_LOGIN_COLUMNS;

/** What the export writes for a login it already has, unless asked for the passwords. */
export const CLIENT_MASTER_SAVED_PASSWORD = '(saved in portal)';

/**
 * GET /client-imports/master/export?passwords=true answers with these
 * headers: the logins written in full, and those left masked (a client
 * whose logins the caller may not see).
 */
export const CLIENT_MASTER_PASSWORDS_SHOWN_HEADER = 'x-passwords-shown';
export const CLIENT_MASTER_PASSWORDS_MASKED_HEADER = 'x-passwords-masked';
/** The example row's client code; the import skips it. */
export const CLIENT_MASTER_EXAMPLE_CODE = 'EXAMPLE';

/** POST /client-imports/master/preview and POST /client-imports/master */
export interface ClientMasterRequest {
  filename: string;
  contentBase64: string;
  /** The office of a new client whose row leaves "Home office code" blank. */
  officeCode: string;
}

/** One thing the import changes on a client: 'PAN', '' → 'ABCDE1234F'. */
export interface ClientMasterChange {
  field: string;
  from: string | null;
  to: string;
}

/** What the import does about the row's Compliance engagement. */
export interface ClientMasterEngagement {
  /** create: a new Compliance engagement; add_year / add_streams: to its open one. */
  action: 'create' | 'add_year' | 'add_streams' | 'existing';
  engagementCode: string | null;
  financialYear: string;
  /** The services the row asks for that the engagement will carry. */
  streams: Stream[];
}

export interface ClientMasterRow {
  /** The sheet row (1-based). */
  row: number;
  name: string;
  action: ClientImportAction;
  /** The portal's client the row is (an update), or null for a new one. */
  entityId: string | null;
  entityCode: string | null;
  /** How the portal's client was found. */
  matchedBy: 'code' | 'gstin' | 'pan' | 'tan' | 'name' | null;
  changes: ClientMasterChange[];
  engagement: ClientMasterEngagement | null;
  /** Logins from the Logins sheet for this client (none shown, only counted). */
  logins: number;
  warnings: string[];
  error: string | null;
  /**
   * The row's identifiers lead to two portal clients that look like one
   * (its GSTIN on one, its PAN or code on the other): merge them, then
   * preview again. Null when the row points at one client or none.
   */
  duplicate: ClientMasterDuplicate | null;
}

export interface ClientMasterDuplicate {
  /** The client the row's code (or first identifier) found, then the other. */
  entityIds: [string, string];
  entityCodes: [string, string];
  verdict: ClientVerdict;
  reasons: string[];
}

export interface ClientMasterPreview {
  rows: ClientMasterRow[];
  counts: Record<ClientImportAction, number>;
  /** Rows of the Logins sheet that could not be tied to a client row. */
  loginProblems: { row: number; message: string }[];
  logins: number;
  engagements: number;
  vaultReady: boolean;
}

export interface ClientMasterResult {
  clientsCreated: number;
  clientsUpdated: number;
  unchanged: number;
  fieldsFilled: number;
  registrationsAdded: number;
  contactsAdded: number;
  addressesAdded: number;
  loginsSaved: number;
  schemesSet: number;
  engagementsCreated: number;
  engagementsExtended: number;
  failed: { row: number; name: string; message: string }[];
  notes: { row: number; name: string; message: string }[];
}
