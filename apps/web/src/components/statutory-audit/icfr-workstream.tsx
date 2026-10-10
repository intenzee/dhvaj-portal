'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ExternalLink, Link2, Plus } from 'lucide-react';
import {
  ICFR_ACTIVATION_LABEL,
  ICFR_CONTROL_FREQUENCIES,
  ICFR_CONTROL_FREQUENCY_LABEL,
  ICFR_CONTROL_NATURE_LABEL,
  ICFR_CONTROL_NATURES,
  ICFR_CONTROL_OVERALL_LABEL,
  ICFR_CONTROL_REVIEW_STATE_LABEL,
  ICFR_DEFICIENCY_CLASS_LABEL,
  ICFR_DEFICIENCY_CLASSES,
  ICFR_DESIGN_LABEL,
  ICFR_FOLLOWUP_STATUS_LABEL,
  ICFR_FOLLOWUP_STATUSES,
  ICFR_IMPLEMENTATION_LABEL,
  ICFR_LIKELIHOOD_LABEL,
  ICFR_LIKELIHOODS,
  ICFR_MAGNITUDE_LABEL,
  ICFR_MAGNITUDES,
  ICFR_OPERATING_LABEL,
  ICFR_REMEDIATION_STATUS_LABEL,
  ICFR_REMEDIATION_STATUSES,
  ICFR_REPORTING_IMPACT_LABEL,
  ICFR_REPORTING_IMPACTS,
  ICFR_SCOPING_LABEL,
  ICFR_SCOPINGS,
  ICFR_WORKSTREAM_CONCLUSION_LABEL,
  ICFR_WORKSTREAM_CONCLUSIONS,
  ICFR_WORKSTREAM_STATE_LABEL,
  PERMISSION,
  RISK_ASSERTION,
  type IcfrControl,
  type IcfrPriorControl,
  type IcfrControlOverall,
  type IcfrDeficiency,
  type IcfrDeficiencyClass,
  type IcfrFollowUp,
  type IcfrFollowUpStatus,
  type IcfrProcessArea,
  type IcfrScoping,
  type IcfrWorkstreamConclusion,
  type RiskAssertion,
  type StatutoryAuditIcfrWorkstream,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, humanize } from '@/lib/format';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { DocumentPreview } from '@/components/document-preview';
import { LinkPicker } from './acceptance-file-card';

/**
 * Section 05 ICFR workstream (DHVAJ 02.5 spec §13–§16, §19). Configured by the
 * server from the versioned process-area framework once 02.5 finds section
 * 143(3)(i) reporting applies — the team never builds it by hand. Process
 * areas carry the facts' scoping suggestion and its basis (a team decision
 * stays); one control register serves the FS audit and ICFR, with design,
 * implementation and operating effectiveness concluded separately; the
 * deficiency register applies the DHVAJ methodology (the professional
 * classifies; MW / SD need the Engagement Partner); prior-year deficiencies are
 * followed up; the Engagement Partner concludes. Withdrawn (never deleted) when
 * reporting is concluded exempt.
 */

type View = StatutoryAuditIcfrWorkstream;
type Act = (fn: () => Promise<View>, ok?: string) => Promise<boolean>;

const OVERALL_TONE: Record<IcfrControlOverall, string> = {
  not_assessed: 'neutral',
  in_progress: 'neutral',
  effective: 'success',
  design_implementation_only: 'info',
  design_deficiency: 'danger',
  not_implemented: 'danger',
  operating_exception: 'danger',
};
const CLASS_TONE: Record<IcfrDeficiencyClass, string> = {
  control_deficiency: 'warn',
  significant_deficiency: 'danger',
  material_weakness: 'danger',
};
const SCOPING_TONE: Record<IcfrScoping, string> = {
  in_scope: 'info',
  not_in_scope: 'neutral',
  to_be_scoped: 'warn',
};
const ASSERTIONS = Object.values(RISK_ASSERTION);
const blank = (v: string | null | undefined) => !v || !v.trim();
const orNull = (v: string) => (v.trim() ? v.trim() : null);

