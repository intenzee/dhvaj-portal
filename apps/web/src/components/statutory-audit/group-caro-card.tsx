'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, RefreshCw } from 'lucide-react';
import {
  PERMISSION,
  type MasterFact,
  type StatutoryAuditCaro,
  type StatutoryAuditCaroMasterFillResult,
  type StatutoryAuditConsolidation,
  type StatutoryAuditConsolidationMasterFillResult,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

/**
 * 02.4 CARO and 02.6 consolidation facts, filled from the client master (Guide
 * §1): the group structure, listing, branches and the audit year's figures are
 * shown with their source, so the team confirms instead of typing. Only the
 * facts the master cannot answer — peak bank borrowings and whether a parent
 * files compliant CFS — are asked here.
 */

const caroQk = (id: string) => ['engagement', id, 'statutory-audit-caro'];
const cfsQk = (id: string) => ['engagement', id, 'statutory-audit-consolidation'];

export function GroupCaroCard({ engagementId }: { engagementId: string }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const caroQ = useQuery({
    queryKey: caroQk(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditCaro[]>(`/engagements/${engagementId}/statutory-audit/caro`),
  });
  const cfsQ = useQuery({
    queryKey: cfsQk(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditConsolidation[]>(
        `/engagements/${engagementId}/statutory-audit/consolidation`,
      ),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: caroQk(engagementId) });
    void qc.invalidateQueries({ queryKey: cfsQk(engagementId) });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };
  const fail = (e: unknown, what: string) =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`);

  const caro = caroQ.data?.[0];
  const cfs = cfsQ.data?.[0];
  const wf = caro?.workflowInstanceId ?? cfs?.workflowInstanceId;

  const fill = useMutation({
    mutationFn: async () => {
      const base = `/engagements/${engagementId}/statutory-audit/${wf}`;
      const a = await apiFetch<StatutoryAuditCaroMasterFillResult>(
        `${base}/caro/fill-from-master`,
        {
          method: 'POST',
          body: {},
        },
      );
      const b = await apiFetch<StatutoryAuditConsolidationMasterFillResult>(
        `${base}/consolidation/fill-from-master`,
        { method: 'POST', body: {} },
      );
      return [...a.filled, ...b.filled];
    },
    onSuccess: (filled) => {
      toast(
        filled.length
          ? `Filled from the client master: ${filled.join(', ')}.`
          : 'Nothing new on the client master — your entries are unchanged.',
      );
      refresh();
    },
    onError: (e) => fail(e, 'fill from the client master'),
  });

  const [peak, setPeak] = useState('');
  const savePeak = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/${wf}/caro/facts`, {
        method: 'POST',
        body: { peakBankFiBorrowings: Number(peak), version: caro!.assessment.version },
      }),
    onSuccess: () => {
      toast('Peak borrowings saved.');
      setPeak('');
      refresh();
    },
    onError: (e) => fail(e, 'save the peak borrowings'),
  });

  const saveParentCfs = useMutation({
    mutationFn: (value: boolean | null) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/${wf}/consolidation/facts`, {
        method: 'POST',
        body: { parentFilesCompliantCfs: value, version: cfs!.assessment.version },
      }),
    onSuccess: () => {
      toast('Saved.');
      refresh();
    },
    onError: (e) => fail(e, 'save'),
  });

  if (!caro && !cfs) return null;
  const decided = (s?: string) =>
    s === 'applicable' || s === 'not_applicable' || s === 'overridden' || s === 'approved';
  const editable = canManage && !!wf;
  const hasParent =
    !!cfs &&
    (cfs.capturedFacts.isWhollyOwnedSubsidiary || cfs.capturedFacts.isPartiallyOwnedSubsidiary);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Network className="h-4 w-4 text-ink-faint" aria-hidden />
          CARO &amp; group facts · 02.4 / 02.6
        </h3>
        {editable && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fill.mutate()}
            disabled={fill.isPending}
            title="Fill blank facts from the client master; never overwrites your entries"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Fill from client master
          </Button>
        )}
      </div>

      {caro && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">CARO 2020</span>
            {caro.assessment.systemOutcome && (
              <Badge tone="info">Suggested: {humanize(caro.assessment.systemOutcome)}</Badge>
            )}
          </div>
          <Facts facts={caro.masterFacts} />
          {caro.assessment.systemBasis && (
            <p className="text-xs text-ink-muted">{caro.assessment.systemBasis}</p>
          )}
          {editable && !decided(caro.assessment.state) && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (peak.trim() !== '' && Number(peak) >= 0) savePeak.mutate();
              }}
            >
              <Field
                label="Peak bank / FI borrowings in the year (₹)"
                hint={
                  caro.capturedFacts.peakBankFiBorrowings != null
                    ? `Saved: ₹${caro.capturedFacts.peakBankFiBorrowings.toLocaleString('en-IN')}`
                    : 'The only CARO figure the client master does not hold.'
                }
              >
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={peak}
                  onChange={(e) => setPeak(e.target.value)}
                />
              </Field>
              <Button type="submit" size="sm" disabled={savePeak.isPending || peak.trim() === ''}>
                Save
              </Button>
            </form>
          )}
        </section>
      )}

      {cfs && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">Consolidation</span>
            {cfs.assessment.systemOutcome && (
              <Badge tone="info">Suggested: {humanize(cfs.assessment.systemOutcome)}</Badge>
            )}
          </div>
          <Facts facts={cfs.masterFacts} />
          {cfs.assessment.systemBasis && (
            <p className="text-xs text-ink-muted">{cfs.assessment.systemBasis}</p>
          )}
          {editable && hasParent && !decided(cfs.assessment.state) && (
            <Field
              label="Does a parent file Companies-Act-compliant CFS? (Rule 6)"
              hint="The client master cannot answer this one."
            >
              <Select
                value={
                  cfs.capturedFacts.parentFilesCompliantCfs == null
                    ? ''
                    : String(cfs.capturedFacts.parentFilesCompliantCfs)
                }
                onChange={(e) =>
                  saveParentCfs.mutate(e.target.value === '' ? null : e.target.value === 'true')
                }
                disabled={saveParentCfs.isPending}
              >
                <option value="">Not known yet</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            </Field>
          )}
        </section>
      )}
    </Card>
  );
}

function Facts({ facts }: { facts: MasterFact[] }): JSX.Element {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {facts.map((f) => (
        <div key={f.label} className="flex flex-col">
          <dt className="text-[11px] uppercase tracking-wide text-ink-faint">
            {f.label} <span className="normal-case tracking-normal">· {f.source}</span>
          </dt>
          <dd className={f.value ? 'text-ink' : 'italic text-ink-faint'}>
            {f.value ?? 'Not on master'}
          </dd>
        </div>
      ))}
    </dl>
  );
}
