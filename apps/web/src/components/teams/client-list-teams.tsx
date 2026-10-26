'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { UsersRound } from 'lucide-react';
import { PERMISSION, type AssignTeamClientsResult } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useTeams } from '@/lib/teams';
import { useToast } from '@/lib/toast';
import type { EntityRow } from '@/lib/types';
import { Select } from '@/components/form';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui';

const selectClass =
  'rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

/**
 * CM-8 · the clients list's team pieces in one hook, so the page adds them in
 * a few lines: the Team filter (a team, "My teams", "No team"), a Team column,
 * a select column and the bulk Assign team bar.
 */
export function useClientListTeams(onFilterChange: () => void) {
  const { principal } = useAuth();
  const canRead = can(principal, PERMISSION.teamRead);
  const canManage = can(principal, PERMISSION.teamManage);
  const teams = useTeams(canRead);
  const [team, setTeam] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

  const toggle = (id: string): void =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const withTeamColumns = (
    columns: ColumnDef<EntityRow, unknown>[],
    rows: EntityRow[],
  ): ColumnDef<EntityRow, unknown>[] => {
    const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
    const select: ColumnDef<EntityRow, unknown> = {
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          aria-label="Select all on this page"
          checked={allOnPage}
          onChange={() =>
            setSelected((s) => {
              const n = new Set(s);
              for (const r of rows) {
                if (allOnPage) n.delete(r.id);
                else n.add(r.id);
              }
              return n;
            })
          }
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`Select ${row.original.legalName}`}
          checked={selected.has(row.original.id)}
          onChange={() => toggle(row.original.id)}
        />
      ),
    };
    const teamCol: ColumnDef<EntityRow, unknown> = {
      id: 'team',
      header: 'Team',
      cell: ({ row }) => row.original.team?.name ?? <span className="text-ink-faint">—</span>,
    };
    return [...(canManage ? [select] : []), ...columns, ...(canRead ? [teamCol] : [])];
  };

  const filter = canRead ? (
    <select
      aria-label="Team"
      value={team}
      onChange={(e) => {
        setTeam(e.target.value);
        onFilterChange();
      }}
      className={selectClass}
    >
      <option value="">All teams</option>
      <option value="mine">My teams</option>
      <option value="none">No team</option>
      {(teams.data ?? []).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  ) : null;

  const bulkBar =
    canManage && selected.size > 0 ? (
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm text-primary-700">
        <span>
          {selected.size} client{selected.size === 1 ? '' : 's'} selected
        </span>
        <Button size="sm" onClick={() => setAssigning(true)}>
          <UsersRound className="h-4 w-4" /> Assign team
        </Button>
        <button
          type="button"
          className="text-xs hover:underline"
          onClick={() => setSelected(new Set())}
        >
          Clear
        </button>
        {assigning && (
          <AssignTeamModal
            entityIds={[...selected]}
            onClose={() => setAssigning(false)}
            onDone={() => {
              setAssigning(false);
              setSelected(new Set());
            }}
          />
        )}
      </div>
    ) : null;

  return {
    /** For the list query: a team id, 'mine' or 'none' — or null. */
    team: team || null,
    filter,
    bulkBar,
    /** The page's columns with a select column first and Team last. */
    withTeamColumns,
  };
}

function AssignTeamModal({
  entityIds,
  onClose,
  onDone,
}: {
  entityIds: string[];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const teams = useTeams();
  const [teamId, setTeamId] = useState('');
  const assign = useMutation({
    mutationFn: () =>
      apiFetch<AssignTeamClientsResult>(`/teams/${teamId}/clients`, {
        method: 'POST',
        body: { entityIds },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['entities'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      const moved = r.assigned.filter((a) => a.fromTeam).length;
      toast(
        `${r.assigned.length} client${r.assigned.length === 1 ? '' : 's'} assigned${moved ? `, ${moved} moved from another team` : ''}.`,
        'success',
      );
      onDone();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not assign the team.', 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Assign team"
      description={`${entityIds.length} client${entityIds.length === 1 ? '' : 's'}. A client on another team moves to this one.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!teamId || assign.isPending} onClick={() => assign.mutate()}>
            Assign
          </Button>
        </>
      }
    >
      <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
        <option value="">Pick a team…</option>
        {(teams.data ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.overseeingPartner ? ` · ${t.overseeingPartner.fullName}` : ''}
          </option>
        ))}
      </Select>
    </Modal>
  );
}
