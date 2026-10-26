'use client';

/**
 * The Clients page's "Data check" view (CM-9): clients added before the new
 * rules that break them. Each check is a card with a count; opening one lists
 * the clients with what is wrong and the proposed fix, and safe fixes apply
 * to the ticked rows after a person has looked at them (decision D10).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import {
  DATA_CHECK_META,
  PERMISSION,
  type DataCheck,
  type DataCheckApplyResult,
  type DataCheckCount,
  type DataCheckRow,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { useTeams } from '@/lib/teams';
import { Button, Card, EmptyState, Spinner } from '@/components/ui';
import { Select } from '@/components/form';

export const DATA_CHECKS_KEY = ['data-checks'] as const;

export function useDataCheckCounts(enabled = true) {
  return useQuery({
    queryKey: DATA_CHECKS_KEY,
    queryFn: () => apiFetch<DataCheckCount[]>('/entities/data-checks'),
    enabled,
    staleTime: 30 * 1000,
  });
}

/** "3 fixed · 1 not fixed" — pure, tested. */
export function applySummary(results: DataCheckApplyResult[]): string {
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  return [ok ? `${ok} fixed` : null, failed ? `${failed} not fixed` : null]
    .filter(Boolean)
    .join(' · ');
}

export function DataCheckView({ onOpenOffices }: { onOpenOffices: () => void }): JSX.Element {
  const [check, setCheck] = useState<DataCheck | null>(null);
  const counts = useDataCheckCounts();

  if (check) return <DataCheckTable check={check} onBack={() => setCheck(null)} />;
  if (counts.isLoading) return <Spinner label="Checking clients…" />;
  if (counts.isError)
    return (
      <p className="text-sm text-danger-700">
        {counts.error instanceof ApiError ? counts.error.message : 'Could not run the data check.'}
      </p>
    );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {(counts.data ?? []).map(({ check: c, count }) => (
        <button
          key={c}
          type="button"
          onClick={() => (c === 'offices' ? onOpenOffices() : setCheck(c))}
          className="rounded-lg border border-line bg-surface p-4 text-left hover:border-primary-300 hover:bg-surface-raised"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-ink">{DATA_CHECK_META[c].label}</span>
            <span
              className={`text-lg font-semibold ${count ? 'text-warning-700' : 'text-success-700'}`}
            >
              {count}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{DATA_CHECK_META[c].reason}</p>
        </button>
      ))}
    </div>
  );
}

function DataCheckTable({ check, onBack }: { check: DataCheck; onBack: () => void }): JSX.Element {
  const meta = DATA_CHECK_META[check];
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [teamId, setTeamId] = useState('');
  const [failures, setFailures] = useState<(DataCheckApplyResult & { name: string })[]>([]);
  const needsTeam = check === 'client_without_team';
  const teams = useTeams(needsTeam);
  const canAssignTeam = can(principal, PERMISSION.teamManage);

  const rows = useQuery({
    queryKey: [...DATA_CHECKS_KEY, check, page],
    queryFn: () => apiFetch<Paginated<DataCheckRow>>(`/entities/data-checks/${check}?page=${page}`),
  });
  const items = rows.data?.items ?? [];
  const applicable = items.filter((r) => r.canApply && r.entityId);
  const pages = rows.data ? Math.max(1, Math.ceil(rows.data.total / rows.data.limit)) : 1;

  const apply = useMutation({
    mutationFn: (action: 'apply' | 'keep') =>
      apiFetch<DataCheckApplyResult[]>(`/entities/data-checks/${check}/apply`, {
        method: 'POST',
        body: {
          entityIds: [...picked],
          ...(action === 'keep' ? { action } : {}),
          ...(needsTeam ? { teamId } : {}),
        },
      }),
    onSuccess: (results) => {
      toast(
        applySummary(results) || 'Nothing changed.',
        results.every((r) => r.ok) ? 'success' : 'error',
      );
      const names = new Map(items.map((r) => [r.entityId, r.name]));
      setFailures(
        results
          .filter((r) => !r.ok)
          .map((r) => ({ ...r, name: names.get(r.entityId) ?? r.entityId })),
      );
      setPicked(new Set());
      void qc.invalidateQueries({ queryKey: DATA_CHECKS_KEY });
      void qc.invalidateQueries({ queryKey: ['entities'] });
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not apply the fix.', 'error'),
  });

  const toggle = (id: string): void => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const allPicked = applicable.length > 0 && applicable.every((r) => picked.has(r.entityId!));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> All checks
        </Button>
        <h2 className="text-base font-semibold text-ink">{meta.label}</h2>
        <span className="text-sm text-ink-muted">
          {rows.data ? `${rows.data.total} to look at` : ''}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              void downloadFile(
                `/entities/data-checks/${check}/csv`,
                `data-check-${check}.csv`,
              ).catch(() => toast('Could not download the CSV.', 'error'))
            }
          >
            <Download className="h-4 w-4" /> CSV
          </Button>
          {meta.bulk && needsTeam && (
            <Select
              aria-label="Team to assign"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              disabled={!canAssignTeam}
            >
              <option value="">Pick a team…</option>
              {(teams.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          {meta.bulk && meta.keepLabel && (
            <Button
              variant="secondary"
              size="sm"
              disabled={picked.size === 0 || apply.isPending}
              onClick={() => apply.mutate('keep')}
            >
              {meta.keepLabel} ({picked.size})
            </Button>
          )}
          {meta.bulk && (
            <Button
              size="sm"
              disabled={
                picked.size === 0 || apply.isPending || (needsTeam && (!teamId || !canAssignTeam))
              }
              onClick={() => apply.mutate('apply')}
            >
              {apply.isPending ? 'Applying…' : `${meta.applyLabel ?? 'Apply'} (${picked.size})`}
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-ink-muted">{meta.reason}</p>

      {failures.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700"
        >
          <p className="font-medium">Not fixed:</p>
          <ul className="mt-1 list-disc pl-5">
            {failures.map((f) => (
              <li key={f.entityId}>
                {f.name}: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.isLoading && <Spinner label="Loading…" />}
      {rows.data && rows.data.total === 0 && <EmptyState>Nothing to fix here.</EmptyState>}
      {items.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-raised text-left text-xs text-ink-muted">
              <tr>
                {meta.bulk && (
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allPicked}
                      disabled={applicable.length === 0}
                      onChange={() =>
                        setPicked(
                          allPicked ? new Set() : new Set(applicable.map((r) => r.entityId!)),
                        )
                      }
                    />
                  </th>
                )}
                <th className="px-3 py-2">
                  {check === 'team_without_partner' ? 'Team' : 'Client'}
                </th>
                <th className="px-3 py-2">What is wrong</th>
                <th className="px-3 py-2">Now</th>
                <th className="px-3 py-2">Proposed fix</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 align-top">
                  {meta.bulk && (
                    <td className="px-3 py-2">
                      {r.canApply && r.entityId && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}`}
                          checked={picked.has(r.entityId)}
                          onChange={() => toggle(r.entityId!)}
                        />
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <Link href={r.href} className="font-medium text-primary-700 hover:underline">
                      {r.name}
                    </Link>
                    {r.code && <div className="text-xs text-ink-faint">{r.code}</div>}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{r.problem}</td>
                  <td className="px-3 py-2">{r.current ?? '—'}</td>
                  <td className="px-3 py-2 font-medium text-ink">{r.proposed ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-ink-muted">
            Page {page} of {pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
