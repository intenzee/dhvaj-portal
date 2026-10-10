'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  AUDIT_TRAIL_CONCLUSION_LABEL,
  SOFTWARE_MODULES,
  SOFTWARE_MODULE_LABEL,
  type AuditTrailConclusion,
  type Rule11gResult,
  type SoftwareModule,
  type SoftwareSystemInput,
} from '@hsdg/contracts';
import { Badge, Button } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { TriSelect } from './other-reporting-ui';

/**
 * Rule 11(g) audit-trail register (spec §11): every accounting software /
 * module is assessed on its own — feature, enabled throughout the year,
 * transactions covered, ability to alter or disable, tampering, preservation
 * (retention from the Rules Library) — with a system-suggested conclusion. An
 * ICFR / ITGC deficiency or a proper-books issue is cross-referenced, never
 * copied. The whole register saves at once.
 */

const CONCLUSION_TONE: Record<AuditTrailConclusion, string> = {
  compliant: 'success',
  modified_reporting_expected: 'danger',
  further_work: 'warn',
  pending: 'neutral',
};

const BLANK: SoftwareSystemInput = {
  name: '',
  hasAuditTrailFeature: false,
  auditTrailOperatedAllYear: false,
  module: 'gl',
  featureStatus: 'pending',
  enabledThroughout: 'pending',
  transactionsCovered: 'pending',
  canAlterOrDisable: 'pending',
  tampering: 'pending',
  preservation: 'pending',
};

