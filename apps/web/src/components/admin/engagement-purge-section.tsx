'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Field, Input } from '@/components/form';

interface PurgePreview {
  id: string;
  engagementCode: string;
  clientName: string;
  status: string;
  financialYear: string;
  documents: number;
  tasks: number;
  filings: number;
  timeEntries: number;
  invoices: number;
  issuedInvoices: number;
  merged: number;
}

/**
 * Delete an engagement opened by mistake — administrator only. Found by its
 * code (an administrator is not on engagements, so the list would not show
 * it); the code is typed again to confirm. Everything under it goes.
 */
export function EngagementPurgeSection({
  initialCode = '',
}: {
  initialCode?: string;
}): JSX.Element {
  const toast = useToast();
  const [code, setCode] = useState(initialCode);
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const find = useMutation({
    mutationFn: (c: string) =>
      apiFetch<PurgePreview>(`/engagement-purge?code=${encodeURIComponent(c.trim())}`),
    onMutate: () => {
      setPreview(null);
      setConfirm('');
      setError(null);
    },
    onSuccess: setPreview,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not look it up.'),
  });

  const purge = useMutation({
    mutationFn: (p: PurgePreview) =>
      apiFetch<{ engagementCode: string; filesRemoved: number }>(`/engagement-purge/${p.id}`, {
        method: 'DELETE',
        body: { confirmCode: confirm.trim() },
      }),
    onSuccess: (r) => {
      toast(`${r.engagementCode} deleted permanently.`);
      setPreview(null);
      setConfirm('');
      setCode('');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not delete it.'),
  });

  const confirmed =
    !!preview && confirm.trim().toUpperCase() === preview.engagementCode.toUpperCase();

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-ink-muted">
        For an engagement opened by mistake. It is removed completely — its tasks, documents and
        their files, filings, time, invoices and credit notes, working papers and its history —
        however far it got. This cannot be undone.
      </p>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) find.mutate(code);
        }}
      >
        <Field label="Engagement code" className="flex-1">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ENG00012"
            autoComplete="off"
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={!code.trim() || find.isPending}>
          <Search className="h-4 w-4" /> Find
        </Button>
      </form>

      {error && <p className="text-sm text-danger-700">{error}</p>}

      {preview && (
        <section className="space-y-3 rounded-lg border border-danger-200 bg-danger-50 p-4">
          <div>
            <p className="font-medium text-ink">
              {preview.engagementCode} · {preview.clientName}
            </p>
            <p className="text-sm text-ink-muted">
              FY {preview.financialYear} · {preview.status.replace(/_/g, ' ')}
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-ink sm:grid-cols-3">
            <li>{count(preview.tasks, 'task')}</li>
            <li>{count(preview.documents, 'document')}</li>
            <li>{count(preview.filings, 'filing')}</li>
            <li>{count(preview.timeEntries, 'time entry', 'time entries')}</li>
            <li>
              {count(preview.invoices, 'invoice')}
              {preview.issuedInvoices > 0 && ` (${preview.issuedInvoices} issued)`}
            </li>
            {preview.merged > 0 && <li>{count(preview.merged, 'merged engagement')}</li>}
          </ul>
          {preview.issuedInvoices > 0 && (
            <p className="text-sm text-danger-800">
              Its issued invoices and their credit notes are deleted too. Receipts against them stay
              with the client as unallocated money.
            </p>
          )}
          <Field label={`Type ${preview.engagementCode} to confirm`}>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!confirmed || purge.isPending}
              onClick={() => purge.mutate(preview)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {purge.isPending ? 'Deleting…' : 'Delete permanently'}
            </button>
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(null);
                setConfirm('');
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
