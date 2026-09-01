'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import type { EngagementTimeReport } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatDuration } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Card, CardHeader, CardTitle, CardBody, Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { Field, Input } from '@/components/form';
import {
  LiveClock,
  StopTimerButton,
  invalidateTime,
  useActiveTimer,
} from '@/components/time/timer-shared';

/**
 * The engagement Time tab (ADR-0034): a manual stopwatch the assigned person
 * starts and stops, plus per-person totals so the EP/manager can see how much
 * time each person has spent. The timer never auto-stops — work often happens
 * outside the portal — so a running timer keeps counting until Stop, or until
 * the engagement is closed.
 */
export function TimeSection({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');

  const report = useQuery({
    queryKey: ['engagement', engagementId, 'time'],
    queryFn: () => apiFetch<EngagementTimeReport>(`/engagements/${engagementId}/time`),
  });
  const active = useActiveTimer();

  const start = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/time/start`, {
        method: 'POST',
        body: note.trim() ? { note: note.trim() } : {},
      }),
    onSuccess: () => {
      toast('Timer started — it keeps running until you stop it.');
      setNote('');
      invalidateTime(qc, engagementId);
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not start the timer.', 'error'),
  });

  const activeTimer = active.data ?? null;
  const runningHere = activeTimer && activeTimer.entry.engagementId === engagementId;
  const runningElsewhere = activeTimer && activeTimer.entry.engagementId !== engagementId;

  return (
    <div className="space-y-4">
      {/* ── Stopwatch control ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>My timer</CardTitle>
        </CardHeader>
        <CardBody>
          {runningHere && activeTimer ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-500 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success-500" />
                </span>
                <div>
                  <div className="font-mono text-2xl font-semibold text-ink">
                    <LiveClock startedAt={activeTimer.entry.startedAt} />
                  </div>
                  <div className="text-xs text-ink-faint">
                    Running since {formatDate(activeTimer.entry.startedAt)}
                    {activeTimer.entry.note ? ` · ${activeTimer.entry.note}` : ''}
                  </div>
                </div>
              </div>
              <StopTimerButton engagementId={engagementId} size="md" variant="primary" label="Stop working" />
            </div>
          ) : runningElsewhere && activeTimer ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-muted">
                You have a timer running on{' '}
                <Link
                  href={`/engagements/${activeTimer.entry.engagementId}`}
                  className="font-medium text-primary-600 hover:underline"
                >
                  {activeTimer.engagementCode}
                </Link>{' '}
                (<LiveClock startedAt={activeTimer.entry.startedAt} />). Stop it before starting here —
                one timer at a time.
              </p>
              <StopTimerButton engagementId={activeTimer.entry.engagementId} size="sm" label="Stop that one" />
            </div>
          ) : (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-[16rem] flex-1">
                <Field label="What are you working on? (optional)">
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. drafting GST reconciliation on the portal"
                  />
                </Field>
              </div>
              <Button
                size="md"
                disabled={start.isPending}
                onClick={() => start.mutate()}
              >
                <Play className="h-4 w-4" /> {start.isPending ? 'Starting…' : 'Start working'}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Per-person totals (the EP/manager view) ───────────────────────── */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Time by person</h2>
          {report.data && (
            <span className="text-xs text-ink-faint">
              Total logged: {formatDuration(report.data.totalSeconds)}
            </span>
          )}
        </div>
        <Card className="overflow-hidden p-0">
          {report.isLoading && <Spinner label="Loading time…" />}
          {report.data && report.data.byPerson.length === 0 && (
            <div className="p-5">
              <EmptyState>No time logged on this engagement yet.</EmptyState>
            </div>
          )}
          {report.data && report.data.byPerson.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-semibold">Person</th>
                  <th className="px-4 py-2.5 font-semibold">Sessions</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Total time</th>
                </tr>
              </thead>
              <tbody>
                {report.data.byPerson.map((p) => (
                  <tr key={p.employeeId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-ink">
                      {p.employeeName}
                      {p.hasRunning && (
                        <Badge tone="success" className="ml-2">
                          Running
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{p.entryCount}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-ink tabular-nums">
                      {formatDuration(p.totalSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      {/* ── Session history ───────────────────────────────────────────────── */}
      {report.data && report.data.entries.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Sessions</h2>
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-semibold">Person</th>
                  <th className="px-4 py-2.5 font-semibold">Started</th>
                  <th className="px-4 py-2.5 font-semibold">Note</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {report.data.entries.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-ink">{e.employeeName}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{formatDate(e.startedAt)}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{e.note ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {e.isRunning ? (
                        <span className="font-medium text-success-600">
                          <LiveClock startedAt={e.startedAt} />
                        </span>
                      ) : (
                        <span className="text-ink">{formatDuration(e.durationSeconds)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </div>
  );
}
