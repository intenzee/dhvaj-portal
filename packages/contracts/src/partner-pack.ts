import type { RiskItem, RiskTileKey } from './risk';

/**
 * PS-303 · the partner's monthly pack. On the 3rd of each month every partner
 * (and the Managing Partner, firm-wide) gets last month on one PDF: the risk
 * tiles as they stand (PS-301), what was done — filings filed, notices closed
 * — and the money — invoiced and collected; profitability joins with PS-302.
 * Each figure is read as that partner, so it matches what their screens show.
 * The e-mail goes through the notification outbox; the PDF downloads from
 * Reports → Partner packs, where a partner can also build any month again.
 */

/** The day of the month the packs go out (IST). */
export const PARTNER_PACK_DAY = 3;

/** First items of each risk tile the pack lists. */
export const PARTNER_PACK_RISK_ITEMS = 5;

export interface PartnerPackRiskTile {
  key: RiskTileKey;
  label: string;
  count: number;
  amount: string | null;
  available: boolean;
  items: Pick<RiskItem, 'title' | 'detail' | 'dueOn'>[];
}

export interface PartnerPackFigures {
  /** 'YYYY-MM': the month reported on. */
  month: string;
  from: string;
  to: string;
  /** The IST date the risk tiles were read (they are as of then, not month end). */
  asOf: string;
  partner: { employeeId: string; name: string; officeCode: string | null };
  /** 'firm' for the Managing Partner and administrators; 'own' for a partner. */
  scope: 'firm' | 'own';
  risk: PartnerPackRiskTile[];
  filingsDone: { total: number; byStream: { stream: string; count: number }[] };
  noticesClosed: { total: number; byOutcome: { outcome: string; count: number }[] };
  invoiced: { count: number; amount: string };
  collected: { count: number; amount: string };
  /** PS-302 (cost rates and realisation): null until it is in this build. */
  profitability: null | {
    timeCost: string;
    standardValue: string;
    billed: string;
    realisationPct: number | null;
    margin: string;
  };
}

export interface PartnerPackSummary {
  id: string;
  month: string;
  partnerEmployeeId: string;
  partnerName: string;
  generatedAt: string;
  /** "Risk 12 · Filed 86 · Collected ₹4,20,000". */
  headline: string;
}

export interface BuildPartnerPackInput {
  /** 'YYYY-MM'; default last month. */
  month?: string;
}

/** The month a pack built on `today` (IST yyyy-mm-dd) reports on: the month before. */
export function partnerPackMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** First and last day of a 'YYYY-MM'. */
export function monthBounds(month: string): { from: string; to: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** '2026-10' → 'October 2026'. */
export function partnerPackMonthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
}
