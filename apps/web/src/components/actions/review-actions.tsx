'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { EngagementDetail } from '@/lib/types';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Select, Textarea } from '@/components/form';

/** Record a review or perform the terminal sign-off (backend enforces who may). */
export function ReviewActions({ engagement }: { engagement: EngagementDetail }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reviewType, setReviewType] = useState('manager_review');
  const [outcome, setOutcome] = useState('cleared');
  const [notes, setNotes] = useState('');

  const invalidate = (): void => {
    qc.invalidateQueries({ queryKey: ['engagement', engagement.id] });
    qc.invalidateQueries({ queryKey: ['engagements'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const record = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagement.id}/reviews`, {
        method: 'POST',
        body: { reviewType, outcome, notes: notes.trim() || undefined, version: engagement.version },
      }),
    onSuccess: () => {
      toast('Review recorded.');
      invalidate();
      setOpen(false);
      setNotes('');
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Review was rejected.', 'error'),
  });

  const signOff = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagement.id}/sign-off`, {
        method: 'POST',
        body: { version: engagement.version },
      }),
    onSuccess: () => {
      toast('Engagement signed off.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Sign-off was rejected.', 'error'),
  });

  if (engagement.status !== 'active' || engagement.isSignedOff) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Record review
        </Button>
        <Button
          size="sm"
          disabled={engagement.openReviewPointCount > 0 || signOff.isPending}
          title={engagement.openReviewPointCount > 0 ? 'Resolve open review points first' : undefined}
          onClick={() => signOff.mutate()}
        >
          Sign off
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record review"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={record.isPending} onClick={() => record.mutate()}>
              {record.isPending ? 'Saving…' : 'Record'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Review type">
              <Select value={reviewType} onChange={(e) => setReviewType(e.target.value)}>
                <option value="manager_review">Manager review</option>
                <option value="ep_review">EP review</option>
              </Select>
            </Field>
            <Field label="Outcome">
              <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="cleared">Cleared</option>
                <option value="returned">Returned</option>
              </Select>
            </Field>
          </div>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
