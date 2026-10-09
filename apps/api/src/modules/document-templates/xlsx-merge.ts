import JSZip from 'jszip';
import { gatherSplitFields } from './docx-merge';

/**
 * Excel template merge engine (02.3 spec §16 "Create Financial Statements
 * Workbook"). A firm workbook template is an ordinary .xlsx whose text cells
 * may carry merge fields written as `{{client.name}}` — the same fields and
 * `[Label]` gaps as the Word templates. Text lives in the shared-string table
 * (`<si>`) and in inline strings (`<is>`); a rich-text cell may split a field
 * across runs, which are gathered back per cell — never across cells. Numbers,
 * formulas and formatting are untouched. Pure: bytes in, bytes out.
 */

const FIELD_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g;
/** One cell's string: a shared-string item or an inline string. */
const STRING_ITEM_RE = /<(si|is)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
/** Text runs inside a string item: `<t>` / `<t xml:space="preserve">`. */
const TEXT_RUN_RE = /(<t(?:\s[^>]*)?>)([^<]*)(<\/t>)/g;
/** The parts of an .xlsx that carry cell text. */
const TEXT_PART_RE = /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/;

export interface XlsxMergeResult {
  buffer: Buffer;
  filled: string[];
  missing: string[];
  unknown: string[];
}

const escapeXml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function loadXlsx(bytes: Buffer): Promise<JSZip> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file('xl/workbook.xml')) throw new Error('missing workbook part');
    return zip;
  } catch {
    throw new Error('The file is not a valid Excel (.xlsx) workbook.');
  }
}

function textParts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((n) => TEXT_PART_RE.test(n));
}

/** Rewrite every string item of a part; `fn` gets the gathered run texts. */
function mapItems(xml: string, fn: (texts: string[]) => string[] | null): string {
  return xml.replace(STRING_ITEM_RE, (item) => {
    const runs = [...item.matchAll(TEXT_RUN_RE)];
    if (runs.length === 0) return item;
    const next = fn(gatherSplitFields(runs.map((r) => r[2]!)));
    if (!next) return item;
    let out = '';
    let cursor = 0;
    runs.forEach((r, idx) => {
      out += item.slice(cursor, r.index!);
      const text = next[idx]!;
      const open =
        text !== r[2] && !/xml:space=/.test(r[1]!)
          ? r[1]!.replace(/^<t/, '<t xml:space="preserve"')
          : r[1]!;
      out += open + text + r[3]!;
      cursor = r.index! + r[0].length;
    });
    return out + item.slice(cursor);
  });
}

/** List the merge fields a workbook template uses. */
export async function scanXlsxFields(bytes: Buffer): Promise<string[]> {
  const zip = await loadXlsx(bytes);
  const found = new Set<string>();
  for (const name of textParts(zip)) {
    mapItems(await zip.file(name)!.async('string'), (texts) => {
      for (const t of texts) for (const m of t.matchAll(FIELD_RE)) found.add(m[1]!);
      return null;
    });
  }
  return [...found].sort();
}

/**
 * Fill a workbook template. `values` maps a field key to its text; null/blank
 * leaves a visible `[label]`; keys not in `known` are left exactly as written.
 */
export async function mergeXlsx(
  bytes: Buffer,
  values: Record<string, string | null | undefined>,
  known: ReadonlyMap<string, string>,
): Promise<XlsxMergeResult> {
  const zip = await loadXlsx(bytes);
  const filled = new Set<string>();
  const missing = new Set<string>();
  const unknown = new Set<string>();
  for (const name of textParts(zip)) {
    const xml = await zip.file(name)!.async('string');
    let changed = false;
    const out = mapItems(xml, (texts) => {
      const next = texts.map((t) =>
        t.replace(FIELD_RE, (whole, key: string) => {
          if (!known.has(key)) {
            unknown.add(key);
            return whole;
          }
          const v = values[key];
          if (v == null || v.trim() === '') {
            missing.add(key);
            return escapeXml(`[${known.get(key)}]`);
          }
          filled.add(key);
          return escapeXml(v);
        }),
      );
      if (next.every((t, i) => t === texts[i])) return null;
      changed = true;
      return next;
    });
    if (changed) zip.file(name, out);
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    buffer,
    filled: [...filled].sort(),
    missing: [...missing].sort(),
    unknown: [...unknown].sort(),
  };
}
