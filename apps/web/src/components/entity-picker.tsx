'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import type { EntityRow } from '@/lib/types';

export type Picked = { id: string; label: string };

/** Search-and-select a client entity. */
export function EntityPicker({
  value,
  onChange,
  exclude,
  placeholder = 'Search clients by name or PAN…',
}: {
  value: Picked | null;
  onChange: (v: Picked | null) => void;
  exclude: Set<string>;
  placeholder?: string;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const q = useQuery({
    queryKey: ['entities', 'pick', debounced],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(`/entities?search=${encodeURIComponent(debounced)}&limit=6`),
    enabled: debounced.length >= 2,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-line-strong px-3 py-2 text-sm">
        <span className="font-medium text-ink">{value.label}</span>
        <button className="text-xs text-primary-600 hover:underline" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  const results = (q.data?.items ?? []).filter((e) => !exclude.has(e.id));

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2">
        <Search className="h-4 w-4 text-ink-faint" />
        <input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line-strong bg-surface py-1 shadow-pop">
          {q.isFetching && <div className="px-3 py-2 text-sm text-ink-faint">Searching…</div>}
          {q.isSuccess && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-ink-faint">No clients found.</div>
          )}
          {results.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                onChange({ id: e.id, label: e.legalName });
                setTerm('');
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-raised"
            >
              <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span>
                <span className="block text-sm font-medium text-ink">{e.legalName}</span>
                <span className="block text-xs text-ink-faint">
                  {e.entityCode} · {e.typeName}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
