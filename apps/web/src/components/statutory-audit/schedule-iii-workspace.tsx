'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import {
  CASH_FLOW_STATUS_LABEL,
  COMPARATIVES_STATUSES,
  COMPARATIVES_STATUS_LABEL,
  DISCLOSURE_CATEGORIES,
  DISCLOSURE_CATEGORY_LABEL,
  REPORTING_FRAMEWORK_LABEL,
  SCH01_RESULT_LABEL,
  SCHEDULE_III_CONCLUSIONS,
  SCHEDULE_III_OUTCOME,
  SCHEDULE_III_OUTCOME_LABEL,
  SCH_ANSWERS,
  SCH_ANSWER_LABEL,
  SCH_REFERENCE_ANCHOR,
  SCH_REFERENCE_CONTEXT,
  SPECIAL_ENTITY_LABEL,
  SPECIALISED_EFFECTS,
  SPECIALISED_EFFECT_LABEL,
  auditPeriodStartFromFinancialYear,
  templateDefinition,
  type ComparativesStatus,
  type ReportingFrameworkOutcome,
  type RecordScheduleIiiDecisionInput,
  type SchAnswer,
  type ScheduleIiiDetail,
  type ScheduleIiiDisclosure,
  type ScheduleIiiOutcome,
  type SetScheduleIiiFactsInput,
  type SpecialEntityType,
  type SpecialisedEffect,
  type StatutoryAuditScheduleIii,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { FrameworkEvidence } from './framework-evidence';
import { FrameworkReferences } from './framework-references';
import { FsWorkbookCard } from './fs-workbook-card';

/**
 * 02.3 Schedule III & Financial Statement Presentation workspace (DHVAJ Section
 * 02.3 Web Developer Specification §3–§20). One screen, every section expanding
 * in place (+/−, never a pop-up): System Assessment with View Assessment Logic,
 * Facts Used (Open Source Assessment), Rule Basis, SCH-01/02 specialised format,
 * Division and version, components, SCH-03 cash flow, the disclosure library,
 * SCH-04 comparatives, SCH-05 rounding, presentation materiality, the SCH-06
 * Professional Conclusion with Partner approval, completion, the Financial
 * Statements Workbook, downstream outputs, references and evidence / memo.
 *
 * Nothing statutory lives here: the Division, version, components, exemptions,
 * units, thresholds and disclosures all arrive from the API (Rules Library and
 * versioned presentation framework); every "View …" link resolves from the
 * central Provision Library for the audit period.
 */

const A = SCH_REFERENCE_ANCHOR;

/** The View Schedule III / ICAI Guidance Note links of each Division (§6). */
const DIVISION_ANCHORS: Record<string, string[]> = {
  [SCHEDULE_III_OUTCOME.divisionI]: [A.divisionI, A.guidanceDivisionI],
  [SCHEDULE_III_OUTCOME.divisionII]: [A.divisionII, A.guidanceDivisionII],
  [SCHEDULE_III_OUTCOME.divisionIII]: [A.divisionIII, A.guidanceDivisionIII],
};
const VERSION_DIVISION_ANCHORS: Record<'I' | 'II' | 'III', string[]> = {
  I: [A.divisionI, A.guidanceDivisionI],
  II: [A.divisionII, A.guidanceDivisionII],
  III: [A.divisionIII, A.guidanceDivisionIII],
};

const APPLICABILITY_LABEL: Record<ScheduleIiiDisclosure['applicability'], string> = {
  baseline: 'Mandatory',
  triggered: 'Triggered',
  included_pending_fact: 'Included — fact pending',
  not_triggered: 'Not triggered',
};
const APPLICABILITY_TONE: Record<ScheduleIiiDisclosure['applicability'], string> = {
  baseline: 'info',
  triggered: 'success',
  included_pending_fact: 'warn',
  not_triggered: 'neutral',
};

const decidedState = (s: string) =>
  s === 'applicable' || s === 'not_applicable' || s === 'overridden' || s === 'approved';
const outcomeLabel = (o: string | null | undefined) =>
  o ? (SCHEDULE_III_OUTCOME_LABEL[o as ScheduleIiiOutcome] ?? o) : '—';
const templateTitle = (key: string | null | undefined) =>
  key ? (templateDefinition(key)?.title ?? key) : '—';
