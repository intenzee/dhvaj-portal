import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  CLIENT_MASTER_COLUMNS,
  CLIENT_MASTER_EXAMPLE_CODE,
  CLIENT_MASTER_FIELDS,
  CLIENT_MASTER_LOGIN_COLUMNS,
  CLIENT_MASTER_SAVED_PASSWORD,
  CLIENT_MASTER_STREAM_FIELDS,
  GST_STATES,
  LEGAL_STATUSES,
  STREAMS,
  credentialLabel,
  entityTypeFromPan,
  isValidGstin,
  isValidPan,
  isValidTan,
  normalizeGstin,
  panOfGstin,
  stateCodeFromName,
  type ClientMasterField,
  type ClientMasterLoginField,
  type CredentialAccount,
  type CredentialPortal,
  type GstFrequency,
  type LegalStatus,
  type Stream,
} from '@hsdg/contracts';
import { normalizeHeader } from './client-workbook';

/**
 * The Client Master workbook (scripts/client-master/build_template.py):
 * reading what the person filled in, and filling the template with the
 * portal's clients for the export. Pure: bytes in, rows or bytes out; the
 * service decides what each row does in the portal.
 *
 * A row is read leniently — a bad optional cell (an e-mail, a pincode, a
 * date) is left out with a warning so the rest still imports; a bad PAN,
 * GSTIN or TAN, or a GSTIN of another PAN, stops the row, because the
 * client's identity would be wrong.
 */

export interface MasterContact {
  fullName: string;
  designation: string;
  email: string;
  phone: string;
}

export interface MasterAddress {
  line1: string;
  line2: string;
  city: string;
  /** A state's name, as the portal keeps it. */
  state: string;
  pincode: string;
}

export interface MasterRow {
  row: number;
  code: string;
  legalName: string;
  tradeName: string;
  /** The cell as typed (a type's name or slug); the service resolves it. */
  entityType: string;
  /** The type the PAN says (its 4th letter), for a row that names none. */
  guessedTypeSlug: string | null;
  /** The row's PAN, or the one inside its GSTIN. */
  pan: string;
  /** Main GSTIN first. */
  gstins: string[];
  tan: string;
  cinLlpin: string;
  /** yyyy-mm-dd */
  incorporationDate: string | null;
  legalStatus: LegalStatus | null;
  officeCode: string;
  contact: MasterContact | null;
  address: MasterAddress | null;
  financialYear: string | null;
  streams: Stream[];
  gstFrequency: GstFrequency | null;
  partnerEmail: string;
  leadEmail: string;
  warnings: string[];
  /** A PAN, GSTIN or TAN that is not valid, and why — forgiven when the client already has it. */
  badIds: { id: string; message: string }[];
  /** The row's other errors. */
  errors: string[];
  /** Every error, as one sentence list. */
  error: string | null;
}

export interface MasterLogin {
  row: number;
  code: string;
  name: string;
  portal: CredentialPortal;
  account: CredentialAccount;
  /** The GSTIN or TAN it is for ('' = the client's main one). */
  target: string;
  /** Kept only in memory until sealed. */
  username: string;
  password: string;
}

export interface ParsedMaster {
  rows: MasterRow[];
  logins: MasterLogin[];
  loginProblems: { row: number; message: string }[];
}

// ── Cells ────────────────────────────────────────────────────────────────

const text = (cell: unknown): string =>
  cell === null || cell === undefined ? '' : String(cell).trim().replace(/\s+/g, ' ');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const LLPIN_RE = /^[A-Z]{3}-[0-9]{4}$/;
const YES_RE = /^(y|yes|true|1|✓|✔)$/i;

