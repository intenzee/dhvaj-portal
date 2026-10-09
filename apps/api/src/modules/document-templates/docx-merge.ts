import JSZip from 'jszip';

/**
 * Word template merge engine (Section 01 spec §2 "Create from Template").
 *
 * A firm template is an ordinary .docx carrying merge fields written as
 * `{{client.name}}`. Word often splits what the author typed across several
 * formatting runs (`{{cli` | `ent.na` | `me}}`), so the engine first gathers
 * each split field back into the run where it starts — the other runs keep
 * their formatting and simply lose those characters — and then replaces the
 * fields. Pure: bytes in, bytes out; no database, no network.
 */

const FIELD_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g;
/** Text runs: `<w:t>` / `<w:t xml:space="preserve">`. */
const TEXT_RUN_RE = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
/** The parts of a .docx that carry visible text. */
const TEXT_PART_RE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

export interface DocxMergeResult {
  buffer: Buffer;
  /** Fields that had a value and were filled. */
  filled: string[];
  /** Known fields with no value — left as a visible `[Label]` to complete by hand. */
  missing: string[];
  /** Fields the engine does not know — left exactly as written. */
  unknown: string[];
}

interface TextRun {
  open: string;
  text: string;
  close: string;
  start: number;
  end: number;
}

function textRuns(xml: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const m of xml.matchAll(TEXT_RUN_RE)) {
    runs.push({
      open: m[1]!,
      text: m[2]!,
      close: m[3]!,
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }
  return runs;
}

/**
 * Move every field that spans several runs into the run where it begins, so
 * each field afterwards sits inside a single `<w:t>`. Returns the new texts.
 */
export function gatherSplitFields(texts: string[]): string[] {
  const out = [...texts];
  const offsets: number[] = [];
  let acc = 0;
  for (const t of texts) {
    offsets.push(acc);
    acc += t.length;
  }
  const joined = texts.join('');
  const runAt = (pos: number) => {
    let i = offsets.length - 1;
    while (i > 0 && offsets[i]! > pos) i--;
    return i;
  };
  const matches = [...joined.matchAll(FIELD_RE)].reverse(); // last first: offsets stay valid
  for (const m of matches) {
    const s = m.index!;
    const e = s + m[0].length;
    const i = runAt(s);
    const j = runAt(e - 1);
    if (i === j) continue;
    const head = out[i]!.slice(0, s - offsets[i]!);
    const tail = out[j]!.slice(e - offsets[j]!);
    out[i] = head + m[0];
    for (let k = i + 1; k < j; k++) out[k] = '';
    out[j] = tail;
  }
  return out;
}

const escapeXml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The merge fields used in a template part's text. */
function fieldsIn(texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(FIELD_RE)) found.add(m[1]!);
  return [...found];
}

async function loadDocx(bytes: Buffer): Promise<JSZip> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file('word/document.xml')) throw new Error('missing document part');
    return zip;
  } catch {
    throw new Error('The file is not a valid Word (.docx) document.');
  }
}

function textParts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((n) => TEXT_PART_RE.test(n));
}

/** List the merge fields a template uses (after re-joining split fields). */
export async function scanDocxFields(bytes: Buffer): Promise<string[]> {
  const zip = await loadDocx(bytes);
  const found = new Set<string>();
  for (const name of textParts(zip)) {
    const xml = await zip.file(name)!.async('string');
    const texts = gatherSplitFields(textRuns(xml).map((r) => r.text));
    for (const f of fieldsIn(texts)) found.add(f);
  }
  return [...found].sort();
}

/**
 * Fill a template. `values` maps a field key to its text; null/blank = no value
 * (left as `[label]`). Keys not in `known` are left exactly as written.
 * Multi-line values become line breaks inside the paragraph.
 */
export async function mergeDocx(
  bytes: Buffer,
  values: Record<string, string | null | undefined>,
  known: ReadonlyMap<string, string>,
): Promise<DocxMergeResult> {
  const zip = await loadDocx(bytes);
  const filled = new Set<string>();
  const missing = new Set<string>();
  const unknown = new Set<string>();

  for (const name of textParts(zip)) {
    const xml = await zip.file(name)!.async('string');
    const runs = textRuns(xml);
    if (runs.length === 0) continue;
    const gathered = gatherSplitFields(runs.map((r) => r.text));
    let changed = false;
    const replaced = gathered.map((t, idx) => {
      const next = t.replace(FIELD_RE, (whole, key: string) => {
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
        return escapeXml(v).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
      });
      if (next !== runs[idx]!.text) changed = true;
      return next;
    });
    if (!changed) continue;

    let out = '';
    let cursor = 0;
    runs.forEach((r, idx) => {
      out += xml.slice(cursor, r.start);
      const text = replaced[idx]!;
      // A run whose text changed keeps leading/trailing spaces.
      const open =
        text !== r.text && !/xml:space=/.test(r.open)
          ? r.open.replace(/^<w:t/, '<w:t xml:space="preserve"')
          : r.open;
      out += open + text + r.close;
      cursor = r.end;
    });
    out += xml.slice(cursor);
    zip.file(name, out);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    buffer,
    filled: [...filled].sort(),
    missing: [...missing].sort(),
    unknown: [...unknown].sort(),
  };
}
