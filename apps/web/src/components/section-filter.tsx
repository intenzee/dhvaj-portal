'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  parseWorkSections,
  WORK_SECTIONS,
  WORK_SECTION_LABEL,
  workSectionsParam,
  type WorkSection,
} from '@hsdg/contracts';
import { useUrlState } from '@/lib/url-state';
import { cn } from '@/lib/cn';

/**
 * Section filter — "GST only", "Income Tax only", … The same vocabulary
 * (WORK_SECTIONS) on the home calendar, tasks, clients and engagements. An
 * empty selection means every section.
 *
 * - `SectionChips`: a chip row for list pages; chips toggle (any-of), "All"
 *   clears.
 * - `SectionSelect`: a compact single-pick for narrow dashboard panels.
 * - `useUrlSections`: a page's selection kept in `?section=` (shareable).
 * - `useStoredSections`: a dashboard panel's selection remembered per browser.
 */

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition',
        active
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
      )}
    >
      {children}
    </button>
  );
}

/** Toggle one section in a selection, keeping WORK_SECTIONS order. Pure. */
export function toggleSection(value: readonly WorkSection[], s: WorkSection): WorkSection[] {
  const next = value.includes(s) ? value.filter((x) => x !== s) : [...value, s];
  return WORK_SECTIONS.filter((x) => next.includes(x));
}

export function SectionChips({
  value,
  onChange,
  sections = WORK_SECTIONS,
  className,
}: {
  value: readonly WorkSection[];
  onChange: (next: WorkSection[]) => void;
  /** The sections this list can be filtered by (default: all eight). */
  sections?: readonly WorkSection[];
  className?: string;
}): JSX.Element {
  return (
    <div role="group" aria-label="Section" className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-xs font-medium text-ink-faint">Section</span>
      <Chip active={value.length === 0} onClick={() => onChange([])}>
        All
      </Chip>
      {sections.map((s) => (
        <Chip key={s} active={value.includes(s)} onClick={() => onChange(toggleSection(value, s))}>
          {WORK_SECTION_LABEL[s]}
        </Chip>
      ))}
    </div>
  );
}

export function SectionSelect({
  value,
  onChange,
  sections = WORK_SECTIONS,
  className,
}: {
  value: readonly WorkSection[];
  onChange: (next: WorkSection[]) => void;
  sections?: readonly WorkSection[];
  className?: string;
}): JSX.Element {
  const current = value.length === 1 && sections.includes(value[0]!) ? value[0]! : '';
  return (
    <select
      aria-label="Section"
      value={current}
      onChange={(e) => onChange(e.target.value ? [e.target.value as WorkSection] : [])}
      className={cn(
        'max-w-[10rem] rounded-full border px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/30',
        current
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-line-strong bg-surface text-ink-muted',
        className,
      )}
    >
      <option value="">All sections</option>
      {sections.map((s) => (
        <option key={s} value={s}>
          {WORK_SECTION_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

/** The `?section=` selection of a list page, limited to `sections`. */
export function useUrlSections(
  sections: readonly WorkSection[] = WORK_SECTIONS,
): [WorkSection[], (next: WorkSection[]) => void] {
  const url = useUrlState();
  const value = parseWorkSections(url.get('section')).filter((s) => sections.includes(s));
  const set = useCallback(
    (next: WorkSection[]) => url.set({ section: workSectionsParam(next) || null }),
    [url],
  );
  return [value, set];
}

/**
 * A dashboard panel's selection, remembered in this browser under
 * `hsdg.section.<key>`. Storage can be unavailable (private window, blocked
 * site data) — the panel then just starts on "All".
 */
export function useStoredSections(
  key: string,
  sections: readonly WorkSection[] = WORK_SECTIONS,
): [WorkSection[], (next: WorkSection[]) => void] {
  const storageKey = `hsdg.section.${key}`;
  const [value, setValue] = useState<WorkSection[]>([]);
  useEffect(() => {
    try {
      const saved = parseWorkSections(window.localStorage.getItem(storageKey));
      setValue(saved.filter((s) => sections.includes(s)));
    } catch {
      /* storage unavailable — keep "All" */
    }
    // `sections` is a constant list per panel; re-reading on key change is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const set = useCallback(
    (next: WorkSection[]) => {
      setValue(next);
      try {
        if (next.length) window.localStorage.setItem(storageKey, workSectionsParam(next));
        else window.localStorage.removeItem(storageKey);
      } catch {
        /* storage unavailable — the choice lasts for this visit */
      }
    },
    [storageKey],
  );
  return [value, set];
}
