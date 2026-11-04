import { workItemHref, type WorkItemRef } from './work-links';

/**
 * PS-301 · the partner risk dashboard: one screen of "what can hurt us". Each
 * tile is a count (and, for money, a ₹ total), its first items, and a link to
 * the full list; every item opens the work itself. GET /dashboard/risk returns
 * every tile; GET /dashboard/risk/:tile one tile, paged — the web loads each
 * tile on its own, so a slow one never holds the others up. Row-level security
 * scopes them all: an office partner sees their office, the Managing Partner
 * the firm.
 */
export const RISK_TILES = [
  'missed',
  'due_unready',
  'notices',
  'appeals',
  'receivables',
  'unbilled',
  'dsc',
  'udin',
  'approvals',
  'kyc',
] as const;
export type RiskTileKey = (typeof RISK_TILES)[number];

export const RISK_TILE_LABEL: Record<RiskTileKey, string> = {
  missed: 'Statutory dates missed',
  due_unready: 'Due in 7 days, not ready',
  notices: 'Notice replies and hearings in 7 days',
  appeals: 'Appeal limitations in 15 days',
  receivables: 'Receivables over 90 days',
  unbilled: 'Unbilled over 60 days',
  dsc: 'DSCs expiring or out of custody',
  udin: 'UDINs not generated in time',
  approvals: 'Write-offs and credit notes to approve',
  kyc: 'Clients without KYC',
};

/** What each tile counts, under its title. */
export const RISK_TILE_HINT: Record<RiskTileKey, string> = {
  missed: 'Open filings past their statutory date',
  due_unready: 'Statutory date in the next 7 days, with no reviewer or not started',
  notices: 'A reply or a hearing due within 7 days, or already past',
  appeals: 'An order received, its appeal limitation within 15 days',
  receivables: 'Invoice balances more than 90 days past due',
  unbilled: 'Fixed fees whose period ended more than 60 days ago, on no invoice',
  dsc: 'Expiring within 30 days, or out of custody past the return date',
  udin: 'Signed reports with no UDIN inside the window',
  approvals: 'Pending, waiting for a partner',
  kyc: 'Active clients with no complete KYC, or its review due',
};

/** The tiles whose figure is money: they carry `amount`. */
export const RISK_MONEY_TILES: readonly RiskTileKey[] = ['receivables', 'unbilled', 'approvals'];

/** Days the windows look ahead (statute and the plan: confirm with the stream leads). */
export const RISK_WINDOW = {
  dueDays: 7,
  noticeDays: 7,
  appealDays: 15,
  receivableDays: 90,
  unbilledDays: 60,
  dscDays: 30,
} as const;

/** Items a tile sends by default, and at most per page. */
export const RISK_TILE_PAGE = 10;
export const RISK_TILE_PAGE_MAX = 100;

export interface RiskItem {
  /** The work it opens (a filing, a notice, an engagement); null when only `href` applies. */
  ref: WorkItemRef | null;
  /** Where it opens when that is not a work link (a client's statement, the approvals desk). */
  href?: string | null;
  title: string;
  /** The client, the engagement, and why it is here. */
  detail: string;
  /** The date that puts it at risk (statutory, reply, appeal, invoice due …). */
  dueOn: string | null;
  /** ₹ decimal string, on the money tiles. */
  amount?: string | null;
}

export interface RiskTile {
  key: RiskTileKey;
  count: number;
  /** ₹ total over every item (not only the page), on the money tiles. */
  amount?: string | null;
  items: RiskItem[];
  /** The full list. */
  href: string;
  /** False while the register this tile reads from is not built yet. */
  available: boolean;
}

export interface RiskDashboard {
  /** The IST date the windows count from. */
  asOf: string;
  tiles: RiskTile[];
}

/** The URL an item opens. */
export function riskItemHref(item: RiskItem): string {
  if (item.href) return item.href;
  return item.ref ? workItemHref(item.ref) : '#';
}
