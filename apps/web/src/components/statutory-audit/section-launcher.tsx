'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Modal } from '@/components/modal';

/**
 * Sub-sections of an audit-file section (e.g. 03.1's Signal register, Areas of
 * Focus, …) as a grid of tiles. Picking one opens its work in a workspace
 * pop-up ({@link SectionModal}), so a section is a compact index rather than a
 * long page of stacked forms.
 */
export function SectionLauncher<K extends string>({
  sections,
  onOpen,
}: {
  sections: [K, string][];
  onOpen: (key: K) => void;
}): JSX.Element {
  return (
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Sub-sections">
      {sections.map(([key, label], i) => (
        <li key={key}>
          <button
            type="button"
            onClick={() => onOpen(key)}
            className="group flex h-full w-full items-center gap-3 rounded-lg border border-line bg-surface-raised px-3.5 py-3 text-left transition hover:border-primary-600/50 hover:bg-surface-sunken"
          >
            <span className="font-mono text-[11px] text-ink-faint">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="flex-1 text-sm font-medium leading-snug text-ink">{label}</span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-primary-600"
              aria-hidden
            />
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The workspace pop-up holding the open sub-section of a {@link SectionLauncher}. */
export function SectionModal<K extends string>({
  open,
  sections,
  context,
  onClose,
  children,
}: {
  open: K | null;
  sections: [K, string][];
  /** The parent section, shown under the title (e.g. "03.3 Materiality"). */
  context: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const label = sections.find(([key]) => key === open)?.[1] ?? '';
  return (
    <Modal
      open={open !== null}
      onClose={onClose}
      title={label}
      description={context}
      size="workspace"
    >
      {children}
    </Modal>
  );
}
