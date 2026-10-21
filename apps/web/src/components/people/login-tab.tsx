'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Power } from 'lucide-react';
import { PERMISSION } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { AdminEmployeeRow } from '@/lib/types';
import {
  PASSWORDS_KEY,
  SignInBadge,
  TemporaryPasswordPanel,
  type PasswordStatuses,
} from '@/components/admin/users-section';
import { Badge, Button, Card, CardBody } from '@/components/ui';

/**
 * The person's portal login: how they sign in, a fresh temporary password, and
 * switching it off for a leaver. The API holds HR to its ceiling (no partner or
 * administrator logins); a refusal comes back as a message.
 */
export function LoginTab({ employee }: { employee: AdminEmployeeRow }): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const mayManage = can(principal, PERMISSION.userManage) || can(principal, PERMISSION.userOnboard);
  const [issued, setIssued] = useState<string | null>(null);
  const passwords = useQuery({
    queryKey: PASSWORDS_KEY,
    queryFn: () => apiFetch<PasswordStatuses>('/user-passwords'),
    enabled: mayManage && !!employee.userId,
  });
  const reset = useMutation({
    mutationFn: () =>
      apiFetch<{ temporaryPassword: string }>(`/users/${employee.userId}/password`, {
        method: 'POST',
      }),
    onSuccess: (r) => {
      setIssued(r.temporaryPassword);
      void qc.invalidateQueries({ queryKey: PASSWORDS_KEY });
      void qc.invalidateQueries({ queryKey: ['people', 'desk'] });
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not set the password.', 'error'),
  });
  const switchOff = useMutation({
    mutationFn: () =>
      apiFetch(`/users/${employee.userId}`, { method: 'PATCH', body: { isActive: false } }),
    onSuccess: () => {
      toast('Login switched off.');
      void qc.invalidateQueries({ queryKey: ['people'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not switch the login off.', 'error'),
  });

  if (!employee.userId) {
    return (
      <Card>
        <CardBody className="text-sm text-ink-muted">No portal login linked yet.</CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Signs in as <strong>{employee.userEmail}</strong>
          </span>
          {passwords.data && <SignInBadge status={passwords.data[employee.userId]} />}
          {employee.employmentStatus === 'exited' && (
            <Badge tone="warn">Left the firm — the login should be off</Badge>
          )}
        </div>
        {issued && employee.userEmail && (
          <TemporaryPasswordPanel email={employee.userEmail} password={issued} />
        )}
        {mayManage && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button
              size="sm"
              variant="secondary"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              <KeyRound className="h-3.5 w-3.5" /> Give a temporary password
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={switchOff.isPending}
              onClick={() => switchOff.mutate()}
            >
              <Power className="h-3.5 w-3.5" /> Switch the login off
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
