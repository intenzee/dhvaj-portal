'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Pencil } from 'lucide-react';
import {
  ARTICLESHIP_STATUSES,
  PERMISSION,
  type Articleship,
  type ArticleshipScheme,
  type ArticleshipStatus,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { downloadCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { readsPeople } from '@/lib/people';
import { ARTICLESHIP_STATUS_LABEL } from '@/components/people/articleship-tab';
import { PeopleSubnav } from '@/components/people/people-subnav';
import { DataTable } from '@/components/data-table';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';
import { Button, EmptyState, PageHeader, Panel, Spinner } from '@/components/ui';

/** The articleship register (spec §4.7). Partners see their own articles. */
export default function ArticlesPage(): JSX.Element {
  const { principal } = useAuth();
  const [status, setStatus] = useState<ArticleshipStatus | ''>('active');
  const list = useQuery({
    queryKey: ['people', 'articles', status],
    queryFn: () => apiFetch<Articleship[]>(`/people/articles${status ? `?status=${status}` : ''}`),
    enabled: can(principal, PERMISSION.employeeRead),
  });

  const columns = useMemo<ColumnDef<Articleship, unknown>[]>(
    () => [
      {
        header: 'Article',
        cell: ({ row }) => (
          <div>
            <span className="block">{row.original.employeeName}</span>
            <span className="block text-xs text-ink-faint">
              {row.original.employeeCode} · {row.original.officeCode}
            </span>
          </div>
        ),
      },
      {
        header: 'Principal',
        cell: ({ row }) => (
          <div>
            <span className="block">{row.original.principalName}</span>
            {row.original.principalMembershipNo && (
              <span className="block text-xs text-ink-faint">
                M. No. {row.original.principalMembershipNo}
              </span>
            )}
          </div>
        ),
      },
      { header: 'Scheme', accessorKey: 'schemeLabel' },
      {
        header: 'ICAI reg.',
        cell: ({ row }) => row.original.icaiRegistrationNo ?? '—',
      },
      { header: 'Started', cell: ({ row }) => formatDate(row.original.startDate) },
      {
        header: 'Completes',
        cell: ({ row }) => formatDate(row.original.endedOn ?? row.original.expectedCompletion),
      },
      {
        header: 'Leave',
        cell: ({ row }) => {
          const a = row.original;
          const over = a.leaveEntitlementDays !== null && a.leaveTakenDays > a.leaveEntitlementDays;
          return (
            <span className={over ? 'font-semibold text-danger-600' : undefined}>
              {a.leaveTakenDays}
              {a.leaveEntitlementDays !== null ? ` / ${a.leaveEntitlementDays}` : ''}
            </span>
          );
        },
      },
      { header: 'Status', cell: ({ row }) => ARTICLESHIP_STATUS_LABEL[row.original.status] },
    ],
    [],
  );

  if (!can(principal, PERMISSION.employeeRead)) {
    return (
      <div>
        <PageHeader title="Articles" />
        <EmptyState>You don’t have access to the articleship register.</EmptyState>
      </div>
    );
  }

  const exportCsv = (): void =>
    downloadCsv(
      `articleship-register-${status || 'all'}`,
      [
        'Code',
        'Article',
        'Office',
        'Principal',
        'Membership no.',
        'Scheme',
        'ICAI registration',
        'Registered on',
        'Start',
        'Expected completion',
        'Leave taken',
        'Leave allowed',
        'Status',
        'Ended',
      ],
      (list.data ?? []).map((a) => [
        a.employeeCode,
        a.employeeName,
        a.officeCode,
        a.principalName,
        a.principalMembershipNo,
        a.schemeLabel,
        a.icaiRegistrationNo,
        a.icaiRegistrationDate,
        a.startDate,
        a.expectedCompletion,
        a.leaveTakenDays,
        a.leaveEntitlementDays,
        ARTICLESHIP_STATUS_LABEL[a.status],
        a.endedOn,
      ]),
    );

  return (
    <div>
      <PageHeader
        title="Articles"
        subtitle="The articleship register: principal, ICAI registration, period and leave."
        actions={
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!list.data?.length}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />
      <PeopleSubnav />
      <div className="space-y-6">
        <div className="flex items-end gap-3">
          <Field label="Status">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as ArticleshipStatus | '')}
            >
              <option value="">All</option>
              {ARTICLESHIP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ARTICLESHIP_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {list.isLoading ? (
          <Spinner label="Loading the register…" />
        ) : (
          <DataTable
            columns={columns}
            data={list.data ?? []}
            empty="No articleships recorded."
            rowHref={(a) => `/people/employees/${a.employeeId}`}
          />
        )}
        <SchemesPanel />
      </div>
    </div>
  );
}

/** The firm's settings per ICAI scheme: period and the leave allowed over it. */
function SchemesPanel(): JSX.Element {
  const { principal } = useAuth();
  const mayEdit = readsPeople(principal) && can(principal, PERMISSION.employeeManage);
  const [editing, setEditing] = useState<ArticleshipScheme | null>(null);
  const schemes = useQuery({
    queryKey: ['people', 'articleship-schemes'],
    queryFn: () => apiFetch<ArticleshipScheme[]>('/people/articleship-schemes'),
  });
  return (
    <Panel title="Schemes">
      <p className="mb-3 text-sm text-ink-muted">
        The ICAI limits differ by scheme and change, so the firm enters them here.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-faint">
            <th className="pb-1 font-medium">Scheme</th>
            <th className="pb-1 text-right font-medium">Period (months)</th>
            <th className="pb-1 text-right font-medium">Leave allowed (days)</th>
            <th className="pb-1" />
          </tr>
        </thead>
        <tbody>
          {(schemes.data ?? []).map((s) => (
            <tr key={s.code} className="border-t border-line">
              <td className="py-1.5">
                {s.label}
                {!s.isActive && <span className="ml-2 text-xs text-ink-faint">(not in use)</span>}
              </td>
              <td className="py-1.5 text-right tabular-nums">{s.periodMonths}</td>
              <td className="py-1.5 text-right tabular-nums">
                {s.leaveEntitlementDays ?? <span className="text-ink-faint">not entered</span>}
              </td>
              <td className="py-1.5 text-right">
                {mayEdit && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <SchemeModal scheme={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function SchemeModal({
  scheme,
  onClose,
}: {
  scheme: ArticleshipScheme;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState(scheme.label);
  const [period, setPeriod] = useState(String(scheme.periodMonths));
  const [leave, setLeave] = useState(
    scheme.leaveEntitlementDays === null ? '' : String(scheme.leaveEntitlementDays),
  );
  const [isActive, setIsActive] = useState(scheme.isActive);
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/people/articleship-schemes/${scheme.code}`, {
        method: 'PATCH',
        body: {
          label: label.trim(),
          periodMonths: Number(period),
          leaveEntitlementDays: leave.trim() === '' ? null : Number(leave),
          isActive,
        },
      }),
    onSuccess: () => {
      toast('Scheme updated.');
      void qc.invalidateQueries({ queryKey: ['people'] });
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not update the scheme.', 'error'),
  });
  const ok =
    label.trim().length > 0 &&
    /^\d{1,3}$/.test(period) &&
    Number(period) >= 1 &&
    (leave.trim() === '' || /^\d{1,4}$/.test(leave.trim()));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${scheme.label}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ok || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Label" required>
          <Input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field
          label="Period (months)"
          required
          hint="Sets the expected completion of new articleships."
        >
          <Input inputMode="numeric" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <Field label="Leave allowed over the period (days)" hint="Blank until the firm decides.">
          <Input inputMode="numeric" value={leave} onChange={(e) => setLeave(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          In use for new articleships
        </label>
      </div>
    </Modal>
  );
}
