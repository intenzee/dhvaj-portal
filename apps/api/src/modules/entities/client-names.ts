import {
  GST_STATES,
  guessStateCode,
  isValidGstin,
  normalizeGstin,
  panOfGstin,
} from '@hsdg/contracts';

/**
 * Reading a client's name the way the firm writes it, and telling whether two
 * clients are one. A name carries more than the name: a legal form ("Pvt
 * Ltd", "- Firm", "(Prop)"), a place ("- Chandigarh", "(Delhi"), a
 * proprietor ("- Jatin Dagar (Prop)"), typos and plurals ("Technology" /
 * "Technologies"). The tax IDs decide; the name only suggests.
 */

/** The legal form a name (or a PAN) says. `firm` and `proprietor` are loose — people write "Firm" for a company. */
export type NameForm =
  | 'company'
  | 'llp'
  | 'firm'
  | 'proprietor'
  | 'huf'
  | 'trust'
  | 'society'
  | 'aop'
  /** A PAN's F: a partnership firm or an LLP. */
  | 'firm_or_llp';

export interface ParsedClientName {
  raw: string;
  /** The name without its legal form, place and proprietor: 'Khatri RoadLines'. */
  core: string;
  /** The core's words, lower-case: ['khatri', 'roadlines']. */
  words: string[];
  /** The core's words with plurals folded ('technologies' → 'technology'), joined. */
  key: string;
  form: NameForm | null;
  /** The words that said the form, as written: 'Private Limited'. */
  formText: string | null;
  place: { text: string; state: string | null } | null;
  /** A qualifier after a dash that is neither a place nor a form, usually the proprietor. */
  qualifier: string | null;
}

/** Legal-form phrases, longest first, as a regex over a lower-cased name's tail. */
const FORMS: [RegExp, NameForm][] = [
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

const SEPARATOR = /\s+[-–]\s*|\s*[-–]\s+|\s*,\s*/;

function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–,.(]+|[\s\-–,(]+$/g, '')
    .trim();
}

/** The trailing legal form of a name, if any: 'Drift Logistics Pvt. Ltd.' → company. */
function takeForm(name: string): { rest: string; form: NameForm; text: string } | null {
  const lower = name.toLowerCase();
  for (const [re, form] of FORMS) {
    const m = re.exec(lower);
    if (!m) continue;
    const rest = name.slice(0, m.index);
    if (!tidy(rest)) return null;
    return { rest, form, text: tidy(name.slice(m.index).replace(/[()]/g, '')) };
  }
  return null;
}

/** A place someone set apart after the name: '(Delhi', '- Chandigarh', ', Gujarat'. */
function takePlace(name: string): { rest: string; text: string; state: string } | null {
  // A bracket, closed or not, at the end.
  const bracket = /^(.*?)\s*[([]\s*([^()[\]]+?)\s*[)\]]?\s*$/.exec(name);
  if (bracket?.[1] && tidy(bracket[1])) {
    const state = guessStateCode(bracket[2]!);
    if (state) return { rest: bracket[1], text: tidy(bracket[2]!), state };
  }
  const parts = name.split(SEPARATOR);
  if (parts.length > 1) {
    const tail = parts[parts.length - 1]!;
    const head = name.slice(0, name.lastIndexOf(tail));
    if (/^[A-Za-z .&]+$/.test(tail) && tidy(head)) {
      const state = guessStateCode(tail);
      if (state) return { rest: head, text: tidy(tail), state };
    }
  }
  return null;
}

/**
 * "ABC Traders (Delhi)" → { name: 'ABC Traders', state: '07' }, forgiving an
 * unclosed bracket, a dash without spaces and a typo ("(Gurjrat)", "GRIID-
 * Chandigarh"). The legal form stays in the name. Pure — tested.
 */
export function splitPlaceFromName(raw: string): { name: string; state: string | null } {
  const full = raw.replace(/\s+/g, ' ').trim();
  const p = takePlace(full);
  return p ? { name: tidy(p.rest), state: p.state } : { name: full, state: null };
}

