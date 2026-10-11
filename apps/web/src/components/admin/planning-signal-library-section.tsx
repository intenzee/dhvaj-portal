'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PLANNING_ATTENTION_LABEL,
  PLANNING_ATTENTIONS,
  PLANNING_DESTINATIONS,
  PLANNING_RULE_TRIGGER_SOURCE_LABEL,
  PLANNING_RULE_TRIGGER_SOURCES,
  type CreatePlanningSignalRuleVersionInput,
  type PlanningAttention,
  type PlanningDestination,
  type PlanningRuleTriggerSource,
  type PlanningSignalRuleRecord,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';

const LIBRARY_KEY = ['planning-signal-rules'];

const DESTINATION_LABEL: Record<PlanningDestination, string> = {
  '03.4': '03.4 Materiality',
  '03.5': '03.5 Area review',
  '03.6': '03.6 Risks',
  '03.8': '03.8 Team',
  '03.9': '03.9 Components',
  '03.11': '03.11 Timeline',
  section_04: 'Section 04',
};

const ATTENTION_TONE: Record<PlanningAttention, 'neutral' | 'warn' | 'danger'> = {
  standard: 'neutral',
  enhanced: 'warn',
  immediate_partner: 'danger',
};

/**
 * Planning Signal Library (DHVAJ 03.1 §6, §21): the rules that turn Section
 * 01/02 facts and current-year changes into Planning Signals. Configuration,
 * not code — a change is a new version from a date; a signal that already fired
 * keeps the rule version it fired under. Every version is audited.
 */
export function PlanningSignalLibrarySection(): JSX.Element {
  const rules = useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: () => apiFetch<PlanningSignalRuleRecord[]>('/planning-signal-rules'),
  });
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  /** Versions grouped by rule code (latest first, as the API returns them). */
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byCode = new Map<string, PlanningSignalRuleRecord[]>();
    for (const r of rules.data ?? [])
      byCode.set(r.ruleCode, [...(byCode.get(r.ruleCode) ?? []), r]);
    return [...byCode.values()].filter(
      ([latest]) =>
        !q ||
        latest!.ruleCode.toLowerCase().includes(q) ||
        latest!.ruleKey.includes(q) ||
        latest!.name.toLowerCase().includes(q) ||
        latest!.triggerSection.includes(q),
    );
  }, [rules.data, search]);

  const nextCode = useMemo(() => {
    const used = new Set((rules.data ?? []).map((r) => r.ruleCode));
    // PSR-1xx are the current-year change rules; engagement rules stay below.
    for (let n = 1; n < 100; n += 1) {
      const code = `PSR-${String(n).padStart(3, '0')}`;
      if (!used.has(code)) return code;
    }
    return '';
  }, [rules.data]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Planning Signal Library</h3>
        <p className="text-xs text-ink-muted">
          The rules behind 03.1 Engagement Intelligence. Each rule reads Section 01/02 facts (or a
          current-year change) and raises a Planning Signal with its observation, why it may matter,
          the implications, the guidance and where it flows. To change a rule, add a version from
          the date it applies — signals already raised keep the version they fired under.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <Field label="Search rules">
            <Input
              value={search}
              placeholder="Code, key, name or section"
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel new rule' : 'New rule'}
        </Button>
      </div>
      {adding && (
        <RuleVersionForm base={null} defaultCode={nextCode} onDone={() => setAdding(false)} />
      )}
      {rules.isLoading ? (
        <Spinner label="Loading the library…" />
      ) : rules.isError ? (
        <p className="text-sm text-danger-600">Could not load the Planning Signal Library.</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-ink-muted">No rules match.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {groups.map((versions) => (
            <RuleRow key={versions[0]!.ruleCode} versions={versions} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleRow({ versions }: { versions: PlanningSignalRuleRecord[] }): JSX.Element {
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
        <span className="text-sm text-ink">{latest.name}</span>
        <Badge tone="neutral">{latest.triggerSection}</Badge>
        <Badge tone={ATTENTION_TONE[latest.suggestedAttention]}>
          {PLANNING_ATTENTION_LABEL[latest.suggestedAttention]}
        </Badge>
        {!latest.active && <Badge tone="warn">Retired</Badge>}
        <span className="ml-auto text-xs text-ink-faint">
          v{latest.version} · {versions.length} version{versions.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-4 pl-7">
          <RuleDetail rule={latest} />
          <VersionHistory versions={versions} />
          <RuleVersionForm base={latest} defaultCode={latest.ruleCode} onDone={() => undefined} />
        </div>
      )}
    </li>
  );
}

function RuleDetail({ rule }: { rule: PlanningSignalRuleRecord }): JSX.Element {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
      <dt className="text-ink-muted">Rule key</dt>
      <dd className="font-mono text-xs">{rule.ruleKey}</dd>
      <dt className="text-ink-muted">Trigger</dt>
      <dd>
        {PLANNING_RULE_TRIGGER_SOURCE_LABEL[rule.triggerSource]} · {rule.triggerSection}
        <pre className="mt-1 overflow-x-auto rounded bg-surface-sunken p-2 font-mono text-[11px]">
          {JSON.stringify(rule.triggerCondition)}
        </pre>
      </dd>
      <dt className="text-ink-muted">Observation</dt>
      <dd>{rule.observationTemplate}</dd>
      <dt className="text-ink-muted">Why it may matter</dt>
      <dd>{rule.whyMayMatter}</dd>
      <dt className="text-ink-muted">Potential implications</dt>
      <dd>{rule.potentialImplications}</dd>
      <dt className="text-ink-muted">Flows to</dt>
      <dd>{rule.destinations.map((d) => DESTINATION_LABEL[d]).join(', ') || '—'}</dd>
      <dt className="text-ink-muted">Guidance</dt>
      <dd className="font-mono text-xs">{rule.guidanceAnchors.join(', ') || '—'}</dd>
      <dt className="text-ink-muted">Source link</dt>
      <dd className="font-mono text-xs">{rule.sourceLink ?? '—'}</dd>
    </dl>
  );
}

