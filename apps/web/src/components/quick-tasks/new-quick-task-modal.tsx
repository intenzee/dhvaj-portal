'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import type { QuickTaskDetail, QuickTaskPerson } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Textarea } from '@/components/form';
import { EntityPicker, type Picked } from '@/components/entity-picker';
import { PersonPicker } from './person-picker';
import { QUICK_TASK_KEYS } from './quick-task-api';

const NEEDED_BY: { label: string; minutes: number | null }[] = [
  { label: 'No time', minutes: null },
  { label: '1 hr', minutes: 60 },
  { label: '2 hr', minutes: 120 },
  { label: '4 hr', minutes: 240 },
  { label: 'Today', minutes: -1 },
];

function neededBy(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes >= 0) return new Date(Date.now() + minutes * 60_000).toISOString();
  // End of the working day, 7 pm IST.
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  const evening =
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 19) - 330 * 60_000;
  return new Date(Math.max(evening, now.getTime() + 30 * 60_000)).toISOString();
}

/**
 * New → New task: the client, what to do, who does it. Sent at once — it pops
 * up on their screen and in their bell, and they answer from there.
 */
export function NewQuickTaskModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { principal } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const [client, setClient] = useState<Picked | null>(null);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [person, setPerson] = useState<QuickTaskPerson | null>(null);
  const [urgent, setUrgent] = useState(true);
  const [needed, setNeeded] = useState<number | null>(null);

  const send = useMutation({
    mutationFn: () =>
      apiFetch<QuickTaskDetail>('/quick-tasks', {
        method: 'POST',
        body: {
          entityId: client?.id ?? null,
          title: title.trim(),
          details: details.trim() || null,
          assignedToEmployeeId: person!.id,
          urgent,
          dueAt: neededBy(needed),
        },
      }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: QUICK_TASK_KEYS.all });
      toast(`Sent to ${t.assignedTo.name}.`);
      onClose();
      router.push(`/quick-tasks?t=${t.id}`);
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not send the task.', 'error'),
  });

  const ready = title.trim().length > 0 && !!person && !send.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title="New task"
      description="Goes straight to them — they answer Received, Doing (with a time) or Done."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => send.mutate()}>
            <Send className="h-4 w-4" /> {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Client">
          <EntityPicker
            value={client}
            onChange={setClient}
            exclude={new Set()}
            placeholder="Type the client’s name or PAN…"
          />
        </Field>
        <Field label="What needs doing" required>
          <Textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Send the GSTR-3B challan to the client"
            rows={2}
            maxLength={500}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) send.mutate();
            }}
          />
        </Field>
        <Field label="More detail">
          <Textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="Optional"
          />
        </Field>
        <Field label="Assign to" required>
          <PersonPicker value={person} onChange={setPerson} excludeId={principal?.employeeId} />
        </Field>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={urgent}
              onChange={(e) => setUrgent(e.target.checked)}
              className="h-4 w-4 rounded border-line-strong"
            />
            Urgent
          </label>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-ink-muted">Needed in</span>
            {NEEDED_BY.map((n) => (
              <button
                type="button"
                key={n.label}
                onClick={() => setNeeded(n.minutes)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  needed === n.minutes
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-line-strong text-ink-muted hover:bg-surface-sunken'
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
