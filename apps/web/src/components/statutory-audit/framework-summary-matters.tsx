'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Flag, Pencil, Undo2 } from 'lucide-react';
import {
  FRAMEWORK_MATTER_CATEGORY_LABEL,
  type FrameworkSummaryMatter,
  type StatutoryAuditTeam,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { PanelHeading, SourceLink } from './framework-summary-shared';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';

const STATUS: Record<FrameworkSummaryMatter['status'], { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'warn' },
  under_review: { label: 'Under Review', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
  accepted_with_approval: { label: 'Accepted with Approval', tone: 'success' },
  blocking: { label: 'Blocking', tone: 'danger' },
};

/**
 * 02.8 §7 Framework Matters / Exceptions — aggregated from 02.1–02.7, never
 * recreated here. 02.8 records the impact, Partner Attention, owner, due date
 * and resolution, or returns the same matter to its source section (Under
 * Review). A blocking matter stops AF-01 and AF-02 until it is resolved.
 */
export function FrameworkSummaryMatters(props: FrameworkSummaryPanelProps): JSX.Element {
  const { engagementId, summary, canManage } = props;
  const [showClosed, setShowClosed] = useState(false);
  const team = useQuery({
    queryKey: ['engagement', engagementId, 'statutory-audit-team'],
    queryFn: () =>
      apiFetch<StatutoryAuditTeam[]>(`/engagements/${engagementId}/statutory-audit/team`),
    enabled: canManage,
  });
  const t = team.data?.[0];
  const people = new Map<string, string>();
  if (t?.engagementPartnerId) people.set(t.engagementPartnerId, t.engagementPartnerName ?? 'EP');
  if (t?.engagementManagerId) people.set(t.engagementManagerId, t.engagementManagerName ?? 'EM');
  for (const m of t?.members ?? []) people.set(m.employeeId, `${m.name} (${m.role})`);

  const open = summary.matters.filter((m) => m.open);
  const closed = summary.matters.filter((m) => !m.open);
  const shown = showClosed ? summary.matters : open;
  return (
    <Card className="p-4" aria-label="Framework Matters">
      <PanelHeading
        title="Framework Matters"
        hint={`${open.length} open · ${summary.header.blockingMatterCount} blocking · raised in 02.1–02.7`}
      />
      {shown.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {summary.matters.length === 0
            ? 'No framework matter was raised in 02.1–02.7.'
            : 'Every framework matter is resolved.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((m) => (
            <MatterRow key={m.id} {...props} matter={m} people={people} />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <button
          type="button"
          className="mt-2 text-xs text-primary-700 hover:underline"
          onClick={() => setShowClosed((s) => !s)}
        >
          {showClosed ? 'Hide resolved matters' : `Show ${closed.length} resolved matter(s)`}
        </button>
      )}
    </Card>
  );
}

function MatterRow({
  engagementId,
  summary,
  canManage,
  onChanged,
  matter: m,
  people,
}: FrameworkSummaryPanelProps & {
  matter: FrameworkSummaryMatter;
  people: Map<string, string>;
}): JSX.Element {
  const toast = useToast();
  const [mode, setMode] = useState<'edit' | 'return' | null>(null);
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState(m.impact ?? '');
  const [resolution, setResolution] = useState(m.resolution ?? '');
  const [owner, setOwner] = useState(m.ownerEmployeeId ?? '');
  const [due, setDue] = useState(m.dueDate ?? '');
  const [note, setNote] = useState('');
  const base = `/engagements/${engagementId}/statutory-audit/${summary.workflowInstanceId}/framework-summary/matters/${m.id}`;
  const editable = canManage && m.open;

  const post = async (path: string, body: object, done: string): Promise<void> => {
    setBusy(true);
    try {
      await apiFetch<FrameworkSummaryMatter>(path, { method: 'POST', body });
      toast(done);
      setMode(null);
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save the matter.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const ownerOptions = new Map(people);
  if (m.ownerEmployeeId && !ownerOptions.has(m.ownerEmployeeId))
    ownerOptions.set(m.ownerEmployeeId, m.ownerName ?? 'Current owner');

  return (
    <li
      className={`rounded-md border p-2.5 text-sm ${m.blocking ? 'border-danger-200 bg-danger-50/40' : 'border-line bg-surface'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-ink-faint">{m.code}</span>
            <span className="font-medium text-ink">{m.title}</span>
            <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
            <Badge>{FRAMEWORK_MATTER_CATEGORY_LABEL[m.category] ?? m.category}</Badge>
            {m.partnerAttention && (
              <Badge tone="warn">
                <Flag className="mr-1 h-3 w-3" /> Partner attention
              </Badge>
            )}
          </p>
          {m.description && <p className="mt-0.5 text-xs text-ink-muted">{m.description}</p>}
          <p className="mt-0.5 text-xs text-ink-faint">
            <SourceLink source={m.source} /> · Owner {m.ownerName ?? '—'} · Due{' '}
            {m.dueDate ? formatDate(m.dueDate) : '—'}
          </p>
          {m.impact && <p className="mt-0.5 text-xs text-ink-muted">Impact: {m.impact}</p>}
          {m.resolution && (
            <p className="mt-0.5 text-xs text-ink-muted">Resolution: {m.resolution}</p>
          )}
        </div>
        {editable && (
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={mode === 'edit'}
              onClick={() => setMode((x) => (x === 'edit' ? null : 'edit'))}
            >
              <Pencil className="h-3.5 w-3.5" /> Record
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void post(
                  base,
                  { partnerAttention: !m.partnerAttention },
                  m.partnerAttention
                    ? 'Partner attention cleared.'
                    : 'Flagged for Partner attention.',
                )
              }
            >
              <Flag className="h-3.5 w-3.5" /> {m.partnerAttention ? 'Unflag' : 'Flag for EP'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={mode === 'return'}
              onClick={() => setMode((x) => (x === 'return' ? null : 'return'))}
            >
              <Undo2 className="h-3.5 w-3.5" /> Return to{' '}
              {m.source === 'other_areas' ? 'source' : m.source}
            </Button>
          </div>
        )}
      </div>

      {mode === 'edit' && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="Impact" className="sm:col-span-2">
            <Textarea rows={2} value={impact} onChange={(e) => setImpact(e.target.value)} />
          </Field>
          <Field label="Owner">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Not assigned</option>
              {[...ownerOptions.entries()].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field
            label="Resolution"
            hint="The originating section closes the matter; record how it was resolved."
            className="sm:col-span-2"
          >
            <Textarea rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void post(
                  base,
                  {
                    impact: impact.trim() || null,
                    resolution: resolution.trim() || null,
                    ownerEmployeeId: owner || null,
                    dueDate: due || null,
                  },
                  'Matter updated.',
                )
              }
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === 'return' && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="What must the source section do?" required className="sm:col-span-2">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="Assign to">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Keep current owner</option>
              {[...ownerOptions.entries()].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button
              size="sm"
              disabled={busy || !note.trim()}
              onClick={() =>
                void post(
                  `${base}/return`,
                  { note: note.trim(), ownerEmployeeId: owner || null },
                  'Matter returned to its source section.',
                )
              }
            >
              {busy ? 'Returning…' : 'Return'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
