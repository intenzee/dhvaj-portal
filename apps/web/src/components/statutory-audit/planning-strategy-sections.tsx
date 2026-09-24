'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, Info, Plus } from 'lucide-react';
import {
  ACCEPTANCE_CARRY_FORWARD_ACTION_LABEL,
  PLANNING_AFFECTED_MODULES,
  PLANNING_CONSIDERATION_ASSESSMENT_LABEL,
  PLANNING_CONSIDERATION_ASSESSMENTS_BY_KIND,
  PLANNING_MATTER_CATEGORIES,
  PRIOR_YEAR_ASSESSMENT_LABEL,
  PRIOR_YEAR_ASSESSMENTS,
  PRIOR_YEAR_MATTER_TYPE_LABEL,
  PRIOR_YEAR_MATTER_TYPES,
  type AcceptanceCarryForwardAction,
  type AcceptanceCarryForwardRecord,
  type AreaOfFocusRecord,
  type PlanningAffectedModule,
  type PlanningCompletionCheck,
  type PlanningConsiderationAssessment,
  type PlanningConsiderationKind,
  type PlanningConsiderationRecord,
  type PlanningDiscussionRecord,
  type PlanningMatterCategory,
  type PlanningMatterOrigin,
  type PlanningMatterRecord,
  type PlanningMatterStatus,
  type PlanningSignalRecord,
  type PriorYearAssessment,
  type PriorYearMatterRecord,
  type PriorYearMatterType,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';

/**
 * 03.1 remaining sub-sections (DHVAJ 03.1 §13.2–13.3, §14–§16, §18, §20):
 * strategic timing/resource considerations, prior-year intelligence, acceptance
 * matters carried forward, the team planning discussion, the Planning Matter
 * register and the completion checklist. Rendered inside PlanningIntelligencePanel.
 */

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const MATTER_CATEGORY_LABEL: Record<PlanningMatterCategory, string> = {
  scope: 'Scope',
  information: 'Information',
  timing: 'Timing',
  resource: 'Resource',
  reporting: 'Reporting',
  technology: 'Technology',
  component: 'Component',
  specialist: 'Specialist',
  other: 'Other',
};

const MATTER_STATUS_LABEL: Record<PlanningMatterStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  carried_forward: 'Carried forward',
};

const ORIGIN_LABEL: Record<PlanningMatterOrigin, string> = {
  signal: 'Signal',
  focus_area: 'Area of Focus',
  discussion: 'Team discussion',
};

