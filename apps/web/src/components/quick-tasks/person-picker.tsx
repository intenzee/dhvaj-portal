'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { QuickTaskPerson } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { humanize } from '@/lib/format';
import { QUICK_TASK_KEYS } from './quick-task-api';

/** Type a name or code and pick who does the task. */
export function PersonPicker({
  value,
  onChange,
  excludeId,
}: {
  value: QuickTaskPerson | null;
  onChange: (p: QuickTaskPerson | null) => void;
  excludeId?: string | null;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const people = useQuery({
    queryKey: QUICK_TASK_KEYS.people,
    queryFn: () => apiFetch<QuickTaskPerson[]>('/quick-tasks/people'),
    staleTime: 5 * 60_000,
  });
  const matches = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (people.data ?? [])
      .filter((p) => p.id !== excludeId)
      .filter(
        (p) =>
          !t ||
          p.name.toLowerCase().includes(t) ||
          (p.code ?? '').toLowerCase().includes(t) ||
          (p.officeCode ?? '').toLowerCase() === t,
      )
      .slice(0, 8);
  }, [people.data, term, excludeId]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-line-strong px-3 py-2 text-sm">
        <span>
          <span className="font-medium text-ink">{value.name}</span>
          <span className="text-ink-faint">
            {' '}
            · {[value.role && humanize(value.role), value.officeCode].filter(Boolean).join(' · ')}
          </span>
        </span>
        <button
          type="button"
          className="text-xs text-primary-600 hover:underline"
          onClick={() => onChange(null)}
        >
          Change
        </button>
      </div>
    );
  }

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
          placeholder="Type a name…"
          aria-label="Assign to"
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line-strong bg-surface py-1 shadow-pop">
          {people.isLoading && <div className="px-3 py-2 text-sm text-ink-faint">Loading…</div>}
          {people.isSuccess && matches.length === 0 && (
            <div className="px-3 py-2 text-sm text-ink-faint">Nobody by that name.</div>
          )}
          {matches.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => {
                onChange(p);
                setTerm('');
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-sunken"
            >
              <span className="font-medium text-ink">{p.name}</span>
              <span className="text-xs text-ink-faint">
                {[p.role && humanize(p.role), p.officeCode].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