/** 'technologies' → 'technology', 'estates' → 'estate'; a word's plural folded so typos of number match. */
function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function wordsOf(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * 'M/s Jai Hanuman- Jatin Dagar (Prop)' → core 'Jai Hanuman', form proprietor,
 * qualifier 'Jatin Dagar'. 'Drifts Logistics Private Limited (Delhi' → core
 * 'Drifts Logistics', company, place Delhi. Pure — tested.
 */
export function parseClientName(raw: string): ParsedClientName {
  let rest: string = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(m\s*\/\s*s\.?|messrs\.?)\s*/i, '');
  let form: NameForm | null = null;
  let formText: string | null = null;
  let place: ParsedClientName['place'] = null;
  let qualifier: string | null = null;

  // Peel forms and places off the end, in whatever order they were written:
  // "Khatri RoadLines Pvt Ltd (Delhi)", "GRIID- Chandigarh", "Avtar Woods- Firm".
  for (let guard = 0; guard < 4; guard += 1) {
    // A second form of the same kind goes too: "Neha Gupta OPC Private Limited".
    const f: ReturnType<typeof takeForm> = takeForm(rest);
    if (f && (!form || f.form === form)) {
      formText = form ? `${f.text} ${formText}` : f.text;
      form = f.form;
      rest = tidy(f.rest);
      continue;
    }
    const p: ReturnType<typeof takePlace> = place ? null : takePlace(rest);
    if (p) {
      place = { text: p.text, state: p.state };
      rest = tidy(p.rest);
      continue;
    }
    break;
  }

  // "Jai Hanuman- Jatin Dagar (Prop)": after a dash, the proprietor — when the
  // name says Prop, or the tail reads as a person's name (two or three
  // capitalised words). "Sharma - Sons" keeps its dash.
  const parts = rest.split(/\s+[-–]\s*|\s*[-–]\s+/);
  if (parts.length === 2 && tidy(parts[0]!)) {
    const tail = tidy(parts[1]!);
    const personLike = /^[A-Z][a-z]+(\s+[A-Z]\.?)?(\s+[A-Z][a-z]+){1,2}$/.test(tail);
    if ((form === 'proprietor' && wordsOf(tail).length <= 4) || personLike) {
      qualifier = tail;
      rest = tidy(parts[0]!);
    }
  }

  const core = tidy(rest);
  const words = wordsOf(core);
  return {
    raw,
    core,
    words,
    key: words.map(singular).join(''),
    form,
    formText,
    place,
    qualifier,
  };
}

/** The form a PAN's fourth letter says, as a NameForm. */
export function formOfPan(pan: string | null | undefined): NameForm | null {
  switch (pan?.[3]) {
    case 'C':
      return 'company';
    case 'F':
      return 'firm_or_llp';
    case 'P':
      return 'proprietor';
    case 'H':
      return 'huf';
    case 'T':
      return 'trust';
    case 'A':
    case 'B':
      return 'aop';
    default:
      return null;
  }
}

const LOOSE: ReadonlySet<NameForm> = new Set(['firm', 'proprietor']);
const FORM_LABEL: Record<NameForm, string> = {
  company: 'a company',
  llp: 'an LLP',
  firm: 'a firm',
  proprietor: 'a proprietorship',
  huf: 'an HUF',
  trust: 'a trust',
  society: 'a society',
  aop: 'an AOP',
  firm_or_llp: 'a firm or LLP',
};

/**
 * Whether two legal forms cannot be the same entity. A company and an LLP
 * cannot; "Firm" and "Pvt Ltd" can (people write Firm for any business), so the
 * loose forms never conflict. Pure — tested.
 */
export function formsConflict(a: NameForm | null, b: NameForm | null): boolean {
  if (!a || !b || a === b) return false;
  if (LOOSE.has(a) || LOOSE.has(b)) return false;
  if (a === 'firm_or_llp' || b === 'firm_or_llp') {
    const other = a === 'firm_or_llp' ? b : a;
    return other !== 'llp';
  }
  return true;
}

