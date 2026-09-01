'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Heading1, Heading2, Pilcrow } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { EditorHandle } from './types';

/**
 * Word (.docx) viewer/editor. mammoth converts the document to HTML for display;
 * in edit mode a contentEditable surface with a small formatting toolbar lets the
 * user change it, and {@link EditorHandle.export} rebuilds a .docx from the edited
 * HTML (see `html-to-docx`). Content-faithful, not pixel-faithful.
 */
export const WordEditor = forwardRef<EditorHandle, { blob: Blob; readOnly: boolean; onDirty: () => void }>(
  function WordEditor({ blob, readOnly, onDirty }, ref) {
    const elRef = useRef<HTMLDivElement>(null);
    const htmlRef = useRef<string>('<p></p>');
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const mammoth = await import('mammoth/mammoth.browser');
          const buf = await blob.arrayBuffer();
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (cancelled) return;
          htmlRef.current = value && value.trim() ? value : '<p></p>';
          setReady(true);
        } catch {
          if (!cancelled) setError('Could not read this Word document.');
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [blob]);

    // Seed the surface imperatively once the HTML is ready, so React never
    // reconciles away the user's live edits on a later re-render.
    useEffect(() => {
      if (ready && elRef.current && elRef.current.innerHTML !== htmlRef.current) {
        elRef.current.innerHTML = htmlRef.current;
      }
    }, [ready]);

    useImperativeHandle(
      ref,
      () => ({
        async export(): Promise<Blob> {
          const html = elRef.current?.innerHTML ?? htmlRef.current;
          const { htmlToDocxBlob } = await import('@/lib/html-to-docx');
          return htmlToDocxBlob(html);
        },
      }),
      [],
    );

    const exec = (command: string, value?: string): void => {
      elRef.current?.focus();
      document.execCommand(command, false, value);
      onDirty();
    };

    if (error) {
      return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">{error}</div>;
    }
    if (!ready) {
      return (
        <div className="flex h-full items-center justify-center">
          <Spinner label="Opening document…" />
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col">
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface px-2 py-1.5">
            <ToolButton title="Bold" onClick={() => exec('bold')}><Bold className="h-4 w-4" /></ToolButton>
            <ToolButton title="Italic" onClick={() => exec('italic')}><Italic className="h-4 w-4" /></ToolButton>
            <ToolButton title="Underline" onClick={() => exec('underline')}><Underline className="h-4 w-4" /></ToolButton>
            <div className="mx-1 h-5 w-px bg-line" />
            <ToolButton title="Heading 1" onClick={() => exec('formatBlock', 'H1')}><Heading1 className="h-4 w-4" /></ToolButton>
            <ToolButton title="Heading 2" onClick={() => exec('formatBlock', 'H2')}><Heading2 className="h-4 w-4" /></ToolButton>
            <ToolButton title="Normal text" onClick={() => exec('formatBlock', 'P')}><Pilcrow className="h-4 w-4" /></ToolButton>
            <div className="mx-1 h-5 w-px bg-line" />
            <ToolButton title="Bulleted list" onClick={() => exec('insertUnorderedList')}><List className="h-4 w-4" /></ToolButton>
            <ToolButton title="Numbered list" onClick={() => exec('insertOrderedList')}><ListOrdered className="h-4 w-4" /></ToolButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto bg-surface-raised p-4">
          <div
            ref={elRef}
            contentEditable={!readOnly}
            suppressContentEditableWarning
            onInput={onDirty}
            spellCheck={false}
            className={cn(
              'doc-surface mx-auto min-h-full max-w-3xl rounded border border-line bg-surface p-8 text-sm leading-relaxed text-ink shadow-sm outline-none',
              !readOnly && 'focus:ring-2 focus:ring-primary-300',
            )}
          />
        </div>
      </div>
    );
  },
);

function ToolButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // Keep the editor selection while clicking a toolbar button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded p-1.5 text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
    >
      {children}
    </button>
  );
}
