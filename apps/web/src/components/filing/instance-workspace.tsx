'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DSC_REQUEST_CODE,
  FILING_REFERENCE_KINDS,
  isMeetingRule,
  type ChecklistItem,
  type FigureField,
  type FilingRecordView,
  type FilingReferenceKind,
  type InstanceWorkspace as Workspace,
  type TaskStatus,
  type WorkspaceSlot,
} from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile } from '@/lib/api';
import { blobToBase64 } from '@/lib/file-kind';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { TaskActionContext, WorkTask } from '@/lib/work-types';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { TaskActions } from '@/components/tasks/task-actions';
import { FilingStatusBadge, boardMeetingsText, daysLeftText, dueTone, filingEnd } from './filing-status';

/** The part of the created client-upload link the page needs. */
interface UploadLink {
  token: string;
}

const REFERENCE_LABEL: Record<FilingReferenceKind, string> = {
  arn: 'ARN',
  srn: 'SRN',
  token: 'Token no.',
  ack: 'Acknowledgement no.',
  challan: 'Challan (CIN/BSR)',
  internal: 'Internal ref.',
};

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function errText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export const workspaceKey = (instanceId: string) => ['filing', 'instance', instanceId] as const;

/**
 * Change 6 — one filing worked in place: header, cross-check warnings,
 * checklist, document slots (upload / request from client / N/A), figures,
 * the lodge form, the filed record with undo, corrections and waiver.
 * Every write returns the refreshed workspace, which replaces the cache.
 */
export function InstanceWorkspace({
  instanceId,
  ctx,
  correctionTargets = [],
  team = [],
}: {
  instanceId: string;
  ctx: TaskActionContext;
  /** People who may be recorded as having filed it (defaults to me). */
  team?: { employeeId: string; employeeName: string }[];
  /** Later filings a correction can point to (e.g. the next months' 3B). */
  correctionTargets?: { id: string; label: string }[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: workspaceKey(instanceId),
    queryFn: () => apiFetch<Workspace>(`/compliance-instances/${instanceId}`),
  });

  const write = useMutation({
    mutationFn: ({ path, body, method = 'POST' }: { path: string; body?: unknown; method?: string }) =>
      apiFetch<Workspace>(`/compliance-instances/${instanceId}${path}`, { method, body: body ?? {} }),
    onSuccess: (ws) => {
      qc.setQueryData(workspaceKey(instanceId), ws);
      void qc.invalidateQueries({ queryKey: ['filing', 'tree'] });
      void qc.invalidateQueries({ queryKey: ['engagement', ws.instance.engagementId] });
    },
  });
  const run = (path: string, body: unknown, done: string, method = 'POST') =>
    write.mutateAsync({ path, body, method }).then(
      () => {
        toast(done);
        return true;
      },
      (err) => {
        toast(errText(err, 'Could not save.'), 'error');
        return false;
      },
    );

  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) {
    return <p className="text-sm text-danger-700">{errText(q.error, 'Could not load this filing.')}</p>;
  }
  const ws = q.data;
  const inst = ws.instance;
  const editable = ws.can.edit && !inst.isLocked && inst.workflowStatus !== 'not_applicable';

  return (
    <div className="space-y-4 text-sm">
      <WorkspaceHeader ws={ws} ctx={ctx} team={team} />

      {ws.warnings.length > 0 && (
        <ul className="space-y-1" aria-label="Cross-checks">
          {ws.warnings.map((w) => (
            <li
              key={w.code}
              className="rounded-md border border-warning-500/30 bg-warning-50 px-2.5 py-1.5 text-xs text-warning-700"
            >
              {w.message}
            </li>
          ))}
        </ul>
      )}
      {inst.isLocked && inst.lockedReason && (
        <p className="rounded-md bg-surface-sunken px-2.5 py-1.5 text-xs text-ink-muted">🔒 {inst.lockedReason}</p>
      )}
      {inst.workflowStatus === 'not_applicable' && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-sunken px-2.5 py-1.5 text-xs">
          <span>Not applicable{inst.notApplicableReason ? ` — ${inst.notApplicableReason}` : ''}.</span>
          {ws.can.waive && (
            <Button
              size="sm"
              variant="secondary"
              disabled={write.isPending}
              onClick={() => void run('/not-applicable/lift', {}, 'Filing is applicable again.')}
            >
              Make applicable
            </Button>
          )}
        </div>
      )}

      <Checklist
        items={ws.checklist}
        editable={editable}
        certify={ws.can.certify}
        busy={write.isPending}
        run={run}
      />
      <Slots
        ws={ws}
        editable={editable}
        isLead={ctx.isLead}
        busy={write.isPending}
        run={run}
        onUploaded={(next) => qc.setQueryData(workspaceKey(instanceId), next)}
      />
      <ClientRequests ws={ws} editable={editable} isLead={ctx.isLead} busy={write.isPending} run={run} />
      {ws.figureSchema.length > 0 && (
        <Figures ws={ws} editable={editable} busy={write.isPending} run={run} />
      )}

      {ws.filing ? (
        <FiledRecord filing={ws.filing} end={filingEnd(inst.stream, inst.section, inst.ruleCode)} canUndo={ws.can.undo} busy={write.isPending} run={run} engagementId={inst.engagementId} />
      ) : (
        ws.can.lodge && (
          <LodgeForm
            ws={ws}
            busy={write.isPending}
            run={run}
            team={team}
            me={ctx.me}
            onUploaded={(next) => qc.setQueryData(workspaceKey(instanceId), next)}
          />
        )
      )}
      {ws.filingHistory.filter((f) => f.undoneAt).length > 0 && (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">Earlier lodgements (undone)</summary>
          <ul className="mt-1 space-y-1">
            {ws.filingHistory
              .filter((f) => f.undoneAt)
              .map((f) => (
                <li key={f.id}>
                  {REFERENCE_LABEL[f.referenceKind]} {f.referenceNo} · filed {formatDate(f.filedOn)} · undone{' '}
                  {formatDate(f.undoneAt)} by {f.undoneByName ?? '—'}: {f.undoReason}
                </li>
              ))}
          </ul>
        </details>
      )}

      <Corrections ws={ws} targets={correctionTargets} busy={write.isPending} run={run} />

      {ws.can.waive && !ws.filing && inst.workflowStatus !== 'not_applicable' && (
        <ReasonAction
          label="Mark not applicable"
          placeholder="Why this filing does not apply (e.g. registration cancelled)"
          busy={write.isPending}
          onSubmit={(reason) => run('/not-applicable', { reason }, 'Marked not applicable.')}
        />
      )}
    </div>
  );
}

