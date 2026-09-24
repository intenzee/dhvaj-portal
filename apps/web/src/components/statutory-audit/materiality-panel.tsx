'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Info, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import {
  BENCHMARK_ASSESSMENT_LABEL,
  BENCHMARK_ASSESSMENTS,
  CLEARLY_TRIVIAL_WARNING,
  MATERIALITY_BENCHMARK_LABEL,
  MATERIALITY_GUIDANCE_DISCLOSURE,
  METHODOLOGY_STATUS_LABEL,
  PRINCIPAL_USER_LABEL,
  PRINCIPAL_USERS,
  QUALITATIVE_RESPONSE_LABEL,
  QUALITATIVE_RESPONSES,
  REVISION_TRIGGER_LABEL,
  REVISION_TRIGGERS,
  SPECIFIC_SCOPE_TYPE_LABEL,
  SPECIFIC_SCOPE_TYPES,
  USER_FOCUS_LABEL,
  USER_FOCUS_MEASURES,
  type AreaOfFocusRecord,
  type BenchmarkAssessment,
  type BenchmarkCandidate,
  type JudgmentFactor,
  type MaterialityBenchmark,
  type MaterialityGuidance,
  type MaterialitySummary,
  type MethodologyStatus,
  type PlanningSignalRecord,
  type PrincipalUser,
  type QualitativeChallengeItem,
  type QualitativeResponse,
  type RevisionImpactItem,
  type RevisionTrigger,
  type SpecificMaterialityRecord,
  type SpecificScopeType,
  type UpdateMaterialityInput,
  type UserFocusMeasure,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { CompletionChecklist } from './planning-strategy-sections';

/**
 * 03.3 Materiality (DHVAJ 03.3). Not a percentage calculator: the portal shows
 * who the users are, which measures are available and how stable they are, the
 * effect of alternative judgments and the qualitative matters not to overlook;
 * the Engagement Manager determines and documents materiality. A completed
 * version is never overwritten — changes go through a revision (v1.0 → v1.1).
 */

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

type Tab =
  | 'context'
  | 'benchmarks'
  | 'overall'
  | 'performance'
  | 'specific'
  | 'trivial'
  | 'qualitative'
  | 'sensitivity'
  | 'revision'
  | 'conclusion';

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (n: number | null | undefined, dp = 2) =>
  n === null || n === undefined ? '—' : `${Number(n.toFixed(dp))}%`;
const num = (v: string) => (v.trim() === '' ? null : Number(v));
const guideText = (g: MaterialityGuidance | null | undefined) =>
  !g || g.lowPct === null
    ? 'No DHVAJ guidance configured'
    : g.highPct !== null && g.highPct !== g.lowPct
      ? `${g.lowPct}% – ${g.highPct}%`
      : `${g.lowPct}%`;

const STATUS_TONE: Record<MethodologyStatus, string> = {
  within_guidance: 'success',
  outside_guidance: 'warn',
  no_guidance: 'neutral',
};

type Update = (body: Omit<UpdateMaterialityInput, 'version'>, done?: string) => void;

