import type { NoticeIntakeField, NoticeIntakeSuggestion } from '@hsdg/contracts';

/**
 * PS-104 · notice intake from the PDF. Pure regex and heuristics over a
 * notice's OCR text (documents.extracted_text) — no I/O — that suggest the
 * "Add notice" form's fields. Every suggestion carries a confidence and the
 * text it was read from; the person confirms each field, nothing is saved here.
 *
 * Confidence tiers:
 *   0.9  read next to its label ("Reference No.", "Date of issue", "on or before",
 *        "FORM GST …", "A.Y.", "Total …").
 *   0.6  an unlabelled value of an unmistakable shape (a GSTIN with a valid
 *        checksum, an ITBA DIN, a GST portal reference), or a date computed
 *        from a stated period ("within 30 days" of the issue date).
 *   0.4  inferred (the PAN inside a GSTIN, the issue date encoded in a GST
 *        reference, the largest amount on the page).
 * The form pre-fills at or above 0.5 and flags anything below 0.8.
 *
 * Formats covered: GST portal notices (ASMT-10, DRC-01, DRC-01A, GSTR-3A, REG,
 * ADT, CMP), CBIC DINs, income-tax e-proceeding / CPC notices (143(2), 142(1),
 * 148A, 139(9), 245, 156, 270A/274), TRACES 200A intimations; dates as
 * dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, "15th October, 2026", "15-Oct-2026",
 * "October 15, 2026"; amounts in ₹ / Rs. / INR with Indian digit grouping.
 */

export type NoticeExtractedFields = Partial<Record<NoticeIntakeField, NoticeIntakeSuggestion>>;

export interface NoticeExtraction {
  fields: NoticeExtractedFields;
  /** The notice_types.code that best fits the form / section read, if any. */
  noticeTypeCode: NoticeIntakeSuggestion | null;
}

const HIGH = 0.9;
const MEDIUM = 0.6;
const LOW = 0.4;

// ── Text helpers ─────────────────────────────────────────────────────────────

/** OCR text with line breaks kept and every other run of whitespace one space. */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[  -​ \t]/g, ' ')
    .replace(/[‐-―]/g, '-')
    .replace(/[ ]{2,}/g, ' ');
}

/** The text around a match, on one line, for the person to check. */
function snippetAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + length + 50);
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) s = `…${s}`;
  if (end < text.length) s = `${s}…`;
  return s;
}

function suggestion(
  value: string,
  confidence: number,
  text: string,
  index: number,
  length: number,
): NoticeIntakeSuggestion {
  return { value, confidence, snippet: snippetAt(text, index, length) };
}

// ── Identifiers ──────────────────────────────────────────────────────────────

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The GSTIN check character (mod-36, alternating weights 1 and 2). Exported for tests. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]!);
    if (v < 0) return '';
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export function isValidGstin(s: string): boolean {
  return (
    /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s) && gstinCheckChar(s.slice(0, 14)) === s[14]
  );
}

function extractGstin(text: string): NoticeIntakeSuggestion | undefined {
  const re = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g;
  let best: { s: NoticeIntakeSuggestion; rank: number } | undefined;
  for (const m of text.matchAll(re)) {
    const g = m[1]!;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const labelled = /GSTIN|GST\s*(?:IN|No|Registration)|UIN/i.test(before);
    const valid = isValidGstin(g);
    const confidence = valid ? (labelled ? HIGH : MEDIUM) : LOW;
    const rank = confidence * 10 - m.index / 1e7;
    if (!best || rank > best.rank)
      best = { s: suggestion(g, confidence, text, m.index, g.length), rank };
  }
  return best?.s;
}

/** PAN: 5 letters (4th the holder type), 4 digits, a letter. */
const PAN_RE = /\b([A-Z]{3}[ABCFGHJLPTK][A-Z]\d{4}[A-Z])\b/g;

