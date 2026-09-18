'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2, AlertTriangle } from 'lucide-react';
import {
  PBC_STATUS,
  PERMISSION,
  type AuditPbcItem,
  type PbcStatus,
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

/**
 * PBC — Master Client Information Tracker (Audit Spec §16). One master list per
 * audit file: each request carries its requirement, client owner, agreed due
 * date, professional status and an optional linked work area. The tracker is
 * populated once Planning is approved (§7, workflow step 13). A received file is
 * surfaced in the linked area by reference — it is never re-uploaded (§16).
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

  const query = useQuery({
    queryKey: PBC_QK(engagementId),
    queryFn: () => apiFetch<StatutoryAuditPbc[]>(`/engagements/${engagementId}/statutory-audit/pbc`),
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

  if (query.isLoading) return <Spinner label="Loading PBC tracker…" />;
  const tracker = query.data?.[0];
  if (!tracker) return null;

  if (!tracker.planningApproved) {
    return (
      <Card className="p-5">
        <p className="inline-flex items-center gap-2 text-sm text-ink-muted">
          <Lock className="h-4 w-4" />
          Approve Planning (Phase 03) to populate the PBC tracker.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
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
          <Button onClick={() => setAdding((a) => !a)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add request
          </Button>
        )}
      </Card>

      {adding && canManage && (
        <PbcForm
          areas={areas}
          submitLabel="Add request"
          pending={create.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(d) => create.mutate(d)}
        />
      )}

      {tracker.items.length === 0 && !adding && (
        <Card className="p-5">
          <EmptyState>
            No client information requested yet. Add the requirements the client must supply.
          </EmptyState>
        </Card>
      )}

      {tracker.items.map((item) => (
        <PbcCard
          key={item.id}
          engagementId={engagementId}
          item={item}
          areas={areas}
          canManage={canManage}
          onChanged={invalidate}
        />
      ))}
    </div>
  );
}

type AreaOption = { id: string; title: string };

function PbcCard({
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
  const [editing, setEditing] = useState(false);

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
      toast(e instanceof ApiError ? e.message : 'Could not change status. Rejecting needs a reason.'),
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

  if (editing) {
    return (
      <PbcForm
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
    );
  }

  return (
    <Card className="p-4">
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
    </Card>
  );
}

function PbcForm({
  areas,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
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

  return (
    <Card className="space-y-3 p-4">
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
          <Input type="date" value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
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
    </Card>
  );
}
