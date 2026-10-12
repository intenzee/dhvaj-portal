'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  CANDIDATE_BENCHMARKS,
  MATERIALITY_ATTENTION_CRITERIA,
  MATERIALITY_ATTENTION_CRITERION_LABEL,
  MATERIALITY_BENCHMARK_LABEL,
  MATERIALITY_CIRCUMSTANCE_INITIAL_AUDIT,
  MATERIALITY_GUIDANCE_DISCLOSURE,
  MATERIALITY_OVERRIDE_ATTENTION_LABEL,
  MATERIALITY_OVERRIDE_ATTENTIONS,
  MATERIALITY_RULE_KIND_LABEL,
  MATERIALITY_RULE_KINDS,
  SPECIAL_ENTITY_LABEL,
  SPECIAL_ENTITY_TYPES,
  isMetricBenchmark,
  materialityRuleApplicability,
  type CreateMaterialityRuleVersionInput,
  type MaterialityAttentionCriterion,
  type MaterialityMethodologyLibrary,
  type MaterialityMethodologyRuleRecord,
  type MaterialityOverrideAttention,
  type MaterialityRuleKind,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import {
  CheckList,
  LibraryRow,
  VersionHistory,
  groupBy,
  numOrNull,
  splitLines,
  splitList,
  useVersionFields,
} from './analytics-methodology-section';

const LIBRARY_KEY = ['materiality-methodology-library'];
const API = '/materiality-methodology-library';
const PERIOD_LABEL = 'Applies to audit periods starting on/after';
const CIRCUMSTANCES = [MATERIALITY_CIRCUMSTANCE_INITIAL_AUDIT, ...SPECIAL_ENTITY_TYPES];
const circumstanceLabel = (c: string) =>
  c === MATERIALITY_CIRCUMSTANCE_INITIAL_AUDIT
    ? 'Initial audit'
    : ((SPECIAL_ENTITY_LABEL as Record<string, string>)[c] ?? c);

const rangeText = (r: Pick<MaterialityMethodologyRuleRecord, 'lowPct' | 'highPct'>) =>
  r.lowPct === null
    ? 'No percentage guidance'
    : r.highPct !== null && r.highPct !== r.lowPct
      ? `${r.lowPct}% – ${r.highPct}%`
      : `${r.lowPct}%`;

function guidanceText(r: MaterialityMethodologyRuleRecord): string {
  switch (r.kind) {
    case 'om_benchmark':
      return `${rangeText(r)} of ${r.benchmarkLabel ?? MATERIALITY_BENCHMARK_LABEL[r.benchmarkKey as keyof typeof MATERIALITY_BENCHMARK_LABEL] ?? r.benchmarkKey}`;
    case 'pm':
    case 'ctt':
      return `${rangeText(r)} of overall materiality`;
    case 'attention':
      return `${r.attentionCriterion ? MATERIALITY_ATTENTION_CRITERION_LABEL[r.attentionCriterion] : '—'} ≥ ${r.parameterValue}`;
    case 'rounding':
      return `Round down to ₹${(r.parameterValue ?? 0).toLocaleString('en-IN')}`;
  }
}

/**
 * Materiality Methodology Library (DHVAJ 03.3 §8, §23): the benchmark /
 * percentage guidance, applicability, considerations and override rules 03.3
 * shows as DHVAJ methodology guidance. Configuration, not code — every change
 * is a new version from a date, and a determination keeps the versions it
 * used. The Methodology Admin cannot conclude engagement materiality here.
 */
