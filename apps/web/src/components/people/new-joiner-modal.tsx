'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ASSIGNABLE_ROLES,
  GRADE,
  ONBOARD_ASSIGNABLE_ROLES,
  PERMISSION,
  type GradeSlug,
  type RoleSlug,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, roleLabel } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { fetchAllEmployees, istToday } from '@/lib/people';
import type { AdminEmployeeRow, AdminUserRow, OfficeRow } from '@/lib/types';
import { TemporaryPasswordPanel } from '@/components/admin/users-section';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';
import { Button } from '@/components/ui';

const GRADE_LABEL: Record<GradeSlug, string> = {
  partner: 'Partner',
  manager: 'Manager',
  senior: 'Senior',
  article: 'Article Assistant',
  staff: 'Staff',
};

/** The portal role a grade starts with. */
const ROLE_FOR_GRADE: Partial<Record<GradeSlug, RoleSlug>> = {
  article: 'article',
  senior: 'senior',
  manager: 'manager',
  partner: 'partner',
};

interface Outcome {
  employee: AdminEmployeeRow | null;
  email: string | null;
  temporaryPassword: string | null;
  /** What did not happen, in words, when a later step failed. */
  problem: string | null;
}

const message = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.message : fallback;

/**
 * A new joiner in one go (spec §4.2): the login with its role, the employee
 * record linked to it, and a temporary password to hand over. HR may give only
 * the Article, Senior and Manager roles; the API enforces that ceiling. If a
 * later step fails, the form says exactly what was made and what is left.
 */
export function NewJoinerModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });
  const roleChoices = can(principal, PERMISSION.userManage)
    ? ASSIGNABLE_ROLES
    : ONBOARD_ASSIGNABLE_ROLES;

  const [employeeCode, setEmployeeCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [gradeSlug, setGradeSlug] = useState<GradeSlug>(GRADE.article);
  const [officeCode, setOfficeCode] = useState('');
  const [dateOfJoining, setDateOfJoining] = useState(istToday());
  const [giveLogin, setGiveLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleSlug | ''>('article');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const office = officeCode || offices.data?.[0]?.code || '';

  const pickGrade = (g: GradeSlug): void => {
    setGradeSlug(g);
    const r = ROLE_FOR_GRADE[g];
    setRole(r && roleChoices.includes(r) ? r : '');
  };

  const join = useMutation({
    mutationFn: async (): Promise<Outcome> => {
      const code = employeeCode.trim().toUpperCase();
      // Check the code first, so a clash never leaves a login behind.
      const everyone = await fetchAllEmployees();
      if (everyone.some((e) => e.employeeCode.toUpperCase() === code)) {
        throw new Error(`Employee code ${code} is already in use.`);
      }

      let user: AdminUserRow | null = null;
      if (giveLogin) {
        user = await apiFetch<AdminUserRow>('/users', {
          method: 'POST',
          body: {
            email: email.trim(),
            displayName: fullName.trim(),
            officeCode: office,
            roles: role ? [role] : [],
          },
        });
      }

      let employee: AdminEmployeeRow;
      try {
        employee = await apiFetch<AdminEmployeeRow>('/employees', {
          method: 'POST',
          body: {
            employeeCode: code,
            fullName: fullName.trim(),
            gradeSlug,
            officeCode: office,
            dateOfJoining,
            ...(user ? { userId: user.id } : {}),
          },
        });
      } catch (err) {
        return {
          employee: null,
          email: user?.email ?? null,
          temporaryPassword: null,
          problem: `The login ${user?.email ?? ''} was made, but the employee record was not: ${message(
            err,
            'it was refused',
          )}. Add the employee from Employees and link this login.`,
        };
      }

      if (!user) return { employee, email: null, temporaryPassword: null, problem: null };
      try {
        const { temporaryPassword } = await apiFetch<{ temporaryPassword: string }>(
          `/users/${user.id}/password`,
          { method: 'POST' },
        );
        return { employee, email: user.email, temporaryPassword, problem: null };
      } catch (err) {
        return {
          employee,
          email: user.email,
          temporaryPassword: null,
          problem: `The employee and login were made, but no password was set: ${message(
            err,
            'it was refused',
          )}. Give one from their Portal login tab.`,
        };
      }
    },
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: ['people'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (!o.problem && !o.temporaryPassword) {
        toast('Joiner added.');
        onClose();
        return;
      }
      setOutcome(o);
    },
    onError: (err) => toast(message(err, (err as Error).message || 'Could not add them.'), 'error'),
  });

  if (outcome) {
    return (
      <Modal
        open
        onClose={onClose}
        title={outcome.problem ? 'Partly done' : 'Joiner added'}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="space-y-3 text-sm">
          {outcome.employee && (
            <p>
              {outcome.employee.fullName} ({outcome.employee.employeeCode}) joins on{' '}
              {outcome.employee.dateOfJoining}.
            </p>
          )}
          {outcome.problem && (
            <p className="rounded-lg border border-warning-500/30 bg-warning-50 p-3 text-warning-700">
              {outcome.problem}
            </p>
          )}
          {outcome.email && outcome.temporaryPassword && (
            <TemporaryPasswordPanel email={outcome.email} password={outcome.temporaryPassword} />
          )}
        </div>
      </Modal>
    );
  }

  const ok =
    /^[A-Z0-9_-]{2,20}$/.test(employeeCode.trim().toUpperCase()) &&
    fullName.trim().length > 0 &&
    !!office &&
    !!dateOfJoining &&
    (!giveLogin || (/^\S+@\S+\.\S+$/.test(email.trim()) && !!role));

  return (
    <Modal
      open
      onClose={onClose}
      title="New joiner"
      description="The employee record, their portal login and a temporary password, in one go."
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ok || join.isPending} onClick={() => join.mutate()}>
            {join.isPending ? 'Adding…' : 'Add joiner'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee code" required hint="2–20 chars: A–Z, 0–9, - or _.">
            <Input
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
              placeholder="DA021"
            />
          </Field>
          <Field label="Full name" required>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Grade" required>
            <Select value={gradeSlug} onChange={(e) => pickGrade(e.target.value as GradeSlug)}>
              {Object.values(GRADE).map((g) => (
                <option key={g} value={g}>
                  {GRADE_LABEL[g]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Office" required>
            <Select value={office} onChange={(e) => setOfficeCode(e.target.value)}>
              {(offices.data ?? []).map((o) => (
                <option key={o.id} value={o.code}>
                  {o.name} ({o.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date of joining" required>
            <Input
              type="date"
              value={dateOfJoining}
              onChange={(e) => setDateOfJoining(e.target.value)}
            />
          </Field>
        </div>

        <div className="space-y-3 rounded-lg border border-line-strong p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={giveLogin}
              onChange={(e) => setGiveLogin(e.target.checked)}
            />
            Give a portal login
          </label>
          {giveLogin && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Work email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@dhvaj.in"
                />
              </Field>
              <Field
                label="Role"
                required
                hint={
                  roleChoices === ONBOARD_ASSIGNABLE_ROLES
                    ? 'Partner and administrator logins are made by the administrator.'
                    : undefined
                }
              >
                <Select value={role} onChange={(e) => setRole(e.target.value as RoleSlug)}>
                  <option value="">— Choose —</option>
                  {roleChoices.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
