'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Textarea } from '@/components/form';

export function RequestDependencyModal({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [requestedInfo, setRequestedInfo] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const [escalationDate, setEscalationDate] = useState('');

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/client-dependencies`, {
        method: 'POST',
        body: {
          requestedInfo: requestedInfo.trim(),
          ...(reminderDate ? { reminderDate } : {}),
          ...(escalationDate ? { escalationDate } : {}),
        },
      }),
    onSuccess: () => {
      toast('Client information requested.');
      qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
      qc.invalidateQueries({ queryKey: ['work'] });
      qc.invalidateQueries({ queryKey: ['client-dependencies'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setOpen(false);
      setRequestedInfo('');
      setReminderDate('');
      setEscalationDate('');
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not request info.', 'error'),
  });

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Request info
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Request client information"
        description="This puts the engagement in a waiting-for-client state until received."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={requestedInfo.trim().length === 0 || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Requesting…' : 'Request'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="What are you requesting?" required>
            <Textarea
              value={requestedInfo}
              onChange={(e) => setRequestedInfo(e.target.value)}
              placeholder="e.g. Bank statements for FY 2026-27"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reminder date">
              <Input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
            </Field>
            <Field label="Escalation date">
              <Input type="date" value={escalationDate} onChange={(e) => setEscalationDate(e.target.value)} />
            </Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
