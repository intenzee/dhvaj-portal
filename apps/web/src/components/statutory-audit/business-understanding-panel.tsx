'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Info, Plus, Sparkles } from 'lucide-react';
import {
  DATASET_STATUSES,
  EXPECTATION_BASES,
  EXPECTATION_BASIS_LABEL,
  EXPECTATION_CONCLUSION_LABEL,
  EXPECTATION_CONCLUSIONS,
  FINANCIAL_METRIC_DEFS,
  FINANCIAL_UNIT_LABEL,
  FINANCIAL_UNITS,
  INDUSTRY_PROFILE_LABEL,
  INDUSTRY_PROFILES,
  INVESTIGATION_ASSESSMENT_LABEL,
  INVESTIGATION_ASSESSMENTS,
  METRIC_SOURCE_TYPE_LABEL,
  METRIC_SOURCE_TYPES,
  PLANNING_ATTENTION_LABEL,
  UNDERSTANDING_SECTION_DEFS,
  type BusinessUnderstandingSummary,
  type DatasetStatus,
  type ExpectationBasis,
  type ExpectationConclusion,
  type ExpectationDirection,
  type ExpectationType,
  type FinancialPeriod,
  type FinancialUnit,
  type IndustryProfile,
  type InvestigationAssessment,
  type InvestigationCardRecord,
  type InvestigationSignalDecision,
  type MetricSourceType,
  type PlanningExpectationRecord,
  type PlanningSignalRecord,
  type UnderstandingAnswer,
  type UnderstandingFieldDef,
  type UnderstandingSectionDef,
  type UnderstandingSectionRecord,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { CompletionChecklist } from './planning-strategy-sections';

/**
 * 03.2 Business Understanding & Preliminary Analytics (DHVAJ 03.2). The portal
 * calculates, compares and relates; the auditor interprets. Exceptions open
 * Investigation Cards and findings become Planning Signals in the SAME register
 * as 03.1. No trial-balance import in v1 — figures are entered with a source.
 */

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

type Tab = 'understanding' | 'dataset' | 'analytics' | 'investigations' | 'expectations' | 'conclusion';

const DATASET_STATUS_LABEL: Record<DatasetStatus, string> = {
  draft: 'Draft',
  final: 'Final',
  management_accounts: 'Management accounts',
};

const fmt = (n: number | null | undefined, dp = 2) =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: dp });

