'use client';

import { useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, ExternalLink, X } from 'lucide-react';
import {
  FEATURE_FLAG,
  periodKeyLabel,
  type InstanceWorkspace as Workspace,
  type WorkItemRef,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatureFlags } from '@/lib/feature-flags';
import { planningTeam, taskContextFor } from '@/lib/engagement-context';
import type { EngagementDetail } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { Spinner } from '@/components/ui';
import { InstanceWorkspace, workspaceKey } from './instance-workspace';
import { FilingClock } from './filing-clock';

/** The URL parameter that opens a filing in the drawer, so it can be linked. */
export const OPEN_FILING_PARAM = 'open';

/** A row of the list the drawer was opened from. */
export interface DrawerItem {
  instanceId: string;
  title: string;
  /** The filing's own page (its engagement tab), for "Open in engagement". */
  href?: string;
}

/** `?open=<instanceId>`: which filing the drawer shows, and how to change it. */
export function useOpenFiling(): {
  openId: string | null;
  open: (instanceId: string) => void;
  close: () => void;
} {
  const url = useUrlState();
  const openId = url.get(OPEN_FILING_PARAM);
  const open = useCallback(
    (instanceId: string) => url.set({ [OPEN_FILING_PARAM]: instanceId }),
    [url],
  );
  const close = useCallback(() => url.set({ [OPEN_FILING_PARAM]: null }), [url]);
  return { openId, open, close };
}

/**
 * For a list's plain row click: open the row's filing in the drawer and say so
 * (true), or leave the click to the row's link (false) — no filing, or the
 * drawer is not switched on (it ships with ff_today_view).
 */
export function useDrawerOpener(): (row: { link?: WorkItemRef | null }) => boolean {
  const { open } = useOpenFiling();
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.todayView) && isOn(FEATURE_FLAG.workLinks);
  return useCallback(
    (row) => {
      const id = row.link?.instanceId;
      if (!on || !id) return false;
      open(id);
      return true;
    },
    [on, open],
  );
}

/** A list's rows as the drawer's Previous / Next list: each filing once, in order. Pure — tested. */
export function drawerItemsFrom<T extends { link?: WorkItemRef | null }>(
  rows: readonly T[],
  titleOf: (row: T) => string,
  hrefOf: (row: T) => string,
): DrawerItem[] {
  const seen = new Set<string>();
  const out: DrawerItem[] = [];
  for (const row of rows) {
    const id = row.link?.instanceId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ instanceId: id, title: titleOf(row), href: hrefOf(row) });
  }
  return out;
}

/** The neighbours of the open filing in its list. Pure — tested. */
export function drawerNeighbours(
  items: readonly DrawerItem[],
  openId: string | null,
): { index: number; prev: DrawerItem | null; next: DrawerItem | null } {
  const index = openId ? items.findIndex((i) => i.instanceId === openId) : -1;
  return {
    index,
    prev: index > 0 ? items[index - 1]! : null,
    next: index >= 0 && index < items.length - 1 ? items[index + 1]! : null,
  };
}

/** Escape belongs to a field being typed in, or to a dialog opened inside the drawer. */
function escapeIsTaken(target: EventTarget | null): boolean {
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  const el = target as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
}

/**
 * Staff Workflow WF-202: one filing worked in a right-hand drawer over the list
 * it was opened from — the same `InstanceWorkspace` the stream tab renders, so
 * the two never drift. `?open=` names the filing; Previous / Next walk the
 * list; Esc closes. Anything done here refreshes the list (`listKey`) and the
 * stream tab's caches.
 */
export function FilingDrawer({
  items,
  listKey,
}: {
  items: readonly DrawerItem[];
  /** The list's React Query key, refreshed after every change in the drawer. */
  listKey?: QueryKey;
}): JSX.Element | null {
  const { openId, open, close } = useOpenFiling();
  const { index, prev, next } = drawerNeighbours(items, openId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The same query the body runs (shared by key): it names a filing that is not
  // (or no longer) in the list — e.g. once approved it leaves "To review".
  const ws = useQuery({
    queryKey: workspaceKey(openId ?? ''),
    queryFn: () => apiFetch<Workspace>(`/compliance-instances/${openId}`),
    enabled: !!openId,
  });

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !escapeIsTaken(e.target)) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, close]);

  useEffect(() => {
    if (openId) headingRef.current?.focus();
  }, [openId]);

  if (!openId) return null;
  const item = index >= 0 ? items[index]! : null;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="filing-drawer-title"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line-strong bg-surface shadow-pop sm:w-[46rem] sm:max-w-[92vw]"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2
            id="filing-drawer-title"
            ref={headingRef}
            tabIndex={-1}
            className="truncate text-base font-semibold text-ink outline-none"
          >
            {item?.title ?? (ws.data ? workspaceTitle(ws.data) : 'Filing')}
          </h2>
          {index >= 0 && (
            <p className="text-xs text-ink-faint">
              {index + 1} of {items.length}
            </p>
          )}
        </div>
        <FilingClock instanceId={openId} />
        <button
          type="button"
          onClick={() => prev && open(prev.instanceId)}
          disabled={!prev}
          aria-label="Previous filing"
          title="Previous"
          className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-sunken disabled:opacity-40"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => next && open(next.instanceId)}
          disabled={!next}
          aria-label="Next filing"
          title="Next"
          className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-sunken disabled:opacity-40"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
        {item?.href && (
          <Link
            href={item.href}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-sunken"
            aria-label="Open in engagement"
            title="Open in engagement"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-sunken hover:text-ink"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <DrawerBody key={openId} instanceId={openId} listKey={listKey} />
      </div>
    </aside>
  );
}

/** "GSTR-1 · Sep 2026" for a filing's workspace. Pure — tested. */
export function workspaceTitle(ws: Pick<Workspace, 'instance'>): string {
  const i = ws.instance;
  return [
    i.formLabel ?? i.ruleName,
    i.periodLabel ?? (i.periodKey ? periodKeyLabel(i.periodKey) : null),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The filing, with the task context its engagement gives me (lead or not, the team). */
function DrawerBody({
  instanceId,
  listKey,
}: {
  instanceId: string;
  listKey?: QueryKey;
}): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const ws = useQuery({
    queryKey: workspaceKey(instanceId),
    queryFn: () => apiFetch<Workspace>(`/compliance-instances/${instanceId}`),
  });
  const engagementId = ws.data?.instance.engagementId ?? null;
  const eng = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => apiFetch<EngagementDetail>(`/engagements/${engagementId}`),
    enabled: !!engagementId,
  });

  // Every change in the drawer replaces or refetches the workspace: refresh the list too.
  const seen = useRef<number | null>(null);
  const updatedAt = ws.dataUpdatedAt;
  useEffect(() => {
    if (!updatedAt) return;
    if (seen.current !== null && seen.current !== updatedAt && listKey) {
      void qc.invalidateQueries({ queryKey: listKey });
    }
    seen.current = updatedAt;
  }, [updatedAt, listKey, qc]);

  if (ws.isLoading || (engagementId && eng.isLoading)) return <Spinner />;
  if (!eng.data)
    return <InstanceWorkspace instanceId={instanceId} ctx={taskContextFor(principal, {})} />;
  return (
    <InstanceWorkspace
      instanceId={instanceId}
      ctx={taskContextFor(principal, eng.data)}
      team={planningTeam(eng.data)}
    />
  );
}
