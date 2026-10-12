'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ANALYTICS_RULE_KIND_LABEL,
  ANALYTICS_RULE_KINDS,
  ATTENTION_PARAMETER_TYPE_LABEL,
  ATTENTION_PARAMETER_TYPES,
  DATASET_STATUSES,
  FINANCE_COST_BASES,
  METRIC_SOURCE_TYPE_LABEL,
  METRIC_SOURCE_TYPES,
  METRIC_VALUE_TYPE_LABEL,
  METRIC_VALUE_TYPES,
  PLANNING_ATTENTION_LABEL,
  PLANNING_ATTENTIONS,
  type AnalyticsLibrary,
  type AnalyticsLibraryAudit,
  type AnalyticsLibraryVersioning,
  type AnalyticsMetricRecord,
  type AnalyticsProfileRecord,
  type AnalyticsRuleDefinition,
  type AnalyticsRuleKind,
  type AnalyticsRuleRecord,
  type AttentionParameterType,
  type CreateAnalyticsMetricVersionInput,
  type CreateAnalyticsProfileVersionInput,
  type CreateAnalyticsRuleVersionInput,
  type DatasetStatus,
  type FinanceCostBasis,
  type MetricSourceType,
  type MetricValueType,
  type PlanningAttention,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';

const LIBRARY_KEY = ['planning-analytics-library'];
const API = '/planning-analytics-library';

export const splitList = (s: string): string[] => [
  ...new Set(
    s
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];
export const splitLines = (s: string): string[] => [
  ...new Set(
    s
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];
export const numOrNull = (s: string): number | null => (s.trim() === '' ? null : Number(s));
/** Mirrors the API's neutral-wording check (§15) so the admin sees it before saving. */
const NON_NEUTRAL = /\bmaterial(ity)?\b|misstat|significant risk|audit risk|\brmm\b/i;

/** Group versions (latest first, as the API lists them) by item key. */
export function groupBy<T>(rows: T[] | undefined, keyOf: (r: T) => string): T[][] {
  const m = new Map<string, T[]>();
  for (const r of rows ?? []) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]);
  return [...m.values()];
}

type Panel = 'rules' | 'profiles' | 'metrics';

/**
 * Analytics Methodology Library (DHVAJ 03.2 §12, §15, §17, §23): the canonical
 * metrics, industry analytics profiles and analytics rules 03.2 runs on.
 * Configuration, not code — every change is a new version from a date; a file
 * runs on the versions in force on its period end and an Investigation Card
 * keeps the rule version it was raised under. Methodology only: this screen
 * holds no client data and no conclusion authority.
 */
