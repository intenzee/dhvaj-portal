import { REMIND_MAX_MINUTES, REMIND_ROLES } from '@hsdg/contracts';
import type { Principal } from '@/lib/principal';

export type RemindUnit = 'min' | 'h';

/** Quick picks for the time allotted. */
export const REMIND_PRESETS: { label: string; amount: number; unit: RemindUnit }[] = [
  { label: '15 min', amount: 15, unit: 'min' },
  { label: '30 min', amount: 30, unit: 'min' },
  { label: '1 h', amount: 1, unit: 'h' },
  { label: '2 h', amount: 2, unit: 'h' },
  { label: '4 h', amount: 4, unit: 'h' },
];

/**
 * Remind shows for a Partner, the Managing Partner or an Admin — by the role
 * they are acting as, the same rule the API applies. Pure — tested.
 */
export function mayRemind(p: Pick<Principal, 'effectiveRole' | 'employeeId'> | null): boolean {
  return !!p?.employeeId && !!p.effectiveRole && REMIND_ROLES.includes(p.effectiveRole);
}

/**
 * The typed amount and unit as whole minutes, or null when it is not a time
 * the API takes (1 minute … a week). Pure — tested.
 */
export function remindMinutes(amount: string, unit: RemindUnit): number | null {
  const n = Number(amount.trim().replace(',', '.'));
  if (!amount.trim() || !Number.isFinite(n) || n <= 0) return null;
  const minutes = Math.round(unit === 'h' ? n * 60 : n);
  return minutes >= 1 && minutes <= REMIND_MAX_MINUTES ? minutes : null;
}
