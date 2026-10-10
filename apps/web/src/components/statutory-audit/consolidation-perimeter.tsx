'use client';

import { useState, type ReactNode } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import {
  ASSESSMENT_ANSWERS,
  COMPONENT_AUDITOR_TYPE_LABEL,
  CONSOLIDATION_METHOD_LABEL,
  INVESTEE_RELATIONSHIP_LABEL,
  LOCAL_FRAMEWORKS,
  LOCAL_FRAMEWORK_LABEL,
  POLICY_ALIGNMENTS,
  POLICY_ALIGNMENT_LABEL,
  RELATIONSHIP_KINDS,
  type AssessmentAnswer,
  type GroupAuditStatus,
  type InvesteeClassification,
  type InvesteeInput,
  type LocalFramework,
  type PerimeterInclusion,
  type PolicyAlignment,
  type RelationshipKind,
} from '@hsdg/contracts';
import { humanize } from '@/lib/format';
import { Badge, Button } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';

/**
 * 02.6 Consolidation Perimeter (spec §5, §8, §10, §11): one row per related
 * entity with the system classification, the professional relationship
 * conclusions, the inclusion decision, CFS-03 reporting date and CFS-04 local
 * framework. Each row opens its editor in place (+/−) — never a pop-up. The
 * component id is stable; every module that reads the perimeter keys off it.
 */

const ANSWER_LABEL: Record<AssessmentAnswer, string> = {
  yes: 'Yes',
  no: 'No',
  further_assessment: 'Further assessment',
};
const KIND_LABEL: Record<RelationshipKind, string> = {
  subsidiary: 'Subsidiary',
  associate: 'Associate',
  joint_venture: 'Joint venture',
  other: 'Other',
};
const INCLUSION_LABEL: Record<PerimeterInclusion, string> = {
  yes: 'Included',
  no: 'Excluded',
  pending: 'Pending',
};

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
const num = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const text = (v: string): string | null => (v.trim() === '' ? null : v);
const triBool = (v: boolean | null | undefined) => (v == null ? '' : String(v));
const fromTri = (v: string): boolean | null => (v === '' ? null : v === 'true');

export function blankInvestee(name: string): InvesteeInput {
  return {
    name,
    ownershipPercent: null,
    hasControl: null,
    isJointArrangement: false,
    jointArrangementIsOperation: false,
    significantInfluenceRebutted: null,
    auditedByOtherAuditor: false,
  };
}