export function MaterialityPanel({
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
  /** Lead rights: materiality may be revised during the audit even after planning approval. */
  canRevise: boolean;
  onChanged: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('context');
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}`;
  const qk = ['engagement', engagementId, 'materiality', workflowInstanceId];
  const summary = useQuery({
    queryKey: qk,
    queryFn: () => apiFetch<MaterialitySummary>(`${base}/materiality`),
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
    onChanged();
  };

  const update = useMutation({
    mutationFn: (v: { body: Omit<UpdateMaterialityInput, 'version'>; done?: string }) =>
      apiFetch<MaterialitySummary>(`${base}/materiality`, {
        method: 'POST',
        body: { ...v.body, version: summary.data!.determination.version },
      }),
    onSuccess: (data, v) => {
      // The response is the fresh summary: use it (new version for the next save) instead of refetching.
      qc.setQueryData(qk, data);
      toast(v.done ?? 'Materiality saved.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save materiality.')),
  });
  const save: Update = (body, done) => update.mutate({ body, done });

  if (summary.isLoading) return <Spinner label="Loading 03.3…" />;
  const s = summary.data;
  if (!s) return <p className="text-sm text-ink-muted">03.3 is unavailable.</p>;
  const d = s.determination;
  // A revision draft stays editable after planning approval (03.3.11).
  const canEdit = d.status === 'draft' && (editable || (canRevise && d.versionNo > 1));
  const outstanding = s.completion.filter((c) => !c.met).length;
  const k = `${d.id ?? 'new'}-${d.version}`;
  const common = { s, canEdit, save, pending: update.isPending };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={d.status === 'complete' ? 'success' : 'info'}>
            {d.versionLabel} · {d.status === 'complete' ? 'Complete' : d.version === 0 ? 'Not started' : 'Draft'}
          </Badge>
          {s.partnerAttention.length > 0 && (
            <Badge tone="warn">{s.partnerAttention.length} Partner Attention</Badge>
          )}
          {s.methodology.anyProvisional && (
            <Badge tone="neutral">Methodology guidance: provisional</Badge>
          )}
          {d.selectedOm !== null && (
            <span className="text-xs text-ink-muted">
              OM {inr(d.selectedOm)} · PM {inr(d.selectedPm)} · CTT {inr(d.selectedCtt)}
            </span>
          )}
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

      {d.status === 'complete' && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-success-200 p-3 text-sm">
          <span className="text-ink-muted">
            {d.versionLabel} is complete and published to planning and execution
            {d.completedByName ? ` (${d.completedByName})` : ''}. It is never overwritten — a change
            needs a revision (03.3.11).
          </span>
          <Button variant="secondary" onClick={() => setTab('revision')}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Revise materiality
          </Button>
        </Card>
      )}
      {s.computed.sourceChanged && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-warn-200 bg-warn-50 p-3 text-sm text-warn-800">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {s.computed.sourceChangeDetail} The conclusion is flagged for reassessment — nothing was changed automatically.
          </span>
          {canEdit && (
            <Button variant="secondary" onClick={() => save({ reconfirmSource: true }, 'Benchmark re-confirmed against 03.2.')}>
              Re-confirm benchmark
            </Button>
          )}
        </Card>
      )}
      {!s.dataset.ready && (
        <Card className="flex items-start gap-2 p-3 text-sm text-ink-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {s.dataset.reason} Materiality consumes the 03.2 financial dataset — figures are not re-keyed here.
        </Card>
      )}

      <div className="flex flex-wrap gap-1 border-b border-line">
        {(
          [
            ['context', 'Context'],
            ['benchmarks', 'Benchmarks'],
            ['overall', 'Overall (OM)'],
            ['performance', 'Performance (PM)'],
            ['specific', 'Specific'],
            ['trivial', 'Clearly trivial'],
            ['qualitative', 'Qualitative'],
            ['sensitivity', 'Sensitivity'],
            ['revision', d.versionNo > 1 ? `Revision (${d.versionLabel})` : 'Revision & history'],
            ['conclusion', outstanding ? `Conclusion (${outstanding} to do)` : 'Conclusion'],
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

      {tab === 'context' && <ContextTab key={k} {...common} />}
      {tab === 'benchmarks' && <BenchmarksTab key={k} {...common} base={base} onChanged={refresh} />}
      {tab === 'overall' && <OverallTab key={k} {...common} />}
      {tab === 'performance' && <PerformanceTab key={k} {...common} />}
      {tab === 'specific' && <SpecificTab key={k} {...common} base={base} onChanged={refresh} />}
      {tab === 'trivial' && <TrivialTab key={k} {...common} />}
      {tab === 'qualitative' && (
        <QualitativeTab
          key={k}
          {...common}
          base={base}
          signals={signals.data ?? []}
          focus={focus.data ?? []}
          onChanged={refresh}
        />
      )}
      {tab === 'sensitivity' && <SensitivityTab key={k} {...common} />}
      {tab === 'revision' && (
        <RevisionTab
          key={k}
          {...common}
          editable={canRevise}
          engagementId={engagementId}
          base={base}
          team={team}
          onChanged={refresh}
        />
      )}
      {tab === 'conclusion' && <ConclusionTab key={k} {...common} base={base} />}
    </div>
  );
}

interface TabProps {
  s: MaterialitySummary;
  canEdit: boolean;
  save: Update;
  pending: boolean;
}

function Checks<T extends string>({
  options,
  labels,
  value,
  onChange,
  disabled,
}: {
  options: readonly T[];
  labels: Record<T, string>;
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
          {labels[o]}
        </label>
      ))}
    </div>
  );
}

function Question({ code, text, children }: { code: string; text: string; children: React.ReactNode }): JSX.Element {
  return (
    <Card className="space-y-2 p-3">
      <div className="text-sm font-medium text-ink">{code}</div>
      <p className="text-sm text-ink-muted">{text}</p>
      {children}
    </Card>
  );
}

// ── 03.3.1 Context ───────────────────────────────────────────────────────────

function ContextTab({ s, canEdit, save, pending }: TabProps): JSX.Element {
  const d = s.determination;
  const [users, setUsers] = useState<PrincipalUser[]>(d.principalUsers);
  const [usersOther, setUsersOther] = useState(d.principalUsersOther ?? '');
  const [focus, setFocus] = useState<UserFocusMeasure[]>(d.userFocus);
  const [focusOther, setFocusOther] = useState(d.userFocusOther ?? '');
  const [py, setPy] = useState({
    om: d.pyOverallMateriality?.toString() ?? '',
    pm: d.pyPerformanceMateriality?.toString() ?? '',
    ctt: d.pyClearlyTrivial?.toString() ?? '',
    benchmark: d.pyBenchmark ?? '',
    source: d.pySource ?? '',
    diffs: d.pyAuditDifferences ?? '',
  });
  const suggested = s.candidates.filter((c) => c.status === 'available').map((c) => c.label);

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="mb-1 text-xs font-medium text-ink-muted">Prefilled context (not re-keyed)</div>
        <ul className="space-y-0.5 text-xs text-ink">
          {s.context.map((c) => (
            <li key={c.label}>
              <span className="text-ink-faint">[{c.source}]</span> {c.label}: {c.value}
            </li>
          ))}
        </ul>
      </Card>
      <Question code="MAT-01 — Principal users" text="Select the principal users of the financial statements as a group. Capture only groups relevant to this engagement.">
        <Checks options={PRINCIPAL_USERS} labels={PRINCIPAL_USER_LABEL} value={users} onChange={setUsers} disabled={!canEdit} />
        {users.includes('other') && (
          <Input disabled={!canEdit} placeholder="Describe the other user group" value={usersOther} onChange={(e) => setUsersOther(e.target.value)} />
        )}
      </Question>
      <Question code="MAT-02 — Measures of likely user focus" text="Select the financial measures likely to be of particular interest to users as a group. The portal lists the measures available from 03.2; you confirm.">
        {suggested.length > 0 && (
          <p className="text-xs text-ink-faint">Available in 03.2: {suggested.join(', ')}</p>
        )}
        <Checks options={USER_FOCUS_MEASURES} labels={USER_FOCUS_LABEL} value={focus} onChange={setFocus} disabled={!canEdit} />
        {focus.includes('other') && (
          <Input disabled={!canEdit} placeholder="Describe the other measure" value={focusOther} onChange={(e) => setFocusOther(e.target.value)} />
        )}
      </Question>
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Prior-year materiality</div>
        <p className="text-xs text-ink-muted">
          From the prior engagement where available. There is no prior-year portal file yet, so record it with its source.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="PY overall materiality (₹)">
            <Input type="number" disabled={!canEdit} value={py.om} onChange={(e) => setPy({ ...py, om: e.target.value })} />
          </Field>
          <Field label="PY performance materiality (₹)">
            <Input type="number" disabled={!canEdit} value={py.pm} onChange={(e) => setPy({ ...py, pm: e.target.value })} />
          </Field>
          <Field label="PY clearly trivial (₹)">
            <Input type="number" disabled={!canEdit} value={py.ctt} onChange={(e) => setPy({ ...py, ctt: e.target.value })} />
          </Field>
          <Field label="PY benchmark">
            <Input disabled={!canEdit} value={py.benchmark} onChange={(e) => setPy({ ...py, benchmark: e.target.value })} />
          </Field>
          <Field label="Source">
            <Input disabled={!canEdit} placeholder="e.g. PY planning memo" value={py.source} onChange={(e) => setPy({ ...py, source: e.target.value })} />
          </Field>
        </div>
        <Field label="Prior-year audit differences (corrected / uncorrected)">
          <Textarea rows={2} disabled={!canEdit} value={py.diffs} onChange={(e) => setPy({ ...py, diffs: e.target.value })} />
        </Field>
      </Card>
      {canEdit && (
        <Button
          disabled={pending}
          onClick={() =>
            save(
              {
                principalUsers: users,
                principalUsersOther: usersOther,
                userFocus: focus,
                userFocusOther: focusOther,
                pyOverallMateriality: num(py.om),
                pyPerformanceMateriality: num(py.pm),
                pyClearlyTrivial: num(py.ctt),
                pyBenchmark: py.benchmark,
                pySource: py.source,
                pyAuditDifferences: py.diffs,
              },
              'Context saved.',
            )
          }
        >
          Save context
        </Button>
      )}
    </div>
  );
}

// ── 03.3.2 – 03.3.4 Benchmarks ───────────────────────────────────────────────

function BenchmarksTab({
  s,
  canEdit,
  save,
  pending,
  base,
  onChanged,
}: TabProps & { base: string; onChanged: () => void }): JSX.Element {
  const d = s.determination;
  const units = s.dataset.unitLabel ?? '';
  const [rationale, setRationale] = useState(d.normalisationRationale ?? '');
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Candidates come from the 03.2 financial dataset ({units}). They are listed in a fixed order and are
        never ranked — you assess each one.
      </p>
      <div className="grid gap-2 lg:grid-cols-2">
        {s.candidates.map((c) => (
          <CandidateCard key={`${c.key}-${c.version}`} c={c} units={units} base={base} canEdit={canEdit} onChanged={onChanged} />
        ))}
      </div>

      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">03.3.3 Normalised / alternative benchmark</div>
        <p className="text-xs text-ink-muted">
          Only through a controlled adjustment schedule — the reported 03.2 figure is never overwritten. Using a
          normalised benchmark is automatically flagged for Partner Attention.
        </p>
        <AdjustmentSchedule s={s} base={base} canEdit={canEdit} onChanged={onChanged} />
        <div className="text-sm text-ink">
          Reported PBT {s.normalisation.reportedPbt ?? '—'} + adjustments {s.normalisation.adjustmentsTotal} ={' '}
          <span className="font-medium">normalised PBT {s.normalisation.normalisedPbt ?? '—'}</span> {units}
        </div>
        {(s.adjustments.length > 0 || d.normalisationRationale) && (
          <>
            <Field label="Why is the adjusted measure more representative for users? (mandatory)">
              <Textarea rows={2} disabled={!canEdit} value={rationale} onChange={(e) => setRationale(e.target.value)} />
            </Field>
            {canEdit && (
              <Button variant="secondary" disabled={pending} onClick={() => save({ normalisationRationale: rationale }, 'Normalisation rationale saved.')}>
                Save rationale
              </Button>
            )}
          </>
        )}
      </Card>

      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">03.3.4 Benchmark comparison</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-1 pr-2">Candidate</th>
                <th className="py-1 pr-2">Amount ({units})</th>
                <th className="py-1 pr-2">Guidance % / range</th>
                <th className="py-1 pr-2">Indicative amount</th>
                <th className="py-1">Manager status</th>
              </tr>
            </thead>
            <tbody>
              {s.candidates.map((c) => (
                <tr key={c.key} className="border-t border-line">
                  <td className="py-1 pr-2 text-ink">{c.label}</td>
                  <td className="py-1 pr-2">{c.status === 'available' ? c.cy : c.status === 'not_meaningful' ? 'N/M' : '—'}</td>
                  <td className="py-1 pr-2">{guideText(c.guidance)}</td>
                  <td className="py-1 pr-2">
                    {c.indicativeLowInr !== null
                      ? `${inr(c.indicativeLowInr)}${c.indicativeHighInr !== null ? ` – ${inr(c.indicativeHighInr)}` : ''}`
                      : '—'}
                  </td>
                  <td className="py-1">{c.assessment ? BENCHMARK_ASSESSMENT_LABEL[c.assessment] : 'Not assessed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rounded-lg bg-primary-50 p-2 text-xs text-primary-700">{MATERIALITY_GUIDANCE_DISCLOSURE}</p>
        <p className="text-[11px] text-ink-faint">Methodology used: {s.methodology.versionLabel}</p>
      </Card>
    </div>
  );
}

function CandidateCard({
  c,
  units,
  base,
  canEdit,
  onChanged,
}: {
  c: BenchmarkCandidate;
  units: string;
  base: string;
  canEdit: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [assessment, setAssessment] = useState<BenchmarkAssessment | ''>(c.assessment ?? '');
  const [rationale, setRationale] = useState(c.rationale ?? '');
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/materiality/benchmarks/${c.key}`, {
        method: 'POST',
        body: { assessment, rationale, version: c.version },
      }),
    onSuccess: () => {
      toast(`${c.label}: assessment saved.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the assessment.')),
  });
  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-ink">{c.label}</div>
          <div className="text-[11px] text-ink-faint">{c.formula}</div>
        </div>
        <div className="flex gap-1">
          {c.userFocusLinked && <Badge tone="info">User focus</Badge>}
          {c.volatile && <Badge tone="warn">Volatile</Badge>}
        </div>
      </div>
      {c.status === 'available' ? (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>CY <span className="text-ink">{c.cy}</span></div>
          <div>PY <span className="text-ink">{c.py ?? '—'}</span></div>
          <div>Movement <span className="text-ink">{c.movementLabel}</span></div>
          <div className="col-span-3 text-ink-muted">= {inr(c.amountInr)} ({units})</div>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">{c.status === 'not_meaningful' ? 'N/M — ' : ''}{c.reason}</p>
      )}
      {c.prompts.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
          {c.prompts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="text-xs text-ink-muted">Methodology consideration: {guideText(c.guidance)}</div>
      {c.status === 'available' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select disabled={!canEdit} value={assessment} onChange={(e) => setAssessment(e.target.value as BenchmarkAssessment)}>
            <option value="">— Manager assessment —</option>
            {BENCHMARK_ASSESSMENTS.map((a) => (
              <option key={a} value={a}>
                {BENCHMARK_ASSESSMENT_LABEL[a]}
              </option>
            ))}
          </Select>
          <Input disabled={!canEdit} placeholder="Rationale (concise)" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          {canEdit && (
            <Button variant="secondary" disabled={!assessment || save.isPending} onClick={() => save.mutate()}>
              Save assessment
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function AdjustmentSchedule({
  s,
  base,
  canEdit,
  onChanged,
}: {
  s: MaterialitySummary;
  base: string;
  canEdit: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const blank = { description: '', amount: '', reason: '', recurring: false, evidence: '' };
  const [row, setRow] = useState(blank);
  const add = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/materiality/adjustments`, {
        method: 'POST',
        body: { ...row, amount: Number(row.amount) },
      }),
    onSuccess: () => {
      setRow(blank);
      toast('Adjustment added.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not add the adjustment.')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`${base}/materiality/adjustments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Adjustment removed from the draft schedule.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not remove the adjustment.')),
  });
  return (
    <div className="space-y-2">
      {s.adjustments.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-left text-ink-muted">
            <tr>
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Description</th>
              <th className="py-1 pr-2">± Amount</th>
              <th className="py-1 pr-2">Reason</th>
              <th className="py-1 pr-2">Recurring?</th>
              <th className="py-1 pr-2">Evidence</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.adjustments.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="py-1 pr-2 font-mono text-ink-faint">{a.code}</td>
                <td className="py-1 pr-2 text-ink">{a.description}</td>
                <td className="py-1 pr-2">{a.amount > 0 ? `+${a.amount}` : a.amount}</td>
                <td className="py-1 pr-2">{a.reason ?? <span className="text-danger-600">Reason needed</span>}</td>
                <td className="py-1 pr-2">{a.recurring ? 'Recurring' : 'Non-recurring'}</td>
                <td className="py-1 pr-2">{a.evidence ?? '—'}</td>
                <td className="py-1">
                  {canEdit && (
                    <button type="button" className="text-ink-faint hover:text-danger-600" onClick={() => remove.mutate(a.id)} title="Remove from draft">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-6">
          <Input className="sm:col-span-2" placeholder="Description" value={row.description} onChange={(e) => setRow({ ...row, description: e.target.value })} />
          <Input type="number" placeholder="± amount" value={row.amount} onChange={(e) => setRow({ ...row, amount: e.target.value })} />
          <Input placeholder="Reason" value={row.reason} onChange={(e) => setRow({ ...row, reason: e.target.value })} />
          <Input placeholder="Evidence (SharePoint link / ref)" value={row.evidence} onChange={(e) => setRow({ ...row, evidence: e.target.value })} />
          <label className="inline-flex items-center gap-1.5 text-xs text-ink">
            <input type="checkbox" checked={row.recurring} onChange={(e) => setRow({ ...row, recurring: e.target.checked })} />
            Recurring
          </label>
          <Button variant="secondary" disabled={!row.description || !row.amount || add.isPending} onClick={() => add.mutate()}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add line
          </Button>
        </div>
      )}
    </div>
  );
}

// ── 03.3.5 Overall materiality ───────────────────────────────────────────────

function FactorList({
  factors,
  picked,
  onToggle,
  disabled,
}: {
  factors: JudgmentFactor[];
  picked: string[];
  onToggle: (key: string, on: boolean) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <ul className="space-y-1">
      {factors.map((f) => (
        <li key={f.key} className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" disabled={disabled} checked={picked.includes(f.key)} onChange={(e) => onToggle(f.key, e.target.checked)} />
          <span>
            <span className="text-ink">{f.label}</span>{' '}
            <span className="text-ink-faint">
              [{f.source}] {f.present === true ? '— present' : f.present === false ? '— not indicated' : '— auditor to confirm'}
            </span>
            {f.detail && <span className="block text-ink-muted">{f.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function OverallTab({ s, canEdit, save, pending }: TabProps): JSX.Element {
  const d = s.determination;
  const c = s.computed;
  const [benchmark, setBenchmark] = useState<MaterialityBenchmark | ''>(d.selectedBenchmark ?? '');
  const [other, setOther] = useState({
    label: d.otherBenchmarkLabel ?? '',
    amount: d.otherBenchmarkAmount?.toString() ?? '',
    source: d.otherBenchmarkSource ?? '',
  });
  const [rationale, setRationale] = useState(d.benchmarkRationale ?? '');
  const [pctValue, setPctValue] = useState(d.selectedPct?.toString() ?? '');
  const [om, setOm] = useState(d.selectedOm?.toString() ?? '');
  const [adjReason, setAdjReason] = useState(d.omAdjustmentReason ?? '');
  const [override, setOverride] = useState(d.omOverrideReason ?? '');
  const [factors, setFactors] = useState<string[]>(d.pctFactorsConsidered);
  const [factorNote, setFactorNote] = useState(d.pctFactorsNote ?? '');
  const [mat04Rationale, setMat04Rationale] = useState(d.mat04Rationale ?? '');
  const selectable = s.candidates.filter((x) => x.status === 'available');
  const guidance = benchmark && benchmark !== 'other' ? s.methodology.omGuidance[benchmark] : null;
  const differs = d.selectedOm !== null && c.liveCalculatedOm !== null && Math.abs(d.selectedOm - c.liveCalculatedOm) > 0.5 && (c.roundedOm === null || Math.abs(d.selectedOm - c.roundedOm) > 0.5);
  const considered = s.pctFactors.filter((f) => factors.includes(f.key));
  const others = s.pctFactors.filter((f) => !factors.includes(f.key));

  return (
    <div className="space-y-3">
      <Question code="MAT-03 — Selected benchmark" text="Choose from the assessed candidates or an approved Other benchmark.">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select disabled={!canEdit} value={benchmark} onChange={(e) => setBenchmark(e.target.value as MaterialityBenchmark)}>
            <option value="">— Select benchmark —</option>
            {selectable.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label} ({x.assessment ? BENCHMARK_ASSESSMENT_LABEL[x.assessment] : 'not assessed'})
              </option>
            ))}
            <option value="other">{MATERIALITY_BENCHMARK_LABEL.other}</option>
          </Select>
          <Field label="Selected percentage (auditor judgment)" hint={`DHVAJ guidance: ${guideText(guidance)}`}>
            <Input type="number" step="0.01" disabled={!canEdit} value={pctValue} onChange={(e) => setPctValue(e.target.value)} />
          </Field>
        </div>
        {benchmark === 'other' && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Input disabled={!canEdit} placeholder="Other benchmark" value={other.label} onChange={(e) => setOther({ ...other, label: e.target.value })} />
            <Input type="number" disabled={!canEdit} placeholder={`Amount (${s.dataset.unitLabel ?? 'dataset units'})`} value={other.amount} onChange={(e) => setOther({ ...other, amount: e.target.value })} />
            <Input disabled={!canEdit} placeholder="Source" value={other.source} onChange={(e) => setOther({ ...other, source: e.target.value })} />
          </div>
        )}
        <Field label="Why this benchmark is appropriate (mandatory)">
          <Textarea rows={2} disabled={!canEdit} value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </Field>
      </Question>

      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Percentage judgment assistant</div>
        <p className="text-xs text-ink-muted">
          Factors are shown for judgment — they are never scored or converted into an automatic upward / downward
          percentage adjustment. Tick the ones you considered.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-ink">Factors considered in selecting the percentage</div>
            {considered.length ? (
              <FactorList factors={considered} picked={factors} disabled={!canEdit} onToggle={(k, on) => setFactors(on ? [...factors, k] : factors.filter((x) => x !== k))} />
            ) : (
              <p className="text-xs text-ink-faint">None ticked yet.</p>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-ink">Other engagement considerations</div>
            <FactorList factors={others} picked={factors} disabled={!canEdit} onToggle={(k, on) => setFactors(on ? [...factors, k] : factors.filter((x) => x !== k))} />
          </div>
        </div>
        <Input disabled={!canEdit} placeholder="Note on the percentage judgment" value={factorNote} onChange={(e) => setFactorNote(e.target.value)} />
      </Card>

      <Card className="space-y-2 p-3 text-sm">
        <div className="font-medium text-ink">Overall materiality</div>
        <div className="grid gap-2 text-xs sm:grid-cols-4">
          <div>Benchmark amount: <span className="text-ink">{c.liveBenchmarkAmount ?? '—'} {s.dataset.unitLabel}</span></div>
          <div>Calculated OM (unrounded): <span className="text-ink">{c.liveCalculatedOm !== null ? `₹${c.liveCalculatedOm.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</span></div>
          <div>Methodology rounded: <span className="text-ink">{inr(c.roundedOm)}</span></div>
          <div>Source status: <span className="text-ink">{s.dataset.dataStatus?.replace(/_/g, ' ') ?? '—'}</span></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[c.omMethodologyStatus]}>{METHODOLOGY_STATUS_LABEL[c.omMethodologyStatus]}</Badge>
          {c.effectiveOmPct !== null && <span className="text-xs text-ink-muted">Selected OM = {pct(c.effectiveOmPct, 3)} of the benchmark</span>}
        </div>
        <Field label="Selected OM (₹) — defaults to the calculated amount">
          <Input type="number" disabled={!canEdit} value={om} onChange={(e) => setOm(e.target.value)} />
        </Field>
        {(differs || d.omAdjustmentReason) && (
          <Field label="Reason the selected OM differs from the calculated amount (mandatory)">
            <Textarea rows={2} disabled={!canEdit} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
          </Field>
        )}
        {(c.omMethodologyStatus === 'outside_guidance' || d.omOverrideReason) && (
          <Field label="Outside DHVAJ guidance — override rationale (mandatory; Partner Attention)">
            <Textarea rows={2} disabled={!canEdit} value={override} onChange={(e) => setOverride(e.target.value)} />
          </Field>
        )}
        {canEdit && (
          <Button
            disabled={pending}
            onClick={() =>
              save(
                {
                  selectedBenchmark: benchmark || null,
                  otherBenchmarkLabel: other.label,
                  otherBenchmarkAmount: benchmark === 'other' ? num(other.amount) : undefined,
                  otherBenchmarkSource: other.source,
                  benchmarkRationale: rationale,
                  selectedPct: num(pctValue),
                  // Only send a changed OM, so a new benchmark / % re-defaults it.
                  selectedOm: om !== (d.selectedOm?.toString() ?? '') ? num(om) : undefined,
                  omAdjustmentReason: adjReason,
                  omOverrideReason: override,
                  pctFactorsConsidered: factors,
                  pctFactorsNote: factorNote,
                },
                'Overall materiality saved.',
              )
            }
          >
            Save overall materiality
          </Button>
        )}
      </Card>

      <Question
        code="MAT-04 — Overall Materiality reasonableness"
        text="Is the calculated / selected amount appropriate as materiality for the financial statements as a whole after considering the engagement circumstances?"
      >
        {d.mat04 && <Badge tone={d.mat04 === 'yes' ? 'success' : 'warn'}>{d.mat04 === 'yes' ? 'Yes' : 'No — Adjust materiality'}</Badge>}
        <Textarea rows={2} disabled={!canEdit} placeholder="Rationale (mandatory for No — Adjust)" value={mat04Rationale} onChange={(e) => setMat04Rationale(e.target.value)} />
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" disabled={pending || d.selectedOm === null} onClick={() => save({ mat04: 'yes', mat04Rationale }, 'MAT-04 recorded.')}>
              Yes
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => save({ mat04: 'no_adjust', mat04Rationale }, 'MAT-04: adjust materiality.')}>
              No — Adjust materiality
            </Button>
          </div>
        )}
      </Question>
    </div>
  );
}

