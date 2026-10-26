'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import type { EntityRow } from '@/lib/types';

export type PickedClient = { id: string; legalName: string; fromTeam: string | null };

/**
 * Pick several clients; one that already has another team shows
 * "moves from GST — South".
 */
export function ClientMultiPicker({
  value,
  onChange,
  teamId,
}: {
  value: PickedClient[];
  onChange: (v: PickedClient[]) => void;
  /** The team being filled — a client already on it is not offered. */
  teamId?: string;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  const q = useQuery({
    queryKey: ['entities', 'pick-team', debounced],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(`/entities?search=${encodeURIComponent(debounced)}&limit=8`),
    enabled: debounced.length >= 2,
  });
  const picked = new Set(value.map((v) => v.id));
  const results = (q.data?.items ?? []).filter(
    (e) => !picked.has(e.id) && (!teamId || e.team?.id !== teamId),
  );

  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 space-y-1">
          {value.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-md bg-surface-raised px-2.5 py-1 text-sm"
            >
              <span>
                {c.legalName}
                {c.fromTeam && (
                  <span className="ml-2 text-xs text-warning-700">moves from {c.fromTeam}</span>
                )}
              </span>
              <button
                type="button"
                aria-label={`Remove ${c.legalName}`}
                onClick={() => onChange(value.filter((v) => v.id !== c.id))}
                className="rounded p-0.5 text-ink-faint hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2">
          <Search className="h-4 w-4 text-ink-faint" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search clients by name, code or PAN…"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>
        {debounced.length >= 2 && term && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line-strong bg-surface py-1 shadow-pop">
            {q.isFetching && <div className="px-3 py-2 text-sm text-ink-faint">Searching…</div>}
            {q.isSuccess && results.length === 0 && (
              <div className="px-3 py-2 text-sm text-ink-faint">No clients found.</div>
            )}
            {results.map((e) => (
              <button
                type="button"
                key={e.id}
                onClick={() => {
                  onChange([
                    ...value,
                    { id: e.id, legalName: e.legalName, fromTeam: e.team?.name ?? null },
                  ]);
                  setTerm('');
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-raised"
              >
                <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <span>
                  <span className="block text-sm font-medium text-ink">{e.legalName}</span>
                  <span className="block text-xs text-ink-faint">
                    {e.entityCode} · {e.typeName}
                    {e.team && <> · moves from {e.team.name}</>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