export function AnalyticsMethodologySection(): JSX.Element {
  const lib = useQuery({ queryKey: LIBRARY_KEY, queryFn: () => apiFetch<AnalyticsLibrary>(API) });
  const [panel, setPanel] = useState<Panel>('rules');
  const data = lib.data;

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h3 className="text-sm font-semibold text-ink">Analytics Methodology Library</h3>
        <p className="text-xs text-ink-muted">
          The preliminary analytics 03.2 calculates: canonical metrics, industry profiles (which add
          sector analytics and exclude ones that are not meaningful) and analytics rules with their
          attention parameters. Attention parameters only surface matters to investigate — they are
          not materiality and never a conclusion. To change anything, add a version from the period
          end it applies to.
        </p>
      </div>
      <div className="flex gap-1 border-b border-line">
        {(
          [
            ['rules', `Rules${data ? ` (${groupBy(data.rules, (r) => r.ruleCode).length})` : ''}`],
            [
              'profiles',
              `Industry profiles${data ? ` (${groupBy(data.profiles, (p) => p.profileKey).length})` : ''}`,
            ],
            [
              'metrics',
              `Canonical metrics${data ? ` (${groupBy(data.metrics, (m) => m.metricKey).length})` : ''}`,
            ],
          ] as [Panel, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            className={cn(
              'border-b-2 px-3 py-1.5 text-xs font-medium transition',
              panel === id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {lib.isLoading ? (
        <Spinner label="Loading the library…" />
      ) : lib.isError || !data ? (
        <p className="text-sm text-danger-600">Could not load the Analytics Methodology Library.</p>
      ) : panel === 'rules' ? (
        <RulesPanel lib={data} />
      ) : panel === 'profiles' ? (
        <ProfilesPanel lib={data} />
      ) : (
        <MetricsPanel lib={data} />
      )}
    </div>
  );
}

// ── shared pieces ────────────────────────────────────────────────────────────

export function VersionHistory({
  versions,
  periodLabel = 'Applies to periods ending',
}: {
  versions: (AnalyticsLibraryVersioning & AnalyticsLibraryAudit)[];
  periodLabel?: string;
}): JSX.Element {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
        <tr>
          <th>Version</th>
          <th>{periodLabel}</th>
          <th>Methodology</th>
          <th>Reason</th>
          <th>By</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line align-top">
        {versions.map((v) => (
          <tr key={v.id}>
            <td className="py-1">
              v{v.version}
              {!v.active && ' (retired)'}
            </td>
            <td>
              {formatDate(v.effectiveFrom)}
              {v.effectiveTo ? ` – ${formatDate(v.effectiveTo)}` : ' onwards'}
            </td>
            <td className="font-mono text-xs">{v.methodologyVersion}</td>
            <td className="text-xs text-ink-muted">{v.changeNote ?? '—'}</td>
            <td className="text-xs text-ink-muted">
              {v.createdByName ?? 'Seed'} · {formatDate(v.createdAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LibraryRow({
  code,
  title,
  badges,
  latest,
  count,
  children,
}: {
  code: string;
  title: string;
  badges?: React.ReactNode;
  latest: AnalyticsLibraryVersioning;
  count: number;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full flex-wrap items-center gap-2.5 text-left"
      >
        <ExpandToggle open={open} />
        <span className="font-mono text-xs text-ink">{code}</span>
        <span className="text-sm text-ink">{title}</span>
        {badges}
        {!latest.active && <Badge tone="warn">Retired</Badge>}
        <span className="ml-auto text-xs text-ink-faint">
          v{latest.version} · {count} version{count === 1 ? '' : 's'}
        </span>
      </button>
      {open && <div className="mt-3 space-y-4 pl-7">{children}</div>}
    </li>
  );
}

/** Effective-from / retire / methodology / reason fields every form ends with. */
export function useVersionFields(
  base: AnalyticsLibraryVersioning | null,
  dateLabel = 'Applies to periods ending on/after',
  methodologyHint = 'e.g. dhvaj-analytics-2027.1',
) {
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [active, setActive] = useState(base?.active ?? true);
  const [methodologyVersion, setMethodologyVersion] = useState(base?.methodologyVersion ?? '');
  const [changeNote, setChangeNote] = useState('');
  const dateError =
    base && effectiveFrom && effectiveFrom < base.effectiveFrom
      ? `Must be on or after ${formatDate(base.effectiveFrom)}.`
      : null;
  const errors = [dateError, changeNote.trim().length < 3 && 'Record why this version exists.'];
  const body = {
    ...(effectiveFrom ? { effectiveFrom } : {}),
    active,
    ...(methodologyVersion.trim() ? { methodologyVersion: methodologyVersion.trim() } : {}),
    changeNote: changeNote.trim(),
  };
  const fields = (retireLabel: string | null) => (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={dateLabel} hint={dateError ?? undefined}>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </Field>
        <Field label="Methodology version" hint={methodologyHint}>
          <Input
            value={methodologyVersion}
            onChange={(e) => setMethodologyVersion(e.target.value)}
          />
        </Field>
      </div>
      {base && retireLabel && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} />
          {retireLabel}
        </label>
      )}
      <Field label="Reason for this version" required hint="Kept in the audit trail.">
        <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
      </Field>
    </>
  );
  return { errors, body, fields, reset: () => setChangeNote('') };
}

function useSave<B, R extends { version: number }>(
  path: string,
  label: (r: R) => string,
  onDone: () => void,
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: B) => apiFetch<R>(`${API}/${path}`, { method: 'POST', body }),
    onSuccess: (r) => {
      toast(`${label(r)} v${r.version} saved.`);
      void qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      onDone();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not save the library version.'),
  });
}

export function CheckList<T extends string>({
  legend,
  options,
  value,
  onChange,
  labelOf,
}: {
  legend: string;
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  labelOf: (v: T) => string;
}): JSX.Element {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(o)}
              onChange={() =>
                onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])
              }
            />
            {labelOf(o)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ── rules ────────────────────────────────────────────────────────────────────

function RulesPanel({ lib }: { lib: AnalyticsLibrary }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const groups = useMemo(() => groupBy(lib.rules, (r) => r.ruleCode), [lib.rules]);
  const nextCode = useMemo(() => {
    const used = new Set(lib.rules.map((r) => r.ruleCode));
    for (let n = 1; n < 1000; n += 1) {
      const code = `PAR-${String(n).padStart(3, '0')}`;
      if (!used.has(code)) return code;
    }
    return '';
  }, [lib.rules]);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel new rule' : 'New rule'}
        </Button>
      </div>
      {adding && (
        <RuleVersionForm
          lib={lib}
          base={null}
          defaultCode={nextCode}
          onDone={() => setAdding(false)}
        />
      )}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {groups.map((versions) => {
          const r = versions[0]!;
          return (
            <LibraryRow
              key={r.ruleCode}
              code={r.ruleCode}
              title={r.name}
              latest={r}
              count={versions.length}
              badges={
                <>
                  <Badge tone="neutral">{ANALYTICS_RULE_KIND_LABEL[r.kind]}</Badge>
                  {r.appliesTo.length > 0 && <Badge tone="info">{r.appliesTo.join(', ')}</Badge>}
                  {r.suggestedAttention !== 'standard' || r.immediateAt !== null ? (
                    <Badge
                      tone={
                        r.suggestedAttention === 'immediate_partner' || r.immediateAt !== null
                          ? 'danger'
                          : 'warn'
                      }
                    >
                      {r.suggestedAttention === 'immediate_partner' || r.immediateAt !== null
                        ? 'Can suggest IPA'
                        : PLANNING_ATTENTION_LABEL[r.suggestedAttention]}
                    </Badge>
                  ) : null}
                </>
              }
            >
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
                <dt className="text-ink-muted">Rule key</dt>
                <dd className="font-mono text-xs">{r.ruleKey}</dd>
                <dt className="text-ink-muted">Formula</dt>
                <dd>{r.formula}</dd>
                {r.kind !== 'ratio' && (
                  <>
                    <dt className="text-ink-muted">Attention parameter</dt>
                    <dd>
                      {r.parameterType ? ATTENTION_PARAMETER_TYPE_LABEL[r.parameterType] : '—'}{' '}
                      {r.parameterValue}
                      {r.enhancedAt !== null && ` · Enhanced ≥ ${r.enhancedAt}`}
                      {r.immediateAt !== null && ` · Immediate Partner ≥ ${r.immediateAt}`}
                    </dd>
                    <dt className="text-ink-muted">Signal wording</dt>
                    <dd className="text-xs">{r.signalWording}</dd>
                    <dt className="text-ink-muted">Why it may matter</dt>
                    <dd className="text-xs">{r.whyMayMatter}</dd>
                    <dt className="text-ink-muted">Suggested areas</dt>
                    <dd className="text-xs">{r.affectedAreas.join(', ') || '—'}</dd>
                  </>
                )}
                <dt className="text-ink-muted">Profiles</dt>
                <dd className="text-xs">
                  {r.appliesTo.length ? `Only ${r.appliesTo.join(', ')}` : 'Every profile'}
                  {r.excludedFor.length ? ` · not applicable for ${r.excludedFor.join(', ')}` : ''}
                </dd>
                <dt className="text-ink-muted">Minimum data quality</dt>
                <dd className="text-xs">
                  {r.minDataStatus.length
                    ? `Dataset ${r.minDataStatus.join(' / ')}`
                    : 'Any dataset status'}
                  {' · '}
                  {r.minSourceTypes.length
                    ? r.minSourceTypes.map((x) => METRIC_SOURCE_TYPE_LABEL[x]).join(' / ')
                    : 'any source'}
                </dd>
              </dl>
              <VersionHistory versions={versions} />
              <RuleVersionForm
                lib={lib}
                base={r}
                defaultCode={r.ruleCode}
                onDone={() => undefined}
              />
            </LibraryRow>
          );
        })}
      </ul>
    </div>
  );
}

function RuleVersionForm({
  lib,
  base,
  defaultCode,
  onDone,
}: {
  lib: AnalyticsLibrary;
  base: AnalyticsRuleRecord | null;
  defaultCode: string;
  onDone: () => void;
}): JSX.Element {
  const [ruleCode, setRuleCode] = useState(defaultCode);
  const [ruleKey, setRuleKey] = useState(base?.ruleKey ?? '');
  const [kind, setKind] = useState<AnalyticsRuleKind>(base?.kind ?? 'movement');
  const [name, setName] = useState(base?.name ?? '');
  const [formula, setFormula] = useState(base?.formula ?? '');
  const [definition, setDefinition] = useState(
    JSON.stringify(base?.definition ?? { kind: 'movement', metric: '' }, null, 2),
  );
  const [parameterType, setParameterType] = useState<AttentionParameterType | ''>(
    base?.parameterType ?? 'percent',
  );
  const [parameterValue, setParameterValue] = useState(base?.parameterValue?.toString() ?? '');
  const [enhancedAt, setEnhancedAt] = useState(base?.enhancedAt?.toString() ?? '');
  const [immediateAt, setImmediateAt] = useState(base?.immediateAt?.toString() ?? '');
  const [attention, setAttention] = useState<PlanningAttention>(
    base?.suggestedAttention ?? 'standard',
  );
  const [wording, setWording] = useState(base?.signalWording ?? '');
  const [why, setWhy] = useState(base?.whyMayMatter ?? '');
  const [areas, setAreas] = useState((base?.affectedAreas ?? []).join('\n'));
  const [appliesTo, setAppliesTo] = useState((base?.appliesTo ?? []).join(', '));
  const [excludedFor, setExcludedFor] = useState((base?.excludedFor ?? []).join(', '));
  const [required, setRequired] = useState((base?.requiredMetrics ?? []).join(', '));
  const [minStatus, setMinStatus] = useState<DatasetStatus[]>(base?.minDataStatus ?? []);
  const [minSources, setMinSources] = useState<MetricSourceType[]>(base?.minSourceTypes ?? []);
  const v = useVersionFields(base);

  const profileKeys = useMemo(() => new Set(lib.profiles.map((p) => p.profileKey)), [lib.profiles]);
  const metricKeys = useMemo(() => new Set(lib.metrics.map((m) => m.metricKey)), [lib.metrics]);
  let parsed: AnalyticsRuleDefinition | null = null;
  try {
    parsed = JSON.parse(definition) as AnalyticsRuleDefinition;
  } catch {
    parsed = null;
  }
  const isRatio = kind === 'ratio';
  const badProfiles = [...splitList(appliesTo), ...splitList(excludedFor)].filter(
    (p) => !profileKeys.has(p),
  );
  const badMetrics = splitList(required).filter((k) => !metricKeys.has(k));
  const errors = [
    !/^PAR-[0-9]{3}$/.test(ruleCode) && 'The rule code must look like PAR-058.',
    !base && !/^[a-z0-9_]{2,80}$/.test(ruleKey) && 'The rule key must be lower_snake_case.',
    !name.trim() && 'Name the rule.',
    !formula.trim() && 'Write the transparent formula.',
    !parsed && 'The definition is not valid JSON.',
    parsed && parsed.kind !== kind && `The definition's kind must be "${kind}".`,
    badProfiles.length > 0 && `Unknown profile: ${badProfiles.join(', ')}.`,
    badMetrics.length > 0 && `Unknown metric: ${badMetrics.join(', ')}.`,
    !isRatio && !parameterType && 'Choose the attention parameter type.',
    !isRatio && numOrNull(parameterValue) === null && 'Set the attention parameter.',
    !isRatio && !wording.trim() && 'Write the neutral signal wording.',
    !isRatio && !why.trim() && 'Say why it may matter.',
    !isRatio &&
      NON_NEUTRAL.test(`${wording} ${why}`) &&
      'Wording must be neutral — no materiality, misstatement or risk conclusions.',
    ...v.errors,
  ].filter(Boolean) as string[];

  const save = useSave<CreateAnalyticsRuleVersionInput, AnalyticsRuleRecord>(
    'rules',
    (r) => r.ruleCode,
    () => {
      v.reset();
      onDone();
    },
  );
  const submit = () =>
    save.mutate({
      ruleCode,
      ...(base ? {} : { ruleKey }),
      name: name.trim(),
      kind,
      formula: formula.trim(),
      definition: parsed!,
      appliesTo: splitList(appliesTo),
      excludedFor: splitList(excludedFor),
      requiredMetrics: splitList(required),
      minDataStatus: minStatus,
      minSourceTypes: minSources,
      ...(isRatio
        ? {}
        : {
            parameterType: parameterType || null,
            parameterValue: numOrNull(parameterValue),
            enhancedAt: numOrNull(enhancedAt),
            immediateAt: numOrNull(immediateAt),
            suggestedAttention: attention,
            signalWording: wording.trim(),
            whyMayMatter: why.trim(),
            affectedAreas: splitLines(areas),
          }),
      ...v.body,
    });

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <p className="text-sm font-medium text-ink">
        {base ? `Add a version of ${base.ruleCode}` : 'New analytics rule'}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Rule code" required>
          <Input value={ruleCode} disabled={!!base} onChange={(e) => setRuleCode(e.target.value)} />
        </Field>
        <Field label="Rule key" required hint="Fixed once created — cards and 03.5 tags use it.">
          <Input value={ruleKey} disabled={!!base} onChange={(e) => setRuleKey(e.target.value)} />
        </Field>
        <Field label="Type" hint={base ? 'Fixed — add a new rule for another type.' : undefined}>
          <Select
            value={kind}
            disabled={!!base}
            onChange={(e) => setKind(e.target.value as AnalyticsRuleKind)}
          >
            {ANALYTICS_RULE_KINDS.map((k) => (
              <option key={k} value={k}>
                {ANALYTICS_RULE_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Formula (shown to the auditor)" required>
          <Input value={formula} onChange={(e) => setFormula(e.target.value)} />
        </Field>
      </div>
      <Field
        label="Calculation definition"
        required
        hint='JSON, e.g. {"kind":"movement","metric":"revenue"} — operands are {"metric"}, {"debt":true}, {"base":"inventory_cost"} or {"sum":[…],"less":[…]}. Inventory / payable days never use revenue.'
      >
        <Textarea
          rows={4}
          className="font-mono text-xs"
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
        />
      </Field>
      {!isRatio && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Attention parameter type" required>
              <Select
                value={parameterType}
                onChange={(e) => setParameterType(e.target.value as AttentionParameterType)}
              >
                {ATTENTION_PARAMETER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ATTENTION_PARAMETER_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Attention parameter" required>
              <Input
                type="number"
                value={parameterValue}
                onChange={(e) => setParameterValue(e.target.value)}
              />
            </Field>
            <Field label="Enhanced at ≥">
              <Input
                type="number"
                value={enhancedAt}
                onChange={(e) => setEnhancedAt(e.target.value)}
              />
            </Field>
            <Field label="Immediate Partner at ≥">
              <Input
                type="number"
                value={immediateAt}
                onChange={(e) => setImmediateAt(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Base suggested attention">
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
          <Field
            label="Neutral signal wording"
            required
            hint="Factual, with {{placeholders}} — never a conclusion."
          >
            <Textarea rows={2} value={wording} onChange={(e) => setWording(e.target.value)} />
          </Field>
          <Field label="Why it may matter" required>
            <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          </Field>
          <Field
            label="Suggested affected areas"
            hint="One per line — editable on the card, never a final decision."
          >
            <Textarea rows={2} value={areas} onChange={(e) => setAreas(e.target.value)} />
          </Field>
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Only for profiles" hint="Comma-separated; empty = every profile.">
          <Input value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} />
        </Field>
        <Field label="Not applicable for profiles">
          <Input value={excludedFor} onChange={(e) => setExcludedFor(e.target.value)} />
        </Field>
        <Field label="Required metrics">
          <Input value={required} onChange={(e) => setRequired(e.target.value)} />
        </Field>
      </div>
      <CheckList
        legend="Minimum data quality — dataset status (none = any)"
        options={DATASET_STATUSES}
        value={minStatus}
        onChange={setMinStatus}
        labelOf={(s) => s.replace(/_/g, ' ')}
      />
      <CheckList
        legend="Minimum data quality — figure sources (none = any)"
        options={METRIC_SOURCE_TYPES}
        value={minSources}
        onChange={setMinSources}
        labelOf={(s) => METRIC_SOURCE_TYPE_LABEL[s]}
      />
      {v.fields('Disable this rule from the date above (cards already raised stay on their files)')}
      <Button
        size="sm"
        disabled={errors.length > 0 || save.isPending}
        title={errors[0]}
        onClick={submit}
      >
        {base ? 'Add version' : 'Create rule'}
      </Button>
    </div>
  );
}

// ── profiles ─────────────────────────────────────────────────────────────────

function ProfilesPanel({ lib }: { lib: AnalyticsLibrary }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const groups = useMemo(() => groupBy(lib.profiles, (p) => p.profileKey), [lib.profiles]);
  const sectorRules = (key: string) => {
    const latest = groupBy(lib.rules, (r) => r.ruleCode).map((v) => v[0]!);
    return {
      added: latest.filter((r) => r.active && r.appliesTo.includes(key)).length,
      excluded: latest.filter((r) => r.active && r.excludedFor.includes(key)).length,
    };
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel new profile' : 'New profile'}
        </Button>
      </div>
      {adding && <ProfileVersionForm lib={lib} base={null} onDone={() => setAdding(false)} />}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {groups.map((versions) => {
          const p = versions[0]!;
          const n = sectorRules(p.profileKey);
          return (
            <LibraryRow
              key={p.profileKey}
              code={p.profileKey}
              title={p.label}
              latest={p}
              count={versions.length}
              badges={
                <>
                  {n.added > 0 && <Badge tone="info">+{n.added} sector rules</Badge>}
                  {n.excluded > 0 && <Badge tone="neutral">{n.excluded} not applicable</Badge>}
                </>
              }
            >
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
                <dt className="text-ink-muted">Description</dt>
                <dd className="text-xs">{p.description || '—'}</dd>
                <dt className="text-ink-muted">Debt definition</dt>
                <dd className="text-xs">{p.debtMetrics.join(' + ')}</dd>
                <dt className="text-ink-muted">Finance cost basis</dt>
                <dd className="text-xs">{p.financeCostBasis} debt</dd>
                <dt className="text-ink-muted">Day ratios</dt>
                <dd className="text-xs">
                  {p.averageBalances ? 'Average balances where available' : 'Closing balances'}
                </dd>
                <dt className="text-ink-muted">Inventory cost base</dt>
                <dd className="text-xs">
                  {p.inventoryCostBases.join(' → ')}
                  {` · revenue-vs-inventory fallback: ${p.inventoryTrendFallback ?? 'none (not evaluated)'}`}
                </dd>
                <dt className="text-ink-muted">Payable cost base</dt>
                <dd className="text-xs">{p.payableCostBases.join(' → ')}</dd>
                <dt className="text-ink-muted">Sub-industries</dt>
                <dd className="text-xs">{p.subIndustries.join(' · ') || '—'}</dd>
                <dt className="text-ink-muted">Considerations</dt>
                <dd className="text-xs">
                  <ul className="list-disc pl-4">
                    {p.considerations.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </dd>
              </dl>
              <VersionHistory versions={versions} />
              <ProfileVersionForm lib={lib} base={p} onDone={() => undefined} />
            </LibraryRow>
          );
        })}
      </ul>
    </div>
  );
}

function ProfileVersionForm({
  lib,
  base,
  onDone,
}: {
  lib: AnalyticsLibrary;
  base: AnalyticsProfileRecord | null;
  onDone: () => void;
}): JSX.Element {
  const [profileKey, setProfileKey] = useState(base?.profileKey ?? '');
  const [label, setLabel] = useState(base?.label ?? '');
  const [description, setDescription] = useState(base?.description ?? '');
  const [subIndustries, setSubIndustries] = useState((base?.subIndustries ?? []).join('\n'));
  const [considerations, setConsiderations] = useState((base?.considerations ?? []).join('\n'));
  const [averageBalances, setAverageBalances] = useState(base?.averageBalances ?? false);
  const [debt, setDebt] = useState((base?.debtMetrics ?? ['total_borrowings']).join(', '));
  const [financeCostBasis, setFinanceCostBasis] = useState<FinanceCostBasis>(
    base?.financeCostBasis ?? 'closing',
  );
  const [invBases, setInvBases] = useState(
    (base?.inventoryCostBases ?? ['cost_of_sales', 'purchases']).join(', '),
  );
  const [payBases, setPayBases] = useState(
    (base?.payableCostBases ?? ['purchases', 'cost_of_sales']).join(', '),
  );
  const [fallback, setFallback] = useState(base ? (base.inventoryTrendFallback ?? '') : 'revenue');
  const v = useVersionFields(base);

  const amounts = useMemo(
    () => new Set(lib.metrics.filter((m) => m.valueType === 'amount').map((m) => m.metricKey)),
    [lib.metrics],
  );
  const lists = [
    ...splitList(debt),
    ...splitList(invBases),
    ...splitList(payBases),
    ...(fallback ? [fallback] : []),
  ];
  const unknown = lists.filter((k) => !amounts.has(k));
  const isGeneric = (base?.profileKey ?? profileKey) === 'generic';
  const errors = [
    !base && !/^[a-z0-9_]{2,40}$/.test(profileKey) && 'The profile key must be lower_snake_case.',
    !base &&
      lib.profiles.some((p) => p.profileKey === profileKey) &&
      'That profile key exists — add a version.',
    !label.trim() && 'Name the profile.',
    !splitList(debt).length && 'The debt definition needs at least one metric.',
    (!splitList(invBases).length || !splitList(payBases).length) &&
      'Inventory and payable days each need a cost base.',
    [...splitList(invBases), ...splitList(payBases)].includes('revenue') &&
      'Inventory / payable days must use a cost base, never Revenue.',
    unknown.length > 0 && `Not an amount metric in the library: ${unknown.join(', ')}.`,
    ...v.errors,
  ].filter(Boolean) as string[];

  const save = useSave<CreateAnalyticsProfileVersionInput, AnalyticsProfileRecord>(
    'profiles',
    (p) => p.profileKey,
    () => {
      v.reset();
      onDone();
    },
  );
  const submit = () =>
    save.mutate({
      profileKey: base?.profileKey ?? profileKey,
      label: label.trim(),
      description: description.trim(),
      subIndustries: splitLines(subIndustries),
      considerations: splitLines(considerations),
      averageBalances,
      debtMetrics: splitList(debt),
      financeCostBasis,
      inventoryCostBases: splitList(invBases),
      payableCostBases: splitList(payBases),
      inventoryTrendFallback: fallback.trim() || null,
      ...v.body,
    });

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <p className="text-sm font-medium text-ink">
        {base ? `Add a version of ${base.profileKey}` : 'New industry profile'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Profile key" required hint="Fixed once created — files store it.">
          <Input
            value={base?.profileKey ?? profileKey}
            disabled={!!base}
            onChange={(e) => setProfileKey(e.target.value)}
          />
        </Field>
        <Field label="Label" required>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
      </div>
      <Field label="Description">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sub-industries" hint="One per line — offered in 03.2.3.">
          <Textarea
            rows={4}
            value={subIndustries}
            onChange={(e) => setSubIndustries(e.target.value)}
          />
        </Field>
        <Field
          label="Industry considerations"
          hint="One per line — suggested to the Manager in 03.2.3."
        >
          <Textarea
            rows={4}
            value={considerations}
            onChange={(e) => setConsiderations(e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Debt definition" required hint="Metrics summed as debt (comma-separated).">
          <Input value={debt} onChange={(e) => setDebt(e.target.value)} />
        </Field>
        <Field label="Finance cost related to">
          <Select
            value={financeCostBasis}
            onChange={(e) => setFinanceCostBasis(e.target.value as FinanceCostBasis)}
          >
            {FINANCE_COST_BASES.map((b) => (
              <option key={b} value={b}>
                {b === 'average' ? 'Average debt' : 'Closing debt'}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Revenue-vs-inventory fallback"
          hint="Used only when no cost base has figures; blank = not evaluated."
        >
          <Input value={fallback} onChange={(e) => setFallback(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Inventory-days cost bases"
          required
          hint="In order of preference; never revenue."
        >
          <Input value={invBases} onChange={(e) => setInvBases(e.target.value)} />
        </Field>
        <Field
          label="Payable-days cost bases"
          required
          hint="In order of preference; never revenue."
        >
          <Input value={payBases} onChange={(e) => setPayBases(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={averageBalances}
          onChange={(e) => setAverageBalances(e.target.checked)}
        />
        Day ratios on average balances (opening = prior-year closing) where available
      </label>
      {v.fields(
        isGeneric
          ? null
          : 'Retire this profile from the date above (its files fall back to Generic)',
      )}
      <Button
        size="sm"
        disabled={errors.length > 0 || save.isPending}
        title={errors[0]}
        onClick={submit}
      >
        {base ? 'Add version' : 'Create profile'}
      </Button>
    </div>
  );
}

// ── metrics ──────────────────────────────────────────────────────────────────

function MetricsPanel({ lib }: { lib: AnalyticsLibrary }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const groups = useMemo(() => groupBy(lib.metrics, (m) => m.metricKey), [lib.metrics]);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel new metric' : 'New metric'}
        </Button>
      </div>
      {adding && <MetricVersionForm lib={lib} base={null} onDone={() => setAdding(false)} />}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {groups.map((versions) => {
          const m = versions[0]!;
          return (
            <LibraryRow
              key={m.metricKey}
              code={m.metricKey}
              title={m.label}
              latest={m}
              count={versions.length}
              badges={
                <>
                  {m.core && <Badge tone="info">Core</Badge>}
                  {m.valueType !== 'amount' && (
                    <Badge tone="neutral">{METRIC_VALUE_TYPE_LABEL[m.valueType]}</Badge>
                  )}
                  {m.appliesTo.length > 0 && <Badge tone="neutral">{m.appliesTo.join(', ')}</Badge>}
                </>
              }
            >
              <p className="text-xs text-ink-muted">{m.note || '—'}</p>
              <VersionHistory versions={versions} />
              <MetricVersionForm lib={lib} base={m} onDone={() => undefined} />
            </LibraryRow>
          );
        })}
      </ul>
    </div>
  );
}

function MetricVersionForm({
  lib,
  base,
  onDone,
}: {
  lib: AnalyticsLibrary;
  base: AnalyticsMetricRecord | null;
  onDone: () => void;
}): JSX.Element {
  const [metricKey, setMetricKey] = useState(base?.metricKey ?? '');
  const [label, setLabel] = useState(base?.label ?? '');
  const [valueType, setValueType] = useState<MetricValueType>(base?.valueType ?? 'amount');
  const [core, setCore] = useState(base?.core ?? false);
  const [note, setNote] = useState(base?.note ?? '');
  const [appliesTo, setAppliesTo] = useState((base?.appliesTo ?? []).join(', '));
  const [sortOrder, setSortOrder] = useState(String(base?.sortOrder ?? 1000));
  const v = useVersionFields(base);
  const profileKeys = new Set(lib.profiles.map((p) => p.profileKey));
  const badProfiles = splitList(appliesTo).filter((p) => !profileKeys.has(p));
  const errors = [
    !base &&
      (!/^[a-z][a-z0-9_]{1,59}$/.test(metricKey) || metricKey.startsWith('custom_')) &&
      'The metric key must be lower_snake_case (and not custom_…).',
    !base &&
      lib.metrics.some((m) => m.metricKey === metricKey) &&
      'That metric exists — add a version.',
    !label.trim() && 'Name the metric.',
    badProfiles.length > 0 && `Unknown profile: ${badProfiles.join(', ')}.`,
    !Number.isInteger(Number(sortOrder)) && 'The sort order must be a whole number.',
    ...v.errors,
  ].filter(Boolean) as string[];

  const save = useSave<CreateAnalyticsMetricVersionInput, AnalyticsMetricRecord>(
    'metrics',
    (m) => m.metricKey,
    () => {
      v.reset();
      onDone();
    },
  );
  const submit = () =>
    save.mutate({
      metricKey: base?.metricKey ?? metricKey,
      label: label.trim(),
      valueType,
      core,
      note: note.trim(),
      appliesTo: splitList(appliesTo),
      sortOrder: Number(sortOrder),
      ...v.body,
    });

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <p className="text-sm font-medium text-ink">
        {base ? `Add a version of ${base.metricKey}` : 'New canonical metric'}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Metric id" required hint="Fixed — a future TB import fills the same id.">
          <Input
            value={base?.metricKey ?? metricKey}
            disabled={!!base}
            onChange={(e) => setMetricKey(e.target.value)}
          />
        </Field>
        <Field label="Label" required>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field
          label="Measures"
          hint={
            base
              ? 'Fixed — only amounts are converted between units.'
              : 'Only amounts are converted between units.'
          }
        >
          <Select
            value={valueType}
            disabled={!!base}
            onChange={(e) => setValueType(e.target.value as MetricValueType)}
          >
            {METRIC_VALUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {METRIC_VALUE_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Note (shown in the dataset grid)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Only for profiles" hint="Comma-separated; empty = every profile.">
          <Input value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} />
        </Field>
        <Field label="Sort order">
          <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={core} onChange={(e) => setCore(e.target.checked)} />
        Core — expected for every entity it applies to
      </label>
      {v.fields('Retire this metric from the date above (recorded figures stay on their files)')}
      <Button
        size="sm"
        disabled={errors.length > 0 || save.isPending}
        title={errors[0]}
        onClick={submit}
      >
        {base ? 'Add version' : 'Create metric'}
      </Button>
    </div>
  );
}
