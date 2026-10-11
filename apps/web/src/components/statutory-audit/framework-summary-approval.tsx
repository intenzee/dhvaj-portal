'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, History, Link2, Lock, RotateCcw, Send, Undo2, X } from 'lucide-react';
import {
  AF01_DECISION,
  AF02_DECISION,
  AF02_DECISION_LABEL,
  FRAMEWORK_SOURCE_SECTION_LABEL,
  FRAMEWORK_SOURCE_SECTIONS,
  type Af02Decision,
  type ApproveFrameworkInput,
  type ConfirmFrameworkInput,
  type FrameworkApprovalCondition,
  type FrameworkBaselineRecord,
  type FrameworkReturnItem,
  type FrameworkSourceSection,
  type Paginated,
  type ReopenFrameworkInput,
  type StatutoryAuditFrameworkSummary,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { DocumentRow, EmployeeRow } from '@/lib/types';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { DocumentPreview } from '@/components/document-preview';
import type { FrameworkSummaryPanelProps } from './framework-summary-types';
import { LinkPicker } from './acceptance-file-card';

const fmtDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Shared mutation plumbing: POST, toast, refresh. */
function useSummaryAction<T>(
  props: FrameworkSummaryPanelProps,
  path: (input: T) => string,
  success: string,
) {
  const toast = useToast();
  return useMutation({
    mutationFn: (input: T) =>
      apiFetch<StatutoryAuditFrameworkSummary>(
        `/engagements/${props.engagementId}/statutory-audit/${path(input)}`,
        { method: 'POST', body: input as unknown as Record<string, unknown> },
      ),
    onSuccess: () => {
      toast(success);
      props.onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'The action failed.'),
  });
}

/**
 * 02.8 §9–§15, §18 — completion checklist, returned items, AF-01 (Manager),
 * AF-02 (Engagement Partner), the approval record, the baseline history and
 * the controlled reopen. All forms open inline under their row.
 */
export function FrameworkSummaryApproval(props: FrameworkSummaryPanelProps): JSX.Element {
  const { summary, canManage } = props;
  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100'),
    enabled: canManage,
  });
  const people = employees.data?.items ?? [];
  const status = summary.baseline?.status ?? null;

  return (
    <div id="framework-02-8-approval" className="space-y-3">
      <CompletionChecklist summary={summary} />
      <ReturnedItems {...props} />
      {status !== 'approved' && status !== 'manager_confirmed' && canManage && (
        <Af01Card {...props} people={people} />
      )}
      {status === 'manager_confirmed' && <Af02Card {...props} people={people} />}
      {summary.approval && <ApprovalRecord {...props} />}
      {summary.gates.canReopen && canManage && <ReopenCard {...props} people={people} />}
      {summary.history.length > 0 && (
        <BaselineHistory engagementId={props.engagementId} history={summary.history} />
      )}
    </div>
  );
}

