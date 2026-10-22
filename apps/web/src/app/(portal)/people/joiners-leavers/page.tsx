'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { formatDate, humanize } from '@/lib/format';
import { addDays, fetchAllEmployees, istToday } from '@/lib/people';
import type { AdminEmployeeRow } from '@/lib/types';
import { PeopleSubnav } from '@/components/people/people-subnav';
import { DataTable } from '@/components/data-table';
import { Field, Select } from '@/components/form';
import { EmptyState, PageHeader, Panel, Spinner } from '@/components/ui';

const WINDOWS = [30, 90, 180, 365] as const;

/** Who joined, who is joining, who is leaving and who left (spec §4.2). */
export default function JoinersLeaversPage(): JSX.Element {
  const { principal } = useAuth();
  const allowed = can(principal, PERMISSION.employeeManage);
  const [days, setDays] = useState<number>(90);
  const people = useQuery({
    queryKey: ['people', 'all-employees'],
    queryFn: fetchAllEmployees,
    enabled: allowed,
  });

  const today = istToday();
  const since = addDays(today, -days);
  const { joiners, leavers } = useMemo(() => {
    const all = people.data ?? [];
    return {
      joiners: all
        .filter((e) => e.dateOfJoining >= since)
        .sort((a, b) => b.dateOfJoining.localeCompare(a.dateOfJoining)),
      leavers: all
        .filter((e) => e.dateOfExit !== null && e.dateOfExit >= since)
        .sort((a, b) => (b.dateOfExit ?? '').localeCompare(a.dateOfExit ?? '')),
    };
  }, [people.data, since]);

  const base: ColumnDef<AdminEmployeeRow, unknown>[] = [
    {
      header: 'Person',
      cell: ({ row }) => (
        <div>
          <span className="block">{row.original.fullName}</span>
          <span className="block text-xs text-ink-faint">{row.original.employeeCode}</span>
        </div>
      ),
    },
    { header: 'Grade', accessorKey: 'gradeName' },
    { header: 'Office', accessorKey: 'officeCode' },
  ];
  const joinerCols: ColumnDef<AdminEmployeeRow, unknown>[] = [
    ...base,
    {
      header: 'Joins',
      cell: ({ row }) => (
        <span>
          {formatDate(row.original.dateOfJoining)}
          {row.original.dateOfJoining > today && (
            <span className="ml-1 text-xs text-ink-faint">(upcoming)</span>
          )}
        </span>
      ),
    },
    {
      header: 'Login',
      cell: ({ row }) =>
        row.original.userEmail ?? <span className="text-xs text-warning-700">None yet</span>,
    },
  ];
  const leaverCols: ColumnDef<AdminEmployeeRow, unknown>[] = [
    ...base,
    { header: 'Last day', cell: ({ row }) => formatDate(row.original.dateOfExit) },
    { header: 'Status', cell: ({ row }) => humanize(row.original.employmentStatus) },
  ];

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Joiners & leavers" />
        <EmptyState>You don’t have access to this page.</EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Joiners & leavers" subtitle="Who came and who is going." />
      <PeopleSubnav />
      <div className="mb-4">
        <Field label="Since">
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                The last {w} days
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {people.isLoading ? (
        <Spinner label="Loading people…" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title={`Joiners (${joiners.length})`} bodyClassName="p-0">
            <DataTable
              columns={joinerCols}
              data={joiners}
              empty="No one joined in this time."
              rowHref={(e) => `/people/employees/${e.id}`}
            />
          </Panel>
          <Panel title={`Leavers (${leavers.length})`} bodyClassName="p-0">
            <DataTable
              columns={leaverCols}
              data={leavers}
              empty="No one left in this time."
              rowHref={(e) => `/people/employees/${e.id}`}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