export function MaterialityMethodologySection(): JSX.Element {
  const lib = useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: () => apiFetch<MaterialityMethodologyLibrary>(API),
  });
  const [adding, setAdding] = useState(false);
  const groups = useMemo(() => groupBy(lib.data?.rules, (r) => r.ruleCode), [lib.data]);
  const nextCode = useMemo(() => {
    const used = new Set((lib.data?.rules ?? []).map((r) => r.ruleCode));
    for (let n = 1; n < 1000; n += 1) {
      const code = `MMR-${String(n).padStart(3, '0')}`;
      if (!used.has(code)) return code;
    }
    return '';
  }, [lib.data]);

  return (
    <div className="space-y-4">
      <div className="max-w-3xl space-y-2">
        <h3 className="text-sm font-semibold text-ink">Materiality Methodology Library</h3>
        <p className="text-xs text-ink-muted">
          The guidance 03.3 offers: possible benchmarks (built-in or a 03.2 canonical metric),
          optional percentage ranges, the considerations shown with them, where each rule applies
          (industry profile / entity circumstance — the most specific rule wins), and the override
          rule. Selecting outside a range is permitted with a rationale and raises Partner
          Attention; an Immediate Partner Attention override rule also raises the §19 override
          trigger. Do not record ranges as approved until DHVAJ formally approves them.
        </p>
        <p className="rounded-lg bg-primary-50 p-2 text-xs text-primary-700">
          {MATERIALITY_GUIDANCE_DISCLOSURE}
        </p>
      </div>
      {lib.isLoading ? (
        <Spinner label="Loading the library…" />
      ) : lib.isError || !lib.data ? (
        <p className="text-sm text-danger-600">
          Could not load the Materiality Methodology Library.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
              {adding ? 'Cancel new rule' : 'New rule'}
            </Button>
          </div>
          {adding && (
            <RuleForm base={null} defaultCode={nextCode} onDone={() => setAdding(false)} />
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
                      <Badge tone="neutral">{MATERIALITY_RULE_KIND_LABEL[r.kind]}</Badge>
                      {(r.industryProfiles.length > 0 || r.circumstances.length > 0) && (
                        <Badge tone="info">{materialityRuleApplicability(r)}</Badge>
                      )}
                      {r.provisional && <Badge tone="warn">Provisional</Badge>}
                      {r.overrideAttention === 'immediate_partner' && (
                        <Badge tone="danger">IPA override</Badge>
                      )}
                    </>
                  }
                >
                  <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
                    <dt className="text-ink-muted">Guidance</dt>
                    <dd>{guidanceText(r)}</dd>
                    <dt className="text-ink-muted">Applies to</dt>
                    <dd className="text-xs">{materialityRuleApplicability(r)}</dd>
                    <dt className="text-ink-muted">Considerations</dt>
                    <dd className="text-xs">
                      {r.considerations.length ? (
                        <ul className="ml-4 list-disc">
                          {r.considerations.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      ) : (
                        '—'
                      )}
                    </dd>
                    <dt className="text-ink-muted">Source / basis</dt>
                    <dd className="text-xs">{r.sourceBasis}</dd>
                    {(r.kind === 'om_benchmark' || r.kind === 'pm' || r.kind === 'ctt') && (
                      <>
                        <dt className="text-ink-muted">Override rule</dt>
                        <dd className="text-xs">
                          Permitted with rationale —{' '}
                          {MATERIALITY_OVERRIDE_ATTENTION_LABEL[r.overrideAttention]}
                        </dd>
                      </>
                    )}
                  </dl>
                  <VersionHistory versions={versions} periodLabel="Applies to periods starting" />
                  <RuleForm base={r} defaultCode={r.ruleCode} onDone={() => undefined} />
                </LibraryRow>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function RuleForm({
  base,
  defaultCode,
  onDone,
}: {
  base: MaterialityMethodologyRuleRecord | null;
  defaultCode: string;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [ruleCode, setRuleCode] = useState(defaultCode);
  const [kind, setKind] = useState<MaterialityRuleKind>(base?.kind ?? 'om_benchmark');
  const [name, setName] = useState(base?.name ?? '');
  const [benchmarkKey, setBenchmarkKey] = useState(base?.benchmarkKey ?? 'pbt');
  const [benchmarkLabel, setBenchmarkLabel] = useState(base?.benchmarkLabel ?? '');
  const [criterion, setCriterion] = useState<MaterialityAttentionCriterion>(
    base?.attentionCriterion ?? 'py_change',
  );
  const [low, setLow] = useState(base?.lowPct?.toString() ?? '');
  const [high, setHigh] = useState(base?.highPct?.toString() ?? '');
  const [param, setParam] = useState(base?.parameterValue?.toString() ?? '');
  const [profiles, setProfiles] = useState((base?.industryProfiles ?? []).join(', '));
  const [circumstances, setCircumstances] = useState<string[]>(base?.circumstances ?? []);
  const [considerations, setConsiderations] = useState((base?.considerations ?? []).join('\n'));
  const [sourceBasis, setSourceBasis] = useState(base?.sourceBasis ?? '');
  const [provisional, setProvisional] = useState(base?.provisional ?? true);
  const [override, setOverride] = useState<MaterialityOverrideAttention>(
    base?.overrideAttention ?? 'partner_attention',
  );
  const v = useVersionFields(base, PERIOD_LABEL, 'e.g. dhvaj-materiality-2027.1');

  const ranged = kind === 'om_benchmark' || kind === 'pm' || kind === 'ctt';
  const metric = kind === 'om_benchmark' && benchmarkKey.startsWith('metric:');
  const errors = [
    ...v.errors,
    !/^MMR-[0-9]{3}$/.test(ruleCode) && 'Rule code must look like MMR-001.',
    !name.trim() && 'Name the rule.',
    !sourceBasis.trim() && 'Record the source / technical basis.',
    kind === 'om_benchmark' &&
      !(CANDIDATE_BENCHMARKS as string[]).includes(benchmarkKey) &&
      !isMetricBenchmark(benchmarkKey) &&
      'Benchmark must be a built-in candidate or metric:<03.2 metric key>.',
    metric && !benchmarkLabel.trim() && 'A metric benchmark needs a label.',
    ranged && high.trim() !== '' && low.trim() === '' && 'A high % needs a low %.',
    (kind === 'attention' || kind === 'rounding') &&
      !(Number(param) > 0) &&
      'Enter a positive parameter.',
  ].filter((e): e is string => typeof e === 'string');

  const save = useMutation({
    mutationFn: (body: CreateMaterialityRuleVersionInput) =>
      apiFetch<MaterialityMethodologyRuleRecord>(`${API}/rules`, { method: 'POST', body }),
    onSuccess: (r) => {
      toast(`${r.ruleCode} v${r.version} saved.`);
      void qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      v.reset();
      onDone();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not save the library version.'),
  });

  return (
    <form
      className="space-y-3 rounded-lg border border-line bg-surface-raised p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (errors.length) return;
        save.mutate({
          ruleCode,
          kind,
          name: name.trim(),
          ...(kind === 'om_benchmark'
            ? { benchmarkKey, benchmarkLabel: benchmarkLabel.trim() || null }
            : {}),
          ...(kind === 'attention' ? { attentionCriterion: criterion } : {}),
          ...(ranged ? { lowPct: numOrNull(low), highPct: numOrNull(high) } : {}),
          ...(kind === 'attention' || kind === 'rounding'
            ? { parameterValue: numOrNull(param) }
            : {}),
          industryProfiles: splitList(profiles),
          circumstances,
          considerations: splitLines(considerations),
          sourceBasis: sourceBasis.trim(),
          provisional,
          overrideAttention: override,
          ...v.body,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Rule code" required>
          <Input value={ruleCode} disabled={!!base} onChange={(e) => setRuleCode(e.target.value)} />
        </Field>
        <Field label="Kind" required>
          <Select
            value={kind}
            disabled={!!base}
            onChange={(e) => setKind(e.target.value as MaterialityRuleKind)}
          >
            {MATERIALITY_RULE_KINDS.map((k) => (
              <option key={k} value={k}>
                {MATERIALITY_RULE_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      {kind === 'om_benchmark' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Possible benchmark"
            required
            hint="A built-in candidate, or metric:<03.2 metric key> for a methodology-defined one."
          >
            <Input
              value={benchmarkKey}
              disabled={!!base}
              list="materiality-benchmarks"
              onChange={(e) => setBenchmarkKey(e.target.value.trim())}
            />
            <datalist id="materiality-benchmarks">
              {CANDIDATE_BENCHMARKS.map((k) => (
                <option key={k} value={k}>
                  {MATERIALITY_BENCHMARK_LABEL[k]}
                </option>
              ))}
            </datalist>
          </Field>
          {metric && (
            <Field label="Benchmark label" required>
              <Input value={benchmarkLabel} onChange={(e) => setBenchmarkLabel(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      {kind === 'attention' && (
        <Field label="Attention criterion" required>
          <Select
            value={criterion}
            disabled={!!base}
            onChange={(e) => setCriterion(e.target.value as MaterialityAttentionCriterion)}
          >
            {MATERIALITY_ATTENTION_CRITERIA.map((c) => (
              <option key={c} value={c}>
                {MATERIALITY_ATTENTION_CRITERION_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {ranged ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Low %" hint="Optional — leave blank for considerations only.">
            <Input type="number" step="0.01" value={low} onChange={(e) => setLow(e.target.value)} />
          </Field>
          <Field label="High %">
            <Input
              type="number"
              step="0.01"
              value={high}
              onChange={(e) => setHigh(e.target.value)}
            />
          </Field>
          <Field
            label="Override rule"
            hint="Selecting outside the range is permitted with a rationale."
          >
            <Select
              value={override}
              onChange={(e) => setOverride(e.target.value as MaterialityOverrideAttention)}
            >
              {MATERIALITY_OVERRIDE_ATTENTIONS.map((o) => (
                <option key={o} value={o}>
                  Raises {MATERIALITY_OVERRIDE_ATTENTION_LABEL[o]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : (
        <Field
          label={kind === 'rounding' ? 'Rounding step (₹)' : 'Attention parameter (%)'}
          required
        >
          <Input
            type="number"
            step="0.01"
            value={param}
            onChange={(e) => setParam(e.target.value)}
          />
        </Field>
      )}
      <Field
        label="Industry profiles (03.2)"
        hint="Comma-separated profile keys; blank = every profile."
      >
        <Input value={profiles} onChange={(e) => setProfiles(e.target.value)} />
      </Field>
      <CheckList
        legend="Entity circumstances (blank = every file)"
        options={CIRCUMSTANCES}
        value={circumstances}
        onChange={setCircumstances}
        labelOf={circumstanceLabel}
      />
      <Field label="Considerations" hint="One per line — shown with the guidance in 03.3.">
        <Textarea
          rows={3}
          value={considerations}
          onChange={(e) => setConsiderations(e.target.value)}
        />
      </Field>
      <Field label="Source / technical basis" required>
        <Input value={sourceBasis} onChange={(e) => setSourceBasis(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={provisional}
          onChange={(e) => setProvisional(e.target.checked)}
        />
        Provisional — not yet formally approved by DHVAJ
      </label>
      {v.fields('Retire this rule from the effective date')}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={errors.length > 0 || save.isPending}
          title={errors.join(' ') || undefined}
        >
          {base ? 'Add version' : 'Add rule'}
        </Button>
      </div>
    </form>
  );
}
