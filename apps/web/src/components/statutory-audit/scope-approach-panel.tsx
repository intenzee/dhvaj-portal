'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Info, Plus, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import {
  AP01_LABEL,
  AP01_OPTIONS,
  ASSURANCE_REPORT,
  ASSURANCE_REPORT_LABEL,
  CONFIRMATION_AREA_LABEL,
  CONFIRMATION_AREAS,
  CONTROLS_RELIANCE_NOTE,
  CUEC_ANSWERS,
  DECISION_STATUS_LABEL,
  DEPENDENCY_IMPACT_LABEL,
  DEPENDENCY_IMPACTS,
  DEPENDENCY_OWNER_PARTIES,
  DEPENDENCY_OWNER_PARTY_LABEL,
  DEPENDENCY_STATUS_LABEL,
  DEPENDENCY_STATUSES,
  DT01_LABEL,
  DT01_OPTIONS,
  EC01_ANSWERS,
  EC01_LABEL,
  FS_COVERED,
  FS_COVERED_LABEL,
  IA01_LABEL,
  IA01_OPTIONS,
  IMPLICATION_RESPONSE_LABEL,
  IMPLICATION_RESPONSES,
  INVENTORY_DECISION_LABEL,
  INVENTORY_DECISIONS,
  MAP_CONTROLS_STRATEGIES,
  MAP_CONTROLS_STRATEGY_LABEL,
  MAP_DESTINATION_NOTE,
  MAP_EVIDENCE_CATEGORIES,
  MAP_EVIDENCE_LABEL,
  MAP_TIMING_LABEL,
  MAP_TIMINGS,
  NEEDED_BY,
  NEEDED_BY_LABEL,
  OB_INPUTS,
  OB01_LABEL,
  OB01_OPTIONS,
  OTHER_AUDITOR_STRATEGIES,
  OTHER_AUDITOR_STRATEGY_LABEL,
  PARTNER_ACTION_LABEL,
  PARTNER_ACTIONS,
  ROLL_FORWARD,
  ROLL_FORWARD_LABEL,
  SC02_ANSWERS,
  SC02_LABEL,
  SCOPE_AFFECTED_MODULES,
  SCOPE_CONCLUSION_LABEL,
  SCOPE_CONCLUSIONS,
  SCOPE_LIMITATION_NOTE,
  SCOPE_REVISION_IMPACT,
  SCOPE_REVISION_TRIGGER_LABEL,
  SCOPE_REVISION_TRIGGERS,
  SCOPE_STATUS_LABEL,
  SCOPE_UNIT_TYPE_LABEL,
  SCOPE_UNIT_TYPES,
  SL01_ANSWERS,
  SL01_LABEL,
  SO01_LABEL,
  SO01_OPTIONS,
  SPECIAL_CONSIDERATION_LABEL,
  SPECIAL_CONSIDERATIONS,
  SPECIALIST_AREA_LABEL,
  SPECIALIST_AREAS,
  SPECIALIST_DECISION_LABEL,
  SPECIALIST_DECISIONS,
  TIMING_NOTE,
  UNIT_AUDITOR_LABEL,
  UNIT_AUDITORS,
  UNIT_RELEVANCE,
  UNIT_RELEVANCE_LABEL,
  type AreaOfFocusRecord,
  type PartnerScopeAction,
  type PlanningSignalRecord,
  type ScopeApproachSummary,
  type ScopeConsideration,
  type ScopeDecision,
  type ScopeDecisionKind,
  type ScopeDependency,
  type ScopeLimitation,
  type ScopeMapItem,
  type ScopeRevisionTrigger,
  type ScopeServiceOrg,
  type ScopeUnit,
  type SpecialistArea,
  type UpdateScopeApproachInput,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { Input, Select, Textarea } from '@/components/form';
import { CompletionChecklist } from './planning-strategy-sections';

/**
 * 03.4 Audit Scope & Approach (DHVAJ 03.4). "This is the population you are
 * auditing; these are the units and engagement characteristics that may affect
 * scope; these are the evidence channels and special considerations suggested
 * by what we already know. Decide the strategic audit approach, resolve
 * dependencies and explain exceptions." Nothing here is a scope exclusion by
 * materiality, a controls-effectiveness conclusion or a procedure.
 */

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`;
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
const label = (m: Record<string, string>, k: string | null | undefined) => (k ? (m[k] ?? k) : '—');

type Tab =
  | 'intelligence'
  | 'population'
  | 'approach'
  | 'evidence'
  | 'special'
  | 'dependencies'
  | 'map'
  | 'partner'
  | 'revision'
  | 'conclusion';

type Save = (body: Omit<UpdateScopeApproachInput, 'version'>, done?: string) => void;
type Post = (path: string, body: unknown, done: string) => void;

interface TabProps {
  s: ScopeApproachSummary;
  canEdit: boolean;
  save: Save;
  post: Post;
  pending: boolean;
}

export function ScopeApproachPanel({
  engagementId,
  workflowInstanceId,
  team,
  editable,
  canRevise,
  onChanged,
}: {
  engagementId: string;
  workflowInstanceId: string;
  team: TeamMember[];
  /** Planning is editable (lead, not yet approved). */
  editable: boolean;
  /** Lead rights: the approved strategy may be revised after planning approval (§27). */
  canRevise: boolean;
  onChanged: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('intelligence');
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}`;
  const qk = ['engagement', engagementId, 'scope-approach', workflowInstanceId];
  const summary = useQuery({
    queryKey: qk,
    queryFn: () => apiFetch<ScopeApproachSummary>(`${base}/scope-approach`),
  });
  const signals = useQuery({
    queryKey: ['engagement', engagementId, 'planning-intelligence', workflowInstanceId, 'signals'],
    queryFn: () => apiFetch<PlanningSignalRecord[]>(`${base}/planning-signals`),
  });
  const focus = useQuery({
    queryKey: ['engagement', engagementId, 'planning-intelligence', workflowInstanceId, 'focus'],
    queryFn: () => apiFetch<AreaOfFocusRecord[]>(`${base}/areas-of-focus`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'planning-intelligence', workflowInstanceId] });
    onChanged();
  };
  const mutation = useMutation({
    mutationFn: (v: { path: string; body: unknown; done: string }) =>
      apiFetch<ScopeApproachSummary>(`${base}/scope-approach${v.path}`, { method: 'POST', body: v.body }),
    onSuccess: (_r, v) => {
      toast(v.done);
      refresh();
    },
    onError: (e) => toast(errMsg(e, 'Could not save 03.4.')),
  });
  const post: Post = (path, body, done) => mutation.mutate({ path, body, done });
  const save: Save = (body, done) =>
    post('', { ...body, version: summary.data!.record.version }, done ?? 'Scope & approach saved.');

  if (summary.isLoading) return <Spinner label="Loading 03.4…" />;
  const s = summary.data;
  if (!s) return <p className="text-sm text-ink-muted">03.4 is unavailable.</p>;
  const r = s.record;
  const canEdit = r.status === 'draft' && (editable || (canRevise && r.versionNo > 1));
  const outstanding = s.completion.filter((c) => !c.met).length;
  const failing = s.consistency.filter((c) => !c.met).length;
  const k = `${r.id ?? 'new'}-${r.version}`;
  const common: TabProps = { s, canEdit, save, post, pending: mutation.isPending };
  const sig = signals.data ?? [];
  const foc = focus.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={r.status === 'complete' ? 'success' : r.status === 'reassessment_required' ? 'danger' : 'info'}>
            {r.versionLabel} · {r.id ? SCOPE_STATUS_LABEL[r.status] : 'Not started'}
          </Badge>
          {s.partnerAttention.length > 0 && <Badge tone="warn">{s.partnerAttention.length} Partner Attention</Badge>}
          {failing > 0 && <Badge tone="danger">{failing} consistency issue(s)</Badge>}
          {r.ap01 && <span className="text-xs text-ink-muted">AP-01: {AP01_LABEL[r.ap01]}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {s.authorities.map((a) => (
            <span
              key={a.code}
              title={a.title ? `${a.provisionNumber} — ${a.title}` : 'Not in the Authority Library'}
              className="inline-flex items-center gap-1 rounded bg-surface-raised px-1.5 py-0.5 text-[11px] text-ink-muted"
            >
              <BookOpen className="h-3 w-3" />
              {a.label}
            </span>
          ))}
        </div>
      </div>

      {r.status === 'reassessment_required' && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-danger-200 bg-danger-50 p-3 text-sm text-danger-800">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Reassessment Required — {r.reassessmentReason}. Nothing was changed automatically; start a revision to record the changed decision.
          </span>
          {canRevise && (
            <Button variant="secondary" onClick={() => setTab('revision')}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Revise
            </Button>
          )}
        </Card>
      )}
      {r.status === 'complete' && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-success-200 p-3 text-sm">
          <span className="text-ink-muted">
            {r.versionLabel} is complete{r.completedByName ? ` (${r.completedByName})` : ''}. It is never overwritten — a change needs a controlled revision (§27).
          </span>
          {canRevise && (
            <Button variant="secondary" onClick={() => setTab('revision')}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Revise strategy
            </Button>
          )}
        </Card>
      )}
      {!s.materiality && (
        <Card className="flex items-start gap-2 p-3 text-sm text-ink-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          03.3 Materiality is not complete yet — units and map areas show no materiality context. Materiality is an input to scope, never a mechanical exclusion rule.
        </Card>
      )}

      <div className="flex flex-wrap gap-1 border-b border-line">
        {(
          [
            ['intelligence', 'Scope intelligence'],
            ['population', `Population (${s.units.length})`],
            ['approach', 'Approach & controls'],
            ['evidence', 'Evidence'],
            ['special', 'Special considerations'],
            ['dependencies', 'Dependencies & limitations'],
            ['map', 'Approach map'],
            ['partner', 'Partner view'],
            ['revision', r.versionNo > 1 ? `Revision (${r.versionLabel})` : 'Revision & history'],
            ['conclusion', outstanding ? `Conclusion (${outstanding} to do)` : 'Conclusion'],
          ] as [Tab, string][]
        ).map(([key, text]) => (
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
            {text}
          </button>
        ))}
      </div>

      {tab === 'intelligence' && <IntelligenceTab key={k} {...common} />}
      {tab === 'population' && <PopulationTab key={k} {...common} signals={sig} focus={foc} />}
      {tab === 'approach' && <ApproachTab key={k} {...common} />}
      {tab === 'evidence' && <EvidenceTab key={k} {...common} />}
      {tab === 'special' && <SpecialTab key={k} {...common} signals={sig} />}
      {tab === 'dependencies' && <DependenciesTab key={k} {...common} team={team} />}
      {tab === 'map' && <MapTab key={k} {...common} signals={sig} focus={foc} />}
      {tab === 'partner' && <PartnerTab key={k} {...common} canAct={canRevise} />}
      {tab === 'revision' && <RevisionTab key={k} {...common} canRevise={canRevise} />}
      {tab === 'conclusion' && <ConclusionTab key={k} {...common} base={base} />}
    </div>
  );
}

