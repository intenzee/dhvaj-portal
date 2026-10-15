import * as XLSX from 'xlsx';
import {
  GST_STATES,
  credentialLabel,
  entityTypeFromPan,
  isValidGstin,
  isValidPan,
  isValidTan,
  normalizeGstin,
  panOfGstin,
  stateCodeFromName,
  stateOfGstin,
  usernameHint,
  type ClientImportLogin,
  type ClientImportSheet,
  type CredentialAccount,
  type CredentialPortal,
  type GstFrequency,
} from '@hsdg/contracts';

/**
 * ADR-0035 — reading the firm's login workbook. Pure: workbook bytes in,
 * clients out; the service decides what each client does in the portal.
 *
 * The "GST Login" sheet: S No | Particular | Frequency | ID | Pwd | GSTIN |
 * then GSTR-1 / GSTR-3 (/ GSTR 7) per month, the month ("Apr-26") in the row
 * above, merged over its columns. "Name (Delhi)" is the client's Delhi GST
 * registration. The "TDS Login" sheet: Client name | mail | IT-PAN | PWD |
 * IT-TAN | Pwd | Traces ID (Deductor) | Pwd | Traces ID (Tax Payer) | Pwd.
 * Every other sheet (the ITR sheet) is skipped, as are Fees, DOI, Return
 * filing Status and Ack. No.
 *
 * Headings are matched loosely, so a re-typed or re-ordered sheet still
 * reads. User names and passwords stay in `SheetLogin` (in memory, for
 * sealing) and never reach a preview or a log.
 */

export type ReturnForm = 'GSTR1' | 'GSTR3B' | 'GSTR7';
export type FilingMark = 'filed' | 'not_applicable';

export interface SheetLogin {
  portal: CredentialPortal;
  account: CredentialAccount;
  /** Kept only in memory until sealed. */
  username: string;
  password: string;
}

export interface MonthMark {
  /** '2026-04' */
  month: string;
  form: ReturnForm;
  mark: FilingMark;
}

/** A row of the GST sheet. */
export interface GstLine {
  sheet: string;
  row: number;
  /** "ABC Traders (Delhi)" → "ABC Traders". */
  name: string;
  /** The state in the name's brackets. */
  nameState: string | null;
  gstin: string;
  frequency: GstFrequency | null;
  frequencyRaw: string;
  pan: string;
  email: string;
  phone: string;
  logins: SheetLogin[];
  /** Logins with only one of user ID and password. */
  halfLogins: string[];
  marks: MonthMark[];
}

/** A row of the TDS sheet. */
export interface TdsLine {
  sheet: string;
  row: number;
  name: string;
  pan: string;
  tan: string;
  email: string;
  phone: string;
  logins: SheetLogin[];
  halfLogins: string[];
}

export interface ParsedWorkbook {
  sheets: ClientImportSheet[];
  /** Months the GST sheet marks, in order. */
  months: string[];
  gst: GstLine[];
  tds: TdsLine[];
}

// ── Cells ────────────────────────────────────────────────────────────────

/** A cell as text, trimmed ('' when empty). */
const text = (cell: unknown): string =>
  cell === null || cell === undefined ? '' : String(cell).trim();