export function IcfrWorkstream({
  engagementId,
  workflowInstanceId,
  canManage = true,
}: {
  engagementId: string;
  workflowInstanceId: string;
  /** The host's own edit gate (e.g. an approved Section 02); the server decides too. */
  canManage?: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/icfr`;
  const key = ['engagement', engagementId, 'icfr-workstream', workflowInstanceId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<View>(`${base}/workstream`),
  });
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Spinner label="Loading the ICFR workstream…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the ICFR workstream.'}
      </p>
    );
  }
  const view = q.data;
  const active = view.state === 'active';
  const editable = canManage && !view.readOnly && can(principal, PERMISSION.engagementManage);
  const act: Act = async (fn, ok) => {
    setBusy(true);
    try {
      qc.setQueryData(key, await fn());
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'icfr'] });
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update the ICFR workstream.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const send = (path: string, method: 'POST' | 'PATCH', body: object) =>
    apiFetch<View>(`${base}/${path}`, { method, body });
  const s = view.summary;
  const ctx: Ctx = { view, engagementId, editable, active, busy, act, send };

  return (
    <section className="space-y-3" aria-label="ICFR workstream">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-ink">ICFR workstream (Section 05)</h4>
        <Badge tone={active ? 'info' : view.state === 'withdrawn' ? 'warn' : 'neutral'}>
          {ICFR_WORKSTREAM_STATE_LABEL[view.state]}
        </Badge>
        {view.workstream?.conclusion && (
          <Badge tone={view.workstream.conclusion === 'unmodified' ? 'success' : 'danger'}>
            {ICFR_WORKSTREAM_CONCLUSION_LABEL[view.workstream.conclusion]}
          </Badge>
        )}
      </div>
      <p className="text-xs text-ink-muted">{view.reason}</p>
      {view.workstream && (
        <p className="text-xs text-ink-faint">
          {view.workstream.frameworkLabel} · resolved for the period from{' '}
          {formatDate(view.workstream.periodStart)} · configured{' '}
          {formatDate(view.workstream.createdAt)}
          {view.workstream.withdrawnAt
            ? ` · withdrawn ${formatDate(view.workstream.withdrawnAt)}`
            : ''}
        </p>
      )}
      {(view.workstream || view.controls.length > 0) && (
        <div className="flex flex-wrap gap-1.5 text-xs" aria-label="Workstream summary">
          {view.workstream && (
            <>
              <Badge tone="info">{s.processAreas.inScope} areas in scope</Badge>
              {s.processAreas.toBeScoped > 0 && (
                <Badge tone="warn">{s.processAreas.toBeScoped} to be scoped</Badge>
              )}
            </>
          )}
          <Badge>{s.controls.total} controls</Badge>
          <Badge tone="info">{s.controls.icfr} relied on for ICFR</Badge>
          <Badge tone="success">{s.controls.effective} effective</Badge>
          {s.controls.deficient > 0 && (
            <Badge tone="danger">{s.controls.deficient} deficient</Badge>
          )}
          {s.controls.awaitingReview > 0 && (
            <Badge tone="warn">{s.controls.awaitingReview} awaiting review</Badge>
          )}
          {s.deficiencies.materialWeaknesses > 0 && (
            <Badge tone="danger">{s.deficiencies.materialWeaknesses} material weakness</Badge>
          )}
          {s.deficiencies.significantDeficiencies > 0 && (
            <Badge tone="danger">
              {s.deficiencies.significantDeficiencies} significant deficiency
            </Badge>
          )}
          {s.followUps.open > 0 && <Badge tone="warn">{s.followUps.open} follow-ups open</Badge>}
        </div>
      )}

      {view.priorYear && <PriorYear view={view} />}
      {view.followUps.length > 0 && <FollowUps ctx={ctx} />}
      {view.processAreas.length > 0 && <ProcessAreas ctx={ctx} />}
      {(view.workstream || view.controls.length > 0 || editable) && <Controls ctx={ctx} />}
      {(view.deficiencies.length > 0 || (editable && view.controls.length > 0)) && (
        <Deficiencies ctx={ctx} />
      )}
      {view.workstream && <Conclusion ctx={ctx} />}
    </section>
  );
}

interface Ctx {
  view: View;
  engagementId: string;
  editable: boolean;
  active: boolean;
  busy: boolean;
  act: Act;
  send: (path: string, method: 'POST' | 'PATCH', body: object) => Promise<View>;
}

function Toggle({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className="text-ink-faint hover:text-ink"
      aria-expanded={open}
      aria-label={label}
      onClick={onClick}
    >
      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  );
}

function Blockers({ items, label }: { items: string[]; label: string }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-warning-100 bg-warning-50/60 px-3 py-2 text-xs">
      <p className="font-medium text-ink">{label}</p>
      <ul className="mt-1 list-disc pl-4 text-ink-muted">
        {items.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

function AssertionPicker({
  value,
  onChange,
  disabled,
}: {
  value: RiskAssertion[];
  onChange: (v: RiskAssertion[]) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <fieldset className="flex flex-wrap gap-x-3 gap-y-1 text-xs" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-ink">Assertions</legend>
      {ASSERTIONS.map((a) => (
        <label key={a} className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={value.includes(a)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, a] : value.filter((x) => x !== a))
            }
          />
          {humanize(a)}
        </label>
      ))}
    </fieldset>
  );
}

// ── Prior year (§19) ─────────────────────────────────────────────────────────

function PriorYear({ view }: { view: View }): JSX.Element {
  const p = view.priorYear!;
  const list = [...p.materialWeaknesses, ...p.significantDeficiencies];
  return (
    <div className="rounded-md border border-line bg-surface-sunken/40 px-3 py-2 text-xs">
      <p className="font-medium text-ink">
        FY {p.financialYear} — {p.applicability ? humanize(p.applicability) : 'not assessed'}
        {p.workstreamConclusion
          ? ` · ${ICFR_WORKSTREAM_CONCLUSION_LABEL[p.workstreamConclusion]}`
          : ''}
      </p>
      <p className="text-ink-faint">
        Planning context only — last year&apos;s control conclusions are never rolled forward.
      </p>
      {list.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-ink-muted">
          {list.map((d) => (
            <li key={d.ref}>
              {d.ref} {d.description} — {humanize(d.remediationStatus)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FollowUps({ ctx }: { ctx: Ctx }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <h5 className="text-xs font-semibold text-ink">Prior-year deficiency follow-up</h5>
      <ul className="divide-y divide-line rounded-md border border-line">
        {ctx.view.followUps.map((f) => (
          <FollowUpRow key={f.id} f={f} ctx={ctx} />
        ))}
      </ul>
    </div>
  );
}

function FollowUpRow({ f, ctx }: { f: IcfrFollowUp; ctx: Ctx }): JSX.Element {
  const [status, setStatus] = useState<IcfrFollowUpStatus>(f.status);
  const [note, setNote] = useState(f.conclusionNote ?? '');
  const editable = ctx.editable && ctx.active;
  return (
    <li className="space-y-1.5 px-3 py-2 text-xs" aria-label={`Follow-up ${f.priorRef}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">
          FY {f.priorFinancialYear} {f.priorRef}
        </span>
        <Badge tone={CLASS_TONE[f.priorClassification]}>
          {ICFR_DEFICIENCY_CLASS_LABEL[f.priorClassification]}
        </Badge>
        <Badge tone={f.status === 'open' ? 'warn' : f.status === 'persists' ? 'danger' : 'success'}>
          {ICFR_FOLLOWUP_STATUS_LABEL[f.status]}
        </Badge>
        {f.deficiencyRef && <Badge>Raised as {f.deficiencyRef}</Badge>}
      </div>
      <p className="text-ink-muted">
        {f.priorDescription}
        {f.priorProcess ? ` (${f.priorProcess})` : ''}
        {f.priorRemediationAction ? ` — remediation: ${f.priorRemediationAction}` : ''}
      </p>
      {f.concludedAt && (
        <p className="text-ink-faint">
          {f.conclusionNote} — {f.concludedByName ?? 'concluded'} {formatDate(f.concludedAt)}
        </p>
      )}
      {editable && (
        <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <Field label="This year">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as IcfrFollowUpStatus)}
            >
              {ICFR_FOLLOWUP_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {ICFR_FOLLOWUP_STATUS_LABEL[x]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What the follow-up found">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={ctx.busy || (status === f.status && note === (f.conclusionNote ?? ''))}
            onClick={() =>
              void ctx.act(
                () =>
                  ctx.send(`follow-ups/${f.id}`, 'PATCH', {
                    status,
                    conclusionNote: orNull(note),
                    version: f.version,
                  }),
                'Follow-up saved.',
              )
            }
          >
            Save
          </Button>
        </div>
      )}
    </li>
  );
}

// ── Process areas (§13) ──────────────────────────────────────────────────────

