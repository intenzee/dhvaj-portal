'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated, ServiceLineLeadResult, SetServiceLineLeadInput } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import type { EmployeeRow } from '@/lib/types';
import { Select } from '@/components/form';
import { Button } from '@/components/ui';
import { ExpandToggle } from '@/components/inline-panel';

/** The path that changes a stream line's lead. Pure — tested. */
export function serviceLineLeadPath(engagementId: string, lineId: string): string {
  return `/engagements/${engagementId}/service-lines/${lineId}/lead`;
}

/**
 * "Change" under a stream's lead: pick a person, save. Shown only to an
 * administrator or the Managing Partner (the caller decides); opens in place.
 */
export function StreamLeadEditor({
  engagementId,
  lineId,
  streamLabel,
  currentLeadId,
}: {
  engagementId: string;
  lineId: string;
  streamLabel: string;
  currentLeadId: string | null;
}): JSX.Element {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(currentLeadId ?? '');
  const [error, setError] = useState<string | null>(null);
  const people = useQuery({
    queryKey: ['employees', 'active', 100],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100&status=active'),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: () =>
      apiFetch<ServiceLineLeadResult>(serviceLineLeadPath(engagementId, lineId), {
        method: 'PUT',
        body: { employeeId: pick || null } satisfies SetServiceLineLeadInput,
      }),
    onSuccess: () => {
      setOpen(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'The lead did not change.'),
  });

  return (
    <div className="w-full">
      <button
        type="button"
        className="group inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-primary-600"
        aria-expanded={open}
        aria-label={`Change the ${streamLabel} lead`}
        onClick={() => {
          setPick(currentLeadId ?? '');
          setError(null);
          setOpen((o) => !o);
        }}
      >
        <ExpandToggle open={open} className="h-4 w-4" /> Change
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            aria-label={`${streamLabel} lead`}
            className="min-w-0 flex-1"
          >
            <option value="">No lead</option>
            {(people.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {p.gradeName} · {p.officeCode}
              </option>
            ))}
          </Select>
          <Button
            disabled={save.isPending || pick === (currentLeadId ?? '')}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          {error && (
            <p role="alert" className="w-full text-xs text-danger-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