/** Header cell → lower-case letters and digits only. */
export function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const tokens = (raw: string): string[] =>
  raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ym = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}`;
const fullYear = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * A month heading → '2026-04': "Apr-26", "April 2026", "Apr'26", "1-Apr-26",
 * "04/2026", "2026-04", or an Excel date. Null otherwise. Pure — tested.
 */
export function parseMonth(cell: string, raw?: unknown): string | null {
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return ym(d.y, d.m);
  }
  const t = cell.trim().toLowerCase();
  let m = /^(?:\d{1,2}[\s-])?([a-z]{3,9})[\s\-'’.,/]*(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3)) + 1;
    return month > 0 ? ym(fullYear(m[2]!), month) : null;
  }
  m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return ym(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})[/-](\d{4})$/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return ym(Number(m[2]), Number(m[1]));
  return null;
}

/** A return cell → filed / not applicable, null when empty, 'other' otherwise. Pure — tested. */
export function parseMark(cell: string, raw?: unknown): FilingMark | 'other' | null {
  const t = cell.trim().toLowerCase();
  if (!t) return null;
  if (/^(n\.?\s*\/?\s*a\.?|not\s*applicable)$/.test(t)) return 'not_applicable';
  if (/^(filed|file|done|yes|y|ok|✓|✔)\b/.test(t) || t === '✓' || t === '✔') return 'filed';
  // A filing date in the cell means it was filed.
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) return 'filed';
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(t)) return 'filed';
  return 'other';
}

/** "Monthly" / "M" → monthly; "Quarterly" / "Q" / "QRMP" → quarterly. Pure — tested. */
export function parseFrequency(cell: string): GstFrequency | null {
  const t = cell.trim().toLowerCase();
  if (/^m(onth(ly)?)?\.?$/.test(t)) return 'monthly';
  if (/^(q(uarter(ly)?|trly|rmp)?\.?)$/.test(t)) return 'quarterly';
  return null;
}

/**
 * "ABC Traders (Delhi)" → { name: 'ABC Traders', state: '07' }. A bracket that
 * is not a state ("Ram Kumar (HUF)") stays in the name. Pure — tested.
 */
export function splitStateFromName(raw: string): { name: string; state: string | null } {
  const full = raw.replace(/\s+/g, ' ').trim();
  const bracket = /^(.*?)\s*[([]\s*([^)\]]+?)\s*[)\]]\s*$/.exec(full);
  if (bracket?.[1]) {
    const state = stateCodeFromName(bracket[2]!);
    if (state) return { name: bracket[1], state };
  }
  const dash = /^(.*?)\s+[-–]\s+([A-Za-z .&]+)$/.exec(full);
  if (dash?.[1]) {
    const state = stateCodeFromName(dash[2]!);
    if (state) return { name: dash[1], state };
  }
  return { name: full, state: null };
}

/** For matching names across sheets and with the portal: letters and digits only. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^m\/s\.?\s*/, '')
    .replace(/[^a-z0-9]/g, '');
}

// ── Headings ─────────────────────────────────────────────────────────────

type Role =
  | { kind: 'sno' | 'name' | 'frequency' | 'gstin' | 'pan' | 'tan' | 'email' | 'phone' }
  | { kind: 'password' }
  | { kind: 'login'; portal: CredentialPortal | null; account: CredentialAccount }
  | { kind: 'return'; form: ReturnForm | null };

/** What a heading holds, or null (Fees, DOI, Return filing Status, Ack. No…). Pure — tested. */
export function roleOfHeading(raw: string): Role | null {
  const n = normalizeHeader(raw);
  const t = tokens(raw);
  if (!n) return null;
  if (/^(pwd|pass|passwd|password)/.test(n) || t.includes('pwd') || n.includes('password'))
    return { kind: 'password' };
  const gstr = /^gstr(\d+)/.exec(n);
  if (gstr || n === 'iff') {
    const form =
      n === 'iff' || gstr![1] === '1'
        ? 'GSTR1'
        : gstr![1] === '3'
          ? 'GSTR3B'
          : gstr![1] === '7'
            ? 'GSTR7'
            : null;
    return { kind: 'return', form };
  }
  if (['sno', 'srno', 'slno', 'sn', 'serialno', 'sr', 'no'].includes(n)) return { kind: 'sno' };
  if (t.includes('gstin') || ['gst', 'gstno', 'gstnumber', 'gstinno', 'gstinuin'].includes(n))
    return { kind: 'gstin' };
  if (t.includes('traces'))
    return {
      kind: 'login',
      portal: 'traces',
      account: n.includes('taxpayer') ? 'taxpayer' : 'deductor',
    };
  if (t.includes('tan')) return { kind: 'tan' };
  if (t.includes('pan')) return { kind: 'pan' };
  if (n.includes('mail')) return { kind: 'email' };
  if (/mobile|phone|contactno|whatsapp/.test(n)) return { kind: 'phone' };
  if (n.includes('freq') || n.includes('periodicity') || n === 'monthlyquarterly')
    return { kind: 'frequency' };
  if (t.includes('id') || n.includes('user') || n.includes('login'))
    return { kind: 'login', portal: null, account: 'main' };
  if (['particular', 'particulars', 'party', 'client', 'clients'].includes(n) || n.includes('name'))
    return { kind: 'name' };
  return null;
}

// ── Sheets ───────────────────────────────────────────────────────────────

interface Grid {
  /** Formatted text; row i is spreadsheet row i + 1, column j is column j. */
  cells: string[][];
  raw: unknown[][];
}

function gridOf(sheet: XLSX.WorkSheet): Grid {
  const ref = sheet['!ref'];
  if (!ref) return { cells: [], raw: [] };
  // From A1 whatever the sheet's own range says, so indexes are positions.
  const range = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: XLSX.utils.decode_range(ref).e });
  const opts = { header: 1 as const, defval: '', blankrows: true, range };
  return {
    cells: XLSX.utils
      .sheet_to_json<unknown[]>(sheet, { ...opts, raw: false })
      .map((r) => r.map(text)),
    raw: XLSX.utils.sheet_to_json<unknown[]>(sheet, { ...opts, raw: true }),
  };
}

const SCORED = new Set(['name', 'password', 'gstin', 'pan', 'tan', 'login', 'frequency', 'return']);

/** The heading row: among the first 15, the one that reads most like the firm's headings. */
function findHeadingRow(cells: string[][]): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(cells.length, 15); i += 1) {
    const roles = cells[i]!.map(roleOfHeading).filter((r): r is Role => r !== null);
    const kinds = new Set(roles.map((r) => r.kind).filter((k) => SCORED.has(k)));
    if (!kinds.has('name')) continue;
    if (kinds.size > bestScore) {
      best = i;
      bestScore = kinds.size;
    }
  }
  return bestScore >= 3 ? best : -1;
}

interface Layout {
  kind: 'gst' | 'tds';
  headingAt: number;
  roles: (Role | null)[];
  /** Column → its month, for the return columns. */
  monthOf: Map<number, string>;
  /** Password column → its user-ID column. */
  pairs: Map<number, number>;
  notes: string[];
}

function layoutOf(name: string, grid: Grid): Layout | { skip: string } {
  const headingAt = findHeadingRow(grid.cells);
  if (headingAt < 0) return { skip: 'Not a login sheet: no IDs, passwords or GSTINs.' };
  const roles = grid.cells[headingAt]!.map(roleOfHeading);
  const has = (k: Role['kind']): boolean => roles.some((r) => r?.kind === k);
  const sheetName = name.toLowerCase();
  const gstLike = has('gstin') || has('return') || has('frequency') || /\bgst\b/.test(sheetName);
  const tdsLike =
    has('tan') ||
    roles.some((r) => r?.kind === 'login' && r.portal === 'traces') ||
    /tds|income/.test(sheetName);
  if (!has('password') && !has('gstin')) return { skip: 'No logins or GSTINs in it.' };
  const kind: Layout['kind'] = gstLike ? 'gst' : tdsLike ? 'tds' : 'gst';
  const notes: string[] = [];

  // Each password goes with the nearest user ID to its left.
  const pairs = new Map<number, number>();
  const paired = new Set<number>();
  roles.forEach((r, c) => {
    if (r?.kind !== 'password') return;
    for (let left = c - 1; left >= 0; left -= 1) {
      const l = roles[left];
      if (l?.kind === 'password') break;
      if (l && ['login', 'pan', 'tan'].includes(l.kind) && !paired.has(left)) {
        pairs.set(c, left);
        paired.add(left);
        return;
      }
    }
    notes.push(`The password in column ${XLSX.utils.encode_col(c)} has no user ID beside it.`);
  });

  // Months: the row above the headings, a month carried right over its columns.
  const monthOf = new Map<number, string>();
  if (roles.some((r) => r?.kind === 'return')) {
    const above = grid.cells[headingAt - 1] ?? [];
    const aboveRaw = grid.raw[headingAt - 1] ?? [];
    let current: string | null = null;
    let missing = 0;
    roles.forEach((r, c) => {
      const m = parseMonth(above[c] ?? '', aboveRaw[c]);
      if (m) current = m;
      if (r?.kind !== 'return' || !r.form) return;
      if (current) monthOf.set(c, current);
      else missing += 1;
    });
    if (missing)
      notes.push(`${missing} return column(s) have no month above them and were left out.`);
    const other = roles.filter((r) => r?.kind === 'return' && !r.form).length;
    if (other) notes.push(`${other} return column(s) other than GSTR-1, 3B and 7 were left out.`);
  }
  return { kind, headingAt, roles, monthOf, pairs, notes };
}

function loginTarget(
  role: Role,
  sheetKind: Layout['kind'],
): Pick<SheetLogin, 'portal' | 'account'> {
  if (role.kind === 'pan') return { portal: 'income_tax', account: 'main' };
  if (role.kind === 'tan') return { portal: 'income_tax', account: 'tan' };
  if (role.kind === 'login' && role.portal) return { portal: role.portal, account: role.account };
  return sheetKind === 'gst'
    ? { portal: 'gst', account: 'main' }
    : { portal: 'income_tax', account: 'main' };
}

interface ReadRow {
  row: number;
  value: (kind: Role['kind']) => string;
  logins: SheetLogin[];
  halfLogins: string[];
  marks: MonthMark[];
  otherMarks: number;
}

function readRows(grid: Grid, layout: Layout): ReadRow[] {
  const out: ReadRow[] = [];
  for (let i = layout.headingAt + 1; i < grid.cells.length; i += 1) {
    const cells = grid.cells[i]!;
    const raw = grid.raw[i] ?? [];
    if (cells.every((c) => c === '')) continue;
    const value = (kind: Role['kind']): string => {
      const c = layout.roles.findIndex((r) => r?.kind === kind);
      return c < 0 ? '' : (cells[c] ?? '');
    };
    const logins: SheetLogin[] = [];
    const halfLogins: string[] = [];
    for (const [pwdCol, idCol] of layout.pairs) {
      const username = cells[idCol] ?? '';
      const password = cells[pwdCol] ?? '';
      const target = loginTarget(layout.roles[idCol]!, layout.kind);
      if (username && password) logins.push({ ...target, username, password });
      else if (password || (username && layout.roles[idCol]!.kind === 'login'))
        halfLogins.push(credentialLabel(target.portal, target.account));
    }
    const marks: MonthMark[] = [];
    let otherMarks = 0;
    for (const [c, month] of layout.monthOf) {
      const role = layout.roles[c]!;
      if (role.kind !== 'return' || !role.form) continue;
      const mark = parseMark(cells[c] ?? '', raw[c]);
      if (mark === 'other') otherMarks += 1;
      else if (mark) marks.push({ month, form: role.form, mark });
    }
    // A heading inside the list ("Quarterly clients") is a lone cell, not a client.
    const filled = cells.filter((c) => c !== '').length;
    if (filled === 1 && value('name') && !value('sno')) continue;
    out.push({ row: i + 1, value, logins, halfLogins, marks, otherMarks });
  }
  return out;
}

/**
 * Reads every sheet of the workbook: the GST and TDS login sheets, by their
 * headings. Throws a plain Error with a person-readable message. Pure — tested.
 */
export function parseClientWorkbook(bytes: Buffer): ParsedWorkbook {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'buffer', dense: true });
  } catch {
    throw new Error('The file could not be read as a spreadsheet (.xlsx, .xls or .csv).');
  }
  const sheets: ClientImportSheet[] = [];
  const gst: GstLine[] = [];
  const tds: TdsLine[] = [];
  const months = new Set<string>();

  for (const name of workbook.SheetNames) {
    const grid = gridOf(workbook.Sheets[name]!);
    const layout = layoutOf(name, grid);
    if ('skip' in layout) {
      sheets.push({ name, kind: 'skipped', rows: 0, note: layout.skip });
      continue;
    }
    const rows = readRows(grid, layout);
    let otherMarks = 0;
    for (const r of rows) {
      otherMarks += r.otherMarks;
      if (layout.kind === 'gst') {
        const split = splitStateFromName(r.value('name'));
        const frequencyRaw = r.value('frequency');
        for (const m of r.marks) months.add(m.month);
        gst.push({
          sheet: name,
          row: r.row,
          name: split.name,
          nameState: split.state,
          gstin: normalizeGstin(r.value('gstin')),
          frequency: parseFrequency(frequencyRaw),
          frequencyRaw,
          pan: r.value('pan').toUpperCase(),
          email: r.value('email'),
          phone: r.value('phone'),
          logins: r.logins,
          halfLogins: r.halfLogins,
          marks: r.marks,
        });
      } else {
        tds.push({
          sheet: name,
          row: r.row,
          name: splitStateFromName(r.value('name')).name,
          pan: r.value('pan').replace(/\s+/g, '').toUpperCase(),
          tan: r.value('tan').replace(/\s+/g, '').toUpperCase(),
          email: r.value('email'),
          phone: r.value('phone'),
          logins: r.logins,
          halfLogins: r.halfLogins,
        });
      }
    }
    const notes = [...layout.notes];
    if (otherMarks)
      notes.push(`${otherMarks} return cell(s) were neither "filed" nor "NA" and were left alone.`);
    sheets.push({ name, kind: layout.kind, rows: rows.length, note: notes.join(' ') || null });
  }
  if (gst.length === 0 && tds.length === 0 && sheets.some((s) => s.kind !== 'skipped'))
    throw new Error('The GST and TDS sheets have no client rows yet.');
  if (gst.length === 0 && tds.length === 0)
    throw new Error(
      'No sheet in the file has client logins: expected a GST sheet (Particular, ID, Pwd, GSTIN) or a TDS sheet (Client name, PAN, TAN, Pwd).',
    );
  return { sheets, months: [...months].sort(), gst, tds };
}

// ── Clients ──────────────────────────────────────────────────────────────

/** A login with what it is for. */
export interface PlannedLogin extends SheetLogin {
  gstin: string | null;
  stateCode: string | null;
  tan: string | null;
  /** The GST frequency to keep with a GST login until its GSTIN comes. */
  frequency: GstFrequency | null;
  target: string;
}

export interface PlannedGst {
  sheet: string;
  row: number;
  gstin: string | null;
  stateCode: string | null;
  frequency: GstFrequency | null;
  marks: MonthMark[];
}

/** One client as the workbook describes it. */
export interface WorkbookClient {
  key: string;
  name: string;
  pan: string | null;
  tan: string | null;
  email: string | null;
  phone: string | null;
  typeSlug: string | null;
  typeGuessed: boolean;
  gst: PlannedGst[];
  logins: PlannedLogin[];
  sources: { sheet: string; row: number }[];
  warnings: string[];
  error: string | null;
}

/** A client's type from its name, only where the name is unambiguous. Pure — tested. */
export function entityTypeFromName(name: string): string | null {
  const v = name.toLowerCase();
  if (/one\s*person|\(opc\)|\bopc\b/.test(v)) return 'opc';
  if (/\bllp\b/.test(v)) return 'llp';
  if (/\bp(vt|rivate)\.?\s*(ltd|limited)\b/.test(v)) return 'private_limited';
  if (/\b(ltd|limited)\b/.test(v)) return 'public_limited';
  if (/\bhuf\b/.test(v)) return 'huf';
  if (/\btrust\b/.test(v)) return 'trust';
  if (/\bsociety\b/.test(v)) return 'society';
  return null;
}

function typeOf(pan: string | null, name: string): string | null {
  const fromName = entityTypeFromName(name);
  const fromPan = pan ? entityTypeFromPan(pan) : null;
  if (fromPan === 'private_limited' && (fromName === 'public_limited' || fromName === 'opc'))
    return fromName;
  if (fromPan === 'partnership' && fromName === 'llp') return 'llp';
  return fromPan ?? fromName;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const stateName = (code: string | null): string =>
  code ? (GST_STATES[code] ?? `State ${code}`) : '';

/**
 * Joins the GST and TDS rows into clients: by PAN (a GSTIN's, or the TDS
 * sheet's), else by name; "Name (Delhi)" and "Name (Maharashtra)" are one
 * client with two GST registrations. Checks each client. Pure — tested.
 */
export function clientsOfWorkbook(
  book: ParsedWorkbook,
  defaultTypeSlug: string | null,
): WorkbookClient[] {
  const clients = new Map<string, WorkbookClient>();
  const blank = (key: string, name: string): WorkbookClient => ({
    key,
    name,
    pan: null,
    tan: null,
    email: null,
    phone: null,
    typeSlug: null,
    typeGuessed: false,
    gst: [],
    logins: [],
    sources: [],
    warnings: [],
    error: null,
  });
  const byName = (name: string): WorkbookClient[] =>
    [...clients.values()].filter((c) => nameKey(c.name) === nameKey(name));
  const fail = (c: WorkbookClient, message: string): void => {
    c.error ??= message;
  };

  // GST rows: a client per PAN, or per name until a PAN is known.
  for (const line of book.gst) {
    const gstin = line.gstin || null;
    const validGstin = gstin !== null && isValidGstin(gstin);
    const pan = validGstin ? panOfGstin(gstin) : isValidPan(line.pan) ? line.pan : null;
    const key = pan ? `pan:${pan}` : `name:${nameKey(line.name)}`;
    const c = clients.get(key) ?? blank(key, line.name);
    clients.set(key, c);
    c.pan ??= pan;
    c.sources.push({ sheet: line.sheet, row: line.row });
    if (!line.name) fail(c, `Row ${line.row} has no client name.`);
    if (gstin && !validGstin)
      fail(
        c,
        `"${gstin}" (row ${line.row}) is not a valid GSTIN — check the characters and the last digit.`,
      );
    const stateCode = validGstin ? stateOfGstin(gstin) : line.nameState;
    if (validGstin && line.nameState && line.nameState !== stateCode)
      c.warnings.push(
        `Row ${line.row}: the name says ${stateName(line.nameState)} but the GSTIN is ${stateName(stateCode)}; the GSTIN is used.`,
      );
    if (line.frequencyRaw && !line.frequency)
      c.warnings.push(
        `Row ${line.row}: frequency "${line.frequencyRaw}" not understood (Monthly / Quarterly).`,
      );
    if (line.email && EMAIL.test(line.email)) c.email ??= line.email;
    if (line.phone.replace(/\D/g, '').length >= 10) c.phone ??= line.phone;
    for (const half of line.halfLogins)
      c.warnings.push(`Row ${line.row}: ${half} has only one of user ID and password; not saved.`);

    const same = c.gst.find((g) =>
      validGstin ? g.gstin === gstin : !g.gstin && g.stateCode === stateCode,
    );
    if (same)
      fail(
        c,
        validGstin
          ? `GSTIN ${gstin} is on rows ${same.row} and ${line.row}.`
          : `Rows ${same.row} and ${line.row} are both ${stateCode ? stateName(stateCode) : 'without a state'} with no GSTIN.`,
      );
    c.gst.push({
      sheet: line.sheet,
      row: line.row,
      gstin: validGstin ? gstin : null,
      stateCode,
      frequency: line.frequency,
      marks: validGstin ? line.marks : [],
    });
    if (!validGstin && line.marks.length)
      c.warnings.push(
        `Row ${line.row}: filed / NA marks need the GSTIN, so they wait until it is in the sheet.`,
      );
    for (const l of line.logins) {
      const target =
        l.portal === 'gst'
          ? validGstin
            ? `GSTIN ${gstin}`
            : stateCode
              ? `${stateName(stateCode)} (GSTIN to come)`
              : 'GSTIN to come'
          : credentialLabel(l.portal, l.account);
      c.logins.push({
        ...l,
        gstin: l.portal === 'gst' && validGstin ? gstin : null,
        stateCode: l.portal === 'gst' ? stateCode : null,
        tan: null,
        frequency: l.portal === 'gst' && !validGstin ? line.frequency : null,
        target,
      });
    }
  }

  // A name-only client joins the one PAN client of the same name.
  for (const [key, c] of [...clients]) {
    if (!key.startsWith('name:')) continue;
    const match = byName(c.name).filter((o) => o !== c && o.pan);
    if (match.length !== 1) continue;
    const into = match[0]!;
    for (const g of c.gst) {
      const clash = !g.gstin && into.gst.find((x) => x.stateCode === g.stateCode);
      if (clash) fail(into, `Row ${g.row} has no GSTIN but row ${clash.row} is the same state.`);
    }
    into.gst.push(...c.gst);
    into.logins.push(...c.logins);
    into.sources.push(...c.sources);
    into.warnings.push(...c.warnings);
    if (c.error) fail(into, c.error);
    into.email ??= c.email;
    into.phone ??= c.phone;
    clients.delete(key);
  }

  // TDS rows join by PAN, else by name.
  for (const line of book.tds) {
    const pan = isValidPan(line.pan) ? line.pan : null;
    let c =
      (pan ? clients.get(`pan:${pan}`) : undefined) ??
      byName(line.name).find((o) => !pan || !o.pan || o.pan === pan);
    if (!c) {
      const key = pan ? `pan:${pan}` : `name:${nameKey(line.name)}`;
      c = clients.get(key) ?? blank(key, line.name);
      clients.set(key, c);
    }
    c.pan ??= pan;
    c.sources.push({ sheet: line.sheet, row: line.row });
    if (!line.name && !c.name) fail(c, `Row ${line.row} of ${line.sheet} has no client name.`);
    if (line.pan && !pan)
      c.warnings.push(
        `${line.sheet} row ${line.row}: "${line.pan}" is not a PAN; kept only as the login.`,
      );
    const tan = isValidTan(line.tan) ? line.tan : null;
    if (line.tan && !tan)
      c.warnings.push(
        `${line.sheet} row ${line.row}: "${line.tan}" is not a TAN; kept only as the login.`,
      );
    if (tan && c.tan && c.tan !== tan)
      c.warnings.push(
        `${line.sheet} row ${line.row}: a second TAN ${tan}; only ${c.tan} is added.`,
      );
    c.tan ??= tan;
    if (line.email && EMAIL.test(line.email)) c.email ??= line.email;
    else if (line.email)
      c.warnings.push(
        `${line.sheet} row ${line.row}: e-mail "${line.email}" skipped (not an address).`,
      );
    if (line.phone.replace(/\D/g, '').length >= 10) c.phone ??= line.phone;
    for (const half of line.halfLogins)
      c.warnings.push(
        `${line.sheet} row ${line.row}: ${half} has only one of user ID and password; not saved.`,
      );
    for (const l of line.logins) {
      const forTan = l.account === 'tan' || l.account === 'deductor';
      c.logins.push({
        ...l,
        gstin: null,
        stateCode: null,
        tan: forTan ? tan : null,
        frequency: null,
        target:
          l.portal === 'income_tax' && l.account === 'main'
            ? 'PAN'
            : forTan && tan
              ? `${credentialLabel(l.portal, l.account)} · TAN ${tan}`
              : credentialLabel(l.portal, l.account),
      });
    }
  }

  for (const c of clients.values()) {
    // The same login twice (two TDS rows): the later row wins.
    const unique = new Map<string, PlannedLogin>();
    for (const l of c.logins) {
      const k = `${l.portal}|${l.account}|${l.gstin ?? l.stateCode ?? ''}`;
      if (unique.has(k)) c.warnings.push(`${l.target} appears twice; the later one is used.`);
      unique.set(k, l);
    }
    c.logins = [...unique.values()];
    const stateless = c.gst.filter((g) => !g.gstin && !g.stateCode);
    if (stateless.length > 1)
      fail(
        c,
        'Several GST rows have neither a GSTIN nor a state in the name, e.g. "Name (Delhi)".',
      );

    c.typeSlug = typeOf(c.pan, c.name);
    if (!c.typeSlug && defaultTypeSlug) {
      c.typeSlug = defaultTypeSlug;
      c.typeGuessed = true;
    }
  }
  const sheetOrder = new Map(book.sheets.map((s, i) => [s.name, i]));
  const first = (c: WorkbookClient) => c.sources[0]!;
  return [...clients.values()].sort(
    (a, b) =>
      (sheetOrder.get(first(a).sheet) ?? 0) - (sheetOrder.get(first(b).sheet) ?? 0) ||
      first(a).row - first(b).row,
  );
}

/** The preview's view of a login. */
export function previewLogin(l: PlannedLogin): ClientImportLogin {
  return {
    portal: l.portal,
    account: l.account,
    usernameHint: usernameHint(l.username),
    target: l.target,
  };
}

/** 'GST Login 5, 6 · TDS Login 9' */
export function sourceLabel(sources: { sheet: string; row: number }[]): string {
  const bySheet = new Map<string, number[]>();
  for (const s of sources) bySheet.set(s.sheet, [...(bySheet.get(s.sheet) ?? []), s.row]);
  return [...bySheet]
    .map(
      ([sheet, rows]) => `${sheet.trim()} ${[...new Set(rows)].sort((a, b) => a - b).join(', ')}`,
    )
    .join(' · ');
}

// ── Filing periods ───────────────────────────────────────────────────────

/** The compliance rules a return column marks. */
export const RULES_OF_FORM: Record<ReturnForm, string[]> = {
  GSTR1: ['GST_GSTR1_M', 'GST_GSTR1_Q'],
  GSTR3B: ['GST_GSTR3B_M', 'GST_GSTR3B_Q'],
  GSTR7: ['GST_GSTR7'],
};

/**
 * The period keys a month's mark can match: the month, and for a quarter's
 * last month the quarter ('2026-06' → '2026-06', '2026-27:Q1'). Pure — tested.
 */
export function periodKeysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const keys = [month];
  if (m % 3 === 0) {
    const fyStart = m >= 4 ? y : y - 1;
    const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
    const q = m >= 4 ? m / 3 - 1 : 4;
    keys.push(`${fy}:Q${q}`);
  }
  return keys;
}