// ── small building blocks ────────────────────────────────────────────────────

function Question({ code, text, children }: { code: string; text: string; children: React.ReactNode }): JSX.Element {
  return (
    <Card className="space-y-2 p-3">
      <div className="text-sm font-medium text-ink">{code}</div>
      <p className="text-sm text-ink-muted">{text}</p>
      {children}
    </Card>
  );
}

function Options<T extends string>({
  options,
  labels,
  value,
  onChange,
  disabled,
}: {
  options: readonly T[];
  labels: Record<string, string>;
  value: T | null;
  onChange: (v: T) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o)}
          className={`rounded border px-2 py-1 text-xs ${
            value === o ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-line text-ink-muted hover:text-ink'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {labels[o] ?? o}
        </button>
      ))}
    </div>
  );
}

function Checks<T extends string>({
  options,
  labels,
  value,
  onChange,
  disabled,
}: {
  options: readonly T[];
  labels: Record<string, string>;
  value: T[];
  onChange: (v: T[]) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((o) => (
        <label key={o} className="inline-flex items-center gap-1.5 text-xs text-ink">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.includes(o)}
            onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))}
          />
          {labels[o] ?? o}
        </label>
      ))}
    </div>
  );
}

function LinkPicker({
  items,
  value,
  onChange,
  disabled,
}: {
  items: { id: string; code: string; text: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}): JSX.Element {
  if (!items.length) return <span className="text-xs text-ink-faint">None available</span>;
  return (
    <div className="flex max-h-28 flex-col gap-1 overflow-y-auto">
      {items.map((i) => (
        <label key={i.id} className="inline-flex items-start gap-1.5 text-xs text-ink">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.includes(i.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, i.id] : value.filter((x) => x !== i.id))}
          />
          <span>
            <span className="font-mono text-ink-muted">{i.code}</span> {i.text.slice(0, 90)}
          </span>
        </label>
      ))}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p className="flex items-start gap-1.5 rounded bg-surface-raised px-2 py-1.5 text-xs text-ink-muted">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

// ── 03.4.1 / 03.4.2 Scope intelligence + FS scope ───────────────────────────

function IntelligenceTab({ s, canEdit, save, post, pending }: TabProps): JSX.Element {
  const r = s.record;
  const [sc01Other, setSc01Other] = useState(r.sc01Other ?? '');
  const [sc02Note, setSc02Note] = useState(r.sc02Note ?? '');
  const c = s.cards;
  const cards: [string, number][] = [
    ['Scope Units', c.scopeUnits],
    ['Material / Qualitatively Relevant', c.relevantUnits],
    ['Other Auditors', c.otherAuditors],
    ['Special Scope Considerations', c.specialConsiderations],
    ['Open Dependencies', c.openDependencies],
    ['Potential Scope Limitations', c.potentialLimitations],
    ['Partner Attention', c.partnerAttention],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {cards.map(([t, v]) => (
          <Card key={t} className="p-2.5">
            <div className="text-lg font-semibold text-ink">{v}</div>
            <div className="text-[11px] text-ink-muted">{t}</div>
          </Card>
        ))}
      </div>
      <Card className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-ink">Scope Intelligence (read-only)</div>
          {canEdit && (
            <Button variant="ghost" disabled={pending} onClick={() => post('/generate', {}, 'Refreshed from Section 02 / 03.1–03.3.')}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Refresh from sources
            </Button>
          )}
        </div>
        <table className="w-full text-xs">
          <tbody>
            {s.intelligence.map((i) => (
              <tr key={i.label} className="border-t border-line align-top">
                <td className="w-56 py-1 pr-2 text-ink-muted">{i.label}</td>
                <td className="py-1 pr-2 text-ink">{i.value}</td>
                <td className="w-24 py-1 text-right font-mono text-ink-faint">{i.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-ink-faint">Facts are not re-keyed here — corrections are made in the source section and 03.4 refreshes.</p>
      </Card>
      <Question code="SC-01 — Financial statements covered" text={`Prefilled from 02.6: ${FS_COVERED_LABEL[s.triggers.suggestedFsCovered ?? 'standalone']}.`}>
        <Options options={FS_COVERED} labels={FS_COVERED_LABEL} value={r.sc01} disabled={!canEdit || pending} onChange={(v) => save({ sc01: v }, 'SC-01 saved.')} />
        {r.sc01 === 'other' && (
          <div className="flex gap-2">
            <Input disabled={!canEdit} placeholder="Describe the other statutory financial statements" value={sc01Other} onChange={(e) => setSc01Other(e.target.value)} />
            {canEdit && (
              <Button variant="secondary" disabled={pending} onClick={() => save({ sc01Other }, 'Saved.')}>
                Save
              </Button>
            )}
          </div>
        )}
      </Question>
      <Question code="SC-02 — Confirmation" text="Does the above correctly represent the financial statements covered by this engagement? (Period, reporting date, FRF / Schedule III route and currency are read-only from Section 02.)">
        <Textarea rows={2} disabled={!canEdit} placeholder="If a correction is required, note what must change in Section 02" value={sc02Note} onChange={(e) => setSc02Note(e.target.value)} />
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {SC02_ANSWERS.map((a) => (
              <Button key={a} variant={r.sc02 === a ? 'primary' : 'secondary'} disabled={pending} onClick={() => save({ sc02: a, sc02Note }, 'SC-02 saved.')}>
                {SC02_LABEL[a]}
              </Button>
            ))}
          </div>
        )}
        {!canEdit && r.sc02 && <Badge tone={r.sc02 === 'yes' ? 'success' : 'warn'}>{SC02_LABEL[r.sc02]}</Badge>}
      </Question>
    </div>
  );
}

// ── 03.4.3 Audit population ──────────────────────────────────────────────────

function PopulationTab({
  s,
  canEdit,
  post,
  pending,
  signals,
  focus,
}: TabProps & { signals: PlanningSignalRecord[]; focus: AreaOfFocusRecord[] }): JSX.Element {
  const [name, setName] = useState('');
  const [type, setType] = useState<ScopeUnit['unitType']>('warehouse');
  return (
    <div className="space-y-3">
      <Note>
        Units are generated from Section 02 / 03.2 facts — no Trial Balance import. Materiality is shown as context only: no unit is excluded because a balance is below OM. SC-03 explains why a unit matters; it is not a risk assessment.
      </Note>
      {s.units.map((u) => (
        <UnitCard key={`${u.id}-${u.version}`} u={u} canEdit={canEdit} post={post} pending={pending} signals={signals} focus={focus} />
      ))}
      {canEdit && (
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <Input className="max-w-xs" placeholder="Add a unit (plant, warehouse, office, branch…)" value={name} onChange={(e) => setName(e.target.value)} />
          <Select className="max-w-[12rem]" value={type} onChange={(e) => setType(e.target.value as ScopeUnit['unitType'])}>
            {SCOPE_UNIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {SCOPE_UNIT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
          <Button disabled={!name.trim() || pending} onClick={() => post('/units', { name, unitType: type }, 'Unit added.')}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add unit
          </Button>
        </Card>
      )}
    </div>
  );
}

function UnitCard({
  u,
  canEdit,
  post,
  pending,
  signals,
  focus,
}: {
  u: ScopeUnit;
  canEdit: boolean;
  post: Post;
  pending: boolean;
  signals: PlanningSignalRecord[];
  focus: AreaOfFocusRecord[];
}): JSX.Element {
  const [f, setF] = useState({
    location: u.location ?? '',
    finMetric: u.finMetric ?? '',
    finAmount: u.finAmount?.toString() ?? '',
    finSource: u.finSource ?? '',
    finNotAvailable: u.finNotAvailable,
    relevance: u.relevance,
    relevanceOther: u.relevanceOther ?? '',
    qualitativeNote: u.qualitativeNote ?? '',
    signalIds: u.signalIds,
    focusIds: u.focusIds,
    specificMateriality: u.specificMateriality,
    auditor: u.auditor,
    auditorStrategy: u.auditorStrategy,
    scopeConclusion: u.scopeConclusion,
    rationale: u.rationale ?? '',
  });
  const set = <K extends keyof typeof f>(key: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [key]: v }));
  const dis = !canEdit;
  return (
    <Card className={`space-y-2 p-3 ${u.noLongerGenerated ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-xs text-ink-faint">{u.code}</span>
          <span className="font-medium text-ink">{u.name}</span>
          <Badge tone="neutral">{SCOPE_UNIT_TYPE_LABEL[u.unitType]}</Badge>
          {u.sourceLabel && <span className="text-[11px] text-ink-faint">{u.sourceLabel}</span>}
          {u.noLongerGenerated && <Badge tone="warn">Source no longer present — kept for the trail</Badge>}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {u.materialityContext && <span className="text-ink-muted">{u.materialityContext}</span>}
          {u.scopeConclusion && <Badge tone={u.scopeConclusion === 'in_scope' ? 'success' : 'info'}>{SCOPE_CONCLUSION_LABEL[u.scopeConclusion]}</Badge>}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Input disabled={dis} placeholder="Location / jurisdiction" value={f.location} onChange={(e) => set('location', e.target.value)} />
        <Input disabled={dis} placeholder="Financial indicator (e.g. Inventory)" value={f.finMetric} onChange={(e) => set('finMetric', e.target.value)} />
        <Input disabled={dis} type="number" placeholder="Amount (₹)" value={f.finAmount} onChange={(e) => set('finAmount', e.target.value)} />
        <Input disabled={dis} placeholder="Source of the amount" value={f.finSource} onChange={(e) => set('finSource', e.target.value)} />
      </div>
      <label className="inline-flex items-center gap-1.5 text-xs text-ink">
        <input type="checkbox" disabled={dis} checked={f.finNotAvailable} onChange={(e) => set('finNotAvailable', e.target.checked)} />
        Financial significance not yet available (creates an information dependency)
      </label>
      <div className="space-y-1">
        <div className="text-xs font-medium text-ink">SC-03 — Why is this unit relevant?</div>
        <Checks options={UNIT_RELEVANCE} labels={UNIT_RELEVANCE_LABEL} value={f.relevance} onChange={(v) => set('relevance', v)} disabled={dis} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Textarea rows={2} disabled={dis} placeholder="Qualitative relevance (regulatory, key process, fraud / focus, group reporting)" value={f.qualitativeNote} onChange={(e) => set('qualitativeNote', e.target.value)} />
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="text-[11px] text-ink-muted">Planning Signals</div>
            <LinkPicker disabled={dis} items={signals.map((x) => ({ id: x.id, code: x.signalCode, text: x.observation }))} value={f.signalIds} onChange={(v) => set('signalIds', v)} />
          </div>
          <div>
            <div className="text-[11px] text-ink-muted">Areas of Focus</div>
            <LinkPicker disabled={dis} items={focus.map((x) => ({ id: x.id, code: x.focusCode, text: x.name }))} value={f.focusIds} onChange={(v) => set('focusIds', v)} />
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Select disabled={dis} value={f.auditor} onChange={(e) => set('auditor', e.target.value as ScopeUnit['auditor'])}>
          {UNIT_AUDITORS.map((a) => (
            <option key={a} value={a}>
              Auditor: {UNIT_AUDITOR_LABEL[a]}
            </option>
          ))}
        </Select>
        {f.auditor !== 'dhvaj' && (
          <Select disabled={dis} value={f.auditorStrategy ?? ''} onChange={(e) => set('auditorStrategy', (e.target.value || null) as ScopeUnit['auditorStrategy'])}>
            <option value="">— Strategic conclusion (→ 03.9) —</option>
            {OTHER_AUDITOR_STRATEGIES.map((a) => (
              <option key={a} value={a}>
                {OTHER_AUDITOR_STRATEGY_LABEL[a]}
              </option>
            ))}
          </Select>
        )}
        <label className="inline-flex items-center gap-1.5 text-xs text-ink">
          <input type="checkbox" disabled={dis} checked={f.specificMateriality} onChange={(e) => set('specificMateriality', e.target.checked)} />
          Specific materiality relevant
        </label>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium text-ink">Manager scope conclusion</div>
        <Options options={SCOPE_CONCLUSIONS} labels={SCOPE_CONCLUSION_LABEL} value={f.scopeConclusion} disabled={dis} onChange={(v) => set('scopeConclusion', v)} />
        <Textarea rows={2} disabled={dis} placeholder="Rationale (required for exclusions / limited work where relevance exists)" value={f.rationale} onChange={(e) => set('rationale', e.target.value)} />
      </div>
      {canEdit && (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            post(
              `/units/${u.id}`,
              {
                ...f,
                finAmount: numOrNull(f.finAmount),
                auditorStrategy: f.auditor === 'dhvaj' ? null : f.auditorStrategy,
                version: u.version,
              },
              `${u.code} saved.`,
            )
          }
        >
          Save unit
        </Button>
      )}
    </Card>
  );
}

