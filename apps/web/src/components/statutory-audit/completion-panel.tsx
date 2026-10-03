'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Lock, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import {
  canApproveCompletion,
  canArchive,
  canSignOff,
  signOffBlockers,
  COMPLETION_ITEM_STATE,
  PERMISSION,
  type AuditCompletionItem,
  type CompletionItemState,
  type CompletionSection,
  type CompletionSuggestionResult,
  type StatutoryAuditCompletion,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Card, Badge, Button, Spinner } from '@/components/ui';
import { Select, Textarea } from '@/components/form';
import { openAuditPhase } from './audit-file-nav';

/**
 * Completion / Reporting / Sign-off / Archive (Audit Spec §27–§29) — SA-8. Two
 * professional checklists (Completion §27.07, Reporting §27.08), then the gated
 * partner actions: Approve Completion, Sign Off (§29 — blocked by open blocking
 * review notes, unconcluded areas or unresolved items) and Archive + lock (§37).
 * All gate maths comes from the shared pure helpers, so the button-enabling here
 * is exactly the server's rule (§28 "the UI must not permit an action merely
 * because a button is visible" — the server re-checks).
 *
 * Each item is kept in line with the file: its facts (linked procedures,
 * risks, exceptions, materiality, Section 02 conclusions) show under it with a
 * link to where the work is done, untouched items follow the evidence, and
 * notes — including the completion memo — are drafted for the team to edit.
 */

const QK = (id: string) => ['engagement', id, 'statutory-audit-completion'];

const STATE_TONE: Record<CompletionItemState, string> = {
  not_started: 'neutral',
  in_progress: 'info',
  complete: 'success',
  not_applicable: 'neutral',
};

export function CompletionPanel({ engagementId }: { engagementId: string }): JSX.Element | null {
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const query = useQuery({
    queryKey: QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditCompletion[]>(`/engagements/${engagementId}/statutory-audit/completion`),
  });

  if (query.isLoading) return <Spinner label="Loading completion…" />;
  const file = query.data?.[0];
  if (!file) return null;

  return <CompletionFile engagementId={engagementId} file={file} canManage={canManage} />;
}