function CompletionChecklist({ summary }: { summary: StatutoryAuditFrameworkSummary }) {
  const met = summary.gates.checks.filter((c) => c.met).length;
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Completion checklist</h3>
        <span className="text-xs text-ink-muted">
          {met}/{summary.gates.checks.length} met
        </span>
      </div>
      <ul className="space-y-1">
        {summary.gates.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-sm">
            {c.met ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
            )}
            <span className={c.met ? 'text-ink' : 'text-ink-muted'}>
              {c.label}
              {!c.met && c.detail && (
                <span className="block text-xs text-ink-faint">{c.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Returned items (AF-01 "No" / AF-02 "Return for Further Work") ─────────────

function ReturnedItems(props: FrameworkSummaryPanelProps): JSX.Element | null {
  const open = props.summary.returns.filter((r) => r.status === 'open');
  const [showClosed, setShowClosed] = useState(false);
  const closed = props.summary.returns.filter((r) => r.status === 'resolved');
  if (props.summary.returns.length === 0) return null;
  return (
    <Card className="space-y-2 p-4">
      <h3 className="text-sm font-semibold text-ink">Returned for further work</h3>
      {open.length === 0 && (
        <p className="text-xs text-ink-muted">Every returned item has been cleared.</p>
      )}
      <ul className="divide-y divide-line">
        {open.map((r) => (
          <ReturnRow key={r.id} item={r} {...props} />
        ))}
      </ul>
      {closed.length > 0 && (
        <button
          type="button"
          className="text-xs text-primary-700 hover:underline"
          onClick={() => setShowClosed((v) => !v)}
        >
          {showClosed ? 'Hide' : 'Show'} {closed.length} cleared item
          {closed.length === 1 ? '' : 's'}
        </button>
      )}
      {showClosed && (
        <ul className="divide-y divide-line">
          {closed.map((r) => (
            <li key={r.id} className="py-2 text-xs text-ink-muted">
              <span className="font-medium text-ink">{FRAMEWORK_SOURCE_SECTION_LABEL[r.section]}</span>{' '}
              ({r.gate}) — {r.action}
              <span className="block">
                Cleared by {r.resolvedByName ?? '—'} on {fmtDate(r.resolvedAt)}: {r.resolution}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReturnRow(
  props: FrameworkSummaryPanelProps & { item: FrameworkReturnItem },
): JSX.Element {
  const { item } = props;
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState('');
  const resolve = useSummaryAction<{ resolution: string }>(
    props,
    () => `framework-summary/returns/${item.id}/resolve`,
    'Returned item cleared.',
  );
  return (
    <li className="py-2">
      <button
        type="button"
        className="group flex w-full items-start gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <ExpandToggle open={open} className="mt-0.5" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-medium text-ink">{FRAMEWORK_SOURCE_SECTION_LABEL[item.section]}</span>
          <Badge tone="warn" className="ml-2">
            {item.gate}
          </Badge>
          <span className="block text-ink-muted">{item.action}</span>
          <span className="block text-xs text-ink-faint">
            Raised by {item.raisedByName ?? '—'} on {fmtDate(item.raisedAt)}
            {item.ownerName ? ` · Owner: ${item.ownerName}` : ''}
          </span>
        </span>
      </button>
      {open && (
        <div className="ml-7 mt-2 space-y-2">
          <Field label="How the source section addressed it" required>
            <Textarea
              rows={2}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            disabled={!resolution.trim() || resolve.isPending}
            onClick={() => resolve.mutate({ resolution: resolution.trim() })}
          >
            Clear item
          </Button>
        </div>
      )}
    </li>
  );
}

// ── AF-01 Manager review (§9) ─────────────────────────────────────────────────

interface ReturnDraft {
  section: FrameworkSourceSection;
  action: string;
  ownerEmployeeId: string;
}

function Af01Card(
  props: FrameworkSummaryPanelProps & { people: EmployeeRow[] },
): JSX.Element {
  const { summary, people } = props;
  const [mode, setMode] = useState<'submit' | 'return' | null>(null);
  const [note, setNote] = useState('');
  const [previewReviewed, setPreviewReviewed] = useState(false);
  const [items, setItems] = useState<ReturnDraft[]>([
    { section: '02.2', action: '', ownerEmployeeId: '' },
  ]);
  const confirm = useSummaryAction<ConfirmFrameworkInput>(
    props,
    () => `${summary.workflowInstanceId}/framework-summary/confirm`,
    mode === 'return'
      ? 'Returned to the source sections for further work.'
      : 'AF-01 recorded — submitted for Engagement Partner approval.',
  );
  const blockers = summary.gates.confirmBlockers;
  const validItems = items.filter((i) => i.action.trim());

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">AF-01 · Manager review</h3>
        <p className="text-xs text-ink-muted">
          Has the Manager reviewed the framework summary, matters and downstream configuration
          preview, and is the framework ready for Partner approval?
        </p>
      </div>
      {blockers.length > 0 && (
        <ul className="space-y-0.5 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={mode === 'submit' ? 'primary' : 'secondary'}
          disabled={!summary.gates.canConfirm}
          onClick={() => setMode(mode === 'submit' ? null : 'submit')}
        >
          <Send className="h-4 w-4" />
          Yes – Submit for Partner Approval
        </Button>
        <Button
          variant={mode === 'return' ? 'primary' : 'secondary'}
          onClick={() => setMode(mode === 'return' ? null : 'return')}
        >
          <Undo2 className="h-4 w-4" />
          No – Further Work Required
        </Button>
      </div>

      {mode === 'submit' && (
        <div className="space-y-3 border-t border-line pt-3">
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-1"
              checked={previewReviewed}
              onChange={(e) => setPreviewReviewed(e.target.checked)}
            />
            I have reviewed the Downstream Configuration Preview (
            {summary.downstreamPreview.length} item
            {summary.downstreamPreview.length === 1 ? '' : 's'}).
          </label>
          <Field label="Manager note">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button
            disabled={!previewReviewed || confirm.isPending}
            onClick={() =>
              confirm.mutate({
                decision: AF01_DECISION.submit,
                note: note.trim() || undefined,
                previewReviewed: true,
                recordVersion: summary.recordVersion,
              })
            }
          >
            Record AF-01
          </Button>
        </div>
      )}

      {mode === 'return' && (
        <div className="space-y-3 border-t border-line pt-3">
          {items.map((it, idx) => (
            <div key={idx} className="grid gap-2 sm:grid-cols-[12rem_1fr_12rem_auto]">
              <Select
                aria-label="Source section"
                value={it.section}
                onChange={(e) =>
                  setItems(
                    items.map((x, i) =>
                      i === idx ? { ...x, section: e.target.value as FrameworkSourceSection } : x,
                    ),
                  )
                }
              >
                {FRAMEWORK_SOURCE_SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {FRAMEWORK_SOURCE_SECTION_LABEL[s]}
                  </option>
                ))}
              </Select>
              <Input
                aria-label="Further work required"
                placeholder="Further work required"
                value={it.action}
                onChange={(e) =>
                  setItems(items.map((x, i) => (i === idx ? { ...x, action: e.target.value } : x)))
                }
              />
              <Select
                aria-label="Owner"
                value={it.ownerEmployeeId}
                onChange={(e) =>
                  setItems(
                    items.map((x, i) => (i === idx ? { ...x, ownerEmployeeId: e.target.value } : x)),
                  )
                }
              >
                <option value="">Owner…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                size="sm"
                disabled={items.length === 1}
                onClick={() => setItems(items.filter((_, i) => i !== idx))}
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setItems([...items, { section: '02.2', action: '', ownerEmployeeId: '' }])
              }
            >
              Add section
            </Button>
          </div>
          <Field label="Manager note">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button
            disabled={validItems.length === 0 || confirm.isPending}
            onClick={() =>
              confirm.mutate({
                decision: AF01_DECISION.furtherWork,
                note: note.trim() || undefined,
                returnItems: validItems.map((i) => ({
                  section: i.section,
                  action: i.action.trim(),
                  ownerEmployeeId: i.ownerEmployeeId || undefined,
                })),
                recordVersion: summary.recordVersion,
              })
            }
          >
            Return for further work
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── AF-02 Engagement Partner conclusion (§12) ─────────────────────────────────

interface ConditionDraft {
  condition: string;
  ownerEmployeeId: string;
  dueDate: string;
  impact: string;
  planningMayCommence: boolean;
}
const emptyCondition = (): ConditionDraft => ({
  condition: '',
  ownerEmployeeId: '',
  dueDate: '',
  impact: '',
  planningMayCommence: true,
});

function Af02Card(
  props: FrameworkSummaryPanelProps & { people: EmployeeRow[] },
): JSX.Element {
  const { summary, people } = props;
  const [decision, setDecision] = useState<Af02Decision | null>(null);
  const [conditions, setConditions] = useState<ConditionDraft[]>([emptyCondition()]);
  const [reason, setReason] = useState('');
  const [sections, setSections] = useState<FrameworkSourceSection[]>([]);
  const approve = useSummaryAction<ApproveFrameworkInput>(
    props,
    () => `${summary.workflowInstanceId}/framework-summary/approve`,
    decision === AF02_DECISION.returnForFurtherWork
      ? 'Framework returned for further work.'
      : 'AF-02 recorded — the Audit Framework Baseline is approved.',
  );
  const b = summary.baseline!;
  const isPartner = summary.header.viewerIsPartner;
  const conditionsValid = conditions.every(
    (c) => c.condition.trim() && c.dueDate && c.impact.trim(),
  );

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">AF-02 · Engagement Partner conclusion</h3>
        <p className="text-xs text-ink-muted">
          AF-01 recorded by {b.managerConfirmedByName ?? '—'} on {fmtDate(b.managerConfirmedAt)}
          {b.managerNote ? ` — “${b.managerNote}”` : ''}.
        </p>
      </div>
      {!isPartner ? (
        <p className="text-sm text-ink-muted">
          Awaiting the Engagement Partner
          {summary.header.engagementPartnerName ? ` (${summary.header.engagementPartnerName})` : ''}.
        </p>
      ) : (
        <>
          {summary.gates.approveBlockers.length > 0 && (
            <ul className="space-y-0.5 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700">
              {summary.gates.approveBlockers.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {(Object.values(AF02_DECISION) as Af02Decision[]).map((d) => (
              <Button
                key={d}
                variant={decision === d ? 'primary' : 'secondary'}
                disabled={d !== AF02_DECISION.returnForFurtherWork && !summary.gates.canApprove}
                onClick={() => setDecision(decision === d ? null : d)}
              >
                {AF02_DECISION_LABEL[d]}
              </Button>
            ))}
          </div>

          {decision === AF02_DECISION.approve && (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-sm text-ink-muted">
                Approving freezes Audit Framework Baseline v{b.version}, the memorandum, the
                methodology version ({summary.header.methodologyVersion}) and the rule versions in
                force, and opens Section 03 Planning.
              </p>
              <Button
                disabled={approve.isPending}
                onClick={() =>
                  approve.mutate({
                    decision: AF02_DECISION.approve,
                    recordVersion: summary.recordVersion,
                  })
                }
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve framework
              </Button>
            </div>
          )}

          {decision === AF02_DECISION.approveWithConditions && (
            <div className="space-y-3 border-t border-line pt-3">
              {conditions.map((c, idx) => {
                const set = (patch: Partial<ConditionDraft>) =>
                  setConditions(conditions.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
                return (
                  <div key={idx} className="space-y-2 rounded-lg border border-line p-3">
                    <Field label={`Condition ${idx + 1}`} required>
                      <Textarea
                        rows={2}
                        value={c.condition}
                        onChange={(e) => set({ condition: e.target.value })}
                      />
                    </Field>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="Owner">
                        <Select
                          value={c.ownerEmployeeId}
                          onChange={(e) => set({ ownerEmployeeId: e.target.value })}
                        >
                          <option value="">—</option>
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.fullName}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Due date" required>
                        <Input
                          type="date"
                          value={c.dueDate}
                          min={todayIso()}
                          onChange={(e) => set({ dueDate: e.target.value })}
                        />
                      </Field>
                    </div>
                    <Field label="Impact if not met" required>
                      <Input value={c.impact} onChange={(e) => set({ impact: e.target.value })} />
                    </Field>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={c.planningMayCommence}
                        onChange={(e) => set({ planningMayCommence: e.target.checked })}
                      />
                      Planning may commence before this condition is resolved
                    </label>
                    {conditions.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConditions(conditions.filter((_, i) => i !== idx))}
                      >
                        Remove condition
                      </Button>
                    )}
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConditions([...conditions, emptyCondition()])}
                >
                  Add condition
                </Button>
                <Button
                  disabled={!conditionsValid || approve.isPending}
                  onClick={() =>
                    approve.mutate({
                      decision: AF02_DECISION.approveWithConditions,
                      conditions: conditions.map((c) => ({
                        condition: c.condition.trim(),
                        ownerEmployeeId: c.ownerEmployeeId || undefined,
                        dueDate: c.dueDate,
                        impact: c.impact.trim(),
                        planningMayCommence: c.planningMayCommence,
                      })),
                      recordVersion: summary.recordVersion,
                    })
                  }
                >
                  Approve subject to conditions
                </Button>
              </div>
            </div>
          )}

          {decision === AF02_DECISION.returnForFurtherWork && (
            <div className="space-y-3 border-t border-line pt-3">
              <Field label="Reason" required>
                <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <SectionPicker value={sections} onChange={setSections} />
              <Button
                disabled={!reason.trim() || sections.length === 0 || approve.isPending}
                onClick={() =>
                  approve.mutate({
                    decision: AF02_DECISION.returnForFurtherWork,
                    returnReason: reason.trim(),
                    returnSections: sections,
                    recordVersion: summary.recordVersion,
                  })
                }
              >
                Return for further work
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function SectionPicker({
  value,
  onChange,
}: {
  value: FrameworkSourceSection[];
  onChange: (v: FrameworkSourceSection[]) => void;
}): JSX.Element {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-medium text-ink">
        Affected section(s)<span className="ml-0.5 text-danger-600">*</span>
      </legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {FRAMEWORK_SOURCE_SECTIONS.map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={value.includes(s)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))
              }
            />
            {FRAMEWORK_SOURCE_SECTION_LABEL[s]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ── Approval record (§13) ─────────────────────────────────────────────────────

function ApprovalRecord(props: FrameworkSummaryPanelProps): JSX.Element {
  const a = props.summary.approval!;
  const [showRules, setShowRules] = useState(false);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Framework approval record</h3>
        <Badge tone={a.decision === 'approve' ? 'success' : 'warn'}>
          {AF02_DECISION_LABEL[a.decision]}
        </Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        <Fact label="Engagement Partner" value={a.partnerName} />
        <Fact label="Approved on" value={fmtDate(a.approvedAt)} />
        <Fact label="Audit period" value={a.auditPeriod} />
        <Fact label="Baseline" value={`v${a.baselineVersion}`} />
        <Fact label="Methodology" value={a.methodologyVersion} />
        <Fact
          label="Memorandum"
          value={a.memoReference ? `${a.memoReference}${a.memoVersion ? ` (v${a.memoVersion})` : ''}` : null}
        />
      </dl>
      <div>
        <button
          type="button"
          className="group flex items-center gap-2 text-xs font-medium text-ink"
          onClick={() => setShowRules((v) => !v)}
        >
          <ExpandToggle open={showRules} />
          Rule versions relied on ({a.ruleVersions.length})
        </button>
        {showRules && (
          <ul className="ml-7 mt-2 grid gap-x-4 gap-y-0.5 text-xs text-ink-muted sm:grid-cols-2">
            {a.ruleVersions.map((r) => (
              <li key={r.ruleVersionId}>
                <span className="font-mono">{r.ruleCode}</span> {r.versionLabel} ·{' '}
                {r.section === 'other_areas' ? 'other areas' : r.section}
              </li>
            ))}
          </ul>
        )}
      </div>
      {a.conditions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Conditions
          </h4>
          <ul className="divide-y divide-line">
            {a.conditions.map((c) => (
              <ConditionRow key={c.id} condition={c} {...props} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function ConditionRow(
  props: FrameworkSummaryPanelProps & { condition: FrameworkApprovalCondition },
): JSX.Element {
  const c = props.condition;
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState('');
  const resolve = useSummaryAction<{ resolution: string }>(
    props,
    () => `framework-summary/conditions/${c.id}/resolve`,
    'Condition resolved.',
  );
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-ink">{c.condition}</p>
          <p className="text-xs text-ink-muted">
            Due {fmtDate(c.dueDate)}
            {c.ownerName ? ` · ${c.ownerName}` : ''} · Impact: {c.impact} ·{' '}
            {c.planningMayCommence ? 'Planning may commence' : 'Planning waits for this'}
          </p>
          {c.status === 'resolved' && (
            <p className="text-xs text-ink-faint">
              Resolved by {c.resolvedByName ?? '—'} on {fmtDate(c.resolvedAt)}: {c.resolution}
            </p>
          )}
        </div>
        {c.status === 'open' ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            Resolve
          </Button>
        ) : (
          <Badge tone="success">Resolved</Badge>
        )}
      </div>
      {open && c.status === 'open' && (
        <div className="mt-2 space-y-2">
          <Field label="Resolution" required>
            <Textarea
              rows={2}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            disabled={!resolution.trim() || resolve.isPending}
            onClick={() => resolve.mutate({ resolution: resolution.trim() })}
          >
            Record resolution
          </Button>
        </div>
      )}
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="font-medium text-ink">{value ?? '—'}</dd>
    </div>
  );
}

// ── Controlled reopen (§15) ───────────────────────────────────────────────────

/** Fired by the Section 02 "approved" banner to open the reopen form (§14). */
export const FRAMEWORK_REOPEN_EVENT = 'hsdg:framework-reopen';
export const FRAMEWORK_REOPEN_ANCHOR = 'framework-02-8-reopen';

/**
 * §14 Controlled Reopen prompt: once the framework is approved, Section 02 is
 * read-only and every change goes through Reopen Audit Framework in 02.8.
 */
export function ApprovedFrameworkBanner({
  version,
  canReopen,
}: {
  version: string | null;
  canReopen: boolean;
}): JSX.Element {
  const openReopen = () => {
    document
      .getElementById(FRAMEWORK_REOPEN_ANCHOR)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.dispatchEvent(new CustomEvent(FRAMEWORK_REOPEN_EVENT));
  };
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-md border border-success-500/30 bg-success-50 px-3 py-2"
    >
      <Lock className="h-4 w-4 shrink-0 text-success-700" />
      <p className="min-w-0 flex-1 text-sm text-ink">
        <span className="font-semibold">
          Audit Framework{version ? ` v${version}` : ''} approved
        </span>{' '}
        — Section 02 is read-only. To change a fact or conclusion, reopen the framework in 02.8
        (Controlled Reopen) and name the affected sections.
      </p>
      {canReopen ? (
        <Button size="sm" variant="secondary" onClick={openReopen}>
          Reopen Audit Framework
        </Button>
      ) : (
        <span className="text-xs text-ink-muted">Ask the engagement lead to reopen it.</span>
      )}
    </div>
  );
}

function ReopenCard(props: FrameworkSummaryPanelProps & { people: EmployeeRow[] }): JSX.Element {
  const { summary, people, engagementId } = props;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [sections, setSections] = useState<FrameworkSourceSection[]>([]);
  const [identifiedAt, setIdentifiedAt] = useState(todayIso());
  const [identifiedBy, setIdentifiedBy] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [evidenceDoc, setEvidenceDoc] = useState<{ id: string; title: string } | null>(null);
  const [linking, setLinking] = useState(false);
  const [reapprovalRequired, setReapprovalRequired] = useState(true);
  const reopen = useSummaryAction<ReopenFrameworkInput>(
    props,
    () => `${summary.workflowInstanceId}/framework-summary/reopen`,
    'Framework reopened — a new draft version is open.',
  );
  useEffect(() => {
    const onRequest = () => setOpen(true);
    window.addEventListener(FRAMEWORK_REOPEN_EVENT, onRequest);
    return () => window.removeEventListener(FRAMEWORK_REOPEN_EVENT, onRequest);
  }, []);
  return (
    <Card id={FRAMEWORK_REOPEN_ANCHOR} className="scroll-mt-2 p-4">
      <button
        type="button"
        className="group flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <ExpandToggle open={open} />
        <RotateCcw className="h-4 w-4 text-ink-muted" />
        <span className="text-sm font-semibold text-ink">Reopen the approved framework</span>
      </button>
      {open && (
        <div className="ml-7 mt-3 space-y-3">
          <p className="text-xs text-ink-muted">
            v{summary.baseline?.version} stays on file unchanged; the affected sections are flagged
            for re-evaluation and the framework goes through AF-01 and AF-02 again.
          </p>
          <Field label="Reason for reopening" required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <SectionPicker value={sections} onChange={setSections} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Date the change was identified" required>
              <Input
                type="date"
                value={identifiedAt}
                max={todayIso()}
                onChange={(e) => setIdentifiedAt(e.target.value)}
              />
            </Field>
            <Field label="Change identified by">
              <Select value={identifiedBy} onChange={(e) => setIdentifiedBy(e.target.value)}>
                <option value="">Me</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Supporting evidence">
            <Input
              value={evidenceNote}
              placeholder="What shows the change (optional)"
              onChange={(e) => setEvidenceNote(e.target.value)}
            />
          </Field>
          <div className="space-y-1">
            {evidenceDoc ? (
              <p className="flex items-center gap-2 text-xs text-ink">
                <Link2 className="h-3.5 w-3.5 text-ink-muted" />
                Evidence document: <span className="font-medium">{evidenceDoc.title}</span>
                <button
                  type="button"
                  className="text-ink-faint hover:text-danger-600"
                  aria-label="Remove the evidence document"
                  onClick={() => setEvidenceDoc(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </p>
            ) : (
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline"
                onClick={() => setLinking((v) => !v)}
              >
                <Link2 className="h-3.5 w-3.5" /> Link an evidence document
              </button>
            )}
            {linking && !evidenceDoc && (
              <LinkPicker
                engagementId={engagementId}
                exclude={[]}
                onPick={async (documentId, title) => {
                  setEvidenceDoc({ id: documentId, title: title ?? 'Linked document' });
                  setLinking(false);
                }}
              />
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={reapprovalRequired}
              onChange={(e) => setReapprovalRequired(e.target.checked)}
            />
            Engagement Partner reapproval required
          </label>
          <Button
            disabled={!reason.trim() || sections.length === 0 || !identifiedAt || reopen.isPending}
            onClick={() =>
              reopen.mutate({
                reason: reason.trim(),
                affectedSections: sections,
                identifiedAt: new Date(`${identifiedAt}T00:00:00`).toISOString(),
                identifiedByEmployeeId: identifiedBy || undefined,
                evidenceNote: evidenceNote.trim() || undefined,
                evidenceDocumentId: evidenceDoc?.id,
                reapprovalRequired,
                recordVersion: summary.recordVersion,
              })
            }
          >
            Reopen framework
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── Baseline history ──────────────────────────────────────────────────────────

function BaselineHistory({
  engagementId,
  history,
}: {
  engagementId: string;
  history: FrameworkBaselineRecord[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocumentRow | null>(null);
  const toast = useToast();
  const openEvidence = async (documentId: string): Promise<void> => {
    try {
      setOpenDoc(await apiFetch<DocumentRow>(`/engagements/${engagementId}/documents/${documentId}`));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not open the evidence document.', 'error');
    }
  };
  return (
    <Card className="p-4">
      <button
        type="button"
        className="group flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <ExpandToggle open={open} />
        <History className="h-4 w-4 text-ink-muted" />
        <span className="text-sm font-semibold text-ink">
          Baseline history ({history.length} version{history.length === 1 ? '' : 's'})
        </span>
      </button>
      {open && (
        <ul className="ml-7 mt-3 space-y-2">
          {history.map((b) => (
            <li key={b.id} className="text-xs">
              <span className="font-medium text-ink">v{b.version}</span>{' '}
              <Badge tone={b.status === 'approved' ? 'success' : 'neutral'}>{b.status}</Badge>
              <span className="block text-ink-muted">
                {b.epApprovedAt
                  ? `Approved by ${b.epApprovedByName ?? '—'} on ${fmtDate(b.epApprovedAt)}`
                  : b.managerConfirmedAt
                    ? `AF-01 by ${b.managerConfirmedByName ?? '—'} on ${fmtDate(b.managerConfirmedAt)}`
                    : 'Draft'}
              </span>
              {b.reopen && (
                <span className="block text-ink-muted">
                  Reopened from v{b.reopen.fromVersion} by {b.reopen.reopenedByName ?? '—'} on{' '}
                  {fmtDate(b.reopen.reopenedAt)} — {b.reopen.reason} (
                  {b.reopen.affectedSections.join(', ')})
                  <span className="block">
                    Identified {fmtDate(b.reopen.identifiedAt)}
                    {b.reopen.identifiedByName ? ` by ${b.reopen.identifiedByName}` : ''} ·{' '}
                    {b.reopen.reapprovalRequired
                      ? 'Partner reapproval required'
                      : 'No Partner reapproval required'}
                  </span>
                  {b.reopen.evidenceNote && (
                    <span className="block">Evidence: {b.reopen.evidenceNote}</span>
                  )}
                  {b.reopen.evidenceDocumentId && (
                    <button
                      type="button"
                      className="flex items-center gap-1 font-medium text-primary-700 hover:underline"
                      onClick={() => void openEvidence(b.reopen!.evidenceDocumentId!)}
                    >
                      <Link2 className="h-3 w-3" /> Open the evidence document
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {openDoc && (
        <DocumentPreview
          engagementId={engagementId}
          doc={openDoc}
          canEdit={false}
          onClose={() => setOpenDoc(null)}
          onSaved={() => undefined}
        />
      )}
    </Card>
  );
}
