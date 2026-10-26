'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UsersRound } from 'lucide-react';
import {
  PERMISSION,
  type ClientTeamRef,
  type Paginated,
  type SetClientTeamInput,
  type SetClientTeamResult,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useTeams } from '@/lib/teams';
import { useToast } from '@/lib/toast';
import type { EngagementRow } from '@/lib/types';
import { Select } from '@/components/form';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui';

const OPEN = new Set(['prospect', 'pending_acceptance', 'accepted', 'active', 'on_hold']);

/**
 * CM-8 · Client 360: "Client team: GST — North · Overseeing partner Rakesh
 * Jain", with Change for those who manage teams.
 */
export function ClientTeamLine({
  entityId,
  team,
}: {
  entityId: string;
  team: ClientTeamRef | null | undefined;
}): JSX.Element | null {
  const { principal } = useAuth();
  const [changing, setChanging] = useState(false);
  if (!can(principal, PERMISSION.teamRead)) return null;
  const canManage = can(principal, PERMISSION.teamManage);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
      <UsersRound className="h-4 w-4 text-ink-faint" aria-hidden />
      {team ? (
        <span>
          Client team:{' '}
          <Link
            href={`/people/teams/${team.id}`}
            className="font-medium text-ink hover:text-primary-600"
          >
            {team.name}
          </Link>
          {team.overseeingPartner && <> · Overseeing partner {team.overseeingPartner.fullName}</>}
        </span>
      ) : (
        <span>No client team</span>
      )}
      {canManage && (
        <button
          type="button"
          className="text-xs font-medium text-primary-600 hover:underline"
          onClick={() => setChanging(true)}
        >
          {team ? 'Change' : 'Assign a team'}
        </button>
      )}
      {changing && (
        <ChangeTeamModal
          entityId={entityId}
          current={team ?? null}
          onClose={() => setChanging(false)}
        />
      )}
    </div>
  );
}

function ChangeTeamModal({
  entityId,
  current,
  onClose,
}: {
  entityId: string;
  current: ClientTeamRef | null;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const teams = useTeams();
  const [teamId, setTeamId] = useState(current?.id ?? '');
  const [apply, setApply] = useState(false);
  const engagements = useQuery({
    queryKey: ['engagements', 'entity', entityId, 'open-count'],
    queryFn: () =>
      apiFetch<Paginated<EngagementRow>>(`/engagements?entityId=${entityId}&limit=100`),
  });
  const openCount = (engagements.data?.items ?? []).filter((e) => OPEN.has(e.status)).length;

  const save = useMutation({
    mutationFn: () => {
      const body: SetClientTeamInput = {
        teamId: teamId || null,
        applyToOpenEngagements: !!teamId && apply,
      };
      return apiFetch<SetClientTeamResult>(`/entities/${entityId}/team`, { method: 'PUT', body });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['entity', entityId] });
      qc.invalidateQueries({ queryKey: ['entities'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      if (r.engagementsUpdated) qc.invalidateQueries({ queryKey: ['engagements'] });
      toast(
        r.team
          ? `Client team set to ${r.team.name}${r.engagementsUpdated ? `; added to ${r.engagementsUpdated} engagement${r.engagementsUpdated === 1 ? '' : 's'}` : ''}.`
          : 'Client team removed.',
        'success',
      );
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not change the team.', 'error'),
  });

  const unchanged = (teamId || null) === (current?.id ?? null) && !apply;
  return (
    <Modal
      open
      onClose={onClose}
      title="Client team"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={unchanged || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Client team">
          <option value="">No team</option>
          {(teams.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.overseeingPartner ? ` · ${t.overseeingPartner.fullName}` : ''}
            </option>
          ))}
        </Select>
        {teamId && openCount > 0 && (
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={apply}
              onChange={(e) => setApply(e.target.checked)}
            />
            <span>
              Also add the new team to this client&apos;s {openCount} open engagement
              {openCount === 1 ? '' : 's'}
              <span className="block text-xs text-ink-faint">
                Adds people; never removes anyone already on an engagement.
              </span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}