function ProcessAreas({ ctx }: { ctx: Ctx }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-1.5">
      <h5 className="text-xs font-semibold text-ink">Process areas</h5>
      <ul className="divide-y divide-line rounded-md border border-line">
        {ctx.view.processAreas.map((a) => (
          <AreaRow key={a.id} a={a} ctx={ctx} />
        ))}
      </ul>
      {ctx.editable && ctx.active && (
        <>
          <Button size="sm" variant="secondary" onClick={() => setAdding((o) => !o)}>
            <Plus className="h-3.5 w-3.5" /> Add another significant process
          </Button>
          {adding && (
            <div className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-2">
              <Field label="Process" required>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Why it is significant" required>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  disabled={ctx.busy || blank(title) || blank(reason)}
                  onClick={async () => {
                    const ok = await ctx.act(
                      () =>
                        ctx.send('process-areas', 'POST', {
                          title: title.trim(),
                          scopingReason: reason.trim(),
                        }),
                      'Process added in scope.',
                    );
                    if (ok) {
                      setAdding(false);
                      setTitle('');
                      setReason('');
                    }
                  }}
                >
                  Add process
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AreaRow({ a, ctx }: { a: IcfrProcessArea; ctx: Ctx }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [scoping, setScoping] = useState<IcfrScoping>(a.scoping);
  const [reason, setReason] = useState(a.scopingReason ?? '');
  const editable = ctx.editable && ctx.active && !a.withdrawn;
  return (
    <li className="px-3 py-2 text-xs" aria-label={`Process area ${a.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Toggle open={open} onClick={() => setOpen((o) => !o)} label={`Expand ${a.title}`} />
        <span className="font-medium text-ink">{a.title}</span>
        <Badge tone={SCOPING_TONE[a.scoping]}>{ICFR_SCOPING_LABEL[a.scoping]}</Badge>
        {a.scopingSource === 'team' && a.suggestedScoping !== a.scoping && (
          <Badge tone="warn">Facts suggest {ICFR_SCOPING_LABEL[a.suggestedScoping]}</Badge>
        )}
        <span className="text-ink-faint">
          {a.keyIcfrControls} key ICFR control{a.keyIcfrControls === 1 ? '' : 's'} · {a.controls}{' '}
          total
          {a.openDeficiencies > 0 ? ` · ${a.openDeficiencies} open deficiencies` : ''}
        </span>
      </div>
      {open && (
        <div className="mt-2 space-y-2 pl-6">
          {a.description && <p className="text-ink-muted">{a.description}</p>}
          <p className="text-ink-faint">
            {ICFR_ACTIVATION_LABEL[a.activation]}
            {a.source === 'manual' ? ' · added by the team' : ''}
          </p>
          {a.systemBasis && (
            <p className="text-ink-muted">
              <span className="font-medium text-ink">Suggested:</span>{' '}
              {ICFR_SCOPING_LABEL[a.suggestedScoping]} — {a.systemBasis}
            </p>
          )}
          {a.scopingSource === 'team' && (
            <p className="text-ink-muted">
              <span className="font-medium text-ink">Team decision:</span> {a.scopingReason}
              {a.scopedByName ? ` — ${a.scopedByName}` : ''}
              {a.scopedAt ? ` ${formatDate(a.scopedAt)}` : ''}
            </p>
          )}
          {a.procedures.length > 0 && (
            <div>
              <p className="font-medium text-ink">Section 06 procedures</p>
              <ul className="list-disc pl-4 text-ink-muted">
                {a.procedures.map((p) => (
                  <li key={p.key}>
                    {p.title} — {p.objective}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {editable && (
            <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
              <Field label="Scoping">
                <Select value={scoping} onChange={(e) => setScoping(e.target.value as IcfrScoping)}>
                  {ICFR_SCOPINGS.map((x) => (
                    <option key={x} value={x}>
                      {ICFR_SCOPING_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Button
                size="sm"
                disabled={ctx.busy || (scoping === a.scoping && reason === (a.scopingReason ?? ''))}
                onClick={() =>
                  void ctx.act(
                    () =>
                      ctx.send(`process-areas/${a.id}`, 'PATCH', {
                        scoping,
                        scopingReason: orNull(reason),
                        version: a.version,
                      }),
                    'Scoping saved.',
                  )
                }
              >
                Save scoping
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ── Controls (§14, §15) ──────────────────────────────────────────────────────

function Controls({ ctx }: { ctx: Ctx }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const live = ctx.view.controls.filter((c) => !c.withdrawn);
  const withdrawn = ctx.view.controls.filter((c) => c.withdrawn);
  return (
    <div className="space-y-1.5">
      <h5 className="text-xs font-semibold text-ink">Control register</h5>
      <p className="text-[11px] text-ink-faint">
        One record per control — relied on for the FS audit, ICFR or both. Design, implementation
        and operating effectiveness are concluded separately.
      </p>
      {live.length === 0 ? (
        <p className="text-xs text-ink-faint">No controls recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {live.map((c) => (
            <ControlRow key={c.id} c={c} ctx={ctx} />
          ))}
        </ul>
      )}
      {withdrawn.length > 0 && (
        <p className="text-[11px] text-ink-faint">
          Withdrawn: {withdrawn.map((c) => c.controlRef).join(', ')}
        </p>
      )}
      {ctx.editable && (
        <>
          <Button size="sm" variant="secondary" onClick={() => setAdding((o) => !o)}>
            <Plus className="h-3.5 w-3.5" /> Add control
          </Button>
          {adding && <NewControl ctx={ctx} onDone={() => setAdding(false)} />}
        </>
      )}
    </div>
  );
}

interface ControlDraft {
  processAreaId: string;
  process: string;
  description: string;
  purposeFsAudit: boolean;
  purposeIcfr: boolean;
  assertions: RiskAssertion[];
  relatedRiskId: string;
  nature: string;
  frequency: string;
  isKey: boolean;
  owner: string;
}
const draftOf = (c?: IcfrControl): ControlDraft => ({
  processAreaId: c?.processAreaId ?? '',
  process: c?.processAreaId ? '' : (c?.process ?? ''),
  description: c?.description ?? '',
  purposeFsAudit: c?.purposeFsAudit ?? true,
  purposeIcfr: c?.purposeIcfr ?? false,
  assertions: c?.assertions ?? [],
  relatedRiskId: c?.relatedRiskId ?? '',
  nature: c?.nature ?? '',
  frequency: c?.frequency ?? '',
  isKey: c?.isKey ?? true,
  owner: c?.owner ?? '',
});
const controlBody = (d: ControlDraft) => ({
  processAreaId: d.processAreaId || null,
  ...(d.processAreaId ? {} : { process: d.process.trim() }),
  description: d.description.trim(),
  purposeFsAudit: d.purposeFsAudit,
  purposeIcfr: d.purposeIcfr,
  assertions: d.assertions,
  relatedRiskId: d.relatedRiskId || null,
  nature: d.nature || null,
  frequency: d.frequency || null,
  isKey: d.isKey,
  owner: orNull(d.owner),
});

function ControlFields({
  d,
  set,
  ctx,
}: {
  d: ControlDraft;
  set: (p: Partial<ControlDraft>) => void;
  ctx: Ctx;
}): JSX.Element {
  const areas = ctx.view.processAreas.filter((a) => !a.withdrawn);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="Process area">
        <Select value={d.processAreaId} onChange={(e) => set({ processAreaId: e.target.value })}>
          <option value="">— Not in the ICFR framework —</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </Select>
      </Field>
      {!d.processAreaId && (
        <Field label="Process" required>
          <Input value={d.process} onChange={(e) => set({ process: e.target.value })} />
        </Field>
      )}
      <div className="sm:col-span-2">
        <Field label="Control description" required>
          <Textarea value={d.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
      </div>
      <fieldset className="flex flex-wrap items-center gap-3 text-xs sm:col-span-2">
        <legend className="mb-1 text-sm font-medium text-ink">Relied on for</legend>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={d.purposeFsAudit}
            onChange={(e) => set({ purposeFsAudit: e.target.checked })}
          />
          FS audit
        </label>
        <label
          className="inline-flex items-center gap-1"
          title={ctx.active ? undefined : 'Section 143(3)(i) reporting does not apply'}
        >
          <input
            type="checkbox"
            checked={d.purposeIcfr}
            disabled={!ctx.active && !d.purposeIcfr}
            onChange={(e) => set({ purposeIcfr: e.target.checked })}
          />
          ICFR (section 143(3)(i))
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={d.isKey}
            onChange={(e) => set({ isKey: e.target.checked })}
          />
          Key control
        </label>
      </fieldset>
      <div className="sm:col-span-2">
        <AssertionPicker value={d.assertions} onChange={(assertions) => set({ assertions })} />
      </div>
      <Field label="Related risk (Section 04)">
        <Select value={d.relatedRiskId} onChange={(e) => set({ relatedRiskId: e.target.value })}>
          <option value="">—</option>
          {ctx.view.risks.map((r) => (
            <option key={r.id} value={r.id}>
              {r.ref} {r.description}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Owner">
        <Input value={d.owner} onChange={(e) => set({ owner: e.target.value })} />
      </Field>
      <Field label="Nature">
        <Select value={d.nature} onChange={(e) => set({ nature: e.target.value })}>
          <option value="">—</option>
          {ICFR_CONTROL_NATURES.map((n) => (
            <option key={n} value={n}>
              {ICFR_CONTROL_NATURE_LABEL[n]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Frequency">
        <Select value={d.frequency} onChange={(e) => set({ frequency: e.target.value })}>
          <option value="">—</option>
          {ICFR_CONTROL_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {ICFR_CONTROL_FREQUENCY_LABEL[f]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

function NewControl({ ctx, onDone }: { ctx: Ctx; onDone: () => void }): JSX.Element {
  const [d, setD] = useState<ControlDraft>(() => ({ ...draftOf(), purposeIcfr: ctx.active }));
  const set = (p: Partial<ControlDraft>) => setD((x) => ({ ...x, ...p }));
  return (
    <div className="space-y-2 rounded-md border border-line p-2" aria-label="New control">
      <ControlFields d={d} set={set} ctx={ctx} />
      <Button
        size="sm"
        disabled={
          ctx.busy ||
          blank(d.description) ||
          (!d.processAreaId && blank(d.process)) ||
          (!d.purposeFsAudit && !d.purposeIcfr)
        }
        onClick={async () => {
          if (await ctx.act(() => ctx.send('controls', 'POST', controlBody(d)), 'Control added.'))
            onDone();
        }}
      >
        Add control
      </Button>
    </div>
  );
}

function ControlRow({ c, ctx }: { c: IcfrControl; ctx: Ctx }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2 text-xs" aria-label={`Control ${c.controlRef}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Toggle open={open} onClick={() => setOpen((o) => !o)} label={`Expand ${c.controlRef}`} />
        <span className="font-medium text-ink">{c.controlRef}</span>
        <span className="min-w-0 flex-1 truncate text-ink-muted">
          {c.process} — {c.description}
        </span>
        {c.purposeFsAudit && <Badge>FS audit</Badge>}
        {c.purposeIcfr && <Badge tone="info">ICFR</Badge>}
        {c.isKey && <Badge>Key</Badge>}
        <Badge tone={OVERALL_TONE[c.overall]}>{ICFR_CONTROL_OVERALL_LABEL[c.overall]}</Badge>
        <Badge
          tone={
            c.reviewState === 'reviewed'
              ? 'success'
              : c.reviewState === 'returned'
                ? 'warn'
                : 'neutral'
          }
        >
          {ICFR_CONTROL_REVIEW_STATE_LABEL[c.reviewState]}
        </Badge>
      </div>
      {open && <ControlDetail c={c} ctx={ctx} />}
    </li>
  );
}

function ControlDetail({ c, ctx }: { c: IcfrControl; ctx: Ctx }): JSX.Element {
  const locked = c.reviewState === 'submitted' || c.reviewState === 'reviewed';
  const editable = ctx.editable && !c.withdrawn;
  const [d, setD] = useState<ControlDraft>(() => draftOf(c));
  const set = (p: Partial<ControlDraft>) => setD((x) => ({ ...x, ...p }));
  const [design, setDesign] = useState(c.design ?? '');
  const [impl, setImpl] = useState(c.implementation ?? '');
  const [oe, setOe] = useState(c.operatingEffectiveness ?? '');
  const [testNote, setTestNote] = useState(c.testNote ?? '');
  const [returnNote, setReturnNote] = useState('');
  const review = (action: 'submit' | 'review' | 'return' | 'reopen', note?: string) =>
    ctx.act(
      () => ctx.send(`controls/${c.id}/review`, 'POST', { action, note, version: c.version }),
      action === 'submit'
        ? 'Submitted for review.'
        : action === 'review'
          ? 'Control reviewed.'
          : action === 'return'
            ? 'Returned to the preparer.'
            : 'Control reopened.',
    );
  return (
    <div className="mt-2 space-y-3 pl-6">
      {c.relatedRiskRef && (
        <p className="text-ink-muted">
          Related risk: {c.relatedRiskRef} {c.relatedRisk ?? ''}
        </p>
      )}
      {c.procedureRef && <p className="text-ink-muted">Section 06 procedure: {c.procedureRef}</p>}
      {c.priorYear && <PriorControl p={c.priorYear} controlRef={c.controlRef} />}

      {editable && !locked && (
        <div className="space-y-2">
          <ControlFields d={d} set={set} ctx={ctx} />
          <Button
            size="sm"
            variant="secondary"
            disabled={ctx.busy || blank(d.description)}
            onClick={() =>
              void ctx.act(
                () =>
                  ctx.send(`controls/${c.id}`, 'PATCH', {
                    ...controlBody(d),
                    ...(d.processAreaId ? {} : { process: d.process.trim() || c.process }),
                    version: c.version,
                  }),
                'Control saved.',
              )
            }
          >
            Save control
          </Button>
        </div>
      )}

      <div className="space-y-2" aria-label={`${c.controlRef} conclusions`}>
        <p className="font-medium text-ink">Conclusions</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Design">
            <Select
              value={design}
              disabled={!editable || locked}
              onChange={(e) => setDesign(e.target.value)}
            >
              <option value="">—</option>
              {Object.entries(ICFR_DESIGN_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Implementation">
            <Select
              value={impl}
              disabled={!editable || locked}
              onChange={(e) => setImpl(e.target.value)}
            >
              <option value="">—</option>
              {Object.entries(ICFR_IMPLEMENTATION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Operating effectiveness">
            <Select
              value={oe}
              disabled={!editable || locked}
              onChange={(e) => setOe(e.target.value)}
            >
              <option value="">—</option>
              {Object.entries(ICFR_OPERATING_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Test note">
          <Textarea
            value={testNote}
            disabled={!editable || locked}
            onChange={(e) => setTestNote(e.target.value)}
          />
        </Field>
        {editable && !locked && (
          <Button
            size="sm"
            variant="secondary"
            disabled={ctx.busy}
            onClick={() =>
              void ctx.act(
                () =>
                  ctx.send(`controls/${c.id}`, 'PATCH', {
                    design: design || null,
                    implementation: impl || null,
                    operatingEffectiveness: oe || null,
                    testNote: orNull(testNote),
                    version: c.version,
                  }),
                'Conclusions saved.',
              )
            }
          >
            Save conclusions
          </Button>
        )}
      </div>

      <ControlEvidence c={c} ctx={ctx} editable={editable && !locked} />

      {c.deficiencies.length > 0 && (
        <p className="text-ink-muted">Deficiencies: {c.deficiencies.join(', ')}</p>
      )}
      {c.returnNote && c.reviewState === 'returned' && (
        <p className="text-warning-700">Returned: {c.returnNote}</p>
      )}
      {c.submittedAt && (
        <p className="text-ink-faint">
          Submitted by {c.submittedByName ?? '—'} {formatDate(c.submittedAt)}
          {c.reviewedAt
            ? ` · reviewed by ${c.reviewedByName ?? '—'} ${formatDate(c.reviewedAt)}`
            : ''}
        </p>
      )}
      <Blockers items={c.blockers} label="Before this control can be submitted" />

      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          {(c.reviewState === 'open' || c.reviewState === 'returned') && (
            <Button
              size="sm"
              disabled={ctx.busy || c.blockers.length > 0}
              onClick={() => void review('submit')}
            >
              Submit for review
            </Button>
          )}
          {c.reviewState === 'submitted' && (
            <>
              <Button size="sm" disabled={ctx.busy} onClick={() => void review('review')}>
                Mark reviewed
              </Button>
              <Input
                className="max-w-xs"
                placeholder="What needs to change"
                aria-label="Return note"
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={ctx.busy || blank(returnNote)}
                onClick={() => void review('return', returnNote.trim())}
              >
                Return
              </Button>
            </>
          )}
          {c.reviewState === 'reviewed' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={ctx.busy}
              onClick={() => void review('reopen')}
            >
              Reopen
            </Button>
          )}
          {!locked && (
            <Button
              size="sm"
              variant="ghost"
              disabled={ctx.busy}
              onClick={() =>
                void ctx.act(
                  () =>
                    ctx.send(`controls/${c.id}`, 'PATCH', { withdrawn: true, version: c.version }),
                  'Control withdrawn.',
                )
              }
            >
              Withdraw
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Last year's result and evidence for the same control — context only (§19). */
function PriorControl({ p, controlRef }: { p: IcfrPriorControl; controlRef: string }): JSX.Element {
  const toast = useToast();
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const openDoc = async (documentId: string) => {
    try {
      setDoc(await apiFetch<DocumentRow>(`/engagements/${p.engagementId}/documents/${documentId}`));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not open the prior-year document.', 'error');
    }
  };
  return (
    <div className="text-ink-faint" aria-label={`${controlRef} prior year`}>
      <p>
        FY {p.financialYear}:{' '}
        {[
          p.design && ICFR_DESIGN_LABEL[p.design],
          p.implementation && ICFR_IMPLEMENTATION_LABEL[p.implementation],
          p.operatingEffectiveness && ICFR_OPERATING_LABEL[p.operatingEffectiveness],
        ]
          .filter(Boolean)
          .join(' · ') || 'not concluded'}{' '}
        — context only; this year is tested afresh.
      </p>
      {p.evidence.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2">
          <span>Prior-year evidence (cross-reference only, not this year’s evidence):</span>
          {p.evidence.map((e, i) =>
            e.documentId ? (
              <button
                key={`${e.documentId}-${i}`}
                type="button"
                className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                onClick={() => void openDoc(e.documentId!)}
              >
                {e.title} <ExternalLink className="h-3 w-3" />
              </button>
            ) : (
              <span key={i}>{e.title}</span>
            ),
          )}
        </p>
      )}
      {doc && (
        <DocumentPreview
          engagementId={p.engagementId}
          doc={doc}
          canEdit={false}
          onClose={() => setDoc(null)}
        />
      )}
    </div>
  );
}

function ControlEvidence({
  c,
  ctx,
  editable,
}: {
  c: IcfrControl;
  ctx: Ctx;
  editable: boolean;
}): JSX.Element {
  const toast = useToast();
  const [linking, setLinking] = useState(false);
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const openDoc = async (documentId: string) => {
    try {
      setDoc(
        await apiFetch<DocumentRow>(`/engagements/${ctx.engagementId}/documents/${documentId}`),
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not open the document.', 'error');
    }
  };
  return (
    <div aria-label={`${c.controlRef} evidence`}>
      <p className="font-medium text-ink">Evidence</p>
      {c.evidence.length === 0 ? (
        <p className="text-ink-faint">
          No evidence linked. Link the file already on the engagement — no second upload.
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {c.evidence.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              {e.documentId ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                  onClick={() => void openDoc(e.documentId!)}
                >
                  {e.title} <ExternalLink className="h-3 w-3" />
                </button>
              ) : (
                <span className="text-ink">{e.title}</span>
              )}
              {e.auditEvidenceId && <Badge>Section 06 evidence</Badge>}
              {e.alsoSupports.length > 0 && (
                <span className="text-ink-faint">also supports {e.alsoSupports.join(', ')}</span>
              )}
              <span className="text-ink-faint">
                linked {formatDate(e.linkedAt)}
                {e.linkedByName ? ` by ${e.linkedByName}` : ''}
              </span>
              {editable && (
                <button
                  type="button"
                  className="text-ink-faint hover:text-danger-700"
                  disabled={ctx.busy}
                  onClick={() =>
                    void ctx.act(() =>
                      ctx.send(`controls/${c.id}/evidence/${e.id}/unlink`, 'POST', {}),
                    )
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-1"
          aria-expanded={linking}
          onClick={() => setLinking((o) => !o)}
        >
          <Link2 className="h-3.5 w-3.5" /> Link Existing File
        </Button>
      )}
      {editable && linking && (
        <LinkPicker
          engagementId={ctx.engagementId}
          exclude={c.evidence.map((e) => e.documentId).filter((d): d is string => !!d)}
          onPick={async (documentId) => {
            if (await ctx.act(() => ctx.send(`controls/${c.id}/evidence`, 'POST', { documentId })))
              setLinking(false);
          }}
        />
      )}
      {doc && (
        <DocumentPreview
          engagementId={ctx.engagementId}
          doc={doc}
          canEdit={false}
          onClose={() => setDoc(null)}
        />
      )}
    </div>
  );
}

// ── Deficiencies (§16) ───────────────────────────────────────────────────────

function Deficiencies({ ctx }: { ctx: Ctx }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState(false);
  const live = ctx.view.deficiencies.filter((d) => !d.withdrawn);
  const m = ctx.view.methodology;
  return (
    <div className="space-y-1.5">
      <h5 className="text-xs font-semibold text-ink">Deficiency register</h5>
      {live.length === 0 ? (
        <p className="text-xs text-ink-faint">No deficiencies recorded.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {live.map((d) => (
            <DeficiencyRow key={d.id} d={d} ctx={ctx} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {ctx.editable && (
          <Button size="sm" variant="secondary" onClick={() => setAdding((o) => !o)}>
            <Plus className="h-3.5 w-3.5" /> Raise deficiency
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={method}
          onClick={() => setMethod((o) => !o)}
        >
          Classification methodology
        </Button>
      </div>
      {method && (
        <div className="rounded-md border border-line px-3 py-2 text-xs" aria-label="Methodology">
          <p className="text-ink-muted">{m.basis}</p>
          <table className="mt-1 w-full text-left">
            <thead>
              <tr className="text-ink-faint">
                <th className="font-medium">Magnitude</th>
                {ICFR_LIKELIHOODS.map((l) => (
                  <th key={l} className="font-medium">
                    {ICFR_LIKELIHOOD_LABEL[l]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ICFR_MAGNITUDES.map((mag) => (
                <tr key={mag}>
                  <td className="text-ink">{ICFR_MAGNITUDE_LABEL[mag]}</td>
                  {ICFR_LIKELIHOODS.map((l) => {
                    const cls = m.matrix.find(
                      (x) => x.magnitude === mag && x.likelihood === l,
                    )?.classification;
                    return (
                      <td key={l} className="text-ink-muted">
                        {cls ? ICFR_DEFICIENCY_CLASS_LABEL[cls] : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-ink-faint">
            The Engagement Partner concludes on{' '}
            {m.partnerConclusionFor.map((c) => ICFR_DEFICIENCY_CLASS_LABEL[c]).join(' and ')}.
          </p>
        </div>
      )}
      {adding && <NewDeficiency ctx={ctx} onDone={() => setAdding(false)} />}
    </div>
  );
}

interface DeficiencyDraft {
  classification: IcfrDeficiencyClass;
  description: string;
  controlId: string;
  processAreaId: string;
  workAreaKey: string;
  affectedAccount: string;
  assertions: RiskAssertion[];
  magnitude: string;
  likelihood: string;
  compensatingControlIds: string[];
  compensatingNote: string;
  remediationAction: string;
  remediationStatus: string;
  auditImpact: string;
  reportingImpact: string;
  reportingNote: string;
}
const defDraftOf = (d?: IcfrDeficiency): DeficiencyDraft => ({
  classification: d?.classification ?? 'control_deficiency',
  description: d?.description ?? '',
  controlId: d?.controlId ?? '',
  processAreaId: d?.processAreaId ?? '',
  workAreaKey: d?.workAreaKey ?? '',
  affectedAccount: d?.affectedAccount ?? '',
  assertions: d?.assertions ?? [],
  magnitude: d?.magnitude ?? '',
  likelihood: d?.likelihood ?? '',
  compensatingControlIds: d?.compensatingControlIds ?? [],
  compensatingNote: d?.compensatingNote ?? '',
  remediationAction: d?.remediationAction ?? '',
  remediationStatus: d?.remediationStatus ?? 'not_started',
  auditImpact: d?.auditImpact ?? '',
  reportingImpact: d?.reportingImpact ?? '',
  reportingNote: d?.reportingNote ?? '',
});
const defBody = (d: DeficiencyDraft) => ({
  classification: d.classification,
  description: d.description.trim(),
  controlId: d.controlId || null,
  processAreaId: d.processAreaId || null,
  workAreaKey: d.workAreaKey || null,
  affectedAccount: orNull(d.affectedAccount),
  assertions: d.assertions,
  magnitude: d.magnitude || null,
  likelihood: d.likelihood || null,
  compensatingControlIds: d.compensatingControlIds,
  compensatingNote: orNull(d.compensatingNote),
  remediationAction: orNull(d.remediationAction),
  remediationStatus: d.remediationStatus,
  auditImpact: orNull(d.auditImpact),
  reportingImpact: d.reportingImpact || null,
  reportingNote: orNull(d.reportingNote),
});

function DeficiencyFields({
  d,
  set,
  ctx,
  reviewed,
}: {
  d: DeficiencyDraft;
  set: (p: Partial<DeficiencyDraft>) => void;
  ctx: Ctx;
  /** Once reviewed only the remediation and the reporting note change. */
  reviewed: boolean;
}): JSX.Element {
  const controls = ctx.view.controls.filter((c) => !c.withdrawn);
  const suggested =
    d.magnitude && d.likelihood
      ? ctx.view.methodology.matrix.find(
          (x) => x.magnitude === d.magnitude && x.likelihood === d.likelihood,
        )?.classification
      : undefined;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Deficiency" required>
          <Textarea
            value={d.description}
            disabled={reviewed}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Control">
        <Select
          value={d.controlId}
          disabled={reviewed}
          onChange={(e) => set({ controlId: e.target.value })}
        >
          <option value="">—</option>
          {controls.map((c) => (
            <option key={c.id} value={c.id}>
              {c.controlRef} {c.description}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Process area">
        <Select
          value={d.processAreaId}
          disabled={reviewed}
          onChange={(e) => set({ processAreaId: e.target.value })}
        >
          <option value="">— From the control —</option>
          {ctx.view.processAreas
            .filter((a) => !a.withdrawn)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Affected account / disclosure">
        <Input
          value={d.affectedAccount}
          disabled={reviewed}
          onChange={(e) => set({ affectedAccount: e.target.value })}
        />
      </Field>
      <Field label="Section 06 work area">
        <Select
          value={d.workAreaKey}
          disabled={reviewed}
          onChange={(e) => set({ workAreaKey: e.target.value })}
        >
          <option value="">—</option>
          {ctx.view.workAreas.map((w) => (
            <option key={w.key} value={w.key}>
              {w.title}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <AssertionPicker
          value={d.assertions}
          disabled={reviewed}
          onChange={(assertions) => set({ assertions })}
        />
      </div>
      <Field label="Magnitude">
        <Select
          value={d.magnitude}
          disabled={reviewed}
          onChange={(e) => set({ magnitude: e.target.value })}
        >
          <option value="">—</option>
          {ICFR_MAGNITUDES.map((m) => (
            <option key={m} value={m}>
              {ICFR_MAGNITUDE_LABEL[m]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Likelihood">
        <Select
          value={d.likelihood}
          disabled={reviewed}
          onChange={(e) => set({ likelihood: e.target.value })}
        >
          <option value="">—</option>
          {ICFR_LIKELIHOODS.map((l) => (
            <option key={l} value={l}>
              {ICFR_LIKELIHOOD_LABEL[l]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Classification"
        hint={
          suggested ? `Methodology suggests ${ICFR_DEFICIENCY_CLASS_LABEL[suggested]}.` : undefined
        }
      >
        <Select
          value={d.classification}
          disabled={reviewed}
          onChange={(e) => set({ classification: e.target.value as IcfrDeficiencyClass })}
        >
          {ICFR_DEFICIENCY_CLASSES.map((c) => (
            <option key={c} value={c}>
              {ICFR_DEFICIENCY_CLASS_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reporting impact">
        <Select
          value={d.reportingImpact}
          disabled={reviewed}
          onChange={(e) => set({ reportingImpact: e.target.value })}
        >
          <option value="">—</option>
          {ICFR_REPORTING_IMPACTS.map((r) => (
            <option key={r} value={r}>
              {ICFR_REPORTING_IMPACT_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="text-xs sm:col-span-2" disabled={reviewed}>
        <legend className="mb-1 text-sm font-medium text-ink">Compensating controls</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {controls
            .filter((c) => c.id !== d.controlId)
            .map((c) => (
              <label key={c.id} className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={d.compensatingControlIds.includes(c.id)}
                  onChange={(e) =>
                    set({
                      compensatingControlIds: e.target.checked
                        ? [...d.compensatingControlIds, c.id]
                        : d.compensatingControlIds.filter((x) => x !== c.id),
                    })
                  }
                />
                {c.controlRef}
              </label>
            ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <Field label="Compensating controls — evaluation">
          <Input
            value={d.compensatingNote}
            disabled={reviewed}
            onChange={(e) => set({ compensatingNote: e.target.value })}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Audit impact (substantive / risk / reporting)">
          <Input
            value={d.auditImpact}
            disabled={reviewed}
            onChange={(e) => set({ auditImpact: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Remediation action">
        <Input
          value={d.remediationAction}
          onChange={(e) => set({ remediationAction: e.target.value })}
        />
      </Field>
      <Field label="Remediation status">
        <Select
          value={d.remediationStatus}
          onChange={(e) => set({ remediationStatus: e.target.value })}
        >
          {ICFR_REMEDIATION_STATUSES.map((r) => (
            <option key={r} value={r}>
              {ICFR_REMEDIATION_STATUS_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Reporting note">
          <Input value={d.reportingNote} onChange={(e) => set({ reportingNote: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

function NewDeficiency({ ctx, onDone }: { ctx: Ctx; onDone: () => void }): JSX.Element {
  const [d, setD] = useState<DeficiencyDraft>(() => defDraftOf());
  const set = (p: Partial<DeficiencyDraft>) => setD((x) => ({ ...x, ...p }));
  return (
    <div className="space-y-2 rounded-md border border-line p-2" aria-label="New deficiency">
      <DeficiencyFields d={d} set={set} ctx={ctx} reviewed={false} />
      <Button
        size="sm"
        disabled={ctx.busy || blank(d.description)}
        onClick={async () => {
          if (
            await ctx.act(() => ctx.send('deficiencies', 'POST', defBody(d)), 'Deficiency raised.')
          )
            onDone();
        }}
      >
        Raise deficiency
      </Button>
    </div>
  );
}

function DeficiencyRow({ d, ctx }: { d: IcfrDeficiency; ctx: Ctx }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2 text-xs" aria-label={`Deficiency ${d.ref}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Toggle open={open} onClick={() => setOpen((o) => !o)} label={`Expand ${d.ref}`} />
        <span className="font-medium text-ink">{d.ref}</span>
        <Badge tone={CLASS_TONE[d.classification]}>
          {ICFR_DEFICIENCY_CLASS_LABEL[d.classification]}
        </Badge>
        {d.suggestedClassification && d.suggestedClassification !== d.classification && (
          <Badge tone="warn">
            Methodology: {ICFR_DEFICIENCY_CLASS_LABEL[d.suggestedClassification]}
          </Badge>
        )}
        <span className="min-w-0 flex-1 truncate text-ink-muted">
          {d.controlRef ? `${d.controlRef} · ` : ''}
          {d.processTitle ? `${d.processTitle} · ` : ''}
          {d.description}
        </span>
        <Badge tone={d.status === 'open' ? 'warn' : 'success'}>{humanize(d.status)}</Badge>
        {d.partnerAt ? (
          <Badge tone="success">Partner concluded</Badge>
        ) : d.reviewedAt ? (
          <Badge tone="info">Manager reviewed</Badge>
        ) : null}
      </div>
      {open && <DeficiencyDetail d={d} ctx={ctx} />}
    </li>
  );
}

function DeficiencyDetail({ d, ctx }: { d: IcfrDeficiency; ctx: Ctx }): JSX.Element {
  const reviewed = d.reviewedAt != null;
  const [draft, setDraft] = useState<DeficiencyDraft>(() => defDraftOf(d));
  const set = (p: Partial<DeficiencyDraft>) => setDraft((x) => ({ ...x, ...p }));
  const [partnerNote, setPartnerNote] = useState('');
  const editable = ctx.editable && !d.withdrawn;
  const review = (
    action: 'manager_review' | 'partner_conclude' | 'reopen',
    partnerConclusion?: string,
  ) =>
    ctx.act(
      () =>
        ctx.send(`deficiencies/${d.id}/review`, 'POST', {
          action,
          partnerConclusion,
          version: d.version,
        }),
      action === 'manager_review'
        ? 'Manager review recorded.'
        : action === 'partner_conclude'
          ? 'Partner conclusion recorded.'
          : 'Deficiency reopened.',
    );
  return (
    <div className="mt-2 space-y-2 pl-6">
      {d.compensatingControlRefs.length > 0 && (
        <p className="text-ink-muted">
          Compensating controls: {d.compensatingControlRefs.join(', ')}
        </p>
      )}
      {d.reviewedAt && (
        <p className="text-ink-faint">
          Manager review: {d.reviewedByName ?? '—'} {formatDate(d.reviewedAt)}
        </p>
      )}
      {d.partnerAt && (
        <p className="text-ink-muted">
          <span className="font-medium text-ink">Partner:</span> {d.partnerConclusion} —{' '}
          {d.partnerByName ?? '—'} {formatDate(d.partnerAt)}
        </p>
      )}
      {editable ? (
        <>
          <DeficiencyFields d={draft} set={set} ctx={ctx} reviewed={reviewed} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={ctx.busy || blank(draft.description)}
              onClick={() => {
                const body = defBody(draft);
                void ctx.act(
                  () =>
                    ctx.send(
                      `deficiencies/${d.id}`,
                      'PATCH',
                      reviewed
                        ? {
                            remediationAction: body.remediationAction,
                            remediationStatus: body.remediationStatus,
                            reportingNote: body.reportingNote,
                            version: d.version,
                          }
                        : { ...body, version: d.version },
                    ),
                  'Deficiency saved.',
                );
              }}
            >
              Save
            </Button>
            {reviewed && (
              <Select
                className="w-auto"
                aria-label="Deficiency status"
                value={d.status}
                disabled={ctx.busy}
                onChange={(e) =>
                  void ctx.act(() =>
                    ctx.send(`deficiencies/${d.id}`, 'PATCH', {
                      status: e.target.value,
                      version: d.version,
                    }),
                  )
                }
              >
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </Select>
            )}
            {!reviewed && (
              <Button
                size="sm"
                variant="ghost"
                disabled={ctx.busy}
                onClick={() =>
                  void ctx.act(
                    () =>
                      ctx.send(`deficiencies/${d.id}`, 'PATCH', {
                        withdrawn: true,
                        version: d.version,
                      }),
                    'Deficiency withdrawn.',
                  )
                }
              >
                Withdraw
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="text-ink-muted">
          {d.remediationAction ?? 'No remediation recorded.'} —{' '}
          {ICFR_REMEDIATION_STATUS_LABEL[d.remediationStatus]}
        </p>
      )}
      <Blockers
        items={d.blockers}
        label={reviewed ? 'Before the Partner can conclude' : 'Before the Manager review'}
      />
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          {!reviewed && (
            <Button
              size="sm"
              disabled={ctx.busy || d.blockers.length > 0}
              onClick={() => void review('manager_review')}
            >
              Record Manager review
            </Button>
          )}
          {reviewed && d.partnerRequired && !d.partnerAt && (
            <>
              <Input
                className="max-w-md"
                placeholder="The Partner's conclusion"
                aria-label="Partner conclusion"
                value={partnerNote}
                onChange={(e) => setPartnerNote(e.target.value)}
              />
              <Button
                size="sm"
                disabled={ctx.busy || blank(partnerNote)}
                onClick={() => void review('partner_conclude', partnerNote.trim())}
              >
                Partner concludes
              </Button>
            </>
          )}
          {reviewed && (
            <Button
              size="sm"
              variant="secondary"
              disabled={ctx.busy}
              onClick={() => void review('reopen')}
            >
              Reopen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Conclusion ───────────────────────────────────────────────────────────────

function Conclusion({ ctx }: { ctx: Ctx }): JSX.Element {
  const ws = ctx.view.workstream!;
  const [conclusion, setConclusion] = useState<IcfrWorkstreamConclusion | ''>(ws.conclusion ?? '');
  const [note, setNote] = useState(ws.conclusionNote ?? '');
  const editable = ctx.editable && ctx.active;
  return (
    <div className="space-y-1.5" aria-label="ICFR workstream conclusion">
      <h5 className="text-xs font-semibold text-ink">Workstream conclusion</h5>
      {ws.conclusion ? (
        <p className="text-xs text-ink-muted">
          <span className="font-medium text-ink">
            {ICFR_WORKSTREAM_CONCLUSION_LABEL[ws.conclusion]}
          </span>
          {ws.conclusionNote ? ` — ${ws.conclusionNote}` : ''} · {ws.concludedByName ?? '—'}{' '}
          {ws.concludedAt ? formatDate(ws.concludedAt) : ''}
        </p>
      ) : (
        <Blockers items={ctx.view.conclusionBlockers} label="Before the workstream can conclude" />
      )}
      {editable &&
        (ws.conclusion ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={ctx.busy}
            onClick={() =>
              void ctx.act(
                () =>
                  ctx.send('workstream/conclusion', 'POST', {
                    conclusion: null,
                    version: ws.version,
                  }),
                'Conclusion reopened.',
              )
            }
          >
            Reopen conclusion
          </Button>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[16rem_1fr_auto] sm:items-end">
            <Field label="Conclusion">
              <Select
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value as IcfrWorkstreamConclusion)}
              >
                <option value="">—</option>
                {ICFR_WORKSTREAM_CONCLUSIONS.map((c) => (
                  <option key={c} value={c}>
                    {ICFR_WORKSTREAM_CONCLUSION_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button
              size="sm"
              disabled={ctx.busy || !conclusion || ctx.view.conclusionBlockers.length > 0}
              onClick={() =>
                void ctx.act(
                  () =>
                    ctx.send('workstream/conclusion', 'POST', {
                      conclusion,
                      note: orNull(note),
                      version: ws.version,
                    }),
                  'ICFR workstream concluded.',
                )
              }
            >
              Conclude (Engagement Partner)
            </Button>
          </div>
        ))}
    </div>
  );
}
