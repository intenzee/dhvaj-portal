'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditMatterRecord,
  MatterSection,
  MatterStatus,
  Paginated,
  UpdateMatterInput,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import type { EmployeeRow } from '@/lib/types';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { openAuditPhase } from './audit-file-nav';

const OPEN: MatterStatus[] = ['open', 'under_review', 'blocking'];

/**
 * A section's matters, raised by the file (an adverse acceptance answer, a
 * framework override or missing figure). Each is resolved where it is shown —
 * the basis is drafted from what the answer or area already records, so
 * accepting it is one step. Anchored as `<section>-matters` for "Go to" links.
 *
 * Section 01 matters (spec §11) carry the register's fields: a description
 * the team can edit, the action / safeguard, an owner (the Engagement
 * Manager until changed) and a due date, with a link back to the question
 * that raised them.
 */
export function MattersCard({
  engagementId,
  workflowInstanceId,
  section,
  canManage,
}: {
  engagementId: string;
  workflowInstanceId: string;
  section: MatterSection;
  canManage: boolean;
}): JSX.Element | null {
  const query = useQuery({
    queryKey: ['engagement', engagementId, 'matters', workflowInstanceId, section],
    queryFn: () =>
      apiFetch<AuditMatterRecord[]>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/matters?section=${section}`,
      ),
  });
  const matters = query.data ?? [];
  const open = matters.filter((m) => OPEN.includes(m.status));
  const closed = matters.filter((m) => !OPEN.includes(m.status));
  const [showClosed, setShowClosed] = useState(false);
  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100'),
    enabled: canManage && open.length > 0,
  });

  if (matters.length === 0) return <div id={`audit-anchor-${section}-matters`} />;

  return (
    <Card id={`audit-anchor-${section}-matters`} className="space-y-2 p-4">
      <p className="text-xs font-medium text-ink">
        Matters{open.length > 0 ? ` — ${open.length} open` : ' — none open'}
      </p>
      {open.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {open.map((m) => (
            <MatterRow
              key={m.id}
              engagementId={engagementId}
              matter={m}
              canManage={canManage}
              employees={employees.data?.items ?? []}
            />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <div>
          <button
            type="button"
            className="text-xs text-ink-muted hover:text-ink hover:underline"
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? 'Hide' : 'Show'} {closed.length} closed
          </button>
          {showClosed && (
            <ul className="mt-1 space-y-1 text-xs text-ink-muted">
              {closed.map((m) => (
                <li key={m.id}>
                  <span className="font-medium text-ink">{m.matterCode}</span>{' '}
                  {m.description ?? m.title} — {humanize(m.status)}
                  {m.resolution ? `: ${m.resolution}` : ''}
                  {m.approverName ? ` (${m.approverName})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

/** The Section 01 question a matter came from (`acceptance:<segment>:<question>[:sub]`). */
export function matterQuestionKey(source: string): string | null {
  const [section, , question] = source.split(':');
  return section === 'acceptance' && question ? question : null;
}

function MatterRow({
  engagementId,
  matter,
  canManage,
  employees,
}: {
  engagementId: string;
  matter: AuditMatterRecord;
  canManage: boolean;
  employees: EmployeeRow[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [basis, setBasis] = useState(matter.resolution ?? matter.suggestedResolution ?? '');
  const [description, setDescription] = useState(matter.description ?? matter.title);
  const [action, setAction] = useState(matter.action ?? '');
  const [owner, setOwner] = useState(matter.ownerEmployeeId ?? '');
  const [due, setDue] = useState(matter.dueDate ?? '');
  const question = matterQuestionKey(matter.source);
  const register = matter.section === 'acceptance';

  const fields = (): Partial<UpdateMatterInput> =>
    register
      ? {
          // Unchanged from the generated line → keep following the source.
          description: description.trim() === matter.title ? '' : description,
          action,
          ownerEmployeeId: owner || null,
          dueDate: due || null,
        }
      : {};
  const update = useMutation({
    mutationFn: (status: MatterStatus | null) =>
      apiFetch<AuditMatterRecord>(
        `/engagements/${engagementId}/statutory-audit/matters/${matter.id}`,
        {
          method: 'POST',
          body: {
            ...fields(),
            ...(status ? { status } : {}),
            ...(status === 'resolved' || status === 'accepted_with_approval'
              ? { resolution: basis.trim() || null }
              : {}),
            version: matter.version,
          },
        },
      ),
    onSuccess: (_res, status) => {
      toast(
        status === 'accepted_with_approval'
          ? `${matter.matterCode} accepted with approval.`
          : status === 'resolved'
            ? `${matter.matterCode} resolved.`
            : status === 'under_review'
              ? `${matter.matterCode} is under review.`
              : `${matter.matterCode} saved.`,
      );
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not update the matter.', 'error'),
  });
  const ownerName =
    employees.find((e) => e.id === matter.ownerEmployeeId)?.fullName ?? matter.ownerName;

  return (
    <li className="space-y-1.5 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-ink">{matter.matterCode}</span>
        {matter.isBlocking && <Badge tone="danger">Blocks approval</Badge>}
        {matter.severity && <Badge tone="neutral">{humanize(matter.severity)}</Badge>}
        {register && <Badge tone="neutral">{humanize(matter.category)}</Badge>}
        <Badge tone={matter.status === 'under_review' ? 'warn' : 'neutral'}>
          {humanize(matter.status)}
        </Badge>
        {question && (
          <button
            type="button"
            className="ml-auto text-xs font-medium text-primary-600 hover:underline"
            onClick={() => openAuditPhase('acceptance', `question-${question}`)}
          >
            Go to {question.toUpperCase().replace(/_/g, '-')}
          </button>
        )}
      </div>
      <p className="text-ink">{matter.description ?? matter.title}</p>
      {register && !canManage && (
        <p className="text-xs text-ink-muted">
          {ownerName ? `Owner: ${ownerName}` : 'No owner'}
          {matter.dueDate ? ` · Due ${matter.dueDate}` : ''}
          {matter.action ? ` · Action: ${matter.action}` : ''}
        </p>
      )}
      {canManage && (
        <>
          {register && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Description">
                <Textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field label="Action / safeguard">
                <Textarea
                  rows={2}
                  value={action}
                  placeholder="What is being done about it"
                  onChange={(e) => setAction(e.target.value)}
                />
              </Field>
              <Field label="Owner">
                <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">Choose…</option>
                  {matter.ownerEmployeeId &&
                    !employees.some((e) => e.id === matter.ownerEmployeeId) && (
                      <option value={matter.ownerEmployeeId}>
                        {matter.ownerName ?? 'Current owner'}
                      </option>
                    )}
                  {employees.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Due date">
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </Field>
            </div>
          )}
          <Textarea
            rows={2}
            value={basis}
            aria-label={`Basis for ${matter.matterCode}`}
            placeholder={
              register ? 'Resolution — how it was settled' : 'Safeguard / basis for accepting it'
            }
            onChange={(e) => setBasis(e.target.value)}
          />
          {matter.suggestedResolution && basis === matter.suggestedResolution && (
            <p className="text-[11px] text-ink-faint">
              Drafted from the explanation already on the file.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={update.isPending || !basis.trim()}
              title={!basis.trim() ? 'Record the basis first' : undefined}
              onClick={() => update.mutate('accepted_with_approval')}
            >
              Accept with approval
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={update.isPending || (register && !basis.trim())}
              title={register && !basis.trim() ? 'Record the resolution first' : undefined}
              onClick={() => update.mutate('resolved')}
            >
              Mark resolved
            </Button>
            {register && (
              <>
                {matter.status !== 'under_review' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={update.isPending}
                    onClick={() => update.mutate('under_review')}
                  >
                    Under review
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={update.isPending}
                  onClick={() => update.mutate(null)}
                >
                  Save
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}
