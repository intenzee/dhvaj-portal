import * as XLSX from 'xlsx';
import {
  GST_IMPORT_FIELDS,
  entityTypeFromConstitution,
  entityTypeFromPan,
  isValidGstin,
  normalizeGstin,
  panOfGstin,
  stateOfGstin,
  usernameHint,
  type GstImportField,
  type GstImportMapping,
} from '@hsdg/contracts';

/**
 * ADR-0035 — reading a GST client spreadsheet. Pure: workbook bytes in, rows
 * out; the service decides what each row does. The user name and password
 * stay in `ParsedGstRow.login` (in memory, for sealing) and never reach a
 * preview or a log.
 */

/** Header cell → lower-case letters and digits only. */
export function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const EXACT: Record<string, GstImportField> = {};
const exact = (field: GstImportField, ...names: string[]): void => {
  for (const n of names) EXACT[n] = field;
};
exact('gstin', 'gstin', 'gst', 'gstno', 'gstnumber', 'gstinno', 'gstinuin', 'gstinnumber');
exact(
  'legalName',
  'name',
  'legalname',
  'clientname',
  'nameofclient',
  'partyname',
  'nameoftheclient',
  'businessname',
  'legalnameofbusiness',
  'companyname',
  'firmname',
  'nameofbusiness',
  'taxpayername',
);
exact('tradeName', 'tradename', 'tradenameofbusiness');
exact(
  'username',
  'username',
  'userid',
  'loginid',
  'login',
  'id',
  'gstusername',
  'gstuserid',
  'user',
);
exact('password', 'password', 'pass', 'pwd', 'gstpassword', 'passwd');
exact('email', 'email', 'emailid', 'mail', 'emailaddress');
exact('phone', 'mobile', 'mobileno', 'phone', 'phoneno', 'contactno', 'contact', 'mobilenumber');
exact('constitution', 'constitution', 'constitutionofbusiness', 'entitytype', 'typeofbusiness');

/** The field a header most likely holds, or null. Pure — tested. */
export function fieldForHeader(raw: string): GstImportField | null {
  const h = normalizeHeader(raw);
  if (!h) return null;
  if (EXACT[h]) return EXACT[h];
  if (h.includes('pass') || h.includes('pwd')) return 'password';
  if (h.includes('user') || h.includes('login')) return 'username';
  if (h.includes('gstin') || h.includes('gstno') || h.includes('gstnumber')) return 'gstin';
  if (h.includes('mail')) return 'email';
  if (h.includes('mobile') || h.includes('phone') || h.includes('whatsapp')) return 'phone';
  if (h.includes('constitution')) return 'constitution';
  if (h.includes('trade')) return 'tradeName';
  if (h.includes('name')) return 'legalName';
  return null;
}

/** Headers → mapping; each field takes the first header that fits. Pure — tested. */
export function detectMapping(headers: string[]): GstImportMapping {
  const mapping = Object.fromEntries(GST_IMPORT_FIELDS.map((f) => [f, null])) as GstImportMapping;
  for (const header of headers) {
    const field = fieldForHeader(header);
    if (field && mapping[field] === null) mapping[field] = header;
  }
  return mapping;
}

/** A cell as text, trimmed ('' when empty). */
const text = (cell: unknown): string =>
  cell === null || cell === undefined ? '' : String(cell).trim();

/** The column that looks like GSTINs, when no header says so. */
function gstinColumnByValue(rows: string[][]): number {
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let c = 0; c < width; c += 1) {
    const hits = rows.filter((r) => isValidGstin(normalizeGstin(r[c] ?? ''))).length;
    if (hits >= Math.max(1, Math.ceil(rows.length / 3))) return c;
  }
  return -1;
}

export interface ParsedGstRow {
  /** Spreadsheet row number as Excel shows it. */
  row: number;
  values: Record<Exclude<GstImportField, 'username' | 'password'>, string>;
  /** Kept only in memory until sealed. */
  login: { username: string; password: string } | null;
  /** The row had one of user name / password but not both. */
  partialLogin: boolean;
}

export interface ParsedGstSheet {
  sheet: string;
  headers: string[];
  mapping: GstImportMapping;
  rows: ParsedGstRow[];
}

/** Data cells (an e-mail, a number, a long name) are not headers. */
const looksLikeHeader = (c: string): boolean =>
  c !== '' && c.length <= 40 && !c.includes('@') && !/\d{4,}/.test(c);

/** The header row: among the first 15, the one with the most recognised headers. */
function findHeaderRow(grid: string[][]): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(grid.length, 15); i += 1) {
    const fields = new Set(grid[i]!.filter(looksLikeHeader).map(fieldForHeader).filter(Boolean));
    const score = fields.size + (fields.has('gstin') ? 2 : 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : -1;
}

/** A sheet's header row and the rows under it, before mapping. */
interface SheetGrid {
  sheet: string;
  headers: string[];
  mapping: GstImportMapping;
  body: string[][];
  /** The spreadsheet row number of body[0]. */
  firstRow: number;
}

function readSheet(name: string, sheet: XLSX.WorkSheet): SheetGrid | null {
  const grid = XLSX.utils
    .sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true })
    .map((r) => r.map(text));
  const headerAt = findHeaderRow(grid);
  let headers: string[];
  let body: string[][];
  let firstRow: number;
  if (headerAt >= 0) {
    headers = grid[headerAt]!;
    body = grid.slice(headerAt + 1);
    firstRow = headerAt + 2;
  } else {
    // No header row: name the columns A, B, C… and find the GSTINs by value.
    const col = gstinColumnByValue(grid);
    if (col < 0) return null;
    const width = Math.max(...grid.map((r) => r.length));
    headers = Array.from({ length: width }, (_, i) => `Column ${XLSX.utils.encode_col(i)}`);
    headers[col] = 'GSTIN';
    body = grid;
    firstRow = 1;
  }
  // Blank header cells still need a name to be mapped by.
  headers = headers.map((h, i) => h || `Column ${XLSX.utils.encode_col(i)}`);
  return { sheet: name, headers, mapping: detectMapping(headers), body, firstRow };
}