function VersionHistory({ versions }: { versions: PlanningSignalRuleRecord[] }): JSX.Element {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
        <tr>
          <th>Version</th>
          <th>Applies to periods ending</th>
          <th>Condition</th>
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
            <td>c{v.conditionVersion}</td>
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

const splitList = (s: string): string[] =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Add a version of `base`, or (base = null) the first version of a new rule. */
function RuleVersionForm({
  base,
  defaultCode,
  onDone,
}: {
  base: PlanningSignalRuleRecord | null;
  defaultCode: string;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [ruleCode, setRuleCode] = useState(defaultCode);
  const [ruleKey, setRuleKey] = useState(base?.ruleKey ?? '');
  const [name, setName] = useState(base?.name ?? '');
  const [triggerSource, setTriggerSource] = useState<PlanningRuleTriggerSource>(
    base?.triggerSource ?? 'section_02',
  );
  const [triggerSection, setTriggerSection] = useState(base?.triggerSection ?? '');
  const [condition, setCondition] = useState(
    base ? JSON.stringify(base.triggerCondition, null, 2) : '{ "fact": "", "op": "truthy" }',
  );
  const [observation, setObservation] = useState(base?.observationTemplate ?? '');
  const [why, setWhy] = useState(base?.whyMayMatter ?? '');
  const [implications, setImplications] = useState(base?.potentialImplications ?? '');
  const [anchors, setAnchors] = useState((base?.guidanceAnchors ?? []).join(', '));
  const [destinations, setDestinations] = useState<PlanningDestination[]>(base?.destinations ?? []);
  const [attention, setAttention] = useState<PlanningAttention>(
    base?.suggestedAttention ?? 'standard',
  );
  const [sourceLink, setSourceLink] = useState(base?.sourceLink ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [active, setActive] = useState(base?.active ?? true);
  const [changeNote, setChangeNote] = useState('');

  let parsed: Record<string, unknown> | null = null;
  let conditionError: string | null = null;
  try {
    const c: unknown = JSON.parse(condition);
    if (c && typeof c === 'object' && !Array.isArray(c)) parsed = c as Record<string, unknown>;
    else conditionError = 'The condition must be a JSON object.';
  } catch {
    conditionError = 'The condition is not valid JSON.';
  }
  const dateError =
    base && effectiveFrom && effectiveFrom < base.effectiveFrom
      ? `Must be on or after ${formatDate(base.effectiveFrom)}.`
      : null;
  const errors = [
    !/^PSR-[0-9]{3}$/.test(ruleCode) && 'The rule code must look like PSR-027.',
    !base && !/^[a-z0-9_]{2,60}$/.test(ruleKey) && 'The rule key must be lower_snake_case.',
    !name.trim() && 'Name the rule.',
    !/^[0-9]{2}\.[0-9]{1,2}$/.test(triggerSection) && 'The section must look like 02.6.',
    conditionError,
    !observation.trim() && 'Write the observation template.',
    !why.trim() && 'Say why it may matter.',
    !implications.trim() && 'Describe the potential implications.',
    sourceLink.trim() &&
      !/^[a-z_]+:[A-Za-z0-9_.-]+$/.test(sourceLink.trim()) &&
      'The source link must look like framework:02.6.',
    dateError,
    changeNote.trim().length < 3 && 'Record why this version exists.',
  ].filter(Boolean) as string[];

  const save = useMutation({
    mutationFn: () => {
      const body: CreatePlanningSignalRuleVersionInput = {
        ruleCode,
        ...(base ? {} : { ruleKey }),
        name: name.trim(),
        triggerSource,
        triggerSection,
        triggerCondition: parsed ?? {},
        observationTemplate: observation.trim(),
        whyMayMatter: why.trim(),
        potentialImplications: implications.trim(),
        guidanceAnchors: splitList(anchors),
        destinations,
        suggestedAttention: attention,
        sourceLink: sourceLink.trim() || null,
        ...(effectiveFrom ? { effectiveFrom } : {}),
        active,
        changeNote: changeNote.trim(),
      };
      return apiFetch<PlanningSignalRuleRecord>('/planning-signal-rules', {
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
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save the rule.'),
  });

  const toggleDestination = (d: PlanningDestination) =>
    setDestinations((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <p className="text-sm font-medium text-ink">
        {base ? `Add a version of ${base.ruleCode}` : 'New rule'}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Rule code" required>
          <Input value={ruleCode} disabled={!!base} onChange={(e) => setRuleCode(e.target.value)} />
        </Field>
        <Field label="Rule key" required hint="Fixed once created — 03.5 links signals by it.">
          <Input value={ruleKey} disabled={!!base} onChange={(e) => setRuleKey(e.target.value)} />
        </Field>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Trigger source">
          <Select
            value={triggerSource}
            onChange={(e) => setTriggerSource(e.target.value as PlanningRuleTriggerSource)}
          >
            {PLANNING_RULE_TRIGGER_SOURCES.map((s) => (
              <option key={s} value={s}>
                {PLANNING_RULE_TRIGGER_SOURCE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Trigger section" required>
          <Input
            value={triggerSection}
            placeholder="02.6"
            onChange={(e) => setTriggerSection(e.target.value)}
          />
        </Field>
        <Field label="Suggested attention">
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
      <Field
        label="Trigger condition (JSON)"
        hint={
          conditionError ??
          'Over the Planning Facts: {"fact":"caro","op":"eq","value":"applicable"}; combine with {"all":[…]}, {"any":[…]}, {"not":…}. Ops: truthy, eq, in, gt.'
        }
      >
        <Textarea
          rows={3}
          className="font-mono text-xs"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        />
      </Field>
      <Field
        label="Observation template"
        required
        hint="{{fact}} inserts a fact; a [[…]] segment is dropped when a fact inside it is empty."
      >
        <Textarea rows={2} value={observation} onChange={(e) => setObservation(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Why it may matter" required>
          <Textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} />
        </Field>
        <Field label="Potential implications" required>
          <Textarea
            rows={3}
            value={implications}
            onChange={(e) => setImplications(e.target.value)}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-ink">Flows to</legend>
        <div className="flex flex-wrap gap-3">
          {PLANNING_DESTINATIONS.map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={destinations.includes(d)}
                onChange={() => toggleDestination(d)}
              />
              {DESTINATION_LABEL[d]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Guidance anchors" hint="03.1 reference keys, e.g. sa_315, view_ig_rba.">
          <Input value={anchors} onChange={(e) => setAnchors(e.target.value)} />
        </Field>
        <Field label="Source link" hint="framework:02.6, acceptance:question-acc_03…">
          <Input value={sourceLink} onChange={(e) => setSourceLink(e.target.value)} />
        </Field>
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
          Retire this rule from the date above (no new signals; raised signals stay)
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
        {base ? 'Add version' : 'Create rule'}
      </Button>
    </div>
  );
}
