import type { CreateFeeMilestoneInput, FeeMilestoneStatus } from '@hsdg/contracts';

export const MILESTONE_STATUS: Record<FeeMilestoneStatus, { label: string; tone: string }> = {
  upcoming: { label: 'Upcoming', tone: 'neutral' },
  due: { label: 'Unbilled', tone: 'warn' },
  billed: { label: 'On an invoice', tone: 'success' },
  set_aside: { label: 'Set aside', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** Why a new fee milestone can't be added yet; null when it can. */
export function milestoneInputError(i: CreateFeeMilestoneInput): string | null {
  if (!i.description.trim()) return 'Say what the fee is for.';
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(i.amount) || !/[1-9]/.test(i.amount)) {
    return 'Enter an amount above zero, like 75000 or 75000.50.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.dueOn)) return 'Pick the date it becomes billable.';
  return null;
}
