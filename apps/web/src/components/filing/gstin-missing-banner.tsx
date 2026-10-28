'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { PERMISSION } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { AddGstinDialog } from './add-gstin-dialog';

const COPY = {
  gst: { kind: 'gstin', label: 'GSTIN', periods: 'months', stream: 'GST' },
  tds: { kind: 'tan', label: 'TAN', periods: 'quarters', stream: 'TDS' },
} as const;

/**
 * "GSTIN missing" across the top of a GST tab (or "TAN missing" on a TDS tab)
 * whose periods were built before the client's registration was on file. Its
 * button opens the number in a pop-up; on save the periods move onto it and
 * the banner goes. The engagement's partner or manager (or anyone who manages
 * clients) can add it.
 */
export function GstinMissingBanner({
  engagementId,
  isLead,
  clientName,
  stream = 'gst',
}: {
  engagementId: string;
  isLead: boolean;
  clientName?: string | null;
  stream?: 'gst' | 'tds';
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const [open, setOpen] = useState(false);
  const canAdd = isLead || can(principal, PERMISSION.entityManage);
  const c = COPY[stream];

  const save = async (number: string): Promise<void> => {
    await apiFetch(`/engagements/${engagementId}/streams/${stream}/registration`, {
      method: 'POST',
      body: { registrationNumber: number },
    });
    toast(`${c.label} ${number} added — the ${c.stream} ${c.periods} are now on it.`);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['filing', 'tree', engagementId] }),
      qc.invalidateQueries({ queryKey: ['entity'] }),
      qc.invalidateQueries({ queryKey: ['engagement', engagementId] }),
    ]);
  };

  return (
    <div
      role="alert"
      data-banner={`${c.kind}-missing`}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-warning-500/40 bg-warning-50 px-4 py-3 text-sm text-warning-700"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <strong>{c.label} missing.</strong> The client’s {c.label} is not on file — the {c.periods}{' '}
        below are worked without it. Please fill it in before lodging a return.
      </span>
      {canAdd ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          Add {c.label}
        </Button>
      ) : (
        <span className="text-xs">Ask the engagement’s partner or manager to add it.</span>
      )}
      {open && (
        <AddGstinDialog
          clientName={clientName}
          kind={c.kind}
          onClose={() => setOpen(false)}
          onSave={save}
        />
      )}
    </div>
  );
}
