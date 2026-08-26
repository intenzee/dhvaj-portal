'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RECURRENCES,
  type EngagementComponentRecord,
  type GenerateInstancesResult,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Select } from '@/components/form';

/**
 * Change a component's frequency (spec §23/§24). Once work exists this supersedes
 * the current configuration and versions a new one; the new frequency's work is
 * then generated. If no work exists yet, it updates in place. One click.
 */
export function ChangeFrequencyModal({
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
  const [frequency, setFrequency] = useState(component.frequency);

  const apply = useMutation({
    mutationFn: async () => {
      // 1. Change frequency — supersedes + versions when work exists, else in place.
      const next = await apiFetch<EngagementComponentRecord>(
        `/engagements/${engagementId}/components/${component.id}/change-frequency`,
        { method: 'POST', body: { frequency } },
      );
      // 2. Generate the new frequency's work against the (possibly new) config.
      const gen = await apiFetch<GenerateInstancesResult>(
        `/engagements/${engagementId}/components/${next.id}/instances/generate`,
        { method: 'POST', body: {} },
      );
      return { next, gen };
    },
    onSuccess: ({ next, gen }) => {
      const superseded = next.id !== component.id;
      toast(
        `Frequency set to ${humanize(frequency)} — ${
          superseded ? 'previous work superseded, ' : ''
        }${gen.generated.length} item${gen.generated.length === 1 ? '' : 's'} generated.`,
      );
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not change frequency.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Frequency — ${component.componentName}`}
      description="Once work exists, changing the frequency supersedes the current setup and versions a new one; the old periods become history."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={apply.isPending || frequency === component.frequency}
            onClick={() => apply.mutate()}
          >
            {apply.isPending ? 'Applying…' : 'Change & generate'}
          </Button>
        </>
      }
    >
      <Field label="New frequency">
        <Select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
          {RECURRENCES.map((r) => (
            <option key={r} value={r}>
              {humanize(r)}
            </option>
          ))}
        </Select>
      </Field>
      {frequency === component.frequency && (
        <p className="mt-2 text-xs text-ink-faint">
          Currently {humanize(component.frequency)} — pick a different frequency to change it.
        </p>
      )}
    </Modal>
  );
}