/** A date cell → 'yyyy-mm-dd': an Excel date, dd-mm-yyyy, dd/mm/yyyy or yyyy-mm-dd. Pure — tested. */
export function parseDate(raw: unknown): string | null {
  const iso = (y: number, m: number, d: number): string | null => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
      ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      : null;
  };
  if (typeof raw === 'number' && raw > 0 && raw < 100000) {
    const d = XLSX.SSF.parse_date_code(raw);
    return d ? iso(d.y, d.m, d.d) : null;
  }
  const t = text(raw);
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** '2026-27', '2026-2027', 'FY 2026-27' → '2026-27'; null when not a year. Pure — tested. */
export function parseFinancialYear(raw: string): string | null {
  const m = /^(?:fy\s*)?(\d{4})\s*[-–/]\s*(\d{2}|\d{4})$/i.exec(raw.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const next = m[2]!.length === 4 ? start + 1 : (start + 1) % 100;
  return end === next ? `${start}-${String(start + 1).slice(-2)}` : null;
}

/** 'under_incorporation' → 'Under incorporation', as the template's list has it. */
export function legalStatusLabel(status: string): string {
  if (status === 'cirp') return 'CIRP';
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function parseLegalStatus(raw: string): LegalStatus | null {
  const key = normalizeHeader(raw);
  return LEGAL_STATUSES.find((s) => normalizeHeader(s) === key) ?? null;
}

function parseFrequency(raw: string): GstFrequency | null {
  const key = normalizeHeader(raw);
  if (['monthly', 'month', 'regular', 'm'].includes(key)) return 'monthly';
  if (['quarterly', 'quarter', 'qrmp', 'q'].includes(key)) return 'quarterly';
  return null;
}

/** 'GST', 'Income-tax (TAN)', 'TRACES deductor'… → the portal's login kind. */
const LOGIN_KINDS: { label: string; portal: CredentialPortal; account: CredentialAccount }[] = (
  [
    ['gst', 'main'],
    ['income_tax', 'main'],
    ['income_tax', 'tan'],
    ['traces', 'deductor'],
    ['traces', 'taxpayer'],
    ['mca', 'main'],
    ['eway_bill', 'main'],
    ['einvoice', 'main'],
  ] as [CredentialPortal, CredentialAccount][]
).map(([portal, account]) => ({ label: credentialLabel(portal, account), portal, account }));

// ── Sheets ───────────────────────────────────────────────────────────────

interface Table {
  /** Each field's 0-based column. */
  cols: Map<string, number>;
  /** Data rows after the heading row, with their 1-based sheet row. */
  rows: { row: number; cells: unknown[] }[];
}

/** The rows under the heading row that has `anchor` (looked for in the first 10 rows). */
function readTable<F extends string>(
  ws: XLSX.WorkSheet,
  headings: Record<F, string>,
  anchor: F,
): Table | null {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: true,
  });
  const first = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;
  const keyOf = new Map(
    (Object.entries(headings) as [F, string][]).map(([f, h]) => [normalizeHeader(h), f]),
  );
  const at = aoa
    .slice(0, 10)
    .findIndex((r) =>
      r.some((c) => normalizeHeader(text(c)) === normalizeHeader(headings[anchor])),
    );
  if (at < 0) return null;
  const cols = new Map<string, number>();
  aoa[at]!.forEach((c, i) => {
    const f = keyOf.get(normalizeHeader(text(c)));
    if (f && !cols.has(f)) cols.set(f, i);
  });
  return {
    cols,
    rows: aoa.slice(at + 1).map((cells, i) => ({ row: first + at + 2 + i, cells })),
  };
}

function sheetWith<F extends string>(
  book: XLSX.WorkBook,
  name: string,
  headings: Record<F, string>,
  anchor: F,
): Table | null {
  const named = book.Sheets[name];
  if (named) return readTable(named, headings, anchor);
  for (const n of book.SheetNames) {
    const t = readTable(book.Sheets[n]!, headings, anchor);
    if (t) return t;
  }
  return null;
}

