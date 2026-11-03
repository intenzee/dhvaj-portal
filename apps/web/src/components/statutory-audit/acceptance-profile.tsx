'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, ExternalLink, Pencil } from 'lucide-react';
import type { MasterFact } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { EngagementDetail, OfficeRow } from '@/lib/types';
import { Button } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { MasterFactList } from './master-fact-list';

/**
 * 01.1 Engagement Profile (spec §4). The facts are read-only, prefilled from
 * the entity and engagement masters. When EP-01 says the information needs
 * correcting, the corrections are made HERE on the source masters — the
 * engagement's manager, office and target completion directly, the entity's
 * details on the client master — never in a copy kept in the audit file.
 */
export function ProfileFacts({
  facts,
  entityId,
  correcting,
  engagementId,
  editable,
}: {
  facts: MasterFact[];
  entityId?: string;
  /** EP-01 = "Information requires correction". */
  correcting: boolean;
  engagementId: string;
  editable: boolean;
}): JSX.Element {
  const missing = facts.filter((f) => !f.value).length;
  return (
    <div id="audit-anchor-engagement-profile" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Database className="h-4 w-4 text-ink-faint" aria-hidden />
          Prefilled from the client &amp; engagement masters
        </h4>
        {entityId && (
          <Link
            href={`/entities/${entityId}`}
            className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"
          >
            Update entity information <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      <MasterFactList facts={facts} />
      {missing > 0 && (
        <p className="text-xs text-ink-muted">
          {missing} item(s) are not on the master yet. Use “Add on client master” beside each one
          — the audit file never keeps a separate copy.
        </p>
      )}
      {correcting && editable && <EngagementCorrection engagementId={engagementId} />}
    </div>
  );
}

/** Update the engagement master's own fields (office, target completion). */
function EngagementCorrection({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const eng = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => apiFetch<EngagementDetail>(`/engagements/${engagementId}`),
    enabled: open,
  });
  const offices = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
    enabled: open,
  });
  const [form, setForm] = useState<{ office?: string; end?: string }>({});
  const e = eng.data;
  const value = {
    office: form.office ?? e?.officeCode ?? '',
    end: form.end ?? e?.plannedEndDate ?? '',
  };
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}`, {
        method: 'PATCH',
        body: {
          officeCode: value.office || undefined,
          plannedEndDate: value.end || null,
          version: e!.version,
        },
      }),
    onSuccess: () => {
      toast('Engagement updated — the profile now shows the corrected facts.');
      setForm({});
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update the engagement.'),
  });

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> Update engagement information
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <p className="text-xs text-ink-muted">
        These change the engagement itself. The Managing Partner or an administrator changes the
        Engagement Partner and manager on the Team tab.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Office">
          <Select value={value.office} onChange={(ev) => setForm({ ...form, office: ev.target.value })}>
            {(offices.data ?? [])
              .filter((o) => o.isActive)
              .map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Target audit completion">
          <Input
            type="date"
            value={value.end}
            onChange={(ev) => setForm({ ...form, end: ev.target.value })}
          />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!e || save.isPending} onClick={() => save.mutate()}>
          Save to engagement
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
