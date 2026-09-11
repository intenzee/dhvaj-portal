'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { DocumentsPanel, type DocumentScope } from '@/components/documents/documents-panel';

/**
 * A pop-up window showing ONLY the documents for one scope — a task, or a
 * component-work period (e.g. GST for a month). Nothing else in the engagement
 * is visible, so a person working on one item sees exactly its files. Wider than
 * the standard Modal to fit the list + side-preview panel. Closes on backdrop
 * click or Escape.
 */
export function ScopedDocumentsModal({
  engagementId,
  scope,
  title,
  subtitle,
  onClose,
}: {
  engagementId: string;
  scope: DocumentScope;
  title: string;
  subtitle?: string;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-xl border border-line-strong bg-surface shadow-pop"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-ink-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-faint hover:bg-surface-sunken hover:text-ink"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">
          <DocumentsPanel engagementId={engagementId} scope={scope} scopeLabel={title} />
        </div>
      </div>
    </div>
  );
}