function extractPan(
  text: string,
  gstin: NoticeIntakeSuggestion | undefined,
): NoticeIntakeSuggestion | undefined {
  let unlabelled: NoticeIntakeSuggestion | undefined;
  for (const m of text.matchAll(PAN_RE)) {
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    // A TAN-holder's notice may also print the deductor's TAN; that is a different shape.
    if (/\bPAN\b|Permanent\s+Account\s+Number/i.test(before))
      return suggestion(m[1]!, HIGH, text, m.index, m[1]!.length);
    unlabelled ??= suggestion(m[1]!, MEDIUM, text, m.index, m[1]!.length);
  }
  if (unlabelled) return unlabelled;
  // Characters 3–12 of a GSTIN are the holder's PAN.
  if (gstin && gstin.confidence >= MEDIUM) {
    return { value: gstin.value.slice(2, 12), confidence: LOW, snippet: gstin.snippet };
  }
  return undefined;
}

/** Income-tax ITBA DIN: ITBA/AST/S/143(2)/2026-27/1071234567(1). */
const ITBA_DIN_RE =
  /\bITBA\/[A-Z]{2,6}\/[A-Z0-9]{1,4}\/[A-Z0-9()]+(?:\/[A-Z0-9()]+)*?\/\d{4}-\d{2}\/\d{10}(?:\(\d{1,2}\))?/g;
/** CBIC DIN: "CBIC-" and 20 characters, often printed in groups. */
const CBIC_DIN_RE = /\bCBIC\s?-\s?((?:[A-Z0-9]\s?){19}[A-Z0-9])(?![A-Z0-9])/g;
/** GST portal reference: ZD + state + ddmmyy + a 5–7 character serial. */
const GST_REF_RE = /\b(Z[A-Z]\d{2}(\d{6})[0-9A-Z]{5,7})\b/g;

interface RefLabel {
  re: RegExp;
  /** Lower is preferred when a notice prints several. */
  priority: number;
}
const REF_LABELS: RefLabel[] = [
  {
    re: /\b(?:DIN\s*(?:&|and)\s*Notice\s*No|Notice\s*No|Reference\s*(?:No|Number)|Ref\.?\s*No|SCN\s*No|Communication\s+Reference\s+(?:No|Number)|Intimation\s+(?:Reference\s+)?(?:No|Number)|Order\s+No)\b\.?\s*(?:\([A-Z]+\))?\s*[:\-–]?\s*/gi,
    priority: 1,
  },
  {
    re: /\b(?:Document\s+Identification\s+Number|DIN)\s*(?:\(DIN\))?\.?\s*(?:No\.?)?\s*[:\-–]?\s*/gi,
    priority: 2,
  },
  { re: /\bToken\s+(?:No|Number)\.?\s*[:\-–]?\s*/gi, priority: 3 },
];

function cleanToken(t: string): string {
  return t.replace(/[.,;:]+$/, '');
}

function extractReference(text: string): NoticeIntakeSuggestion | undefined {
  let best: { s: NoticeIntakeSuggestion; priority: number; index: number } | undefined;
  for (const label of REF_LABELS) {
    for (const m of text.matchAll(label.re)) {
      const at = m.index + m[0].length;
      const rest = text.slice(at, at + 60);
      let value: string | undefined;
      const cbic = /^CBIC\s?-\s?((?:[A-Z0-9]\s?){19}[A-Z0-9])(?![A-Z0-9])/.exec(rest);
      if (cbic) value = `CBIC-${cbic[1]!.replace(/\s/g, '')}`;
      else {
        const tok = /^([A-Z0-9][A-Z0-9/()\-.]{4,79})/i.exec(rest);
        if (tok) {
          const t = cleanToken(tok[1]!);
          // A reference has digits, and is not a date or a bare word.
          if (/\d/.test(t) && !DATE_ONLY_RE.test(t) && t.length >= 5) value = t.toUpperCase();
        }
      }
      if (!value) continue;
      if (
        !best ||
        label.priority < best.priority ||
        (label.priority === best.priority && m.index < best.index)
      ) {
        best = {
          s: suggestion(value, HIGH, text, m.index, m[0].length + value.length),
          priority: label.priority,
          index: m.index,
        };
      }
    }
  }
  if (best) return best.s;

  // Unlabelled, in order of how sure the shape is.
  for (const re of [GST_REF_RE, ITBA_DIN_RE]) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) return suggestion(m[1] ?? m[0], MEDIUM, text, m.index, m[0].length);
  }
  CBIC_DIN_RE.lastIndex = 0;
  const c = CBIC_DIN_RE.exec(text);
  if (c) return suggestion(`CBIC-${c[1]!.replace(/\s/g, '')}`, MEDIUM, text, c.index, c[0].length);
  return undefined;
}

