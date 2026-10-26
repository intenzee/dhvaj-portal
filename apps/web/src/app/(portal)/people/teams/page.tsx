'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { PERMISSION, type TeamSummary } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { initials } from '@/lib/teams';
import { DataTable } from '@/components/data-table';
import { Input } from '@/components/form';
import { Button, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { NewTeamModal } from '@/components/teams/new-team-modal';

/** CM-8 · People → Teams: every client team, its partner, associates and clients. */
export default function TeamsPage(): JSX.Element {
  const { principal } = useAuth();
  const allowed = can(principal, PERMISSION.teamRead);
  const canManage = can(principal, PERMISSION.teamManage);
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const teams = useQuery({
    queryKey: ['teams', 'list', q, archived],
    queryFn: () =>
      apiFetch<TeamSummary[]>(
        `/teams?q=${encodeURIComponent(q)}${archived ? '&archived=true' : ''}`,
      ),
    enabled: allowed,
  });

  const columns = useMemo<ColumnDef<TeamSummary, unknown>[]>(
    () => [
      {
        header: 'Team',
        cell: ({ row }) => (
          <div>
            <span className="block font-medium text-ink">{row.original.name}</span>
            {row.original.description && (
              <span className="block max-w-md truncate text-xs text-ink-faint">
                {row.original.description}
              </span>
            )}
          </div>
        ),
      },
      {
        header: 'Overseeing partner',
        cell: ({ row }) =>
          row.original.overseeingPartner?.fullName ?? (
            <span className="text-warning-700">Needs an overseeing partner</span>
          ),
      },
      {
        header: 'Associates',
        cell: ({ row }) => {
          const a = row.original.associates;
          if (!a.length) return '—';
          return (
            <span className="inline-flex items-center gap-2">
              <span className="tabular-nums">{a.length}</span>
              <span className="flex -space-x-1.5">
                {a.slice(0, 5).map((p) => (
                  <span
                    key={p.id}
                    title={p.fullName}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-surface bg-primary-50 text-[10px] font-semibold text-primary-700"
                  >
                    {initials(p.fullName)}
                  </span>
                ))}
                {a.length > 5 && (
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-surface bg-surface-sunken text-[10px] text-ink-muted">
                    +{a.length - 5}
                  </span>
                )}
              </span>
            </span>
          );
        },
      },
      { header: 'Clients', cell: ({ row }) => row.original.clientCount || '—' },
      { header: 'Office', cell: ({ row }) => row.original.officeCode ?? 'Any' },
    ],
    [],
  );

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Client teams" />
        <EmptyState>You do not have access to client teams.</EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Client teams"
        subtitle="A partner and associates who look after a set of clients. New engagements for those clients start with the team."
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New team
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search teams…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <label className="inline-flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived teams
        </label>
      </div>
      {teams.isLoading && <Spinner label="Loading teams…" />}
      {teams.isError && <EmptyState>Could not load the teams.</EmptyState>}
      {teams.data && (
        <DataTable
          columns={columns}
          data={teams.data}
          empty={
            archived
              ? 'No archived teams.'
              : canManage
                ? 'No client teams yet. Create one with New team.'
                : 'No client teams yet.'
          }
          rowHref={(t) => `/people/teams/${t.id}`}
        />
      )}
      <NewTeamModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
