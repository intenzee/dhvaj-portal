'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { TASK_PRIORITIES } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';

export function CreateTaskModal({
  engagementId,
  team,
}: {
  engagementId: string;
  team: TeamMember[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('normal');
  const [dueDate, setDueDate] = useState('');
  const [assignee, setAssignee] = useState('');
  const [outOfScope, setOutOfScope] = useState(false);
  const [billable, setBillable] = useState(false);

  const reset = (): void => {
    setTitle('');
    setPriority('normal');
    setDueDate('');
    setAssignee('');
    setOutOfScope(false);
    setBillable(false);
  };

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/tasks`, {
        method: 'POST',
        body: {
          title: title.trim(),
          priority,
          ...(dueDate ? { dueDate } : {}),
          ...(assignee ? { assignedToEmployeeId: assignee } : {}),
          ...(outOfScope ? { isOutOfScope: true } : {}),
          ...(billable ? { isBillable: true } : {}),
        },
      }),
    onSuccess: () => {
      toast('Task created.');
      qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
      qc.invalidateQueries({ queryKey: ['work'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setOpen(false);
      reset();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not create the task.', 'error'),
  });

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add task
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add task"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={title.trim().length === 0 || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create task'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {humanize(p)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Assignee" hint="Must be on the engagement team (EP, manager, or member).">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {team.map((m) => (
                <option key={m.employeeId} value={m.employeeId}>
                  {m.employeeName}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-1.5 rounded-lg border border-line bg-surface-sunken/40 p-3">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={outOfScope}
                onChange={(e) => setOutOfScope(e.target.checked)}
              />
              Out-of-scope of the mandate (needs lead approval before billing)
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
              />
              Billable to the client
            </label>
          </div>
        </div>
      </Modal>
    </>
  );
}
