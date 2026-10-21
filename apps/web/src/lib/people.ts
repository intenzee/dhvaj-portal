import {
  PEOPLE_DESK_QUEUE,
  PERMISSION,
  type Paginated,
  type PeopleDeskQueue,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { can, type Principal } from '@/lib/principal';
import type { AdminEmployeeRow } from '@/lib/types';

/**
 * HR or the Managing Partner — the people who see attendance, workload, the
 * articleship register and the HR vault. The administrator keeps the employee
 * master (`employee.manage`) but none of these; the database enforces it, and
 * this only decides what the page offers.
 */
export function readsPeople(principal: Principal | null): boolean {
  return can(principal, PERMISSION.timeReadAttendance);
}

export const QUEUE_LABEL: Record<PeopleDeskQueue, { title: string; hint: string }> = {
  [PEOPLE_DESK_QUEUE.noLogin]: { title: 'No portal login', hint: 'Give them a login to sign in.' },
  [PEOPLE_DESK_QUEUE.locked]: { title: 'Locked out', hint: 'Too many wrong passwords.' },
  [PEOPLE_DESK_QUEUE.temporaryPassword]: {
    title: 'Still on a temporary password',
    hint: 'Set more than three days ago and never changed.',
  },
  [PEOPLE_DESK_QUEUE.articlesCompleting]: {
    title: 'Articleships completing',
    hint: 'In the next 90 days.',
  },
  [PEOPLE_DESK_QUEUE.exitPassedLoginOn]: {
    title: 'Left, but the login is still on',
    hint: 'Switch the login off.',
  },
  [PEOPLE_DESK_QUEUE.noHoursYesterday]: {
    title: 'No hours on the last working day',
    hint: 'Partners and people on leave are not chased.',
  },
};

/** Today in IST, YYYY-MM-DD. */
export function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the week holding `date`. */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

/** "09:42" in IST from an ISO timestamp. */
export function istTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Hours to one decimal, for CSV exports. */
export function hours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

/** Every employee the caller can see (the list is paged at 100). */
export async function fetchAllEmployees(): Promise<AdminEmployeeRow[]> {
  const out: AdminEmployeeRow[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await apiFetch<Paginated<AdminEmployeeRow>>(
      `/employees?limit=100&offset=${offset}`,
    );
    out.push(...page.items);
    if (out.length >= page.total || page.items.length === 0) return out;
  }
}