function CompletionFile({
  engagementId,
  file,
  canManage,
}: {
  engagementId: string;
  file: StatutoryAuditCompletion;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: QK(engagementId) });
    // Phase states change on approve/sign-off/archive — refresh the nav too.
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'statutory-audit'] });
  };

  const wf = file.workflowInstanceId;
  const locked = file.gate.archived;

  const runAction = (path: string, ok: string) => ({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/${wf}/${path}`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      toast(ok);
      invalidate();
    },
    onError: (e: unknown) => toast(e instanceof ApiError ? e.message : 'Action failed.'),
  });

  const approve = useMutation(runAction('completion/approve', 'Completion approved.'));
  const signOff = useMutation(runAction('sign-off', 'File signed off.'));
  const archive = useMutation(runAction('archive', 'File archived and locked.'));

  const refresh = useMutation({
    mutationFn: () =>
      apiFetch<CompletionSuggestionResult>(
        `/engagements/${engagementId}/statutory-audit/${wf}/completion/suggest`,
        { method: 'POST', body: {} },
      ),
    onSuccess: (r) => {
      toast(
        r.itemsUpdated > 0
          ? `Updated ${r.itemsUpdated} item(s) from the file.`
          : 'Checklist is up to date with the file.',
      );
      invalidate();
    },
    onError: (e: unknown) => toast(e instanceof ApiError ? e.message : 'Could not refresh.'),
  });

  const blockers = signOffBlockers(file.gate);
  const blockerTarget = (b: string): string | null =>
    /audit area/.test(b) ? 'audit_areas' : /review note/.test(b) ? 'review' : null;

  return (
    <div className="space-y-3">
      {/* Status header */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Completion &amp; Sign-off</h2>
            <p className="mt-1 text-xs text-ink-muted">
              Phases 07–10 · Completion, Reporting, Partner Sign-off, Archive
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canManage && !file.gate.signedOff && !locked && (
              <Button
                variant="secondary"
                size="sm"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh from the file
              </Button>
            )}
            <FileStatusBadge file={file} />
          </div>
        </div>
        {(file.completionApprovedByName || file.signedOffByName || file.archivedByName) && (
          <div className="mt-3 space-y-1 text-xs text-ink-muted">
            {file.completionApprovedByName && (
              <p>Completion approved by {file.completionApprovedByName}.</p>
            )}
            {file.signedOffByName && (
              <p>Signed off by {file.signedOffByName}.</p>
            )}
            {file.archivedByName && <p>Archived by {file.archivedByName} — file locked.</p>}
          </div>
        )}
      </Card>

      <ChecklistCard
        engagementId={engagementId}
        title="Completion (07)"
        section="completion"
        items={file.items}
        canManage={canManage && !locked}
      />
      <ChecklistCard
        engagementId={engagementId}
        title="Reporting (08)"
        section="reporting"
        items={file.items}
        canManage={canManage && !locked}
      />

      {/* Gated actions */}
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-ink">Partner actions</h3>

        {blockers.length > 0 && !file.gate.signedOff && (
          <ul className="space-y-1 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700">
            {blockers.map((b) => {
              const target = blockerTarget(b);
              return (
                <li key={b}>
                  •{' '}
                  {target ? (
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => openAuditPhase(target)}
                    >
                      {b}
                    </button>
                  ) : (
                    b
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!file.gate.completionApproved && (
          <p className="text-xs text-ink-muted">
            Approving completion records the Completion Memo above as the approval memo.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!canManage || !canApproveCompletion(file.gate) || approve.isPending}
            onClick={() => approve.mutate({})}
          >
            <CheckCircle2 className="h-4 w-4" />
            {file.gate.completionApproved ? 'Completion approved' : 'Approve completion'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canManage || !canSignOff(file.gate) || signOff.isPending}
            onClick={() => signOff.mutate({})}
          >
            <ShieldCheck className="h-4 w-4" />
            {file.gate.signedOff ? 'Signed off' : 'Sign off'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canManage || !canArchive(file.gate) || archive.isPending}
            onClick={() => archive.mutate({})}
          >
            <Lock className="h-4 w-4" />
            {file.gate.archived ? 'Archived' : 'Archive & lock'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function FileStatusBadge({ file }: { file: StatutoryAuditCompletion }): JSX.Element {
  if (file.gate.archived) return <Badge tone="neutral">Archived · Locked</Badge>;
  if (file.gate.signedOff) return <Badge tone="success">Signed off</Badge>;
  if (file.gate.completionApproved) return <Badge tone="info">Completion approved</Badge>;
  return <Badge tone="warn">In progress</Badge>;
}

function ChecklistCard({
  engagementId,
  title,
  section,
  items,
  canManage,
}: {
  engagementId: string;
  title: string;
  section: CompletionSection;
  items: AuditCompletionItem[];
  canManage: boolean;
}): JSX.Element {
  const rows = items.filter((i) => i.section === section);
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line bg-surface-raised/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </div>
      <ul className="divide-y divide-line">
        {rows.map((item) => (
          <ItemRow
            key={item.id}
            engagementId={engagementId}
            item={item}
            canManage={canManage}
          />
        ))}
      </ul>
    </Card>
  );
}

function ItemRow({
  engagementId,
  item,
  canManage,
}: {
  engagementId: string;
  item: AuditCompletionItem;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState(item.note ?? '');
  // A drafted note can change as the file moves on — follow it.
  useEffect(() => setNote(item.note ?? ''), [item.note]);

  const update = useMutation({
    mutationFn: (body: { state?: CompletionItemState; note?: string | null }) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/completion/items/${item.id}`, {
        method: 'POST',
        body: { ...body, version: item.version },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK(engagementId) });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not update item.'),
  });

  const saveNote = (): void => {
    if ((note.trim() || null) === (item.note ?? null)) return;
    update.mutate({ note });
  };

  const { evidence } = item;
  const resolved = item.state === 'complete' || item.state === 'not_applicable';
  const isMemo = item.itemKey === 'completion_memo';

  return (
    <li className="grid grid-cols-[1.4fr_0.9fr] items-start gap-3 px-4 py-2.5 text-sm">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-ink">{item.title}</p>
          {evidence.ready && !resolved && <Badge tone="success">Ready to complete</Badge>}
          {item.stateSuggested && item.state !== 'not_started' && (
            <Badge tone="neutral">Set from the file</Badge>
          )}
        </div>
        {evidence.facts.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
            {evidence.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        {evidence.goTo && (
          <button
            type="button"
            onClick={() => openAuditPhase(evidence.goTo!.phaseKey)}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
          >
            {evidence.goTo.label}
            <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        )}
        {canManage ? (
          <Textarea
            rows={isMemo ? 7 : 2}
            value={note}
            placeholder="Note / conclusion…"
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            className="mt-1 min-h-0 text-xs"
          />
        ) : (
          item.note && <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{item.note}</p>
        )}
        {item.noteSuggested && item.note && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-ink-faint">
            <Sparkles className="h-3 w-3" aria-hidden />
            Drafted from the file — edit to make it yours.
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {canManage ? (
          <Select
            value={item.state}
            onChange={(e) => update.mutate({ state: e.target.value as CompletionItemState })}
            className="h-8 w-40 text-xs"
          >
            {Object.values(COMPLETION_ITEM_STATE).map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={STATE_TONE[item.state]}>{humanize(item.state)}</Badge>
        )}
        {canManage && evidence.ready && !resolved && (
          <Button
            variant="secondary"
            size="sm"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                (note.trim() || null) !== (item.note ?? null)
                  ? { state: 'complete', note }
                  : { state: 'complete' },
              )
            }
          >
            <CheckCircle2 className="h-4 w-4" />
            Mark complete
          </Button>
        )}
      </div>
    </li>
  );
}