// ── Dates ────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH =
  '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_NUM = String.raw`(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})`;
const DATE_DMY = String.raw`(\d{1,2})(?:st|nd|rd|th)?[\s\-]+(?:of\s+)?${MONTH}\.?,?[\s\-]+(\d{4})`;
const DATE_MDY = String.raw`${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`;
const DATE_RE = new RegExp(`\\b(?:${DATE_NUM}|${DATE_DMY}|${DATE_MDY})\\b`, 'gi');
const DATE_ONLY_RE = new RegExp(`^(?:${DATE_NUM}|${DATE_DMY}|${DATE_MDY})$`, 'i');

function monthOf(name: string): number {
  return MONTHS[name.slice(0, 3).toLowerCase()] ?? 0;
}

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function lastDayOfMonth(y: number, m: number): string {
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

interface DateHit {
  iso: string;
  index: number;
  length: number;
}

/** Every date in the text, in Indian day-first order. Exported for tests. */
export function findDates(text: string): DateHit[] {
  const out: DateHit[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    let iso: string | null = null;
    if (m[1]) iso = isoDate(+m[3]!, +m[2]!, +m[1]);
    else if (m[4]) iso = isoDate(+m[6]!, monthOf(m[5]!), +m[4]);
    else if (m[7]) iso = isoDate(+m[9]!, monthOf(m[7]), +m[8]!);
    if (iso) out.push({ iso, index: m.index, length: m[0].length });
  }
  return out;
}

type DateRole = 'reply' | 'hearing' | 'period' | 'issue' | 'other' | null;

const ROLE_PATTERNS: { role: Exclude<DateRole, null>; re: RegExp }[] = [
  { role: 'hearing', re: /hearing|appear\s+(?:before|in\s+person)|personally\s+appear/gi },
  {
    role: 'reply',
    re: /on\s+or\s+before|reply\s+(?:is\s+)?(?:due|by|before|on)|due\s+date(?:\s+(?:of|for)\s+[a-z ]{3,30}?)?\s*[:\-–]?|last\s+date(?:\s+(?:of|for)\s+[a-z ]{3,30}?)?\s*[:\-–]?|by\s+which|not\s+later\s+than|response\s+(?:due|by)|date\s+(?:of|for)\s+(?:submission|reply|compliance|response)|reply\s+to\s+be\s+(?:filed|submitted)|(?:submit|furnish|file|pa(?:y|id))\w*\b[^.\n]{0,80}?\bby\b|\b(?:by|latest\s+by)\s*$|directed\s+to\s+attend[^.\n]{0,100}?\bon\s*$|compliance\s+(?:date|by)/gi,
  },
  { role: 'period', re: /period|from\b|\bto\b\s*$|quarter/gi },
  {
    role: 'other',
    re: /filed\b[^.\n]{0,20}?\bon\s*$|date\s+of\s+filing|furnished\s+on|order\s+dated|letter\s+dated|vide|return\s+(?:of\s+income\s+)?(?:filed|dated)|processed\s+on|acknowledg|received\s+on|earlier\s+notice|intimation\s+dated|issued\s+on\s+(?:the\s+)?(?:return|order)/gi,
  },
  {
    role: 'issue',
    re: /date\s+of\s+(?:issue|notice|intimation|communication|order|processing)|issue\s+date|notice\s+date|^\s*dated|\bdated\s*[:\-]|(?<!(?:due|last|hearing|reply)\s)\bdate\s*[:\-–]|\bdated\b/gim,
  },
];

/**
 * What a date is, from the words just before it on its line (after any
 * earlier date): the keyword nearest the date wins.
 */
function roleOf(text: string, hit: DateHit, prevEnd: number): DateRole {
  const lineStart = text.lastIndexOf('\n', hit.index - 1) + 1;
  const from = Math.max(lineStart, prevEnd, hit.index - 110);
  let ctx = text.slice(from, hit.index);
  // A table prints the label on the line above its value.
  if (!/[A-Za-z]/.test(ctx) && from === lineStart && lineStart > 0 && prevEnd < lineStart) {
    const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    ctx = text.slice(Math.max(prevStart, prevEnd), lineStart - 1);
  }
  let best: { role: DateRole; end: number } = { role: null, end: -1 };
  for (const { role, re } of ROLE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of ctx.matchAll(re)) {
      const end = m.index + m[0].length;
      // Nearest keyword wins; on a tie the more specific (earlier listed) role keeps it.
      if (end > best.end) best = { role, end };
    }
  }
  return best.role;
}

