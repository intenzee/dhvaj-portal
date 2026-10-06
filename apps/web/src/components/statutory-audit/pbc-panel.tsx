'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Inbox,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import {
  PBC_OUTSTANDING_STATUSES,
  PBC_STATUS,
  PERMISSION,
  type AuditPbcItem,
  type PbcChaseGroup,
  type PbcStatus,
  type PbcSuggestionResult,
  type StatutoryAuditPbc,
  type StatutoryAuditWorkGeneration,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize, formatDate } from '@/lib/format';
import { Card, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle, InlinePanel } from '@/components/inline-panel';

/**
 * PBC — Master Client Information Tracker (Audit Spec §16). One master list per
 * audit file: each request carries its requirement, client owner, agreed due
 * date, professional status and an optional linked work area. A received file
 * is surfaced in the linked area by reference — it is never re-uploaded (§16).
 *
 * The tracker builds itself once Planning is approved: the standard list from
 * the client master, requests for the 03.5 areas and Section 04 risks, the
 * completion-stage asks and last year's custom requests — each owned, linked
 * and dated. "Chase the client" drafts one reminder per client contact for
 * overdue and due-soon requests.
 *
 * The tracker is a compact list; a request's detail, status, edit form and
 * removal open in a pop-up, as does adding a request.
 */

const STATUS_TONE: Record<PbcStatus, string> = {
  requested: 'neutral',
  received: 'info',
  under_review: 'info',
  accepted: 'success',
  rejected: 'danger',
  clarification_required: 'warn',
  closed: 'neutral',
};

const PBC_QK = (id: string) => ['engagement', id, 'statutory-audit-pbc'];

type PbcFilter = 'all' | 'outstanding' | 'overdue' | 'review';

const FILTERS: Array<[PbcFilter, string]> = [
  ['all', 'All'],
  ['outstanding', 'Client owes'],
  ['overdue', 'Overdue'],
  ['review', 'To review'],
];

function matches(item: AuditPbcItem, filter: PbcFilter): boolean {
  if (filter === 'outstanding') return PBC_OUTSTANDING_STATUSES.includes(item.status);
  if (filter === 'overdue') return item.isOverdue;
  if (filter === 'review') return item.status === 'received' || item.status === 'under_review';
  return true;
}

interface PbcDraft {
  requirement: string;
  clientOwner: string;
  workAreaId: string;
  status: PbcStatus;
  rejectionReason: string;
  requestedDate: string;
  dueDate: string;
  receivedDate: string;
  note: string;
}

const EMPTY_DRAFT: PbcDraft = {
  requirement: '',
  clientOwner: '',
  workAreaId: '',
  status: PBC_STATUS.requested,
  rejectionReason: '',
  requestedDate: '',
  dueDate: '',
  receivedDate: '',
  note: '',
};

// Create: empty optional fields are omitted so inserts take defaults.
function draftToBody(d: PbcDraft) {
  return {
    requirement: d.requirement,
    clientOwner: d.clientOwner || undefined,
    workAreaId: d.workAreaId || undefined,
    status: d.status,
    rejectionReason: d.rejectionReason || undefined,
    requestedDate: d.requestedDate || undefined,
    dueDate: d.dueDate || undefined,
    receivedDate: d.receivedDate || undefined,
    note: d.note || undefined,
  };
}

// Update: a cleared nullable field is sent as explicit null (the API leaves
// undefined fields unchanged). Dates are set-only (omit to leave unchanged).
function draftToUpdateBody(d: PbcDraft) {
  return {
    requirement: d.requirement,
    clientOwner: d.clientOwner.trim() || null,
    workAreaId: d.workAreaId || null,
    status: d.status,
    rejectionReason: d.rejectionReason.trim() || null,
    requestedDate: d.requestedDate || undefined,
    dueDate: d.dueDate || undefined,
    receivedDate: d.receivedDate || undefined,
    note: d.note.trim() || null,
  };
}

