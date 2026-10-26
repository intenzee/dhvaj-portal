'use client';

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { TeamPerson } from '@hsdg/contracts';
import { Select } from '@/components/form';

/** The overseeing partner: active partner-grade people only. */
export function PartnerSelect({
  people,
  value,
  onChange,
  exclude,
  id,
}: {
  people: TeamPerson[];
  value: string;
  onChange: (id: string) => void;
  exclude?: Set<string>;
  id?: string;
}): JSX.Element {
  const partners = people.filter((p) => p.isPartner && p.active && !exclude?.has(p.id));
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Pick a partner…</option>
      {partners.map((p) => (
        <option key={p.id} value={p.id}>
          {p.fullName} · {p.gradeName} · {p.officeCode}
        </option>
      ))}
    </Select>
  );
}

/** Search-as-you-type multi-picker over active staff, showing each person's grade. */
export function PeopleMultiPicker({
  people,
  value,
  onChange,
  exclude,
  placeholder = 'Search people by name…',
}: {
  people: TeamPerson[];
  value: string[];
  onChange: (ids: string[]) => void;
  exclude?: Set<string>;
  placeholder?: string;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const t = term.trim().toLowerCase();
  const results = t
    ? people
        .filter(
          (p) =>
            p.active &&
            !value.includes(p.id) &&
            !exclude?.has(p.id) &&
            p.fullName.toLowerCase().includes(t),
        )
        .slice(0, 8)
    : [];
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((id) => {
            const p = byId.get(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
              >
                {p?.fullName ?? 'Unknown'}
                {p && <span className="text-primary-700/70">· {p.gradeName}</span>}
                <button
                  type="button"
                  aria-label={`Remove ${p?.fullName ?? 'person'}`}
                  onClick={() => onChange(value.filter((v) => v !== id))}
                  className="rounded hover:bg-primary-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2">
          <Search className="h-4 w-4 text-ink-faint" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>
        {t && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line-strong bg-surface py-1 shadow-pop">
            {results.length === 0 && (
              <div className="px-3 py-2 text-sm text-ink-faint">No one found.</div>
            )}
            {results.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => {
                  onChange([...value, p.id]);
                  setTerm('');
                }}
                className="block w-full px-3 py-2 text-left hover:bg-surface-raised"
              >
                <span className="block text-sm font-medium text-ink">{p.fullName}</span>
                <span className="block text-xs text-ink-faint">
                  {p.gradeName} · {p.officeCode}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
