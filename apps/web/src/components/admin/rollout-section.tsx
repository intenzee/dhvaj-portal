'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ROLLOUT_MODES,
  ROLLOUT_MODE_LABEL,
  type FeatureRollout,
  type FeatureRolloutList,
  type RolloutMode,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { featureFlagsQuery } from '@/lib/feature-flags';
import type { OfficeRow } from '@/lib/types';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

const QUERY_KEY = ['admin', 'feature-rollouts'] as const;

/** Where a flag is on, in words. */
function liveText(r: FeatureRollout): string {
  if (!r.deployed) return 'Not in this deploy';
  if (r.liveIn === 'all') return 'Every office';
  if (r.liveIn.length === 0) return 'Nowhere';
  return r.liveIn.join(', ');
}

/**
 * Admin → Rollout: each phase of the Staff Workflow plan, office by office. The
 * deploy's FEATURE_FLAGS is the master switch; within it the firm pilots a phase
 * in one office, opens it to every office, or pauses it — without a deploy.
 */
export function RolloutSection(): JSX.Element {
  const list = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<FeatureRolloutList>('/feature-rollouts'),
  });
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });
  if (list.isLoading || offices.isLoading) return <Spinner label="Loading the rollout…" />;
  const active = (offices.data ?? []).filter((o) => o.isActive);
  return (
    <section aria-labelledby="rollout-heading" className="space-y-4">
      <div>
        <h2 id="rollout-heading" className="text-base font-semibold text-ink">
          Rollout
        </h2>
        <p className="text-sm text-ink-muted">
          Pilot a phase in one office, open it to every office, or pause it. A phase the deploy
          leaves off stays off. Every change is audited and reaches everyone within 30 seconds.
        </p>
      </div>
      <ul className="divide-y divide-line">
        {(list.data?.items ?? []).map((r) => (
          <RolloutRow key={r.flag} rollout={r} offices={active} />
        ))}
      </ul>
    </section>
  );
}

function RolloutRow({
  rollout: r,
  offices,
}: {
  rollout: FeatureRollout;
  offices: OfficeRow[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<RolloutMode>(r.mode ?? 'firm');
  const [codes, setCodes] = useState<string[]>(r.officeCodes);
  const [note, setNote] = useState(r.note ?? '');

  const done = (next: FeatureRollout, message: string) => {
    qc.setQueryData<FeatureRolloutList>(QUERY_KEY, (old) =>
      old ? { items: old.items.map((i) => (i.flag === next.flag ? next : i)) } : old,
    );
    void qc.invalidateQueries({ queryKey: featureFlagsQuery.queryKey });
    setEditing(false);
    toast(message);
  };
  const failed = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409)
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    toast(err instanceof ApiError ? err.message : 'Could not change the rollout.', 'error');
  };
  const save = useMutation({
    mutationFn: () =>
      apiFetch<FeatureRollout>(`/feature-rollouts/${r.flag}`, {
        method: 'PUT',
        body: {
          mode,
          officeCodes: mode === 'offices' ? codes : [],
          note: note.trim() || null,
          version: r.version,
        },
      }),
    onSuccess: (next) => done(next, `${next.label}: ${liveText(next)}.`),
    onError: failed,
  });
  const reset = useMutation({
    mutationFn: () => apiFetch<FeatureRollout>(`/feature-rollouts/${r.flag}`, { method: 'DELETE' }),
    onSuccess: (next) => done(next, `${next.label} follows the deploy again.`),
    onError: failed,
  });

  const open = () => {
    setMode(r.mode ?? 'firm');
    setCodes(r.officeCodes);
    setNote(r.note ?? '');
    setEditing(true);
  };
  const toggle = (code: string) =>
    setCodes((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));
  const pending = save.isPending || reset.isPending;

  return (
    <li className="py-3" aria-label={r.label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink">{r.label}</p>
          <p className="text-xs text-ink-faint">
            {r.flag}
            {r.mode
              ? ` · set by ${r.updatedByName ?? 'someone'}${r.note ? ` — ${r.note}` : ''}`
              : ' · follows the deploy'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            tone={
              !r.deployed || (r.liveIn !== 'all' && r.liveIn.length === 0)
                ? 'neutral'
                : r.liveIn === 'all'
                  ? 'success'
                  : 'warn'
            }
          >
            {liveText(r)}
          </Badge>
          {r.deployed && !editing && (
            <Button size="sm" variant="secondary" onClick={open}>
              Change
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <form
          aria-label={`Rollout of ${r.label}`}
          className="mt-3 space-y-3 rounded-lg border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Where it is on">
            <Select value={mode} onChange={(e) => setMode(e.target.value as RolloutMode)}>
              {ROLLOUT_MODES.map((m) => (
                <option key={m} value={m}>
                  {ROLLOUT_MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          {mode === 'offices' && (
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-ink">Pilot offices</legend>
              <div className="flex flex-wrap gap-3">
                {offices.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={codes.includes(o.code.toUpperCase())}
                      onChange={() => toggle(o.code.toUpperCase())}
                    />
                    {o.name} ({o.code})
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field label="Note">
            <Input
              value={note}
              maxLength={500}
              placeholder="e.g. Pilot with the North GST team"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            {r.mode && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => reset.mutate()}
              >
                Follow the deploy
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || (mode === 'offices' && codes.length === 0)}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
