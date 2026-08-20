'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, Building2, Layers, CornerDownLeft } from 'lucide-react';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import type { EngagementRow, EntityRow } from '@/lib/types';

interface Result {
  kind: 'entity' | 'engagement';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** Global search over clients and engagements (backed by the API's search params). */
export function GlobalSearch(): JSX.Element {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce input.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  // Ctrl/Cmd-K focuses the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const enabled = debounced.length >= 2;
  const entities = useQuery({
    queryKey: ['search', 'entities', debounced],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(`/entities?search=${encodeURIComponent(debounced)}&limit=5`),
    enabled,
  });
  const engagements = useQuery({
    queryKey: ['search', 'engagements', debounced],
    queryFn: () =>
      apiFetch<Paginated<EngagementRow>>(
        `/engagements?search=${encodeURIComponent(debounced)}&limit=5`,
      ),
    enabled,
  });

  const results: Result[] = [
    ...(entities.data?.items ?? []).map((e) => ({
      kind: 'entity' as const,
      id: e.id,
      title: e.legalName,
      subtitle: `${e.entityCode} · ${e.typeName}`,
      href: `/entities/${e.id}`,
    })),
    ...(engagements.data?.items ?? []).map((e) => ({
      kind: 'engagement' as const,
      id: e.id,
      title: `${e.engagementCode} — ${e.entityName}`,
      subtitle: e.serviceName,
      href: `/engagements/${e.id}`,
    })),
  ];

  const go = (href: string): void => {
    setOpen(false);
    setTerm('');
    router.push(href);
  };

  const loading = enabled && (entities.isFetching || engagements.isFetching);

  return (
    <div ref={boxRef} className="relative hidden max-w-xl flex-1 sm:block">
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus-within:border-primary-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-primary-500/20">
        <Search className="h-4 w-4 text-ink-faint" />
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) go(results[0].href);
          }}
          placeholder="Search clients and engagements…"
          className="flex-1 bg-transparent text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
          Ctrl K
        </kbd>
      </div>

      {open && enabled && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop">
          {loading && results.length === 0 && (
            <div className="px-3 py-3 text-sm text-ink-faint">Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-sm text-ink-faint">No matches for “{debounced}”.</div>
          )}
          {results.map((r) => (
            <button
              key={`${r.kind}-${r.id}`}
              onClick={() => go(r.href)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
            >
              {r.kind === 'entity' ? (
                <Building2 className="h-4 w-4 shrink-0 text-primary-600" />
              ) : (
                <Layers className="h-4 w-4 shrink-0 text-secondary-600" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                <span className="block truncate text-xs text-ink-faint">{r.subtitle}</span>
              </span>
              <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-faint opacity-0 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
