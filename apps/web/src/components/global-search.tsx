'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Building2,
  Layers,
  CornerDownLeft,
  CalendarCheck,
  ListTodo,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import {
  FEATURE_FLAG,
  SEARCH_GROUP_LABEL,
  type Paginated,
  type SearchGroup,
  type SearchResponse,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { cn } from '@/lib/cn';
import type { EngagementRow, EntityRow } from '@/lib/types';

interface Result {
  group: SearchGroup;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const ICON: Record<SearchGroup, LucideIcon> = {
  clients: Building2,
  engagements: Layers,
  filings: CalendarCheck,
  tasks: ListTodo,
  documents: FileText,
};

/** The hits in display order, grouped — the server's order when it answered. Pure — tested. */
export function searchSections(
  data: SearchResponse | undefined,
): { group: SearchGroup; items: Result[] }[] {
  return (data?.groups ?? []).map((g) => ({
    group: g.group,
    items: g.items.map((h) => ({
      group: h.group,
      id: h.id,
      title: h.title,
      subtitle: h.subtitle,
      href: h.href,
    })),
  }));
}

/** What the box read the query as: "GSTR-1 · Sep 2026" style, or null. Pure — tested. */
export function understoodLine(data: SearchResponse | undefined): string | null {
  if (!data) return null;
  const parts = [
    ...data.understood.forms.map((f) => f.toUpperCase()),
    ...(data.understood.periodLabel ? [data.understood.periodLabel] : []),
  ];
  return parts.length > 0 ? `Looking for ${parts.join(' · ')}` : null;
}

/** Arrow keys move through every hit; it wraps. Pure — tested. */
export function stepActive(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/**
 * Global search (Ctrl K). With ff_filing_runs it asks GET /search, which finds
 * filings, tasks and documents too and reads forms and months ("bharat gstr1
 * sep" → that filing, first). Without it, clients and engagements as before.
 */
export function GlobalSearch(): JSX.Element {
  const router = useRouter();
  const { isOn } = useFeatureFlags();
  const wide = isOn(FEATURE_FLAG.filingRuns);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
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
  const grouped = useQuery({
    queryKey: ['search', 'all', debounced],
    queryFn: () => apiFetch<SearchResponse>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: enabled && wide,
  });
  const entities = useQuery({
    queryKey: ['search', 'entities', debounced],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(`/entities?search=${encodeURIComponent(debounced)}&limit=5`),
    enabled: enabled && !wide,
  });
  const engagements = useQuery({
    queryKey: ['search', 'engagements', debounced],
    queryFn: () =>
      apiFetch<Paginated<EngagementRow>>(
        `/engagements?search=${encodeURIComponent(debounced)}&limit=5`,
      ),
    enabled: enabled && !wide,
  });

  const sections = useMemo(() => {
    if (wide) return searchSections(grouped.data);
    const legacy: { group: SearchGroup; items: Result[] }[] = [
      {
        group: 'clients',
        items: (entities.data?.items ?? []).map((e) => ({
          group: 'clients' as const,
          id: e.id,
          title: e.legalName,
          subtitle: `${e.entityCode} · ${e.typeName}`,
          href: `/entities/${e.id}`,
        })),
      },
      {
        group: 'engagements',
        items: (engagements.data?.items ?? []).map((e) => ({
          group: 'engagements' as const,
          id: e.id,
          title: `${e.engagementCode} — ${e.entityName}`,
          subtitle: e.serviceName,
          href: `/engagements/${e.id}`,
        })),
      },
    ];
    return legacy.filter((s) => s.items.length > 0);
  }, [wide, grouped.data, entities.data, engagements.data]);
  const results = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => setActive(-1), [debounced]);

  const go = (href: string): void => {
    setOpen(false);
    setTerm('');
    router.push(href);
  };

  const loading = enabled && (wide ? grouped.isFetching : entities.isFetching || engagements.isFetching);
  const understood = wide ? understoodLine(grouped.data) : null;
  // Legacy groups are shown unlabelled, as before; the grouped search heads each group.
  const headed = wide;
  let index = -1;

  return (
    <div ref={boxRef} className="relative hidden max-w-xl flex-1 sm:block">
      <div className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-sm focus-within:border-primary-500 focus-within:bg-surface focus-within:ring-2 focus-within:ring-primary-500/20">
        <Search className="h-4 w-4 text-ink-faint" />
        <input
          ref={inputRef}
          value={term}
          role="combobox"
          aria-expanded={open && enabled}
          aria-controls="global-search-results"
          aria-label="Search"
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => stepActive(a, e.key === 'ArrowDown' ? 1 : -1, results.length));
            } else if (e.key === 'Enter') {
              const hit = results[active >= 0 ? active : 0];
              if (hit) go(hit.href);
            }
          }}
          placeholder={
            wide
              ? 'Search clients, filings, tasks… try “bharat gstr1 sep”'
              : 'Search clients and engagements…'
          }
          className="flex-1 bg-transparent text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <kbd className="rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
          Ctrl K
        </kbd>
      </div>

      {open && enabled && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-[28rem] overflow-y-auto rounded-lg border border-line-strong bg-surface py-1 shadow-pop"
        >
          {understood && (
            <div className="px-3 pb-1 pt-1.5 text-xs text-ink-faint">{understood}</div>
          )}
          {loading && results.length === 0 && (
            <div className="px-3 py-3 text-sm text-ink-faint">Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-sm text-ink-faint">No matches for “{debounced}”.</div>
          )}
          {sections.map((s) => (
            <div key={s.group} role="group" aria-label={SEARCH_GROUP_LABEL[s.group]}>
              {headed && (
                <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {SEARCH_GROUP_LABEL[s.group]}
                </div>
              )}
              {s.items.map((r) => {
                index += 1;
                const i = index;
                const Icon = ICON[r.group];
                return (
                  <button
                    key={`${r.group}-${r.id}`}
                    role="option"
                    aria-selected={active === i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.href)}
                    className={cn(
                      'group flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-raised',
                      active === i && 'bg-surface-raised',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        r.group === 'clients' ? 'text-primary-600' : 'text-secondary-600',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                      <span className="block truncate text-xs text-ink-faint">{r.subtitle}</span>
                    </span>
                    <CornerDownLeft
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 text-ink-faint opacity-0 group-hover:opacity-100',
                        active === i && 'opacity-100',
                      )}
                    />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