/** Reads the Clients and Logins sheets. Throws a message for the person when it is not the template. */
export function parseClientMaster(bytes: Buffer): ParsedMaster {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, { type: 'buffer', cellDates: false, cellFormula: false });
  } catch {
    throw new Error('The file is not a readable Excel workbook.');
  }
  const clients = sheetWith(book, 'Clients', CLIENT_MASTER_COLUMNS, 'legalName');
  if (!clients)
    throw new Error(
      'No "Clients" sheet with a "Legal name *" heading: use the Client Master file from Export client master.',
    );
  const rows: MasterRow[] = [];
  for (const r of clients.rows) {
    const get = (f: ClientMasterField): string => {
      const i = clients.cols.get(f);
      return i === undefined ? '' : text(r.cells[i]);
    };
    const raw = (f: ClientMasterField): unknown => {
      const i = clients.cols.get(f);
      return i === undefined ? '' : r.cells[i];
    };
    if (CLIENT_MASTER_FIELDS.every((f) => get(f) === '')) continue;
    if (get('code').toUpperCase() === CLIENT_MASTER_EXAMPLE_CODE) continue;
    rows.push(readRow(r.row, get, raw));
  }

  const logins: MasterLogin[] = [];
  const loginProblems: ParsedMaster['loginProblems'] = [];
  const sheet = sheetWith(book, 'Logins', CLIENT_MASTER_LOGIN_COLUMNS, 'username');
  for (const r of sheet?.rows ?? []) {
    const get = (f: ClientMasterLoginField): string => {
      const i = sheet!.cols.get(f);
      return i === undefined ? '' : text(r.cells[i]);
    };
    const fields = Object.keys(CLIENT_MASTER_LOGIN_COLUMNS) as ClientMasterLoginField[];
    if (fields.every((f) => get(f) === '')) continue;
    if (get('code').toUpperCase() === CLIENT_MASTER_EXAMPLE_CODE) continue;
    const username = get('username');
    const password = get('password');
    // A login the export listed: already in the portal, nothing to do.
    if (password === CLIENT_MASTER_SAVED_PASSWORD || username.includes('•')) continue;
    const kind = LOGIN_KINDS.find(
      (k) => normalizeHeader(k.label) === normalizeHeader(get('portal')),
    );
    const problem = !kind
      ? `Portal "${get('portal')}" is not one of ${LOGIN_KINDS.map((k) => k.label).join(', ')}.`
      : !get('code') && !get('name')
        ? 'Say which client: its Client code or legal name.'
        : !username || !password
          ? 'Both the user ID and the password are needed.'
          : null;
    if (problem) {
      loginProblems.push({ row: r.row, message: problem });
      continue;
    }
    logins.push({
      row: r.row,
      code: get('code'),
      name: get('name'),
      portal: kind!.portal,
      account: kind!.account,
      target: get('target').replace(/\s+/g, '').toUpperCase(),
      username,
      password,
    });
  }
  return { rows, logins, loginProblems };
}

export const rowError = (errors: string[], badIds: MasterRow['badIds']): string | null =>
  errors.length || badIds.length ? [...badIds.map((b) => b.message), ...errors].join(' ') : null;

