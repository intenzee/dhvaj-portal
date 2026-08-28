'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Stamp } from 'lucide-react';
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
                {canManage && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {items.map((w) => {
                const open = w.status === 'scheduled' || w.status === 'active';
                return (
                  <tr key={w.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-ink">{w.componentName}</td>
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
                    {canManage && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          {open && w.setsRegistrationType && (
                            <Button
                              size="sm"
                              variant="subtle"
                              onClick={() => setRegisterFor(w)}
                              title="Record the registration number into the client master (§40)"
                            >
                              <Stamp className="h-4 w-4" /> Record reg.
                            </Button>
                          )}
                          {open && (
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
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

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