export function PbcPanel({ engagementId }: { engagementId: string }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<PbcFilter>('all');

  const query = useQuery({
    queryKey: PBC_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditPbc[]>(`/engagements/${engagementId}/statutory-audit/pbc`),
  });

  // Work areas populate the "Linked work" select (§16 LINKED WORK).
  const areasQuery = useQuery({
    queryKey: ['engagement', engagementId, 'statutory-audit-work'],
    queryFn: () =>
      apiFetch<StatutoryAuditWorkGeneration[]>(
        `/engagements/${engagementId}/statutory-audit/work-areas`,
      ),
  });
  const areas = (areasQuery.data?.[0]?.areas ?? []).filter((a) => a.isActive);

  const invalidate = () => void qc.invalidateQueries({ queryKey: PBC_QK(engagementId) });

  const create = useMutation({
    mutationFn: (draft: PbcDraft) =>
      apiFetch(
        `/engagements/${engagementId}/statutory-audit/${query.data![0]!.workflowInstanceId}/pbc`,
        { method: 'POST', body: draftToBody(draft) },
      ),
    onSuccess: () => {
      toast('PBC request added.');
      setAdding(false);
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not add PBC request.'),
  });

  const refresh = useMutation({
    mutationFn: () =>
      apiFetch<PbcSuggestionResult>(
        `/engagements/${engagementId}/statutory-audit/${query.data![0]!.workflowInstanceId}/pbc/suggest`,
        { method: 'POST', body: {} },
      ),
    onSuccess: (res) => {
      const parts = [
        res.added > 0 && `added ${res.added} request(s)`,
        res.filled > 0 && `filled ${res.filled} blank field(s)`,
      ].filter(Boolean);
      toast(
        parts.length > 0
          ? `${parts.join(' and ').replace(/^./, (c) => c.toUpperCase())}.`
          : 'The tracker is up to date with the file.',
      );
      invalidate();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not refresh the suggested requests.'),
  });

  if (query.isLoading) return <Spinner label="Loading PBC tracker…" />;
  const tracker = query.data?.[0];
  if (!tracker) return null;

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">PBC — Client Information Tracker</h2>
            <p className="text-xs text-ink-muted">
              {tracker.items.length} request(s)
              {tracker.overdueCount > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 text-danger-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {tracker.overdueCount} overdue
                </span>
              )}
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                title="Adds what the file now calls for and fills blank owners, areas and due dates"
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Refresh suggested requests
              </Button>
              <Button onClick={() => setAdding(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add request
              </Button>
            </div>
          )}
        </div>
        {tracker.items.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter requests">
            {FILTERS.map(([key, label]) => {
              const n = tracker.items.filter((i) => matches(i, key)).length;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    filter === key
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-line text-ink-muted hover:bg-surface-sunken'
                  }`}
                >
                  {label} · {n}
                </button>
              );
            })}
            {(tracker.summary?.dueSoon ?? 0) > 0 && (
              <span className="self-center text-xs text-warning-700">
                {tracker.summary?.dueSoon} due in the next few days
              </span>
            )}
          </div>
        )}
      </Card>

      {/* Older API builds send no chase list. */}
      {(tracker.chase ?? []).length > 0 && (
        <ChaseCard
          engagementId={engagementId}
          workflowInstanceId={tracker.workflowInstanceId}
          groups={tracker.chase}
          canManage={canManage}
          onChanged={invalidate}
        />
      )}

      <InlinePanel
        open={adding && canManage}
        onClose={() => setAdding(false)}
        title="Add PBC request"
        description="PBC — Client Information Tracker"
        size="lg"
      >
        <PbcForm
          plain
          areas={areas}
          submitLabel="Add request"
          pending={create.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(d) => create.mutate(d)}
        />
      </InlinePanel>

      {tracker.items.length === 0 && (
        <Card className="p-5">
          <EmptyState>
            {tracker.planningApproved
              ? 'No client information requested yet. Use “Refresh suggested requests” to build the list from the file, or add a requirement yourself.'
              : 'The tracker builds itself from the file once Planning is approved. You can add a requirement yourself before then.'}
          </EmptyState>
        </Card>
      )}

      {tracker.items.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-line">
            {tracker.items.filter((i) => matches(i, filter)).map((item) => (
              <PbcRow
                key={item.id}
                engagementId={engagementId}
                item={item}
                areas={areas}
                canManage={canManage}
                onChanged={invalidate}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type AreaOption = { id: string; title: string };

/** The one next step for a request, offered as a single button. */
const QUICK: Partial<Record<PbcStatus, { to: PbcStatus; label: string }>> = {
  requested: { to: 'received', label: 'Mark received' },
  clarification_required: { to: 'received', label: 'Mark received' },
  rejected: { to: 'received', label: 'Revised copy received' },
  received: { to: 'accepted', label: 'Accept' },
  under_review: { to: 'accepted', label: 'Accept' },
};

/**
 * Chase the client: one drafted reminder per client contact for their overdue
 * and due-soon requests — open it in the mail app, copy it, then record that
 * the client was chased.
 */
function ChaseCard({
  engagementId,
  workflowInstanceId,
  groups,
  canManage,
  onChanged,
}: {
  engagementId: string;
  workflowInstanceId: string;
  groups: PbcChaseGroup[];
  canManage: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const chased = useMutation({
    mutationFn: (pbcIds: string[]) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/pbc/chased`, {
        method: 'POST',
        body: { pbcIds },
      }),
    onSuccess: () => {
      toast('Recorded — client chased today.');
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not record the reminder.'),
  });
  const copy = (g: PbcChaseGroup): void => {
    void navigator.clipboard
      ?.writeText(`Subject: ${g.subject}\n\n${g.body}`)
      .then(() => toast('Reminder copied.'))
      .catch(() => toast('Could not copy — select the text instead.'));
  };
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-line bg-surface-raised/60 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Chase the client
        </span>
        <span className="text-xs text-ink-muted">{groups.length} contact(s) to remind</span>
      </div>
      <ul className="divide-y divide-line">
        {groups.map((g) => (
          <li key={g.owner} className="space-y-1.5 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">{g.owner}</span>
              {g.email && <span className="text-xs text-ink-muted">{g.email}</span>}
              {g.overdue > 0 && <Badge tone="danger">{g.overdue} overdue</Badge>}
              {g.lastChasedOn && (
                <span className="text-[11px] text-ink-faint">
                  Last chased {formatDate(g.lastChasedOn)}
                </span>
              )}
            </div>
            <ul className="space-y-0.5 text-xs text-ink-muted">
              {g.lines.map((l) => (
                <li key={l}>• {l}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              {g.email && (
                <a
                  href={`mailto:${g.email}?subject=${encodeURIComponent(g.subject)}&body=${encodeURIComponent(g.body)}`}
                  className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-primary-600 hover:bg-surface-sunken"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Email draft
                </a>
              )}
              <Button variant="secondary" size="sm" onClick={() => copy(g)}>
                <Copy className="mr-1 h-3.5 w-3.5" />
                Copy
              </Button>
              {canManage && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={chased.isPending}
                  onClick={() => chased.mutate(g.pbcIds)}
                >
                  <Send className="mr-1 h-3.5 w-3.5" />
                  Mark chased
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PbcRow({
  engagementId,
  item,
  areas,
  canManage,
  onChanged,
}: {
  engagementId: string;
  item: AuditPbcItem;
  areas: AreaOption[];
  canManage: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const close = () => {
    setOpen(false);
    setEditing(false);
  };

  const update = useMutation({
    mutationFn: (draft: PbcDraft) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/pbc/${item.id}`, {
        method: 'POST',
        body: { ...draftToUpdateBody(draft), version: item.version },
      }),
    onSuccess: () => {
      toast(`${item.pbcRef}: updated.`);
      setEditing(false);
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not update request.'),
  });

  const setStatus = useMutation({
    mutationFn: (status: PbcStatus) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/pbc/${item.id}/status`, {
        method: 'POST',
        body: { status, version: item.version },
      }),
    onSuccess: () => onChanged(),
    onError: (e) =>
      toast(
        e instanceof ApiError ? e.message : 'Could not change status. Rejecting needs a reason.',
      ),
  });

  const remove = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/pbc/${item.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast(`${item.pbcRef}: removed.`);
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not remove request.'),
  });

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-sunken"
      >
        <ExpandToggle open={open} />
        <span className="w-16 shrink-0 font-mono text-xs text-ink-faint">{item.pbcRef}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{item.requirement}</span>
          <span className="block truncate text-[11px] text-ink-muted">
            {[
              item.clientOwner,
              item.workAreaTitle,
              item.dueDate && `Due ${formatDate(item.dueDate)}`,
              item.lastChasedOn && `Chased ${formatDate(item.lastChasedOn)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {item.isOverdue && <Badge tone="danger">Overdue</Badge>}
          <Badge tone={STATUS_TONE[item.status]}>{humanize(item.status)}</Badge>
        </span>
      </button>

      <InlinePanel
        className="mx-4 mb-3"
        open={open}
        onClose={close}
        title={`${item.pbcRef} · ${editing ? 'Edit request' : 'PBC request'}`}
        description="PBC — Client Information Tracker"
        size="lg"
      >
        {editing ? (
          <PbcForm
            plain
            areas={areas}
            initial={{
              requirement: item.requirement,
              clientOwner: item.clientOwner ?? '',
              workAreaId: item.workAreaId ?? '',
              status: item.status,
              rejectionReason: item.rejectionReason ?? '',
              requestedDate: item.requestedDate ?? '',
              dueDate: item.dueDate ?? '',
              receivedDate: item.receivedDate ?? '',
              note: item.note ?? '',
            }}
            submitLabel="Save"
            pending={update.isPending}
            onCancel={() => setEditing(false)}
            onSubmit={(d) => update.mutate(d)}
          />
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-faint">{item.pbcRef}</span>
                <Badge tone={STATUS_TONE[item.status]}>{humanize(item.status)}</Badge>
                {item.isOverdue && (
                  <Badge tone="danger">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    Overdue
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 text-sm text-ink">{item.requirement}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {item.clientOwner && `Owner: ${item.clientOwner}`}
                {item.workAreaTitle && ` · Linked: ${item.workAreaTitle}`}
                {item.dueDate && ` · Due ${formatDate(item.dueDate)}`}
                {item.receivedDate && ` · Received ${formatDate(item.receivedDate)}`}
              </p>
              {item.documentTitle && (
                <p className="mt-1 text-xs text-ink-muted">
                  <span className="font-semibold text-ink">File:</span> {item.documentTitle}
                </p>
              )}
              {item.status === PBC_STATUS.rejected && item.rejectionReason && (
                <p className="mt-1 text-xs text-danger-600">
                  <span className="font-semibold">Rejected:</span> {item.rejectionReason}
                </p>
              )}
              {item.note && <p className="mt-1 text-xs text-ink-muted">{item.note}</p>}
              {item.sourceNote && (
                <p className="mt-1 text-[11px] text-ink-faint">Suggested from: {item.sourceNote}</p>
              )}
              {canManage && QUICK[item.status] && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate(QUICK[item.status]!.to)}
                >
                  {QUICK[item.status]!.to === 'accepted' ? (
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                  ) : (
                    <Inbox className="mr-1 h-4 w-4" />
                  )}
                  {QUICK[item.status]!.label}
                </Button>
              )}
            </div>
            {canManage && (
              <div className="flex shrink-0 items-center gap-2">
                <Select
                  value={item.status}
                  disabled={setStatus.isPending}
                  onChange={(e) => setStatus.mutate(e.target.value as PbcStatus)}
                  className="h-8"
                  title="Change status"
                >
                  {Object.values(PBC_STATUS).map((s) => (
                    <option key={s} value={s}>
                      {humanize(s)}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <button
                  type="button"
                  onClick={() => remove.mutate()}
                  className="text-ink-faint hover:text-danger-600"
                  title="Remove request"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </InlinePanel>
    </li>
  );
}

function PbcForm({
  areas,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  plain,
}: {
  /** Render without its card (inside a pop-up). */
  plain?: boolean;
  areas: AreaOption[];
  initial?: PbcDraft;
  submitLabel: string;
  pending: boolean;
  onSubmit: (draft: PbcDraft) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<PbcDraft>(initial ?? EMPTY_DRAFT);
  const set = <K extends keyof PbcDraft>(k: K, v: PbcDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const rejectedNeedsReason =
    draft.status === PBC_STATUS.rejected && draft.rejectionReason.trim().length === 0;
  const Wrapper = plain ? 'div' : Card;

  return (
    <Wrapper className={plain ? 'space-y-3' : 'space-y-3 p-4'}>
      <Field label="Requirement" required>
        <Textarea
          rows={2}
          value={draft.requirement}
          placeholder="e.g. Trial Balance, Debtor Ageing…"
          onChange={(e) => set('requirement', e.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client owner">
          <Input
            placeholder="e.g. Finance"
            value={draft.clientOwner}
            onChange={(e) => set('clientOwner', e.target.value)}
          />
        </Field>
        <Field label="Linked work area">
          <Select value={draft.workAreaId} onChange={(e) => set('workAreaId', e.target.value)}>
            <option value="">—</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={draft.status} onChange={(e) => set('status', e.target.value as PbcStatus)}>
            {Object.values(PBC_STATUS).map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Requested date">
          <Input
            type="date"
            value={draft.requestedDate}
            onChange={(e) => set('requestedDate', e.target.value)}
          />
        </Field>
        <Field label="Due date">
          <Input
            type="date"
            value={draft.dueDate}
            onChange={(e) => set('dueDate', e.target.value)}
          />
        </Field>
        <Field label="Received date">
          <Input
            type="date"
            value={draft.receivedDate}
            onChange={(e) => set('receivedDate', e.target.value)}
          />
        </Field>
      </div>
      {draft.status === PBC_STATUS.rejected && (
        <Field label="Rejection reason" required>
          <Textarea
            rows={2}
            value={draft.rejectionReason}
            placeholder="Why the information is not usable…"
            onChange={(e) => set('rejectionReason', e.target.value)}
          />
        </Field>
      )}
      <Field label="Note">
        <Textarea rows={2} value={draft.note} onChange={(e) => set('note', e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          onClick={() => onSubmit(draft)}
          disabled={pending || draft.requirement.trim().length === 0 || rejectedNeedsReason}
        >
          {submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </Wrapper>
  );
}
