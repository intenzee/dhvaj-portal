'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';
import {
  FEATURE_FLAG,
  PERMISSION,
  partnerPackMonth,
  partnerPackMonthLabel,
  type PartnerPackSummary,
} from '@hsdg/contracts';
import { apiFetch, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, hasRole } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useToast } from '@/lib/toast';
import { Select } from '@/components/form';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui';

const KEY = ['partner-packs'] as const;

/** The last twelve months, newest first, as 'YYYY-MM' (this month included). */
export function recentMonths(today: string, n = 12): string[] {
  const out = [today.slice(0, 7)];
  while (out.length < n) out.push(partnerPackMonth(`${out[out.length - 1]}-01`));
  return out;
}

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * PS-303 · Reports → Partner packs. Each partner's pack for last month is
 * built on the 3rd and e-mailed; here they download it as a PDF, or build any
 * month again (with today's figures). The Managing Partner sees every pack.
 */
export function PartnerPacks(): JSX.Element {
  const { principal } = useAuth();
  const { isOn } = useFeatureFlags();
  const toast = useToast();
  const qc = useQueryClient();
  const today = istToday();
  const months = recentMonths(today);
  const [month, setMonth] = useState(partnerPackMonth(today));
  const [busy, setBusy] = useState<string | null>(null);
  const on = isOn(FEATURE_FLAG.partnerRisk) && can(principal, PERMISSION.reportRead);
  const isPartner = !!principal?.employeeId && hasRole(principal, 'partner', 'managing_partner');

  const list = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<PartnerPackSummary[]>('/reports/partner-packs'),
    enabled: on,
  });
  const build = useMutation({
    mutationFn: (m: string) =>
      apiFetch<PartnerPackSummary>('/reports/partner-packs', {
        method: 'POST',
        body: JSON.stringify({ month: m }),
      }),
    onSuccess: (p) => {
      toast(`Your pack for ${partnerPackMonthLabel(p.month)} is ready.`);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const download = async (p: PartnerPackSummary): Promise<void> => {
    setBusy(p.id);
    try {
      await downloadFile(`/reports/partner-packs/${p.id}/pdf`, `partner-pack-${p.month}.pdf`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!on) {
    return (
      <div>
        <PageHeader title="Partner packs" />
        <EmptyState>Partner packs are not switched on for you.</EmptyState>
      </div>
    );
  }

  const packs = list.data ?? [];
  return (
    <div>
      <PageHeader
        title="Partner packs"
        subtitle="Each partner's month on one page — risk, filings filed, notices closed, invoiced and collected. Built on the 3rd and e-mailed; download any month here."
      />
      {isPartner && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Build a month</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-ink-muted">Month</span>
                <Select
                  aria-label="Month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-48"
                >
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {partnerPackMonthLabel(m)}
                      {m === today.slice(0, 7) ? ' (so far)' : ''}
                    </option>
                  ))}
                </Select>
              </label>
              <Button onClick={() => build.mutate(month)} disabled={build.isPending}>
                <RefreshCw className="h-4 w-4" aria-hidden />
                {build.isPending ? 'Building…' : 'Build my pack'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              The risk tiles are as they stand now; the month’s figures count what happened in it.
              Building a month again replaces that month’s pack.
            </p>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Packs</CardTitle>
        </CardHeader>
        <CardBody>
          {list.isLoading ? (
            <Spinner />
          ) : packs.length === 0 ? (
            <EmptyState>No packs yet. The first goes out on the 3rd of next month.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Month</th>
                  <th className="py-2 pr-3 font-medium">Partner</th>
                  <th className="py-2 pr-3 font-medium">At a glance</th>
                  <th className="py-2 pr-3 font-medium">Built</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 font-medium text-ink">
                      {partnerPackMonthLabel(p.month)}
                    </td>
                    <td className="py-2 pr-3">{p.partnerName}</td>
                    <td className="py-2 pr-3 tabular-nums text-ink-muted">{p.headline}</td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {new Date(p.generatedAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void download(p)}
                        disabled={busy === p.id}
                        aria-label={`Download the ${partnerPackMonthLabel(p.month)} pack for ${p.partnerName}`}
                      >
                        <Download className="h-4 w-4" aria-hidden /> PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