// ── 03.3.6 Performance materiality ───────────────────────────────────────────

function PerformanceTab({ s, canEdit, save, pending }: TabProps): JSX.Element {
  const d = s.determination;
  const c = s.computed;
  const [factors, setFactors] = useState<string[]>(d.aggregationFactors);
  const [other, setOther] = useState(d.aggregationOther ?? '');
  const [pmPct, setPmPct] = useState(d.pmPct?.toString() ?? '');
  const [pm, setPm] = useState(d.selectedPm?.toString() ?? '');
  const [adjReason, setAdjReason] = useState(d.pmAdjustmentReason ?? '');
  const [rationale, setRationale] = useState(d.pmRationale ?? '');
  const [override, setOverride] = useState(d.pmOverrideReason ?? '');
  const pmNum = num(pm);
  const blocked = pmNum !== null && d.selectedOm !== null && pmNum >= d.selectedOm;
  const differs = d.selectedPm !== null && c.liveCalculatedPm !== null && Math.abs(d.selectedPm - c.liveCalculatedPm) > 0.5 && (c.roundedPm === null || Math.abs(d.selectedPm - c.roundedPm) > 0.5);

  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Aggregation-risk considerations</div>
        <p className="text-xs text-ink-muted">
          PM is set below OM to address aggregation of uncorrected and undetected misstatements. There is no fixed
          default percentage — tick what you considered.
        </p>
        <FactorList factors={s.aggregationFactors} picked={factors} disabled={!canEdit} onToggle={(k, on) => setFactors(on ? [...factors, k] : factors.filter((x) => x !== k))} />
        {factors.includes('other') && (
          <Input disabled={!canEdit} placeholder="Other factor" value={other} onChange={(e) => setOther(e.target.value)} />
        )}
      </Card>
      <Card className="space-y-2 p-3 text-sm">
        <div className="font-medium text-ink">MAT-05 — Performance materiality</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="text-xs">Overall materiality: <span className="text-ink">{inr(d.selectedOm)}</span></div>
          <Field label="PM % of OM (judgment)" hint={`DHVAJ guidance: ${guideText(s.methodology.pmGuidance)}`}>
            <Input type="number" step="0.01" disabled={!canEdit} value={pmPct} onChange={(e) => setPmPct(e.target.value)} />
          </Field>
          <div className="text-xs">Calculated PM: <span className="text-ink">{inr(c.liveCalculatedPm)}</span> · rounded {inr(c.roundedPm)}</div>
        </div>
        <Field label="Selected PM (₹)">
          <Input type="number" disabled={!canEdit} value={pm} onChange={(e) => setPm(e.target.value)} />
        </Field>
        {blocked && <p className="text-xs text-danger-600">Performance materiality must be below overall materiality.</p>}
        <Badge tone={STATUS_TONE[c.pmMethodologyStatus]}>{METHODOLOGY_STATUS_LABEL[c.pmMethodologyStatus]}</Badge>
        {(differs || d.pmAdjustmentReason) && (
          <Field label="Reason the selected PM differs from the calculated amount">
            <Textarea rows={2} disabled={!canEdit} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
          </Field>
        )}
        {(c.pmMethodologyStatus === 'outside_guidance' || d.pmOverrideReason) && (
          <Field label="Outside DHVAJ guidance — override rationale (Partner Attention)">
            <Textarea rows={2} disabled={!canEdit} value={override} onChange={(e) => setOverride(e.target.value)} />
          </Field>
        )}
        <Field label="Why this PM is appropriate">
          <Textarea rows={3} disabled={!canEdit} value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </Field>
        {canEdit && c.pmRationaleDraft && (
          <Button variant="ghost" onClick={() => setRationale(c.pmRationaleDraft!)}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Use generated draft from the selected factors
          </Button>
        )}
        {canEdit && (
          <Button
            disabled={pending || blocked}
            onClick={() =>
              save(
                {
                  aggregationFactors: factors,
                  aggregationOther: other,
                  pmPct: num(pmPct),
                  selectedPm: pm !== (d.selectedPm?.toString() ?? '') ? pmNum : undefined,
                  pmAdjustmentReason: adjReason,
                  pmRationale: rationale,
                  pmOverrideReason: override,
                },
                'Performance materiality saved.',
              )
            }
          >
            Save performance materiality
          </Button>
        )}
      </Card>
    </div>
  );
}