const rupees = (v: number | null | undefined) =>
  v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`;

/** Scroll to a source field (02.1 / 02.2 on the same page). */
function goTo(anchor: string | null): void {
  if (!anchor) return;
  const el =
    document.getElementById(anchor) ??
    (anchor.startsWith('profile-card-') ? document.getElementById('framework-02-1') : null) ??
    (anchor.startsWith('frf-') ? document.getElementById('frf-workspace') : null);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

type Decision = Omit<RecordScheduleIiiDecisionInput, 'version'>;

export function ScheduleIiiWorkspace({
  engagementId,
  sch,
  canManage,
}: {
  engagementId: string;
  sch: StatutoryAuditScheduleIii;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/engagements/${engagementId}/statutory-audit/${sch.workflowInstanceId}/schedule-iii`;
  const a = sch.assessment;
  const d: ScheduleIiiDetail | null = sch.detail;
  const decided = decidedState(a.state);
  const approved = sch.approved ?? a.state === 'approved';
  const editable = canManage && !approved;
  const fy = sch.auditFinancialYear ?? sch.baseFacts.financialYear ?? null;
  const effectiveOn = fy ? auditPeriodStartFromFinancialYear(fy) : undefined;
  const outcome = (decided ? a.conclusion : a.systemOutcome) as string | null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  const fail = (e: unknown, what: string) =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`);

  const facts = useMutation({
    mutationFn: (body: Omit<SetScheduleIiiFactsInput, 'version'>) =>
      apiFetch<StatutoryAuditScheduleIii>(`${base}/facts`, {
        method: 'POST',
        body: { ...body, version: a.version },
      }),
    onSuccess: () => {
      toast(decided ? 'Saved — the conclusion must be recorded again.' : 'Saved.');
      refresh();
    },
    onError: (e) => fail(e, 'save'),
  });
  const decision = useMutation({
    mutationFn: (body: Decision) =>
      apiFetch(`${base}/decision`, { method: 'POST', body: { ...body, version: a.version } }),
    onSuccess: () => {
      toast('Conclusion recorded.');
      refresh();
    },
    onError: (e) => fail(e, 'record the conclusion'),
  });
  const partner = useMutation({
    mutationFn: (note: string) =>
      apiFetch(`${base}/partner-approve`, {
        method: 'POST',
        body: { note: note || undefined, version: a.version },
      }),
    onSuccess: () => {
      toast('Partner approval recorded.');
      refresh();
    },
    onError: (e) => fail(e, 'approve'),
  });
  const save = (body: Omit<SetScheduleIiiFactsInput, 'version'>) => facts.mutate(body);
  const busy = facts.isPending || decision.isPending || partner.isPending;
  const disabled = !editable || busy;

  const completion = sch.completion;
  const status = approved
    ? 'Approved (Section 02)'
    : completion?.complete
      ? '02.3 COMPLETE'
      : completion?.status === 'not_started'
        ? 'Not started'
        : 'In progress';
  const sp = d?.specialised;
  const showSpecialised =
    !!sp && (sp.matchedRules.length > 0 || sp.sch01 !== 'yes' || sp.answer !== null);
  const fv = d?.frameworkVersion ?? null;
  const cited = [
    a.authorityProvisionId,
    ...(d?.rulesApplied ?? []).map((r) => r.provisionId),
  ].filter((x): x is string => !!x);

  return (
    <div className="space-y-3" data-testid="sch-workspace">
      {/* Header (§3) */}
      <div className="space-y-1 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">
            Schedule III &amp; Financial Statement Presentation
          </span>
          <Badge tone={completion?.complete || approved ? 'success' : 'warn'}>{status}</Badge>
          <span className="text-ink-muted">
            Current conclusion:{' '}
            <span className="font-medium text-ink">
              {decided
                ? outcomeLabel(a.conclusion)
                : sch.professionalAction === 'information_pending'
                  ? 'Information Pending'
                  : 'Not concluded'}
            </span>
          </span>
          {a.needsReevaluation && (
            <Badge tone="warn">Needs re-evaluation — a source fact changed</Badge>
          )}
          {d?.blockingReview && <Badge tone="danger">Blocking presentation matter</Badge>}
          {!sch.upstreamReady && <Badge tone="neutral">Provisional — 02.1 / 02.2 open</Badge>}
        </div>
        <p className="text-xs text-ink-muted">
          Determine the statutory presentation and disclosure framework applicable to the financial
          statements.
        </p>
      </div>

      {/* System Assessment (§3) */}
      <Section id="sch-system" title="System Assessment" open>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Fact
            label="Schedule III / specialised framework"
            value={outcomeLabel(a.systemOutcome)}
          />
          <Fact
            label="Financial reporting framework (02.2)"
            value={
              sch.baseFacts.reportingFramework
                ? (REPORTING_FRAMEWORK_LABEL[
                    sch.baseFacts.reportingFramework as ReportingFrameworkOutcome
                  ] ?? sch.baseFacts.reportingFramework)
                : '02.2 not concluded'
            }
          />
          <Fact label="Entity classification (02.1)" value={classification(sch)} />
        </dl>
        {a.systemBasis && <p className="text-sm text-ink">{a.systemBasis}</p>}
        <AssessmentLogic sch={sch} />
        <FrameworkReferences
          contextKey={SCH_REFERENCE_CONTEXT}
          anchors={[A.section129, ...(DIVISION_ANCHORS[a.systemOutcome ?? ''] ?? [])]}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Facts Used (§2, §3) */}
      <Section id="sch-facts" title="Facts used" open>
        <MissingFacts detail={d} />
        {(d?.factsUsed ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">Run the assessment to list the facts used.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {d!.factsUsed!.map((f) => (
              <li
                key={f.key}
                className="flex flex-wrap items-baseline justify-between gap-2 py-1.5"
              >
                <span className="text-ink-muted">{f.label}</span>
                <span className="text-ink">{f.value}</span>
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-ink-faint">{f.source}</span>
                  {f.anchor && (
                    <button
                      type="button"
                      className="text-primary-600 underline"
                      onClick={() => goTo(f.anchor)}
                    >
                      Open Source Assessment
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-faint">
          Read-only — a fact is corrected where it is assessed (02.1 / 02.2), which marks 02.3 for
          re-evaluation.
        </p>
      </Section>

      {/* Rule Basis (§3) */}
      <Section id="sch-rules" title="Rule basis">
        {(d?.rulesApplied ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">No Rules Library rule applied yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th>Rule ID</th>
                <th>Rule</th>
                <th>Effective version</th>
                <th>Triggered condition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d!.rulesApplied!.map((r) => (
                <tr key={`${r.ruleCode}-${r.ruleVersionId}`}>
                  <td className="py-1 font-mono text-xs">{r.ruleCode}</td>
                  <td>{r.label}</td>
                  <td>from {formatDate(r.effectiveFrom)}</td>
                  <td>{r.condition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <FrameworkReferences
          contextKey={SCH_REFERENCE_CONTEXT}
          anchors={[]}
          provisionIds={cited}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* SCH-01 / SCH-02 — specialised statutory format (§5, §7) */}
      <Section
        id="sch-02"
        title="SCH-01 / SCH-02 Presentation framework route"
        open={showSpecialised}
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact
            label="SCH-01 Is Schedule III the applicable presentation framework?"
            value={sp ? SCH01_RESULT_LABEL[sp.sch01] : d?.sch01 ? SCH01_RESULT_LABEL[d.sch01] : '—'}
          />
          <Fact
            label="SCH-02 System suggested"
            value={sp ? SCH_ANSWER_LABEL[sp.systemSuggested] : '—'}
          />
        </dl>
        {showSpecialised ? (
          <SpecialisedCapture sch={sch} disabled={disabled} onSave={save} />
        ) : (
          <p className="text-sm text-ink-muted">
            No specialised statutory format is mapped to this entity&rsquo;s 02.1 classification in
            the Rules Library — the ordinary Schedule III route applies.
          </p>
        )}
        <QuestionEvidence label="SCH-02 evidence (governing statute / regulator format)">
          <FrameworkEvidence
            engagementId={engagementId}
            workflowInstanceId={sch.workflowInstanceId}
            subAssessmentId={a.id}
            memoSuggested={false}
            readOnly={!editable}
            question="sch_02"
          />
        </QuestionEvidence>
        <FrameworkReferences
          contextKey={SCH_REFERENCE_CONTEXT}
          anchors={[A.section129]}
          provisionIds={(sp?.matchedRules ?? [])
            .map((r) => r.provisionId)
            .filter((x): x is string => !!x)}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Division + version control (§6, §8) */}
      <Section id="sch-division" title="Schedule III Division and version" open>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Fact
            label="Division (system)"
            value={d?.division ? outcomeLabel(d.division) : outcomeLabel(a.systemOutcome)}
          />
          <Fact label="Framework ID" value={fv?.frameworkId ?? '—'} />
          <Fact label="Version" value={fv?.versionLabel ?? '—'} />
          <Fact label="Effective from" value={fv ? formatDate(fv.effectiveFrom) : '—'} />
          <Fact
            label="Effective to"
            value={fv ? (fv.effectiveTo ? formatDate(fv.effectiveTo) : 'Open') : '—'}
          />
          <Fact label="MCA notification / amendment" value={fv?.notificationReference ?? '—'} />
          <Fact label="ICAI Guidance Note version" value={fv?.guidanceVersion ?? '—'} />
          <Fact label="Workbook template" value={templateTitle(fv?.templateKey)} />
          <Fact
            label="Status"
            value={
              fv ? (
                <Badge tone={fv.status === 'active' ? 'success' : 'neutral'}>
                  {fv.status === 'active' ? 'Active' : 'Superseded'}
                </Badge>
              ) : (
                '—'
              )
            }
          />
        </dl>
        {!fv && (
          <p className="text-xs text-ink-faint">
            The version resolves from the presentation-framework library once the Division is
            determined.
          </p>
        )}
        <p className="text-xs text-ink-faint">
          The Division is system-generated; choose another only through Override Assessment (SCH-06)
          with a mandatory reason.
        </p>
        <FrameworkReferences
          contextKey={SCH_REFERENCE_CONTEXT}
          anchors={
            fv ? VERSION_DIVISION_ANCHORS[fv.division] : (DIVISION_ANCHORS[outcome ?? ''] ?? [])
          }
          provisionIds={[fv?.provisionId, fv?.guidanceProvisionId].filter((x): x is string => !!x)}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Required financial statement components (§9) */}
      <Section id="sch-components" title="Financial statement components">
        {(d?.componentLines ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">Loaded from the framework version once resolved.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d!.componentLines!.map((l) => (
              <li key={l.key} className="flex flex-wrap items-baseline gap-2">
                {l.required ? (
                  <CheckCircle2
                    className="h-4 w-4 self-center text-success-600"
                    aria-label="Required"
                  />
                ) : (
                  <span
                    className="h-4 w-4 self-center text-center text-ink-faint"
                    aria-label="Not required"
                  >
                    –
                  </span>
                )}
                <span className={l.required ? 'text-ink' : 'text-ink-muted line-through'}>
                  {l.label}
                </span>
                {l.includesOci && <Badge tone="info">Includes OCI</Badge>}
                <span className="text-xs text-ink-faint">{l.basis}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-faint">
          Components are loaded by the selected framework — routine statements are not ticked by
          hand. They drive the FS workbook and the final presentation review.
        </p>
      </Section>

      {/* SCH-03 cash flow (§10) */}
      <Section id="sch-03" title="SCH-03 Cash Flow Statement">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact
            label="Cash Flow Statement required?"
            value={
              d?.cashFlow ? (
                <Badge tone={d.cashFlow.status === 'further_assessment' ? 'warn' : 'neutral'}>
                  {CASH_FLOW_STATUS_LABEL[d.cashFlow.status]}
                </Badge>
              ) : d ? (
                d.cashFlowRequired ? (
                  'Required'
                ) : (
                  'Exempt'
                )
              ) : (
                '—'
              )
            }
          />
          <Fact
            label="Classifications consumed (02.1)"
            value={(d?.cashFlow?.classifications ?? []).join(', ') || 'None'}
          />
        </dl>
        <p className="text-sm text-ink">{d?.cashFlow?.basis ?? d?.cashFlowExemptionReason ?? ''}</p>
        <p className="text-xs text-ink-faint">
          OPC / small / dormant status comes from the approved 02.1 result — it is not asked again
          here.
        </p>
        <FrameworkReferences
          contextKey={SCH_REFERENCE_CONTEXT}
          anchors={[A.cashFlowExemption]}
          provisionIds={d?.cashFlowProvisionId ? [d.cashFlowProvisionId] : []}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Disclosure library (§11, §12) */}
      <Section id="sch-disclosures" title="Schedule III disclosure library">
        <DisclosureLibrary library={d?.disclosureLibrary ?? []} versionTitle={fv?.title ?? null} />
      </Section>

      {/* SCH-04 comparatives (§13) */}
      <Section id="sch-04" title="SCH-04 Comparative information">
        <Comparatives sch={sch} disabled={disabled} onSave={save} />
        <QuestionEvidence label="SCH-04 prior-year financial statements">
          <FrameworkEvidence
            engagementId={engagementId}
            workflowInstanceId={sch.workflowInstanceId}
            subAssessmentId={a.id}
            memoSuggested={false}
            readOnly={!editable}
            question="sch_04"
          />
        </QuestionEvidence>
      </Section>

      {/* SCH-05 rounding (§14) */}
      <Section id="sch-05" title="SCH-05 Rounding-off / unit of presentation">
        <Rounding sch={sch} disabled={disabled} onSave={save} />
        <FrameworkReferences
          contextKey={SCH_REFERENCE_CONTEXT}
          anchors={[A.rounding]}
          provisionIds={d?.rounding?.provisionId ? [d.rounding.provisionId] : []}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Presentation materiality (§15) */}
      <Section
        id="sch-materiality"
        title="Financial Statement Presentation Materiality / Disclosure Threshold"
      >
        <PresentationMateriality detail={d} />
      </Section>

      {/* SCH-06 Professional Conclusion (§17) */}
      <Section id="sch-06" title="Professional Conclusion (SCH-06)" open>
        <ConclusionSummary sch={sch} />
        <ProfessionalConclusion
          sch={sch}
          disabled={disabled}
          canManage={canManage && !approved}
          onDecide={(b) => decision.mutate(b)}
          onPartnerApprove={(note) => partner.mutate(note)}
          partnerBusy={partner.isPending}
        />
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-primary-600">
            View all triggered provisions
          </summary>
          <div className="mt-2">
            <FrameworkReferences
              contextKey={SCH_REFERENCE_CONTEXT}
              provisionIds={cited}
              effectiveOn={effectiveOn}
            />
          </div>
        </details>
      </Section>

      {/* Completion (§20) */}
      <Section id="sch-completion" title="Completion" open>
        <ul className="space-y-1 text-sm">
          {(completion?.items ?? [])
            .filter((i) => i.met !== null)
            .map((i) => (
              <li key={i.key} className="flex flex-wrap items-baseline gap-2">
                {i.met ? (
                  <CheckCircle2
                    className="h-4 w-4 self-center text-success-600"
                    aria-label="Done"
                  />
                ) : (
                  <AlertTriangle
                    className="h-4 w-4 self-center text-warning-600"
                    aria-label="Open"
                  />
                )}
                <span className={i.met ? 'text-ink' : 'text-warning-700'}>{i.label}</span>
                {i.detail && <span className="text-xs text-ink-faint">{i.detail}</span>}
              </li>
            ))}
        </ul>
        {completion?.complete && (
          <p className="text-sm font-medium text-success-700">
            02.3 COMPLETE — the approved presentation framework and version metadata pass to the
            financial-statement review and downstream audit work.
          </p>
        )}
      </Section>

      {/* Financial Statements Workbook (§16) */}
      <Section
        id="sch-workbook"
        title="Financial Statements Workbook"
        open={!!sch.workbookAvailable}
      >
        <FsWorkbookCard
          engagementId={engagementId}
          workflowInstanceId={sch.workflowInstanceId}
          canManage={canManage}
        />
      </Section>

      {/* Downstream (§19) */}
      <Section id="sch-downstream" title="Downstream impact">
        {(d?.downstream ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">Outputs are listed once the assessment runs.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th>02.3 output</th>
                <th>Value</th>
                <th>Used by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d!.downstream!.map((o) => (
                <tr key={o.key}>
                  <td className="py-1">{o.label}</td>
                  <td>{o.value}</td>
                  <td className="text-ink-muted">{o.usedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-ink-faint">
          CARO applicability is not determined here — 02.4 assesses it independently.
        </p>
      </Section>

      {/* References (§4, §22) */}
      <Section id="sch-references" title="References">
        <FrameworkReferences
          contextKey={SCH_REFERENCE_CONTEXT}
          provisionIds={cited}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Evidence / Technical memo (§17, §18) */}
      <Section id="sch-evidence" title="Evidence / Technical memo" open={!!sch.memoSuggested}>
        <FrameworkEvidence
          engagementId={engagementId}
          workflowInstanceId={sch.workflowInstanceId}
          subAssessmentId={a.id}
          memoSuggested={sch.memoSuggested ?? false}
          readOnly={!editable}
        />
      </Section>
    </div>
  );
}

// ── Panels ────────────────────────────────────────────────────────────────

function classification(sch: StatutoryAuditScheduleIii): string {
  const f = sch.baseFacts;
  const parts: string[] = [];
  for (const t of f.specialEntityTypes ?? []) {
    parts.push(SPECIAL_ENTITY_LABEL[t as SpecialEntityType] ?? t);
  }
  if (f.isNbfc && !parts.length) parts.push('NBFC');
  if (f.isBankOrInsurance && !parts.length) parts.push('Bank / insurance');
  if (f.isOpc) parts.push('One Person Company');
  if (f.isSmallCompany) parts.push('Small company');
  if (f.isDormant && !parts.some((p) => /dormant/i.test(p))) parts.push('Dormant company');
  return [...new Set(parts)].join(', ') || 'Ordinary company';
}

/** View Assessment Logic (§4) — facts, rules, effective dates and reasoning; never code. */
function AssessmentLogic({ sch }: { sch: StatutoryAuditScheduleIii }): JSX.Element {
  const [open, setOpen] = useState(false);
  const d = sch.detail;
  const a = sch.assessment;
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-primary-600 hover:underline"
      >
        {open ? '−' : '+'} View Assessment Logic
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-sm" data-testid="sch-assessment-logic">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-faint">Facts</p>
            {(d?.factsUsed ?? []).length === 0 ? (
              <p className="text-ink-muted">No facts recorded yet.</p>
            ) : (
              <ul className="ml-4 list-disc">
                {d!.factsUsed!.map((f) => (
                  <li key={f.key}>
                    {f.label}: <span className="text-ink">{f.value}</span>{' '}
                    <span className="text-xs text-ink-faint">({f.source})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-faint">
              Rules and effective dates
            </p>
            {(d?.rulesApplied ?? []).length === 0 ? (
              <p className="text-ink-muted">No rule applied.</p>
            ) : (
              <ul className="ml-4 list-disc">
                {d!.rulesApplied!.map((r) => (
                  <li key={`${r.ruleCode}-${r.ruleVersionId}`}>
                    {r.label} — <span className="text-ink">{r.condition}</span>{' '}
                    <span className="text-xs text-ink-faint">
                      ({r.ruleCode}, version from {formatDate(r.effectiveFrom)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {d?.frameworkVersion && (
              <p className="text-xs text-ink-muted">
                Presentation framework: {d.frameworkVersion.title} —{' '}
                {d.frameworkVersion.versionLabel} (in force from{' '}
                {formatDate(d.frameworkVersion.effectiveFrom)}).
              </p>
            )}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-faint">System reasoning</p>
            <p className="text-ink">{a.systemBasis ?? 'Not assessed yet.'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MissingFacts({ detail }: { detail: ScheduleIiiDetail | null }): JSX.Element | null {
  const missing = detail?.missingFacts ?? [];
  if (missing.length === 0) return null;
  return (
    <div className="rounded-md border border-warning-200 bg-warning-50 p-2 text-sm text-warning-700">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-4 w-4" /> Information prevents determination:
      </p>
      <ul className="ml-5 list-disc">
        {missing.map((m) => (
          <li key={m.key}>
            {m.label} —{' '}
            <button type="button" className="underline" onClick={() => goTo(m.anchor)}>
              {m.source}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpecialisedCapture({
  sch,
  disabled,
  onSave,
}: {
  sch: StatutoryAuditScheduleIii;
  disabled: boolean;
  onSave: (b: Omit<SetScheduleIiiFactsInput, 'version'>) => void;
}): JSX.Element {
  const sp = sch.detail!.specialised!;
  const c = sch.capturedFacts ?? {};
  // The library rule suggests the format; the team confirms or corrects it.
  const rule = sp.matchedRules[0];
  const [answer, setAnswer] = useState<SchAnswer | ''>(c.specialisedAnswer ?? sp.answer ?? '');
  const [form, setForm] = useState({
    governingAuthority:
      c.governingAuthority ?? sp.governingAuthority ?? rule?.governingAuthority ?? '',
    frameworkName: c.frameworkName ?? sp.frameworkName ?? rule?.frameworkName ?? '',
    specialisedEffect: (c.specialisedEffect ?? sp.effect ?? rule?.effect ?? '') as
      SpecialisedEffect | '',
    specialisedVersion: c.specialisedVersion ?? sp.effectiveVersion ?? '',
    specialisedReference: c.specialisedReference ?? sp.reference ?? '',
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isYes = answer === 'yes';
  // An answer other than the system suggestion needs the authoritative reference.
  const differs = answer !== '' && answer !== sp.systemSuggested;
  const needsForm = isYes || differs;
  const complete =
    !!form.specialisedReference.trim() &&
    (!isYes ||
      (!!form.governingAuthority.trim() &&
        !!form.frameworkName.trim() &&
        !!form.specialisedEffect));
  return (
    <div className="space-y-3">
      {sp.matchedRules.length > 0 && (
        <div className="text-sm">
          <p className="text-[11px] uppercase tracking-wide text-ink-faint">
            Rules Library — specialised formats mapped to this classification
          </p>
          <ul className="ml-4 list-disc">
            {sp.matchedRules.map((r) => (
              <li key={r.code}>
                {r.frameworkName} — {r.governingAuthority} · {SPECIALISED_EFFECT_LABEL[r.effect]}{' '}
                <span className="text-xs text-ink-faint">(from {formatDate(r.effectiveFrom)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Field
        label="SCH-02 Does another statute or regulation prescribe, replace or modify the format?"
        hint={`System suggests: ${SCH_ANSWER_LABEL[sp.systemSuggested]}`}
      >
        <Select
          value={answer}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value as SchAnswer | '';
            setAnswer(v);
            // Agreeing with a No / further-assessment suggestion saves straight away.
            if (v === sp.systemSuggested && v !== 'yes') onSave({ specialisedAnswer: v });
          }}
        >
          <option value="">Select…</option>
          {SCH_ANSWERS.map((o) => (
            <option key={o} value={o}>
              {SCH_ANSWER_LABEL[o]}
            </option>
          ))}
        </Select>
      </Field>
      {needsForm && (
        <div className="space-y-2 rounded-md border border-line p-3">
          {isYes && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Governing authority" required>
                <Input
                  value={form.governingAuthority}
                  disabled={disabled}
                  onChange={(e) => set('governingAuthority')(e.target.value)}
                />
              </Field>
              <Field label="Framework name" required>
                <Input
                  value={form.frameworkName}
                  disabled={disabled}
                  onChange={(e) => set('frameworkName')(e.target.value)}
                />
              </Field>
              <Field label="Effect on Schedule III" required>
                <Select
                  value={form.specialisedEffect}
                  disabled={disabled}
                  onChange={(e) => set('specialisedEffect')(e.target.value)}
                >
                  <option value="">Select…</option>
                  {SPECIALISED_EFFECTS.map((o) => (
                    <option key={o} value={o}>
                      {SPECIALISED_EFFECT_LABEL[o]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Effective version">
                <Input
                  value={form.specialisedVersion}
                  disabled={disabled}
                  onChange={(e) => set('specialisedVersion')(e.target.value)}
                />
              </Field>
            </div>
          )}
          <Field
            label="Authoritative reference"
            required
            hint={differs ? 'Required — the answer differs from the system suggestion.' : undefined}
          >
            <Input
              value={form.specialisedReference}
              disabled={disabled}
              onChange={(e) => set('specialisedReference')(e.target.value)}
            />
          </Field>
          {isYes && form.specialisedEffect === 'replaces' && (
            <p className="text-xs text-warning-700">
              A format that replaces Schedule III needs Engagement Partner approval at SCH-06.
            </p>
          )}
          <Button
            size="sm"
            disabled={disabled || !complete}
            onClick={() =>
              onSave({
                specialisedAnswer: answer as SchAnswer,
                specialisedReference: form.specialisedReference.trim(),
                ...(isYes
                  ? {
                      governingAuthority: form.governingAuthority.trim(),
                      frameworkName: form.frameworkName.trim(),
                      specialisedEffect: form.specialisedEffect as SpecialisedEffect,
                      specialisedVersion: form.specialisedVersion.trim() || null,
                    }
                  : {}),
              })
            }
          >
            Save SCH-02
          </Button>
        </div>
      )}
      <p className="text-sm">
        {sp.resolved ? (
          <span className="text-success-700">Specialised-format assessment resolved.</span>
        ) : (
          <span className="text-warning-700">
            Unresolved — this blocks 02.3 completion until the format is captured or SCH-02 is
            answered No.
          </span>
        )}
      </p>
    </div>
  );
}

function DisclosureLibrary({
  library,
  versionTitle,
}: {
  library: ScheduleIiiDisclosure[];
  versionTitle: string | null;
}): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  if (library.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        The disclosure library loads from the applicable Schedule III version once resolved.
      </p>
    );
  }
  const applicable = library.filter((x) => x.applicability !== 'not_triggered');
  const shown = showAll ? library : applicable;
  const groups = DISCLOSURE_CATEGORIES.map((cat) => ({
    cat,
    items: shown.filter((x) => x.category === cat),
  })).filter((g) => g.items.length > 0);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink-muted">
        {applicable.length} of {library.length} requirements apply
        {versionTitle ? ` (${versionTitle})` : ''}. Rule conditions — not account balances — decide
        applicability; an unknown fact keeps a requirement in. The full checklist is completed later
        in the disclosure review.
      </p>
      {library.length > applicable.length && (
        <button
          type="button"
          className="text-xs font-medium text-primary-600 hover:underline"
          aria-pressed={showAll}
          onClick={() => setShowAll((s) => !s)}
        >
          {showAll ? 'Show applicable only' : 'Show not-triggered requirements too'}
        </button>
      )}
      {groups.map((g) => (
        <div key={g.cat}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {DISCLOSURE_CATEGORY_LABEL[g.cat]} ({g.items.length})
          </p>
          <ul className="divide-y divide-line">
            {g.items.map((x) => (
              <li key={x.code} className="flex flex-wrap items-baseline gap-2 py-1">
                <Badge tone={APPLICABILITY_TONE[x.applicability]}>
                  {APPLICABILITY_LABEL[x.applicability]}
                </Badge>
                <span className="text-ink">{x.label}</span>
                <span className="text-xs text-ink-faint">{x.reason}</span>
                {x.crossLink && <Badge tone="neutral">See {x.crossLink}</Badge>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Comparatives({
  sch,
  disabled,
  onSave,
}: {
  sch: StatutoryAuditScheduleIii;
  disabled: boolean;
  onSave: (b: Omit<SetScheduleIiiFactsInput, 'version'>) => void;
}): JSX.Element {
  const cmp = sch.detail?.comparatives;
  const c = sch.capturedFacts ?? {};
  const [status, setStatus] = useState<ComparativesStatus | ''>(c.comparativesStatus ?? '');
  const [reason, setReason] = useState(c.comparativesReason ?? '');
  if (!cmp) {
    return <p className="text-sm text-ink-muted">Assessed once the framework is determined.</p>;
  }
  const differs = status !== '' && status !== cmp.system;
  return (
    <div className="space-y-2 text-sm">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label="System" value={COMPARATIVES_STATUS_LABEL[cmp.system]} />
        <Fact label="Status used" value={COMPARATIVES_STATUS_LABEL[cmp.status]} />
        <Fact
          label="Prior-year period"
          value={cmp.firstFinancialYear ? 'First financial year — none' : (cmp.priorPeriod ?? '—')}
        />
        <Fact
          label="Prior-year financial statements linked"
          value={cmp.priorYearFileCount > 0 ? `${cmp.priorYearFileCount} file(s)` : 'None yet'}
        />
        {cmp.incorporationDate && (
          <Fact label="Incorporated" value={formatDate(cmp.incorporationDate)} />
        )}
      </dl>
      <p className="text-ink">{cmp.basis}</p>
      {cmp.status === 'required' && cmp.priorYearFileCount === 0 && (
        <p className="text-xs text-warning-700">
          Link the prior-year financial statements below (Add File / Link Existing File).
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Confirm or change the status">
          <Select
            value={status}
            disabled={disabled}
            onChange={(e) => setStatus(e.target.value as ComparativesStatus | '')}
          >
            <option value="">Use the system status</option>
            {COMPARATIVES_STATUSES.map((s) => (
              <option key={s} value={s}>
                {COMPARATIVES_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        {differs && (
          <div className="min-w-[16rem] flex-1">
            <Field label="Reason (required to change the system status)" required>
              <Input
                value={reason}
                disabled={disabled}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || (differs && !reason.trim())}
          onClick={() =>
            onSave({
              comparativesStatus: status || null,
              comparativesReason: differs ? reason.trim() : null,
            })
          }
        >
          Save SCH-04
        </Button>
      </div>
    </div>
  );
}

function Rounding({
  sch,
  disabled,
  onSave,
}: {
  sch: StatutoryAuditScheduleIii;
  disabled: boolean;
  onSave: (b: Omit<SetScheduleIiiFactsInput, 'version'>) => void;
}): JSX.Element {
  const r = sch.detail?.rounding;
  const c = sch.capturedFacts ?? {};
  const [unit, setUnit] = useState(c.roundingUnit ?? r?.selectedUnit ?? r?.systemUnit ?? '');
  const [reason, setReason] = useState(c.roundingReason ?? r?.reason ?? '');
  if (!r) {
    return (
      <p className="text-sm text-ink-muted">
        Assessed from the applicable Schedule III version once the framework is determined.
      </p>
    );
  }
  const differs = unit !== '' && unit !== r.systemUnit;
  return (
    <div className="space-y-2 text-sm">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label="Source measure" value={r.sourceLabel} />
        <Fact label="Source amount" value={rupees(r.sourceAmount)} />
        <Fact
          label="Rule threshold / condition"
          value={
            r.threshold == null
              ? '—'
              : `${rupees(r.threshold)} — ${
                  r.band === 'below'
                    ? 'below'
                    : r.band === 'at_or_above'
                      ? 'at or above'
                      : 'not determinable'
                }`
          }
        />
        <Fact label="Permitted units" value={r.permittedUnits.join(', ') || '—'} />
        <Fact label="System unit" value={r.systemUnit ?? '—'} />
        <Fact
          label="Rule version"
          value={
            r.ruleCode
              ? `${r.ruleCode}${r.effectiveFrom ? ` from ${formatDate(r.effectiveFrom)}` : ''}`
              : '—'
          }
        />
      </dl>
      <p className="text-ink">{r.basis}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Unit of presentation">
          <Select value={unit} disabled={disabled} onChange={(e) => setUnit(e.target.value)}>
            <option value="">Select…</option>
            {r.permittedUnits.map((u) => (
              <option key={u} value={u}>
                {u}
                {u === r.systemUnit ? ' (system)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        {differs && (
          <div className="min-w-[16rem] flex-1">
            <Field label="Override reason (mandatory)" required>
              <Input
                value={reason}
                disabled={disabled}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || !unit || (differs && !reason.trim())}
          onClick={() =>
            onSave({ roundingUnit: unit, roundingReason: differs ? reason.trim() : null })
          }
        >
          {differs ? 'Override unit' : 'Confirm unit'}
        </Button>
      </div>
      {r.selectedUnit && (
        <p className="text-xs text-ink-muted">
          Recorded: {r.selectedUnit}
          {r.overridden && r.reason ? ` — override: ${r.reason}` : ' — confirmed'}
        </p>
      )}
    </div>
  );
}

function PresentationMateriality({ detail }: { detail: ScheduleIiiDetail | null }): JSX.Element {
  const pm = detail?.presentationMateriality;
  if (!pm) {
    return (
      <p className="text-sm text-ink-muted">
        Read from the Rules Library where the governing framework prescribes a threshold.
      </p>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label="Label" value={pm.label} />
        <Fact
          label="Threshold"
          value={pm.amount == null ? 'Not determinable' : rupees(pm.amount)}
        />
        <Fact
          label="Formula"
          value={
            pm.percentOfRevenue == null && pm.floor == null
              ? '—'
              : [
                  pm.percentOfRevenue != null
                    ? `${pm.percentOfRevenue}% of ${pm.measureLabel}`
                    : null,
                  pm.floor != null ? `${rupees(pm.floor)} floor` : null,
                ]
                  .filter(Boolean)
                  .join(', whichever is higher — ')
          }
        />
        <Fact label={pm.measureLabel} value={rupees(pm.measureAmount)} />
        <Fact label="Rule" value={pm.ruleCode ?? '—'} />
      </dl>
      <p className="text-ink">{pm.basis}</p>
      <p className="text-xs text-ink-faint">{pm.auditMaterialityNote}</p>
    </div>
  );
}

/** The §17 system summary above SCH-06. */
function ConclusionSummary({ sch }: { sch: StatutoryAuditScheduleIii }): JSX.Element {
  const d = sch.detail;
  const fv = d?.frameworkVersion;
  const fr = sch.baseFacts.reportingFramework;
  const sp = d?.specialised;
  return (
    <dl className="grid gap-3 sm:grid-cols-4">
      <Fact
        label="Financial Reporting Framework"
        value={fr ? (REPORTING_FRAMEWORK_LABEL[fr as ReportingFrameworkOutcome] ?? fr) : '—'}
      />
      <Fact label="Schedule III" value={outcomeLabel(sch.assessment.systemOutcome)} />
      <Fact
        label="Schedule III version"
        value={
          fv
            ? `${fv.versionLabel}${sch.auditFinancialYear ? ` — applicable to FY ${sch.auditFinancialYear}` : ''}`
            : '—'
        }
      />
      <Fact
        label="Cash Flow Statement"
        value={
          d?.cashFlow
            ? CASH_FLOW_STATUS_LABEL[d.cashFlow.status]
            : d
              ? d.cashFlowRequired
                ? 'Required'
                : 'Exempt'
              : '—'
        }
      />
      <Fact
        label="Rounding framework"
        value={
          d?.rounding
            ? `${d.rounding.selectedUnit ?? d.rounding.systemUnit ?? '—'} (${
                d.rounding.overridden ? 'overridden' : 'system-determined'
              })`
            : '—'
        }
      />
      <Fact
        label="Specialised statutory format"
        value={
          sp
            ? sp.answer === 'yes'
              ? 'Yes'
              : sp.answer === 'no'
                ? 'No'
                : SCH_ANSWER_LABEL[sp.systemSuggested]
            : '—'
        }
      />
      <Fact label="Disclosure library" value={fv ? `${fv.title} / ${fv.versionLabel}` : '—'} />
      <Fact label="FS template" value={templateTitle(fv?.templateKey)} />
    </dl>
  );
}

function ProfessionalConclusion({
  sch,
  disabled,
  canManage,
  onDecide,
  onPartnerApprove,
  partnerBusy,
}: {
  sch: StatutoryAuditScheduleIii;
  disabled: boolean;
  canManage: boolean;
  onDecide: (b: Decision) => void;
  onPartnerApprove: (note: string) => void;
  partnerBusy: boolean;
}): JSX.Element {
  const a = sch.assessment;
  const [mode, setMode] = useState<'none' | 'override' | 'pending'>('none');
  const [conclusion, setConclusion] = useState('');
  const [basis, setBasis] = useState('');
  const [technical, setTechnical] = useState('');
  const [pending, setPending] = useState('');
  const [note, setNote] = useState('');
  const decided = decidedState(a.state);
  const decisive = SCHEDULE_III_CONCLUSIONS.includes(a.systemOutcome as ScheduleIiiOutcome);
  const pa = sch.partnerApproval;
  const blocking = sch.detail?.missingFacts ?? [];

  return (
    <div className="space-y-3 text-sm">
      {decided ? (
        <p className="text-ink">
          <span className="font-semibold">{outcomeLabel(a.conclusion)}</span>
          {a.isOverridden ? ' — overrides the system assessment' : ' — system assessment confirmed'}
          {a.decidedByName && ` · ${a.decidedByName}`}
          {a.decidedAt && ` · ${formatDate(a.decidedAt)}`}
          {a.isOverridden && (
            <span className="block text-ink-muted">
              System conclusion retained: {outcomeLabel(a.systemOutcome)}
            </span>
          )}
          {a.basis && <span className="block text-ink-muted">Reason: {a.basis}</span>}
          {a.isOverridden && sch.capturedFacts?.technicalBasis && (
            <span className="block text-ink-muted">
              Technical basis: {sch.capturedFacts.technicalBasis}
            </span>
          )}
        </p>
      ) : sch.professionalAction === 'information_pending' ? (
        <div className="text-warning-700">
          <p>Information Pending — {sch.pendingReason}</p>
          {blocking.length > 0 && (
            <ul className="ml-5 list-disc text-xs">
              {blocking.map((m) => (
                <li key={m.key}>
                  {m.label} ({m.source})
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-ink-muted">Not concluded yet.</p>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled || !decisive}
            title={
              decisive ? undefined : 'The system could not determine the presentation framework'
            }
            onClick={() => onDecide({ action: 'confirm' })}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Assessment
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            aria-expanded={mode === 'override'}
            onClick={() => setMode(mode === 'override' ? 'none' : 'override')}
          >
            Override
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            aria-expanded={mode === 'pending'}
            onClick={() => setMode(mode === 'pending' ? 'none' : 'pending')}
          >
            Information Pending
          </Button>
        </div>
      )}

      {mode === 'override' && (
        <div className="space-y-2 rounded-md border border-line p-3">
          <Field label="Presentation framework" required>
            <Select value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
              <option value="">Select…</option>
              {SCHEDULE_III_CONCLUSIONS.map((o) => (
                <option key={o} value={o}>
                  {SCHEDULE_III_OUTCOME_LABEL[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (mandatory)" required>
            <Textarea rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
          <Field
            label="Technical basis (mandatory)"
            required
            hint="An override always needs Engagement Partner approval; the system conclusion is retained."
          >
            <Textarea rows={2} value={technical} onChange={(e) => setTechnical(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={disabled || !conclusion || !basis.trim() || !technical.trim()}
            onClick={() => {
              onDecide({
                action: 'override',
                conclusion: conclusion as ScheduleIiiOutcome,
                basis: basis.trim(),
                technicalBasis: technical.trim(),
              });
              setMode('none');
            }}
          >
            Record override
          </Button>
        </div>
      )}

      {mode === 'pending' && (
        <div className="space-y-2 rounded-md border border-line p-3">
          <Field label="Which information is pending?" required>
            <Input value={pending} onChange={(e) => setPending(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={disabled || !pending.trim()}
            onClick={() => {
              onDecide({ action: 'information_pending', pendingReason: pending.trim() });
              setMode('none');
            }}
          >
            Mark Information Pending
          </Button>
        </div>
      )}

      {pa?.required && (
        <div className="rounded-md border border-line bg-surface-sunken p-3">
          <p className="flex items-center gap-1.5 font-medium text-ink">
            <ShieldCheck className="h-4 w-4" /> Engagement Partner approval
          </p>
          <p className="text-xs text-ink-muted">{pa.reason}</p>
          {pa.approvedAt ? (
            <p className="text-success-700">
              Approved by {pa.approvedByName ?? 'the Engagement Partner'} ·{' '}
              {formatDate(pa.approvedAt)}
              {pa.note && ` — ${pa.note}`}
            </p>
          ) : sch.viewerIsPartner && canManage ? (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <Field label="Approval note (optional)">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>
              <Button
                size="sm"
                disabled={partnerBusy}
                onClick={() => onPartnerApprove(note.trim())}
              >
                Approve as Engagement Partner
              </Button>
            </div>
          ) : (
            <p className="text-warning-700">Awaiting Engagement Partner approval.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────

function Section({
  id,
  title,
  open: initial = false,
  children,
}: {
  id: string;
  title: string;
  open?: boolean;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(initial);
  return (
    <Card id={id} className="scroll-mt-2 p-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-2.5 text-left"
      >
        <ExpandToggle open={open} />
        <span className="text-sm font-semibold text-ink">{title}</span>
      </button>
      {open && <div className="mt-3 space-y-3 pl-7">{children}</div>}
    </Card>
  );
}

/** A checklist question's own evidence (SCH-02 / SCH-04), expanding in place. */
function QuestionEvidence({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-primary-600 hover:underline"
      >
        {open ? '−' : '+'} {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="text-sm text-ink">{value ?? '—'}</dd>
    </div>
  );
}
