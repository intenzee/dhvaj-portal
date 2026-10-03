'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, RefreshCw } from 'lucide-react';
import {
  PERMISSION,
  type SoftwareSystemInput,
  type StatutoryAuditIcfr,
  type StatutoryAuditIcfrMasterFillResult,
  type StatutoryAuditOtherReporting,
  type StatutoryAuditOtherReportingMasterFillResult,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input } from '@/components/form';
import { Facts } from './group-caro-card';

/**
 * 02.5 ICFR and 02.7 other-reporting facts the portal already holds (Guide
 * §1): the ROC filing record from the compliance calendar, a managing /
 * whole-time director from the contacts master and the accounting software
 * from last year's file — shown with their source. The team is asked only for
 * what nothing on the portal answers: peak covered borrowings, and whether each
 * system's audit trail ran all this year.
 */

const icfrQk = (id: string) => ['engagement', id, 'statutory-audit-icfr'];
const orQk = (id: string) => ['engagement', id, 'statutory-audit-other-reporting'];

const decided = (s?: string) =>
  s === 'applicable' || s === 'not_applicable' || s === 'overridden' || s === 'approved';

export function ReportingFactsCard({ engagementId }: { engagementId: string }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const icfrQ = useQuery({
    queryKey: icfrQk(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditIcfr[]>(`/engagements/${engagementId}/statutory-audit/icfr`),
  });
  const orQ = useQuery({
    queryKey: orQk(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditOtherReporting[]>(
        `/engagements/${engagementId}/statutory-audit/other-reporting`,
      ),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: icfrQk(engagementId) });
    void qc.invalidateQueries({ queryKey: orQk(engagementId) });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };
  const fail = (e: unknown, what: string) =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`);

  const icfr = icfrQ.data?.[0];
  const or = orQ.data?.[0];
  const wf = icfr?.workflowInstanceId ?? or?.workflowInstanceId;
  const base = `/engagements/${engagementId}/statutory-audit/${wf}`;

  const fill = useMutation({
    mutationFn: async () => {
      const a = await apiFetch<StatutoryAuditIcfrMasterFillResult>(
        `${base}/icfr/fill-from-master`,
        {
          method: 'POST',
          body: {},
        },
      );
      const b = await apiFetch<StatutoryAuditOtherReportingMasterFillResult>(
        `${base}/other-reporting/fill-from-master`,
        { method: 'POST', body: {} },
      );
      return [...a.filled, ...b.filled];
    },
    onSuccess: (filled) => {
      toast(
        filled.length
          ? `Filled from the portal: ${filled.join(', ')}.`
          : 'Nothing new on the portal — your entries are unchanged.',
      );
      refresh();
    },
    onError: (e) => fail(e, 'fill from the client master'),
  });

  const [peak, setPeak] = useState('');
  const savePeak = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/icfr/facts`, {
        method: 'POST',
        body: { peakCoveredBorrowings: Number(peak), version: icfr!.assessment.version },
      }),
    onSuccess: () => {
      toast('Peak borrowings saved.');
      setPeak('');
      refresh();
    },
    onError: (e) => fail(e, 'save the peak borrowings'),
  });

  const saveSystems = useMutation({
    mutationFn: (softwareSystems: SoftwareSystemInput[]) =>
      apiFetch(`${base}/other-reporting/facts`, {
        method: 'POST',
        body: { softwareSystems, version: or!.assessment.version },
      }),
    onSuccess: () => {
      toast('Audit trail updated.');
      refresh();
    },
    onError: (e) => fail(e, 'update the audit trail'),
  });

  if (!icfr && !or) return null;
  const editable = canManage && !!wf;
  const systems = or?.capturedFacts.softwareSystems ?? [];

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <FileCheck2 className="h-4 w-4 text-ink-faint" aria-hidden />
          ICFR &amp; other reporting · 02.5 / 02.7
        </h3>
        {editable && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fill.mutate()}
            disabled={fill.isPending}
            title="Fill blank facts from the portal; never overwrites your entries"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Fill from client master
          </Button>
        )}
      </div>

      {icfr && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">ICFR reporting</span>
            {icfr.assessment.systemOutcome && (
              <Badge tone="info">Suggested: {humanize(icfr.assessment.systemOutcome)}</Badge>
            )}
          </div>
          <Facts facts={icfr.masterFacts} />
          {icfr.assessment.systemBasis && (
            <p className="text-xs text-ink-muted">{icfr.assessment.systemBasis}</p>
          )}
          {editable && !decided(icfr.assessment.state) && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (peak.trim() !== '' && Number(peak) >= 0) savePeak.mutate();
              }}
            >
              <Field
                label="Peak borrowings from banks, FIs and bodies corporate (₹)"
                hint={
                  icfr.capturedFacts.peakCoveredBorrowings != null
                    ? `Saved: ₹${icfr.capturedFacts.peakCoveredBorrowings.toLocaleString('en-IN')}`
                    : 'The only ICFR figure the portal does not hold.'
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

      {or && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">Other reporting</span>
            {or.assessment.systemOutcome && (
              <Badge tone="info">Suggested: {humanize(or.assessment.systemOutcome)}</Badge>
            )}
          </div>
          <Facts facts={or.masterFacts} />
          {editable && !decided(or.assessment.state) && systems.length > 0 && (
            <ul className="space-y-1.5">
              {systems.map((sys, i) => (
                <li key={`${sys.name}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-ink">{sys.name}</span>
                  <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={sys.auditTrailOperatedAllYear}
                      disabled={saveSystems.isPending || !sys.hasAuditTrailFeature}
                      onChange={(e) =>
                        saveSystems.mutate(
                          systems.map((x, j) =>
                            j === i ? { ...x, auditTrailOperatedAllYear: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                    {sys.hasAuditTrailFeature
                      ? 'Audit trail ran all this year'
                      : 'No audit-trail feature on record'}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Card>
  );
}
