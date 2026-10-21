import { ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { translatePgError } from '../../common/errors/pg-error.util';

/** The payroll triggers' messages are written for people; pass them through. */
const clean = (raw: string | undefined): string =>
  (raw ?? 'Not allowed.').replace(/^ERROR:\s*/, '');

export function translatePayrollError(err: unknown): Error {
  const e = err as { code?: string; message?: string };
  if (e.code === '22023') return translatePgError({ ...e, code: 'P0001' }, { raise: clean });
  if (e.code === '42501' && e.message && !/row-level security/.test(e.message)) {
    return new ForbiddenException(clean(e.message));
  }
  return translatePgError(err, {
    unique: [
      { match: 'payroll_runs_once', message: 'There is already a run for this month.' },
      {
        match: 'salary_structures_one_approved',
        message: 'This person already has an approved structure from that date.',
      },
      {
        match: 'bank_change_requests_one_open',
        message: 'A bank change is already waiting for HR to verify.',
      },
      { match: 'statutory_payments_once', message: 'That challan is already recorded.' },
      { match: 'pay_settings_effective_from', message: 'Settings from that date already exist.' },
    ],
    check: (raw) => clean(raw),
    raise: clean,
    forbidden: 'Pay is visible only to HR, the approvers and the person themself.',
  });
}

/** May this caller see pay (HR, the Managing Partner, the named alternate)? */
export async function assertCanSeePay(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ ok: boolean }>(`SELECT hsdg.ctx_can_see_pay() AS ok`);
  if (!rows[0]?.ok) {
    throw new ForbiddenException(
      'Pay is visible only to HR, the approvers and the person themself.',
    );
  }
}

export async function assertMayApprovePay(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ ok: boolean }>(`SELECT hsdg.ctx_may_approve_pay() AS ok`);
  if (!rows[0]?.ok) {
    throw new ForbiddenException('Only the Managing Partner or the named alternate approves pay.');
  }
}

/** 'YYYY-MM' → 'YYYY-MM-01'. */
export const monthStart = (month: string): string => `${month}-01`;

/** A DATE column → 'YYYY-MM' (pg returns DATE as a string via the type parser, or a Date). */
export function monthOf(value: string | Date): string {
  const s = typeof value === 'string' ? value : value.toISOString();
  return s.slice(0, 7);
}

export function isoDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The month before 'YYYY-MM'. */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** ESI contribution periods run April–September and October–March. */
export function esiPeriodStart(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  if (m >= 4 && m <= 9) return `${y}-04`;
  return m >= 10 ? `${y}-10` : `${y - 1}-10`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10' → 'October 2026' style short label: 'Oct 2026'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}
