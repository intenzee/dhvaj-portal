/**
 * Practice Services PS-302 — rate cards, the working calendar and the
 * profitability report: the API calls in one place. All of it needs
 * practice.finance (the Managing Partner and the partners).
 */
import type {
  ProfitabilityQuery,
  ProfitabilityReport,
  PutEmployeeRateInput,
  PutRateCardsInput,
  PutWorkingCalendarInput,
  RateCardRow,
  RateCardsResponse,
} from '@hsdg/contracts';
import { apiFetch } from './api';

export const rateCardsKey = ['rate-cards'] as const;
export const profitabilityKey = ['reports', 'profitability'] as const;

/** The report path for these filters (empty ones left out). Pure — tested. */
export function profitabilityPath(q: ProfitabilityQuery, base = '/reports/profitability'): string {
  const p = new URLSearchParams();
  for (const k of ['from', 'to', 'by', 'partnerId', 'officeId', 'serviceId', 'entityId'] as const) {
    const v = q[k];
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export const fetchProfitability = (q: ProfitabilityQuery) =>
  apiFetch<ProfitabilityReport>(profitabilityPath(q));
export const fetchRateCards = () => apiFetch<RateCardsResponse>('/rate-cards');
export const putRateCards = (body: PutRateCardsInput) =>
  apiFetch<RateCardsResponse>('/rate-cards', { method: 'PUT', body });
export const deleteRateCard = (id: string) =>
  apiFetch<RateCardsResponse>(`/rate-cards/${id}`, { method: 'DELETE' });
export const putEmployeeRate = (body: PutEmployeeRateInput) =>
  apiFetch<RateCardsResponse>('/rate-cards/employees', { method: 'PUT', body });
export const deleteEmployeeRate = (id: string) =>
  apiFetch<RateCardsResponse>(`/rate-cards/employees/${id}`, { method: 'DELETE' });
export const putWorkingCalendar = (body: PutWorkingCalendarInput) =>
  apiFetch<RateCardsResponse>('/rate-cards/calendar', { method: 'PUT', body });

/** Each grade's card in force on `day` (the latest from on or before it). Pure — tested. */
export function cardsInForce(cards: readonly RateCardRow[], day: string): Map<string, RateCardRow> {
  const out = new Map<string, RateCardRow>();
  for (const c of cards) {
    if (c.effectiveFrom > day) continue;
    const cur = out.get(c.gradeId);
    if (!cur || c.effectiveFrom > cur.effectiveFrom) out.set(c.gradeId, c);
  }
  return out;
}

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

/** Why a rate pair cannot be saved, or null. Pure — tested. */
export function rateProblem(cost: string, charge: string): string | null {
  if (!cost.trim() && !charge.trim()) return null;
  if (!MONEY.test(cost.trim()) || !MONEY.test(charge.trim()))
    return 'Rates are rupees an hour, like 750 or 1250.50.';
  return null;
}
