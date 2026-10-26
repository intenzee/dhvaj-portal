'use client';

/**
 * The Clients page's "Offices to combine" view (CM-6): clients of one PAN that
 * should be one client with offices, and clients with several GSTINs and no
 * offices. Combine opens a dialog to settle the name, the office names and
 * the head office; it merges the others in, in one go.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSION, type BranchCandidate } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { EntityDetail } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input } from '@/components/form';

export const BRANCH_CANDIDATES_KEY = ['branch-candidates'] as const;

export function useBranchCandidates() {
  const { principal } = useAuth();
  return useQuery({
    queryKey: BRANCH_CANDIDATES_KEY,
    queryFn: () => apiFetch<BranchCandidate[]>('/entities/branch-candidates'),
    enabled: can(principal, PERMISSION.entityManage),
  });
}

const cardKey = (c: BranchCandidate): string => `${c.kind}:${c.keepId}`;

export function OfficesToCombineList(): JSX.Element {
  const q = useBranchCandidates();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState<BranchCandidate | null>(null);
  const dismiss = useMutation({
    mutationFn: async (c: BranchCandidate) => {
      for (const other of c.clients.filter((x) => x.id !== c.keepId))
        await apiFetch<void>('/entities/branch-candidates/dismiss', {
          method: 'POST',
          body: { aId: c.keepId, bId: other.id },
        });
    },
    onSuccess: () => {
      toast('Marked as separate businesses.');
      void qc.invalidateQueries({ queryKey: BRANCH_CANDIDATES_KEY });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not dismiss.', 'error'),
  });

  if (q.isLoading) return <Spinner label="Looking for offices to combine…" />;
  const cards = q.data ?? [];
  if (cards.length === 0)
    return <EmptyState>No clients look like offices of one business.</EmptyState>;

  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {cards.map((c) => (
          <li
            key={cardKey(c)}
            className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{c.proposedName}</span>
                <Badge tone="neutral">PAN {c.pan}</Badge>
                <Badge tone={c.kind === 'combine' ? 'warn' : 'info'}>
                  {c.kind === 'combine' ? `${c.clients.length} clients` : 'Set up offices'}
                </Badge>
              </div>
              <ul className="text-xs text-ink-muted">
                {c.clients.map((x) => (
                  <li key={x.id}>
                    <Link href={`/entities/${x.id}`} className="text-primary-700 hover:underline">
                      {x.legalName} ({x.entityCode})
                    </Link>
                    {x.id === c.keepId && c.kind === 'combine' && ' · kept'} ·{' '}
                    {x.counts.registrations} registrations · {x.counts.openEngagements} open
                    engagements · {x.counts.unpaidInvoices} unpaid invoices · {x.counts.logins}{' '}
                    logins
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink-faint">
                Offices: {c.offices.map((o) => `${o.label} (${o.gstin})`).join(' · ')}
              </p>
              {c.reasons.length > 0 && (
                <p className="text-xs text-ink-faint">{c.reasons.join(' ')}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => setOpen(c)}>
                {c.kind === 'combine' ? 'Combine' : 'Set up'}
              </Button>
              {c.kind === 'combine' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={dismiss.isPending}
                  onClick={() => dismiss.mutate(c)}
                >
                  Separate businesses
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {open && <CombineOfficesModal candidate={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

export function CombineOfficesModal({
  candidate,
  onClose,
}: {
  candidate: BranchCandidate;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(candidate.proposedName);
  const [offices, setOffices] = useState(candidate.offices.map((o) => ({ ...o })));
  const others = candidate.clients.filter((c) => c.id !== candidate.keepId);
  const keeper = candidate.clients.find((c) => c.id === candidate.keepId);
  const labels = offices.map((o) => o.label.trim().toLowerCase());
  const clash = labels.some((l, i) => !l || labels.indexOf(l) !== i);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<EntityDetail>(`/entities/${candidate.keepId}/combine-branches`, {
        method: 'POST',
        body: {
          others: others.map((o) => ({ entityId: o.id })),
          offices: offices.map((o) => ({
            registrationId: o.registrationId,
            label: o.label.trim(),
            isHeadOffice: o.isHeadOffice,
          })),
          legalName: name.trim(),
        },
      }),
    onSuccess: (d) => {
      toast(`${d.legalName} now has ${offices.length} offices.`);
      void qc.invalidateQueries({ queryKey: BRANCH_CANDIDATES_KEY });
      void qc.invalidateQueries({ queryKey: ['entities'] });
      void qc.invalidateQueries({ queryKey: ['entity'] });
      onClose();
      router.push(`/entities/${d.id}`);
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not combine.', 'error'),
  });

  const moving = others.reduce(
    (a, o) => ({
      engagements: a.engagements + o.counts.openEngagements,
      invoices: a.invoices + o.counts.unpaidInvoices,
      logins: a.logins + o.counts.logins,
    }),
    { engagements: 0, invoices: 0, logins: 0 },
  );

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={candidate.kind === 'combine' ? 'Combine into one client' : 'Set up offices'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || clash || !name.trim()} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : candidate.kind === 'combine' ? 'Combine' : 'Save offices'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {candidate.kind === 'combine' && (
          <p className="text-ink-muted">
            {keeper?.legalName} ({keeper?.entityCode}) is kept.{' '}
            {others.map((o) => `${o.legalName} (${o.entityCode})`).join(', ')}{' '}
            {others.length === 1 ? 'is' : 'are'} merged into it and archived: {moving.engagements}{' '}
            open engagements, {moving.invoices} unpaid invoices and {moving.logins} logins move with{' '}
            {others.length === 1 ? 'it' : 'them'}.
          </p>
        )}
        <Field
          label="Client name"
          hint="The name without the place; a company keeps “Private Limited”."
        >
          <Input value={name} maxLength={300} onChange={(ev) => setName(ev.target.value)} />
        </Field>
        <div className="space-y-2">
          <p className="font-medium text-ink">Offices</p>
          {offices.map((o, i) => (
            <div key={o.registrationId} className="flex flex-wrap items-center gap-2">
              <span className="w-44 shrink-0 font-mono text-xs text-ink-muted">{o.gstin}</span>
              <Input
                aria-label={`Office name for ${o.gstin}`}
                value={o.label}
                maxLength={80}
                className="min-w-[10rem] flex-1"
                onChange={(ev) =>
                  setOffices(
                    offices.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)),
                  )
                }
              />
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="head-office"
                  checked={o.isHeadOffice}
                  onChange={() =>
                    setOffices(offices.map((x, j) => ({ ...x, isHeadOffice: j === i })))
                  }
                />
                Head office
              </label>
            </div>
          ))}
          {clash && <p className="text-xs text-danger-600">Every office needs its own name.</p>}
        </div>
      </div>
    </Modal>
  );
}