/** At most one letter added, dropped, changed or swapped with the next between a and b. */
export function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length)
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    );
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export type NameMatch =
  /** Equal once form, place and plurals are set aside. */
  | 'equal'
  /** One letter apart in a long name ('Cosmotrendz' / 'Cosmotrendez'). */
  | 'typo'
  /** One is the proprietor named after the other's dash. */
  | 'proprietor'
  /** One is the leading words of the other ('griid' / 'GRIID Chandigarh'). */
  | 'prefix'
  | 'none';

/** How two parsed names relate, forms aside. Pure — tested. */
export function matchNames(a: ParsedClientName, b: ParsedClientName): NameMatch {
  if (!a.key || !b.key) return 'none';
  if (a.key === b.key) return 'equal';
  if (Math.min(a.key.length, b.key.length) >= 8 && withinOneEdit(a.key, b.key)) return 'typo';
  const qa = a.qualifier ? wordsOf(a.qualifier).map(singular).join('') : '';
  const qb = b.qualifier ? wordsOf(b.qualifier).map(singular).join('') : '';
  if ((qa && qa === b.key) || (qb && qb === a.key)) return 'proprietor';
  const [short, long] = a.words.length <= b.words.length ? [a.words, b.words] : [b.words, a.words];
  if (short.join('').length >= 4 && short.every((w, i) => long[i] === w)) return 'prefix';
  return 'none';
}

/** What we know of a client to tell it from another. */
export interface ClientIdentity {
  name: string;
  pan?: string | null;
  gstins?: (string | null | undefined)[];
  tan?: string | null;
  cin?: string | null;
}

/**
 * - `same`: they share a PAN, GSTIN, TAN or CIN — one legal entity.
 * - `probable`: the names agree once form, place and typos are set aside, and nothing says otherwise.
 * - `possible`: one name is the start of the other — worth a look.
 * - `different`: different PANs or legal forms that cannot be one entity, or names that do not match.
 */
export type ClientVerdict = 'same' | 'probable' | 'possible' | 'different';

export interface SameClientResult {
  verdict: ClientVerdict;
  /** Why, in the order a person would weigh them; the first is the deciding one. */
  reasons: string[];
}

const stateLabel = (code: string | null): string =>
  code ? (GST_STATES[code] ?? `state ${code}`) : '';

/** A GSTIN as typed, forgiving stray dashes and dots ('07AADCZ0569K1Z-X'); null when it is not one. */
export function cleanGstin(raw: string | null | undefined): string | null {
  const g = normalizeGstin((raw ?? '').replace(/[^0-9A-Za-z]/g, ''));
  return isValidGstin(g) ? g : null;
}

function gstinsOf(c: ClientIdentity): string[] {
  return [...new Set((c.gstins ?? []).map(cleanGstin).filter((g): g is string => Boolean(g)))];
}

function panOf(c: ClientIdentity): string | null {
  const pan = c.pan?.trim().toUpperCase();
  if (pan) return pan;
  const [first] = gstinsOf(c);
  return first ? panOfGstin(first) : null;
}

const upper = (s: string | null | undefined): string | null => s?.trim().toUpperCase() || null;

/**
 * Whether two clients are one legal entity, and why. The tax IDs decide —
 * a GSTIN embeds its PAN, so "3Aces Technologies - Firm" (07AADCZ0569K1ZX)
 * and "3Aces Technologies Private Limited" (PAN AADCZ0569K) are the same
 * however their names read, and "3Aces Technology" (PAN BAOPG6013Q) is not.
 * Without IDs the names suggest, unless their legal forms rule it out
 * ("Dawon LLP" / "Dawon Drone India Pvt Ltd"). Pure — tested.
 */
