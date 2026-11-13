'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Send } from 'lucide-react';
import { allottedLabel, type QuickTaskDetail, type QuickTaskPerson } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Textarea } from '@/components/form';
import { PersonPicker } from './person-picker';
import { QUICK_TASK_KEYS } from './quick-task-api';
import { REMIND_PRESETS, mayRemind, remindMinutes, type RemindUnit } from './remind-model';

/**
 * Remind someone (the Today screen): whom, how much time they have, and a
 * short note. It pops up on their screen at once as an urgent task due when
 * the time runs out. For a Partner, the Managing Partner or an Admin.
 */
export function RemindModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { principal } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [person, setPerson] = useState<QuickTaskPerson | null>(null);
  const [amount, setAmount] = useState('30');
  const [unit, setUnit] = useState<RemindUnit>('min');
  const [note, setNote] = useState('');
  const minutes = remindMinutes(amount, unit);

  const send = useMutation({
    mutationFn: () =>
      apiFetch<QuickTaskDetail>('/quick-tasks/remind', {
        method: 'POST',
        body: { assignedToEmployeeId: person!.id, minutes: minutes!, note: note.trim() || null },
      }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: QUICK_TASK_KEYS.all });
      toast(`Reminder sent to ${t.assignedTo.name} — ${allottedLabel(minutes!)}.`);
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not send the reminder.', 'error'),
  });

  const ready = !!person && minutes !== null && !send.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title="Remind"
      description="It pops up on their screen at once, with the time they have for it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => send.mutate()}>
            <Send className="h-4 w-4" /> {send.isPending ? 'Sending…' : 'Send reminder'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Whom to remind" required>
          <PersonPicker value={person} onChange={setPerson} excludeId={principal?.employeeId} />
        </Field>
        <Field label="Time allotted" required>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              min={unit === 'h' ? 0.25 : 1}
              step={unit === 'h' ? 0.5 : 5}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-24"
              aria-label="Time allotted"
            />
            <div className="flex rounded-lg border border-line-strong p-0.5" role="radiogroup">
              {(['min', 'h'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={unit === u}
                  onClick={() => setUnit(u)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium',
                    unit === u ? 'bg-primary-600 text-white' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {u === 'min' ? 'minutes' : 'hours'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REMIND_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setAmount(String(p.amount));
                  setUnit(p.unit);
                }}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs',
                  amount === String(p.amount) && unit === p.unit
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-line-strong text-ink-muted hover:bg-surface-sunken',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {minutes === null && (
            <p className="mt-1 text-xs text-danger-700">Between 1 minute and a week.</p>
          )}
        </Field>
        <Field label="Note">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder="e.g. Send the GSTR-1 summary to the client"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) send.mutate();
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}

/** The Today screen's Remind button — only for those who may send one. */
export function RemindButton(): JSX.Element | null {
  const { principal } = useAuth();
  const [open, setOpen] = useState(false);
  if (!mayRemind(principal)) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <AlarmClock className="h-4 w-4" /> Remind
      </Button>
      {open && <RemindModal onClose={() => setOpen(false)} />}
    </>
  );
}
