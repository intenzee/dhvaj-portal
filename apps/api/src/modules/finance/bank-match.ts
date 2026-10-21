import {
  fromPaise,
  toPaise,
  type BankCredit,
  type BankMatchLine,
  type BankMatchProposal,
  type BankMatchResult,
  type MatchConfidence,
} from '@hsdg/contracts';

/**
 * Phase 2c · the bank statement match. Reads a bank's CSV or Excel export
 * (the header row found by its words, day-first dates, credits in their own
 * column or an amount with Cr/Dr) and proposes which open invoices each
 * credit pays. Pure; the statement is never stored.
 */

type Cell = string | number | boolean | null | undefined;

const norm = (c: Cell): string =>
  String(c ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const DATE_WORDS = [
  'txn date',
  'transaction date',
  'tran date',
  'date',
  'value date',
  'value dt',
  'post date',
];
const NARRATION_WORDS = [
  'narration',
  'description',
  'particulars',
  'transaction details',
  'remarks',
  'details',
];
const REF_WORDS = ['chq', 'cheque', 'ref', 'utr'];
const TYPE_HEADERS = ['cr/dr', 'dr/cr', 'dr / cr', 'cr / dr', 'type', 'debit/credit'];

export interface StatementColumns {
  header: number;
  date: number;
  narration: number;
  reference: number | null;
  credit: number | null;
  debit: number | null;
  amount: number | null;
  type: number | null;
}

/** The header row and its columns, or null when the file reads as no statement. */
export function findColumns(rows: Cell[][]): StatementColumns | null {
  for (let h = 0; h < Math.min(rows.length, 40); h++) {
    const cells = (rows[h] ?? []).map(norm);
    const find = (pred: (c: string) => boolean): number => cells.findIndex(pred);
    let date = -1;
    for (const w of DATE_WORDS) {
      date = find((c) => c === w || (c.includes(w) && !c.includes('value')));
      if (date >= 0) break;
    }
    if (date < 0) date = find((c) => c.includes('date'));
    const narration = find((c) => NARRATION_WORDS.some((w) => c.includes(w)));
    const credit = find(
      (c) => (c.includes('credit') || c.includes('deposit')) && !c.includes('debit'),
    );
    const debit = find(
      (c) => (c.includes('debit') || c.includes('withdrawal')) && !c.includes('credit'),
    );
    const amount = find(
      (c) => c.includes('amount') && !c.includes('credit') && !c.includes('debit'),
    );
    const type = find((c) => TYPE_HEADERS.includes(c));
    if (date < 0 || narration < 0) continue;
    if (credit < 0 && (amount < 0 || type < 0)) continue;
    const reference = cells.findIndex(
      (c, i) => i !== narration && REF_WORDS.some((w) => c.includes(w)),
    );
    return {
      header: h,
      date,
      narration,
      reference: reference >= 0 ? reference : null,
      credit: credit >= 0 ? credit : null,
      debit: debit >= 0 ? debit : null,
      amount: credit >= 0 ? null : amount,
      type: credit >= 0 ? null : type,
    };
  }
  return null;
}

const MON: Record<string, number> = {
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

const iso = (y: number, m: number, d: number): string | null => {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Day-first bank dates, ISO dates and Excel serials → 'YYYY-MM-DD'. */
export function parseBankDate(c: Cell): string | null {
  if (typeof c === 'number' && c > 20000 && c < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86400000);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = String(c ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]);
    return iso(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})[\s/-]([A-Za-z]{3})[a-z]*[\s/-](\d{2,4})$/.exec(s);
  if (m) {
    const mon = MON[m[2]!.toLowerCase()];
    const y = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]);
    return mon ? iso(y, mon, Number(m[1])) : null;
  }
  return null;
}