export function OtherReportingAuditTrail({
  systems,
  result,
  disabled,
  onSave,
}: {
  systems: SoftwareSystemInput[];
  result: Rule11gResult | undefined;
  disabled: boolean;
  onSave: (systems: SoftwareSystemInput[]) => void;
}): JSX.Element {
  const [rows, setRows] = useState<SoftwareSystemInput[]>(systems);
  const [open, setOpen] = useState<number | null>(null);
  const set = (i: number, patch: Partial<SoftwareSystemInput>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const names = rows.map((r) => r.name.trim().toLowerCase());
  const invalid = names.some((n) => !n) || new Set(names).size !== names.length;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink-muted">
        {result?.applicable
          ? `Rule 11(g) applies for this audit period (in force from ${result.effectiveFrom ?? '—'}). Audit-trail records must be preserved for ${result.retentionYears ?? '—'} years (Rules Library).`
          : 'Rule 11(g) does not apply for this audit period — the earlier Rule 11 version governs.'}
      </p>
      {result?.basis && <p className="text-xs text-ink-faint">{result.basis}</p>}

      <ul className="divide-y divide-line rounded-md border border-line">
        {rows.map((s, i) => {
          const r = result?.systems.find((x) => x.id === s.id) ?? result?.systems[i];
          return (
            <li key={s.id ?? `new-${i}`}>
              <button
                type="button"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
                className="group flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
              >
                <ExpandToggle open={open === i} />
                <span className="font-medium text-ink">{s.name || 'New system'}</span>
                {s.module && (
                  <span className="text-xs text-ink-faint">{SOFTWARE_MODULE_LABEL[s.module]}</span>
                )}
                {r && (
                  <Badge tone={CONCLUSION_TONE[r.conclusion]}>
                    {AUDIT_TRAIL_CONCLUSION_LABEL[r.conclusion]}
                  </Badge>
                )}
                {r && r.pendingFields.length > 0 && (
                  <span className="text-xs text-warning-700">{r.pendingFields.length} pending</span>
                )}
              </button>
              {open === i && (
                <div className="space-y-2 border-t border-line bg-surface-sunken px-3 py-3 pl-10">
                  {r?.exceptions.length ? (
                    <ul className="ml-5 list-disc text-danger-700" aria-label="Audit-trail exceptions">
                      {r.exceptions.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  ) : null}
                  {r && <p className="text-xs text-ink-muted">{r.basis}</p>}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Software / system name" required>
                      <Input
                        value={s.name}
                        disabled={disabled}
                        onChange={(e) => set(i, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Module">
                      <Select
                        value={s.module ?? 'gl'}
                        disabled={disabled}
                        onChange={(e) => set(i, { module: e.target.value as SoftwareModule })}
                      >
                        {SOFTWARE_MODULES.map((m) => (
                          <option key={m} value={m}>
                            {SOFTWARE_MODULE_LABEL[m]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Books of account affected">
                      <Input
                        value={s.booksAffected ?? ''}
                        disabled={disabled}
                        onChange={(e) => set(i, { booksAffected: e.target.value || null })}
                      />
                    </Field>
                    <Field label="Audit-trail feature">
                      <Select
                        value={s.featureStatus ?? 'pending'}
                        disabled={disabled}
                        onChange={(e) =>
                          set(i, {
                            featureStatus: e.target.value as SoftwareSystemInput['featureStatus'],
                          })
                        }
                      >
                        <option value="pending">Pending</option>
                        <option value="available">Available</option>
                        <option value="not_available">Not available</option>
                      </Select>
                    </Field>
                    <Field label="Enabled throughout the year">
                      <Select
                        value={s.enabledThroughout ?? 'pending'}
                        disabled={disabled}
                        onChange={(e) =>
                          set(i, {
                            enabledThroughout: e.target.value as SoftwareSystemInput['enabledThroughout'],
                          })
                        }
                      >
                        <option value="pending">Pending</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="exceptions">With exceptions</option>
                      </Select>
                    </Field>
                    <Field label="All relevant transactions covered">
                      <Select
                        value={s.transactionsCovered ?? 'pending'}
                        disabled={disabled}
                        onChange={(e) =>
                          set(i, {
                            transactionsCovered: e.target.value as SoftwareSystemInput['transactionsCovered'],
                          })
                        }
                      >
                        <option value="pending">Pending</option>
                        <option value="complete">Complete</option>
                        <option value="gaps">Gaps</option>
                      </Select>
                    </Field>
                    <Field label="Preservation (retention)">
                      <Select
                        value={s.preservation ?? 'pending'}
                        disabled={disabled}
                        onChange={(e) =>
                          set(i, {
                            preservation: e.target.value as SoftwareSystemInput['preservation'],
                          })
                        }
                      >
                        <option value="pending">Pending</option>
                        <option value="compliant">Compliant</option>
                        <option value="exception">Exception</option>
                      </Select>
                    </Field>
                    <Field label="Privileged / admin users">
                      <Input
                        value={s.privilegedUsers ?? ''}
                        disabled={disabled}
                        onChange={(e) => set(i, { privilegedUsers: e.target.value || null })}
                      />
                    </Field>
                  </div>
                  <TriSelect
                    label="Can users alter or disable the audit trail?"
                    value={s.canAlterOrDisable ?? 'pending'}
                    disabled={disabled}
                    onChange={(canAlterOrDisable) => set(i, { canAlterOrDisable })}
                  />
                  <TriSelect
                    label="Any instance of the audit trail being tampered with?"
                    value={s.tampering ?? 'pending'}
                    disabled={disabled}
                    onChange={(tampering) => set(i, { tampering })}
                  />
                  {(s.enabledThroughout === 'no' || s.enabledThroughout === 'exceptions') && (
                    <Field label="Enabled-period note">
                      <Input
                        value={s.enabledNote ?? ''}
                        disabled={disabled}
                        onChange={(e) => set(i, { enabledNote: e.target.value || null })}
                      />
                    </Field>
                  )}
                  <Field label="Evidence">
                    <Textarea
                      rows={2}
                      value={s.evidence ?? ''}
                      disabled={disabled}
                      onChange={(e) => set(i, { evidence: e.target.value || null })}
                    />
                  </Field>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="ICFR / ITGC deficiency cross-reference" hint="Linked, never copied">
                      <Input
                        value={s.icfrCrossRef ?? ''}
                        disabled={disabled}
                        onChange={(e) => set(i, { icfrCrossRef: e.target.value || null })}
                      />
                    </Field>
                    <label className="flex items-center gap-2 pt-6 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={!!s.booksCrossRef}
                        disabled={disabled}
                        onChange={(e) => set(i, { booksCrossRef: e.target.checked })}
                      />
                      Also bears on proper-books reporting (Section 143(3)(b))
                    </label>
                  </div>
                  <Field label="Conclusion" hint={r ? `System suggests: ${AUDIT_TRAIL_CONCLUSION_LABEL[r.suggestedConclusion]}` : undefined}>
                    <Select
                      value={s.conclusion ?? ''}
                      disabled={disabled}
                      onChange={(e) =>
                        set(i, {
                          conclusion: (e.target.value || undefined) as AuditTrailConclusion | undefined,
                        })
                      }
                    >
                      <option value="">Use the system suggestion</option>
                      {(Object.keys(AUDIT_TRAIL_CONCLUSION_LABEL) as AuditTrailConclusion[]).map((c) => (
                        <option key={c} value={c}>
                          {AUDIT_TRAIL_CONCLUSION_LABEL[c]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {!disabled && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setRows(rows.filter((_, j) => j !== i));
                        setOpen(null);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove system
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="px-3 py-2 text-ink-muted">
            No accounting software recorded — add each system or module used for the books.
          </li>
        )}
      </ul>

      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setRows([...rows, { ...BLANK }]);
              setOpen(rows.length);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add system
          </Button>
          <Button size="sm" disabled={invalid} onClick={() => onSave(rows)}>
            Save register
          </Button>
          {invalid && (
            <span className="self-center text-xs text-warning-700">
              Name every system once.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
