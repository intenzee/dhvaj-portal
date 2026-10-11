'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PLANNING_ATTENTION_LABEL,
  PLANNING_ATTENTIONS,
  PLANNING_CHANGE_CATEGORIES,
  PLANNING_CHANGE_CATEGORY_LABEL,
  PLANNING_CONSIDERATION_KIND_LABEL,
  PLANNING_CONSIDERATION_KINDS,
  type CreatePlanningConsiderationRuleVersionInput,
  type PlanningAttention,
  type PlanningChangeCategory,
  type PlanningConsiderationKind,
  type PlanningConsiderationRuleRecord,
  type PlanningSignalRuleRecord,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';

const LIBRARY_KEY = ['planning-consideration-rules'];
/** Shared with the Planning Signal Library section (same cache entry). */
const SIGNAL_RULES_KEY = ['planning-signal-rules'];

const splitList = (s: string): string[] => [
  ...new Set(
    s
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];

/** "fires on" summary of a rule version. */
function triggerSummary(r: PlanningConsiderationRuleRecord): string {
  return [
    ...r.matchRuleKeys,
    ...r.matchChangeCategories.map(
      (c) => `change: ${PLANNING_CHANGE_CATEGORY_LABEL[c as PlanningChangeCategory] ?? c}`,
    ),
    ...r.matchAttention.map((a) => `attention: ${PLANNING_ATTENTION_LABEL[a]}`),
  ].join(' · ');
}

/**
 * Strategic Consideration Library (DHVAJ 03.1 §13.2–13.3, §21): which Planning
 * Signals prompt a strategic timing or resource consideration, and its wording.
 * Configuration, not code — a change is a new version from a date; a
 * consideration already generated keeps the version it came from.
 */
export function PlanningConsiderationLibrarySection(): JSX.Element {
  const rules = useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: () => apiFetch<PlanningConsiderationRuleRecord[]>('/planning-consideration-rules'),
  });
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => {
    const byCode = new Map<string, PlanningConsiderationRuleRecord[]>();
    for (const r of rules.data ?? [])
      byCode.set(r.ruleCode, [...(byCode.get(r.ruleCode) ?? []), r]);
    return [...byCode.values()];
  }, [rules.data]);

  const nextCode = useMemo(() => {
    const used = new Set((rules.data ?? []).map((r) => r.ruleCode));
    for (let n = 1; n < 1000; n += 1) {
      const code = `PCR-${String(n).padStart(3, '0')}`;
      if (!used.has(code)) return code;
    }
    return '';
  }, [rules.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h3 className="text-sm font-semibold text-ink">Strategic Consideration Library</h3>
          <p className="text-xs text-ink-muted">
            The strategic timing and resource considerations 03.1 proposes from the signal register.
            A rule fires when any listed signal rule key, current-year change or attention level is
            present. Considerations never carry dates (03.11) or named people (03.8). To change a
            rule, add a version from the date it applies.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel new consideration' : 'New consideration'}
        </Button>
      </div>
      {adding && (
        <ConsiderationVersionForm
          base={null}
          defaultCode={nextCode}
          onDone={() => setAdding(false)}
        />
      )}
      {rules.isLoading ? (
        <Spinner label="Loading the library…" />
      ) : rules.isError ? (
        <p className="text-sm text-danger-600">
          Could not load the Strategic Consideration Library.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {groups.map((versions) => (
            <ConsiderationRow key={versions[0]!.ruleCode} versions={versions} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConsiderationRow({
  versions,
}: {
  versions: PlanningConsiderationRuleRecord[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const latest = versions[0]!;
  return (
    <li className="px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full flex-wrap items-center gap-2.5 text-left"
      >
        <ExpandToggle open={open} />
        <span className="font-mono text-xs text-ink">{latest.ruleCode}</span>
        <span className="text-sm text-ink">{latest.label}</span>
        <Badge tone="neutral">{latest.kind === 'timing' ? 'Timing' : 'Resource'}</Badge>
        {!latest.active && <Badge tone="warn">Retired</Badge>}
        <span className="ml-auto text-xs text-ink-faint">
          v{latest.version} · {versions.length} version{versions.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-4 pl-7">
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-ink-muted">Key</dt>
            <dd className="font-mono text-xs">{latest.considerationKey}</dd>
            <dt className="text-ink-muted">Fires on</dt>
            <dd className="text-xs">{triggerSummary(latest)}</dd>
            <dt className="text-ink-muted">Basis</dt>
            <dd>{latest.basis}</dd>
          </dl>
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th>Version</th>
                <th>Applies to periods ending</th>
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
          <ConsiderationVersionForm
            base={latest}
            defaultCode={latest.ruleCode}
            onDone={() => undefined}
          />
        </div>
      )}
    </li>
  );
}

/** Add a version of `base`, or (base = null) the first version of a new rule. */
function ConsiderationVersionForm({
  base,
  defaultCode,
  onDone,
}: {
  base: PlanningConsiderationRuleRecord | null;
  defaultCode: string;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const signalRules = useQuery({
    queryKey: SIGNAL_RULES_KEY,
    queryFn: () => apiFetch<PlanningSignalRuleRecord[]>('/planning-signal-rules'),
  });
  const [ruleCode, setRuleCode] = useState(defaultCode);
  const [key, setKey] = useState(base?.considerationKey ?? '');
  const [kind, setKind] = useState<PlanningConsiderationKind>(base?.kind ?? 'timing');
  const [label, setLabel] = useState(base?.label ?? '');
  const [basis, setBasis] = useState(base?.basis ?? '');
  const [ruleKeys, setRuleKeys] = useState((base?.matchRuleKeys ?? []).join(', '));
  const [categories, setCategories] = useState<string[]>(base?.matchChangeCategories ?? []);
  const [attention, setAttention] = useState<PlanningAttention[]>(base?.matchAttention ?? []);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [active, setActive] = useState(base?.active ?? true);
  const [changeNote, setChangeNote] = useState('');

  const keys = splitList(ruleKeys);
  /** Each listed key → the signal rule it names (latest version), if known. */
  const signalByKey = useMemo(() => {
    const m = new Map<string, PlanningSignalRuleRecord>();
    for (const r of signalRules.data ?? []) if (!m.has(r.ruleKey)) m.set(r.ruleKey, r);
    return m;
  }, [signalRules.data]);
  const unknownKeys = signalRules.data ? keys.filter((k) => !signalByKey.has(k)) : [];

  const dateError =
    base && effectiveFrom && effectiveFrom < base.effectiveFrom
      ? `Must be on or after ${formatDate(base.effectiveFrom)}.`
      : null;
  const errors = [
    !/^PCR-[0-9]{3}$/.test(ruleCode) && 'The rule code must look like PCR-018.',
    !base && !/^[a-z0-9_]{2,60}$/.test(key) && 'The key must be lower_snake_case.',
    !label.trim() && 'Write the consideration.',
    !basis.trim() && 'Say why it is proposed.',
    !keys.length &&
      !categories.length &&
      !attention.length &&
      'Choose at least one signal rule key, change or attention level.',
    unknownKeys.length > 0 && `Unknown signal rule key: ${unknownKeys.join(', ')}.`,
    dateError,
    changeNote.trim().length < 3 && 'Record why this version exists.',
  ].filter(Boolean) as string[];

  const save = useMutation({
    mutationFn: () => {
      const body: CreatePlanningConsiderationRuleVersionInput = {
        ruleCode,
        ...(base ? {} : { considerationKey: key }),
        kind,
        label: label.trim(),
        basis: basis.trim(),
        matchRuleKeys: keys,
        matchChangeCategories: categories,
        matchAttention: attention,
        ...(effectiveFrom ? { effectiveFrom } : {}),
        active,
        changeNote: changeNote.trim(),
      };
      return apiFetch<PlanningConsiderationRuleRecord>('/planning-consideration-rules', {
        method: 'POST',
        body,
      });
    },
    onSuccess: (r) => {
      toast(`${r.ruleCode} v${r.version} saved.`);
      setChangeNote('');
      void qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      onDone();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not save the consideration rule.'),
  });

  const toggle = <T,>(set: (fn: (cur: T[]) => T[]) => void, v: T) =>
    set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <p className="text-sm font-medium text-ink">
        {base ? `Add a version of ${base.ruleCode}` : 'New consideration'}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Rule code" required>
          <Input value={ruleCode} disabled={!!base} onChange={(e) => setRuleCode(e.target.value)} />
        </Field>
        <Field label="Key" required hint="Fixed once created — the file's consideration keeps it.">
          <Input value={key} disabled={!!base} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field label="Kind" hint={base ? 'Fixed — add a new rule for the other kind.' : undefined}>
          <Select
            value={kind}
            disabled={!!base}
            onChange={(e) => setKind(e.target.value as PlanningConsiderationKind)}
          >
            {PLANNING_CONSIDERATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {PLANNING_CONSIDERATION_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Consideration" required hint="Strategic only — no dates and no names.">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Basis" required hint="Shown to the Manager as why it was proposed.">
        <Textarea rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} />
      </Field>
      <Field
        label="Fires on signal rule keys"
        hint={
          unknownKeys.length
            ? `Unknown: ${unknownKeys.join(', ')}`
            : keys
                .map((k) => signalByKey.get(k))
                .filter(Boolean)
                .map((r) => `${r!.ruleCode} ${r!.name}`)
                .join(' · ') || 'Comma-separated Planning Signal Library rule keys.'
        }
      >
        <Input value={ruleKeys} onChange={(e) => setRuleKeys(e.target.value)} />
      </Field>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-ink">…or a current-year change</legend>
        <div className="flex flex-wrap gap-3">
          {PLANNING_CHANGE_CATEGORIES.filter((c) => c !== 'no_significant_change').map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={categories.includes(c)}
                onChange={() => toggle(setCategories, c as string)}
              />
              {PLANNING_CHANGE_CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-ink">…or a signal&apos;s attention</legend>
        <div className="flex flex-wrap gap-3">
          {PLANNING_ATTENTIONS.map((a) => (
            <label key={a} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={attention.includes(a)}
                onChange={() => toggle(setAttention, a)}
              />
              {PLANNING_ATTENTION_LABEL[a]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Applies to periods ending on/after" hint={dateError ?? undefined}>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </Field>
      </div>
      {base && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} />
          Retire this consideration from the date above (generated ones stay on their files)
        </label>
      )}
      <Field label="Reason for this version" required hint="Kept in the audit trail.">
        <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
      </Field>
      <Button
        size="sm"
        disabled={errors.length > 0 || save.isPending}
        title={errors[0]}
        onClick={() => save.mutate()}
      >
        {base ? 'Add version' : 'Create consideration'}
      </Button>
    </div>
  );
}