// ── 03.3.7 Specific materiality ──────────────────────────────────────────────

function SpecificTab({
  s,
  canEdit,
  save,
  pending,
  base,
  onChanged,
}: TabProps & { base: string; onChanged: () => void }): JSX.Element {
  const toast = useToast();
  const d = s.determination;
  const [note, setNote] = useState(d.mat06Note ?? '');
  const blank = { scopeType: 'disclosure' as SpecificScopeType, scope: '', thresholdType: 'monetary' as 'monetary' | 'qualitative', amount: '', specificPm: '', reason: '', areas: '' };
  const [row, setRow] = useState(blank);
  const add = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/materiality/specific`, {
        method: 'POST',
        body: {
          scopeType: row.scopeType,
          scope: row.scope,
          thresholdType: row.thresholdType,
          amount: row.thresholdType === 'monetary' ? num(row.amount) : null,
          specificPm: row.thresholdType === 'monetary' ? num(row.specificPm) : null,
          reason: row.reason,
          affectedAreas: row.areas.split(',').map((x) => x.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => {
      setRow(blank);
      toast('Specific materiality recorded.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save.')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`${base}/materiality/specific/${id}`, { method: 'DELETE' }),
    onSuccess: () => onChanged(),
    onError: (e) => toast(errMsg(e, 'Could not remove.')),
  });
  return (
    <div className="space-y-3">
      <Card className="space-y-1 p-3">
        <div className="text-xs font-medium text-ink-muted">Prompts from planning (not conclusions)</div>
        <ul className="space-y-0.5 text-xs">
          {s.specificPrompts.map((p) => (
            <li key={p.key}>
              <span className={p.present ? 'text-ink' : 'text-ink-muted'}>{p.label}</span>{' '}
              <span className="text-ink-faint">[{p.source}]</span>
              {p.present ? <span className="text-warn-700"> — {p.detail}</span> : p.present === null ? <span className="text-ink-faint"> — consider</span> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Question
        code="MAT-06"
        text="Are there particular classes of transactions, account balances or disclosures for which misstatements below Overall Materiality could reasonably be expected to influence users' decisions?"
      >
        {d.mat06 && <Badge tone={d.mat06 === 'further_assessment' ? 'warn' : 'info'}>{d.mat06 === 'no' ? 'No' : d.mat06 === 'yes' ? 'Yes' : 'Further assessment'}</Badge>}
        <Input disabled={!canEdit} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {(['no', 'yes', 'further_assessment'] as const).map((v) => (
              <Button key={v} variant="secondary" disabled={pending} onClick={() => save({ mat06: v, mat06Note: note }, 'MAT-06 recorded.')}>
                {v === 'no' ? 'No' : v === 'yes' ? 'Yes' : 'Further assessment'}
              </Button>
            ))}
          </div>
        )}
      </Question>
      {(d.mat06 === 'yes' || s.specific.length > 0) && (
        <Card className="space-y-2 p-3">
          <div className="text-sm font-medium text-ink">Specific materiality records</div>
          {s.specific.map((r: SpecificMaterialityRecord) => (
            <div key={r.id} className="flex items-start justify-between gap-2 border-t border-line pt-2 text-xs">
              <div>
                <span className="font-mono text-ink-faint">{r.code}</span>{' '}
                <span className="text-ink">{SPECIFIC_SCOPE_TYPE_LABEL[r.scopeType]} — {r.scope}</span>:{' '}
                {r.thresholdType === 'monetary' ? `${inr(r.amount)}${r.specificPm ? ` (specific PM ${inr(r.specificPm)})` : ''}` : 'Qualitative / no fixed monetary threshold'}
                <div className="text-ink-muted">{r.reason}</div>
                {r.affectedAreas.length > 0 && <div className="text-ink-faint">Affected areas: {r.affectedAreas.join(', ')}</div>}
              </div>
              {canEdit && (
                <button type="button" className="text-ink-faint hover:text-danger-600" onClick={() => remove.mutate(r.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <div className="grid gap-2 border-t border-line pt-2 sm:grid-cols-3">
              <Select value={row.scopeType} onChange={(e) => setRow({ ...row, scopeType: e.target.value as SpecificScopeType })}>
                {SPECIFIC_SCOPE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SPECIFIC_SCOPE_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
              <Input className="sm:col-span-2" placeholder="Class / balance / disclosure" value={row.scope} onChange={(e) => setRow({ ...row, scope: e.target.value })} />
              <Select value={row.thresholdType} onChange={(e) => setRow({ ...row, thresholdType: e.target.value as 'monetary' | 'qualitative' })}>
                <option value="monetary">Monetary threshold</option>
                <option value="qualitative">Qualitative / no fixed threshold</option>
              </Select>
              {row.thresholdType === 'monetary' && (
                <>
                  <Input type="number" placeholder="Specific materiality (₹)" value={row.amount} onChange={(e) => setRow({ ...row, amount: e.target.value })} />
                  <Input type="number" placeholder="Specific PM (₹, optional)" value={row.specificPm} onChange={(e) => setRow({ ...row, specificPm: e.target.value })} />
                </>
              )}
              <Input className="sm:col-span-3" placeholder="Why a lower / special threshold is needed (mandatory)" value={row.reason} onChange={(e) => setRow({ ...row, reason: e.target.value })} />
              <Input className="sm:col-span-2" placeholder="Affected audit areas (comma-separated; detail in 03.5)" value={row.areas} onChange={(e) => setRow({ ...row, areas: e.target.value })} />
              <Button variant="secondary" disabled={!row.scope || !row.reason || add.isPending} onClick={() => add.mutate()}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add record
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── 03.3.8 Clearly trivial ───────────────────────────────────────────────────

function TrivialTab({ s, canEdit, save, pending }: TabProps): JSX.Element {
  const d = s.determination;
  const c = s.computed;
  const [ctt, setCtt] = useState(d.selectedCtt?.toString() ?? '');
  const [rationale, setRationale] = useState(d.cttRationale ?? '');
  const [override, setOverride] = useState(d.cttOverrideReason ?? '');
  const g = s.methodology.cttGuidance;
  return (
    <div className="space-y-3">
      <Card className="flex items-start gap-2 border-warn-200 bg-warn-50 p-3 text-sm text-warn-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {CLEARLY_TRIVIAL_WARNING}
      </Card>
      <Card className="space-y-2 p-3 text-sm">
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div>Overall materiality: <span className="text-ink">{inr(d.selectedOm)}</span></div>
          <div>
            DHVAJ guidance: <span className="text-ink">{guideText(g)} of OM</span>
            {d.selectedOm !== null && g?.lowPct != null && (
              <span className="text-ink-muted"> ({inr((d.selectedOm * g.lowPct) / 100)}{g.highPct != null ? ` – ${inr((d.selectedOm * g.highPct) / 100)}` : ''})</span>
            )}
          </div>
          <div>Selected = <span className="text-ink">{pct(c.effectiveCttPct)}</span> of OM <Badge tone={STATUS_TONE[c.cttMethodologyStatus]}>{METHODOLOGY_STATUS_LABEL[c.cttMethodologyStatus]}</Badge></div>
        </div>
        <Field label="Selected clearly trivial amount (₹) — Manager judgment">
          <Input type="number" disabled={!canEdit} value={ctt} onChange={(e) => setCtt(e.target.value)} />
        </Field>
        <Field label="Basis for the threshold">
          <Textarea rows={2} disabled={!canEdit} value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </Field>
        {(c.cttMethodologyStatus === 'outside_guidance' || d.cttOverrideReason) && (
          <Field label="Outside DHVAJ guidance — rationale (mandatory)">
            <Textarea rows={2} disabled={!canEdit} value={override} onChange={(e) => setOverride(e.target.value)} />
          </Field>
        )}
        <p className="text-xs text-ink-muted">
          Published to the Misstatement Register (Completion). A qualitative override is always permitted — an item
          below the threshold can still be accumulated and considered.
        </p>
        {canEdit && (
          <Button disabled={pending} onClick={() => save({ selectedCtt: num(ctt), cttRationale: rationale, cttOverrideReason: override }, 'Clearly trivial threshold saved.')}>
            Save clearly trivial
          </Button>
        )}
      </Card>
    </div>
  );
}

// ── 03.3.9 Qualitative challenge ─────────────────────────────────────────────

function QualitativeTab({
  s,
  canEdit,
  base,
  signals,
  focus,
  onChanged,
}: TabProps & { base: string; signals: PlanningSignalRecord[]; focus: AreaOfFocusRecord[]; onChanged: () => void }): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Numerical thresholds are not a substitute for judgment: answer each nature / circumstance consideration,
        even where amounts are below OM or clearly trivial. Link an existing Planning Signal or Area of Focus
        rather than re-writing it.
      </p>
      {s.qualitative.map((q) => (
        <QualitativeRow key={`${q.key}-${q.version}`} q={q} base={base} canEdit={canEdit} signals={signals} focus={focus} onChanged={onChanged} />
      ))}
    </div>
  );
}

function QualitativeRow({
  q,
  base,
  canEdit,
  signals,
  focus,
  onChanged,
}: {
  q: QualitativeChallengeItem;
  base: string;
  canEdit: boolean;
  signals: PlanningSignalRecord[];
  focus: AreaOfFocusRecord[];
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [response, setResponse] = useState<QualitativeResponse | ''>(q.response ?? '');
  const [note, setNote] = useState(q.note ?? '');
  const [signalId, setSignalId] = useState(q.signalId ?? '');
  const [focusId, setFocusId] = useState(q.focusId ?? '');
  const [significant, setSignificant] = useState(q.significant);
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/materiality/qualitative/${q.key}`, {
        method: 'POST',
        body: { response, note, signalId: signalId || null, focusId: focusId || null, significant, version: q.version },
      }),
    onSuccess: () => {
      toast(`${q.label}: saved.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save.')),
  });
  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-ink">{q.label}</span>
        {q.response ? (
          <Badge tone={q.response === 'no_special_implication' ? 'neutral' : q.response === 'further_assessment' ? 'warn' : 'info'}>
            {QUALITATIVE_RESPONSE_LABEL[q.response]}
          </Badge>
        ) : (
          <Badge tone="neutral">Not answered</Badge>
        )}
      </div>
      {q.prompt && (
        <p className="rounded bg-primary-50 p-1.5 text-xs text-primary-700">{q.prompt}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-4">
        <Select disabled={!canEdit} value={response} onChange={(e) => setResponse(e.target.value as QualitativeResponse)}>
          <option value="">— Response —</option>
          {QUALITATIVE_RESPONSES.map((r) => (
            <option key={r} value={r}>
              {QUALITATIVE_RESPONSE_LABEL[r]}
            </option>
          ))}
        </Select>
        <Select disabled={!canEdit} value={signalId} onChange={(e) => setSignalId(e.target.value)}>
          <option value="">— Link Planning Signal —</option>
          {signals.map((sg) => (
            <option key={sg.id} value={sg.id}>
              {sg.signalCode} {sg.observation.slice(0, 60)}
            </option>
          ))}
        </Select>
        <Select disabled={!canEdit} value={focusId} onChange={(e) => setFocusId(e.target.value)}>
          <option value="">— Link Area of Focus —</option>
          {focus.map((f) => (
            <option key={f.id} value={f.id}>
              {f.focusCode} {f.name}
            </option>
          ))}
        </Select>
        <label className="inline-flex items-center gap-1.5 text-xs text-ink">
          <input type="checkbox" disabled={!canEdit} checked={significant} onChange={(e) => setSignificant(e.target.checked)} />
          Significant (Partner Attention)
        </label>
      </div>
      <Input disabled={!canEdit} placeholder="Note (required unless No special implication or a link explains it)" value={note} onChange={(e) => setNote(e.target.value)} />
      {canEdit && (
        <Button variant="secondary" disabled={!response || save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      )}
    </Card>
  );
}

// ── 03.3.10 Sensitivity ──────────────────────────────────────────────────────

function SensitivityTab({ s, canEdit, save, pending }: TabProps): JSX.Element {
  const d = s.determination;
  const [note, setNote] = useState(d.mat07Note ?? '');
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Sensitivity & reasonableness cross-checks</div>
        <p className="text-xs text-ink-muted">A challenge screen — there is no automatic pass / fail.</p>
        <table className="w-full text-xs">
          <thead className="text-left text-ink-muted">
            <tr>
              <th className="py-1 pr-2">Cross-check</th>
              <th className="py-1 pr-2">Calculation</th>
              <th className="py-1 pr-2">Result</th>
              <th className="py-1">Note</th>
            </tr>
          </thead>
          <tbody>
            {s.sensitivity.map((r) => (
              <tr key={r.key} className="border-t border-line">
                <td className="py-1 pr-2 text-ink">{r.label}</td>
                <td className="py-1 pr-2 text-ink-muted">{r.formula}</td>
                <td className="py-1 pr-2 text-ink">{r.display}</td>
                <td className="py-1 text-ink-faint">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Question
        code="MAT-07 — Sensitivity challenge"
        text="Does selected materiality remain reasonable when considered against alternative financial measures, prior-year materiality and current engagement circumstances?"
      >
        {d.mat07 && <Badge tone={d.mat07 === 'yes' ? 'success' : 'warn'}>{d.mat07 === 'yes' ? 'Yes' : 'No — Reassess'}</Badge>}
        <Input disabled={!canEdit} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => save({ mat07: 'yes', mat07Note: note }, 'MAT-07 recorded.')}>
              Yes
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => save({ mat07: 'no_reassess', mat07Note: note }, 'MAT-07: reassess.')}>
              No — Reassess
            </Button>
          </div>
        )}
      </Question>
    </div>
  );
}

// ── 03.3.11 Revision & history ───────────────────────────────────────────────

function RevisionTab({
  s,
  editable,
  base,
  engagementId,
  team,
  onChanged,
}: TabProps & { editable: boolean; base: string; engagementId: string; team: TeamMember[]; onChanged: () => void }): JSX.Element {
  const toast = useToast();
  const d = s.determination;
  const [trigger, setTrigger] = useState<RevisionTrigger>('actual_results');
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState('');
  const start = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/materiality/revisions`, {
        method: 'POST',
        body: { trigger, reason, ownerEmployeeId: owner || null },
      }),
    onSuccess: () => {
      toast('Revision started — the completed version stays in force until the revision is completed.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not start the revision.')),
  });
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Version history</div>
        <table className="w-full text-xs">
          <thead className="text-left text-ink-muted">
            <tr>
              <th className="py-1 pr-2">Version</th>
              <th className="py-1 pr-2">Status</th>
              <th className="py-1 pr-2">OM</th>
              <th className="py-1 pr-2">PM</th>
              <th className="py-1 pr-2">CTT</th>
              <th className="py-1">Revision / completed</th>
            </tr>
          </thead>
          <tbody>
            {s.history.length === 0 && (
              <tr>
                <td colSpan={6} className="py-1 text-ink-faint">Nothing saved yet.</td>
              </tr>
            )}
            {s.history.map((h) => (
              <tr key={h.versionNo} className="border-t border-line">
                <td className="py-1 pr-2 font-mono">{h.versionLabel}</td>
                <td className="py-1 pr-2">{h.status}</td>
                <td className="py-1 pr-2">{inr(h.overallMateriality)}</td>
                <td className="py-1 pr-2">{inr(h.performanceMateriality)}</td>
                <td className="py-1 pr-2">{inr(h.clearlyTrivial)}</td>
                <td className="py-1 text-ink-muted">
                  {h.revisionTrigger ? `${REVISION_TRIGGER_LABEL[h.revisionTrigger]}: ${h.revisionReason ?? ''}` : ''}
                  {h.completedAt ? ` · completed ${new Date(h.completedAt).toLocaleDateString('en-IN')}${h.completedByName ? ` by ${h.completedByName}` : ''}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {d.status === 'complete' && editable && (
        <Card className="space-y-2 p-3">
          <div className="text-sm font-medium text-ink">Revise materiality (creates {`v1.${d.versionNo}`})</div>
          <p className="text-xs text-ink-muted">
            SA 320 requires revision when information becomes known that would have caused a different initial
            amount. The completed version is kept as the baseline; affected work is flagged for reassessment.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value as RevisionTrigger)}>
              {REVISION_TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {REVISION_TRIGGER_LABEL[t]}
                </option>
              ))}
            </Select>
            <Input className="sm:col-span-2" placeholder="Reason (mandatory)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">— Owner —</option>
              {team.map((m) => (
                <option key={m.employeeId} value={m.employeeId}>
                  {m.employeeName}
                </option>
              ))}
            </Select>
            <Button disabled={!reason.trim() || start.isPending} onClick={() => start.mutate()}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Start revision
            </Button>
          </div>
        </Card>
      )}

      {d.versionNo > 1 && (
        <Card className="space-y-2 p-3">
          <div className="text-sm font-medium text-ink">
            {d.versionLabel} revision — {d.revisionTrigger ? REVISION_TRIGGER_LABEL[d.revisionTrigger] : ''}
          </div>
          <p className="text-xs text-ink-muted">{d.revisionReason}</p>
          {s.baseline && (
            <p className="text-xs text-ink-muted">
              Baseline {s.baseline.versionLabel} (read-only): OM {inr(s.baseline.overallMateriality)} · PM{' '}
              {inr(s.baseline.performanceMateriality)} · CTT {inr(s.baseline.clearlyTrivial)} · {s.baseline.specificCount} specific
            </p>
          )}
          <div className="text-xs font-medium text-ink">Affected work (system impact analysis)</div>
          {s.revisionItems.length === 0 && <p className="text-xs text-ink-faint">No affected work yet — change the amounts to see the impact.</p>}
          {s.revisionItems.map((i) => (
            <RevisionItemRow key={`${i.id}-${i.version}`} item={i} engagementId={engagementId} team={team} editable={editable} onChanged={onChanged} />
          ))}
        </Card>
      )}
    </div>
  );
}

function RevisionItemRow({
  item,
  engagementId,
  team,
  editable,
  onChanged,
}: {
  item: RevisionImpactItem;
  engagementId: string;
  team: TeamMember[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [owner, setOwner] = useState(item.ownerEmployeeId ?? '');
  const [resolution, setResolution] = useState(item.resolution ?? '');
  const save = useMutation({
    mutationFn: (status?: 'resolved') =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/materiality-revision-items/${item.id}`, {
        method: 'POST',
        body: { ownerEmployeeId: owner || null, resolution, status, version: item.version },
      }),
    onSuccess: () => {
      toast(`${item.label}: saved.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save.')),
  });
  return (
    <div className={`grid gap-2 border-t border-line pt-2 text-xs sm:grid-cols-5 ${item.applicable ? '' : 'opacity-60'}`}>
      <div className="sm:col-span-2">
        <div className="text-ink">{item.label}</div>
        <div className="text-ink-muted">{item.applicable ? item.detail : 'No longer applicable (kept for the trail).'}</div>
      </div>
      <Select disabled={!editable} value={owner} onChange={(e) => setOwner(e.target.value)}>
        <option value="">— Owner —</option>
        {team.map((m) => (
          <option key={m.employeeId} value={m.employeeId}>
            {m.employeeName}
          </option>
        ))}
      </Select>
      <Input disabled={!editable} placeholder="How it was reassessed" value={resolution} onChange={(e) => setResolution(e.target.value)} />
      <div className="flex gap-1">
        {editable && (
          <>
            <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
              Save
            </Button>
            <Button variant="ghost" disabled={save.isPending || !resolution.trim() || item.status === 'resolved'} onClick={() => save.mutate('resolved')}>
              {item.status === 'resolved' ? 'Resolved' : 'Resolve'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── 03.3.12 Conclusion ───────────────────────────────────────────────────────

function ConclusionTab({ s, canEdit, save, pending, base }: TabProps & { base: string }): JSX.Element {
  const toast = useToast();
  const d = s.determination;
  const [text, setText] = useState(d.conclusionSummary ?? '');
  const draft = useMutation({
    mutationFn: () => apiFetch<{ draft: string }>(`${base}/materiality/conclusion-draft`, { method: 'POST', body: {} }),
    onSuccess: (r) => {
      setText(r.draft);
      toast('Conclusion drafted from the structured judgments — review and edit before saving.');
    },
    onError: (e) => toast(errMsg(e, 'Could not draft the conclusion.')),
  });
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Partner Attention</div>
        {s.partnerAttention.length === 0 ? (
          <p className="text-xs text-ink-faint">No Partner Attention triggers.</p>
        ) : (
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
        <p className="text-[11px] text-ink-faint">03.3 needs no separate EP approval — formal planning approval is in 03.12.</p>
      </Card>
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Materiality impact preview</div>
        <table className="w-full text-xs">
          <tbody>
            {s.impactPreview.map((i) => (
              <tr key={i.consumer} className="border-t border-line">
                <td className="py-1 pr-2 text-ink">{i.consumer}</td>
                <td className="py-1 text-ink-muted">{i.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-ink-faint">Overall materiality is never used on its own to exclude an audit area.</p>
      </Card>
      <Card className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-ink">Materiality conclusion</div>
          {canEdit && (
            <Button variant="ghost" onClick={() => draft.mutate()} disabled={draft.isPending}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              Draft from structured judgments
            </Button>
          )}
        </div>
        <Textarea rows={14} disabled={!canEdit} value={text} onChange={(e) => setText(e.target.value)} />
      </Card>
      <CompletionChecklist checks={s.completion} />
      <Question
        code="MAT-08 — Manager conclusion"
        text="Do the selected materiality levels appropriately reflect the common financial-information needs of users and the circumstances of this audit?"
      >
        {d.mat08 && <Badge tone={d.mat08 === 'yes_complete' ? 'success' : 'warn'}>{d.mat08 === 'yes_complete' ? 'Yes — Complete' : 'No — Reassess'}</Badge>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => save({ conclusionSummary: text }, 'Conclusion saved.')}>
              Save conclusion
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => save({ conclusionSummary: text, mat08: 'no_reassess' }, 'Recorded — reassess.')}>
              No — Reassess
            </Button>
            <Button disabled={pending} onClick={() => save({ conclusionSummary: text, mat08: 'yes_complete' }, `Materiality ${d.versionLabel} completed and published.`)}>
              Yes — Complete 03.3
            </Button>
          </div>
        )}
      </Question>
    </div>
  );
}