// ── 03.4.4 – 03.4.6 Approach, controls, timing ──────────────────────────────

function ApproachTab({ s, canEdit, save, post, pending }: TabProps): JSX.Element {
  const r = s.record;
  const [rationale, setRationale] = useState(r.ap01Rationale ?? '');
  const [icfr, setIcfr] = useState(r.icfrNote ?? '');
  return (
    <div className="space-y-3">
      {s.approachConsiderations.length > 0 && (
        <Card className="space-y-1 p-3">
          <div className="text-sm font-medium text-ink">Strategy considerations (system support — prompts, not conclusions)</div>
          {s.approachConsiderations.map((c) => (
            <p key={c.key} className="text-xs">
              <span className="text-ink">{c.label}</span> — <span className="text-ink-muted">{c.detail}</span>
            </p>
          ))}
        </Card>
      )}
      <Question code="AP-01 — Preliminary overall audit approach" text="Not Yet Determinable remains available — detailed controls understanding / testing happens later (Section 05).">
        <Options options={AP01_OPTIONS} labels={AP01_LABEL} value={r.ap01} disabled={!canEdit || pending} onChange={(v) => save({ ap01: v, ap01Rationale: rationale }, 'AP-01 saved.')} />
        <Textarea rows={2} disabled={!canEdit} placeholder="Rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
        {canEdit && (
          <Button variant="secondary" disabled={pending} onClick={() => save({ ap01Rationale: rationale }, 'Saved.')}>
            Save rationale
          </Button>
        )}
      </Question>
      {s.triggers.icfrApplicable && (
        <Question code="ICFR workstream" text="ICFR reporting is applicable (02.5). Confirm the separate statutory ICFR workstream is addressed — ICFR reporting is not the same as controls reliance for the financial statement audit.">
          <div className="flex gap-2">
            <Input disabled={!canEdit} placeholder="How the ICFR workstream is addressed" value={icfr} onChange={(e) => setIcfr(e.target.value)} />
            {canEdit && (
              <Button variant="secondary" disabled={pending} onClick={() => save({ icfrNote: icfr }, 'ICFR confirmation saved.')}>
                Save
              </Button>
            )}
          </div>
        </Question>
      )}
      <DecisionTable title="03.4.5 Controls reliance strategy (by major cycle)" note={CONTROLS_RELIANCE_NOTE} kind="controls_cycle" s={s} canEdit={canEdit} post={post} pending={pending} />
      <DecisionTable title="03.4.6 Interim / year-end strategy" note={TIMING_NOTE} kind="timing" s={s} canEdit={canEdit} post={post} pending={pending} rollForward />
    </div>
  );
}

