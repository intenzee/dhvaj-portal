'use client';

import type { ReactNode } from 'react';
import { ExpandToggle, InlinePanel } from '@/components/inline-panel';

/**
 * Sub-sections of an audit-file section (e.g. 03.1's Signal register, Areas of
 * Focus, …) as an expandable list. Each row carries a +/− toggle: `+` opens the
 * sub-section's work directly underneath it, `−` (or clicking the row again)
 * collapses it — worked in place, never in a pop-up. One sub-section is open
 * at a time so the section stays a compact index.
 *
 * `children` is the open sub-section's content; the caller renders it by key
 * exactly as before. A key that has no row of its own (e.g. a revision view
 * reached from a banner) opens below the list.
 */
export function SectionLauncher<K extends string>({
  sections,
  open,
  onToggle,
  context,
  children,
}: {
  sections: [K, string][];
  open: K | null;
  onToggle: (key: K | null) => void;
  /** The parent section, shown on the open sub-section (e.g. "03.3 Materiality"). */
  context: string;
  children: ReactNode;
}): JSX.Element {
  const listed = open !== null && sections.some(([key]) => key === open);
  return (
    <div>
      <ol className="space-y-2" aria-label="Sub-sections">
        {sections.map(([key, label], i) => {
          const isOpen = key === open;
          return (
            <li key={key}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => onToggle(isOpen ? null : key)}
                className={`group flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition hover:border-primary-600/50 hover:bg-surface-sunken ${
                  isOpen
                    ? 'border-primary-600/50 bg-surface-sunken'
                    : 'border-line bg-surface-raised'
                }`}
              >
                <ExpandToggle open={isOpen} />
                <span className="font-mono text-[11px] text-ink-faint">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 text-sm font-medium leading-snug text-ink">{label}</span>
              </button>
              {isOpen && (
                <InlinePanel
                  open
                  title={label}
                  description={context}
                  onClose={() => onToggle(null)}
                >
                  {children}
                </InlinePanel>
              )}
            </li>
          );
        })}
      </ol>
      {open !== null && !listed && (
        <InlinePanel open title={context} onClose={() => onToggle(null)}>
          {children}
        </InlinePanel>
      )}
    </div>
  );
}