export function sameClient(a: ClientIdentity, b: ClientIdentity): SameClientResult {
  const ga = gstinsOf(a);
  const gb = gstinsOf(b);
  const sharedGstin = ga.find((g) => gb.includes(g));
  if (sharedGstin) return { verdict: 'same', reasons: [`Both have GSTIN ${sharedGstin}.`] };

  const pa = panOf(a);
  const pb = panOf(b);
  const pansA = new Set([pa, ...ga.map(panOfGstin)].filter(Boolean));
  const pansB = new Set([pb, ...gb.map(panOfGstin)].filter(Boolean));
  const sharedPan = [...pansA].find((p) => pansB.has(p));
  if (sharedPan) {
    const via = (c: ClientIdentity, gs: string[]): string =>
      upper(c.pan) === sharedPan ? 'PAN' : `GSTIN ${gs.find((g) => panOfGstin(g) === sharedPan)}`;
    return {
      verdict: 'same',
      reasons: [
        `Same PAN ${sharedPan} (${a.name}: ${via(a, ga)}; ${b.name}: ${via(b, gb)}) — one legal entity.`,
      ],
    };
  }
  const ta = upper(a.tan);
  if (ta && ta === upper(b.tan)) return { verdict: 'same', reasons: [`Both have TAN ${ta}.`] };
  const ca = upper(a.cin);
  if (ca && ca === upper(b.cin)) return { verdict: 'same', reasons: [`Both have CIN ${ca}.`] };

  const na = parseClientName(a.name);
  const nb = parseClientName(b.name);
  const match = matchNames(na, nb);
  const namesSay = describeMatch(match, na, nb);

  if (pa && pb && pa !== pb)
    return {
      verdict: 'different',
      reasons: [
        `Different PANs (${pa} and ${pb}) — two legal entities${match === 'none' ? '' : ', however alike the names'}.`,
        ...(namesSay ? [namesSay] : []),
      ],
    };

  const fa = na.form ?? formOfPan(pa);
  const fb = nb.form ?? formOfPan(pb);
  if (formsConflict(fa, fb))
    return {
      verdict: 'different',
      reasons: [
        `${a.name} is ${FORM_LABEL[fa!]} and ${b.name} is ${FORM_LABEL[fb!]} — they cannot be one entity.`,
        ...(namesSay ? [namesSay] : []),
      ],
    };

  if (match === 'none') return { verdict: 'different', reasons: ['The names do not match.'] };

  const reasons = [namesSay!];
  if (na.place && nb.place && na.place.state !== nb.place.state)
    reasons.push(
      `Written for different places (${stateLabel(na.place.state)}, ${stateLabel(nb.place.state)}) — one client can hold a GST registration in each.`,
    );
  if (!pa || !pb)
    reasons.push(
      pa || pb
        ? `Only ${pa ? a.name : b.name} has a PAN; check the other's before merging.`
        : 'Neither has a PAN or GSTIN to confirm it.',
    );
  return { verdict: match === 'prefix' ? 'possible' : 'probable', reasons };
}

function describeMatch(m: NameMatch, a: ParsedClientName, b: ParsedClientName): string | null {
  const extras = (n: ParsedClientName): string[] =>
    [n.formText, n.place?.text, n.qualifier].filter((x): x is string => Boolean(x));
  const aside = [...new Set([...extras(a), ...extras(b)])];
  const note = aside.length ? ` (setting aside ${aside.map((x) => `"${x}"`).join(', ')})` : '';
  switch (m) {
    case 'equal':
      return a.core.toLowerCase() === b.core.toLowerCase()
        ? `Same name "${a.core}"${note}.`
        : `Same name but for a plural: "${a.core}" / "${b.core}"${note}.`;
    case 'typo':
      return `Names one letter apart: "${a.core}" / "${b.core}"${note}.`;
    case 'proprietor':
      return `"${a.qualifier ? a.qualifier : b.qualifier}" is named as the proprietor of "${a.qualifier ? a.core : b.core}".`;
    case 'prefix':
      return `One name is the start of the other: "${a.core}" / "${b.core}".`;
    default:
      return null;
  }
}

/**
 * Whether two sheets probably name the same client: equal but for the legal
 * form, place or a plural, one letter apart in a long name ('Cosmotrendz' /
 * 'Cosmotrendez'), or one the leading words of the other ('griid' / 'GRIID
 * Chandigarh') — and not of legal forms that cannot be one ('Dawon LLP' /
 * 'Dawon Drone India Pvt Ltd'). Pure — tested.
 */
export function similarNames(a: string, b: string): boolean {
  const na = parseClientName(a);
  const nb = parseClientName(b);
  return matchNames(na, nb) !== 'none' && !formsConflict(na.form, nb.form);
}