/** Number words a notice uses for its reply period. */
const NUMBER_WORDS: Record<string, number> = {
  three: 3,
  five: 5,
  seven: 7,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  'twenty-one': 21,
  'twenty one': 21,
  thirty: 30,
  'forty-five': 45,
  sixty: 60,
};

function extractDates(
  text: string,
  gstRef: NoticeIntakeSuggestion | undefined,
): { issuedOn?: NoticeIntakeSuggestion; replyDueOn?: NoticeIntakeSuggestion } {
  const hits = findDates(text);
  let issue: NoticeIntakeSuggestion | undefined;
  let reply: NoticeIntakeSuggestion | undefined;
  let firstFree: DateHit | undefined;
  let prevEnd = 0;
  for (const h of hits) {
    const role = roleOf(text, h, prevEnd);
    prevEnd = h.index + h.length;
    if (role === 'issue' && !issue) issue = suggestion(h.iso, HIGH, text, h.index, h.length);
    else if (role === 'reply' && !reply) reply = suggestion(h.iso, HIGH, text, h.index, h.length);
    else if (role === null && !firstFree) firstFree = h;
  }

  if (!issue && firstFree) {
    issue = suggestion(
      firstFree.iso,
      firstFree.index < 600 ? MEDIUM : LOW,
      text,
      firstFree.index,
      firstFree.length,
    );
  }
  // The GST portal's reference carries the date it was generated (ddmmyy).
  if (!issue && gstRef) {
    const m = /^Z[A-Z]\d{2}(\d{2})(\d{2})(\d{2})/.exec(gstRef.value);
    const iso = m ? isoDate(2000 + +m[3]!, +m[2]!, +m[1]!) : null;
    if (iso) issue = { value: iso, confidence: LOW, snippet: gstRef.snippet };
  }

  // "within 30 days" / "within a period of thirty days" — from the issue date.
  if (!reply && issue) {
    const words = Object.keys(NUMBER_WORDS).join('|');
    const re = new RegExp(
      `within\\s+(?:a\\s+period\\s+of\\s+)?(\\d{1,3}|${words})\\s*(?:\\(\\s*\\d{1,3}\\s*\\)\\s*)?days?`,
      'i',
    );
    const m = re.exec(text);
    if (m) {
      const raw = m[1]!.toLowerCase();
      const n = /^\d+$/.test(raw) ? +raw : (NUMBER_WORDS[raw] ?? 0);
      if (n > 0 && n <= 365) {
        reply = suggestion(addDays(issue.value, n), MEDIUM, text, m.index, m[0].length);
      }
    }
  }
  // A reply date before the notice was issued is a misread.
  if (reply && issue && reply.value < issue.value) reply = undefined;
  return {
    ...(issue ? { issuedOn: issue } : {}),
    ...(reply ? { replyDueOn: reply } : {}),
  };
}

// ── Section, form, years, period, amount ─────────────────────────────────────

const SECTION_CORE = String.raw`(\d{1,3}[A-Z]{0,2})((?:\s?\(\s?[0-9A-Za-z]{1,4}\s?\))*)`;

function formatSection(num: string, subs: string): string {
  const s = subs.replace(/\s/g, '');
  return `s.${num.toUpperCase()}${s}`;
}