/** One Clients row → what it says, with its problems. Pure. */
function readRow(
  row: number,
  get: (f: ClientMasterField) => string,
  raw: (f: ClientMasterField) => unknown,
): MasterRow {
  const warnings: string[] = [];
  const errors: string[] = [];
  const legalName = get('legalName');
  if (!legalName) errors.push('Legal name is missing.');

  const typedPan = get('pan').replace(/\s+/g, '').toUpperCase();
  const badIds: MasterRow['badIds'] = [];
  if (typedPan && !isValidPan(typedPan))
    badIds.push({ id: typedPan, message: `PAN ${typedPan} is not a valid PAN.` });
  const gstins = [
    ...new Set(
      [get('gstin'), ...get('otherGstins').split(/[\s,;/]+/)]
        .map((g) => normalizeGstin(g))
        .filter(Boolean),
    ),
  ];
  for (const g of gstins)
    if (!isValidGstin(g))
      badIds.push({
        id: g,
        message: `GSTIN ${g} is not valid — a character is wrong (its check digit does not fit).`,
      });
  // Only a GSTIN that passes its check says the PAN.
  const pan = typedPan || (gstins[0] && isValidGstin(gstins[0]) ? panOfGstin(gstins[0]) : '');
  const otherPan = gstins.find((g) => isValidGstin(g) && panOfGstin(g) !== pan);
  if (isValidPan(pan) && otherPan)
    errors.push(
      typedPan && gstins[0] && panOfGstin(gstins[0]) !== typedPan
        ? `PAN ${typedPan} does not match the GSTIN ${gstins[0]} (its PAN is ${panOfGstin(gstins[0])}).`
        : `GSTIN ${otherPan} is of PAN ${panOfGstin(otherPan)}, not ${pan}: another client.`,
    );

  const tan = get('tan').replace(/\s+/g, '').toUpperCase();
  if (tan && !isValidTan(tan)) badIds.push({ id: tan, message: `TAN ${tan} is not a valid TAN.` });

  let cinLlpin = get('cinLlpin').replace(/\s+/g, '').toUpperCase();
  if (cinLlpin && !CIN_RE.test(cinLlpin) && !LLPIN_RE.test(cinLlpin)) {
    warnings.push(`CIN / LLPIN ${cinLlpin} does not look right; left out.`);
    cinLlpin = '';
  }

  let incorporationDate: string | null = null;
  if (get('incorporationDate')) {
    incorporationDate = parseDate(raw('incorporationDate'));
    if (!incorporationDate)
      warnings.push(`Date of incorporation "${get('incorporationDate')}" is not a date; left out.`);
  }
  let legalStatus: LegalStatus | null = null;
  if (get('legalStatus')) {
    legalStatus = parseLegalStatus(get('legalStatus'));
    if (!legalStatus) warnings.push(`Legal status "${get('legalStatus')}" is not known; left out.`);
  }

  let contact: MasterContact | null = null;
  if (get('contactName') || get('designation') || get('email') || get('mobile')) {
    let email = get('email').toLowerCase();
    if (email && !EMAIL_RE.test(email)) {
      warnings.push(`E-mail "${email}" does not look right; left out.`);
      email = '';
    }
    contact = {
      fullName: get('contactName') || legalName,
      designation: get('designation'),
      email,
      phone: get('mobile'),
    };
  }

  let address: MasterAddress | null = null;
  const stateRaw = get('state');
  let state = stateRaw ? (GST_STATES[stateCodeFromName(stateRaw) ?? ''] ?? stateRaw) : '';
  if (!state && gstins[0] && isValidGstin(gstins[0]))
    state = GST_STATES[gstins[0].slice(0, 2)] ?? '';
  let pincode = get('pincode').replace(/\s+/g, '');
  if (pincode && !/^[0-9]{6}$/.test(pincode)) {
    warnings.push(`Pincode "${pincode}" is not 6 digits; left out.`);
    pincode = '';
  }
  if (get('addressLine1'))
    address = {
      line1: get('addressLine1'),
      line2: get('addressLine2'),
      city: get('city'),
      state,
      pincode,
    };
  else if (get('addressLine2') || get('city') || stateRaw || pincode)
    warnings.push('The address has no "Address line 1"; left out.');

  const streams = STREAMS.filter((s) => YES_RE.test(get(CLIENT_MASTER_STREAM_FIELDS[s])));
  let financialYear: string | null = null;
  if (get('financialYear')) {
    financialYear = parseFinancialYear(get('financialYear'));
    if (!financialYear)
      warnings.push(
        `Financial year "${get('financialYear')}" is not like 2026-27; no engagement opened.`,
      );
  } else if (streams.length)
    warnings.push('Services are Yes but there is no financial year; no engagement opened.');
  let gstFrequency: GstFrequency | null = null;
  if (get('gstFrequency')) {
    gstFrequency = parseFrequency(get('gstFrequency'));
    if (!gstFrequency)
      warnings.push(`GST return frequency "${get('gstFrequency')}" is not Monthly or Quarterly.`);
  }
  const email = (f: 'partnerEmail' | 'leadEmail', label: string): string => {
    const v = get(f).toLowerCase();
    if (v && !EMAIL_RE.test(v)) {
      warnings.push(`${label} "${v}" is not an e-mail; left out.`);
      return '';
    }
    return v;
  };

  return {
    row,
    code: get('code').toUpperCase(),
    legalName,
    tradeName: get('tradeName'),
    entityType: get('entityType'),
    guessedTypeSlug: pan && isValidPan(pan) ? entityTypeFromPan(pan) : null,
    pan: isValidPan(pan) ? pan : '',
    gstins,
    tan,
    cinLlpin,
    incorporationDate,
    legalStatus,
    officeCode: get('officeCode').toUpperCase(),
    contact,
    address,
    financialYear,
    streams: financialYear ? streams : [],
    gstFrequency,
    partnerEmail: email('partnerEmail', 'Engagement partner'),
    leadEmail: email('leadEmail', 'Lead'),
    warnings,
    badIds,
    errors,
    error: rowError(errors, badIds),
  };
}

// ── Export: the template, filled ─────────────────────────────────────────

