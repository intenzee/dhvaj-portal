'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddAuditRuleVersionInput,
  AuditRuleProvisionOption,
  AuditRuleRecord,
  AuditRuleVersionRecord,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';

const RULES_KEY = ['audit-rules'];
const CRORE = 10_000_000;

/**
 * Rules Library (DHVAJ 02.2 spec §2): the thresholds, effective dates,
 * exemption conditions and authoritative links the framework engines resolve
 * by audit period. A change is a new dated version — earlier periods keep the
 * version in force for them, so concluded engagements never change and no
 * code deployment is needed. Every version is audited with its reason.
 */
export function RulesLibrarySection(): JSX.Element {
  const rules = useQuery({
    queryKey: RULES_KEY,
    queryFn: () => apiFetch<AuditRuleRecord[]>('/audit-rules'),
  });
  const provisions = useQuery({
    queryKey: [...RULES_KEY, 'provisions'],
    queryFn: () => apiFetch<AuditRuleProvisionOption[]>('/audit-rules/provisions'),
  });
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const shown = (rules.data ?? []).filter(
      (r) =>
        !q ||
        r.code.toLowerCase().includes(q) ||
        r.areaKey.includes(q) ||
        r.criterion.includes(q) ||
        (r.entityClass ?? '').includes(q),
    );
    const byArea = new Map<string, AuditRuleRecord[]>();
    for (const r of shown) byArea.set(r.areaKey, [...(byArea.get(r.areaKey) ?? []), r]);
    return [...byArea.entries()];
  }, [rules.data, search]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Rules Library</h3>
        <p className="text-xs text-ink-muted">
          Limits and effective dates are configuration, not code. To reflect an amendment, add a
          new version from the date it applies — audit periods starting earlier keep the version
          in force for them, and concluded files are never changed.
        </p>
      </div>
      <div className="max-w-sm">
        <Field label="Search rules">
          <Input
            value={search}
            placeholder="Code, area, criterion or entity class"
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
      </div>
      {rules.isLoading ? (
        <Spinner label="Loading rules…" />
      ) : rules.isError ? (
        <p className="text-sm text-danger-600">Could not load the Rules Library.</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-ink-muted">No rules match.</p>
      ) : (
        groups.map(([area, list]) => (
          <section key={area} className="space-y-1.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {area}
            </h4>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {list.map((r) => (
                <RuleRow key={r.id} rule={r} provisions={provisions.data ?? []} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** The version in force today (latest start on or before today), else the newest. */
function currentVersion(rule: AuditRuleRecord): AuditRuleVersionRecord | null {
  const today = new Date().toISOString().slice(0, 10);
  return (
    rule.versions.find(
      (v) => v.effectiveFrom <= today && (v.effectiveTo == null || v.effectiveTo > today),
    ) ??
    rule.versions[0] ??
    null
  );
}

function formatThreshold(rule: AuditRuleRecord, v: number | null): string {
  if (v == null) return '—';
  if (rule.unit === 'inr')
    return `₹${(v / CRORE).toLocaleString('en-IN', { maximumFractionDigits: 2 })} crore`;
  if (rule.unit === 'percent') return `${v}%`;
  return String(v);
}

function limitText(rule: AuditRuleRecord, v: AuditRuleVersionRecord): string {
  if (v.threshold == null) return 'Condition only';
  if (rule.operator === 'between')
    return `${formatThreshold(rule, v.threshold)} – ${formatThreshold(rule, v.thresholdHigh)}`;
  return `${rule.operator} ${formatThreshold(rule, v.threshold)}`;
}

function RuleRow({
  rule,
  provisions,
}: {
  rule: AuditRuleRecord;
  provisions: AuditRuleProvisionOption[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const cur = currentVersion(rule);
  return (
    <li className="px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full flex-wrap items-center gap-2.5 text-left"
      >
        <ExpandToggle open={open} />
        <span className="font-mono text-xs text-ink">{rule.code}</span>
        <span className="text-xs text-ink-muted">
          {rule.criterion}
          {rule.entityClass ? ` · ${rule.entityClass}` : ''}
        </span>
        {cur && <Badge tone="info">{limitText(rule, cur)}</Badge>}
        {cur?.outcome && <Badge tone="neutral">→ {cur.outcome}</Badge>}
        {!rule.isActive && <Badge tone="warn">Inactive</Badge>}
        <span className="ml-auto text-xs text-ink-faint">
          {rule.versions.length} version{rule.versions.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-4 pl-7">
          <VersionHistory rule={rule} />
          {rule.isActive ? (
            <AddVersionForm rule={rule} provisions={provisions} />
          ) : (
            <p className="text-xs text-ink-muted">
              Inactive rules are kept for history only and are not resolved.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function VersionHistory({ rule }: { rule: AuditRuleRecord }): JSX.Element {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
        <tr>
          <th>Version</th>
          <th>Applies to periods starting</th>
          <th>Limit</th>
          <th>Outcome</th>
          <th>Provision</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line align-top">
        {rule.versions.map((v) => {
          const until = v.supersededFrom ?? v.effectiveTo;
          return (
            <tr key={v.id}>
              <td className="py-1">v{v.version}</td>
              <td>
                {formatDate(v.effectiveFrom)}
                {until ? ` – before ${formatDate(until)}` : ' onwards'}
              </td>
              <td>{limitText(rule, v)}</td>
              <td>{v.outcome ?? '—'}</td>
              <td className="font-mono text-xs">{v.authorityProvisionCode ?? '—'}</td>
              <td className="text-xs text-ink-muted">{v.notes ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const toInput = (rule: AuditRuleRecord, v: number | null | undefined): string =>
  v == null ? '' : String(rule.unit === 'inr' ? v / CRORE : v);
const fromInput = (rule: AuditRuleRecord, s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return rule.unit === 'inr' ? Math.round(n * CRORE) : n;
};

function AddVersionForm({
  rule,
  provisions,
}: {
  rule: AuditRuleRecord;
  provisions: AuditRuleProvisionOption[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const latest = rule.versions[0] ?? null;
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [threshold, setThreshold] = useState(toInput(rule, latest?.threshold));
  const [thresholdHigh, setThresholdHigh] = useState(toInput(rule, latest?.thresholdHigh));
  const [outcome, setOutcome] = useState(latest?.outcome ?? '');
  const [provisionId, setProvisionId] = useState(latest?.authorityProvisionId ?? '');
  const [condition, setCondition] = useState(
    latest?.condition == null ? '' : JSON.stringify(latest.condition, null, 2),
  );
  const [notes, setNotes] = useState('');

  const unitLabel = rule.unit === 'inr' ? ' (₹ crore)' : rule.unit === 'percent' ? ' (%)' : '';
  const t = fromInput(rule, threshold);
  const th = fromInput(rule, thresholdHigh);
  let parsedCondition: Record<string, unknown> | null = null;
  let conditionError: string | null = null;
  if (condition.trim()) {
    try {
      const c: unknown = JSON.parse(condition);
      if (c && typeof c === 'object' && !Array.isArray(c)) parsedCondition = c as Record<string, unknown>;
      else conditionError = 'The condition must be a JSON object.';
    } catch {
      conditionError = 'The condition is not valid JSON.';
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const dateError =
    effectiveFrom && latest && effectiveFrom <= latest.effectiveFrom
      ? `Must be after ${formatDate(latest.effectiveFrom)} — earlier periods keep their rule.`
      : null;
  const errors = [
    !effectiveFrom && 'Enter the date the change applies from.',
    dateError,
    Number.isNaN(t) && 'The limit must be a number.',
    Number.isNaN(th) && 'The upper limit must be a number.',
    latest?.threshold != null && t == null && 'This rule needs a limit.',
    rule.operator === 'between' && t != null && th != null && th < t && 'Upper limit must be ≥ lower.',
    conditionError,
    notes.trim().length < 5 && 'Record why the rule changed (notification / amendment).',
  ].filter(Boolean) as string[];

  const add = useMutation({
    mutationFn: () => {
      const body: AddAuditRuleVersionInput = {
        effectiveFrom,
        threshold: t,
        thresholdHigh: rule.operator === 'between' ? th : null,
        condition: parsedCondition,
        outcome: outcome.trim() || null,
        authorityProvisionId: provisionId || null,
        notes: notes.trim(),
        version: rule.version,
      };
      return apiFetch<AuditRuleRecord>(`/audit-rules/${rule.id}/versions`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: () => {
      toast(`New version of ${rule.code} applies from ${formatDate(effectiveFrom)}.`);
      setEffectiveFrom('');
      setNotes('');
      void qc.invalidateQueries({ queryKey: RULES_KEY });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not add the version.'),
  });

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <p className="text-sm font-medium text-ink">Add a version</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Applies to periods starting on/after" required hint={dateError ?? undefined}>
          <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
        <Field label={`${rule.operator === 'between' ? 'Lower limit' : `Limit (${rule.operator})`}${unitLabel}`}>
          <Input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </Field>
        {rule.operator === 'between' && (
          <Field label={`Upper limit${unitLabel}`}>
            <Input
              inputMode="decimal"
              value={thresholdHigh}
              onChange={(e) => setThresholdHigh(e.target.value)}
            />
          </Field>
        )}
        <Field label="Outcome when met">
          <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </Field>
        <Field label="Provision cited">
          <Select value={provisionId} onChange={(e) => setProvisionId(e.target.value)}>
            <option value="">None</option>
            {provisions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.provisionNumber} (from {p.effectiveFrom})
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label="Condition (JSON)"
        hint={conditionError ?? 'Structured parameters the engine reads, e.g. Rule 4 measurement timing.'}
      >
        <Textarea
          rows={3}
          className="font-mono text-xs"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        />
      </Field>
      <Field label="Reason for the change" required hint="Notification / amendment reference — kept in the audit trail.">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {effectiveFrom && effectiveFrom <= today && !dateError && (
        <p className="text-xs text-warning-700">
          This date has passed: open audit files for periods starting on or after it will
          re-evaluate against the new version. Concluded files keep their recorded conclusion.
        </p>
      )}
      {latest && (
        <p className="text-xs text-ink-muted">
          Periods starting before the new date keep v{latest.version}.
        </p>
      )}
      <Button
        size="sm"
        disabled={errors.length > 0 || add.isPending}
        title={errors[0]}
        onClick={() => add.mutate()}
      >
        Add version
      </Button>
    </div>
  );
}