export function BusinessUnderstandingPanel({
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
  onChanged: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('understanding');
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}`;
  const qk = ['engagement', engagementId, 'business-understanding', workflowInstanceId];
  const summary = useQuery({
    queryKey: [...qk, 'summary'],
    queryFn: () => apiFetch<BusinessUnderstandingSummary>(`${base}/business-understanding`),
  });
  const signals = useQuery({
    queryKey: ['engagement', engagementId, 'planning-intelligence', workflowInstanceId, 'signals'],
    queryFn: () => apiFetch<PlanningSignalRecord[]>(`${base}/planning-signals`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk });
    // 03.2 writes into the shared 03.1 register.
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'planning-intelligence'] });
    onChanged();
  };

  const setProfile = useMutation({
    mutationFn: (industryProfile: IndustryProfile) =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/business-understanding`, {
        method: 'POST',
        body: { industryProfile, version: summary.data!.record.version },
      }),
    onSuccess: () => {
      toast('Industry profile updated — analytics recalculated.');
      refresh();
    },
    onError: (e) => toast(errMsg(e, 'Could not change the industry profile.')),
  });

  if (summary.isLoading) return <Spinner label="Loading 03.2…" />;
  const s = summary.data;
  if (!s) return <p className="text-sm text-ink-muted">03.2 is unavailable.</p>;
  const outstanding = s.completion.filter((c) => !c.met).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={s.record.status === 'complete' ? 'success' : 'info'}>
            {s.record.status === 'complete' ? 'Complete' : s.record.status === 'in_progress' ? 'In progress' : 'Not started'}
          </Badge>
          {s.openInvestigations > 0 && <Badge tone="warn">{s.openInvestigations} open investigation(s)</Badge>}
        </div>
        <div className="w-64">
          <Field label="Industry analytics profile">
            <Select
              value={s.record.industryProfile}
              disabled={!editable || setProfile.isPending}
              onChange={(e) => setProfile.mutate(e.target.value as IndustryProfile)}
            >
              {INDUSTRY_PROFILES.map((p) => (
                <option key={p} value={p}>
                  {INDUSTRY_PROFILE_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line">
        {(
          [
            ['understanding', 'Understanding (03.2.1–6)'],
            ['dataset', 'Financial dataset'],
            ['analytics', 'Analytical review'],
            ['investigations', `Investigations${s.openInvestigations ? ` (${s.openInvestigations})` : ''}`],
            ['expectations', 'Expectations'],
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

      {tab === 'understanding' && (
        <div className="space-y-2">
          {UNDERSTANDING_SECTION_DEFS.map((def) => (
            <SectionCard
              key={`${def.key}-${s.sections.find((x) => x.key === def.key)!.version}`}
              base={base}
              def={def}
              section={s.sections.find((x) => x.key === def.key)!}
              industryConsiderations={def.key === 'industry' ? s.industryConsiderations : []}
              editable={editable}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
      {tab === 'dataset' && (
        <DatasetSection key={s.dataset.version} base={base} summary={s} editable={editable} onChanged={refresh} />
      )}
      {tab === 'analytics' && <AnalyticsSection summary={s} />}
      {tab === 'investigations' && (
        <InvestigationsSection
          engagementId={engagementId}
          base={base}
          qk={qk}
          team={team}
          signals={signals.data ?? []}
          editable={editable}
          onChanged={refresh}
        />
      )}
      {tab === 'expectations' && (
        <ExpectationsSection
          engagementId={engagementId}
          base={base}
          qk={qk}
          summary={s}
          editable={editable}
          onChanged={refresh}
        />
      )}
      {tab === 'conclusion' && (
        <ConclusionSection key={s.record.version} base={base} summary={s} editable={editable} onChanged={refresh} />
      )}
    </div>
  );
}

// ── 03.2.1–03.2.6 Understanding sections ────────────────────────────────────

function SectionCard({
  base,
  def,
  section,
  industryConsiderations,
  editable,
  onChanged,
}: {
  base: string;
  def: UnderstandingSectionDef;
  section: UnderstandingSectionRecord;
  industryConsiderations: string[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState<'yes' | 'no' | null>(section.anythingChanged);
  const [answers, setAnswers] = useState<Record<string, UnderstandingAnswer>>(section.answers);
  const [raising, setRaising] = useState(false);
  // Ask "has anything changed?" before showing the detail (spec §5).
  const showDetail = changed !== null || section.version > 0;

  const save = useMutation({
    mutationFn: (reviewed?: boolean) =>
      apiFetch<UnderstandingSectionRecord>(`${base}/business-understanding/sections/${def.key}`, {
        method: 'POST',
        body: { anythingChanged: changed ?? undefined, answers, reviewed, version: section.version },
      }),
    onSuccess: (_r, reviewed) => {
      toast(reviewed ? `${def.code} marked reviewed.` : `${def.code} saved.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the section.')),
  });

  return (
    <Card className="p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-ink-faint" /> : <ChevronRight className="h-4 w-4 text-ink-faint" />}
          <span className="font-mono text-xs text-ink-faint">{def.code}</span>
          <span className="text-sm font-medium text-ink">{def.title}</span>
        </span>
        <span className="flex gap-1.5">
          {section.anythingChanged === 'yes' && <Badge tone="warn">Changed</Badge>}
          <Badge tone={section.reviewed ? 'success' : 'neutral'}>{section.reviewed ? 'Reviewed' : 'Not reviewed'}</Badge>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
          <p className="text-xs text-ink-muted">{def.purpose}</p>
          {section.context.length > 0 && (
            <div className="rounded-lg bg-surface-raised p-2">
              <div className="mb-1 text-xs font-medium text-ink-muted">Already recorded elsewhere (not asked again)</div>
              <ul className="space-y-0.5 text-xs text-ink">
                {section.context.map((c, i) => (
                  <li key={i}>
                    <span className="text-ink-faint">[{c.source}]</span> {c.label}: {c.value}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {industryConsiderations.length > 0 && (
            <div className="rounded-lg bg-primary-50 p-2 text-xs text-primary-700">
              <div className="mb-1 font-medium">Suggested industry considerations — confirm relevance below</div>
              <ul className="list-disc pl-4">
                {industryConsiderations.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm text-ink">Has anything changed since the prior understanding?</span>
            {(['no', 'yes'] as const).map((v) => (
              <label key={v} className="inline-flex items-center gap-1.5 text-sm text-ink">
                <input type="radio" name={`changed-${def.key}`} disabled={!editable} checked={changed === v} onChange={() => setChanged(v)} />
                {v === 'yes' ? 'Yes' : 'No'}
              </label>
            ))}
          </div>
          {showDetail && (
            <div className="grid gap-3 sm:grid-cols-2">
              {def.fields.map((f) => (
                <div key={f.key} className={f.type === 'repeat' || f.type === 'multi' ? 'sm:col-span-2' : ''}>
                  <FieldInput
                    field={f}
                    value={answers[f.key] ?? null}
                    disabled={!editable}
                    onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))}
                  />
                </div>
              ))}
            </div>
          )}
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => save.mutate(undefined)} disabled={save.isPending || changed === null}>
                Save
              </Button>
              <Button onClick={() => save.mutate(true)} disabled={save.isPending || changed === null || section.reviewed}>
                {section.reviewed ? 'Reviewed' : 'Save & mark reviewed'}
              </Button>
              <Button variant="ghost" onClick={() => setRaising((r) => !r)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Raise Planning Signal
              </Button>
            </div>
          )}
          {raising && <RaiseSignalForm base={base} sourceLink={`03.2/${def.key}`} onDone={() => setRaising(false)} onChanged={onChanged} />}
        </div>
      )}
    </Card>
  );
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: UnderstandingFieldDef;
  value: UnderstandingAnswer;
  disabled: boolean;
  onChange: (v: UnderstandingAnswer) => void;
}): JSX.Element {
  const label = field.code ? `${field.code} · ${field.label}` : field.label;
  switch (field.type) {
    case 'text':
      return (
        <Field label={label} hint={field.hint}>
          <Textarea rows={2} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'yes_no':
    case 'yes_no_unknown':
    case 'select':
      return (
        <Field label={label} hint={field.hint}>
          <Select disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">— Select —</option>
            {field.options!.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'multi': {
      const picked = (value as string[]) ?? [];
      return (
        <Field label={label} hint={field.hint}>
          <div className="flex flex-wrap gap-3">
            {field.options!.map((o) => (
              <label key={o} className="inline-flex items-center gap-1.5 text-xs text-ink">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={picked.includes(o)}
                  onChange={(e) => onChange(e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))}
                />
                {o}
              </label>
            ))}
          </div>
        </Field>
      );
    }
    case 'repeat': {
      const rows = (value as string[][]) ?? [];
      const cols = field.columns!;
      const set = (r: number, c: number, v: string) =>
        onChange(rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row)));
      return (
        <Field label={label} hint={field.hint}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c} className="px-1 py-1 text-left font-medium text-ink-muted">
                      {c}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className="px-1 py-0.5">
                        <Input disabled={disabled} value={cell} onChange={(e) => set(r, c, e.target.value)} />
                      </td>
                    ))}
                    <td>
                      {!disabled && (
                        <Button variant="ghost" onClick={() => onChange(rows.filter((_, i) => i !== r))}>
                          ✕
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!disabled && (
            <Button variant="ghost" onClick={() => onChange([...rows, cols.map(() => '')])}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add row
            </Button>
          )}
        </Field>
      );
    }
  }
}

function RaiseSignalForm({
  base,
  sourceLink,
  onDone,
  onChanged,
}: {
  base: string;
  sourceLink: string;
  onDone: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [observation, setObservation] = useState('');
  const [why, setWhy] = useState('');
  const create = useMutation({
    mutationFn: () =>
      apiFetch<PlanningSignalRecord>(`${base}/planning-signals`, {
        method: 'POST',
        body: { source: 'manager', sourceLink, observation, whyMayMatter: why || undefined },
      }),
    onSuccess: (sig) => {
      toast(`${sig.signalCode} added to the Planning Signal Register.`);
      onChanged();
      onDone();
    },
    onError: (e) => toast(errMsg(e, 'Could not raise the signal.')),
  });
  return (
    <div className="space-y-2 rounded-lg bg-surface-raised p-3">
      <Field label="Observation" hint="The fact only — not a risk conclusion." required>
        <Textarea rows={2} value={observation} onChange={(e) => setObservation(e.target.value)} />
      </Field>
      <Field label="Why it may matter">
        <Input value={why} onChange={(e) => setWhy(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button onClick={() => create.mutate()} disabled={create.isPending || !observation.trim()}>
          Raise signal
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── 03.2.7 Focused Financial Dataset ────────────────────────────────────────

interface CellState {
  amount: string;
  source: MetricSourceType | '';
  version: number;
  original: string;
  originalSource: MetricSourceType | '';
}

function DatasetSection({
  base,
  summary: s,
  editable,
  onChanged,
}: {
  base: string;
  summary: BusinessUnderstandingSummary;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const h = s.dataset;
  const [header, setHeader] = useState({
    periodEnd: h.periodEnd ?? '',
    pyPeriodEnd: h.pyPeriodEnd ?? '',
    currency: h.currency ?? 'INR',
    units: (h.units ?? '') as FinancialUnit | '',
    pyUnits: (h.pyUnits ?? '') as FinancialUnit | '',
    cySource: h.cySource ?? '',
    pySource: h.pySource ?? '',
    dataStatus: (h.dataStatus ?? '') as DatasetStatus | '',
    sourceDate: h.sourceDate ?? '',
  });
  const ready = !!(h.periodEnd && h.currency && h.units);
  const defaultSource = (p: FinancialPeriod): MetricSourceType =>
    p === 'py' ? 'audited_py_fs' : h.dataStatus === 'management_accounts' ? 'management_accounts' : 'draft_fs';

  const metrics = [
    ...FINANCIAL_METRIC_DEFS.map((d) => ({ key: d.key as string, label: d.label, note: d.note })),
    ...s.customMetrics.map((c) => ({ key: c.key, label: c.label, note: 'Custom' })),
  ];
  const initialCells = () => {
    const out: Record<string, CellState> = {};
    for (const m of metrics) {
      for (const p of ['cy', 'py'] as FinancialPeriod[]) {
        const v = s.values.find((x) => x.metricKey === m.key && x.period === p);
        const amount = v ? String(v.amount) : '';
        out[`${m.key}:${p}`] = {
          amount,
          source: v?.sourceType ?? '',
          version: v?.version ?? 0,
          original: amount,
          originalSource: v?.sourceType ?? '',
        };
      }
    }
    return out;
  };
  const [cells, setCells] = useState<Record<string, CellState>>(initialCells);
  const [newMetric, setNewMetric] = useState('');
  const dirty = Object.entries(cells).filter(([, c]) => c.amount !== c.original || c.source !== c.originalSource);

  const saveHeader = useMutation({
    mutationFn: () =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/financial-dataset`, {
        method: 'POST',
        body: {
          periodEnd: header.periodEnd || undefined,
          pyPeriodEnd: header.pyPeriodEnd || undefined,
          currency: header.currency || undefined,
          units: header.units || undefined,
          pyUnits: header.pyUnits || undefined,
          cySource: header.cySource || undefined,
          pySource: header.pySource || undefined,
          dataStatus: header.dataStatus || undefined,
          sourceDate: header.sourceDate || undefined,
          version: h.version,
        },
      }),
    onSuccess: () => {
      toast('Dataset header saved.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the header.')),
  });

  const saveValues = useMutation({
    mutationFn: () =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/financial-dataset/values`, {
        method: 'POST',
        body: {
          values: dirty.map(([key, c]) => {
            const [metricKey, period] = key.split(':') as [string, FinancialPeriod];
            return {
              metricKey,
              period,
              amount: c.amount.trim() === '' ? null : Number(c.amount),
              sourceType: c.source || defaultSource(period),
              version: c.version,
            };
          }),
        },
      }),
    onSuccess: (r) => {
      toast(`Figures saved — ${r.analytics.exceptions.length} exception(s) surfaced for investigation.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the figures.')),
  });

  const addMetric = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/financial-dataset/custom-metrics`, { method: 'POST', body: { label: newMetric } }),
    onSuccess: () => {
      toast('Custom metric added.');
      setNewMetric('');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not add the metric.')),
  });

  const invalid = dirty.some(([, c]) => c.amount.trim() !== '' && Number.isNaN(Number(c.amount)));
  const set = (key: string, patch: Partial<CellState>) => setCells((cur) => ({ ...cur, [key]: { ...cur[key]!, ...patch } }));

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        No trial-balance import in v1 — enter the planning figures from management accounts or draft
        statements. Every figure records its source.
      </p>
      <Card className="space-y-3 p-3">
        <div className="text-sm font-medium text-ink">Dataset header</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Period end" required>
            <Input type="date" disabled={!editable} value={header.periodEnd} onChange={(e) => setHeader({ ...header, periodEnd: e.target.value })} />
          </Field>
          <Field label="Prior period end">
            <Input type="date" disabled={!editable} value={header.pyPeriodEnd} onChange={(e) => setHeader({ ...header, pyPeriodEnd: e.target.value })} />
          </Field>
          <Field label="Currency" required>
            <Input disabled={!editable} maxLength={3} value={header.currency} onChange={(e) => setHeader({ ...header, currency: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Units" required>
            <Select disabled={!editable} value={header.units} onChange={(e) => setHeader({ ...header, units: e.target.value as FinancialUnit })}>
              <option value="">— Select —</option>
              {FINANCIAL_UNITS.map((u) => (
                <option key={u} value={u}>
                  {FINANCIAL_UNIT_LABEL[u]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prior-year units" hint="Only if different — the portal converts.">
            <Select disabled={!editable} value={header.pyUnits} onChange={(e) => setHeader({ ...header, pyUnits: e.target.value as FinancialUnit })}>
              <option value="">Same as current year</option>
              {FINANCIAL_UNITS.map((u) => (
                <option key={u} value={u}>
                  {FINANCIAL_UNIT_LABEL[u]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Data status" required>
            <Select disabled={!editable} value={header.dataStatus} onChange={(e) => setHeader({ ...header, dataStatus: e.target.value as DatasetStatus })}>
              <option value="">— Select —</option>
              {DATASET_STATUSES.map((d) => (
                <option key={d} value={d}>
                  {DATASET_STATUS_LABEL[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Current-year source" required>
            <Input disabled={!editable} placeholder="e.g. Draft FS FY26 v2" value={header.cySource} onChange={(e) => setHeader({ ...header, cySource: e.target.value })} />
          </Field>
          <Field label="Prior-year source">
            <Input disabled={!editable} placeholder="e.g. Audited FS FY25" value={header.pySource} onChange={(e) => setHeader({ ...header, pySource: e.target.value })} />
          </Field>
          <Field label="Source date">
            <Input type="date" disabled={!editable} value={header.sourceDate} onChange={(e) => setHeader({ ...header, sourceDate: e.target.value })} />
          </Field>
        </div>
        {h.preparedByName && <p className="text-[11px] text-ink-faint">Prepared by {h.preparedByName}</p>}
        {editable && (
          <Button variant="secondary" onClick={() => saveHeader.mutate()} disabled={saveHeader.isPending || !header.periodEnd || !header.units || !header.currency}>
            Save header
          </Button>
        )}
      </Card>

      {h.dataStatus && h.dataStatus !== 'final' && (
        <p className="flex items-center gap-1.5 rounded-md bg-warning-50 px-2 py-1.5 text-xs text-warning-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          Current-year figures are {DATASET_STATUS_LABEL[h.dataStatus].toLowerCase()} — unaudited.
        </p>
      )}

      {!ready ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
          Record the period end, currency and units before entering figures.
        </p>
      ) : (
        <Card className="p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="py-1 pr-2 font-medium">Metric ({FINANCIAL_UNIT_LABEL[h.units!]})</th>
                  <th className="py-1 pr-2 font-medium">Current year</th>
                  <th className="py-1 pr-2 font-medium">CY source</th>
                  <th className="py-1 pr-2 font-medium">Prior year</th>
                  <th className="py-1 pr-2 font-medium">PY source</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.key} className="border-t border-line">
                    <td className="py-1 pr-2">
                      <div className="text-ink">{m.label}</div>
                      <div className="text-[11px] text-ink-faint">{m.note}</div>
                    </td>
                    {(['cy', 'py'] as FinancialPeriod[]).map((p) => {
                      const key = `${m.key}:${p}`;
                      const c = cells[key]!;
                      return [
                        <td key={`${key}-a`} className="w-32 py-1 pr-2">
                          <Input inputMode="decimal" disabled={!editable} value={c.amount} onChange={(e) => set(key, { amount: e.target.value })} />
                        </td>,
                        <td key={`${key}-s`} className="w-44 py-1 pr-2">
                          <Select
                            disabled={!editable || c.amount.trim() === ''}
                            value={c.source || (c.amount.trim() ? defaultSource(p) : '')}
                            onChange={(e) => set(key, { source: e.target.value as MetricSourceType })}
                          >
                            <option value="">—</option>
                            {METRIC_SOURCE_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {METRIC_SOURCE_TYPE_LABEL[t]}
                              </option>
                            ))}
                          </Select>
                        </td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Button onClick={() => saveValues.mutate()} disabled={saveValues.isPending || dirty.length === 0 || invalid}>
                Save {dirty.length ? `${dirty.length} change(s)` : 'figures'}
              </Button>
              <div className="w-56">
                <Input placeholder="Custom metric, e.g. Order book" value={newMetric} onChange={(e) => setNewMetric(e.target.value)} />
              </div>
              <Button variant="ghost" onClick={() => addMetric.mutate()} disabled={addMetric.isPending || !newMetric.trim()}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add metric
              </Button>
            </div>
          )}
          {invalid && <p className="mt-1 text-xs text-danger-700">Amounts must be numbers.</p>}
        </Card>
      )}
    </div>
  );
}

// ── 03.2.8 Preliminary Analytical Review ────────────────────────────────────

function AnalyticsSection({ summary: s }: { summary: BusinessUnderstandingSummary }): JSX.Element {
  const a = s.analytics;
  const unit = s.dataset.units ? FINANCIAL_UNIT_LABEL[s.dataset.units] : '';
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Preliminary planning analytics (SA 315 / SA 520) — not substantive evidence. Attention
        parameters (movement {a.parameters.movementPct}%, relationship gap {a.parameters.relationshipGapPts}{' '}
        points, ratio shift {a.parameters.ratioShiftPts} points; {a.methodologyVersion}) only surface
        items to investigate. They are not materiality.
      </p>
      {a.warnings.map((w) => (
        <p key={w.code} className="flex items-center gap-1.5 rounded-md bg-warning-50 px-2 py-1.5 text-xs text-warning-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          {w.message}
        </p>
      ))}
      <Card className="p-3">
        <div className="mb-2 text-sm font-medium text-ink">Movements ({unit})</div>
        {a.movements.length === 0 ? (
          <p className="text-sm text-ink-muted">No figures entered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="py-1 pr-2 font-medium">Metric</th>
                  <th className="py-1 pr-2 text-right font-medium">CY</th>
                  <th className="py-1 pr-2 text-right font-medium">PY</th>
                  <th className="py-1 pr-2 text-right font-medium">CY − PY</th>
                  <th className="py-1 pr-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {a.movements.map((m) => (
                  <tr key={m.metricKey} className="border-t border-line">
                    <td className="py-1 pr-2 text-ink">{m.label}</td>
                    <td className="py-1 pr-2 text-right">{fmt(m.cy)}</td>
                    <td className="py-1 pr-2 text-right">{fmt(m.py)}</td>
                    <td className="py-1 pr-2 text-right">{fmt(m.absolute)}</td>
                    <td className="py-1 pr-2 text-right" title={m.percentLabel === 'N/M' ? 'Not meaningful — prior year is zero' : undefined}>
                      {m.percentLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="p-3">
        <div className="mb-2 text-sm font-medium text-ink">Ratios & relationships</div>
        <div className="space-y-2">
          {a.ratios.map((r) => (
            <div key={r.key} className="border-t border-line pt-2 text-sm first:border-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ink">{r.label}</span>
                {r.status === 'calculated' ? (
                  <span className="font-mono text-xs text-ink">
                    CY {fmt(r.cy, 2)}
                    {r.unit === '%' ? '%' : r.unit === 'days' ? ' days' : r.unit === 'x' ? '×' : ''} · PY {fmt(r.py, 2)}
                    {r.unit === '%' ? '%' : r.unit === 'days' ? ' days' : r.unit === 'x' ? '×' : ''}
                  </span>
                ) : (
                  <Badge tone="neutral">
                    {r.status === 'not_applicable' ? 'Not applicable' : r.status === 'not_meaningful' ? 'Not meaningful' : 'Insufficient data'}
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-ink-faint">
                {r.formula}
                {r.reason ? ` — ${r.reason}` : ''}
                {r.status === 'calculated' &&
                  ` · inputs: ${r.inputs.map((i) => `${i.label} ${fmt(i.cy)} / ${fmt(i.py)}`).join('; ')}`}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── 03.2.9 Investigation Cards ──────────────────────────────────────────────

function InvestigationsSection({
  engagementId,
  base,
  qk,
  team,
  signals,
  editable,
  onChanged,
}: {
  engagementId: string;
  base: string;
  qk: string[];
  team: TeamMember[];
  signals: PlanningSignalRecord[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const cards = useQuery({
    queryKey: [...qk, 'exceptions'],
    queryFn: () => apiFetch<InvestigationCardRecord[]>(`${base}/analytics-exceptions`),
  });
  if (cards.isLoading) return <Spinner label="Loading investigations…" />;
  const list = cards.data ?? [];
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Each flagged exception needs an auditor assessment. A management explanation on its own does
        not close it. Findings become Planning Signals in the 03.1 register — no separate risk register.
      </p>
      {list.length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
          No exceptions surfaced. Enter comparable figures in the financial dataset.
        </p>
      )}
      {list.map((c) => (
        <InvestigationCard key={`${c.id}-${c.version}`} engagementId={engagementId} card={c} team={team} signals={signals} editable={editable} onChanged={onChanged} />
      ))}
    </div>
  );
}

function InvestigationCard({
  engagementId,
  card: c,
  team,
  signals,
  editable,
  onChanged,
}: {
  engagementId: string;
  card: InvestigationCardRecord;
  team: TeamMember[];
  signals: PlanningSignalRecord[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState(c.needsReassessment);
  const [explanation, setExplanation] = useState(c.managementExplanation ?? '');
  const [by, setBy] = useState(c.explanationBy ?? '');
  const [date, setDate] = useState(c.explanationDate ?? '');
  const [evidence, setEvidence] = useState(c.evidence ?? '');
  const [assessment, setAssessment] = useState<InvestigationAssessment | ''>(c.assessment ?? '');
  const [areas, setAreas] = useState(c.affectedAreas.join(', '));
  const [decision, setDecision] = useState<InvestigationSignalDecision | ''>(c.signalDecision ?? '');
  const [linkId, setLinkId] = useState('');
  const [rationale, setRationale] = useState(c.noSignalRationale ?? '');
  const [owner, setOwner] = useState(c.ownerEmployeeId ?? '');
  const [due, setDue] = useState(c.dueDate ?? '');

  const elevated = c.suggestedAttention !== 'standard';
  const blocked =
    (assessment === 'further_information_required' && !owner) ||
    (decision === 'none' && elevated && !rationale.trim()) ||
    (decision === 'link' && !linkId && !c.signalId);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<InvestigationCardRecord>(`/engagements/${engagementId}/statutory-audit/analytics-exceptions/${c.id}`, {
        method: 'POST',
        body: {
          managementExplanation: explanation || undefined,
          explanationBy: by || undefined,
          explanationDate: date || undefined,
          evidence: evidence || undefined,
          assessment: assessment || undefined,
          affectedAreas: areas.split(',').map((x) => x.trim()).filter(Boolean),
          signalDecision: decision || undefined,
          linkSignalId: decision === 'link' && linkId ? linkId : undefined,
          noSignalRationale: decision === 'none' ? rationale || undefined : undefined,
          ownerEmployeeId: owner || undefined,
          dueDate: due || undefined,
          version: c.version,
        },
      }),
    onSuccess: (r) => {
      toast(r.signalCode && !c.signalCode ? `${c.cardCode} saved — ${r.signalCode} raised.` : `${c.cardCode} saved.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the investigation.')),
  });

  return (
    <Card className={c.noLongerFlagged ? 'p-3 opacity-70' : 'p-3'}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start justify-between gap-3 text-left">
        <span className="flex min-w-0 items-start gap-2">
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />}
          <span className="min-w-0">
            <span className="mr-2 font-mono text-xs text-ink-faint">{c.cardCode}</span>
            <span className="text-sm text-ink">{c.observation}</span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              {c.assessment ? <Badge tone="info">{INVESTIGATION_ASSESSMENT_LABEL[c.assessment]}</Badge> : <Badge tone="warn">Not assessed</Badge>}
              {c.needsReassessment && <Badge tone="danger">Figures changed — reassess</Badge>}
              {c.noLongerFlagged && <Badge>No longer flagged</Badge>}
              {c.signalCode && <Badge>{c.signalCode}</Badge>}
              {c.ownerName && <Badge>Owner: {c.ownerName}</Badge>}
            </span>
          </span>
        </span>
        <Badge tone={c.suggestedAttention === 'standard' ? 'neutral' : c.suggestedAttention === 'enhanced' ? 'warn' : 'danger'} className="shrink-0">
          {PLANNING_ATTENTION_LABEL[c.suggestedAttention]}
        </Badge>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
          <p className="text-xs text-ink-muted">Why flagged: {c.whyFlagged}</p>
          {editable ? (
            <div className="space-y-3 rounded-lg bg-surface-raised p-3">
              <Field label="Management explanation">
                <Textarea rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Provided by">
                  <Input value={by} onChange={(e) => setBy(e.target.value)} />
                </Field>
                <Field label="Date">
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Evidence / corroboration" hint="Link or reference; optional until obtained.">
                  <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Auditor assessment">
                  <Select value={assessment} onChange={(e) => setAssessment(e.target.value as InvestigationAssessment)}>
                    <option value="">— Not yet assessed —</option>
                    {INVESTIGATION_ASSESSMENTS.map((x) => (
                      <option key={x} value={x}>
                        {INVESTIGATION_ASSESSMENT_LABEL[x]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Potentially affected FS areas" hint="Suggested — edit as needed. Final areas are 03.5.">
                  <Input value={areas} onChange={(e) => setAreas(e.target.value)} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Owner" required={assessment === 'further_information_required'}>
                  <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">— Select —</option>
                    {team.map((m) => (
                      <option key={m.employeeId} value={m.employeeId}>
                        {m.employeeName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due">
                  <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                </Field>
              </div>
              <div>
                <div className="mb-1 text-sm font-medium text-ink">Planning Signal</div>
                <div className="flex flex-wrap gap-3 text-xs text-ink">
                  {(
                    [
                      ['create', c.signalCode && c.signalDecision === 'create' ? `Raised (${c.signalCode})` : 'Create signal'],
                      ['link', 'Link existing signal'],
                      ['none', 'No signal'],
                    ] as [InvestigationSignalDecision, string][]
                  ).map(([k, label]) => (
                    <label key={k} className="inline-flex items-center gap-1.5">
                      <input type="radio" name={`dec-${c.id}`} checked={decision === k} onChange={() => setDecision(k)} />
                      {label}
                    </label>
                  ))}
                </div>
                {decision === 'link' && (
                  <div className="mt-2">
                    <Select value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                      <option value="">{c.signalCode ? `Keep ${c.signalCode}` : '— Select a signal —'}</option>
                      {signals.map((sg) => (
                        <option key={sg.id} value={sg.id}>
                          {sg.signalCode} — {sg.observation.slice(0, 80)}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                {decision === 'none' && (
                  <div className="mt-2">
                    <Input
                      placeholder={elevated ? 'Rationale (required for Enhanced / Immediate Partner)' : 'Rationale'}
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <Button onClick={() => save.mutate()} disabled={save.isPending || blocked}>
                Save investigation
              </Button>
            </div>
          ) : (
            <div className="space-y-1 text-xs text-ink-muted">
              {c.managementExplanation && (
                <p>
                  Management ({c.explanationBy ?? '—'}, {c.explanationDate ?? '—'}): {c.managementExplanation}
                </p>
              )}
              {c.noSignalRationale && <p>No signal because: {c.noSignalRationale}</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── §14 Expectation vs Actual ───────────────────────────────────────────────

function ExpectationsSection({
  engagementId,
  base,
  qk,
  summary: s,
  editable,
  onChanged,
}: {
  engagementId: string;
  base: string;
  qk: string[];
  summary: BusinessUnderstandingSummary;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const list = useQuery({
    queryKey: [...qk, 'expectations'],
    queryFn: () => apiFetch<PlanningExpectationRecord[]>(`${base}/planning-expectations`),
  });
  const [metric, setMetric] = useState('');
  const [type, setType] = useState<ExpectationType>('amount');
  const [amount, setAmount] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [direction, setDirection] = useState<ExpectationDirection | ''>('');
  const [tolerance, setTolerance] = useState('');
  const [basis, setBasis] = useState<ExpectationBasis | ''>('');
  const [basisNote, setBasisNote] = useState('');

  const metrics = [
    ...FINANCIAL_METRIC_DEFS.map((d) => ({ key: d.key as string, label: d.label })),
    ...s.customMetrics.map((c) => ({ key: c.key, label: c.label })),
  ];
  const create = useMutation({
    mutationFn: () =>
      apiFetch<PlanningExpectationRecord>(`${base}/planning-expectations`, {
        method: 'POST',
        body: {
          metricKey: metric,
          expectationType: type,
          expectedAmount: type === 'amount' ? Number(amount) : undefined,
          expectedLow: type === 'range' ? Number(low) : undefined,
          expectedHigh: type === 'range' ? Number(high) : undefined,
          expectedDirection: type === 'direction' ? direction : undefined,
          tolerancePct: tolerance ? Number(tolerance) : undefined,
          basis,
          basisNote: basisNote || undefined,
        },
      }),
    onSuccess: () => {
      toast('Expectation recorded.');
      setMetric('');
      setAmount('');
      setLow('');
      setHigh('');
      setDirection('');
      setTolerance('');
      setBasis('');
      setBasisNote('');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not record the expectation.')),
  });
  const shapeOk =
    (type === 'amount' && amount.trim() !== '' && !Number.isNaN(Number(amount))) ||
    (type === 'range' && low.trim() !== '' && high.trim() !== '' && Number(low) <= Number(high)) ||
    (type === 'direction' && !!direction);

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Optional planning expectations from budget, prior trend or operational drivers. If later used
        as a substantive analytical procedure, the audit-programme workpaper must separately satisfy
        SA 520.
      </p>
      {(list.data ?? []).map((e) => (
        <ExpectationCard key={`${e.id}-${e.version}`} engagementId={engagementId} expectation={e} editable={editable} onChanged={onChanged} />
      ))}
      {editable && (
        <Card className="space-y-3 p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Metric" required>
              <Select value={metric} onChange={(e) => setMetric(e.target.value)}>
                <option value="">— Select —</option>
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expectation" required>
              <Select value={type} onChange={(e) => setType(e.target.value as ExpectationType)}>
                <option value="amount">Amount</option>
                <option value="range">Range</option>
                <option value="direction">Direction</option>
              </Select>
            </Field>
            {type === 'amount' && (
              <Field label="Expected amount" required>
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            )}
            {type === 'range' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Low" required>
                  <Input inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
                </Field>
                <Field label="High" required>
                  <Input inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
                </Field>
              </div>
            )}
            {type === 'direction' && (
              <Field label="Direction" required>
                <Select value={direction} onChange={(e) => setDirection(e.target.value as ExpectationDirection)}>
                  <option value="">— Select —</option>
                  <option value="increase">Increase</option>
                  <option value="decrease">Decrease</option>
                  <option value="stable">Stable</option>
                </Select>
              </Field>
            )}
            <Field label="Basis" required>
              <Select value={basis} onChange={(e) => setBasis(e.target.value as ExpectationBasis)}>
                <option value="">— Select —</option>
                {EXPECTATION_BASES.map((b) => (
                  <option key={b} value={b}>
                    {EXPECTATION_BASIS_LABEL[b]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tolerance %" hint="Only used to suggest investigation.">
              <Input inputMode="decimal" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
            </Field>
            <Field label="Basis note">
              <Input value={basisNote} onChange={(e) => setBasisNote(e.target.value)} />
            </Field>
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !metric || !basis || !shapeOk}>
            Record expectation
          </Button>
        </Card>
      )}
    </div>
  );
}

function ExpectationCard({
  engagementId,
  expectation: e,
  editable,
  onChanged,
}: {
  engagementId: string;
  expectation: PlanningExpectationRecord;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [requires, setRequires] = useState<boolean | null>(e.requiresInvestigation ?? e.suggestedInvestigation);
  const [conclusion, setConclusion] = useState<ExpectationConclusion | ''>(e.conclusion ?? '');
  const save = useMutation({
    mutationFn: () =>
      apiFetch<PlanningExpectationRecord>(`/engagements/${engagementId}/statutory-audit/planning-expectations/${e.id}`, {
        method: 'POST',
        body: { requiresInvestigation: requires ?? undefined, conclusion: conclusion || undefined, version: e.version },
      }),
    onSuccess: (r) => {
      toast(r.signalCode && !e.signalCode ? `Saved — ${r.signalCode} raised.` : 'Expectation saved.');
      onChanged();
    },
    onError: (err) => toast(errMsg(err, 'Could not save.')),
  });
  const expected =
    e.expectationType === 'amount'
      ? fmt(e.expectedAmount)
      : e.expectationType === 'range'
        ? `${fmt(e.expectedLow)} – ${fmt(e.expectedHigh)}`
        : e.expectedDirection;
  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-ink">{e.metricLabel}</div>
          <p className="text-xs text-ink-faint">
            Expected {expected} ({EXPECTATION_BASIS_LABEL[e.basis]}
            {e.basisNote ? `: ${e.basisNote}` : ''}) · Actual {fmt(e.actual)} · Variance {fmt(e.variance)}
          </p>
        </div>
        <div className="flex gap-1.5">
          {e.suggestedInvestigation && <Badge tone="warn">Investigation suggested</Badge>}
          {e.conclusion && <Badge tone="info">{EXPECTATION_CONCLUSION_LABEL[e.conclusion]}</Badge>}
          {e.signalCode && <Badge>{e.signalCode}</Badge>}
        </div>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-raised p-2 text-xs text-ink">
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={!!requires} onChange={(ev) => setRequires(ev.target.checked)} />
            Requires investigation
          </label>
          {EXPECTATION_CONCLUSIONS.map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5">
              <input type="radio" name={`exp-${e.id}`} checked={conclusion === k} onChange={() => setConclusion(k)} />
              {EXPECTATION_CONCLUSION_LABEL[k]}
            </label>
          ))}
          <Button variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── 03.2.10 Conclusion + BA-01 ──────────────────────────────────────────────

function ConclusionSection({
  base,
  summary: s,
  editable,
  onChanged,
}: {
  base: string;
  summary: BusinessUnderstandingSummary;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [text, setText] = useState(s.record.conclusionSummary ?? '');
  const draft = useMutation({
    mutationFn: () => apiFetch<{ draft: string }>(`${base}/business-understanding/conclusion-draft`, { method: 'POST', body: {} }),
    onSuccess: (d) => {
      setText(d.draft);
      toast('Conclusion drafted from the structured record — review and edit before saving.');
    },
    onError: (e) => toast(errMsg(e, 'Could not draft the conclusion.')),
  });
  const save = useMutation({
    mutationFn: (ba01?: 'yes_complete' | 'no_further_work') =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/business-understanding`, {
        method: 'POST',
        body: { conclusionSummary: text, ba01, version: s.record.version },
      }),
    onSuccess: (_r, ba01) => {
      toast(ba01 === 'yes_complete' ? '03.2 completed.' : ba01 ? 'Recorded — further work required.' : 'Conclusion saved.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save.')),
  });

  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-ink">Understanding & analytics conclusion</div>
          {editable && (
            <Button variant="ghost" onClick={() => draft.mutate()} disabled={draft.isPending}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              Draft from structured data
            </Button>
          )}
        </div>
        <Textarea rows={12} disabled={!editable} value={text} onChange={(e) => setText(e.target.value)} />
      </Card>
      <CompletionChecklist checks={s.completion} />
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">BA-01</div>
        <p className="text-sm text-ink-muted">
          Does the documented understanding and preliminary analytical review appropriately identify
          the significant business, financial and operating matters that should be considered in
          further audit planning?
        </p>
        {s.record.ba01 && (
          <Badge tone={s.record.ba01 === 'yes_complete' ? 'success' : 'warn'}>
            {s.record.ba01 === 'yes_complete' ? 'Yes — Complete' : 'No — Further work required'}
          </Badge>
        )}
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
              Save conclusion
            </Button>
            <Button variant="ghost" onClick={() => save.mutate('no_further_work')} disabled={save.isPending}>
              No — further work required
            </Button>
            <Button onClick={() => save.mutate('yes_complete')} disabled={save.isPending || s.record.status === 'complete'}>
              Yes — Complete 03.2
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