/** A cell to write: text, or a date as 'yyyy-mm-dd'. */
export type MasterCell = string | { date: string } | null | undefined;
export type MasterExportClient = Partial<Record<ClientMasterField, MasterCell>>;
export type MasterExportLogin = Partial<Record<ClientMasterLoginField, MasterCell>>;

/** First data rows: under the example row of each sheet. */
export const CLIENTS_FIRST_ROW = 6;
export const LOGINS_FIRST_ROW = 5;

/** 0 → 'A', 27 → 'AB'. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const escapeXml = (v: string): string =>
  v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 'yyyy-mm-dd' → the Excel day number. */
function excelSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 864e5;
}

function cellXml(ref: string, style: string, value: Exclude<MasterCell, null | undefined>): string {
  if (typeof value === 'object') {
    const serial = excelSerial(value.date);
    return serial === null
      ? `<c r="${ref}"${style}/>`
      : `<c r="${ref}"${style}><v>${serial}</v></c>`;
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * Writes the values into a sheet's XML: each into its (empty, styled) cell
 * of the template, so its colour, list and checks stay; rows past the
 * template's end are added plain. One pass over the XML.
 */
export function fillSheetXml(xml: string, values: Map<string, MasterCell>): string {
  const left = new Map(
    [...values].filter((e): e is [string, Exclude<MasterCell, null | undefined>] => {
      const v = e[1];
      return v !== null && v !== undefined && v !== '';
    }),
  );
  let out = xml.replace(
    /<c r="([A-Z]+[0-9]+)"([^>]*?)\s*\/>/g,
    (whole, ref: string, attrs: string) => {
      const v = left.get(ref);
      if (v === undefined) return whole;
      left.delete(ref);
      const style = /\ss="\d+"/.exec(attrs)?.[0] ?? '';
      return cellXml(ref, style, v);
    },
  );
  if (left.size === 0) return out;
  const rowOf = (ref: string) => Number(/\d+$/.exec(ref)![0]);
  const byRow = new Map<number, string[]>();
  for (const ref of [...left.keys()].sort(
    (a, b) => rowOf(a) - rowOf(b) || a.length - b.length || (a < b ? -1 : 1),
  )) {
    if (new RegExp(`<row r="${rowOf(ref)}"[\\s>]`).test(out))
      throw new Error(`Template cell ${ref} is not an empty cell.`);
    byRow.set(rowOf(ref), [...(byRow.get(rowOf(ref)) ?? []), cellXml(ref, '', left.get(ref)!)]);
  }
  const extra = [...byRow].map(([r, cells]) => `<row r="${r}">${cells.join('')}</row>`).join('');
  out = out.replace('</sheetData>', `${extra}</sheetData>`);
  return out;
}

/** The part path of each sheet, by name, from workbook.xml and its rels. */
async function sheetParts(zip: JSZip): Promise<Map<string, string>> {
  const wb = await zip.file('xl/workbook.xml')!.async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const target = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])![1]!,
      /Target="([^"]+)"/.exec(m[0])![1]!,
    ]),
  );
  const parts = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    const id = /r:id="([^"]+)"/.exec(m[0])?.[1];
    const t = id ? target.get(id) : undefined;
    if (name && t) parts.set(name, t.startsWith('/') ? t.slice(1) : `xl/${t}`);
  }
  return parts;
}

/** The template with the clients (from row 6) and their logins (from row 5). */
export async function fillClientMaster(
  template: Buffer,
  clients: MasterExportClient[],
  logins: MasterExportLogin[],
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(template);
  const parts = await sheetParts(zip);
  const fill = async (
    sheet: string,
    fields: readonly string[],
    rows: Partial<Record<string, MasterCell>>[],
    first: number,
  ): Promise<void> => {
    const path = parts.get(sheet);
    if (!path) throw new Error(`The template has no "${sheet}" sheet.`);
    const values = new Map<string, MasterCell>();
    rows.forEach((r, i) =>
      fields.forEach((f, c) => values.set(`${columnLetter(c)}${first + i}`, r[f])),
    );
    const xml = await zip.file(path)!.async('string');
    zip.file(path, fillSheetXml(xml, values));
  };
  await fill('Clients', CLIENT_MASTER_FIELDS, clients, CLIENTS_FIRST_ROW);
  await fill('Logins', Object.keys(CLIENT_MASTER_LOGIN_COLUMNS), logins, LOGINS_FIRST_ROW);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
