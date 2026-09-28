'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Open modals, innermost last — so Escape closes only the topmost one when a
 *  dialog opens another (e.g. a form inside a workspace). */
const openStack: symbol[] = [];

/**
 * A centered modal dialog. Closes on Escape (topmost only) or backdrop click.
 *
 * `size="workspace"` is a near-full-screen working surface (e.g. an audit
 * phase): the body scrolls inside the dialog, and a stray backdrop click does
 * not close it, so in-progress work is not dismissed by accident.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
  size,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  size?: 'md' | 'lg' | 'workspace';
}): JSX.Element | null {
  const resolved = size ?? (wide ? 'lg' : 'md');
  const isWorkspace = resolved === 'workspace';
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = Symbol('modal');
    openStack.push(id);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === id) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    // Keep the page behind a workspace from scrolling underneath it.
    const prevOverflow = document.body.style.overflow;
    if (isWorkspace) document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      openStack.splice(openStack.indexOf(id), 1);
      if (isWorkspace) document.body.style.overflow = prevOverflow;
    };
  }, [open, isWorkspace]);

  if (!open) return null;

  const width = isWorkspace ? 'max-w-7xl' : resolved === 'lg' ? 'max-w-2xl' : 'max-w-md';

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-slate-900/40 ${
        isWorkspace ? 'items-center p-2 sm:p-4' : 'items-start overflow-y-auto p-4 pt-[8vh]'
      }`}
      onClick={isWorkspace ? undefined : onClose}
    >
      <div
        className={`w-full ${width} rounded-xl border border-line-strong bg-surface shadow-pop ${
          isWorkspace ? 'flex h-full max-h-[94vh] flex-col' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-faint hover:bg-surface-sunken hover:text-ink"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={isWorkspace ? 'min-h-0 flex-1 overflow-y-auto px-5 py-4' : 'px-5 py-4'}>
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
