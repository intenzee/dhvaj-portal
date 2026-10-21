import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE, type PayrollRunStatus } from '@hsdg/contracts';
import { apiFetch } from './api';
import { useAuth } from './auth';
import { hasRole } from './principal';
import { useToast } from './toast';

/** Payroll screens (spec §4.8). The API decides who sees pay; these only present it. */

export const RUN_STATUS_TONE: Record<PayrollRunStatus, string> = {
  draft: 'neutral',
  computed: 'info',
  submitted: 'warn',
  approved: 'success',
  paid: 'success',
  locked: 'neutral',
};

export const RUN_STATUS_LABEL: Record<PayrollRunStatus, string> = {
  draft: 'Draft',
  computed: 'Computed',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  paid: 'Paid',
  locked: 'Locked',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10' → 'Oct 2026'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1] ?? '?'} ${y}`;
}

/** 'YYYY-MM' for today, or `offset` months away. */
export function monthOf(offset = 0, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong.';

/** The Managing Partner, or the named alternate: may approve pay. */
export function useIsPayApprover(): boolean {
  const { principal } = useAuth();
  const approvers = useQuery({
    queryKey: ['payroll', 'approvers'],
    queryFn: () => apiFetch<{ userId: string; displayName: string }[]>('/payroll/approvers'),
    enabled: !!principal,
    retry: false,
  });
  if (!principal) return false;
  return (
    hasRole(principal, ROLE.managingPartner) ||
    (approvers.data ?? []).some((a) => a.userId === principal.userId)
  );
}

/**
 * A payroll write: toast the outcome, refresh everything payroll. `success`
 * may be a message or a function of the result.
 */
export function usePayAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  success: string | ((r: TResult) => string),
): ReturnType<typeof useMutation<TResult, Error, TVars>> {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TResult, Error, TVars>({
    mutationFn: fn,
    onSuccess: (r) => {
      toast(typeof success === 'string' ? success : success(r), 'success');
      void qc.invalidateQueries({ queryKey: ['payroll'] });
      void qc.invalidateQueries({ queryKey: ['me', 'pay'] });
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
}