/**
 * Parses an .xlsx / .xls / .csv workbook. Takes the first sheet that has a
 * GSTIN column; `override` replaces the detected mapping field by field.
 * Throws a plain Error with a person-readable message. Pure — tested.
 */
export function parseGstWorkbook(
  bytes: Buffer,
  override?: Partial<GstImportMapping>,
): ParsedGstSheet {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'buffer', cellDates: false, dense: true });
  } catch {
    throw new Error('The file could not be read as a spreadsheet (.xlsx, .xls or .csv).');
  }
  const found = workbook.SheetNames.map((name) => readSheet(name, workbook.Sheets[name]!)).find(
    (s): s is SheetGrid => s !== null && s.mapping.gstin !== null,
  );
  if (!found) throw new Error('No sheet in the file has a GSTIN column.');

  const mapping = { ...found.mapping };
  for (const field of GST_IMPORT_FIELDS) {
    const chosen = override?.[field];
    if (chosen === undefined) continue;
    if (chosen !== null && !found.headers.includes(chosen))
      throw new Error(`The column "${chosen}" is not in the sheet.`);
    mapping[field] = chosen;
  }
  if (!mapping.gstin) throw new Error('Choose the column that holds the GSTIN.');

  const index = Object.fromEntries(
    GST_IMPORT_FIELDS.map((f) => [
      f,
      mapping[f] === null ? -1 : found.headers.indexOf(mapping[f]!),
    ]),
  ) as Record<GstImportField, number>;
  const cell = (r: string[], f: GstImportField): string =>
    index[f] < 0 ? '' : (r[index[f]] ?? '');

  const rows: ParsedGstRow[] = [];
  found.body.forEach((r, i) => {
    if (r.every((c) => c === '')) return;
    const username = cell(r, 'username');
    const password = cell(r, 'password');
    rows.push({
      row: found.firstRow + i,
      values: {
        gstin: cell(r, 'gstin'),
        legalName: cell(r, 'legalName'),
        tradeName: cell(r, 'tradeName'),
        email: cell(r, 'email'),
        phone: cell(r, 'phone'),
        constitution: cell(r, 'constitution'),
      },
      login: username && password ? { username, password } : null,
      partialLogin: Boolean(username) !== Boolean(password),
    });
  });
  return { sheet: found.sheet, headers: found.headers, mapping, rows };
}

/** A row checked on its own, before the portal is consulted. */
export interface CheckedGstRow {
  row: number;
  gstin: string;
  legalName: string;
  tradeName: string | null;
  pan: string | null;
  stateCode: string | null;
  typeSlug: string | null;
  email: string | null;
  phone: string | null;
  login: { username: string; password: string } | null;
  usernameHint: string | null;
  /** Set when the row cannot be imported. */
  error: string | null;
  /** Something the person should know about a good row. */
  warning: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates every row and flags repeated GSTINs. Pure — tested. */
export function checkGstRows(rows: ParsedGstRow[]): CheckedGstRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const gstin = normalizeGstin(r.values.gstin);
    const legalName = r.values.legalName || r.values.tradeName;
    const warnings: string[] = [];
    let error: string | null = null;
    if (!gstin) error = 'No GSTIN.';
    else if (!isValidGstin(gstin))
      error = `"${gstin}" is not a valid GSTIN (check the characters and the last digit).`;
    else if (seen.has(gstin)) error = `Same GSTIN as row ${seen.get(gstin)}.`;
    else if (!legalName) error = 'No client name.';
    if (gstin && !seen.has(gstin)) seen.set(gstin, r.row);

    const valid = error === null;
    const pan = valid ? panOfGstin(gstin) : null;
    const typeSlug = valid
      ? (entityTypeFromConstitution(r.values.constitution) ?? entityTypeFromPan(pan!))
      : null;

    let email: string | null = r.values.email || null;
    if (email && !EMAIL.test(email)) {
      warnings.push(`E-mail "${email}" skipped (not an address).`);
      email = null;
    }
    const digits = r.values.phone.replace(/\D/g, '');
    const phone = digits.length >= 10 ? r.values.phone : null;
    if (r.values.phone && !phone) warnings.push(`Mobile "${r.values.phone}" skipped.`);
    if (r.partialLogin)
      warnings.push('Only one of the user name and password is filled; no login saved.');

    return {
      row: r.row,
      gstin,
      legalName,
      tradeName: r.values.tradeName && r.values.tradeName !== legalName ? r.values.tradeName : null,
      pan,
      stateCode: valid ? stateOfGstin(gstin) : null,
      typeSlug,
      email,
      phone,
      login: r.login,
      usernameHint: r.login ? usernameHint(r.login.username) : null,
      error,
      warning: warnings.length ? warnings.join(' ') : null,
    };
  });
}
