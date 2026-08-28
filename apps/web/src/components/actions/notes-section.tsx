'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pin, PinOff, Trash2 } from 'lucide-react';
import type { EngagementNote } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Card, EmptyState, Button, Spinner } from '@/components/ui';
import { Textarea } from '@/components/form';

export function NotesSection({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');

  const key = ['engagement', engagementId, 'notes'] as const;
  const notes = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<EngagementNote[]>(`/engagements/${engagementId}/notes`),
  });
  const invalidate = (): void => void qc.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/notes`, {
        method: 'POST',
        body: { body: body.trim() },
      }),
    onSuccess: () => {
      setBody('');
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not add the note.', 'error'),
  });
  const pin = useMutation({
    mutationFn: (n: EngagementNote) =>
      apiFetch(`/engagements/${engagementId}/notes/${n.id}`, {
        method: 'PATCH',
        body: { isPinned: !n.isPinned },
      }),
    onSuccess: invalidate,
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Not permitted.', 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/engagements/${engagementId}/notes/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Not permitted.', 'error'),
  });

  const items = notes.data ?? [];

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-ink">Notes</h2>

      <Card className="p-3">
        <Textarea
          rows={2}
          placeholder="Add a professional note for the team…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={() => add.mutate()} disabled={!body.trim() || add.isPending}>
            Add note
          </Button>
        </div>
      </Card>

      {notes.isLoading && <Spinner />}
      {notes.data && items.length === 0 && <EmptyState>No notes yet.</EmptyState>}

      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id}>
            <Card className="p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="whitespace-pre-wrap text-sm text-ink">{n.body}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className={`rounded p-1.5 hover:bg-surface-sunken ${n.isPinned ? 'text-primary-600' : 'text-ink-faint'}`}
                    onClick={() => pin.mutate(n)}
                    aria-label={n.isPinned ? 'Unpin' : 'Pin'}
                    title={n.isPinned ? 'Unpin' : 'Pin'}
                  >
                    {n.isPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    className="rounded p-1.5 text-ink-faint hover:bg-surface-sunken hover:text-danger-600"
                    onClick={() => remove.mutate(n.id)}
                    aria-label="Remove note"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-1.5 text-xs text-ink-faint">
                {n.authorName ?? 'Unknown'} · {formatDate(n.createdAt)}
                {n.isPinned && <span className="ml-2 text-primary-600">Pinned</span>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
