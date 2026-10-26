import { useQuery } from '@tanstack/react-query';
import type { TeamPerson, TeamSummary } from '@hsdg/contracts';
import { apiFetch } from './api';

/** CM-8 · everyone a client team can hold, from every office. */
export function useTeamPeople(enabled = true) {
  return useQuery({
    queryKey: ['teams', 'people'],
    queryFn: () => apiFetch<TeamPerson[]>('/teams/people'),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** Live client teams, for selects. */
export function useTeams(enabled = true) {
  return useQuery({
    queryKey: ['teams', 'list', ''],
    queryFn: () => apiFetch<TeamSummary[]>('/teams'),
    staleTime: 60 * 1000,
    enabled,
  });
}

/** "Rakesh Jain" → "RJ". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** "1 partner, 4 associates, 12 clients" */
export function teamCountLine(partner: boolean, associates: number, clients: number): string {
  const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;
  return [
    n(partner ? 1 : 0, 'partner', 'partners'),
    n(associates, 'associate', 'associates'),
    n(clients, 'client', 'clients'),
  ].join(', ');
}
