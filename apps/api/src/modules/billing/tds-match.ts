import type { TdsMatchKind } from '@hsdg/contracts';

/**
 * PS-204 · the 26AS matcher. A 26AS credit carries the deductor's TAN, which
 * names the client; a receipt carries the TDS the client deducted. Within each
 * client's quarter, in turn: one to one exactly, one to one within the
 * tolerance, one receipt deposited as several credits, several receipts in one
 * credit, the quarter in total; then one to one across a neighbouring quarter
 * (the deductor booked it at invoice, we at payment). What is left is the
 * mismatch: in the 26AS but not booked, or booked but missing. Amounts in
 * paise. Pure — tested.
 */

export interface MatchCredit {
  id: string;
  /** The client registered under the deductor's TAN; null: on no client. */
  clientId: string | null;
  /** Quarters counted from year 0: fyStart × 4 + (Q − 1). */
  quarterIndex: number;
  date: string;
  tds: bigint;
}

export interface MatchReceipt {
  id: string;
  clientId: string;
  quarterIndex: number;
  date: string;
  tds: bigint;
}

export interface MatchGroup {
  kind: TdsMatchKind;
  clientId: string;
  creditIds: string[];
  receiptIds: string[];
  /** Credited − booked. */
  difference: bigint;
}

export interface MatchOutcome {
  matches: MatchGroup[];
  notBooked: string[];
  missing: string[];
}

/** The most items a split or a combination is sought among (2^n subsets). */
export const SUBSET_LIMIT = 14;

/** '2026-27', 'Q2' → 8105. */
export function quarterIndex(financialYear: string, quarter: string): number {
  return Number(financialYear.slice(0, 4)) * 4 + Number(quarter.slice(1)) - 1;
}

const abs = (n: bigint): bigint => (n < 0n ? -n : n);
const days = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
const byDate = <T extends { date: string; id: string }>(a: T, b: T): number =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

export function matchTds(
  credits: MatchCredit[],
  receipts: MatchReceipt[],
  tolerance: bigint,
): MatchOutcome {
  const matches: MatchGroup[] = [];
  const usedC = new Set<string>();
  const usedR = new Set<string>();
  const take = (
    kind: TdsMatchKind,
    clientId: string,
    cs: MatchCredit[],
    rs: MatchReceipt[],
  ): void => {
    for (const c of cs) usedC.add(c.id);
    for (const r of rs) usedR.add(r.id);
    const sum = (xs: { tds: bigint }[]): bigint => xs.reduce((t, x) => t + x.tds, 0n);
    matches.push({
      kind,
      clientId,
      creditIds: cs.map((c) => c.id),
      receiptIds: rs.map((r) => r.id),
      difference: sum(cs) - sum(rs),
    });
  };

  // One to one: the closest amount within `within`, then the closest date.
  const oneToOne = (
    kind: TdsMatchKind,
    cs: MatchCredit[],
    rs: MatchReceipt[],
    within: bigint,
    sameQuarter: (c: MatchCredit, r: MatchReceipt) => boolean,
  ): void => {
    for (const r of [...rs].sort(byDate)) {
      if (usedR.has(r.id)) continue;
      let best: MatchCredit | null = null;
      for (const c of cs) {
        if (usedC.has(c.id) || !sameQuarter(c, r)) continue;
        const d = abs(c.tds - r.tds);
        if (d > within) continue;
        if (
          !best ||
          d < abs(best.tds - r.tds) ||
          (d === abs(best.tds - r.tds) && days(c.date, r.date) < days(best.date, r.date))
        ) {
          best = c;
        }
      }
      if (best) take(kind, r.clientId, [best], [r]);
    }
  };

  // Fewest of `pool` (two or more) adding up to `target` within the tolerance.
  const subsetFor = <T extends { id: string; date: string; tds: bigint }>(
    target: bigint,
    near: string,
    pool: T[],
  ): T[] | null => {
    const items = [...pool]
      .sort((a, b) => days(a.date, near) - days(b.date, near) || a.id.localeCompare(b.id))
      .slice(0, SUBSET_LIMIT);
    let best: { picked: T[]; off: bigint } | null = null;
    for (let mask = 1; mask < 1 << items.length; mask++) {
      const picked = items.filter((_, i) => mask & (1 << i));
      if (picked.length < 2) continue;
      const off = abs(picked.reduce((t, x) => t + x.tds, 0n) - target);
      if (off > tolerance) continue;
      if (
        !best ||
        picked.length < best.picked.length ||
        (picked.length === best.picked.length && off < best.off)
      ) {
        best = { picked, off };
      }
    }
    return best ? best.picked.sort(byDate) : null;
  };

  const known = credits.filter((c) => c.clientId !== null);
  const cells = new Map<string, { cs: MatchCredit[]; rs: MatchReceipt[] }>();
  const cell = (clientId: string, q: number) => {
    const key = `${clientId}|${q}`;
    let v = cells.get(key);
    if (!v) cells.set(key, (v = { cs: [], rs: [] }));
    return v;
  };
  for (const c of known) cell(c.clientId!, c.quarterIndex).cs.push(c);
  for (const r of receipts) cell(r.clientId, r.quarterIndex).rs.push(r);

  const same = (c: MatchCredit, r: MatchReceipt): boolean => c.quarterIndex === r.quarterIndex;
  for (const [key, { cs, rs }] of [...cells.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const clientId = key.split('|')[0]!;
    if (cs.length === 0 || rs.length === 0) continue;
    oneToOne('exact', cs, rs, 0n, same);
    oneToOne('tolerance', cs, rs, tolerance, same);

    // One receipt, deposited as several credits — largest receipt first.
    for (const r of rs.filter((x) => !usedR.has(x.id)).sort((a, b) => Number(b.tds - a.tds))) {
      const parts = subsetFor(
        r.tds,
        r.date,
        cs.filter((c) => !usedC.has(c.id)),
      );
      if (parts) take('split', clientId, parts, [r]);
    }
    // Several receipts in one credit.
    for (const c of cs.filter((x) => !usedC.has(x.id)).sort((a, b) => Number(b.tds - a.tds))) {
      const parts = subsetFor(
        c.tds,
        c.date,
        rs.filter((r) => !usedR.has(r.id)),
      );
      if (parts) take('combined', clientId, [c], parts);
    }
    // What is left agrees for the quarter as a whole.
    const leftC = cs.filter((c) => !usedC.has(c.id));
    const leftR = rs.filter((r) => !usedR.has(r.id));
    if (leftC.length && leftR.length) {
      const off = leftC.reduce((t, c) => t + c.tds, 0n) - leftR.reduce((t, r) => t + r.tds, 0n);
      if (abs(off) <= tolerance)
        take('quarter_total', clientId, leftC.sort(byDate), leftR.sort(byDate));
    }
  }

  // One to one across a neighbouring quarter, the same client.
  oneToOne(
    'other_quarter',
    known,
    receipts,
    tolerance,
    (c, r) => c.clientId === r.clientId && Math.abs(c.quarterIndex - r.quarterIndex) === 1,
  );

  return {
    matches,
    notBooked: credits.filter((c) => !usedC.has(c.id)).map((c) => c.id),
    missing: receipts.filter((r) => !usedR.has(r.id)).map((r) => r.id),
  };
}
