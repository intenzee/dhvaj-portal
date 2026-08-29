'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { EventRuleOption } from '@/lib/types';
import { Button, Spinner } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';

/**
 * Record an event date and generate an event-triggered obligation (§7/§8/§11):
 * appeal/amendment limitations, allotments, incorporation, FDI reporting. These
 * are classified but have no computable date until the event (order served,
 * shares allotted, …) happens — so bulk generate-for-service can only skip them.
 * This offers the engagement's event rules and generates the chosen one from the
 * recorded date. Access is enforced by the API (engagement lead).
 */
function RecordEventModal({
  engagementId,
  onClose,
}: {
  engagementId: string;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [ruleCode, setRuleCode] = useState('');
  const [eventDate, setEventDate] = useState('');

  const rules = useQuery({
    queryKey: ['engagement', engagementId, 'event-rules'],
    queryFn: () =>
      apiFetch<EventRuleOption[]>(`/engagements/${engagementId}/compliance/event-rules`),
  });

  const options = useMemo(() => rules.data ?? [], [rules.data]);
  const selected = options.find((r) => r.code === ruleCode) ?? null;

  const generate = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/compliance`, {
        method: 'POST',
        body: { complianceRuleCode: ruleCode, eventDate },
      }),
    onSuccess: () => {
      toast('Obligation generated from the recorded event.');
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'compliance'] });
      void qc.invalidateQueries({ queryKey: ['compliance'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not generate the obligation.', 'error'),
  });

  const ready = !!ruleCode && !!eventDate && !generate.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title="Record event & generate obligation"
      description="The deadline is a limitation period measured from the event date you record."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => generate.mutate()}>
            {generate.isPending ? 'Generating…' : 'Generate obligation'}
          </Button>
        </>
      }
    >
      {rules.isLoading && (
        <div className="p-4">
          <Spinner />
        </div>
      )}
      {rules.data && options.length === 0 && (
        <p className="text-sm text-ink-muted">
          This engagement’s service has no event-triggered rules. Recurring obligations are
          generated with the <span className="font-medium">Generate</span> action instead.
        </p>
      )}
      {options.length > 0 && (
        <div className="space-y-3">
          <Field label="Event-triggered obligation" required>
            <Select value={ruleCode} onChange={(e) => setRuleCode(e.target.value)}>
              <option value="">Select an obligation…</option>
              {options.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Event date"
            required
            hint={
              selected
                ? `Statutory deadline ≈ event date + ${selected.offsetDays} days (nudged to a working day).`
                : 'The date the triggering event occurred (order served, shares allotted, …).'
            }
          >
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/** Toolbar button that opens the record-event flow for an engagement. */
export function RecordEventButton({ engagementId }: { engagementId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <CalendarClock className="h-4 w-4" /> Record event
      </Button>
      {open && <RecordEventModal engagementId={engagementId} onClose={() => setOpen(false)} />}
    </>
  );
}