function extractSection(text: string): NoticeIntakeSuggestion | undefined {
  // "under sub-section (1) of section 142"
  const sub = new RegExp(
    String.raw`\bsub-?\s?section\s*\(\s?([0-9A-Za-z]{1,4})\s?\)\s*of\s+section\s+(\d{1,3}[A-Z]{0,2})`,
    'i',
  );
  const labelled = new RegExp(
    String.raw`\b(?:u\/s\.?|u\/sec\.?|under\s+section|notice\s+(?:of\s+demand\s+)?under\s+section|intimation\s+under\s+section)\s*${SECTION_CORE}`,
    'i',
  );
  const candidates: { s: NoticeIntakeSuggestion; index: number }[] = [];
  const a = labelled.exec(text);
  if (a)
    candidates.push({
      s: suggestion(formatSection(a[1]!, a[2] ?? ''), HIGH, text, a.index, a[0].length),
      index: a.index,
    });
  const b = sub.exec(text);
  if (b)
    candidates.push({
      s: suggestion(formatSection(b[2]!, `(${b[1]!})`), HIGH, text, b.index, b[0].length),
      index: b.index,
    });
  if (candidates.length) return candidates.sort((x, y) => x.index - y.index)[0]!.s;
  const loose = new RegExp(String.raw`\bsection\s+${SECTION_CORE}`, 'i').exec(text);
  if (loose)
    return suggestion(
      formatSection(loose[1]!, loose[2] ?? ''),
      MEDIUM,
      text,
      loose.index,
      loose[0].length,
    );
  return undefined;
}

const FORM_RE =
  /\b(ASMT|DRC|REG|ADT|CMP|GSTR|STK|RFD|MOV|APL|PMT)\s?-?\s?(\d{1,2})(?:\s?([A-C]))?(?![0-9A-Z])/gi;

function extractForm(text: string): NoticeIntakeSuggestion | undefined {
  let unlabelled: NoticeIntakeSuggestion | undefined;
  for (const m of text.matchAll(FORM_RE)) {
    const prefix = m[1]!.toUpperCase();
    const num = prefix === 'GSTR' || prefix === 'STK' ? m[2]! : m[2]!.padStart(2, '0');
    const value = `${prefix}-${num}${(m[3] ?? '').toUpperCase()}`;
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (/\bFORM\s*(?:GST\s*)?$/i.test(before))
      return suggestion(value, HIGH, text, m.index, m[0].length);
    unlabelled ??= suggestion(value, MEDIUM, text, m.index, m[0].length);
  }
  return unlabelled;
}

function yearPair(a: string, b: string): string | null {
  const start = +a;
  const end = b.length === 4 ? +b : Math.floor(start / 100) * 100 + +b;
  if (end !== start + 1) return null;
  return `${start}-${String(end % 100).padStart(2, '0')}`;
}

function extractYear(text: string, label: RegExp): NoticeIntakeSuggestion | undefined {
  const re = new RegExp(
    `${label.source}\\s*[:\\-–]?\\s*(\\d{4})\\s*[-–/]\\s*(\\d{4}|\\d{2})\\b`,
    'gi',
  );
  for (const m of text.matchAll(re)) {
    const v = yearPair(m[1]!, m[2]!);
    if (v) return suggestion(v, HIGH, text, m.index, m[0].length);
  }
  return undefined;
}

function extractPeriod(text: string): {
  periodFrom?: NoticeIntakeSuggestion;
  periodTo?: NoticeIntakeSuggestion;
} {
  const label =
    /\b(?:tax\s+period|return\s+period|for\s+the\s+period|period)\b\s*(?:from\s*)?[:\-–]?\s*/gi;
  for (const m of text.matchAll(label)) {
    const at = m.index + m[0].length;
    const lineEnd = text.indexOf('\n', at);
    const rest = text.slice(at, lineEnd === -1 ? undefined : lineEnd).slice(0, 80);
    const dates = findDates(rest);
    if (dates.length >= 2 && dates[0]!.index < 5) {
      const len = dates[1]!.index + dates[1]!.length;
      const snip = snippetAt(text, m.index, m[0].length + len);
      return {
        periodFrom: { value: dates[0]!.iso, confidence: HIGH, snippet: snip },
        periodTo: { value: dates[1]!.iso, confidence: HIGH, snippet: snip },
      };
    }
    // Month-year: "April, 2024 to March, 2025", "Sep-2026", "August 2026".
    const my = new RegExp(`${MONTH}\\.?[,\\s\\-']*(\\d{4})`, 'gi');
    const months = [...rest.matchAll(my)];
    if (months.length && months[0]!.index! < 5) {
      const f = months[0]!;
      const t = months[1] ?? f;
      const fy = +f[2]!;
      const ty = +t[2]!;
      const from = isoDate(fy, monthOf(f[1]!), 1);
      const to = lastDayOfMonth(ty, monthOf(t[1]!));
      if (from && to >= from) {
        const len = t.index! + t[0].length;
        const snip = snippetAt(text, m.index, m[0].length + len);
        return {
          periodFrom: { value: from, confidence: HIGH, snippet: snip },
          periodTo: { value: to, confidence: HIGH, snippet: snip },
        };
      }
    }
  }
  return {};
}

