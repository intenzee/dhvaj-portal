'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Info, Plus, RefreshCw, Sparkles } from 'lucide-react';
import {
  AUDIT_ORIENTATION_LABEL,
  AUDIT_ORIENTATIONS,
  PLANNING_ATTENTION_LABEL,
  PLANNING_ATTENTIONS,
  PLANNING_CHANGE_CATEGORIES,
  PLANNING_CHANGE_CATEGORY_LABEL,
  PLANNING_DESTINATIONS,
  type AreaOfFocusRecord,
  type AuditOrientation,
  type PlanningAttention,
  type PlanningChangeCategory,
  type PlanningChangeFrImpact,
  type PlanningChangeRecord,
  type PlanningDestination,
  type PlanningIntelligenceStatus,
  type PlanningIntelligenceSummary,
  type PlanningSignalAssessment,
  type PlanningSignalRecord,
  type PlanningSignalSource,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import {
  CarriedMattersSection,
  CompletionChecklist,
  ConsiderationsSection,
  DiscussionSection,
  MattersSection,
} from './planning-strategy-sections';

/**
 * 03.1 Planning Intelligence & Overall Audit Strategy (DHVAJ 03.1) — the
 * "planning control room". The portal surfaces Planning Signals and explains why
 * they may matter; the Manager decides how they influence the audit. A signal is
 * never a risk rating: attention is Standard / Enhanced / Immediate Partner.
 * Formal EP approval is NOT here — it stays with Planning approval (03.12).
 */

const ATTENTION_TONE: Record<PlanningAttention, string> = {
  standard: 'neutral',
  enhanced: 'warn',
  immediate_partner: 'danger',
};

const STATUS_LABEL: Record<PlanningIntelligenceStatus, string> = {
  not_started: 'Not started',
  intelligence_generated: 'Intelligence generated',
  manager_assessment: 'Manager assessment',
  strategy_established: 'Strategy established',
  complete: 'Complete',
};

const SOURCE_LABEL: Record<PlanningSignalSource, string> = {
  section_01: 'Section 01',
  section_02: 'Section 02',
  prior_year: 'Prior year',
  current_year_change: 'Current-year change',
  analytics: '03.2 analytics',
  manager: 'Manager',
  partner: 'Partner',
};

const ASSESSMENT_LABEL: Record<PlanningSignalAssessment, string> = {
  area_of_focus: 'Area of Focus',
  potential_risk_assess_further: 'Potential risk — assess further',
  normal_planning: 'Normal planning consideration',
  further_information_required: 'Further information required',
  not_relevant: 'Not relevant',
};

const DESTINATION_LABEL: Record<PlanningDestination, string> = {
  '03.4': '03.4 Scope',
  '03.5': '03.5 Areas',
  '03.6': '03.6 Risks',
  '03.8': '03.8 Team',
  '03.9': '03.9 Components',
  '03.11': '03.11 Timeline',
  section_04: 'Section 04',
};

const FR_IMPACT_LABEL: Record<PlanningChangeFrImpact, string> = {
  yes: 'Yes',
  no: 'No',
  under_assessment: 'Under assessment',
};

type Tab =
  | 'signals'
  | 'changes'
  | 'focus'
  | 'considerations'
  | 'carried'
  | 'discussion'
  | 'matters'
  | 'strategy';

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function PlanningIntelligencePanel({
  engagementId,
  workflowInstanceId,
  team,
  editable,
  onChanged,
}: {
  engagementId: string;
  workflowInstanceId: string;
  team: TeamMember[];
  editable: boolean;
  /** Called after any change so the parent Planning checklist can refresh. */
  onChanged: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('signals');
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}`;
  const qk = ['engagement', engagementId, 'planning-intelligence', workflowInstanceId];

  const summary = useQuery({
    queryKey: [...qk, 'summary'],
    queryFn: () => apiFetch<PlanningIntelligenceSummary>(`${base}/planning-intelligence`),
  });
  const signals = useQuery({
    queryKey: [...qk, 'signals'],
    queryFn: () => apiFetch<PlanningSignalRecord[]>(`${base}/planning-signals`),
  });
  const focusAreas = useQuery({
    queryKey: [...qk, 'focus'],
    queryFn: () => apiFetch<AreaOfFocusRecord[]>(`${base}/areas-of-focus`),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk });
    onChanged();
  };

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<PlanningIntelligenceSummary>(`${base}/planning-intelligence/generate`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (s) => {
      toast(`Engagement Intelligence generated — ${s.totalSignals} signal(s) in the register.`);
      refresh();
    },
    onError: (e) => toast(errMsg(e, 'Could not generate Engagement Intelligence.')),
  });

  if (summary.isLoading) return <Spinner label="Loading planning intelligence…" />;
  const s = summary.data;
  if (!s) return <p className="text-sm text-ink-muted">Planning Intelligence is unavailable.</p>;

  const tiles: { label: string; value: number; tone?: string; onClick?: () => void }[] = [
    { label: 'Planning Signals', value: s.totalSignals, onClick: () => setTab('signals') },
    { label: 'Open signals', value: s.openSignals, onClick: () => setTab('signals') },
    { label: 'Areas of Focus', value: s.managerFocusAreas, onClick: () => setTab('focus') },
    {
      label: 'Further information',
      value: s.furtherInformationRequired,
      tone: s.furtherInformationRequired ? 'warn' : undefined,
    },
    {
      label: 'Partner attention',
      value: s.partnerAttention,
      tone: s.partnerAttention ? 'danger' : undefined,
    },
    {
      label: 'Open planning matters',
      value: s.openPlanningMatters,
      onClick: () => setTab('matters'),
    },
  ];
  const outstanding = s.completion.filter((c) => !c.met).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={s.record.status === 'complete' ? 'success' : 'info'}>
            {STATUS_LABEL[s.record.status]}
          </Badge>
          {s.record.intelligenceGeneratedAt && (
            <span className="text-[11px] text-ink-faint">
              Intelligence generated {new Date(s.record.intelligenceGeneratedAt).toLocaleString()}
            </span>
          )}
        </div>
        {editable && (
          <Button
            variant="secondary"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            title="Derive signals from confirmed Section 01/02 facts. Safe to re-run."
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            {s.record.intelligenceGeneratedAt ? 'Refresh intelligence' : 'Generate intelligence'}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={t.onClick}
            className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-left disabled:cursor-default"
            disabled={!t.onClick}
          >
            <div
              className={
                t.tone === 'danger'
                  ? 'text-lg font-semibold text-danger-700'
                  : t.tone === 'warn'
                    ? 'text-lg font-semibold text-warning-700'
                    : 'text-lg font-semibold text-ink'
              }
            >
              {t.value}
            </div>
            <div className="text-[11px] text-ink-muted">{t.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line">
        {(
          [
            ['signals', 'Signal register'],
            ['changes', 'Significant changes (PI-01)'],
            ['focus', 'Areas of Focus'],
            ['considerations', 'Timing & resources'],
            ['carried', 'Prior year & acceptance'],
            ['discussion', 'Team discussion'],
            ['matters', 'Planning matters'],
            ['strategy', outstanding ? `Overall direction (${outstanding} to do)` : 'Overall direction'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? '-mb-px border-b-2 border-primary-600 px-3 py-1.5 text-sm font-medium text-primary-700'
                : 'px-3 py-1.5 text-sm text-ink-muted hover:text-ink'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'signals' && (
        <SignalRegister
          engagementId={engagementId}
          base={base}
          signals={signals.data ?? []}
          loading={signals.isLoading}
          team={team}
          editable={editable}
          onChanged={refresh}
        />
      )}
      {tab === 'changes' && (
        <ChangesSection base={base} qk={qk} editable={editable} onChanged={refresh} />
      )}
      {tab === 'focus' && (
        <FocusSection
          engagementId={engagementId}
          base={base}
          qk={qk}
          signals={signals.data ?? []}
          editable={editable}
          onChanged={refresh}
        />
      )}
      {tab === 'considerations' && (
        <ConsiderationsSection
          engagementId={engagementId}
          base={base}
          qk={qk}
          signals={signals.data ?? []}
          editable={editable}
          onChanged={refresh}
        />
      )}
      {tab === 'carried' && (
        <CarriedMattersSection
          engagementId={engagementId}
          base={base}
          qk={qk}
          signals={signals.data ?? []}
          initialAudit={s.initialAudit}
          editable={editable}
          onChanged={refresh}
        />
      )}
      {tab === 'discussion' && (
        <DiscussionSection
          base={base}
          qk={qk}
          team={team}
          signals={signals.data ?? []}
          focus={focusAreas.data ?? []}
          editable={editable}
          onChanged={refresh}
        />
      )}
      {tab === 'matters' && (
        <MattersSection
          engagementId={engagementId}
          base={base}
          qk={qk}
          team={team}
          signals={signals.data ?? []}
          focus={focusAreas.data ?? []}
          editable={editable}
          onChanged={refresh}
        />
      )}
      {tab === 'strategy' && (
        <StrategySection
          key={s.record.version}
          base={base}
          summary={s}
          editable={editable}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

// ── Signal register (§7–§10) ────────────────────────────────────────────────

function SignalRegister({
  engagementId,
  base,
  signals,
  loading,
  team,
  editable,
  onChanged,
}: {
  engagementId: string;
  base: string;
  signals: PlanningSignalRecord[];
  loading: boolean;
  team: TeamMember[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  if (loading) return <Spinner label="Loading signals…" />;
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        A Planning Signal is a matter for consideration — not a risk of material misstatement.
        Formal risk assessment happens in 03.6 and Section 04.
      </p>
      {signals.length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
          No signals yet. Generate intelligence from Sections 01/02, record a significant change, or
          raise a signal.
        </p>
      )}
      {signals.map((sig) => (
        <SignalCard
          key={`${sig.id}-${sig.version}`}
          engagementId={engagementId}
          signal={sig}
          team={team}
          editable={editable}
          onChanged={onChanged}
        />
      ))}
      {editable &&
        (adding ? (
          <NewSignalForm base={base} onDone={() => setAdding(false)} onChanged={onChanged} />
        ) : (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Raise a signal
          </Button>
        ))}
    </div>
  );
}

function SignalCard({
  engagementId,
  signal,
  team,
  editable,
  onChanged,
}: {
  engagementId: string;
  signal: PlanningSignalRecord;
  team: TeamMember[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [assessment, setAssessment] = useState<PlanningSignalAssessment | ''>(
    signal.managerAssessment ?? '',
  );
  const [attention, setAttention] = useState<PlanningAttention>(signal.attention);
  const [attentionRationale, setAttentionRationale] = useState(signal.attentionRationale ?? '');
  const [rationale, setRationale] = useState(signal.assessmentRationale ?? '');
  const [owner, setOwner] = useState('');
  const [destinations, setDestinations] = useState<PlanningDestination[]>(signal.destinations);

  const downgradesIpa =
    signal.suggestedAttention === 'immediate_partner' && attention !== 'immediate_partner';
  const needsRationale = assessment === 'not_relevant';
  const needsOwner = assessment === 'further_information_required' && !signal.ownerName;

  const save = useMutation({
    mutationFn: () =>
      apiFetch<PlanningSignalRecord>(
        `/engagements/${engagementId}/statutory-audit/planning-signals/${signal.id}`,
        {
          method: 'POST',
          body: {
            attention,
            attentionRationale: attentionRationale || undefined,
            managerAssessment: assessment || undefined,
            assessmentRationale: rationale || undefined,
            ownerEmployeeId: owner || undefined,
            destinations,
            version: signal.version,
          },
        },
      ),
    onSuccess: () => {
      toast(`${signal.signalCode} assessed.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the assessment.')),
  });

  const blocked =
    (downgradesIpa && !attentionRationale.trim()) ||
    (needsRationale && !rationale.trim()) ||
    (needsOwner && !owner);

  return (
    <Card className="p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-start gap-2">
          {open ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
          )}
          <span className="min-w-0">
            <span className="mr-2 font-mono text-xs text-ink-faint">{signal.signalCode}</span>
            <span className="text-sm text-ink">{signal.observation}</span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              <Badge>{SOURCE_LABEL[signal.source]}</Badge>
              {signal.managerAssessment && (
                <Badge tone="info">{ASSESSMENT_LABEL[signal.managerAssessment]}</Badge>
              )}
              {signal.ownerName && <Badge>Owner: {signal.ownerName}</Badge>}
            </span>
          </span>
        </span>
        <Badge tone={ATTENTION_TONE[signal.attention]} className="shrink-0">
          {PLANNING_ATTENTION_LABEL[signal.attention]}
        </Badge>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
          {signal.whyMayMatter && (
            <div>
              <div className="text-xs font-medium text-ink-muted">Why this may matter</div>
              <p className="text-ink">{signal.whyMayMatter}</p>
            </div>
          )}
          {signal.potentialImplications && (
            <div>
              <div className="text-xs font-medium text-ink-muted">Potential implications</div>
              <p className="text-ink">{signal.potentialImplications}</p>
            </div>
          )}
          {signal.sourceLink && (
            <p className="text-xs text-ink-faint">Source: {signal.sourceLink}</p>
          )}
          {signal.suggestedAttention !== signal.attention && (
            <p className="text-xs text-ink-faint">
              System suggested {PLANNING_ATTENTION_LABEL[signal.suggestedAttention]}
              {signal.attentionRationale ? ` — changed because: ${signal.attentionRationale}` : ''}
            </p>
          )}

          {editable ? (
            <div className="space-y-3 rounded-lg bg-surface-raised p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Manager assessment">
                  <Select
                    value={assessment}
                    onChange={(e) => setAssessment(e.target.value as PlanningSignalAssessment)}
                  >
                    <option value="">— Not yet assessed —</option>
                    {(Object.keys(ASSESSMENT_LABEL) as PlanningSignalAssessment[]).map((a) => (
                      <option key={a} value={a}>
                        {ASSESSMENT_LABEL[a]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Attention level">
                  <Select
                    value={attention}
                    onChange={(e) => setAttention(e.target.value as PlanningAttention)}
                  >
                    {PLANNING_ATTENTIONS.map((a) => (
                      <option key={a} value={a}>
                        {PLANNING_ATTENTION_LABEL[a]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {downgradesIpa && (
                <Field label="Why downgrade from Immediate Partner Attention?" required>
                  <Textarea
                    rows={2}
                    value={attentionRationale}
                    onChange={(e) => setAttentionRationale(e.target.value)}
                  />
                </Field>
              )}
              {(needsRationale || assessment) && (
                <Field
                  label={needsRationale ? 'Why is this not relevant?' : 'Rationale'}
                  required={needsRationale}
                >
                  <Textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} />
                </Field>
              )}
              {(assessment === 'further_information_required' || signal.ownerName) && (
                <Field
                  label="Owner"
                  required={needsOwner}
                  hint={signal.ownerName ? `Currently ${signal.ownerName}` : undefined}
                >
                  <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">— Select —</option>
                    {team.map((m) => (
                      <option key={m.employeeId} value={m.employeeId}>
                        {m.employeeName}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <div>
                <div className="mb-1 text-sm font-medium text-ink">Carry forward to</div>
                <div className="flex flex-wrap gap-2">
                  {PLANNING_DESTINATIONS.map((d) => (
                    <label key={d} className="inline-flex items-center gap-1.5 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked={destinations.includes(d)}
                        onChange={(e) =>
                          setDestinations((cur) =>
                            e.target.checked ? [...cur, d] : cur.filter((x) => x !== d),
                          )
                        }
                      />
                      {DESTINATION_LABEL[d]}
                    </label>
                  ))}
                </div>
              </div>
              <Button onClick={() => save.mutate()} disabled={save.isPending || blocked}>
                Save assessment
              </Button>
            </div>
          ) : (
            signal.assessmentRationale && (
              <p className="text-ink-muted">Rationale: {signal.assessmentRationale}</p>
            )
          )}
        </div>
      )}
    </Card>
  );
}

function NewSignalForm({
  base,
  onDone,
  onChanged,
}: {
  base: string;
  onDone: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [source, setSource] = useState<PlanningSignalSource>('manager');
  const [observation, setObservation] = useState('');
  const [why, setWhy] = useState('');
  const [attention, setAttention] = useState<PlanningAttention>('standard');

  const create = useMutation({
    mutationFn: () =>
      apiFetch<PlanningSignalRecord>(`${base}/planning-signals`, {
        method: 'POST',
        body: {
          source,
          observation,
          whyMayMatter: why || undefined,
          suggestedAttention: attention,
        },
      }),
    onSuccess: (s) => {
      toast(`${s.signalCode} raised.`);
      onChanged();
      onDone();
    },
    onError: (e) => toast(errMsg(e, 'Could not raise the signal.')),
  });

  return (
    <Card className="space-y-3 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Raised by">
          <Select value={source} onChange={(e) => setSource(e.target.value as PlanningSignalSource)}>
            <option value="manager">Manager</option>
            <option value="partner">Engagement Partner</option>
            <option value="prior_year">Prior-year matter</option>
          </Select>
        </Field>
        <Field label="Attention level">
          <Select value={attention} onChange={(e) => setAttention(e.target.value as PlanningAttention)}>
            {PLANNING_ATTENTIONS.map((a) => (
              <option key={a} value={a}>
                {PLANNING_ATTENTION_LABEL[a]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Observation" hint="State the fact only — not a risk conclusion." required>
        <Textarea rows={2} value={observation} onChange={(e) => setObservation(e.target.value)} />
      </Field>
      <Field label="Why this may matter">
        <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button onClick={() => create.mutate()} disabled={create.isPending || !observation.trim()}>
          Raise signal
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

// ── 03.1.2 Significant changes (PI-01) ──────────────────────────────────────

function ChangesSection({
  base,
  qk,
  editable,
  onChanged,
}: {
  base: string;
  qk: string[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const changes = useQuery({
    queryKey: [...qk, 'changes'],
    queryFn: () => apiFetch<PlanningChangeRecord[]>(`${base}/planning-changes`),
  });
  const [category, setCategory] = useState<PlanningChangeCategory | ''>('');
  const [description, setDescription] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [sourceEvidence, setSourceEvidence] = useState('');
  const [frImpact, setFrImpact] = useState<PlanningChangeFrImpact | ''>('');
  const [createSignal, setCreateSignal] = useState(true);

  const reset = () => {
    setCategory('');
    setDescription('');
    setEffectiveDate('');
    setSourceEvidence('');
    setFrImpact('');
    setCreateSignal(true);
  };

  const add = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<PlanningChangeRecord>(`${base}/planning-changes`, { method: 'POST', body }),
    onSuccess: (c) => {
      toast(
        c.signalId
          ? `${PLANNING_CHANGE_CATEGORY_LABEL[c.category]} recorded — signal created.`
          : `${PLANNING_CHANGE_CATEGORY_LABEL[c.category]} recorded.`,
      );
      reset();
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not record the change.')),
  });

  const list = changes.data ?? [];
  const noneRecorded = list.some((c) => c.category === 'no_significant_change');
  const isNone = category === 'no_significant_change';

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Record what changed since the prior year. Capture the facts only — you are not asked to name
        an audit risk here.
      </p>
      {changes.isLoading && <Spinner label="Loading changes…" />}
      {list.map((c) => (
        <Card key={c.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
          <div className="min-w-0">
            <div className="font-medium text-ink">{PLANNING_CHANGE_CATEGORY_LABEL[c.category]}</div>
            {c.description && <p className="text-ink-muted">{c.description}</p>}
            <p className="text-[11px] text-ink-faint">
              {[
                c.effectiveDate && `Effective ${c.effectiveDate}`,
                c.frImpactKnown && `FR impact known: ${FR_IMPACT_LABEL[c.frImpactKnown]}`,
                c.sourceEvidence && `Source: ${c.sourceEvidence}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {c.signalId && <Badge tone="info">Signal raised</Badge>}
        </Card>
      ))}
      {!changes.isLoading && list.length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
          No changes recorded yet. PI-01 must be completed — record each change, or confirm there
          was no significant change.
        </p>
      )}

      {editable && (
        <Card className="space-y-3 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Change category" required>
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value as PlanningChangeCategory)}
              >
                <option value="">— Select —</option>
                {PLANNING_CHANGE_CATEGORIES.filter(
                  (c) => !(c === 'no_significant_change' && noneRecorded),
                ).map((c) => (
                  <option key={c} value={c}>
                    {PLANNING_CHANGE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            {!isNone && (
              <Field label="Effective date">
                <Input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
              </Field>
            )}
          </div>
          {!isNone && (
            <>
              <Field label="What changed?">
                <Textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Source / evidence">
                  <Input
                    placeholder="e.g. Board minutes 12-Jun"
                    value={sourceEvidence}
                    onChange={(e) => setSourceEvidence(e.target.value)}
                  />
                </Field>
                <Field label="Potential financial-reporting impact known?">
                  <Select
                    value={frImpact}
                    onChange={(e) => setFrImpact(e.target.value as PlanningChangeFrImpact)}
                  >
                    <option value="">— Select —</option>
                    {(Object.keys(FR_IMPACT_LABEL) as PlanningChangeFrImpact[]).map((k) => (
                      <option key={k} value={k}>
                        {FR_IMPACT_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={createSignal}
                  onChange={(e) => setCreateSignal(e.target.checked)}
                />
                Raise a Planning Signal from this change
              </label>
            </>
          )}
          <Button
            onClick={() =>
              add.mutate({
                category,
                description: description || undefined,
                effectiveDate: effectiveDate || undefined,
                sourceEvidence: sourceEvidence || undefined,
                frImpactKnown: frImpact || undefined,
                createSignal: !isNone && createSignal,
              })
            }
            disabled={add.isPending || !category}
          >
            {isNone ? 'Confirm no significant change' : 'Record change'}
          </Button>
        </Card>
      )}
    </div>
  );
}

// ── 03.1.4 Areas of Focus (§11) ─────────────────────────────────────────────

function FocusSection({
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
  const focus = useQuery({
    queryKey: [...qk, 'focus'],
    queryFn: () => apiFetch<AreaOfFocusRecord[]>(`${base}/areas-of-focus`),
  });
  const [adding, setAdding] = useState(false);
  const byId = new Map(signals.map((s) => [s.id, s]));

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Group related signals into a smaller set of meaningful Areas of Focus, so the Partner sees
        one coherent matter instead of several disconnected alerts.
      </p>
      {focus.isLoading && <Spinner label="Loading Areas of Focus…" />}
      {(focus.data ?? []).map((f) => (
        <FocusCard
          key={`${f.id}-${f.version}`}
          engagementId={engagementId}
          focus={f}
          signals={signals}
          byId={byId}
          editable={editable}
          onChanged={onChanged}
        />
      ))}
      {!focus.isLoading && (focus.data ?? []).length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
          No Areas of Focus yet.
        </p>
      )}
      {editable &&
        (adding ? (
          <FocusForm
            signals={signals}
            onCancel={() => setAdding(false)}
            submitLabel="Create Area of Focus"
            submit={(body) =>
              apiFetch<AreaOfFocusRecord>(`${base}/areas-of-focus`, { method: 'POST', body })
            }
            onSaved={() => {
              setAdding(false);
              onChanged();
            }}
          />
        ) : (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Area of Focus
          </Button>
        ))}
    </div>
  );
}

function FocusCard({
  engagementId,
  focus,
  signals,
  byId,
  editable,
  onChanged,
}: {
  engagementId: string;
  focus: AreaOfFocusRecord;
  signals: PlanningSignalRecord[];
  byId: Map<string, PlanningSignalRecord>;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <FocusForm
        initial={focus}
        signals={signals}
        onCancel={() => setEditing(false)}
        submitLabel="Save"
        submit={(body) =>
          apiFetch<AreaOfFocusRecord>(
            `/engagements/${engagementId}/statutory-audit/areas-of-focus/${focus.id}`,
            { method: 'POST', body: { ...body, version: focus.version } },
          )
        }
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    );
  }
  return (
    <Card className="p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-2 font-mono text-xs text-ink-faint">{focus.focusCode}</span>
          <span className="font-medium text-ink">{focus.name}</span>
          {focus.whyRequiresAttention && (
            <p className="text-ink-muted">{focus.whyRequiresAttention}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {focus.partnerAttention && <Badge tone="danger">Partner attention</Badge>}
          <Badge tone={focus.status === 'established' ? 'success' : 'neutral'}>{focus.status}</Badge>
          {editable && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      </div>
      {focus.signalIds.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-xs text-ink-muted">
          {focus.signalIds.map((id) => {
            const s = byId.get(id);
            return (
              <li key={id}>
                <span className="font-mono text-ink-faint">{s?.signalCode ?? '—'}</span>{' '}
                {s?.observation ?? 'Signal'}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function FocusForm({
  initial,
  signals,
  submitLabel,
  submit,
  onCancel,
  onSaved,
}: {
  initial?: AreaOfFocusRecord;
  signals: PlanningSignalRecord[];
  submitLabel: string;
  submit: (body: Record<string, unknown>) => Promise<AreaOfFocusRecord>;
  onCancel: () => void;
  onSaved: () => void;
}): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [why, setWhy] = useState(initial?.whyRequiresAttention ?? '');
  const [implication, setImplication] = useState(initial?.expectedStrategicImplication ?? '');
  const [fsAreas, setFsAreas] = useState((initial?.potentialFsAreas ?? []).join(', '));
  const [partner, setPartner] = useState(initial?.partnerAttention ?? false);
  const [established, setEstablished] = useState(initial ? initial.status === 'established' : true);
  const [picked, setPicked] = useState<string[]>(initial?.signalIds ?? []);
  const open = signals.filter((s) => s.status !== 'closed' || picked.includes(s.id));

  const save = useMutation({
    mutationFn: () =>
      submit({
        name,
        whyRequiresAttention: why || undefined,
        expectedStrategicImplication: implication || undefined,
        potentialFsAreas: fsAreas
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        partnerAttention: partner,
        signalIds: picked,
        ...(initial ? { status: established ? 'established' : 'open' } : {}),
      }),
    onSuccess: (f) => {
      toast(`${f.focusCode} saved.`);
      onSaved();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the Area of Focus.')),
  });

  return (
    <Card className="space-y-3 p-3">
      <Field label="Name" required>
        <Input
          placeholder="e.g. Financial Reporting Systems & Controls"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Why it requires attention">
        <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Potential FS areas" hint="Comma-separated. Not a final audit-area decision.">
          <Input value={fsAreas} onChange={(e) => setFsAreas(e.target.value)} />
        </Field>
        <Field label="Expected strategic implication">
          <Input value={implication} onChange={(e) => setImplication(e.target.value)} />
        </Field>
      </div>
      <div>
        <div className="mb-1 text-sm font-medium text-ink">Underlying Planning Signals</div>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
          {open.length === 0 && <p className="text-xs text-ink-faint">No signals to link.</p>}
          {open.map((s) => (
            <label key={s.id} className="flex items-start gap-2 text-xs text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={picked.includes(s.id)}
                onChange={(e) =>
                  setPicked((cur) =>
                    e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id),
                  )
                }
              />
              <span>
                <span className="font-mono text-ink-faint">{s.signalCode}</span> {s.observation}
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={partner} onChange={(e) => setPartner(e.target.checked)} />
          Requires Partner attention
        </label>
        {initial && (
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={established}
              onChange={(e) => setEstablished(e.target.checked)}
            />
            Established
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

// ── 03.1.5 Overall direction + 03.1.9 Strategy Summary ──────────────────────

function StrategySection({
  base,
  summary,
  editable,
  onChanged,
}: {
  base: string;
  summary: PlanningIntelligenceSummary;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const r = summary.record;
  const [orientation, setOrientation] = useState<AuditOrientation | ''>(r.orientation ?? '');
  const [orientationNote, setOrientationNote] = useState(r.orientationNote ?? '');
  const [scopeRequired, setScopeRequired] = useState<boolean | null>(r.additionalScopeRequired);
  const [additionalScope, setAdditionalScope] = useState(r.additionalScope ?? '');
  const [priorYearReviewed, setPriorYearReviewed] = useState(r.priorYearReviewed);
  const [strategySummary, setStrategySummary] = useState(r.strategySummary ?? '');

  const save = useMutation({
    mutationFn: (status?: PlanningIntelligenceStatus) =>
      apiFetch<PlanningIntelligenceSummary>(`${base}/planning-intelligence`, {
        method: 'POST',
        body: {
          // Send text as-is (empty string clears it); omitted fields stay unchanged.
          orientation: orientation || undefined,
          orientationNote,
          additionalScopeRequired: scopeRequired ?? undefined,
          additionalScope: scopeRequired === false ? '' : additionalScope,
          priorYearReviewed,
          strategySummary,
          // Recording AS-01 establishes the strategy (§4 status flow).
          status:
            status ??
            (orientation && !['strategy_established', 'complete'].includes(r.status)
              ? 'strategy_established'
              : undefined),
          version: r.version,
        },
      }),
    onSuccess: (_s, status) => {
      toast(status === 'complete' ? '03.1 completed.' : 'Overall direction saved.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save.')),
  });

  const draft = useMutation({
    mutationFn: () =>
      apiFetch<{ draft: string }>(`${base}/planning-intelligence/strategy-draft`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (d) => {
      setStrategySummary(d.draft);
      toast('Draft generated from the structured record — review and edit before saving.');
    },
    onError: (e) => toast(errMsg(e, 'Could not draft the summary.')),
  });

  if (!editable) {
    return (
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-xs font-medium text-ink-muted">AS-01 Overall audit orientation</div>
          <p className="text-ink">
            {r.orientation ? AUDIT_ORIENTATION_LABEL[r.orientation] : 'Not yet recorded.'}
          </p>
          {r.orientationNote && <p className="text-ink-muted">{r.orientationNote}</p>}
        </div>
        <div>
          <div className="text-xs font-medium text-ink-muted">AS-02 Additional scope</div>
          <p className="text-ink">
            {r.additionalScopeRequired === false
              ? 'No additional scope considerations.'
              : (r.additionalScope ?? 'Not yet answered.')}
          </p>
        </div>
        {r.strategySummary && (
          <div>
            <div className="text-xs font-medium text-ink-muted">Strategy summary</div>
            <p className="whitespace-pre-wrap text-ink">{r.strategySummary}</p>
          </div>
        )}
        <CompletionChecklist checks={summary.completion} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">AS-01 · Preliminary overall audit orientation</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {AUDIT_ORIENTATIONS.map((o) => (
            <label key={o} className="inline-flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="as01"
                checked={orientation === o}
                onChange={() => setOrientation(o)}
              />
              {AUDIT_ORIENTATION_LABEL[o]}
            </label>
          ))}
        </div>
        <p className="flex items-start gap-1.5 rounded-md bg-primary-50 px-2 py-1.5 text-xs text-primary-700">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This is a preliminary strategic direction. Final control reliance and audit responses are
          determined after risk and control assessment.
        </p>
        <Field label="Note">
          <Textarea
            rows={2}
            value={orientationNote}
            onChange={(e) => setOrientationNote(e.target.value)}
          />
        </Field>
      </Card>

      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">
          AS-02 · Are there additional scope considerations that should direct team effort?
        </div>
        <p className="text-xs text-ink-muted">
          Section 02 scope facts (standalone/CFS, components, other auditors, ICFR, CARO) are
          already captured. A framework correction goes back to Section 02, not here.
        </p>
        <div className="flex gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="as02"
              checked={scopeRequired === false}
              onChange={() => setScopeRequired(false)}
            />
            No
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="as02"
              checked={scopeRequired === true}
              onChange={() => setScopeRequired(true)}
            />
            Yes — add scope consideration
          </label>
        </div>
        {scopeRequired && (
          <Field label="Scope consideration" required>
            <Textarea
              rows={2}
              value={additionalScope}
              onChange={(e) => setAdditionalScope(e.target.value)}
            />
          </Field>
        )}
      </Card>

      {!summary.initialAudit && (
        <Card className="p-3">
          <label className="inline-flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={priorYearReviewed}
              onChange={(e) => setPriorYearReviewed(e.target.checked)}
            />
            <span>
              Prior-year audit file reviewed
              <span className="block text-xs text-ink-muted">
                Tick when there are no prior-year matters to carry. Any matters recorded on the
                Prior year tab must still be reassessed.
              </span>
            </span>
          </label>
        </Card>
      )}

      <Card className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-ink">Strategy summary</div>
          <Button variant="ghost" onClick={() => draft.mutate()} disabled={draft.isPending}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Draft from structured data
          </Button>
        </div>
        <Textarea
          rows={10}
          value={strategySummary}
          onChange={(e) => setStrategySummary(e.target.value)}
          placeholder="Draft the summary from the signals and Areas of Focus, then edit the commentary."
        />
        <p className="text-[11px] text-ink-faint">
          The structured signals and Areas of Focus stay authoritative. The consolidated Audit
          Planning Memorandum is generated later, at 03.12.
        </p>
      </Card>

      <CompletionChecklist checks={summary.completion} />

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
          Save
        </Button>
        <Button
          onClick={() => save.mutate('complete')}
          disabled={save.isPending || r.status === 'complete'}
          title="Completes 03.1 once every checklist item above is met."
        >
          {r.status === 'complete' ? '03.1 complete' : 'Complete 03.1'}
        </Button>
      </div>
    </div>
  );
}