/** '1,18,000.00' / '118000 Cr' / 118000 → 11800000n; blank or zero → null. */
export function parseBankAmount(c: Cell): bigint | null {
  if (typeof c === 'number') return c > 0 ? toPaise(c.toFixed(2)) : null;
  const s = String(c ?? '')
    .replace(/[₹,\s]/g, '')
    .replace(/(cr|dr)\.?$/i, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const p = toPaise(s);
  return p > 0n ? p : null;
}

export interface ParsedStatement {
  columns: BankMatchResult['columns'];
  credits: BankCredit[];
  debitsSkipped: number;
}

export function parseStatement(rows: Cell[][]): ParsedStatement | null {
  const cols = findColumns(rows);
  if (!cols) return null;
  const header = rows[cols.header] ?? [];
  const name = (i: number | null): string | null =>
    i == null ? null : String(header[i] ?? '').trim();
  const credits: BankCredit[] = [];
  let debitsSkipped = 0;
  for (let r = cols.header + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const date = parseBankDate(row[cols.date]);
    if (!date) continue;
    let amount: bigint | null;
    if (cols.credit != null) {
      amount = parseBankAmount(row[cols.credit]);
      if (amount == null && cols.debit != null && parseBankAmount(row[cols.debit]) != null)
        debitsSkipped++;
    } else {
      const t = norm(row[cols.type!]);
      const isCredit = t === 'cr' || t === 'c' || t === 'credit' || t === 'cr.';
      amount = isCredit ? parseBankAmount(row[cols.amount!]) : null;
      if (!isCredit && parseBankAmount(row[cols.amount!]) != null) debitsSkipped++;
    }
    if (amount == null) continue;
    const ref = cols.reference != null ? String(row[cols.reference] ?? '').trim() : '';
    credits.push({
      row: r + 1,
      date,
      narration: String(row[cols.narration] ?? '').trim(),
      reference: ref || null,
      amount: fromPaise(amount),
    });
  }
  return {
    columns: {
      date: name(cols.date) ?? '',
      narration: name(cols.narration) ?? '',
      credit: name(cols.credit ?? cols.amount) ?? '',
      reference: name(cols.reference),
    },
    credits,
    debitsSkipped,
  };
}

// ── Matching ──

export interface OpenInvoice {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  issueDate: string;
  balance: string;
  subtotal: string;
  total: string;
}

export interface PostedReceipt {
  id: string;
  date: string;
  net: string;
}

/** Rupees a credit may differ from the expected net (TDS rounded to the rupee). */
const TOLERANCE = 100n;
const MAX_SUBSET = 12;
const STOP = new Set([
  'pvt',
  'private',
  'ltd',
  'limited',
  'llp',
  'and',
  'the',
  'co',
  'company',
  'ms',
  'india',
  'mr',
  'mrs',
  'shri',
  'smt',
]);

const alnum = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The significant words of a client's name. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** At least half the name's words, one of them four letters or more, are in the narration. */
export function nameHit(name: string, narration: string): boolean {
  const words = nameTokens(name);
  if (!words.length) return false;
  const hay = ` ${narration.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const hits = words.filter((w) => hay.includes(` ${w} `) || hay.includes(w));
  return hits.length * 2 >= words.length && hits.some((w) => w.length >= 4);
}

/** TDS at 10% (194J) of the taxable part of what is still due, to the paisa. */
export function tdsOn(inv: OpenInvoice): bigint {
  const bal = toPaise(inv.balance);
  const total = toPaise(inv.total);
  if (total <= 0n) return 0n;
  const taxablePart = (bal * toPaise(inv.subtotal) * 2n + total) / (2n * total);
  return (taxablePart + 5n) / 10n;
}

interface Combo {
  invoices: OpenInvoice[];
  tds: bigint;
}

/**
 * Invoices of one client whose balances (less TDS, or not) make the credit:
 * any combination of the oldest few when the narration names the client,
 * else a single invoice (the search stays linear across the firm).
 */
function amountCombo(amount: bigint, invs: OpenInvoice[], combine: boolean): Combo | null {
  if (!combine) {
    for (const i of invs) {
      const c = amountCombo(amount, [i], true);
      if (c) return c;
    }
    return null;
  }
  const pool = invs.slice(0, MAX_SUBSET);
  let best: Combo | null = null;
  const n = pool.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const pick = pool.filter((_, i) => mask & (1 << i));
    if (best && pick.length >= best.invoices.length) continue;
    const bal = pick.reduce((a, i) => a + toPaise(i.balance), 0n);
    if (bal === amount) {
      best = { invoices: pick, tds: 0n };
      continue;
    }
    const tds = pick.reduce((a, i) => a + tdsOn(i), 0n);
    const diff = bal - tds - amount;
    if ((diff < 0n ? -diff : diff) <= TOLERANCE && bal > amount) {
      best = { invoices: pick, tds: bal - amount };
    }
  }
  return best;
}

const RANK: Record<MatchConfidence, number> = { high: 0, medium: 1, low: 2 };

export function matchCredits(
  credits: BankCredit[],
  open: OpenInvoice[],
  receipts: PostedReceipt[],
): BankMatchLine[] {
  const byClient = new Map<string, OpenInvoice[]>();
  for (const inv of [...open].sort(
    (a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number),
  )) {
    byClient.set(inv.clientId, [...(byClient.get(inv.clientId) ?? []), inv]);
  }
  const used = new Set<string>();

  return credits.map((credit) => {
    const amount = toPaise(credit.amount);
    const text = `${credit.narration} ${credit.reference ?? ''}`;
    const textAlnum = alnum(text);
    const day = Date.parse(`${credit.date}T00:00:00Z`);
    const recorded =
      receipts.find(
        (r) =>
          !used.has(r.id) &&
          toPaise(r.net) === amount &&
          Math.abs(Date.parse(`${r.date}T00:00:00Z`) - day) <= 3 * 86400000,
      ) ?? null;
    if (recorded) used.add(recorded.id);

    const proposals: BankMatchProposal[] = [];
    for (const [clientId, invs] of byClient) {
      const byNumber = invs.filter(
        (i) => alnum(i.number).length >= 4 && textAlnum.includes(alnum(i.number)),
      );
      const named = nameHit(invs[0]!.clientName, text);
      const ordered = [...byNumber, ...invs.filter((i) => !byNumber.includes(i))];
      const combo = amountCombo(amount, ordered, byNumber.length > 0 || named);
      const reasons: string[] = [];
      if (byNumber.length)
        reasons.push(`Narration names ${byNumber.map((i) => i.number).join(', ')}`);
      if (named) reasons.push('Narration names the client');
      if (combo) {
        reasons.push(
          combo.tds > 0n
            ? `Equals the balance less TDS of ${fromPaise(combo.tds)}`
            : combo.invoices.length > 1
              ? `Equals ${combo.invoices.length} balances`
              : 'Equals the balance',
        );
        proposals.push({
          clientId,
          clientName: invs[0]!.clientName,
          invoices: combo.invoices.map((i) => ({
            invoiceId: i.id,
            invoiceNumber: i.number,
            balance: i.balance,
            allocate: i.balance,
          })),
          gross: fromPaise(amount + combo.tds),
          tds: fromPaise(combo.tds),
          confidence: byNumber.length || named ? 'high' : 'medium',
          reasons,
        });
      } else if (byNumber.length || named) {
        // A part payment: oldest first, the named invoices before the rest.
        let left = amount;
        const alloc = [];
        for (const i of ordered) {
          if (left <= 0n) break;
          const take = toPaise(i.balance) < left ? toPaise(i.balance) : left;
          alloc.push({
            invoiceId: i.id,
            invoiceNumber: i.number,
            balance: i.balance,
            allocate: fromPaise(take),
          });
          left -= take;
        }
        reasons.push(
          left > 0n ? `More than is due; ${fromPaise(left)} would be an advance` : 'Part payment',
        );
        proposals.push({
          clientId,
          clientName: invs[0]!.clientName,
          invoices: alloc,
          gross: credit.amount,
          tds: '0.00',
          confidence: byNumber.length ? 'medium' : 'low',
          reasons,
        });
      }
    }
    // An amount that fits many clients and names none is a guess.
    const amountOnly = proposals.filter(
      (p) => p.confidence === 'medium' && !p.reasons.some((r) => r.startsWith('Narration')),
    );
    if (amountOnly.length > 1) for (const p of amountOnly) p.confidence = 'low';
    proposals.sort(
      (a, b) => RANK[a.confidence] - RANK[b.confidence] || a.clientName.localeCompare(b.clientName),
    );
    return { credit, recordedReceiptId: recorded?.id ?? null, proposals: proposals.slice(0, 3) };
  });
}