/** "1,23,456.50" → "123456.50". */
function toDecimal(raw: string): string | null {
  const digits = raw.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  const [int, frac = ''] = digits.split('.');
  return `${BigInt(int!).toString()}.${frac.padEnd(2, '0')}`;
}

function extractAmount(text: string): NoticeIntakeSuggestion | undefined {
  type Cand = { value: string; score: number; index: number; length: number; num: number };
  const cands: Cand[] = [];
  const scoreCtx = (ctx: string): number => {
    let s = 0;
    if (/total/i.test(ctx)) s += 2;
    if (/demand|payable|outstanding|recoverable|short\s*paid|liability/i.test(ctx)) s += 2;
    if (/tax|interest|penalty|default|fee/i.test(ctx)) s += 1;
    if (
      /refund|turnover|receipts|more\s+than|exceed|paid\s+by\s+you|already\s+paid|threshold|limit/i.test(
        ctx,
      )
    )
      s -= 3;
    return s;
  };
  // Currency-marked amounts.
  const cur = /(?:₹|\bRs\.?|\bINR)\s*([\d,]+(?:\.\d{1,2})?)(?:\s*\/-)?/gi;
  for (const m of text.matchAll(cur)) {
    const value = toDecimal(m[1]!);
    if (!value || +value === 0) continue;
    const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
    const ctx = text.slice(Math.max(lineStart, m.index - 80), m.index);
    cands.push({ value, score: scoreCtx(ctx), index: m.index, length: m[0].length, num: +value });
  }
  // A "Total" row of a demand table: its last figure is the total column.
  for (const m of text.matchAll(/^\s*(?:Grand\s+)?Total\b[^\n]*$/gim)) {
    const nums = [...m[0].matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)];
    const last = nums[nums.length - 1];
    if (!last) continue;
    const value = toDecimal(last[0]);
    if (!value || +value === 0) continue;
    cands.push({
      value,
      score: 3,
      index: m.index + last.index!,
      length: last[0].length,
      num: +value,
    });
  }
  if (!cands.length) return undefined;
  cands.sort((a, b) => b.score - a.score || b.num - a.num);
  const top = cands[0]!;
  if (top.score < 0) return undefined;
  const confidence = top.score >= 2 ? HIGH : top.score === 1 ? MEDIUM : LOW;
  return suggestion(top.value, confidence, text, top.index, top.length);
}

// ── Notice type ──────────────────────────────────────────────────────────────

const FORM_TO_CODE: Record<string, string> = {
  'ASMT-10': 'GST_ASMT10',
  'DRC-01A': 'GST_DRC01A',
  'DRC-01': 'GST_DRC01',
  'GSTR-3A': 'GST_GSTR3A',
  'REG-03': 'GST_REG03',
  'REG-17': 'GST_REG17',
  'ADT-01': 'GST_ADT01',
  'ADT-02': 'GST_ADT02',
  'DRC-07': 'GST_DRC07',
  'CMP-05': 'GST_CMP05',
  'STK-1': 'ROC_STK1',
};

