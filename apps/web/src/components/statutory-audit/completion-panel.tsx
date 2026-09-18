'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
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
  type StatutoryAuditCompletion,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Card, Badge, Button, Spinner } from '@/components/ui';
import { Select, Textarea } from '@/components/form';

/**
 * Completion / Reporting / Sign-off / Archive (Audit Spec §27–§29) — SA-8. Two
 * professional checklists (Completion §27.07, Reporting §27.08), then the gated
 * partner actions: Approve Completion, Sign Off (§29 — blocked by open blocking
 * review notes, unconcluded areas or unresolved items) and Archive + lock (§37).
 * All gate maths comes from the shared pure helpers, so the button-enabling here
 * is exactly the server's rule (§28 "the UI must not permit an action merely
 * because a button is visible" — the server re-checks).
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

  const blockers = signOffBlockers(file.gate);

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
          <FileStatusBadge file={file} />
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
            {blockers.map((b) => (
              <li key={b}>• {b}</li>
            ))}
          </ul>
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

  return (
    <li className="grid grid-cols-[1.4fr_0.9fr] items-start gap-3 px-4 py-2.5 text-sm">
      <div>
        <p className="font-medium text-ink">{item.title}</p>
        {canManage ? (
          <Textarea
            rows={1}
            value={note}
            placeholder="Note / conclusion…"
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            className="mt-1 min-h-0 text-xs"
          />
        ) : (
          item.note && <p className="mt-1 text-xs text-ink-muted">{item.note}</p>
        )}
      </div>
      <div className="flex justify-end">
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
      </div>
    </li>
  );
}
