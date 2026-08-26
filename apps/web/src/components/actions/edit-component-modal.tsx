'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COMPONENT_APPLICABILITY_STATUSES,
  COMPONENT_CONFIG_STATUSES,
  RECURRENCES,
  type EngagementComponentRecord,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { EmployeeRow } from '@/lib/types';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select, Textarea } from '@/components/form';

/** Edit a configured component's professional setup (spec §13/§24; optimistic-locked). */
export function EditComponentModal({
  engagementId,
  component,
  onClose,
}: {
  engagementId: string;
  component: EngagementComponentRecord;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();

  const [applicabilityStatus, setApplicability] = useState(component.applicabilityStatus);
  const [frequency, setFrequency] = useState(component.frequency);
  const [ownerEmployeeId, setOwner] = useState(component.ownerEmployeeId ?? '');
  const [reviewerEmployeeId, setReviewer] = useState(component.reviewerEmployeeId ?? '');
  const [epReviewRequired, setEpReview] = useState(component.epReviewRequired);
  const [status, setStatus] = useState(component.status);
  const [startDate, setStartDate] = useState(component.startDate ?? '');
  const [endDate, setEndDate] = useState(component.endDate ?? '');
  const [notes, setNotes] = useState(component.notes ?? '');

  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100'),
  });

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/components/${component.id}`, {
        method: 'PATCH',
        body: {
          applicabilityStatus,
          frequency,
          ownerEmployeeId: ownerEmployeeId || null,
          reviewerEmployeeId: reviewerEmployeeId || null,
          epReviewRequired,
          status,
          startDate: startDate === '' ? null : startDate,
          endDate: endDate === '' ? null : endDate,
          notes: notes.trim() === '' ? null : notes,
          version: component.version,
        },
      }),
    onSuccess: () => {
      toast('Configuration updated.');
      // Broaden to the whole engagement: a status/applicability change can cancel
      // pending component work (a sibling query key), not just the config list.
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not update configuration.', 'error'),
  });

  const options = employees.data?.items ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Configure ${component.componentName}`}
      description="The professional applicability decision, frequency, ownership and review setup."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Applicability">
          <Select
            value={applicabilityStatus}
            onChange={(e) => setApplicability(e.target.value as typeof applicabilityStatus)}
          >
            {COMPONENT_APPLICABILITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Frequency">
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
            {RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={ownerEmployeeId} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Unassigned</option>
            {options.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reviewer">
          <Select value={reviewerEmployeeId} onChange={(e) => setReviewer(e.target.value)}>
            <option value="">Unassigned</option>
            {options.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="EP review required">
          <Select
            value={epReviewRequired ? 'yes' : 'no'}
            onChange={(e) => setEpReview(e.target.value === 'yes')}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {COMPONENT_CONFIG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Active from">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Active to">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        The active window bounds work generation: only periods overlapping Active&nbsp;from →
        Active&nbsp;to are generated. Leave a date blank for open-ended.
      </p>
      <div className="mt-3">
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
