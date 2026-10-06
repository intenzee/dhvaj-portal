'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redo2, Undo2, X } from 'lucide-react';
import type { AuditUndoResult, AuditUndoStatus } from '@hsdg/contracts';
import { apiFetch, AUDIT_FILE_CHANGED } from '@/lib/api';
import { useToast } from '@/lib/toast';

/**
 * Undo / Redo for the audit file. Every click that changes the file is one
 * step; the person who took it can take it back (and put it back) from here,
 * with ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y), or from the "Undo" prompt that appears
 * right after the click. The server refuses when someone has changed the same
 * thing since, so an undo never overwrites anyone's later work.
 */

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

/** Typing in a field keeps the field's own undo. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function UndoControls({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const statusKey = ['engagement', engagementId, 'audit-undo'];
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => apiFetch<AuditUndoStatus>(`/engagements/${engagementId}/statutory-audit/undo`),
  });
  const undo = status.data?.undo ?? null;
  const redo = status.data?.redo ?? null;

  // The step just taken, offered back in a prompt for a few seconds.
  const [prompt, setPrompt] = useState<{ id: string; description: string } | null>(null);
  const lastSeen = useRef<string | null>(null);
  useEffect(() => {
    if (status.data) lastSeen.current = status.data.undo?.id ?? null;
  }, [status.data]);

  useEffect(() => {
    const onChanged = (e: Event): void => {
      const path = (e as CustomEvent<string>).detail ?? '';
      if (!path.includes(`/engagements/${engagementId}/`)) return;
      void status.refetch().then(({ data }) => {
        const step = data?.undo;
        if (step && step.id !== lastSeen.current) {
          setPrompt({ id: step.id, description: step.description });
        }
      });
    };
    window.addEventListener(AUDIT_FILE_CHANGED, onChanged);
    return () => window.removeEventListener(AUDIT_FILE_CHANGED, onChanged);
  }, [engagementId, status]);

  useEffect(() => {
    if (!prompt) return;
    const t = setTimeout(() => setPrompt(null), 8000);
    return () => clearTimeout(t);
  }, [prompt]);

  const replay = useMutation({
    mutationFn: (direction: 'undo' | 'redo') =>
      apiFetch<AuditUndoResult>(`/engagements/${engagementId}/statutory-audit/${direction}`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (res, direction) => {
      qc.setQueryData<AuditUndoStatus>(statusKey, { undo: res.undo, redo: res.redo });
      setPrompt(null);
      // Everything on the file may have moved — re-read it all.
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
      toast(`${direction === 'undo' ? 'Undone' : 'Redone'}: ${res.applied.description}`);
    },
    onError: (err: Error) => {
      toast(err.message, 'error');
      void status.refetch();
    },
  });

  const run = useCallback(
    (direction: 'undo' | 'redo') => {
      if (replay.isPending) return;
      if (direction === 'undo' ? !undo : !redo) return;
      replay.mutate(direction);
    },
    [replay, undo, redo],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || isEditable(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (!undo) return;
        e.preventDefault();
        run('undo');
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !IS_MAC)) {
        if (!redo) return;
        e.preventDefault();
        run('redo');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, undo, redo]);

  const btn =
    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition hover:bg-surface-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <>
      <div className="flex items-center gap-0.5" role="group" aria-label="Undo and redo">
        <button
          type="button"
          className={btn}
          disabled={!undo || replay.isPending}
          onClick={() => run('undo')}
          title={undo ? `Undo: ${undo.description} (${MOD}Z)` : 'Nothing to undo'}
          aria-label={undo ? `Undo: ${undo.description}` : 'Undo'}
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
          Undo
        </button>
        <button
          type="button"
          className={btn}
          disabled={!redo || replay.isPending}
          onClick={() => run('redo')}
          title={
            redo ? `Redo: ${redo.description} (${IS_MAC ? '⇧⌘Z' : 'Ctrl+Y'})` : 'Nothing to redo'
          }
          aria-label={redo ? `Redo: ${redo.description}` : 'Redo'}
        >
          <Redo2 className="h-3.5 w-3.5" aria-hidden />
          Redo
        </button>
      </div>

      {prompt && undo?.id === prompt.id && (
        <div
          role="status"
          className="fixed bottom-4 left-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm shadow-pop"
        >
          <span className="min-w-0 flex-1 truncate text-ink" title={prompt.description}>
            {prompt.description}
          </span>
          <button
            type="button"
            className="shrink-0 font-semibold text-primary-700 hover:underline"
            onClick={() => run('undo')}
            disabled={replay.isPending}
          >
            Undo
          </button>
          <button
            type="button"
            className="shrink-0 text-ink-faint hover:text-ink"
            onClick={() => setPrompt(null)}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
    </>
  );
}