function DecisionTable({
  title,
  note,
  kind,
  s,
  canEdit,
  post,
  pending,
  rollForward = false,
  allowCustom = true,
}: {
  title: string;
  note?: string;
  kind: ScopeDecisionKind;
  s: ScopeApproachSummary;
  canEdit: boolean;
  post: Post;
  pending: boolean;
  rollForward?: boolean;
  allowCustom?: boolean;
}): JSX.Element {
  const [custom, setCustom] = useState('');
  const items = s.decisions.filter((d) => d.kind === kind);
  return (
    <Card className="space-y-2 p-3">
      <div className="text-sm font-medium text-ink">{title}</div>
      {note && <Note>{note}</Note>}
      {items.map((d) => (
        <DecisionRow key={`${d.itemKey}-${d.version}`} d={d} canEdit={canEdit} post={post} pending={pending} rollForward={rollForward} />
      ))}
      {canEdit && allowCustom && (
        <div className="flex gap-2 border-t border-line pt-2">
          <Input className="max-w-xs" placeholder="Other significant item" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button variant="ghost" disabled={!custom.trim() || pending} onClick={() => post(`/decisions/${kind}`, { label: custom, version: 0 }, 'Item added.')}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}

function DecisionRow({
  d,
  canEdit,
  post,
  pending,
  rollForward,
}: {
  d: ScopeDecision;
  canEdit: boolean;
  post: Post;
  pending: boolean;
  rollForward: boolean;
}): JSX.Element {
  const [note, setNote] = useState(d.note ?? '');
  const send = (body: Record<string, unknown>) => post(`/decisions/${d.kind}/${d.itemKey}`, { ...body, version: d.version }, `${d.label}: saved.`);
  return (
    <div className="grid gap-2 border-t border-line pt-2 text-xs sm:grid-cols-12">
      <div className="sm:col-span-3">
        <div className="text-ink">{d.label}</div>
        {d.hint && <div className="text-ink-faint">{d.hint}</div>}
      </div>
      <div className="sm:col-span-5">
        <Options options={d.options} labels={DECISION_STATUS_LABEL} value={d.status} disabled={!canEdit || pending} onChange={(v) => send({ status: v })} />
        {d.prompt && <div className="mt-1 text-warn-700">{d.prompt}</div>}
      </div>
      {rollForward && (
        <Select className="sm:col-span-2" disabled={!canEdit || pending} value={d.rollForward ?? ''} onChange={(e) => send({ rollForward: e.target.value || null })}>
          <option value="">Roll-forward?</option>
          {ROLL_FORWARD.map((x) => (
            <option key={x} value={x}>
              {ROLL_FORWARD_LABEL[x]}
            </option>
          ))}
        </Select>
      )}
      <Input
        className={rollForward ? 'sm:col-span-2' : 'sm:col-span-4'}
        disabled={!canEdit}
        placeholder="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => canEdit && note !== (d.note ?? '') && send({ note })}
      />
    </div>
  );
}

// ── 03.4.7 Evidence strategy / EC-01 / physical / DT-01 ─────────────────────

function EvidenceTab({ s, canEdit, save, post, pending }: TabProps): JSX.Element {
  const r = s.record;
  const [ecNote, setEcNote] = useState(r.ec01Note ?? '');
  const [areas, setAreas] = useState(r.ec01Areas);
  const [invLoc, setInvLoc] = useState(r.inventoryLocations ?? '');
  const [invNote, setInvNote] = useState(r.inventoryNote ?? '');
  const [physNote, setPhysNote] = useState(r.physicalOtherNote ?? '');
  const [dtNote, setDtNote] = useState(r.dt01Note ?? '');
  const dis = !canEdit || pending;
  return (
    <div className="space-y-3">
      <DecisionTable title="Evidence channels (strategic expectations — not a procedure checklist)" kind="evidence_channel" s={s} canEdit={canEdit} post={post} pending={pending} allowCustom={false} />
      <Question code="EC-01 — External confirmations (SA 505)" text="Are external confirmations expected to be an important source of audit evidence? Populations, selections, control over requests and alternatives belong to 03.7 / execution.">
        <Options options={EC01_ANSWERS} labels={EC01_LABEL} value={r.ec01} disabled={dis} onChange={(v) => save({ ec01: v, ec01Areas: areas, ec01Note: ecNote }, 'EC-01 saved.')} />
        {s.suggestedConfirmationAreas.length > 0 && (
          <p className="text-xs text-ink-muted">Suggested from known facts: {s.suggestedConfirmationAreas.map((a) => CONFIRMATION_AREA_LABEL[a]).join(', ')}.</p>
        )}
        <Checks options={CONFIRMATION_AREAS} labels={CONFIRMATION_AREA_LABEL} value={areas} onChange={setAreas} disabled={!canEdit} />
        <div className="flex gap-2">
          <Input disabled={!canEdit} placeholder="Note" value={ecNote} onChange={(e) => setEcNote(e.target.value)} />
          {canEdit && (
            <Button variant="secondary" disabled={pending} onClick={() => save({ ec01Areas: areas, ec01Note: ecNote }, 'Saved.')}>
              Save
            </Button>
          )}
        </div>
      </Question>
      <Question
        code="Physical observation / inventory attendance (SA 501)"
        text={s.triggers.inventoryRelevant ? `${s.triggers.inventoryReason} Decide the strategic attendance approach — count samples are not designed here.` : 'No material / relevant inventory identified from known facts.'}
      >
        <Options options={INVENTORY_DECISIONS} labels={INVENTORY_DECISION_LABEL} value={r.inventoryDecision} disabled={dis} onChange={(v) => save({ inventoryDecision: v, inventoryLocations: invLoc, inventoryNote: invNote }, 'Inventory strategy saved.')} />
        {(r.inventoryDecision === 'alternative_assessment' || r.inventoryDecision === 'information_required') && (
          <Note>Must be owned before completion — add an owned Scope Dependency for inventory.</Note>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input disabled={!canEdit} placeholder="Locations requiring scope assessment" value={invLoc} onChange={(e) => setInvLoc(e.target.value)} />
          <Input disabled={!canEdit} placeholder="Note" value={invNote} onChange={(e) => setInvNote(e.target.value)} />
        </div>
        <div className="text-xs font-medium text-ink">Cash / securities / other physical assets — observation / inspection expected?</div>
        <Options options={EC01_ANSWERS} labels={EC01_LABEL} value={r.physicalOther} disabled={dis} onChange={(v) => save({ physicalOther: v, physicalOtherNote: physNote }, 'Saved.')} />
        <div className="flex gap-2">
          <Input disabled={!canEdit} placeholder="Note on other physical assets" value={physNote} onChange={(e) => setPhysNote(e.target.value)} />
          {canEdit && (
            <Button variant="secondary" disabled={pending} onClick={() => save({ inventoryLocations: invLoc, inventoryNote: invNote, physicalOtherNote: physNote }, 'Saved.')}>
              Save notes
            </Button>
          )}
        </div>
      </Question>
      <Question code="DT-01 — Technology & data" text="Is technology / data expected to be used materially in obtaining audit evidence? 03.4 records intended use only; if data access is uncertain, add a Scope Dependency.">
        <Options options={DT01_OPTIONS} labels={DT01_LABEL} value={r.dt01} disabled={dis} onChange={(v) => save({ dt01: v, dt01Note: dtNote }, 'DT-01 saved.')} />
        <div className="flex gap-2">
          <Input disabled={!canEdit} placeholder="Note" value={dtNote} onChange={(e) => setDtNote(e.target.value)} />
          {canEdit && (
            <Button variant="secondary" disabled={pending} onClick={() => save({ dt01Note: dtNote }, 'Saved.')}>
              Save
            </Button>
          )}
        </div>
      </Question>
      {r.dt01 && r.dt01 !== 'no' && <DecisionTable title="Potential technology uses" kind="technology_use" s={s} canEdit={canEdit} post={post} pending={pending} />}
    </div>
  );
}

// ── 03.4.8 Triggered special considerations ─────────────────────────────────

function SpecialTab({ s, canEdit, save, post, pending, signals }: TabProps & { signals: PlanningSignalRecord[] }): JSX.Element {
  const r = s.record;
  const t = s.triggers;
  const [ob, setOb] = useState<Record<string, string>>(r.obInputs);
  const [obNote, setObNote] = useState(r.ob01Note ?? '');
  const [iaNote, setIaNote] = useState(r.ia01Note ?? '');
  const [joint, setJoint] = useState(r.jointAuditNote ?? '');
  const [provider, setProvider] = useState('');
  const [spArea, setSpArea] = useState<SpecialistArea>('valuation');
  const [spText, setSpText] = useState('');
  const [spSignal, setSpSignal] = useState('');
  const dis = !canEdit || pending;
  const implications = s.considerations.filter((c) => c.kind === 'implication');
  const specialists = s.considerations.filter((c) => c.kind === 'specialist');
  const otherAuditorUnits = s.units.filter((u) => u.auditor !== 'dhvaj');
  return (
    <div className="space-y-3">
      {t.initialAudit && (
        <Question code="OB-01 — Initial audit / opening balances (SA 510)" text="Activated automatically because 02.1 records an initial audit. Initial audit with no opening-balance strategy blocks completion. Detailed SA 510 procedures are generated later in the Audit Programme.">
          <div className="grid gap-2 sm:grid-cols-2">
            {OB_INPUTS.map((i) => (
              <label key={i.key} className="flex items-center justify-between gap-2 text-xs text-ink">
                {i.label}
                <Select className="max-w-[10rem]" disabled={!canEdit} value={ob[i.key] ?? ''} onChange={(e) => setOb({ ...ob, [i.key]: e.target.value })}>
                  <option value="">—</option>
                  {i.options.map((o) => (
                    <option key={o} value={o}>
                      {o.replace(/_/g, ' ')}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <Options options={OB01_OPTIONS} labels={OB01_LABEL} value={r.ob01} disabled={dis} onChange={(v) => save({ ob01: v, obInputs: ob, ob01Note: obNote }, 'OB-01 saved.')} />
          <div className="flex gap-2">
            <Input disabled={!canEdit} placeholder="Note (accounting policy changes, prior report modification…)" value={obNote} onChange={(e) => setObNote(e.target.value)} />
            {canEdit && (
              <Button variant="secondary" disabled={pending} onClick={() => save({ obInputs: ob, ob01Note: obNote }, 'Saved.')}>
                Save
              </Button>
            )}
          </div>
        </Question>
      )}

      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Service organisations (SO-01, SA 402)</div>
        {!t.serviceOrganisation && s.serviceOrgs.length === 0 && <p className="text-xs text-ink-faint">No financially relevant service organisation identified in 02 / 03.2.</p>}
        {s.serviceOrgs.map((o) => (
          <ServiceOrgCard key={`${o.id}-${o.version}`} o={o} canEdit={canEdit} post={post} pending={pending} />
        ))}
        {canEdit && (
          <div className="flex gap-2 border-t border-line pt-2">
            <Input className="max-w-xs" placeholder="Service provider" value={provider} onChange={(e) => setProvider(e.target.value)} />
            <Button variant="ghost" disabled={!provider.trim() || pending} onClick={() => post('/service-orgs', { provider }, 'Service organisation card added.')}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add card
            </Button>
          </div>
        )}
      </Card>

      {t.internalAuditFunction && (
        <Question code="IA-01 — Internal audit (SA 610)" text="An internal audit function exists. Is use of its work being considered for the statutory audit? 03.4 does not conclude that the function is suitable for use.">
          <Options options={IA01_OPTIONS} labels={IA01_LABEL} value={r.ia01} disabled={dis} onChange={(v) => save({ ia01: v, ia01Note: iaNote }, 'IA-01 saved.')} />
          <Input disabled={!canEdit} placeholder="Note" value={iaNote} onChange={(e) => setIaNote(e.target.value)} onBlur={() => canEdit && iaNote !== (r.ia01Note ?? '') && save({ ia01Note: iaNote }, 'Saved.')} />
        </Question>
      )}

      {(otherAuditorUnits.length > 0 || t.jointAudit) && (
        <Card className="space-y-2 p-3">
          <div className="text-sm font-medium text-ink">Other auditor / component / branch strategy (→ 03.9)</div>
          {otherAuditorUnits.map((u) => (
            <p key={u.id} className="text-xs">
              <span className="font-mono text-ink-faint">{u.code}</span> {u.name} — {UNIT_AUDITOR_LABEL[u.auditor]}:{' '}
              {u.auditorStrategy ? <span className="text-ink">{OTHER_AUDITOR_STRATEGY_LABEL[u.auditorStrategy]}</span> : <span className="text-danger-700">no strategic conclusion (set on the Population tab)</span>}
            </p>
          ))}
          {t.jointAudit && (
            <div className="flex gap-2">
              <Input disabled={!canEdit} placeholder="Joint audit — strategic division consideration" value={joint} onChange={(e) => setJoint(e.target.value)} />
              {canEdit && (
                <Button variant="secondary" disabled={pending} onClick={() => save({ jointAuditNote: joint }, 'Saved.')}>
                  Save
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Experts / specialists (→ 03.8)</div>
        <p className="text-xs text-ink-muted">From specialist-related Planning Signals (routed to 03.8) and Manager additions. Names, competence and detailed scope belong in 03.8.</p>
        {specialists.length === 0 && <p className="text-xs text-ink-faint">No specialist prompts.</p>}
        {specialists.map((c) => (
          <ConsiderationRow key={`${c.id}-${c.version}`} c={c} canEdit={canEdit} post={post} pending={pending} />
        ))}
        {canEdit && (
          <div className="grid gap-2 border-t border-line pt-2 sm:grid-cols-4">
            <Select value={spArea} onChange={(e) => setSpArea(e.target.value as SpecialistArea)}>
              {SPECIALIST_AREAS.map((a) => (
                <option key={a} value={a}>
                  {SPECIALIST_AREA_LABEL[a]}
                </option>
              ))}
            </Select>
            <Input placeholder="Specialist need" value={spText} onChange={(e) => setSpText(e.target.value)} />
            <Select value={spSignal} onChange={(e) => setSpSignal(e.target.value)}>
              <option value="">— Link signal (optional) —</option>
              {signals.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.signalCode} — {x.observation.slice(0, 60)}
                </option>
              ))}
            </Select>
            <Button variant="ghost" disabled={!spText.trim() || pending} onClick={() => post('/specialists', { area: spArea, observation: spText, signalId: spSignal || null }, 'Specialist need added.')}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add
            </Button>
          </div>
        )}
      </Card>

      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Special audit approach considerations (§20)</div>
        <p className="text-xs text-ink-muted">Proposed from Planning Signals / Areas of Focus and known facts. Accept, modify, reject (with rationale) or mark for further assessment.</p>
        {implications.length === 0 && <p className="text-xs text-ink-faint">No implications proposed.</p>}
        {implications.map((c) => (
          <ConsiderationRow key={`${c.id}-${c.version}`} c={c} canEdit={canEdit} post={post} pending={pending} />
        ))}
      </Card>
    </div>
  );
}

function ServiceOrgCard({ o, canEdit, post, pending }: { o: ScopeServiceOrg; canEdit: boolean; post: Post; pending: boolean }): JSX.Element {
  const [f, setF] = useState({
    provider: o.provider,
    process: o.process ?? '',
    affectedAreas: o.affectedAreas.join(', '),
    assuranceReport: o.assuranceReport,
    reportDetail: o.reportDetail ?? '',
    cuec: o.cuec,
    so01: o.so01,
    note: o.note ?? '',
  });
  const dis = !canEdit;
  return (
    <div className="space-y-2 border-t border-line pt-2 text-xs">
      <div className="grid gap-2 sm:grid-cols-3">
        <Input disabled={dis} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} />
        <Input disabled={dis} placeholder="Service / process" value={f.process} onChange={(e) => setF({ ...f, process: e.target.value })} />
        <Input disabled={dis} placeholder="Affected financial areas (comma-separated)" value={f.affectedAreas} onChange={(e) => setF({ ...f, affectedAreas: e.target.value })} />
        <Select disabled={dis} value={f.assuranceReport ?? ''} onChange={(e) => setF({ ...f, assuranceReport: (e.target.value || null) as ScopeServiceOrg['assuranceReport'] })}>
          <option value="">— Independent assurance report —</option>
          {ASSURANCE_REPORT.map((a) => (
            <option key={a} value={a}>
              {ASSURANCE_REPORT_LABEL[a]}
            </option>
          ))}
        </Select>
        <Input disabled={dis} placeholder="Report type / period if known" value={f.reportDetail} onChange={(e) => setF({ ...f, reportDetail: e.target.value })} />
        <Select disabled={dis} value={f.cuec ?? ''} onChange={(e) => setF({ ...f, cuec: (e.target.value || null) as ScopeServiceOrg['cuec'] })}>
          <option value="">— Complementary user controls relevant? —</option>
          {CUEC_ANSWERS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </div>
      <Options options={SO01_OPTIONS} labels={SO01_LABEL} value={f.so01} disabled={dis} onChange={(v) => setF({ ...f, so01: v })} />
      {canEdit && (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            post(`/service-orgs/${o.id}`, { ...f, affectedAreas: f.affectedAreas.split(',').map((x) => x.trim()).filter(Boolean), version: o.version }, `${o.code} saved.`)
          }
        >
          Save {o.code}
        </Button>
      )}
    </div>
  );
}

function ConsiderationRow({ c, canEdit, post, pending }: { c: ScopeConsideration; canEdit: boolean; post: Post; pending: boolean }): JSX.Element {
  const [note, setNote] = useState(c.note ?? '');
  const specialist = c.kind === 'specialist';
  const options = specialist ? SPECIALIST_DECISIONS : IMPLICATION_RESPONSES;
  const labels: Record<string, string> = specialist ? SPECIALIST_DECISION_LABEL : IMPLICATION_RESPONSE_LABEL;
  return (
    <div className={`space-y-1 border-t border-line pt-2 text-xs ${c.noLongerTriggered ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        {c.signalCode && <span className="font-mono text-ink-faint">{c.signalCode}</span>}
        {!c.signalCode && c.sourceLabel && <span className="text-ink-faint">{c.sourceLabel}</span>}
        <span className="text-ink">{c.observation}</span>
        {c.attention !== 'standard' && <Badge tone={c.attention === 'immediate_partner' ? 'danger' : 'warn'}>{c.attention === 'immediate_partner' ? 'Immediate Partner Attention' : 'Enhanced'}</Badge>}
        {c.planningMatterCode && <Badge tone="info">{c.planningMatterCode}</Badge>}
        {c.noLongerTriggered && <Badge tone="neutral">No longer triggered</Badge>}
      </div>
      {c.suggestion && <div className="text-ink-muted">Suggested: {c.suggestion}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <Options
          options={options}
          labels={labels}
          value={c.response}
          disabled={!canEdit || pending}
          onChange={(v) => post(`/considerations/${c.id}`, { response: v, note, version: c.version }, 'Response saved.')}
        />
        <Input className="max-w-md" disabled={!canEdit} placeholder="Rationale / modification" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </div>
  );
}

// ── 03.4.9 Dependencies + SL-01 ─────────────────────────────────────────────

function DependenciesTab({ s, canEdit, save, post, pending, team }: TabProps & { team: TeamMember[] }): JSX.Element {
  const r = s.record;
  const [desc, setDesc] = useState('');
  const [impact, setImpact] = useState<ScopeDependency['impact']>('information');
  const [matter, setMatter] = useState('');
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Scope Dependency Register</div>
        <p className="text-xs text-ink-muted">Management accounts, inventory date, ERP access, component auditor, assurance report, predecessor access, legal / valuation report… Significant impacts are Partner Attention. Actual dates are set in 03.11.</p>
        {s.dependencies.length === 0 && <p className="text-xs text-ink-faint">No dependencies.</p>}
        {s.dependencies.map((d) => (
          <DependencyRow key={`${d.id}-${d.version}`} d={d} s={s} team={team} canEdit={canEdit} post={post} pending={pending} />
        ))}
        {canEdit && (
          <div className="grid gap-2 border-t border-line pt-2 sm:grid-cols-4">
            <Input className="sm:col-span-2" placeholder="Dependency" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <Select value={impact} onChange={(e) => setImpact(e.target.value as ScopeDependency['impact'])}>
              {DEPENDENCY_IMPACTS.map((i) => (
                <option key={i} value={i}>
                  Impact: {DEPENDENCY_IMPACT_LABEL[i]}
                </option>
              ))}
            </Select>
            <Button variant="ghost" disabled={!desc.trim() || pending} onClick={() => post('/dependencies', { description: desc, impact }, 'Dependency added.')}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add
            </Button>
          </div>
        )}
      </Card>
      <Question code="SL-01 — Potential scope limitation" text="Does any known matter currently indicate a potential limitation on the auditor's ability to obtain sufficient appropriate audit evidence?">
        <Options options={SL01_ANSWERS} labels={SL01_LABEL} value={r.sl01} disabled={!canEdit || pending} onChange={(v) => save({ sl01: v }, 'SL-01 saved.')} />
        <Note>{SCOPE_LIMITATION_NOTE}</Note>
        {s.limitations.map((l) => (
          <LimitationRow key={`${l.id}-${l.version}`} l={l} team={team} canEdit={canEdit} post={post} pending={pending} />
        ))}
        {canEdit && (r.sl01 === 'yes' || r.sl01 === 'uncertain' || s.limitations.length > 0) && (
          <div className="flex gap-2 border-t border-line pt-2">
            <Input placeholder="Matter (facts only)" value={matter} onChange={(e) => setMatter(e.target.value)} />
            <Button variant="ghost" disabled={!matter.trim() || pending} onClick={() => post('/limitations', { matter }, 'Potential limitation recorded — Immediate Partner Attention + Planning Matter.')}>
              <Plus className="mr-1.5 h-4 w-4" />
              Record
            </Button>
          </div>
        )}
      </Question>
    </div>
  );
}

function DependencyRow({ d, s, team, canEdit, post, pending }: { d: ScopeDependency; s: ScopeApproachSummary; team: TeamMember[]; canEdit: boolean; post: Post; pending: boolean }): JSX.Element {
  const [f, setF] = useState({
    affected: d.affected ?? '',
    unitId: d.unitId ?? '',
    ownerEmployeeId: d.ownerEmployeeId ?? '',
    ownerParty: d.ownerParty,
    neededBy: d.neededBy ?? '',
    impact: d.impact,
    status: d.status,
    resolution: d.resolution ?? '',
  });
  const dis = !canEdit;
  return (
    <div className="space-y-1 border-t border-line pt-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-ink-faint">{d.code}</span>
        <span className="text-ink">{d.description}</span>
        {d.partnerAttention && <Badge tone="warn">Partner Attention</Badge>}
        <Badge tone={d.status === 'resolved' ? 'success' : 'neutral'}>{DEPENDENCY_STATUS_LABEL[d.status]}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Input disabled={dis} placeholder="Affected scope / area" value={f.affected} onChange={(e) => setF({ ...f, affected: e.target.value })} />
        <Select disabled={dis} value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>
          <option value="">— Unit —</option>
          {s.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} {u.name}
            </option>
          ))}
        </Select>
        <Select disabled={dis} value={f.ownerParty} onChange={(e) => setF({ ...f, ownerParty: e.target.value as ScopeDependency['ownerParty'] })}>
          {DEPENDENCY_OWNER_PARTIES.map((p) => (
            <option key={p} value={p}>
              Owner: {DEPENDENCY_OWNER_PARTY_LABEL[p]}
            </option>
          ))}
        </Select>
        <Select disabled={dis} value={f.ownerEmployeeId} onChange={(e) => setF({ ...f, ownerEmployeeId: e.target.value })}>
          <option value="">— Named owner —</option>
          {team.map((m) => (
            <option key={m.employeeId} value={m.employeeId}>
              {m.employeeName}
            </option>
          ))}
        </Select>
        <Select disabled={dis} value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })}>
          <option value="">— Needed by (milestone) —</option>
          {NEEDED_BY.map((x) => (
            <option key={x} value={x}>
              {NEEDED_BY_LABEL[x]}
            </option>
          ))}
        </Select>
        <Select disabled={dis} value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value as ScopeDependency['impact'] })}>
          {DEPENDENCY_IMPACTS.map((x) => (
            <option key={x} value={x}>
              Impact: {DEPENDENCY_IMPACT_LABEL[x]}
            </option>
          ))}
        </Select>
        <Select disabled={dis} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ScopeDependency['status'] })}>
          {DEPENDENCY_STATUSES.map((x) => (
            <option key={x} value={x}>
              {DEPENDENCY_STATUS_LABEL[x]}
            </option>
          ))}
        </Select>
        <Input disabled={dis} placeholder="Resolution" value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} />
      </div>
      {canEdit && (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            post(
              `/dependencies/${d.id}`,
              { ...f, unitId: f.unitId || null, ownerEmployeeId: f.ownerEmployeeId || null, neededBy: f.neededBy || null, version: d.version },
              `${d.code} saved.`,
            )
          }
        >
          Save {d.code}
        </Button>
      )}
    </div>
  );
}

function LimitationRow({ l, team, canEdit, post, pending }: { l: ScopeLimitation; team: TeamMember[]; canEdit: boolean; post: Post; pending: boolean }): JSX.Element {
  const [f, setF] = useState({
    affected: l.affected ?? '',
    managementPosition: l.managementPosition ?? '',
    alternativeEvidence: l.alternativeEvidence ?? '',
    ownerEmployeeId: l.ownerEmployeeId ?? '',
    resolution: l.resolution ?? '',
  });
  const dis = !canEdit;
  const send = (status?: 'resolved') =>
    post(`/limitations/${l.id}`, { ...f, ownerEmployeeId: f.ownerEmployeeId || null, status, version: l.version }, `${l.code} saved.`);
  return (
    <div className="space-y-1 border-t border-line pt-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-ink-faint">{l.code}</span>
        <span className="text-ink">{l.matter}</span>
        {l.status === 'open' ? <Badge tone="danger">Immediate Partner Attention</Badge> : <Badge tone="success">Resolved</Badge>}
        {l.planningMatterCode && <Badge tone="info">{l.planningMatterCode}</Badge>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input disabled={dis} placeholder="Affected FS area / unit" value={f.affected} onChange={(e) => setF({ ...f, affected: e.target.value })} />
        <Select disabled={dis} value={f.ownerEmployeeId} onChange={(e) => setF({ ...f, ownerEmployeeId: e.target.value })}>
          <option value="">— Owner —</option>
          {team.map((m) => (
            <option key={m.employeeId} value={m.employeeId}>
              {m.employeeName}
            </option>
          ))}
        </Select>
        <Textarea rows={2} disabled={dis} placeholder="Reason / management position (current facts)" value={f.managementPosition} onChange={(e) => setF({ ...f, managementPosition: e.target.value })} />
        <Textarea rows={2} disabled={dis} placeholder="Possible alternative evidence (preliminary)" value={f.alternativeEvidence} onChange={(e) => setF({ ...f, alternativeEvidence: e.target.value })} />
        <Input disabled={dis} placeholder="Resolution" value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} />
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => send()}>
            Save
          </Button>
          {l.status === 'open' && (
            <Button variant="ghost" disabled={pending || !f.resolution.trim()} onClick={() => send('resolved')}>
              Resolve
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── 03.4.10 Preliminary Audit Approach Map ─────────────────────────────────

function MapTab({ s, canEdit, post, pending, signals, focus }: TabProps & { signals: PlanningSignalRecord[]; focus: AreaOfFocusRecord[] }): JSX.Element {
  const [name, setName] = useState('');
  return (
    <div className="space-y-3">
      <Note>{MAP_DESTINATION_NOTE}</Note>
      {s.materiality && (
        <p className="text-xs text-ink-muted">
          Materiality in use ({s.materiality.versionLabel}): OM {inr(s.materiality.overallMateriality)} · PM {inr(s.materiality.performanceMateriality)}
          {s.materiality.specific.length > 0 && ` · specific: ${s.materiality.specific.map((x) => x.scope).join(', ')}`}
        </p>
      )}
      {s.mapItems.map((m) => (
        <MapRow key={`${m.id}-${m.version}`} m={m} canEdit={canEdit} post={post} pending={pending} signals={signals} focus={focus} />
      ))}
      {canEdit && (
        <Card className="flex gap-2 p-3">
          <Input className="max-w-xs" placeholder="Add a preliminary area" value={name} onChange={(e) => setName(e.target.value)} />
          <Button disabled={!name.trim() || pending} onClick={() => post('/map', { name }, 'Area added.')}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add area
          </Button>
        </Card>
      )}
    </div>
  );
}

function MapRow({
  m,
  canEdit,
  post,
  pending,
  signals,
  focus,
}: {
  m: ScopeMapItem;
  canEdit: boolean;
  post: Post;
  pending: boolean;
  signals: PlanningSignalRecord[];
  focus: AreaOfFocusRecord[];
}): JSX.Element {
  const [f, setF] = useState({
    manualAmount: m.manualAmount?.toString() ?? '',
    materialityNote: m.materialityNote ?? '',
    signalIds: m.signalIds,
    focusIds: m.focusIds,
    controlsStrategy: m.controlsStrategy,
    timing: m.timing,
    evidenceChannels: m.evidenceChannels,
    specialConsiderations: m.specialConsiderations,
    note: m.note ?? '',
    included: m.included,
    exclusionReason: m.exclusionReason ?? '',
  });
  const dis = !canEdit;
  const send = (extra: Record<string, unknown> = {}) =>
    post(
      `/map/${m.id}`,
      {
        ...f,
        manualAmount: m.metricKey ? undefined : numOrNull(f.manualAmount),
        exclusionReason: f.included ? null : f.exclusionReason,
        version: m.version,
        ...extra,
      },
      `${m.code} saved.`,
    );
  return (
    <Card className={`space-y-2 p-3 ${m.included ? '' : 'opacity-70'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-xs text-ink-faint">{m.code}</span>
          <span className="font-medium text-ink">{m.name}</span>
          {m.sourceLabel && <span className="text-[11px] text-ink-faint">{m.sourceLabel}</span>}
          {m.reassessmentRequired && <Badge tone="danger">Reassessment Required</Badge>}
          {!m.included && <Badge tone="neutral">Removed — {m.exclusionReason}</Badge>}
        </div>
        <span className="text-xs text-ink-muted">
          {inr(m.amount)} {m.materialityContext ? `· ${m.materialityContext}` : ''}
        </span>
      </div>
      {m.reassessmentRequired && <p className="text-xs text-danger-700">{m.reassessmentReason}</p>}
      {m.specificMateriality.length > 0 && <p className="text-xs text-warn-700">Specific materiality: {m.specificMateriality.join('; ')}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-[11px] text-ink-muted">Controls strategy</div>
          <Options options={MAP_CONTROLS_STRATEGIES} labels={MAP_CONTROLS_STRATEGY_LABEL} value={f.controlsStrategy} disabled={dis} onChange={(v) => setF({ ...f, controlsStrategy: v })} />
          <div className="text-[11px] text-ink-muted">Timing</div>
          <Options options={MAP_TIMINGS} labels={MAP_TIMING_LABEL} value={f.timing} disabled={dis} onChange={(v) => setF({ ...f, timing: v })} />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] text-ink-muted">Key evidence channels (strategic categories)</div>
          <Checks options={MAP_EVIDENCE_CATEGORIES} labels={MAP_EVIDENCE_LABEL} value={f.evidenceChannels} onChange={(v) => setF({ ...f, evidenceChannels: v })} disabled={dis} />
          <div className="text-[11px] text-ink-muted">Special consideration</div>
          <Checks options={SPECIAL_CONSIDERATIONS} labels={SPECIAL_CONSIDERATION_LABEL} value={f.specialConsiderations} onChange={(v) => setF({ ...f, specialConsiderations: v })} disabled={dis} />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <div className="text-[11px] text-ink-muted">Planning Signals</div>
          <LinkPicker disabled={dis} items={signals.map((x) => ({ id: x.id, code: x.signalCode, text: x.observation }))} value={f.signalIds} onChange={(v) => setF({ ...f, signalIds: v })} />
        </div>
        <div>
          <div className="text-[11px] text-ink-muted">Areas of Focus</div>
          <LinkPicker disabled={dis} items={focus.map((x) => ({ id: x.id, code: x.focusCode, text: x.name }))} value={f.focusIds} onChange={(v) => setF({ ...f, focusIds: v })} />
        </div>
        <div className="space-y-1">
          {!m.metricKey && <Input disabled={dis} type="number" placeholder="Amount (₹, if known)" value={f.manualAmount} onChange={(e) => setF({ ...f, manualAmount: e.target.value })} />}
          <Input disabled={dis} placeholder="Materiality relevance note" value={f.materialityNote} onChange={(e) => setF({ ...f, materialityNote: e.target.value })} />
          <Input disabled={dis} placeholder={m.reassessmentRequired ? 'What was reconsidered (required to clear)' : 'Note'} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => send()}>
            Save {m.code}
          </Button>
          {m.reassessmentRequired && (
            <Button variant="ghost" disabled={pending || !f.note.trim()} onClick={() => send({ reassessed: true })}>
              Mark reassessed
            </Button>
          )}
          <label className="inline-flex items-center gap-1.5 text-xs text-ink">
            <input type="checkbox" checked={!f.included} onChange={(e) => setF({ ...f, included: !e.target.checked })} />
            Remove from map
          </label>
          {!f.included && <Input className="max-w-sm" placeholder="Reason (required)" value={f.exclusionReason} onChange={(e) => setF({ ...f, exclusionReason: e.target.value })} />}
        </div>
      )}
    </Card>
  );
}

// ── §26 Partner Planning View ──────────────────────────────────────────────

function PartnerTab({ s, post, pending, canAct }: TabProps & { canAct: boolean }): JSX.Element {
  const [action, setAction] = useState<PartnerScopeAction>('challenge');
  const [note, setNote] = useState('');
  const r = s.record;
  const reliance = s.decisions.filter((d) => d.kind === 'controls_cycle' && d.status === 'reliance_contemplated').map((d) => d.label);
  const timing = s.decisions.filter((d) => d.kind === 'timing' && d.status).map((d) => `${d.label}: ${DECISION_STATUS_LABEL[d.status!]}`);
  const rows: [string, string][] = [
    ['Overall approach', r.ap01 ? AP01_LABEL[r.ap01] : '—'],
    ['Scope population', `${s.units.length} unit(s); ${s.units.filter((u) => u.scopeConclusion === 'in_scope').length} in scope`],
    ['Material / qualitatively relevant units', s.units.filter((u) => u.relevance.length || u.materialityContext?.includes('×')).map((u) => u.name).join(', ') || '—'],
    ['Controls reliance contemplated', reliance.join(', ') || 'None'],
    ['Timing pattern', timing.join('; ') || '—'],
    ['Other auditors', s.units.filter((u) => u.auditor !== 'dhvaj').map((u) => `${u.name} (${label(OTHER_AUDITOR_STRATEGY_LABEL, u.auditorStrategy)})`).join('; ') || 'None'],
    ['Specialists', s.considerations.filter((c) => c.kind === 'specialist').map((c) => `${c.observation} (${label(SPECIALIST_DECISION_LABEL, c.response)})`).join('; ') || 'None'],
    ['Service organisations', s.serviceOrgs.map((o) => `${o.provider} (${label(SO01_LABEL, o.so01)})`).join('; ') || 'None'],
    ['Technology', r.dt01 ? DT01_LABEL[r.dt01] : '—'],
    ['Dependencies', `${s.dependencies.filter((d) => d.status !== 'resolved').length} open`],
    ['Limitations', `${s.limitations.filter((l) => l.status === 'open').length} open`],
  ];
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Partner Planning View</div>
        <table className="w-full text-xs">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-t border-line align-top">
                <td className="w-64 py-1 pr-2 text-ink-muted">{k}</td>
                <td className="py-1 text-ink">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.partnerAttention.length > 0 && (
          <ul className="space-y-1 text-xs">
            {s.partnerAttention.map((t) => (
              <li key={t.key} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn-600" />
                <span>
                  <span className="text-ink">{t.label}</span> — <span className="text-ink-muted">{t.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-ink-faint">No separate EP approval in 03.4 — formal planning approval is 03.12. Partner actions feed 03.12.</p>
      </Card>
      {canAct && (
        <Card className="space-y-2 p-3">
          <div className="text-sm font-medium text-ink">Partner action</div>
          <Options options={PARTNER_ACTIONS} labels={PARTNER_ACTION_LABEL} value={action} disabled={pending} onChange={setAction} />
          <Textarea rows={2} placeholder={action === 'agree' ? 'Optional note' : 'Describe the challenge / request / signal (required)'} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button disabled={pending || (action !== 'agree' && !note.trim())} onClick={() => post('/partner-actions', { action, note }, `${PARTNER_ACTION_LABEL[action]} recorded.`)}>
            Record
          </Button>
        </Card>
      )}
      {s.partnerActions.map((a) => (
        <PartnerActionRow key={`${a.id}-${a.version}`} a={a} canAct={canAct} post={post} pending={pending} />
      ))}
    </div>
  );
}

function PartnerActionRow({ a, canAct, post, pending }: { a: ScopeApproachSummary['partnerActions'][number]; canAct: boolean; post: Post; pending: boolean }): JSX.Element {
  const [response, setResponse] = useState('');
  return (
    <Card className="space-y-1 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={a.action === 'agree' ? 'success' : 'warn'}>{PARTNER_ACTION_LABEL[a.action]}</Badge>
        {a.signalCode && <Badge tone="info">{a.signalCode}</Badge>}
        <span className="text-ink-muted">
          {a.createdByName ?? ''} · {new Date(a.createdAt).toLocaleDateString('en-IN')}
        </span>
        <Badge tone={a.status === 'open' ? 'danger' : 'neutral'}>{a.status === 'open' ? 'Open' : 'Addressed'}</Badge>
      </div>
      {a.note && <p className="text-ink">{a.note}</p>}
      {a.response && <p className="text-ink-muted">Response: {a.response}</p>}
      {a.status === 'open' && canAct && (
        <div className="flex gap-2">
          <Input placeholder="Manager response" value={response} onChange={(e) => setResponse(e.target.value)} />
          <Button variant="secondary" disabled={!response.trim() || pending} onClick={() => post(`/partner-actions/${a.id}`, { response, version: a.version }, 'Response recorded.')}>
            Respond
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── §27 Revision ────────────────────────────────────────────────────────────

function RevisionTab({ s, post, pending, canRevise }: TabProps & { canRevise: boolean }): JSX.Element {
  const r = s.record;
  const [trigger, setTrigger] = useState<ScopeRevisionTrigger>(r.reassessmentSource === 'section_05' ? 'controls_not_supported' : r.reassessmentSource === 'materiality_revision' ? 'materiality_revision' : 'new_significant_transaction');
  const [reason, setReason] = useState(r.reassessmentReason ?? '');
  const [modules, setModules] = useState<string[]>([]);
  const [flag, setFlag] = useState('');
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Version history</div>
        {s.revisions.length === 0 ? (
          <p className="text-xs text-ink-faint">{r.versionLabel} — no revisions.</p>
        ) : (
          s.revisions.map((v) => (
            <div key={v.toVersionLabel} className="border-t border-line pt-1 text-xs">
              <span className="font-mono text-ink">
                {v.fromVersionLabel} → {v.toVersionLabel}
              </span>{' '}
              <span className="text-ink-muted">
                {SCOPE_REVISION_TRIGGER_LABEL[v.trigger]} — {v.reason}
                {v.affectedModules.length ? ` · affects ${v.affectedModules.join(', ')}` : ''} · {v.createdByName ?? ''} {new Date(v.createdAt).toLocaleDateString('en-IN')}
              </span>
              <div className="text-ink-faint">Preserved baseline: {v.baselineSummary}</div>
            </div>
          ))
        )}
      </Card>
      {canRevise && r.id && r.status !== 'draft' && (
        <Card className="space-y-2 p-3">
          <div className="text-sm font-medium text-ink">Start a controlled revision (creates v1.{r.versionNo})</div>
          <p className="text-xs text-ink-muted">The approved baseline is preserved; the changed decision is recorded in the new version.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value as ScopeRevisionTrigger)}>
              {SCOPE_REVISION_TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {SCOPE_REVISION_TRIGGER_LABEL[t]}
                </option>
              ))}
            </Select>
            <Input className="sm:col-span-2" placeholder="Reason (mandatory)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <p className="text-xs text-ink-muted">Impact assessment: {SCOPE_REVISION_IMPACT[trigger]}</p>
          <Checks options={SCOPE_AFFECTED_MODULES} labels={{}} value={modules} onChange={setModules} disabled={false} />
          <Button disabled={!reason.trim() || pending} onClick={() => post('/revisions', { trigger, reason, affectedModules: modules }, 'Revision started — the approved baseline is preserved.')}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Start revision
          </Button>
        </Card>
      )}
      {canRevise && r.id && r.status === 'complete' && (
        <Card className="space-y-2 p-3">
          <div className="text-sm font-medium text-ink">Flag Reassessment Required</div>
          <p className="text-xs text-ink-muted">E.g. Section 05 indicates planned reliance is not supportable. Nothing changes silently — the strategy is marked for reassessment.</p>
          <div className="flex gap-2">
            <Input placeholder="Reason" value={flag} onChange={(e) => setFlag(e.target.value)} />
            <Button variant="secondary" disabled={!flag.trim() || pending} onClick={() => post('/reassessment', { source: 'manager', reason: flag }, 'Flagged Reassessment Required.')}>
              Flag
            </Button>
          </div>
        </Card>
      )}
      {r.versionNo > 1 && r.revisionTrigger && (
        <Card className="p-3 text-xs text-ink-muted">
          {r.versionLabel} in progress — {SCOPE_REVISION_TRIGGER_LABEL[r.revisionTrigger]}: {r.revisionReason}
        </Card>
      )}
    </div>
  );
}

// ── §24 / §25 Consistency checks + conclusion ─────────────────────────────

function ConclusionTab({ s, canEdit, save, pending, base }: TabProps & { base: string }): JSX.Element {
  const toast = useToast();
  const r = s.record;
  const [text, setText] = useState(r.conclusionSummary ?? '');
  const draft = useMutation({
    mutationFn: () => apiFetch<{ draft: string }>(`${base}/scope-approach/conclusion-draft`, { method: 'POST', body: {} }),
    onSuccess: (x) => {
      setText(x.draft);
      toast('Conclusion generated from the recorded strategy — review and edit before saving.');
    },
    onError: (e) => toast(errMsg(e, 'Could not generate the conclusion.')),
  });
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Approach consistency checks (§24)</div>
        {s.consistency.length === 0 && <p className="text-xs text-ink-faint">No triggered checks.</p>}
        <ul className="space-y-1 text-xs">
          {s.consistency.map((c) => (
            <li key={c.key} className="flex items-start gap-1.5">
              <Badge tone={c.met ? 'success' : c.severity === 'blocking' ? 'danger' : 'warn'}>{c.met ? 'OK' : c.severity === 'blocking' ? 'Blocking' : 'Challenge'}</Badge>
              <span>
                <span className="text-ink">{c.label}</span>
                {c.detail && <span className="block text-ink-muted">{c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-ink">Manager scope & approach conclusion</div>
          <Button variant="ghost" onClick={() => draft.mutate()} disabled={draft.isPending}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Generate from recorded strategy
          </Button>
        </div>
        <Textarea rows={14} disabled={!canEdit} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="text-[11px] text-ink-faint">The structured decisions remain authoritative. No standalone Word scope memo — the Audit Planning Memorandum is generated in 03.12.</p>
      </Card>
      <CompletionChecklist checks={s.completion} />
      <Question code="AP-02 — Manager conclusion" text="Does the proposed scope and overall audit approach appropriately respond to the engagement characteristics, information presently available, materiality and planning considerations?">
        {r.ap02 && <Badge tone={r.ap02 === 'yes_complete' ? 'success' : 'warn'}>{r.ap02 === 'yes_complete' ? 'Yes — Complete' : 'No — Further Work Required'}</Badge>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => save({ conclusionSummary: text }, 'Conclusion saved.')}>
              Save conclusion
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => save({ conclusionSummary: text, ap02: 'no_further_work' }, 'Recorded — further work required.')}>
              No — Further Work Required
            </Button>
            <Button disabled={pending} onClick={() => save({ conclusionSummary: text, ap02: 'yes_complete' }, `03.4 ${r.versionLabel} completed.`)}>
              Yes — Complete 03.4
            </Button>
          </div>
        )}
      </Question>
    </div>
  );
}