export function ConsolidationPerimeter({
  investees,
  perimeter,
  groupAudit,
  editable,
  busy,
  onSave,
  rowExtras,
}: {
  /** The captured facts (what the team edits). */
  investees: InvesteeInput[];
  /** The engine's classified perimeter (matched by component id). */
  perimeter: InvesteeClassification[];
  groupAudit?: GroupAuditStatus | null;
  editable: boolean;
  busy: boolean;
  /** Save the whole list (the server keeps component ids by name / id). */
  onSave: (next: InvesteeInput[]) => void;
  /** Shown under a saved investee's editor (§5: its evidence and authority links). */
  rowExtras?: (
    id: string,
    investee: InvesteeInput,
    c: InvesteeClassification | undefined,
  ) => ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const keyOf = (i: InvesteeInput, n: number) => i.id ?? `new-${n}`;
  const classified = (i: InvesteeInput) =>
    perimeter.find((p) => (i.id ? p.id === i.id : p.name === i.name));

  const replace = (n: number, next: InvesteeInput) =>
    onSave(investees.map((x, k) => (k === n ? next : x)));

  return (
    <div className="space-y-2" data-testid="consolidation-perimeter">
      {investees.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No subsidiaries, associates or joint arrangements captured — §129(3) does not trigger CFS
          unless one exists. Add one below or fill from the client master.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {investees.map((inv, n) => {
            const k = keyOf(inv, n);
            const c = classified(inv);
            const auditor = inv.id ? groupAudit?.byComponent[inv.id] : undefined;
            const isOpen = open === k;
            return (
              <li key={k} className="px-3 py-2">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : k)}
                  className="group flex w-full flex-wrap items-center gap-2 text-left"
                >
                  <ExpandToggle open={isOpen} />
                  <span className="text-sm font-medium text-ink">{inv.name}</span>
                  {c && (
                    <Badge tone={c.relationship === 'further_assessment' ? 'warn' : 'info'}>
                      {INVESTEE_RELATIONSHIP_LABEL[c.relationship]}
                    </Badge>
                  )}
                  {c && c.method !== 'none' && (
                    <span className="text-xs text-ink-muted">
                      {CONSOLIDATION_METHOD_LABEL[c.method]}
                      {c.standard ? ` · ${c.standard}` : ''}
                    </span>
                  )}
                  <span className="text-xs text-ink-faint">
                    Own {pct(c?.ownershipPercent ?? inv.ownershipPercent)} · Vote{' '}
                    {pct(c?.votingPercent)}
                  </span>
                  {c && (
                    <Badge tone={c.included === 'yes' ? 'success' : 'neutral'}>
                      {INCLUSION_LABEL[c.included]}
                      {c.included !== c.systemIncluded ? ' (changed)' : ''}
                    </Badge>
                  )}
                  {auditor?.auditorType && (
                    <span className="text-xs text-ink-muted">
                      Auditor: {COMPONENT_AUDITOR_TYPE_LABEL[auditor.auditorType]}
                      {auditor.auditorName ? ` (${auditor.auditorName})` : ''}
                    </span>
                  )}
                  {c?.judgementRequired && <Badge tone="warn">Judgement required</Badge>}
                  {c?.presumptionRebutted && <Badge tone="warn">Control dispute</Badge>}
                  {c?.reportingDate?.withinLimit === false && (
                    <Badge tone="danger">Reporting-date gap over limit</Badge>
                  )}
                  {c?.policy?.result === 'conversion_required' && (
                    <Badge tone="info">Conversion required</Badge>
                  )}
                </button>
                {isOpen && (
                  <div className="mt-2 space-y-3 pl-7">
                    {c && <Classification c={c} />}
                    <InvesteeEditor
                      key={JSON.stringify(inv)}
                      investee={inv}
                      classification={c}
                      editable={editable}
                      busy={busy}
                      onSave={(next) => replace(n, next)}
                      onRemove={() => {
                        onSave(investees.filter((_, x) => x !== n));
                        setOpen(null);
                      }}
                    />
                    {inv.id && rowExtras?.(inv.id, inv, c)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editable &&
        (adding ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-line p-2">
            <div className="min-w-[16rem] flex-1">
              <Field label="Related entity name" required>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              </Field>
            </div>
            <Button
              size="sm"
              disabled={busy || !newName.trim()}
              onClick={() => {
                onSave([...investees, blankInvestee(newName.trim())]);
                setNewName('');
                setAdding(false);
              }}
            >
              Add
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={busy}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add related entity
          </Button>
        ))}
    </div>
  );
}

/** The engine's reading of one component — factors, basis, CFS-03 and CFS-04 results. */
function Classification({ c }: { c: InvesteeClassification }): JSX.Element {
  return (
    <div className="space-y-1 rounded-md bg-surface-sunken p-2 text-xs text-ink-muted">
      <p className="text-ink">{c.basis}</p>
      {c.factors.length > 0 && <p>Factors: {c.factors.join(' · ')}</p>}
      {c.presumptionRebutted && (
        <p className="flex items-start gap-1 text-warning-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {c.presumptionRebutted} Engagement Partner approval is required.
        </p>
      )}
      <p>
        Perimeter: {INCLUSION_LABEL[c.included]} — {c.inclusionReason}
        {c.periodImpact ? ` (${humanize(c.periodImpact)})` : ''}
      </p>
      {c.reportingDate && <p>Reporting date (CFS-03): {c.reportingDate.basis}</p>}
      {c.reportingDate && c.reportingDate.missing.length > 0 && (
        <p className="text-warning-700">Still needed: {c.reportingDate.missing.join(', ')}.</p>
      )}
      {c.policy && (
        <p>
          Policies (CFS-04): {POLICY_ALIGNMENT_LABEL[c.policy.result]} — {c.policy.basis}
        </p>
      )}
    </div>
  );
}

function InvesteeEditor({
  investee,
  classification,
  editable,
  busy,
  onSave,
  onRemove,
}: {
  investee: InvesteeInput;
  classification?: InvesteeClassification;
  editable: boolean;
  busy: boolean;
  onSave: (next: InvesteeInput) => void;
  onRemove: () => void;
}): JSX.Element {
  const [d, setD] = useState<InvesteeInput>(investee);
  const set = <K extends keyof InvesteeInput>(k: K, v: InvesteeInput[K]) =>
    setD((x) => ({ ...x, [k]: v }));
  const disabled = !editable || busy;
  const inclusionChanged =
    d.included != null && classification != null && d.included !== classification.systemIncluded;
  const reportingDiffers =
    !!d.reportingDate &&
    classification?.reportingDate?.groupDate != null &&
    d.reportingDate !== classification.reportingDate.groupDate;

  const answer = (
    k: 'controlConclusion' | 'jointControl' | 'significantInfluence',
    label: string,
  ) => (
    <Field label={label}>
      <Select
        value={d[k] ?? ''}
        disabled={disabled}
        onChange={(e) => set(k, (e.target.value || null) as AssessmentAnswer | null)}
      >
        <option value="">Not concluded</option>
        {ASSESSMENT_ANSWERS.map((a) => (
          <option key={a} value={a}>
            {ANSWER_LABEL[a]}
          </option>
        ))}
      </Select>
    </Field>
  );
  const numberField = (k: keyof InvesteeInput, label: string) => (
    <Field label={label}>
      <Input
        inputMode="decimal"
        value={(d[k] as number | null | undefined) ?? ''}
        disabled={disabled}
        onChange={(e) => set(k, num(e.target.value) as never)}
      />
    </Field>
  );

  return (
    <div className="space-y-3">
      <Group title="Relationship assessment (spec §5)">
        <Field label="Name" required>
          <Input value={d.name} disabled={disabled} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Recorded relationship" hint="As on the client master — a suggestion only.">
          <Select
            value={d.suggestedRelationship ?? ''}
            disabled={disabled}
            onChange={(e) =>
              set('suggestedRelationship', (e.target.value || null) as RelationshipKind | null)
            }
          >
            <option value="">Not recorded</option>
            {RELATIONSHIP_KINDS.map((r) => (
              <option key={r} value={r}>
                {KIND_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        {numberField('ownershipPercent', 'Ownership % (total)')}
        {numberField('ownershipDirect', 'Ownership % — direct')}
        {numberField('ownershipIndirect', 'Ownership % — indirect')}
        {numberField('votingDirect', 'Voting power % — direct')}
        {numberField('votingIndirect', 'Voting power % — indirect')}
        <Field label="Controls the board composition?">
          <Select
            value={triBool(d.boardCompositionControl)}
            disabled={disabled}
            onChange={(e) => set('boardCompositionControl', fromTri(e.target.value))}
          >
            <option value="">Not known</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </Field>
        <Field label="Board rights details">
          <Input
            value={d.boardRightsDetails ?? ''}
            disabled={disabled}
            onChange={(e) => set('boardRightsDetails', text(e.target.value))}
          />
        </Field>
        <Field label="Contractual rights / agreement terms" className="sm:col-span-2">
          <Textarea
            rows={2}
            value={d.contractualRights ?? ''}
            disabled={disabled}
            onChange={(e) => set('contractualRights', text(e.target.value))}
          />
        </Field>
        {answer('controlConclusion', 'Control (professional conclusion)')}
        {answer('jointControl', 'Joint control')}
        <Field label="Joint arrangement type">
          <Select
            value={d.jointArrangementIsOperation ? 'operation' : 'venture'}
            disabled={disabled || d.jointControl !== 'yes'}
            onChange={(e) => set('jointArrangementIsOperation', e.target.value === 'operation')}
          >
            <option value="venture">Joint venture</option>
            <option value="operation">Joint operation</option>
          </Select>
        </Field>
        {answer('significantInfluence', 'Significant influence')}
      </Group>

      <Group title="Perimeter (spec §8)">
        <Field label="Effective from">
          <Input
            type="date"
            value={d.effectiveFrom ?? ''}
            disabled={disabled}
            onChange={(e) => set('effectiveFrom', text(e.target.value))}
          />
        </Field>
        <Field label="Effective to">
          <Input
            type="date"
            value={d.effectiveTo ?? ''}
            disabled={disabled}
            onChange={(e) => set('effectiveTo', text(e.target.value))}
          />
        </Field>
        <Field label="Country (ISO code)">
          <Input
            value={d.country ?? ''}
            maxLength={2}
            disabled={disabled}
            onChange={(e) => set('country', text(e.target.value.toUpperCase()))}
          />
        </Field>
        <Field label="Indian company?">
          <Select
            value={triBool(d.isIndianCompany)}
            disabled={disabled}
            onChange={(e) => set('isIndianCompany', fromTri(e.target.value))}
          >
            <option value="">Not known</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </Field>
        <Field
          label="Include in the CFS?"
          hint={
            classification
              ? `System proposal: ${INCLUSION_LABEL[classification.systemIncluded]}`
              : undefined
          }
        >
          <Select
            value={d.included ?? ''}
            disabled={disabled}
            onChange={(e) => set('included', (e.target.value || null) as PerimeterInclusion | null)}
          >
            <option value="">Take the system proposal</option>
            <option value="yes">Include</option>
            <option value="no">Exclude</option>
            <option value="pending">Pending</option>
          </Select>
        </Field>
        <Field
          label="Inclusion reason"
          required={inclusionChanged}
          hint={
            inclusionChanged
              ? 'Required — the decision differs from the system proposal.'
              : undefined
          }
        >
          <Input
            value={d.inclusionReason ?? ''}
            disabled={disabled}
            onChange={(e) => set('inclusionReason', text(e.target.value))}
          />
        </Field>
      </Group>

      <Group title="Reporting date (CFS-03) and accounting framework (CFS-04)">
        <Field
          label="Component reporting date"
          hint={
            classification?.reportingDate?.groupDate
              ? `Group: ${classification.reportingDate.groupDate}`
              : undefined
          }
        >
          <Input
            type="date"
            value={d.reportingDate ?? ''}
            disabled={disabled}
            onChange={(e) => set('reportingDate', text(e.target.value))}
          />
        </Field>
        <Field label="Local accounting framework">
          <Select
            value={d.localFramework ?? ''}
            disabled={disabled}
            onChange={(e) =>
              set('localFramework', (e.target.value || null) as LocalFramework | null)
            }
          >
            <option value="">Not captured</option>
            {LOCAL_FRAMEWORKS.map((f) => (
              <option key={f} value={f}>
                {LOCAL_FRAMEWORK_LABEL[f]}
              </option>
            ))}
          </Select>
        </Field>
        {reportingDiffers && (
          <>
            <Field label="Why a different reporting date?" required>
              <Input
                value={d.reportingDateReason ?? ''}
                disabled={disabled}
                onChange={(e) => set('reportingDateReason', text(e.target.value))}
              />
            </Field>
            <Field label="Interim financial information">
              <Input
                value={d.interimInformation ?? ''}
                disabled={disabled}
                onChange={(e) => set('interimInformation', text(e.target.value))}
              />
            </Field>
            <Field label="Significant intervening transactions" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={d.interveningTransactions ?? ''}
                disabled={disabled}
                onChange={(e) => set('interveningTransactions', text(e.target.value))}
              />
            </Field>
          </>
        )}
        <Field
          label="Policy alignment"
          hint={
            classification?.policy
              ? `System: ${POLICY_ALIGNMENT_LABEL[classification.policy.systemResult]}`
              : undefined
          }
        >
          <Select
            value={d.policyAlignment ?? ''}
            disabled={disabled}
            onChange={(e) =>
              set('policyAlignment', (e.target.value || null) as PolicyAlignment | null)
            }
          >
            <option value="">Take the system result</option>
            {POLICY_ALIGNMENTS.map((p) => (
              <option key={p} value={p}>
                {POLICY_ALIGNMENT_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea
            rows={2}
            value={d.notes ?? ''}
            disabled={disabled}
            onChange={(e) => set('notes', text(e.target.value))}
          />
        </Field>
      </Group>

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !d.name.trim()} onClick={() => onSave(d)}>
            Save component
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setD(investee)}>
            Reset
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={onRemove}
            title="Remove from 02.6 (other modules withdraw their rows; nothing is deleted)"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
          </Button>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
