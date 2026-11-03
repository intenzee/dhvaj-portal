import { periodKeyLabel } from '@hsdg/contracts';

/**
 * Who may give a set of work (Phase 2, C-3): the Managing Partner, an
 * administrator and a Partner to anyone; a Manager to the people below them.
 * Seniors and Articles do not give sets; a Senior splits the sets given to
 * them (C-4) among the people below them.
 */
export type GiveScope = 'anyone' | 'tree';

export function giveScope(mainRole: string | null): GiveScope | null {
  if (mainRole === 'admin' || mainRole === 'managing_partner' || mainRole === 'partner') {
    return 'anyone';
  }
  if (mainRole === 'manager') return 'tree';
  return null;
}

export const NOT_A_GIVER =
  'Only a Manager, a Partner, the Managing Partner or an administrator can give a set of work.';

/** Task statuses that can be handed on: nobody's clock is running and no review is open. */
export const MOVABLE_STATUSES = ['todo', 'paused', 'blocked'] as const;

/**
 * A set's name when the giver leaves it blank: "GSTR-1 Oct 2026 — Arjun" when
 * every task is the same form and period, else "8 tasks — Arjun".
 */
export function defaultSetName(
  tasks: ReadonlyArray<{ formLabel: string | null; periodKey: string | null }>,
  receiverName: string,
): string {
  const first = receiverName.trim().split(/\s+/)[0] || receiverName;
  const forms = new Set(tasks.map((t) => t.formLabel ?? ''));
  const periods = new Set(tasks.map((t) => t.periodKey ?? ''));
  const [form] = forms;
  const [period] = periods;
  if (tasks.length > 0 && forms.size === 1 && periods.size === 1 && form && period) {
    return `${form} ${periodKeyLabel(period)} — ${first}`;
  }
  return `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} — ${first}`;
}

/** "Arjun gave you 8 GSTR-1 Oct 2026 — Arjun, due 9 Nov". */
export function setNotificationTitle(input: {
  giverName: string;
  count: number;
  setName: string;
  dueDate: string | null;
}): string {
  const due = input.dueDate ? `, due ${shortDate(input.dueDate)}` : '';
  const what = input.count === 1 ? '1 task' : `${input.count} tasks`;
  return `${input.giverName} gave you ${what}: ${input.setName}${due}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}
