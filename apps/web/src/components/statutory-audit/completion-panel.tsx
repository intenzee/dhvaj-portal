'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  canApproveCompletion,
  canArchive,
  canSignOff,
  COMPLETION_ITEM_STATE,
  PERMISSION,
  UDIN_PATTERN,
  type AuditCompletionItem,
  type CompletionItemState,
  type CompletionSection,
  type CompletionSuggestionResult,
  type SignOffCheck,
  type StatutoryAuditCompletion,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Card, Badge, Button, Spinner } from '@/components/ui';
import { Input, Select, Textarea } from '@/components/form';
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
      apiFetch<StatutoryAuditCompletion[]>(
        `/engagements/${engagementId}/statutory-audit/completion`,
      ),
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

  // The partner's memo starts as the draft; signing with it unchanged
  // records the draft (the server drafts the same text).
  const pack = file.signOffPack;
  const [memo, setMemo] = useState(pack.draftMemo);
  const [memoEdited, setMemoEdited] = useState(false);
  useEffect(() => {
    if (!memoEdited) setMemo(pack.draftMemo);
  }, [pack.draftMemo, memoEdited]);

  // Section 10 — the archive form starts from the file: report date = sign-off
  // date, the drafted note. An untouched note archives with the server's draft.
  const ap = file.archivePack;
  const [reportDate, setReportDate] = useState(file.reportDate ?? '');
  const [udin, setUdin] = useState(file.udin ?? '');
  const [archiveNote, setArchiveNote] = useState(ap.draftNote);
  const [noteEdited, setNoteEdited] = useState(false);
  useEffect(() => {
    if (!noteEdited) setArchiveNote(ap.draftNote);
  }, [ap.draftNote, noteEdited]);
  useEffect(() => setReportDate(file.reportDate ?? ''), [file.reportDate]);
  const udinClean = udin.trim().toUpperCase();
  const udinError = udinClean && !UDIN_PATTERN.test(udinClean) ? 'UDIN is 18 characters.' : null;
  const archiveBody = (): Record<string, unknown> => ({
    ...(reportDate && reportDate !== file.reportDate ? { reportDate } : {}),
    ...(udinClean ? { udin: udinClean } : {}),
    ...(noteEdited && archiveNote.trim() ? { note: archiveNote } : {}),
  });

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
            {file.signedOffByName && <p>Signed off by {file.signedOffByName}.</p>}
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

      {!file.gate.signedOff && (
        <SignOffCard
          pack={pack}
          memo={memo}
          drafted={!memoEdited}
          canEdit={canManage && !locked}
          onMemo={(v) => {
            setMemo(v);
            setMemoEdited(v !== pack.draftMemo);
          }}
        />
      )}
      {file.gate.signedOff && file.signoffMemo && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-ink">Partner sign-off (09)</h3>
          <p className="mt-2 whitespace-pre-line text-xs text-ink-muted">{file.signoffMemo}</p>
        </Card>
      )}

      {file.gate.signedOff && !file.gate.archived && (
        <ArchiveCard
          file={file}
          canEdit={canManage}
          reportDate={reportDate}
          onReportDate={setReportDate}
          udin={udin}
          onUdin={setUdin}
          udinError={udinError}
          note={archiveNote}
          drafted={!noteEdited}
          onNote={(v) => {
            setArchiveNote(v);
            setNoteEdited(v !== ap.draftNote);
          }}
        />
      )}
      {file.gate.archived && <ArchiveRecord file={file} />}

      {/* Gated actions */}
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-ink">Partner actions</h3>

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
            onClick={() => signOff.mutate(memoEdited && memo.trim() ? { memo } : {})}
          >
            <ShieldCheck className="h-4 w-4" />
            {file.gate.signedOff ? 'Signed off' : 'Sign off'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={
              !canManage || !canArchive(file.gate) || archive.isPending || Boolean(udinError)
            }
            onClick={() => archive.mutate(archiveBody())}
          >
            <Lock className="h-4 w-4" />
            {file.gate.archived ? 'Archived' : 'Archive & lock'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/**
 * Section 09 — the partner's sign-off pack: each §29 gate and what the
 * partner should know, read from the file with a link to put it right, and
 * the drafted sign-off memo.
 */
function SignOffCard({
  pack,
  memo,
  drafted,
  canEdit,
  onMemo,
}: {
  pack: StatutoryAuditCompletion['signOffPack'];
  memo: string;
  drafted: boolean;
  canEdit: boolean;
  onMemo: (memo: string) => void;
}): JSX.Element {
  const gates = pack.checks.filter((c) => c.blocking);
  const notes = pack.checks.filter((c) => !c.blocking);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-line bg-surface-raised/60 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Partner sign-off (09)
        </span>
        {pack.ready ? (
          <Badge tone="success">Ready to sign off</Badge>
        ) : (
          <Badge tone="warn">
            {gates.filter((g) => !g.ok).length} of {gates.length} gates open
          </Badge>
        )}
      </div>
      <div className="space-y-3 px-4 py-3">
        {pack.engagementPartnerName && (
          <p className="text-xs text-ink-muted">
            Signed by the engagement partner, {pack.engagementPartnerName}.
          </p>
        )}
        <CheckList title="Before sign-off" checks={gates} />
        <CheckList
          title={
            pack.attention > 0
              ? `For the partner's attention (${pack.attention})`
              : "For the partner's attention"
          }
          checks={notes}
        />
        <div>
          <p className="text-xs font-medium text-ink">Sign-off memo</p>
          {canEdit ? (
            <Textarea
              rows={8}
              value={memo}
              onChange={(e) => onMemo(e.target.value)}
              className="mt-1 min-h-0 text-xs"
              aria-label="Sign-off memo"
            />
          ) : (
            <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{memo}</p>
          )}
          {drafted && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-ink-faint">
              <Sparkles className="h-3 w-3" aria-hidden />
              Drafted from the file — recorded as written when you sign off.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Section 10 — the archive pack: the sign-off gate, the SA 230 assembly
 * deadline and SQC 1 retention, what archiving would freeze, evidence gaps
 * and what next year's file brings forward; then the report date, UDIN and
 * the drafted archive note.
 */
function ArchiveCard({
  file,
  canEdit,
  reportDate,
  onReportDate,
  udin,
  onUdin,
  udinError,
  note,
  drafted,
  onNote,
}: {
  file: StatutoryAuditCompletion;
  canEdit: boolean;
  reportDate: string;
  onReportDate: (v: string) => void;
  udin: string;
  onUdin: (v: string) => void;
  udinError: string | null;
  note: string;
  drafted: boolean;
  onNote: (v: string) => void;
}): JSX.Element {
  const pack = file.archivePack;
  const days = pack.daysToAssemble;
  const gates = pack.checks.filter((c) => c.blocking);
  const notes = pack.checks.filter((c) => !c.blocking);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-line bg-surface-raised/60 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Archiving (10)
        </span>
        {days == null ? null : days >= 0 ? (
          <Badge tone={days <= 7 ? 'warn' : 'info'}>
            Assemble by {pack.assemblyDueBy} · {days} day(s) left
          </Badge>
        ) : (
          <Badge tone="danger">Assembly overdue by {-days} day(s)</Badge>
        )}
      </div>
      <div className="space-y-3 px-4 py-3">
        <CheckList title="Before archiving" checks={gates} />
        <CheckList
          title={pack.attention > 0 ? `Worth closing first (${pack.attention})` : 'Worth closing first'}
          checks={notes}
        />
        {canEdit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-ink">
              Auditor&apos;s report date
              <Input
                type="date"
                value={reportDate}
                onChange={(e) => onReportDate(e.target.value)}
                className="mt-1 h-8 text-xs"
              />
              <span className="mt-0.5 block text-[11px] font-normal text-ink-faint">
                Defaults to the sign-off date. Retention runs 7 years from it.
              </span>
            </label>
            <label className="text-xs font-medium text-ink">
              UDIN
              <Input
                value={udin}
                onChange={(e) => onUdin(e.target.value)}
                placeholder="e.g. 25123456ABCDEFGHIJ"
                maxLength={18}
                className="mt-1 h-8 font-mono text-xs uppercase"
              />
              <span className="mt-0.5 block text-[11px] font-normal text-ink-faint">
                {udinError ?? 'From the ICAI UDIN portal, for the auditor’s report.'}
              </span>
            </label>
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-ink">Archive note</p>
          {canEdit ? (
            <Textarea
              rows={6}
              value={note}
              onChange={(e) => onNote(e.target.value)}
              className="mt-1 min-h-0 text-xs"
              aria-label="Archive note"
            />
          ) : (
            <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{note}</p>
          )}
          {drafted && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-ink-faint">
              <Sparkles className="h-3 w-3" aria-hidden />
              Drafted from the file — recorded with the report date and UDIN above when you
              archive.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/** The locked file's archive record (Section 10). */
function ArchiveRecord({ file }: { file: StatutoryAuditCompletion }): JSX.Element {
  return (
    <Card className="space-y-2 p-4">
      <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <Archive className="h-4 w-4" aria-hidden />
        Archive record (10)
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-ink-faint">Report date</dt>
        <dd className="text-ink">{file.reportDate ?? '—'}</dd>
        <dt className="text-ink-faint">UDIN</dt>
        <dd className="font-mono text-ink">{file.udin ?? '—'}</dd>
        <dt className="text-ink-faint">Archived</dt>
        <dd className="text-ink">
          {file.archivedAt?.slice(0, 10)}
          {file.archivedByName ? ` by ${file.archivedByName}` : ''}
        </dd>
        <dt className="text-ink-faint">Keep until</dt>
        <dd className="text-ink">{file.retainUntil ?? '—'}</dd>
      </dl>
      {file.archiveNote && (
        <p className="whitespace-pre-line text-xs text-ink-muted">{file.archiveNote}</p>
      )}
    </Card>
  );
}

function CheckList({ title, checks }: { title: string; checks: SignOffCheck[] }): JSX.Element {
  return (
    <div>
      <p className="text-xs font-medium text-ink">{title}</p>
      <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
        {checks.map((c) => {
          const Icon = c.ok ? CheckCircle2 : c.blocking ? XCircle : AlertTriangle;
          const tone = c.ok
            ? 'text-emerald-600'
            : c.blocking
              ? 'text-danger-600'
              : 'text-amber-600';
          return (
            <li key={c.key} className="flex gap-2 px-3 py-2 text-sm">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden />
              <div className="min-w-0">
                <p className="font-medium text-ink">{c.label}</p>
                <ul className="mt-0.5 space-y-0.5 text-xs text-ink-muted">
                  {c.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {c.goTo && (
                  <button
                    type="button"
                    onClick={() => openAuditPhase(c.goTo!.phaseKey)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
                  >
                    {c.goTo.label}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
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
          <ItemRow key={item.id} engagementId={engagementId} item={item} canManage={canManage} />
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
          item.note && (
            <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{item.note}</p>
          )
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
