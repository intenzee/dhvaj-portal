'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Stamp, FolderOpen } from 'lucide-react';
import {
  type ComponentInstanceRecord,
  type ComponentInstanceStatus,
  type GenerateInstancesResult,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize, formatDate } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { PERMISSION } from '@hsdg/contracts';
import { useToast } from '@/lib/toast';
import { Card, EmptyState, Badge, Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input } from '@/components/form';
import { ScopedDocumentsModal } from '@/components/documents/scoped-documents-modal';
import { CompletionBar } from '@/components/completion';

const STATUS_TONE: Record<ComponentInstanceStatus, string> = {
  scheduled: 'neutral',
  active: 'info',
  completed: 'success',
  waived: 'warn',
  cancelled: 'danger',
  superseded: 'neutral',
};

/**
 * Component work (spec §21–§22, §26): the period-specific instances generated
 * from the configured recurring components, with a bulk "Generate work" action
 * and per-instance completion. Scheduled/future work is visually distinct from
 * current work.
 */
export function ComponentWorkSection({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const [registerFor, setRegisterFor] = useState<ComponentInstanceRecord | null>(null);
  const [docsFor, setDocsFor] = useState<ComponentInstanceRecord | null>(null);

  const work = useQuery({
    queryKey: ['engagement', engagementId, 'component-work'],
    queryFn: () =>
      apiFetch<Paginated<ComponentInstanceRecord>>(
        `/engagements/${engagementId}/component-work?limit=100`,
      ),
  });

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'component-work'] });
  };

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<GenerateInstancesResult>(`/engagements/${engagementId}/component-work/generate`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (r) => {
      const made = r.generated.length;
      const gone = r.removed.length;
      const parts: string[] = [];
      if (made > 0) parts.push(`generated ${made}`);
      if (gone > 0) parts.push(`removed ${gone} out-of-scope`);
      toast(
        parts.length > 0
          ? `Work synced — ${parts.join(', ')}.`
          : 'Nothing to change — work matches the current scope.',
      );
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not generate.', 'error'),
  });

  const complete = useMutation({
    mutationFn: (instanceId: string) =>
      apiFetch(`/engagements/${engagementId}/component-work/${instanceId}/status`, {
        method: 'POST',
        body: { status: 'completed' },
      }),
    onSuccess: () => {
      toast('Work item completed.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update.', 'error'),
  });

  // Hide cancelled and superseded work from the operational view — narrowing a
  // window cancels out-of-scope instances, and a frequency change supersedes the
  // old ones; both should simply disappear here (they remain in the DB for audit).
  const items = (work.data?.items ?? []).filter(
    (w) => w.status !== 'cancelled' && w.status !== 'superseded',
  );

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Component work</h2>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            <CalendarPlus className="h-4 w-4" /> {generate.isPending ? 'Generating…' : 'Generate work'}
          </Button>
        )}
      </div>
      {items.length > 0 && (
        <ComponentProgressGrid items={items} onOpenDocs={(w) => setDocsFor(w)} />
      )}

      <Card className="overflow-hidden p-0">
        {work.isSuccess && items.length === 0 && (
          <div className="p-5">
            <EmptyState>
              No work generated yet.{' '}
              {canManage && 'Configure components above, then “Generate work”.'}
            </EmptyState>
          </div>
        )}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Component</th>
                <th className="px-4 py-2.5 font-semibold">Period</th>
                <th className="px-4 py-2.5 font-semibold">Statutory</th>
                <th className="px-4 py-2.5 font-semibold">Internal SLA</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {items.map((w) => {
                const open = w.status === 'scheduled' || w.status === 'active';
                return (
                  <tr key={w.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => setDocsFor(w)}
                        className="text-left font-medium text-primary-700 hover:underline"
                        title="Open documents for this period"
                      >
                        {w.componentName}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {w.periodLabel}
                      {w.isFuture && (
                        <Badge tone="neutral" className="ml-2">
                          Scheduled
                        </Badge>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2.5 ${w.isOverdue ? 'font-medium text-danger-600' : 'text-ink-muted'}`}
                    >
                      {w.statutoryDeadline ? formatDate(w.statutoryDeadline) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {w.internalSlaDate ? formatDate(w.internalSlaDate) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={STATUS_TONE[w.status] ?? 'neutral'}>{humanize(w.status)}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDocsFor(w)}
                          title="Open documents for this period"
                        >
                          <FolderOpen className="h-4 w-4" /> Documents
                        </Button>
                        {canManage && open && w.setsRegistrationType && (
                          <Button
                            size="sm"
                            variant="subtle"
                            onClick={() => setRegisterFor(w)}
                            title="Record the registration number into the client master (§40)"
                          >
                            <Stamp className="h-4 w-4" /> Record reg.
                          </Button>
                        )}
                        {canManage && open && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={complete.isPending}
                            onClick={() => complete.mutate(w.id)}
                          >
                            Complete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {docsFor && (
        <ScopedDocumentsModal
          engagementId={engagementId}
          scope={{ componentInstanceId: docsFor.id }}
          title={docsFor.componentName}
          subtitle={docsFor.periodLabel}
          onClose={() => setDocsFor(null)}
        />
      )}

      {registerFor && (
        <RecordRegistrationModal
          engagementId={engagementId}
          instance={registerFor}
          onClose={() => setRegisterFor(null)}
          onDone={() => {
            setRegisterFor(null);
            invalidate();
            void qc.invalidateQueries({ queryKey: ['entities'] });
          }}
        />
      )}
    </section>
  );
}

/** Short period chip label: "Apr 2026" → "Apr", "Q1 2026-27" → "Q1", else as-is. */
function shortPeriod(label: string): string {
  const first = label.split(' ')[0] ?? label;
  return first;
}

/** Tailwind classes for a period cell, by the instance's status. */
function cellClass(w: ComponentInstanceRecord): string {
  if (w.status === 'completed') return 'bg-success-600 text-white border-success-600';
  if (w.status === 'waived') return 'bg-warning-50 text-warning-700 border-warning-500/40';
  if (w.isOverdue) return 'bg-danger-600 text-white border-danger-600';
  if (w.isFuture) return 'bg-surface-sunken text-ink-faint border-line';
  return 'bg-primary-50 text-primary-700 border-primary-500/40'; // active/current
}

/**
 * A calendar-style progress grid for recurring components (spec §21). One row
 * per component (e.g. GST), one clickable chip per period (month/quarter),
 * coloured by status so "which months are done and what's left" is legible at a
 * glance. Clicking a chip opens that period's documents.
 */
function ComponentProgressGrid({
  items,
  onOpenDocs,
}: {
  items: ComponentInstanceRecord[];
  onOpenDocs: (w: ComponentInstanceRecord) => void;
}): JSX.Element {
  // Group by component, each sorted chronologically by period start.
  const groups = new Map<string, ComponentInstanceRecord[]>();
  for (const w of items) {
    const arr = groups.get(w.componentName) ?? [];
    arr.push(w);
    groups.set(w.componentName, arr);
  }
  const rows = [...groups.entries()]
    .map(([name, list]) => ({
      name,
      list: [...list].sort((a, b) => a.periodStart.localeCompare(b.periodStart)),
    }))
    // Only worth a grid when there's more than one period (recurring work).
    .filter((g) => g.list.length > 1);

  if (rows.length === 0) return <></>;

  return (
    <Card className="mb-3 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Progress</h3>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
          <Legend className="bg-success-600" label="Done" />
          <Legend className="bg-primary-50 border border-primary-500/40" label="In progress" />
          <Legend className="bg-danger-600" label="Overdue" />
          <Legend className="bg-surface-sunken border border-line" label="Upcoming" />
        </div>
      </div>
      <div className="space-y-3">
        {rows.map((g) => {
          const done = g.list.filter((w) => w.status === 'completed').length;
          const total = g.list.filter((w) => w.status !== 'cancelled').length;
          return (
            <div key={g.name} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="w-40 shrink-0">
                <div className="truncate text-sm font-medium text-ink" title={g.name}>
                  {g.name}
                </div>
                <CompletionBar done={done} total={total} className="mt-1" />
              </div>
              <div className="flex flex-wrap gap-1">
                {g.list.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => onOpenDocs(w)}
                    className={`relative min-w-[3rem] rounded-md border px-2 py-1 text-center text-[11px] font-medium transition hover:opacity-90 ${cellClass(w)}`}
                    title={`${w.periodLabel} — ${humanize(w.status)}${
                      w.requiredDocsMissing > 0
                        ? ` · ${w.requiredDocsMissing} required doc(s) missing`
                        : ''
                    }. Click for documents.`}
                  >
                    {shortPeriod(w.periodLabel)}
                    {w.requiredDocsMissing > 0 && (
                      <span
                        className="absolute -right-1 -top-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-danger-600 ring-2 ring-surface"
                        aria-label={`${w.requiredDocsMissing} required documents missing`}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-3 w-3 rounded ${className}`} />
      {label}
    </span>
  );
}

function RecordRegistrationModal({
  engagementId,
  instance,
  onClose,
  onDone,
}: {
  engagementId: string;
  instance: ComponentInstanceRecord;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [validFrom, setValidFrom] = useState('');

  const record = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/component-work/${instance.id}/record-registration`, {
        method: 'POST',
        body: {
          registrationNumber: number.trim(),
          stateCode: stateCode.trim() || null,
          validFrom: validFrom || null,
          completeInstance: true,
        },
      }),
    onSuccess: () => {
      toast('Registration recorded to the client master.');
      onDone();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not record.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Record registration"
      description={`Writes the ${(instance.setsRegistrationType ?? '').toUpperCase()} number the authority issued into the client's Registration Master (§40), then completes this work item.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => record.mutate()} disabled={!number.trim() || record.isPending}>
            Record &amp; complete
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Registration number" required>
          <Input value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="e.g. 27ABCDE1234F1Z5" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State code">
            <Input value={stateCode} onChange={(e) => setStateCode(e.target.value)} placeholder="e.g. 27" />
          </Field>
          <Field label="Valid from">
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