type Run = (path: string, body: unknown, done: string, method?: string) => Promise<boolean>;

function WorkspaceHeader({
  ws,
  ctx,
  team,
}: {
  ws: Workspace;
  ctx: TaskActionContext;
  team: { employeeId: string; employeeName: string }[];
}): JSX.Element {
  const inst = ws.instance;
  const filed = inst.workflowStatus === 'filed' || inst.workflowStatus === 'not_applicable';
  const task: WorkTask | null = ws.task
    ? {
        id: ws.task.id,
        engagementId: inst.engagementId,
        title: ws.task.title,
        description: null,
        status: ws.task.status as TaskStatus,
        priority: 'normal' as WorkTask['priority'],
        dueDate: inst.internalDate,
        isOverdue: false,
        blockedByOpenCount: 0,
        assignedToId: ws.task.assigneeId,
        assignedToName: ws.task.assigneeName,
        engagementServiceId: null,
        stream: inst.stream,
        reviewerId: ws.task.reviewerId,
        reviewerName: ws.task.reviewerName,
        workType: null,
        complianceInstanceId: inst.id,
        sentForReviewAt: null,
        reviewStartedAt: ws.task.reviewStartedAt ?? null,
        version: ws.task.version,
      }
    : null;
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold text-ink">{inst.formLabel ?? inst.ruleName}</h4>
        <FilingStatusBadge
          status={inst.workflowStatus}
          isLate={ws.filing?.isLate}
          isOverdue={!filed && inst.daysLeft < 0}
          stream={inst.stream}
          section={inst.section}
          ruleCode={inst.ruleCode}
        />
        {inst.isProvisional && <Badge tone="warn">Provisional dates</Badge>}
        {inst.chargeWindow?.status === 'fee_window' && (
          <Badge tone="warn">
            Late — within the additional-fee window until {formatDate(inst.chargeWindow.feeWindowEnds)}
          </Badge>
        )}
        {inst.chargeWindow?.status === 'beyond_window' && (
          <Badge tone="danger">Beyond the 90-day filing window</Badge>
        )}
        {inst.verify && <Badge tone="warn">Verify rule</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-ink-muted">Period</dt>
          <dd>
            {inst.periodStart && inst.periodEnd
              ? `${formatDate(inst.periodStart)} – ${formatDate(inst.periodEnd)}`
              : (inst.periodKey ?? inst.financialYear ?? '—')}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Statutory date</dt>
          <dd>
            {formatDate(inst.statutoryDueDate)}
            {!filed && <span className={`ml-1 ${dueTone(inst.daysLeft)}`}>({daysLeftText(inst.daysLeft)})</span>}
            {inst.extension && (
              <span className="block text-ink-muted">
                Extended from {formatDate(inst.extension.originalDueDate)} by {inst.extension.reference}
                {inst.extension.notes?.startsWith('Verify') && ' · Verify'}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Internal date</dt>
          <dd>{formatDate(inst.internalDate)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Preparer</dt>
          <dd>{ws.task?.assigneeName ?? 'Unassigned'}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Reviewer</dt>
          <dd>{ws.task?.reviewerName ?? '—'}</dd>
        </div>
        {inst.registrationNumber && (
          <div>
            <dt className="text-ink-muted">Registration</dt>
            <dd className="font-mono">{inst.registrationNumber}</dd>
          </div>
        )}
      </dl>
      {inst.statutoryAudit && (
        <p className="text-xs text-ink-muted">
          We are the statutory auditor:{' '}
          <a className="text-primary-700 underline-offset-2 hover:underline" href={`/engagements/${inst.statutoryAudit.engagementId}`}>
            audit report
          </a>{' '}
          {inst.statutoryAudit.reportDate ? `signed on ${formatDate(inst.statutoryAudit.reportDate)}` : 'not signed yet'}.
        </p>
      )}
      {inst.lateCharges && (!filed || inst.lateCharges.basis !== 'gst') && (
        <p className="text-xs text-danger-700">
          {inst.lateCharges.daysLate} days late{filed ? ' when filed' : ''} — indicative{' '}
          {inst.lateCharges.basis === 'gst' ? 'late fee' : 'additional fee'} {formatMoney(inst.lateCharges.lateFee)}
          {inst.lateCharges.basis === 'per_day' && ' (₹100 a day)'}
          {inst.lateCharges.basis === 'slab' &&
            ` (${inst.lateCharges.multiple}× the normal fee of ${formatMoney(inst.lateCharges.normalFee ?? 0)})`}
          {inst.lateCharges.interest != null && `, interest ${formatMoney(inst.lateCharges.interest)}`}
          {inst.lateCharges.verify && ' · Verify'}. A hint only; nothing is posted.
        </p>
      )}
      {inst.lateFeeNote && <p className="text-xs text-ink-muted">{inst.lateFeeNote}</p>}
      {task && (
        <div data-task-id={task.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2.5 py-1.5">
          <span className="text-xs text-ink-muted">
            Task: <span className="text-ink">{task.title}</span> · {humanize(task.status)}
          </span>
          <TaskActions task={task} ctx={ctx} />
        </div>
      )}
      {!task && !filed && ctx.isLead && ws.can.edit && !inst.isLocked && (
        <AssignWork ws={ws} me={ctx.me} team={team} />
      )}
    </header>
  );
}

/**
 * A filing from the calendar has no task until a lead assigns it: the task is
 * what carries the preparer and reviewer, drives the status and runs the clock.
 */
function AssignWork({
  ws,
  me,
  team,
}: {
  ws: Workspace;
  me: string | null;
  team: { employeeId: string; employeeName: string }[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const inst = ws.instance;
  const [preparer, setPreparer] = useState('');
  const [reviewer, setReviewer] = useState(me ?? '');
  const assign = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${inst.engagementId}/tasks`, {
        method: 'POST',
        body: {
          title: [inst.formLabel ?? inst.ruleName, inst.periodKey ?? inst.financialYear, inst.registrationNumber]
            .filter(Boolean)
            .join(' · '),
          assignedToEmployeeId: preparer,
          ...(reviewer && reviewer !== preparer ? { reviewerEmployeeId: reviewer } : {}),
          ...(inst.internalDate ? { dueDate: inst.internalDate } : {}),
          complianceInstanceId: inst.id,
        },
      }),
    onSuccess: () => {
      toast('Assigned.');
      void qc.invalidateQueries({ queryKey: workspaceKey(inst.id) });
      void qc.invalidateQueries({ queryKey: ['filing', 'tree'] });
    },
    onError: (err) => toast(errText(err, 'Could not assign.'), 'error'),
  });
  return (
    <form
      aria-label="Assign this filing"
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-line px-2.5 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (preparer) assign.mutate();
      }}
    >
      <Field label="Preparer" required>
        <Select value={preparer} onChange={(e) => setPreparer(e.target.value)} required>
          <option value="">Choose…</option>
          {team.map((m) => (
            <option key={m.employeeId} value={m.employeeId}>
              {m.employeeName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reviewer">
        <Select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
          <option value="">No review</option>
          {team.map((m) => (
            <option key={m.employeeId} value={m.employeeId}>
              {m.employeeName}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" size="sm" disabled={!preparer || assign.isPending}>
        Assign
      </Button>
    </form>
  );
}

function Checklist({
  items,
  editable,
  certify,
  busy,
  run,
}: {
  items: ChecklistItem[];
  editable: boolean;
  /** A partner on the engagement: may tick the certification lines (with the UDIN). */
  certify: boolean;
  busy: boolean;
  run: Run;
}): JSX.Element | null {
  const [naFor, setNaFor] = useState<string | null>(null);
  const [udinFor, setUdinFor] = useState<string | null>(null);
  if (items.length === 0) return null;
  const required = items.filter((i) => i.required);
  const done = required.filter((i) => i.status !== 'open').length;
  const patch = (i: ChecklistItem, status: ChecklistItem['status'], naReason?: string, note?: string) =>
    run(
      `/items/${i.id}`,
      { status, version: i.version, ...(naReason ? { naReason } : {}), ...(note ? { note } : {}) },
      status === 'open' ? `${i.label}: reopened.` : `${i.label}: ${status === 'done' ? 'done' : 'not applicable'}.`,
      'PATCH',
    );
  return (
    <section aria-label="Checklist">
      <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Checklist · {done} of {required.length} required done
      </h5>
      <ul className="divide-y divide-line rounded-md border border-line">
        {items.map((i) => (
          <li key={i.id} className="px-2.5 py-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="checkbox"
                aria-label={i.label}
                checked={i.status === 'done'}
                disabled={
                  !editable ||
                  busy ||
                  i.status === 'not_applicable' ||
                  (i.autoTick === 'event' && i.status === 'open') ||
                  (i.tickedBy === 'partner' && !certify)
                }
                onChange={(e) => {
                  // A partner's line takes the UDIN inline before it ticks.
                  if (e.target.checked && i.tickedBy === 'partner') setUdinFor(udinFor === i.id ? null : i.id);
                  else void patch(i, e.target.checked ? 'done' : 'open');
                }}
              />
              <span className={i.status === 'not_applicable' ? 'text-ink-muted line-through' : ''}>{i.label}</span>
              {i.required && <span className="text-[10px] text-danger-600">required</span>}
              {i.tickedBy === 'partner' && <span className="text-[10px] text-primary-700">partner ticks</span>}
              {i.autoTick === 'event' ? (
                <span className="text-[10px] text-ink-muted">ticks when the meeting is recorded</span>
              ) : i.autoTick === 'meetings' ? (
                <span className="text-[10px] text-ink-muted">ticks when the year’s board meetings are recorded</span>
              ) : (
                i.autoTick && <span className="text-[10px] text-ink-muted">auto: {i.autoTick}</span>
              )}
              <span className="ml-auto text-xs text-ink-muted">
                {i.status === 'done' && i.doneByName && `${i.doneByName}, ${formatDate(i.doneAt)}`}
                {i.status === 'done' && i.doneNote && ` · ${i.tickedBy === 'partner' ? 'UDIN ' : ''}${i.doneNote}`}
                {i.status === 'not_applicable' && `N/A — ${i.naReason ?? ''}`}
              </span>
              {editable && i.status === 'open' && (
                <Button size="sm" variant="ghost" onClick={() => setNaFor(naFor === i.id ? null : i.id)}>
                  N/A
                </Button>
              )}
              {editable && i.status === 'not_applicable' && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void patch(i, 'open')}>
                  Undo N/A
                </Button>
              )}
            </div>
            {i.boardMeetings && (
              <p className="mt-0.5 pl-6 text-xs text-ink-muted">{boardMeetingsText(i.boardMeetings)}</p>
            )}
            {udinFor === i.id && i.status === 'open' && (
              <ReasonAction
                label="Tick with UDIN"
                placeholder="UDIN generated for this certificate"
                busy={busy}
                startOpen
                onSubmit={(udin) =>
                  patch(i, 'done', undefined, udin).then((ok) => {
                    if (ok) setUdinFor(null);
                    return ok;
                  })
                }
              />
            )}
            {naFor === i.id && (
              <ReasonAction
                label="Not applicable"
                placeholder="Why this item does not apply"
                busy={busy}
                startOpen
                onSubmit={(reason) =>
                  patch(i, 'not_applicable', reason).then((ok) => {
                    if (ok) setNaFor(null);
                    return ok;
                  })
                }
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Slots({
  ws,
  editable,
  isLead,
  busy,
  run,
  onUploaded,
}: {
  ws: Workspace;
  editable: boolean;
  isLead: boolean;
  busy: boolean;
  run: Run;
  onUploaded: (ws: Workspace) => void;
}): JSX.Element | null {
  if (ws.slots.length === 0) return null;
  return (
    <section aria-label="Documents">
      <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Documents</h5>
      <ul className="divide-y divide-line rounded-md border border-line">
        {ws.slots.map((s) => (
          <SlotRow
            key={s.slotCode}
            slot={s}
            ws={ws}
            item={ws.checklist.find((i) => i.slotCode === s.slotCode) ?? null}
            editable={editable}
            isLead={isLead}
            busy={busy}
            run={run}
            onUploaded={onUploaded}
          />
        ))}
      </ul>
    </section>
  );
}

function SlotRow({
  slot,
  ws,
  item,
  editable,
  isLead,
  busy,
  run,
  onUploaded,
}: {
  slot: WorkspaceSlot;
  ws: Workspace;
  item: ChecklistItem | null;
  editable: boolean;
  isLead: boolean;
  busy: boolean;
  run: Run;
  onUploaded: (ws: Workspace) => void;
}): JSX.Element {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [requestedInfo, setRequestedInfo] = useState('');
  const [escalationDate, setEscalationDate] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [naOpen, setNaOpen] = useState(false);
  const engagementId = ws.instance.engagementId;
  const isNa = item?.status === 'not_applicable';

  async function upload(file: File) {
    setUploading(true);
    try {
      const next = await apiFetch<Workspace>(
        `/compliance-instances/${ws.instance.id}/slots/${encodeURIComponent(slot.slotCode)}/documents`,
        {
          method: 'POST',
          body: {
            filename: file.name,
            contentType: file.type || undefined,
            contentBase64: await blobToBase64(file),
          },
        },
      );
      onUploaded(next);
      toast(`${slot.label}: ${file.name} uploaded.`);
    } catch (err) {
      toast(errText(err, 'Upload failed.'), 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function request(e?: FormEvent) {
    e?.preventDefault();
    try {
      const res = await apiFetch<{ workspace: Workspace; link: UploadLink }>(
        `/compliance-instances/${ws.instance.id}/slots/${encodeURIComponent(slot.slotCode)}/request`,
        {
          method: 'POST',
          body: {
            ...(requestedInfo.trim() ? { requestedInfo: requestedInfo.trim() } : {}),
            ...(escalationDate ? { escalationDate } : {}),
          },
        },
      );
      onUploaded(res.workspace);
      setLink(`${window.location.origin}/client-upload/${res.link.token}`);
      setAsking(false);
      toast('Request raised — share the upload link with the client.');
    } catch (err) {
      toast(errText(err, 'Could not raise the request.'), 'error');
    }
  }

  return (
    <li data-request-id={slot.openRequest?.dependencyId} className="space-y-1.5 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={isNa ? 'text-ink-muted line-through' : 'font-medium'}>{slot.label}</span>
        {slot.required && <span className="text-[10px] text-danger-600">required</span>}
        {slot.openRequest && (
          <Badge tone="warn">
            Requested from client {formatDate(slot.openRequest.requestedAt)}
            {slot.openRequest.escalationDate && ` · escalate ${formatDate(slot.openRequest.escalationDate)}`}
          </Badge>
        )}
        {slot.openRequest && isLead && <ReceivedButton ws={ws} dependencyId={slot.openRequest.dependencyId} />}
        {editable && !isNa && (
          <span className="ml-auto flex flex-wrap gap-1">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              aria-label={`Upload ${slot.label}`}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
            {!slot.openRequest && (
              <Button size="sm" variant="secondary" aria-expanded={asking} onClick={() => setAsking(!asking)}>
                Request from client
              </Button>
            )}
            {slot.openRequest?.hasLink === false && (
              <Button size="sm" variant="secondary" onClick={() => void request()}>
                Create upload link
              </Button>
            )}
            {item && (
              <Button size="sm" variant="ghost" aria-expanded={naOpen} onClick={() => setNaOpen(!naOpen)}>
                N/A
              </Button>
            )}
          </span>
        )}
      </div>
      {slot.documents.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {slot.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="text-primary-700 underline-offset-2 hover:underline"
                onClick={() =>
                  void downloadFile(`/engagements/${engagementId}/documents/${d.id}/download`, d.filename ?? d.title)
                }
              >
                {d.filename ?? d.title}
              </button>
              <span className="text-ink-muted">
                {formatDate(d.uploadedAt)} · {d.fromClient ? 'from client' : (d.uploadedByName ?? '—')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <form className="grid gap-2 sm:grid-cols-[1fr_auto_auto]" onSubmit={(e) => void request(e)}>
          <Input
            value={requestedInfo}
            onChange={(e) => setRequestedInfo(e.target.value)}
            placeholder={`What we need (default: ${slot.label})`}
            aria-label="What we need from the client"
          />
          <Input
            type="date"
            value={escalationDate}
            onChange={(e) => setEscalationDate(e.target.value)}
            aria-label="Escalation date"
          />
          <Button size="sm" type="submit">
            Create link
          </Button>
        </form>
      )}
      {link && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary-50 px-2 py-1 text-xs">
          <span className="truncate font-mono">{link}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(link);
              toast('Link copied.');
            }}
          >
            Copy
          </Button>
        </div>
      )}
      {naOpen && item && (
        <ReasonAction
          label="Not applicable"
          placeholder="Why this document is not needed"
          busy={busy}
          startOpen
          onSubmit={(reason) =>
            run(
              `/items/${item.id}`,
              { status: 'not_applicable', naReason: reason, version: item.version },
              `${slot.label}: not applicable.`,
              'PATCH',
            ).then((ok) => {
              if (ok) setNaOpen(false);
              return ok;
            })
          }
        />
      )}
    </li>
  );
}

/**
 * Client requests with no document slot — the director's DSC (roc-mca
 * Decision 5). The filing shows Awaiting data until each is received.
 */
function ClientRequests({
  ws,
  editable,
  isLead,
  busy,
  run,
}: {
  ws: Workspace;
  editable: boolean;
  isLead: boolean;
  busy: boolean;
  run: Run;
}): JSX.Element | null {
  const inst = ws.instance;
  const open = (ws.clientRequests ?? []).filter((r) => !r.slotCode || r.slotCode === DSC_REQUEST_CODE);
  const canAskDsc =
    editable &&
    inst.stream === 'roc' &&
    !isMeetingRule(inst.ruleCode) &&
    !ws.filing &&
    !open.some((r) => r.slotCode === DSC_REQUEST_CODE);
  if (open.length === 0 && !canAskDsc) return null;
  return (
    <section aria-label="From the client" className="space-y-1">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">From the client</h5>
      {open.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {open.map((r) => (
            <li key={r.dependencyId} data-request-id={r.dependencyId} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
              <span>{r.requestedInfo}</span>
              <Badge tone="warn">
                Requested {formatDate(r.requestedAt)}
                {r.escalationDate && ` · escalate ${formatDate(r.escalationDate)}`}
              </Badge>
              {isLead && <ReceivedButton ws={ws} dependencyId={r.dependencyId} />}
            </li>
          ))}
        </ul>
      )}
      {canAskDsc && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void run('/dsc-request', {}, 'Director’s DSC requested from the client.')}
        >
          Request director’s DSC
        </Button>
      )}
    </section>
  );
}

/** A lead records that the client sent what was asked; the filing leaves Awaiting data. */
function ReceivedButton({ ws, dependencyId }: { ws: Workspace; dependencyId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const inst = ws.instance;
  async function received() {
    setSaving(true);
    try {
      await apiFetch(`/engagements/${inst.engagementId}/client-dependencies/${dependencyId}/receive`, {
        method: 'POST',
        body: { fully: true },
      });
      await qc.invalidateQueries({ queryKey: workspaceKey(inst.id) });
      void qc.invalidateQueries({ queryKey: ['filing', 'tree'] });
      toast('Marked received.');
    } catch (err) {
      toast(errText(err, 'Could not mark it received.'), 'error');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Button size="sm" variant="ghost" disabled={saving} onClick={() => void received()}>
      Received
    </Button>
  );
}

/** Figure inputs keyed by field, as strings for the form. */
function figureState(schema: FigureField[], figures: Workspace['figures']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of schema) out[f.key] = figures[f.key] == null ? '' : String(figures[f.key]);
  return out;
}

/** Form strings → API figures (numbers for amount/integer, null when blank). */
export function figurePayload(
  schema: FigureField[],
  values: Record<string, string>,
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const f of schema) {
    const raw = (values[f.key] ?? '').trim();
    if (raw === '') out[f.key] = null;
    else if (f.kind === 'amount' || f.kind === 'integer') {
      const n = Number(raw.replace(/,/g, ''));
      out[f.key] = Number.isFinite(n) ? n : raw;
    } else out[f.key] = raw;
  }
  return out;
}

function Figures({
  ws,
  editable,
  busy,
  run,
}: {
  ws: Workspace;
  editable: boolean;
  busy: boolean;
  run: Run;
}): JSX.Element {
  const [values, setValues] = useState(() => figureState(ws.figureSchema, ws.figures));
  useEffect(() => setValues(figureState(ws.figureSchema, ws.figures)), [ws.figureSchema, ws.figures]);
  const groups = useMemo(() => {
    const m = new Map<string, FigureField[]>();
    for (const f of ws.figureSchema) {
      const g = f.group ?? '';
      m.set(g, [...(m.get(g) ?? []), f]);
    }
    return [...m.entries()];
  }, [ws.figureSchema]);
  return (
    <section aria-label="Figures">
      <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Figures{ws.figuresRequiredToLodge ? ' · needed to lodge' : ''}
      </h5>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            '/figures',
            { figures: figurePayload(ws.figureSchema, values), version: ws.figuresVersion },
            'Figures saved.',
            'PUT',
          );
        }}
      >
        {groups.map(([group, fields]) => (
          <fieldset key={group || 'main'} className="space-y-1">
            {group && <legend className="text-xs font-medium text-ink-muted">{group}</legend>}
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {fields.map((f) => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Input
                    type={f.kind === 'date' ? 'date' : 'text'}
                    inputMode={f.kind === 'amount' || f.kind === 'integer' ? 'decimal' : undefined}
                    value={values[f.key] ?? ''}
                    disabled={!editable}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        ))}
        {editable && (
          <Button size="sm" type="submit" disabled={busy}>
            Save figures
          </Button>
        )}
      </form>
    </section>
  );
}

/** Client-side check of the reference (GST ARN: 15 upper-case letters/digits). Pure — tested. */
export function referenceError(kind: FilingReferenceKind, no: string): string | null {
  const v = no.trim();
  if (!v) return 'Enter the reference number.';
  if (kind === 'arn' && !/^[A-Z0-9]{15}$/.test(v)) return 'An ARN is 15 upper-case letters and digits.';
  return null;
}

function LodgeForm({
  ws,
  busy,
  run,
  team,
  me,
  onUploaded,
}: {
  ws: Workspace;
  busy: boolean;
  run: Run;
  team: { employeeId: string; employeeName: string }[];
  me: string | null;
  onUploaded: (ws: Workspace) => void;
}): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [filedBy, setFiledBy] = useState(me ?? '');
  const [uploading, setUploading] = useState(false);
  const ackSlot = ws.slots.find((sl) => sl.slotCode.startsWith('ACK')) ?? null;
  const end = filingEnd(ws.instance.stream, ws.instance.section, ws.instance.ruleCode);
  // A meeting closes with a held-on date in its period and the minutes; no SRN.
  const meeting = isMeetingRule(ws.instance.ruleCode);
  const agm = ws.instance.ruleCode === 'ROC_AGM' || ws.instance.ruleCode === 'ROC_FIRST_AGM';
  const [auditorAppointed, setAuditorAppointed] = useState(false);
  const [normalFeePaid, setNormalFeePaid] = useState('');
  const [referenceKind, setReferenceKind] = useState<FilingReferenceKind>(
    end.done !== 'Filed'
      ? 'internal'
      : ws.instance.stream === 'roc'
        ? 'srn'
        : ws.instance.stream === 'gst'
          ? 'arn'
          : 'ack',
  );
  const [referenceNo, setReferenceNo] = useState('');
  const [filedOn, setFiledOn] = useState(() => {
    // A meeting is held in its period: default to the period end if that is past.
    const periodEnd = ws.instance.periodEnd;
    return meeting && periodEnd && periodEnd < today() ? periodEnd : today();
  });
  const [isNil, setIsNil] = useState(false);
  const [lateFeePaid, setLateFeePaid] = useState('');
  const [interestPaid, setInterestPaid] = useState('');
  const [remarks, setRemarks] = useState('');
  // The acknowledgement must already be in a slot; ACK-slots first.
  const docs = useMemo(
    () =>
      [...ws.slots]
        .sort((a, b) => Number(b.slotCode.startsWith('ACK')) - Number(a.slotCode.startsWith('ACK')))
        .flatMap((s) => s.documents.map((d) => ({ id: d.id, label: `${s.label}: ${d.filename ?? d.title}` }))),
    [ws.slots],
  );
  const [ackDocumentId, setAckDocumentId] = useState('');
  useEffect(() => {
    if (!docs.some((d) => d.id === ackDocumentId)) setAckDocumentId(docs[0]?.id ?? '');
  }, [docs, ackDocumentId]);

  async function uploadAck(file: File) {
    if (!ackSlot) return;
    setUploading(true);
    try {
      const before = new Set(ackSlot.documents.map((d) => d.id));
      const next = await apiFetch<Workspace>(
        `/compliance-instances/${ws.instance.id}/slots/${encodeURIComponent(ackSlot.slotCode)}/documents`,
        {
          method: 'POST',
          body: { filename: file.name, contentType: file.type || undefined, contentBase64: await blobToBase64(file) },
        },
      );
      onUploaded(next);
      const added = next.slots
        .find((sl) => sl.slotCode === ackSlot.slotCode)
        ?.documents.find((d) => !before.has(d.id));
      if (added) setAckDocumentId(added.id);
      toast('Acknowledgement uploaded.');
    } catch (err) {
      toast(errText(err, 'Upload failed.'), 'error');
    } finally {
      setUploading(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} aria-expanded={false}>
        {end.action}
      </Button>
    );
  }
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const refErr = referenceNo ? referenceError(referenceKind, referenceNo) : null;
  const people = team;
  return (
    <form
      aria-label="Lodge filing"
      className="space-y-2 rounded-md border border-primary-600/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          '/lodge',
          {
            referenceKind,
            ...(referenceNo.trim() || !meeting ? { referenceNo: referenceNo.trim() } : {}),
            filedOn,
            ...(meeting ? {} : { isNil }),
            ...(agm ? { auditorAppointed } : {}),
            ...(num(normalFeePaid) != null ? { normalFeePaid: num(normalFeePaid) } : {}),
            ackDocumentId,
            ...(filedBy && filedBy !== me ? { filedByEmployeeId: filedBy } : {}),
            ...(ws.figureSchema.length ? { figures: figurePayload(ws.figureSchema, figureState(ws.figureSchema, ws.figures)) } : {}),
            ...(num(lateFeePaid) != null ? { lateFeePaid: num(lateFeePaid) } : {}),
            ...(num(interestPaid) != null ? { interestPaid: num(interestPaid) } : {}),
            ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
          },
          end.done === 'Filed' ? 'Filing lodged.' : `${end.done}.`,
        ).then((ok) => ok && setOpen(false));
      }}
    >
      <h5 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {meeting ? 'Record meeting' : 'Lodge'}
      </h5>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Reference type">
          <Select value={referenceKind} onChange={(e) => setReferenceKind(e.target.value as FilingReferenceKind)}>
            {FILING_REFERENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {REFERENCE_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Reference no."
          required={!meeting}
          hint={meeting && !referenceNo ? `Defaults to MTG-${filedOn}.` : undefined}
        >
          <Input
            value={referenceNo}
            onChange={(e) =>
              setReferenceNo(referenceKind === 'arn' ? e.target.value.toUpperCase() : e.target.value)
            }
            maxLength={referenceKind === 'arn' ? 15 : 60}
            aria-invalid={!!refErr}
            required={!meeting}
          />
          {refErr && <span className="mt-1 block text-xs text-danger-700">{refErr}</span>}
        </Field>
        <Field label={meeting ? 'Held on' : 'Filed on'} required>
          <Input
            type="date"
            value={filedOn}
            min={(meeting ? ws.instance.periodStart : ws.instance.periodEnd) ?? undefined}
            max={today()}
            onChange={(e) => setFiledOn(e.target.value)}
            required
          />
        </Field>
        {people.length > 0 && (
          <Field label="Filed by">
            <Select value={filedBy} onChange={(e) => setFiledBy(e.target.value)}>
              {!people.some((m) => m.employeeId === me) && <option value={me ?? ''}>Me</option>}
              {people.map((m) => (
                <option key={m.employeeId} value={m.employeeId}>
                  {m.employeeId === me ? `${m.employeeName} (me)` : m.employeeName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label={meeting ? 'Minutes' : 'Acknowledgement'}
          required
          hint={docs.length ? undefined : meeting ? 'Upload the minutes.' : 'Upload the acknowledgement.'}
        >
          <Select value={ackDocumentId} onChange={(e) => setAckDocumentId(e.target.value)} required>
            {docs.length === 0 && <option value="">No documents yet</option>}
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
          {ackSlot && (
            <input
              type="file"
              className="mt-1 block text-xs"
              aria-label="Upload acknowledgement"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAck(f);
                e.target.value = '';
              }}
            />
          )}
        </Field>
        {!meeting && ws.instance.stream === 'roc' && (
          <Field label="Normal fee paid">
            <Input inputMode="decimal" value={normalFeePaid} onChange={(e) => setNormalFeePaid(e.target.value)} />
          </Field>
        )}
        {!meeting && (
          <Field label={ws.instance.stream === 'roc' ? 'Additional fee paid' : 'Late fee paid'}>
            <Input inputMode="decimal" value={lateFeePaid} onChange={(e) => setLateFeePaid(e.target.value)} />
          </Field>
        )}
        {!meeting && ws.instance.stream !== 'roc' && (
          <Field label="Interest paid">
            <Input inputMode="decimal" value={interestPaid} onChange={(e) => setInterestPaid(e.target.value)} />
          </Field>
        )}
        {!meeting && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={isNil} onChange={(e) => setIsNil(e.target.checked)} /> Nil return
          </label>
        )}
        {agm && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={auditorAppointed}
              onChange={(e) => setAuditorAppointed(e.target.checked)}
            />{' '}
            Auditor appointed or re-appointed at this AGM (ADT-1 follows)
          </label>
        )}
      </div>
      <Field label="Remarks">
        <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy || uploading || !!refErr || (!meeting && !referenceNo.trim()) || !ackDocumentId}
        >
          {meeting ? 'Record meeting' : 'Lodge'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function FiledRecord({
  filing,
  end,
  canUndo,
  busy,
  run,
  engagementId,
}: {
  filing: FilingRecordView;
  end: { done: string };
  canUndo: boolean;
  busy: boolean;
  run: Run;
  engagementId: string;
}): JSX.Element {
  return (
    <section aria-label="Filed" className="space-y-1 rounded-md border border-success-500/30 bg-success-50/50 p-2.5 text-xs">
      <p className="text-sm font-medium text-success-700">
        {end.done} {formatDate(filing.filedOn)} · {REFERENCE_LABEL[filing.referenceKind]}{' '}
        <span className="font-mono">{filing.referenceNo}</span>
        {filing.isNil && ' · Nil'}
        {filing.isLate && <Badge tone="warn" className="ml-2">{end.done} late</Badge>}
      </p>
      <p className="text-ink-muted">
        By {filing.filedByName ?? '—'} · recorded {formatDate(filing.recordedAt)}
        {filing.normalFeePaid != null && ` · fee ${formatMoney(filing.normalFeePaid)}`}
        {filing.lateFeePaid != null && ` · late fee ${formatMoney(filing.lateFeePaid)}`}
        {filing.interestPaid != null && ` · interest ${formatMoney(filing.interestPaid)}`}
      </p>
      {filing.remarks && <p>{filing.remarks}</p>}
      <button
        type="button"
        className="text-primary-700 underline-offset-2 hover:underline"
        onClick={() =>
          void downloadFile(`/engagements/${engagementId}/documents/${filing.ackDocumentId}/download`, 'acknowledgement')
        }
      >
        Acknowledgement
      </button>
      {canUndo && (
        <ReasonAction
          label="Undo lodge"
          placeholder="Why the lodgement is being undone"
          busy={busy}
          onSubmit={(reason) => run('/lodge/undo', { reason }, 'Lodgement undone.')}
        />
      )}
    </section>
  );
}

function Corrections({
  ws,
  targets,
  busy,
  run,
}: {
  ws: Workspace;
  targets: { id: string; label: string }[];
  busy: boolean;
  run: Run;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState('');
  if (!ws.filing && ws.corrections.length === 0) return null;
  return (
    <section aria-label="Corrections" className="space-y-1">
      <div className="flex items-center gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Corrections</h5>
        {ws.filing && ws.can.edit && (
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? '−' : '+'} Record a correction
          </Button>
        )}
      </div>
      {ws.corrections.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {ws.corrections.map((c) => (
            <li key={c.id}>
              {formatDate(c.createdAt)} · {c.createdByName ?? '—'}: {c.note}
              {c.correctedInLabel && <span className="text-ink-muted"> — corrected in {c.correctedInLabel}</span>}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              '/corrections',
              { note: note.trim(), ...(target ? { correctedInInstanceId: target } : {}) },
              'Correction recorded.',
            ).then((ok) => {
              if (ok) {
                setOpen(false);
                setNote('');
                setTarget('');
              }
            });
          }}
        >
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was wrong and how it is corrected"
            aria-label="Correction note"
          />
          <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Corrected in">
            <option value="">Corrected in — not yet</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
          <Button size="sm" type="submit" disabled={busy || !note.trim()}>
            Save
          </Button>
        </form>
      )}
    </section>
  );
}

/** A button that opens a one-line reason input in place (never a pop-up). */
function ReasonAction({
  label,
  placeholder,
  busy,
  startOpen = false,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  busy: boolean;
  startOpen?: boolean;
  onSubmit: (reason: string) => Promise<boolean>;
}): JSX.Element {
  const [open, setOpen] = useState(startOpen);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button size="sm" variant="secondary" aria-expanded={false} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form
      className="mt-1 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        void onSubmit(reason.trim()).then((ok) => {
          if (ok) {
            setReason('');
            if (!startOpen) setOpen(false);
          }
        });
      }}
    >
      <Input
        autoFocus
        className="min-w-[16rem] flex-1"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <Button size="sm" type="submit" disabled={busy || !reason.trim()}>
        {label}
      </Button>
      {!startOpen && (
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      )}
    </form>
  );
}