function EmptyNote({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}

function SignalPicker({
  signals,
  value,
  onChange,
  placeholder = '— Select a signal —',
}: {
  signals: PlanningSignalRecord[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}): JSX.Element {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {signals.map((s) => (
        <option key={s.id} value={s.id}>
          {s.signalCode} — {s.observation.slice(0, 80)}
        </option>
      ))}
    </Select>
  );
}

// ── §20 Completion checklist ────────────────────────────────────────────────

export function CompletionChecklist({ checks }: { checks: PlanningCompletionCheck[] }): JSX.Element {
  const done = checks.filter((c) => c.met).length;
  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-center justify-between text-sm font-medium text-ink">
        <span>Completion checklist</span>
        <span className="text-xs text-ink-muted">
          {done} / {checks.length}
        </span>
      </div>
      <ul className="space-y-1">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-sm">
            {c.met ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
            )}
            <span>
              <span className={c.met ? 'text-ink' : 'text-ink-muted'}>{c.label}</span>
              {c.detail && <span className="block text-xs text-ink-faint">{c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── §13.2–13.3 Timing & resource considerations ─────────────────────────────

export function ConsiderationsSection({
  engagementId,
  base,
  qk,
  signals,
  editable,
  onChanged,
}: {
  engagementId: string;
  base: string;
  qk: string[];
  signals: PlanningSignalRecord[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const list = useQuery({
    queryKey: [...qk, 'considerations'],
    queryFn: () => apiFetch<PlanningConsiderationRecord[]>(`${base}/planning-considerations`),
  });
  const [adding, setAdding] = useState<PlanningConsiderationKind | null>(null);
  if (list.isLoading) return <Spinner label="Loading considerations…" />;
  const all = list.data ?? [];

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Strategic considerations only. Detailed dates are set in 03.11 and named staff / specialist
        scope in 03.8. Considerations are proposed from the signal register — refresh intelligence
        after adding signals.
      </p>
      {(
        [
          ['timing', 'Strategic timing considerations', '03.11'],
          ['resource', 'Strategic resource considerations', '03.8'],
        ] as [PlanningConsiderationKind, string, string][]
      ).map(([kind, title, dest]) => {
        const items = all.filter((c) => c.kind === kind);
        return (
          <div key={kind} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-ink">
                {title} <span className="text-xs font-normal text-ink-faint">→ {dest}</span>
              </div>
              {editable && adding !== kind && (
                <Button variant="ghost" onClick={() => setAdding(kind)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add
                </Button>
              )}
            </div>
            {items.length === 0 && adding !== kind && <EmptyNote>None proposed.</EmptyNote>}
            {items.map((c) => (
              <ConsiderationCard
                key={`${c.id}-${c.version}`}
                engagementId={engagementId}
                consideration={c}
                editable={editable}
                onChanged={onChanged}
              />
            ))}
            {adding === kind && (
              <NewConsiderationForm
                base={base}
                kind={kind}
                signals={signals}
                onDone={() => setAdding(null)}
                onChanged={onChanged}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConsiderationCard({
  engagementId,
  consideration: c,
  editable,
  onChanged,
}: {
  engagementId: string;
  consideration: PlanningConsiderationRecord;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [assessment, setAssessment] = useState<PlanningConsiderationAssessment | ''>(
    c.assessment ?? '',
  );
  const [rationale, setRationale] = useState(c.rationale ?? '');
  const needsRationale =
    assessment === 'not_required' &&
    (c.signalAttention === 'enhanced' || c.signalAttention === 'immediate_partner');
  const dirty = assessment !== (c.assessment ?? '') || rationale !== (c.rationale ?? '');

  const save = useMutation({
    mutationFn: () =>
      apiFetch<PlanningConsiderationRecord>(
        `/engagements/${engagementId}/statutory-audit/planning-considerations/${c.id}`,
        {
          method: 'POST',
          body: { assessment, rationale: rationale || undefined, version: c.version },
        },
      ),
    onSuccess: () => {
      toast('Consideration assessed.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the assessment.')),
  });

  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-ink">{c.label}</div>
          <p className="text-xs text-ink-faint">
            {[c.basis, c.signalCode && `Prompted by ${c.signalCode}`, !c.isAuto && 'Added by Manager']
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {c.assessment && (
          <Badge tone="info">{PLANNING_CONSIDERATION_ASSESSMENT_LABEL[c.assessment]}</Badge>
        )}
      </div>
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-wrap gap-3">
            {PLANNING_CONSIDERATION_ASSESSMENTS_BY_KIND[c.kind].map((a) => (
              <label key={a} className="inline-flex items-center gap-1.5 text-xs text-ink">
                <input
                  type="radio"
                  name={`consideration-${c.id}`}
                  checked={assessment === a}
                  onChange={() => setAssessment(a)}
                />
                {PLANNING_CONSIDERATION_ASSESSMENT_LABEL[a]}
              </label>
            ))}
          </div>
          {(needsRationale || assessment === 'not_required' || assessment === 'not_relevant') && (
            <div className="min-w-[16rem] flex-1">
              <Input
                placeholder={needsRationale ? 'Rationale (required)' : 'Rationale'}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </div>
          )}
          <Button
            variant="secondary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !assessment || !dirty || (needsRationale && !rationale.trim())}
          >
            Save
          </Button>
        </div>
      )}
      {!editable && c.rationale && <p className="text-xs text-ink-muted">{c.rationale}</p>}
    </Card>
  );
}

function NewConsiderationForm({
  base,
  kind,
  signals,
  onDone,
  onChanged,
}: {
  base: string;
  kind: PlanningConsiderationKind;
  signals: PlanningSignalRecord[];
  onDone: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [basis, setBasis] = useState('');
  const [signalId, setSignalId] = useState('');
  const create = useMutation({
    mutationFn: () =>
      apiFetch<PlanningConsiderationRecord>(`${base}/planning-considerations`, {
        method: 'POST',
        body: { kind, label, basis: basis || undefined, signalId: signalId || undefined },
      }),
    onSuccess: () => {
      toast('Consideration added.');
      onChanged();
      onDone();
    },
    onError: (e) => toast(errMsg(e, 'Could not add the consideration.')),
  });
  return (
    <Card className="space-y-3 p-3">
      <Field
        label={kind === 'timing' ? 'Timing consideration' : 'Resource consideration'}
        hint={kind === 'timing' ? 'No dates here — those go in 03.11.' : 'No names here — staffing is 03.8.'}
        required
      >
        <Input
          placeholder={
            kind === 'timing' ? 'e.g. Year-end inventory attendance' : 'e.g. Valuation expertise'
          }
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Why">
          <Input value={basis} onChange={(e) => setBasis(e.target.value)} />
        </Field>
        <Field label="Related signal">
          <SignalPicker
            signals={signals}
            value={signalId}
            onChange={setSignalId}
            placeholder="— None —"
          />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => create.mutate()} disabled={create.isPending || !label.trim()}>
          Add consideration
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

// ── 03.1.6 Prior year + 03.1.7 Acceptance matters ───────────────────────────

export function CarriedMattersSection({
  engagementId,
  base,
  qk,
  signals,
  initialAudit,
  editable,
  onChanged,
}: {
  engagementId: string;
  base: string;
  qk: string[];
  signals: PlanningSignalRecord[];
  initialAudit: boolean;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const priorYear = useQuery({
    queryKey: [...qk, 'prior-year'],
    queryFn: () => apiFetch<PriorYearMatterRecord[]>(`${base}/prior-year-matters`),
  });
  const acceptance = useQuery({
    queryKey: [...qk, 'acceptance'],
    queryFn: () => apiFetch<AcceptanceCarryForwardRecord[]>(`${base}/acceptance-carry-forward`),
  });
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="text-sm font-medium text-ink">03.1.7 · Acceptance matters carried forward</div>
        <p className="text-xs text-ink-muted">
          Unresolved or conditional Section 01 matters. Each must become a signal, be linked to an
          existing signal, or be concluded with a reason — so they do not disappear at planning.
        </p>
        {acceptance.isLoading && <Spinner label="Loading acceptance matters…" />}
        {!acceptance.isLoading && (acceptance.data ?? []).length === 0 && (
          <EmptyNote>No unresolved or conditional acceptance matters.</EmptyNote>
        )}
        {(acceptance.data ?? []).map((a) => (
          <AcceptanceCard
            key={`${a.matterId}-${a.version}`}
            engagementId={engagementId}
            matter={a}
            signals={signals}
            editable={editable}
            onChanged={onChanged}
          />
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-ink">03.1.6 · Prior-year intelligence</div>
          {editable && !adding && !initialAudit && (
            <Button variant="ghost" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add prior-year matter
            </Button>
          )}
        </div>
        {initialAudit ? (
          <EmptyNote>Initial audit — there is no prior-year audit file to reassess.</EmptyNote>
        ) : (
          <>
            <p className="text-xs text-ink-muted">
              Reassess each prior-year matter for the current year. Nothing rolls forward
              automatically. If there are none, confirm that on the Overall direction tab.
            </p>
            {priorYear.isLoading && <Spinner label="Loading prior-year matters…" />}
            {!priorYear.isLoading && (priorYear.data ?? []).length === 0 && !adding && (
              <EmptyNote>No prior-year matters recorded.</EmptyNote>
            )}
            {(priorYear.data ?? []).map((m) => (
              <PriorYearCard
                key={`${m.id}-${m.version}`}
                engagementId={engagementId}
                matter={m}
                signals={signals}
                editable={editable}
                onChanged={onChanged}
              />
            ))}
            {adding && (
              <NewPriorYearForm base={base} onDone={() => setAdding(false)} onChanged={onChanged} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AcceptanceCard({
  engagementId,
  matter: a,
  signals,
  editable,
  onChanged,
}: {
  engagementId: string;
  matter: AcceptanceCarryForwardRecord;
  signals: PlanningSignalRecord[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [action, setAction] = useState<AcceptanceCarryForwardAction | ''>(a.action ?? '');
  const [signalId, setSignalId] = useState(a.action === 'link_signal' ? (a.signalId ?? '') : '');
  const [reason, setReason] = useState(a.reason ?? '');
  const [editing, setEditing] = useState(a.action === null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<AcceptanceCarryForwardRecord>(
        `/engagements/${engagementId}/statutory-audit/acceptance-carry-forward/${a.matterId}`,
        {
          method: 'POST',
          body: {
            action,
            signalId: action === 'link_signal' ? signalId : undefined,
            reason: reason || undefined,
            version: a.version,
          },
        },
      ),
    onSuccess: (r) => {
      toast(r.signalCode ? `${a.matterCode} carried forward as ${r.signalCode}.` : `${a.matterCode} concluded.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save.')),
  });

  const blocked =
    !action ||
    (action === 'link_signal' && !signalId) ||
    (action === 'no_implication' && !reason.trim());

  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-2 font-mono text-xs text-ink-faint">{a.matterCode}</span>
          <span className="text-ink">{a.title}</span>
          <p className="text-xs text-ink-faint">
            {[
              a.matterStatus === 'accepted_with_approval' ? 'Conditional — accepted with approval' : `Section 01: ${a.matterStatus.replace(/_/g, ' ')}`,
              a.severity && `Severity ${a.severity}`,
              a.matterResolution,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {a.action && (
          <Badge tone="info">
            {ACCEPTANCE_CARRY_FORWARD_ACTION_LABEL[a.action]}
            {a.signalCode ? ` · ${a.signalCode}` : ''}
          </Badge>
        )}
      </div>
      {a.action === 'no_implication' && a.reason && !editing && (
        <p className="text-xs text-ink-muted">Reason: {a.reason}</p>
      )}
      {editable && !editing && (
        <Button variant="ghost" onClick={() => setEditing(true)}>
          Change
        </Button>
      )}
      {editable && editing && (
        <div className="space-y-2 rounded-lg bg-surface-raised p-2">
          <div className="flex flex-wrap gap-3">
            {(Object.keys(ACCEPTANCE_CARRY_FORWARD_ACTION_LABEL) as AcceptanceCarryForwardAction[]).map(
              (k) => (
                <label key={k} className="inline-flex items-center gap-1.5 text-xs text-ink">
                  <input
                    type="radio"
                    name={`acceptance-${a.matterId}`}
                    checked={action === k}
                    onChange={() => setAction(k)}
                  />
                  {ACCEPTANCE_CARRY_FORWARD_ACTION_LABEL[k]}
                </label>
              ),
            )}
          </div>
          {action === 'link_signal' && (
            <SignalPicker signals={signals} value={signalId} onChange={setSignalId} />
          )}
          {action === 'no_implication' && (
            <Input
              placeholder="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          <div className="flex gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending || blocked}>
              Save
            </Button>
            {a.action && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function PriorYearCard({
  engagementId,
  matter: m,
  signals,
  editable,
  onChanged,
}: {
  engagementId: string;
  matter: PriorYearMatterRecord;
  signals: PlanningSignalRecord[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [assessment, setAssessment] = useState<PriorYearAssessment | ''>(m.assessment ?? '');
  const [note, setNote] = useState(m.assessmentNote ?? '');
  const [signalMode, setSignalMode] = useState<'none' | 'create' | 'link'>('none');
  const [linkId, setLinkId] = useState('');
  const resolved = assessment === 'resolved';

  const save = useMutation({
    mutationFn: () =>
      apiFetch<PriorYearMatterRecord>(
        `/engagements/${engagementId}/statutory-audit/prior-year-matters/${m.id}`,
        {
          method: 'POST',
          body: {
            assessment,
            assessmentNote: note || undefined,
            createSignal: !resolved && signalMode === 'create' ? true : undefined,
            linkSignalId: !resolved && signalMode === 'link' ? linkId : undefined,
            version: m.version,
          },
        },
      ),
    onSuccess: (r) => {
      toast(r.signalCode ? `${m.matterCode} reassessed — ${r.signalCode}.` : `${m.matterCode} reassessed.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the reassessment.')),
  });

  const blocked =
    !assessment ||
    (resolved && !note.trim()) ||
    (!resolved && signalMode === 'link' && !linkId);

  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-2 font-mono text-xs text-ink-faint">{m.matterCode}</span>
          <span className="font-medium text-ink">{PRIOR_YEAR_MATTER_TYPE_LABEL[m.matterType]}</span>
          <p className="text-ink-muted">{m.description}</p>
          {m.sourceEvidence && <p className="text-xs text-ink-faint">Source: {m.sourceEvidence}</p>}
        </div>
        <div className="flex gap-1.5">
          {m.assessment ? (
            <Badge tone="info">{PRIOR_YEAR_ASSESSMENT_LABEL[m.assessment]}</Badge>
          ) : (
            <Badge tone="warn">Not reassessed</Badge>
          )}
          {m.signalCode && <Badge>{m.signalCode}</Badge>}
        </div>
      </div>
      {editable && (
        <div className="space-y-2 rounded-lg bg-surface-raised p-2">
          <div className="flex flex-wrap gap-3">
            {PRIOR_YEAR_ASSESSMENTS.map((a) => (
              <label key={a} className="inline-flex items-center gap-1.5 text-xs text-ink">
                <input
                  type="radio"
                  name={`py-${m.id}`}
                  checked={assessment === a}
                  onChange={() => setAssessment(a)}
                />
                {PRIOR_YEAR_ASSESSMENT_LABEL[a]}
              </label>
            ))}
          </div>
          <Input
            placeholder={resolved ? 'How was it resolved? (required)' : 'Current-year note'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {assessment && !resolved && !m.signalId && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink">
              {(
                [
                  ['none', 'No signal'],
                  ['create', 'Create current-year signal'],
                  ['link', 'Link existing signal'],
                ] as ['none' | 'create' | 'link', string][]
              ).map(([k, label]) => (
                <label key={k} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`py-signal-${m.id}`}
                    checked={signalMode === k}
                    onChange={() => setSignalMode(k)}
                  />
                  {label}
                </label>
              ))}
              {signalMode === 'link' && (
                <div className="min-w-[16rem] flex-1">
                  <SignalPicker signals={signals} value={linkId} onChange={setLinkId} />
                </div>
              )}
            </div>
          )}
          <Button variant="secondary" onClick={() => save.mutate()} disabled={save.isPending || blocked}>
            Save reassessment
          </Button>
        </div>
      )}
      {!editable && m.assessmentNote && <p className="text-xs text-ink-muted">{m.assessmentNote}</p>}
    </Card>
  );
}

function NewPriorYearForm({
  base,
  onDone,
  onChanged,
}: {
  base: string;
  onDone: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [type, setType] = useState<PriorYearMatterType | ''>('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const create = useMutation({
    mutationFn: () =>
      apiFetch<PriorYearMatterRecord>(`${base}/prior-year-matters`, {
        method: 'POST',
        body: { matterType: type, description, sourceEvidence: source || undefined },
      }),
    onSuccess: (m) => {
      toast(`${m.matterCode} added — reassess it for the current year.`);
      onChanged();
      onDone();
    },
    onError: (e) => toast(errMsg(e, 'Could not add the prior-year matter.')),
  });
  return (
    <Card className="space-y-3 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prior-year matter type" required>
          <Select value={type} onChange={(e) => setType(e.target.value as PriorYearMatterType)}>
            <option value="">— Select —</option>
            {PRIOR_YEAR_MATTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {PRIOR_YEAR_MATTER_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source evidence" hint="e.g. FY25 audit report, CARO annexure">
          <Input value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
      </div>
      <Field label="What was the matter?" required>
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          onClick={() => create.mutate()}
          disabled={create.isPending || !type || !description.trim()}
        >
          Add matter
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

// ── 03.1.8 Initial engagement-team planning discussion ──────────────────────

export function DiscussionSection({
  base,
  qk,
  team,
  signals,
  focus,
  editable,
  onChanged,
}: {
  base: string;
  qk: string[];
  team: TeamMember[];
  signals: PlanningSignalRecord[];
  focus: AreaOfFocusRecord[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const discussion = useQuery({
    queryKey: [...qk, 'discussion'],
    queryFn: () => apiFetch<PlanningDiscussionRecord>(`${base}/planning-discussion`),
  });
  if (discussion.isLoading || !discussion.data) return <Spinner label="Loading discussion…" />;
  return (
    <DiscussionForm
      key={discussion.data.version}
      base={base}
      record={discussion.data}
      team={team}
      signals={signals}
      focus={focus}
      editable={editable}
      onChanged={onChanged}
    />
  );
}

function CheckList<T extends { id: string }>({
  items,
  picked,
  setPicked,
  render,
  empty,
}: {
  items: T[];
  picked: string[];
  setPicked: (fn: (cur: string[]) => string[]) => void;
  render: (item: T) => React.ReactNode;
  empty: string;
}): JSX.Element {
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
      {items.length === 0 && <p className="text-xs text-ink-faint">{empty}</p>}
      {items.map((it) => (
        <label key={it.id} className="flex items-start gap-2 text-xs text-ink">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={picked.includes(it.id)}
            onChange={(e) =>
              setPicked((cur) => (e.target.checked ? [...cur, it.id] : cur.filter((x) => x !== it.id)))
            }
          />
          <span>{render(it)}</span>
        </label>
      ))}
    </div>
  );
}

function DiscussionForm({
  base,
  record: d,
  team,
  signals,
  focus,
  editable,
  onChanged,
}: {
  base: string;
  record: PlanningDiscussionRecord;
  team: TeamMember[];
  signals: PlanningSignalRecord[];
  focus: AreaOfFocusRecord[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [date, setDate] = useState(d.discussionDate ?? '');
  const [participants, setParticipants] = useState<string[]>(d.participantEmployeeIds);
  const [signalIds, setSignalIds] = useState<string[]>(d.signalIds);
  const [focusIds, setFocusIds] = useState<string[]>(d.focusIds);
  const [additional, setAdditional] = useState(d.additionalMatters ?? '');
  const [skepticism, setSkepticism] = useState(d.skepticismAreas ?? '');
  const [observations, setObservations] = useState(d.observations ?? '');

  const save = useMutation({
    mutationFn: () =>
      apiFetch<PlanningDiscussionRecord>(`${base}/planning-discussion`, {
        method: 'POST',
        body: {
          discussionDate: date || undefined,
          participantEmployeeIds: participants,
          signalIds,
          focusIds,
          additionalMatters: additional || undefined,
          skepticismAreas: skepticism || undefined,
          observations: observations || undefined,
          version: d.version,
        },
      }),
    onSuccess: () => {
      toast('Planning discussion saved.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the discussion.')),
  });

  const byId = new Map(signals.map((s) => [s.id, s]));
  const focusById = new Map(focus.map((f) => [f.id, f]));

  if (!editable) {
    if (d.version === 0) return <EmptyNote>The planning discussion has not been recorded.</EmptyNote>;
    return (
      <div className="space-y-2 text-sm">
        <p className="text-ink">
          {d.discussionDate} · {d.participantNames.join(', ')}
        </p>
        {d.signalIds.length > 0 && (
          <p className="text-xs text-ink-muted">
            Signals discussed: {d.signalIds.map((id) => byId.get(id)?.signalCode ?? '—').join(', ')}
          </p>
        )}
        {d.focusIds.length > 0 && (
          <p className="text-xs text-ink-muted">
            Areas of Focus: {d.focusIds.map((id) => focusById.get(id)?.focusCode ?? '—').join(', ')}
          </p>
        )}
        {d.additionalMatters && <p className="text-ink-muted">Additional matters: {d.additionalMatters}</p>}
        {d.skepticismAreas && <p className="text-ink-muted">Professional skepticism: {d.skepticismAreas}</p>}
        {d.observations && <p className="text-ink-muted">Observations: {d.observations}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Capture the initial engagement-team discussion in structured form — no long minutes. Raise
        actions in the Planning matters tab and new matters as signals in the register.
      </p>
      <Card className="space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Discussion date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-1 text-sm font-medium text-ink">Participants *</div>
          <CheckList
            items={team.map((m) => ({ id: m.employeeId, m }))}
            picked={participants}
            setPicked={setParticipants}
            render={({ m }) => `${m.employeeName} (${m.roleOnEngagement.replace(/_/g, ' ')})`}
            empty="No team members on this engagement."
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium text-ink">Planning Signals discussed</div>
            <CheckList
              items={signals.filter((s) => s.status !== 'closed' || signalIds.includes(s.id))}
              picked={signalIds}
              setPicked={setSignalIds}
              render={(s) => (
                <>
                  <span className="font-mono text-ink-faint">{s.signalCode}</span> {s.observation}
                </>
              )}
              empty="No signals yet."
            />
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-ink">Areas of Focus discussed</div>
            <CheckList
              items={focus.filter((f) => f.status !== 'superseded' || focusIds.includes(f.id))}
              picked={focusIds}
              setPicked={setFocusIds}
              render={(f) => (
                <>
                  <span className="font-mono text-ink-faint">{f.focusCode}</span> {f.name}
                </>
              )}
              empty="No Areas of Focus yet."
            />
          </div>
        </div>
        <Field label="Additional matters identified">
          <Textarea rows={2} value={additional} onChange={(e) => setAdditional(e.target.value)} />
        </Field>
        <Field label="Areas requiring professional skepticism">
          <Textarea rows={2} value={skepticism} onChange={(e) => setSkepticism(e.target.value)} />
        </Field>
        <Field label="Partner / Manager observations">
          <Textarea rows={2} value={observations} onChange={(e) => setObservations(e.target.value)} />
        </Field>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !date || participants.length === 0}
        >
          {d.version === 0 ? 'Record discussion' : 'Save discussion'}
        </Button>
      </Card>
    </div>
  );
}

// ── §18 Planning Matter / Action register ───────────────────────────────────

export function MattersSection({
  engagementId,
  base,
  qk,
  team,
  signals,
  focus,
  editable,
  onChanged,
}: {
  engagementId: string;
  base: string;
  qk: string[];
  team: TeamMember[];
  signals: PlanningSignalRecord[];
  focus: AreaOfFocusRecord[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const matters = useQuery({
    queryKey: [...qk, 'matters'],
    queryFn: () => apiFetch<PlanningMatterRecord[]>(`${base}/planning-matters`),
  });
  const [adding, setAdding] = useState(false);
  const byId = new Map(signals.map((s) => [s.id, s]));
  const focusById = new Map(focus.map((f) => [f.id, f]));

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Where a signal needs action rather than an immediate conclusion, raise a Planning Matter
        instead of burying it in narrative. Open matters need an owner before 03.1 completes.
      </p>
      {matters.isLoading && <Spinner label="Loading Planning Matters…" />}
      {!matters.isLoading && (matters.data ?? []).length === 0 && !adding && (
        <EmptyNote>No Planning Matters.</EmptyNote>
      )}
      {(matters.data ?? []).map((m) => (
        <MatterCard
          key={`${m.id}-${m.version}`}
          engagementId={engagementId}
          matter={m}
          originLabel={
            m.signalId
              ? (byId.get(m.signalId)?.signalCode ?? 'Signal')
              : m.focusId
                ? (focusById.get(m.focusId)?.focusCode ?? 'Area of Focus')
                : ORIGIN_LABEL[m.origin]
          }
          team={team}
          editable={editable}
          onChanged={onChanged}
        />
      ))}
      {editable &&
        (adding ? (
          <NewMatterForm
            base={base}
            team={team}
            signals={signals}
            focus={focus}
            onDone={() => setAdding(false)}
            onChanged={onChanged}
          />
        ) : (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Raise a Planning Matter
          </Button>
        ))}
    </div>
  );
}

function MatterCard({
  engagementId,
  matter: m,
  originLabel,
  team,
  editable,
  onChanged,
}: {
  engagementId: string;
  matter: PlanningMatterRecord;
  originLabel: string;
  team: TeamMember[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [status, setStatus] = useState<PlanningMatterStatus>(m.status);
  const [owner, setOwner] = useState(m.ownerEmployeeId ?? '');
  const [resolution, setResolution] = useState(m.resolution ?? '');
  const dirty =
    status !== m.status || owner !== (m.ownerEmployeeId ?? '') || resolution !== (m.resolution ?? '');

  const save = useMutation({
    mutationFn: () =>
      apiFetch<PlanningMatterRecord>(
        `/engagements/${engagementId}/statutory-audit/planning-matters/${m.id}`,
        {
          method: 'POST',
          body: {
            status,
            ownerEmployeeId: owner || undefined,
            resolution: resolution || undefined,
            version: m.version,
          },
        },
      ),
    onSuccess: () => {
      toast(`${m.matterCode} updated.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not update the Planning Matter.')),
  });

  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-2 font-mono text-xs text-ink-faint">{m.matterCode}</span>
          <span className="text-ink">{m.title}</span>
          <p className="text-xs text-ink-faint">
            {[
              `From ${originLabel}`,
              MATTER_CATEGORY_LABEL[m.category],
              m.affectedModule && `Affects ${m.affectedModule}`,
              m.dueDate && `Due ${m.dueDate}`,
              m.ownerName && `Owner ${m.ownerName}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex gap-1.5">
          {m.partnerAttention && <Badge tone="danger">Partner attention</Badge>}
          <Badge tone={m.status === 'resolved' ? 'success' : m.ownerName ? 'info' : 'warn'}>
            {MATTER_STATUS_LABEL[m.status]}
          </Badge>
        </div>
      </div>
      {m.resolution && m.status === 'resolved' && (
        <p className="text-xs text-ink-muted">Resolution: {m.resolution}</p>
      )}
      {editable && m.status !== 'resolved' && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-surface-raised p-2">
          <div className="w-40">
            <Select value={status} onChange={(e) => setStatus(e.target.value as PlanningMatterStatus)}>
              {(Object.keys(MATTER_STATUS_LABEL) as PlanningMatterStatus[]).map((s) => (
                <option key={s} value={s}>
                  {MATTER_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-48">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">— Owner —</option>
              {team.map((t) => (
                <option key={t.employeeId} value={t.employeeId}>
                  {t.employeeName}
                </option>
              ))}
            </Select>
          </div>
          {status === 'resolved' && (
            <div className="min-w-[16rem] flex-1">
              <Input
                placeholder="Resolution (required)"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              />
            </div>
          )}
          <Button
            variant="secondary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty || (status === 'resolved' && !resolution.trim())}
          >
            Save
          </Button>
        </div>
      )}
    </Card>
  );
}

function NewMatterForm({
  base,
  team,
  signals,
  focus,
  onDone,
  onChanged,
}: {
  base: string;
  team: TeamMember[];
  signals: PlanningSignalRecord[];
  focus: AreaOfFocusRecord[];
  onDone: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [origin, setOrigin] = useState<PlanningMatterOrigin>('signal');
  const [signalId, setSignalId] = useState('');
  const [focusId, setFocusId] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PlanningMatterCategory | ''>('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [module, setModule] = useState<PlanningAffectedModule | ''>('');
  const [partner, setPartner] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      apiFetch<PlanningMatterRecord>(`${base}/planning-matters`, {
        method: 'POST',
        body: {
          origin,
          signalId: origin === 'signal' ? signalId : undefined,
          focusId: origin === 'focus_area' ? focusId : undefined,
          title,
          category,
          ownerEmployeeId: owner || undefined,
          dueDate: due || undefined,
          affectedModule: module || undefined,
          partnerAttention: partner,
        },
      }),
    onSuccess: (m) => {
      toast(`${m.matterCode} raised.`);
      onChanged();
      onDone();
    },
    onError: (e) => toast(errMsg(e, 'Could not raise the Planning Matter.')),
  });

  const blocked =
    !title.trim() ||
    !category ||
    (origin === 'signal' && !signalId) ||
    (origin === 'focus_area' && !focusId);

  return (
    <Card className="space-y-3 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Origin" required>
          <Select value={origin} onChange={(e) => setOrigin(e.target.value as PlanningMatterOrigin)}>
            {(Object.keys(ORIGIN_LABEL) as PlanningMatterOrigin[]).map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABEL[o]}
              </option>
            ))}
          </Select>
        </Field>
        {origin === 'signal' && (
          <Field label="Signal" required>
            <SignalPicker signals={signals} value={signalId} onChange={setSignalId} />
          </Field>
        )}
        {origin === 'focus_area' && (
          <Field label="Area of Focus" required>
            <Select value={focusId} onChange={(e) => setFocusId(e.target.value)}>
              <option value="">— Select —</option>
              {focus.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.focusCode} — {f.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Matter / action" required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" required>
          <Select value={category} onChange={(e) => setCategory(e.target.value as PlanningMatterCategory)}>
            <option value="">— Select —</option>
            {PLANNING_MATTER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MATTER_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Affected planning module">
          <Select value={module} onChange={(e) => setModule(e.target.value as PlanningAffectedModule)}>
            <option value="">— None —</option>
            {PLANNING_AFFECTED_MODULES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">— Select —</option>
            {team.map((t) => (
              <option key={t.employeeId} value={t.employeeId}>
                {t.employeeName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={partner} onChange={(e) => setPartner(e.target.checked)} />
        Requires Partner attention
      </label>
      <div className="flex gap-2">
        <Button onClick={() => create.mutate()} disabled={create.isPending || blocked}>
          Raise matter
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
