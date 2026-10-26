'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UsersRound } from 'lucide-react';
import type { ClientTeamRef, TeamDetail } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useTeamPeople } from '@/lib/teams';
import { PeopleMultiPicker } from './person-picker';

/**
 * CM-8 · the new engagement wizard's client-team defaults: the engagement
 * partner starts as the team's overseeing partner and its associates as
 * members. Both stay editable; picking another client starts over.
 */
export function useClientTeamDefaults(
  team: ClientTeamRef | null | undefined,
  partnerId: string,
  setPartnerId: (id: string) => void,
) {
  const detail = useQuery({
    queryKey: ['teams', 'detail', team?.id],
    queryFn: () => apiFetch<TeamDetail>(`/teams/${team!.id}`),
    enabled: !!team,
  });
  const people = useTeamPeople(!!team);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [seeded, setSeeded] = useState<string | null>(null);

  useEffect(() => {
    if (!team) {
      setMemberIds([]);
      setSeeded(null);
      return;
    }
    const d = detail.data;
    if (!d || d.id !== team.id || seeded === team.id) return;
    setSeeded(team.id);
    setMemberIds(d.members.filter((m) => m.teamRole === 'associate' && m.active).map((m) => m.id));
    const overseer = d.members.find((m) => m.teamRole === 'overseeing_partner' && m.active);
    if (overseer && !partnerId) setPartnerId(overseer.id);
  }, [team, detail.data, seeded, partnerId, setPartnerId]);

  const panel = team ? (
    <div className="rounded-lg border border-line bg-surface-raised px-4 py-3">
      <p className="mb-2 flex items-center gap-2 text-sm text-ink">
        <UsersRound className="h-4 w-4 text-ink-faint" aria-hidden />
        <span>
          Client team <strong>{team.name}</strong>
          {team.overseeingPartner && <> · Overseeing partner {team.overseeingPartner.fullName}</>}
        </span>
      </p>
      <span className="mb-1 block text-xs font-medium text-ink-muted">
        Team members on this engagement
      </span>
      <PeopleMultiPicker
        people={people.data ?? []}
        value={memberIds}
        onChange={setMemberIds}
        exclude={new Set(partnerId ? [partnerId] : [])}
        placeholder="Add someone…"
      />
    </div>
  ) : null;

  return { memberIds: memberIds.filter((id) => id !== partnerId), panel };
}
