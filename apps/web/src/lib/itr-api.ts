/**
 * Practice Services PS-403 — the ITR desk: the API calls in one place, and the
 * pure helpers the season grid and the return page share (tested).
 */
import {
  ITR_REFUND_MOVES,
  type AddItrIncomeLineInput,
  type EVerifyItrInput,
  type ImportItrStatementInput,
  type ImportItrStatementResult,
  type ItrIncome,
  type ItrIncomeHead,
  type ItrRefundStatus,
  type ItrReturn,
  type ItrSeason,
  type ItrSeasonRow,
  type ItrStage,
  type ItrVerifyReminder,
  type MoveItrRefundInput,
  type RecordItrIntimationInput,
  type RecordItrIntimationResult,
  type RemindItrVerifyInput,
  type UpdateItrReturnInput,
} from '@hsdg/contracts';
import { apiFetch } from './api';

export const itrKey = ['itr'] as const;
export const itrSeasonKey = (fy: string, scope: ItrScope) => [...itrKey, 'season', fy, scope] as const;
export const itrReturnKey = (id: string) => [...itrKey, 'return', id] as const;
export const itrIncomeKey = (id: string) => [...itrKey, 'income', id] as const;

export type ItrScope = 'all' | 'mine' | 'team';

/** The return's page. */
export const itrReturnHref = (id: string): string => `/itr/${id}`;

/**
 * The season most work is on: the financial year that ended last (from
 * April 2026 the returns of FY 2025-26 are filed). `today` is YYYY-MM-DD.
 */
export function currentItrYear(today: string): string {
  const y = Number(today.slice(0, 4));
  const start = Number(today.slice(5, 7)) >= 4 ? y - 1 : y - 2;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The years offered: the current season and the three before it (belated, revised, ITR-U). */
export function itrYearOptions(today: string): string[] {
  const start = Number(currentItrYear(today).slice(0, 4));
  return [0, 1, 2, 3].map((n) => {
    const s = start - n;
    return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
  });
}

export function itrSeasonPath(fy: string, scope: ItrScope): string {
  return `/itr/season?financialYear=${encodeURIComponent(fy)}${scope === 'all' ? '' : `&scope=${scope}`}`;
}

export interface ItrSeasonFilters {
  search: string;
  stage: ItrStage | '';
  /** Only filed returns past the e-verification window. */
  overdue: boolean;
}

/** The grid's rows for these filters (client, PAN, engagement code or ack no.). */
export function filterSeason(
  rows: readonly ItrSeasonRow[],
  f: ItrSeasonFilters,
): ItrSeasonRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.stage || r.stage === f.stage) &&
      (!f.overdue || r.eVerifyOverdue) &&
      (!q ||
        [r.entityName, r.pan, r.engagementCode, r.ackNo]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(q))),
  );
}

/**
 * The ticked filings a bulk action applies to: assign only where the caller
 * may (an engagement or stream lead), remind only returns not yet filed.
 */
export function itrActionable(
  rows: readonly ItrSeasonRow[],
  selected: ReadonlySet<string>,
  action: 'assign' | 'remind',
): string[] {
  return rows
    .filter((r) => selected.has(r.instanceId))
    .filter((r) => (action === 'assign' ? r.canAssign : r.stage === 'preparing'))
    .map((r) => r.instanceId);
}

/** The refund's next moves from where it is (none for a credited or set-off refund). */
export function refundMoves(status: ItrRefundStatus): ItrRefundStatus[] {
  return ITR_REFUND_MOVES[status];
}

/** A move that settles the refund needs its amount (and a date). */
export const refundMoveNeedsAmount = (to: ItrRefundStatus): boolean =>
  to === 'issued' || to === 'adjusted';

/** The badge tone for a stage on the grid. */
export const ITR_STAGE_TONE: Record<ItrStage, string> = {
  preparing: 'neutral',
  awaiting_verification: 'warn',
  verified: 'info',
  processed: 'success',
};

export const ITR_REFUND_TONE: Record<ItrRefundStatus, string> = {
  none: 'neutral',
  pending: 'warn',
  failed: 'danger',
  issued: 'success',
  adjusted: 'info',
};

export const fetchItrSeason = (fy: string, scope: ItrScope) =>
  apiFetch<ItrSeason>(itrSeasonPath(fy, scope));
export const fetchItrReturn = (id: string) => apiFetch<ItrReturn>(`/itr/returns/${id}`);
export const fetchItrIncome = (id: string) => apiFetch<ItrIncome>(`/itr/returns/${id}/income`);

export const openItrReturn = (complianceInstanceId: string) =>
  apiFetch<ItrReturn>('/itr/returns', { method: 'POST', body: { complianceInstanceId } });

export const updateItrReturn = (r: ItrReturn, body: Omit<UpdateItrReturnInput, 'version'>) =>
  apiFetch<ItrReturn>(`/itr/returns/${r.id}`, {
    method: 'PATCH',
    body: { ...body, version: r.version },
  });
export const eVerifyItr = (r: ItrReturn, body: Omit<EVerifyItrInput, 'version'>) =>
  apiFetch<ItrReturn>(`/itr/returns/${r.id}/e-verify`, {
    method: 'POST',
    body: { ...body, version: r.version },
  });
export const moveItrRefund = (r: ItrReturn, body: Omit<MoveItrRefundInput, 'version'>) =>
  apiFetch<ItrReturn>(`/itr/returns/${r.id}/refund`, {
    method: 'POST',
    body: { ...body, version: r.version },
  });
export const recordItrIntimation = (
  r: ItrReturn,
  body: Omit<RecordItrIntimationInput, 'version'>,
) =>
  apiFetch<RecordItrIntimationResult>(`/itr/returns/${r.id}/intimation`, {
    method: 'POST',
    body: { ...body, version: r.version },
  });
export const remindItrVerify = (id: string, body: RemindItrVerifyInput = {}) =>
  apiFetch<ItrVerifyReminder>(`/itr/returns/${id}/remind-verify`, { method: 'POST', body });

export const importItrStatement = (id: string, body: ImportItrStatementInput) =>
  apiFetch<ImportItrStatementResult>(`/itr/returns/${id}/statements`, { method: 'POST', body });
export const addItrLine = (id: string, body: AddItrIncomeLineInput) =>
  apiFetch<ItrIncome>(`/itr/returns/${id}/lines`, { method: 'POST', body });
export const classifyItrLine = (id: string, lineId: string, head: ItrIncomeHead) =>
  apiFetch<ItrIncome>(`/itr/returns/${id}/lines/${lineId}`, { method: 'PATCH', body: { head } });
export const deleteItrLine = (id: string, lineId: string) =>
  apiFetch<ItrIncome>(`/itr/returns/${id}/lines/${lineId}`, { method: 'DELETE' });