/** Section (normalised "s.143(2)") → code, most specific first. */
const SECTION_TO_CODE: [RegExp, string, 'it' | 'tds' | 'roc' | 'gst' | 'any'][] = [
  [/^s\.139\(9\)/, 'IT_139_9', 'any'],
  [/^s\.143\(1\)\(a\)/, 'IT_143_1A', 'any'],
  [/^s\.143\(2\)/, 'IT_143_2', 'any'],
  [/^s\.142\(1\)/, 'IT_142_1', 'any'],
  [/^s\.148A/, 'IT_148A', 'any'],
  [/^s\.148(?![0-9A-Z])/, 'IT_148', 'any'],
  [/^s\.133\(6\)/, 'IT_133_6', 'any'],
  [/^s\.245(?![0-9A-Z])/, 'IT_245', 'any'],
  [/^s\.156(?![0-9A-Z])/, 'IT_156', 'any'],
  [/^s\.(?:270A|274)(?![0-9A-Z])/, 'IT_270A_274', 'any'],
  [/^s\.200A/, 'TDS_200A', 'any'],
  [/^s\.201(?![0-9A-Z])/, 'TDS_201', 'any'],
  [/^s\.154(?![0-9A-Z])/, 'TDS_154', 'tds'],
  [/^s\.206(?![0-9A-Z])/, 'ROC_206', 'roc'],
  [/^s\.454(?![0-9A-Z])/, 'ROC_454', 'roc'],
  [/^s\.248(?![0-9A-Z])/, 'ROC_STK1', 'roc'],
  [/^s\.61(?![0-9A-Z])/, 'GST_ASMT10', 'gst'],
  [/^s\.46(?![0-9A-Z])/, 'GST_GSTR3A', 'gst'],
];

function streamHint(text: string): 'gst' | 'tds' | 'roc' | 'it' {
  if (/\bCGST\b|\bSGST\b|Goods\s+and\s+Services\s+Tax|\bGSTIN\b/i.test(text)) return 'gst';
  if (/\bTRACES\b|\bTDS\b|\bTAN\b|Tax\s+Deduct/i.test(text)) return 'tds';
  if (/Companies\s+Act|Registrar\s+of\s+Companies|\bROC\b|\bCIN\b/i.test(text)) return 'roc';
  return 'it';
}

function noticeTypeFor(
  text: string,
  form: NoticeIntakeSuggestion | undefined,
  section: NoticeIntakeSuggestion | undefined,
): NoticeIntakeSuggestion | null {
  if (form) {
    const code = FORM_TO_CODE[form.value];
    if (code) return { value: code, confidence: form.confidence, snippet: form.snippet };
  }
  if (section) {
    const hint = streamHint(text);
    for (const [re, code, stream] of SECTION_TO_CODE) {
      if (!re.test(section.value)) continue;
      if (stream !== 'any' && stream !== hint) continue;
      return { value: code, confidence: section.confidence, snippet: section.snippet };
    }
  }
  return null;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** Suggest the notice form's fields from its OCR text. Pure; never throws. */
export function extractNoticeFields(raw: string | null | undefined): NoticeExtraction {
  if (!raw || !raw.trim()) return { fields: {}, noticeTypeCode: null };
  const text = normalise(raw);
  const fields: NoticeExtractedFields = {};
  const put = (k: NoticeIntakeField, s: NoticeIntakeSuggestion | undefined) => {
    if (s) fields[k] = s;
  };

  const gstin = extractGstin(text);
  put('gstin', gstin);
  put('pan', extractPan(text, gstin));
  const ref = extractReference(text);
  put('referenceNo', ref);
  const gstRef = ref && /^Z[A-Z]\d{8}/.test(ref.value) ? ref : undefined;
  const dates = extractDates(text, gstRef);
  put('issuedOn', dates.issuedOn);
  put('replyDueOn', dates.replyDueOn);
  const section = extractSection(text);
  put('section', section);
  const form = extractForm(text);
  put('form', form);
  put('amountDemanded', extractAmount(text));
  put('financialYear', extractYear(text, /\b(?:F\.?\s?Y\.?|Financial\s+Year)/));
  put('assessmentYear', extractYear(text, /\b(?:A\.?\s?Y\.?|Assessment\s+Year)/));
  const period = extractPeriod(text);
  put('periodFrom', period.periodFrom);
  put('periodTo', period.periodTo);

  return { fields, noticeTypeCode: noticeTypeFor(text, form, section) };
}
