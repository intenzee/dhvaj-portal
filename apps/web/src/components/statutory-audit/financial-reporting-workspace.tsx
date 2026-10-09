'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import {
  APPLICABILITY_TYPE_LABEL,
  ENTITY_BRANCH_LABEL,
  REPORTING_FRAMEWORK_CONCLUSIONS,
  REPORTING_FRAMEWORK_LABEL,
  SMC_STATUS_LABEL,
  SPECIAL_ENTITY_LABEL,
  type FrfAnswer,
  type FrfTestResult,
  type PriorFramework,
  type ReportingFrameworkOutcome,
  type SetFinancialReportingFactsInput,
  type SpecialEntityType,
  type StatutoryAuditFinancialReporting,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { FrameworkEvidence } from './framework-evidence';
import { FrameworkReferences } from './framework-references';
import { FinancialReportingDownstream } from './framework-downstream';

/**
 * 02.2 Financial Reporting Framework workspace (Section 02.2 Web Developer
 * Specification §5–§21). One screen: header status, System Assessment (§14),
 * the facts used (clickable to their source), the 02.2A–H tests (framework
 * history, voluntary adoption, entity branch, roadmap & net worth, group,
 * listing / SME, NBFC), the SMC sub-assessment (§16), first-time adoption
 * (FRF-06), the Professional Conclusion (FRF-05) with Partner approval,
 * the §21 completion checklist, evidence / technical memo and downstream
 * impact. Every limit shown comes from the Rules Library via the API; every
 * reference resolves from the central Provision Library. Sections expand in
 * place — never a pop-up.
 */

const FY_RE = /^\d{4}-\d{2}$/;

const ANSWER_LABEL: Record<FrfAnswer, string> = {
  yes: 'Yes',
  no: 'No',
  pending: 'Information Pending',
};
const ANSWERS = ['yes', 'no', 'pending'] as const;
const PRIOR_LABEL: Record<PriorFramework, string> = {
  ind_as: 'Ind AS',
  accounting_standards: 'AS',
  not_available: 'Not Available',
};
const PRIORS = ['ind_as', 'accounting_standards', 'not_available'] as const;

const RESULT_LABEL: Record<FrfTestResult, string> = {
  met: 'Met',
  not_met: 'Not Met',
  information_insufficient: 'Information Insufficient',
  not_applicable: 'Not applicable',
  review_required: 'Review required',
};
const RESULT_TONE: Record<FrfTestResult, string> = {
  met: 'success',
  not_met: 'neutral',
  information_insufficient: 'warn',
  not_applicable: 'neutral',
  review_required: 'warn',
};
const EFFECT_LABEL = {
  triggers: 'Triggers Ind AS',
  no_trigger: 'No trigger',
  review_required: 'Review required',
} as const;
const REL_LABEL = {
  holding: 'Holding',
  subsidiary: 'Subsidiary',
  joint_venture: 'JV',
  associate: 'Associate',
} as const;
const FRAMEWORK_LABEL_SHORT = {
  ind_as: 'Ind AS',
  accounting_standards: 'AS',
  unknown: 'Unknown',
} as const;
const CONFIDENCE_LABEL = {
  determined: 'Determined',
  information_pending: 'Information Pending',
  professional_review_required: 'Professional Review Required',
} as const;

const crore = (v: number | null | undefined) =>
  v == null ? '—' : `₹${(v / 10_000_000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} crore`;
const outcomeLabel = (o: string | null | undefined) =>
  o ? (REPORTING_FRAMEWORK_LABEL[o as ReportingFrameworkOutcome] ?? o) : '—';
const decidedState = (s: string) =>
  s === 'applicable' || s === 'not_applicable' || s === 'overridden' || s === 'approved';

/** Scroll to a source field; 02.1 card anchors fall back to the 02.1 section. */
function goTo(anchor: string | null): void {
  if (!anchor) return;
  const el =
    document.getElementById(anchor) ??
    (anchor.startsWith('profile-card-') ? document.getElementById('framework-02-1') : null);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function FinancialReportingWorkspace({
  engagementId,
  fr,
  canManage,
}: {
  engagementId: string;
  fr: StatutoryAuditFinancialReporting;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/engagements/${engagementId}/statutory-audit/${fr.workflowInstanceId}/financial-reporting`;
  const a = fr.assessment;
  const d = fr.detail;
  const c = fr.capturedFacts;
  const decided = decidedState(a.state);
  const approved = fr.approved ?? a.state === 'approved';
  const editable = canManage && !approved;
  const effectiveOn = fr.baseFacts.auditPeriodStart;
  const framework = (decided ? a.conclusion : a.systemOutcome) as string | null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  const fail = (e: unknown, what: string) =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`);

  const facts = useMutation({
    mutationFn: (body: Omit<SetFinancialReportingFactsInput, 'version'>) =>
      apiFetch<StatutoryAuditFinancialReporting>(`${base}/facts`, {
        method: 'POST',
        body: { ...body, version: a.version },
      }),
    onSuccess: () => {
      toast(decided ? 'Saved — the conclusion must be recorded again.' : 'Saved.');
      refresh();
    },
    onError: (e) => fail(e, 'save'),
  });
  const firstTime = useMutation({
    mutationFn: (body: { firstTimeAdoption: boolean; firstTimeAdoptionReason?: string | null }) =>
      apiFetch(`${base}/facts`, { method: 'POST', body: { ...body, version: a.version } }),
    onSuccess: () => {
      toast('First-time adoption recorded.');
      refresh();
    },
    onError: (e) => fail(e, 'record first-time adoption'),
  });
  const decision = useMutation({
    mutationFn: (body: {
      action: 'confirm' | 'override' | 'information_pending';
      conclusion?: string;
      basis?: string;
      pendingReason?: string;
    }) => apiFetch(`${base}/decision`, { method: 'POST', body: { ...body, version: a.version } }),
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
  const save = (body: Omit<SetFinancialReportingFactsInput, 'version'>) => facts.mutate(body);
  const busy = facts.isPending || decision.isPending || partner.isPending || firstTime.isPending;
  const disabled = !editable || busy;

  const completion = fr.completion;
  const status = approved
    ? 'Approved (Section 02)'
    : completion?.complete
      ? '02.2 COMPLETE'
      : completion?.status === 'not_started'
        ? 'Not started'
        : 'In progress';

  return (
    <div className="space-y-3" data-testid="frf-workspace">
      {/* Header (§5) */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm">
        <span className="font-semibold text-ink">Financial Reporting Framework</span>
        <Badge tone={completion?.complete || approved ? 'success' : 'warn'}>{status}</Badge>
        <span className="text-ink-muted">
          Current conclusion:{' '}
          <span className="font-medium text-ink">
            {decided
              ? outcomeLabel(a.conclusion)
              : fr.professionalAction === 'information_pending'
                ? 'Information Pending'
                : 'Not concluded'}
          </span>
        </span>
        {a.needsReevaluation && <Badge tone="warn">02.1 changed — re-evaluate</Badge>}
        {fr.blockingReviewOpen && <Badge tone="danger">Framework Review open (blocking)</Badge>}
      </div>

      {/* System Assessment (§5, §14) */}
      <Section id="frf-system" title="System Assessment" open>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Fact label="Framework" value={outcomeLabel(a.systemOutcome)} />
          <Fact
            label="Applicability type"
            value={d?.applicabilityType ? APPLICABILITY_TYPE_LABEL[d.applicabilityType] : '—'}
          />
          <Fact label="Effective from" value={d?.effectiveFromFy ? `FY ${d.effectiveFromFy}` : '—'} />
          <Fact label="Primary trigger" value={d?.primaryTrigger ?? '—'} />
          <Fact label="Limit applied" value={d?.limitApplied ?? '—'} />
          <Fact
            label="Confidence / status"
            value={d?.confidence ? CONFIDENCE_LABEL[d.confidence] : '—'}
          />
        </dl>
        {(d?.secondaryTriggers ?? []).length > 0 && (
          <div className="text-xs text-ink-muted">
            Secondary triggers:
            <ul className="ml-4 list-disc">
              {d!.secondaryTriggers!.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
        {a.systemBasis && <p className="text-sm text-ink">{a.systemBasis}</p>}
        <RulesTable rules={d?.rulesApplied ?? []} triggeredOnly />
        <FrameworkReferences
          contextKey="02.2"
          anchors={['indas_applicability']}
          provisionIds={a.authorityProvisionId ? [a.authorityProvisionId] : []}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Facts used (§5, §14) + missing facts (§15) */}
      <Section id="frf-facts" title="Facts used" open>
        {(d?.missingFacts ?? []).length > 0 && (
          <div className="rounded-md border border-warning-200 bg-warning-50 p-2 text-sm text-warning-700">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-4 w-4" /> Information prevents determination:
            </p>
            <ul className="ml-5 list-disc">
              {d!.missingFacts!.map((m) => (
                <li key={m.key}>
                  {m.label} —{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => goTo(m.anchor)}
                  >
                    {m.source}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="divide-y divide-line text-sm">
          {(d?.factsUsed ?? []).map((f) => (
            <li key={f.key} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
              <span className="text-ink-muted">{f.label}</span>
              <span className="text-ink">{f.value}</span>
              <button
                type="button"
                className="text-xs text-primary-600 underline"
                onClick={() => goTo(f.anchor)}
              >
                {f.source}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {/* 02.2A Framework history (§6) */}
      <Section id="frf-01" title="02.2A Framework history / continuing applicability">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="FRF-01 Framework followed in the immediately preceding year"
            hint={
              fr.baseFacts.priorFrameworkSource
                ? `Source: ${fr.baseFacts.priorFrameworkSource}`
                : 'No prior-year file on the portal — record it from the financial statements.'
            }
          >
            <Select
              value={c.priorFramework ?? fr.baseFacts.priorFramework ?? ''}
              disabled={disabled}
              onChange={(e) =>
                save({
                  priorFramework: (e.target.value || null) as PriorFramework | null,
                  priorFrameworkSource:
                    e.target.value && !c.priorFrameworkSource
                      ? 'Prior-year financial statements (team)'
                      : c.priorFrameworkSource,
                })
              }
            >
              <option value="">Select…</option>
              {PRIORS.map((p) => (
                <option key={p} value={p}>
                  {PRIOR_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <div id="frf-02">
            <AnswerSelect
              label="FRF-02 Ind AS already applicable / adopted in an earlier year?"
              value={
                c.indAsAlreadyApplicable ??
                (fr.baseFacts.priorFramework === 'ind_as' || c.priorIndAs ? 'yes' : null)
              }
              hint={
                c.indAsAlreadyApplicable == null && (c.priorIndAs || fr.baseFacts.priorFramework === 'ind_as')
                  ? 'System suggested from the prior-year framework.'
                  : undefined
              }
              disabled={disabled}
              onChange={(v) => save({ indAsAlreadyApplicable: v })}
            />
          </div>
        </div>
        {(c.indAsAlreadyApplicable === 'yes' ||
          (c.indAsAlreadyApplicable == null && fr.baseFacts.priorFramework === 'ind_as')) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FyInput
              label="First Ind AS financial year"
              value={c.firstIndAsFy ?? null}
              disabled={disabled}
              onSave={(v) => save({ firstIndAsFy: v })}
            />
            <TextSave
              label="Original trigger"
              value={c.originalTrigger ?? ''}
              disabled={disabled}
              onSave={(v) => save({ originalTrigger: v || null })}
            />
          </div>
        )}
        <FrameworkReferences contextKey="02.2" anchors={['rule_4']} effectiveOn={effectiveOn} />
      </Section>

      {/* 02.2B Voluntary adoption (§7) */}
      <Section id="frf-03" title="02.2B Voluntary adoption">
        <div className="grid gap-3 sm:grid-cols-2">
          <AnswerSelect
            label="FRF-03 Has the company voluntarily adopted Ind AS?"
            value={c.voluntaryAnswer ?? (c.voluntaryIndAs ? 'yes' : null)}
            disabled={disabled}
            onChange={(v) => save({ voluntaryAnswer: v })}
          />
          {(c.voluntaryAnswer === 'yes' || (c.voluntaryAnswer == null && c.voluntaryIndAs)) && (
            <FyInput
              label="First Ind AS financial year (required)"
              value={c.voluntaryFirstIndAsFy ?? null}
              disabled={disabled}
              onSave={(v) => save({ voluntaryFirstIndAsFy: v })}
            />
          )}
        </div>
        <FrameworkReferences contextKey="02.2" anchors={['rule_4_1_i']} effectiveOn={effectiveOn} />
      </Section>

      {/* 02.2C Entity category branch (§8) — display only */}
      <Section id="frf-branch" title="02.2C Entity category branch">
        <dl className="grid gap-3 sm:grid-cols-3">
          <Fact
            label="Branch"
            value={d?.entityBranch ? ENTITY_BRANCH_LABEL[d.entityBranch] : '—'}
          />
          <Fact
            label="Company type"
            value={
              fr.baseFacts.isCompany == null
                ? '—'
                : fr.baseFacts.isCompany
                  ? fr.baseFacts.isPrivateCompany
                    ? 'Private company'
                    : 'Public company'
                  : 'Not a company'
            }
          />
          <Fact
            label="Special classification (02.1)"
            value={
              (fr.baseFacts.specialEntityTypes ?? [])
                .map((t) => SPECIAL_ENTITY_LABEL[t as SpecialEntityType] ?? t)
                .join(', ') || 'None'
            }
          />
        </dl>
        <p className="text-xs text-ink-faint">From 02.1 — correct it there, not here.</p>
      </Section>

      {/* 02.2D/E Roadmap + net worth (§9, §10) */}
      <Section id="frf-net-worth" title="02.2D–E Ind AS roadmap and net worth">
        {d?.netWorth && (
          <dl className="grid gap-3 sm:grid-cols-3">
            <Fact label="Applicable net worth" value={crore(d.netWorth.value)} />
            <Fact
              label="Measurement date"
              value={d.netWorth.measurementDate ? formatDate(d.netWorth.measurementDate) : '—'}
            />
            <Fact label="Source" value={d.netWorth.source ?? '—'} />
            <Fact label="Threshold used" value={crore(d.netWorth.threshold)} />
            <Fact label="Result" value={<ResultBadge result={d.netWorth.result} />} />
            <Fact
              label="First met / applies from"
              value={
                d.netWorth.firstMetFy
                  ? `FY ${d.netWorth.firstMetFy} → FY ${d.netWorth.appliesFromFy}`
                  : '—'
              }
            />
          </dl>
        )}
        {d?.netWorth?.note && <p className="text-xs text-ink-faint">{d.netWorth.note}</p>}
        <RulesTable rules={(d?.rulesApplied ?? []).filter((r) => r.ruleCode.startsWith('FRF_INDAS_'))} />
        <FrameworkReferences contextKey="02.2" anchors={['rule_4', 'net_worth']} effectiveOn={effectiveOn} />
      </Section>

      {/* 02.2F Group relationships (§11) */}
      <Section id="frf-group" title="02.2F Group relationship test">
        {(d?.group?.rows ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">No group companies on record in 02.1.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th>Related entity</th>
                <th>Relationship</th>
                <th>Framework / status</th>
                <th>Effect on this company</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d!.group!.rows.map((r) => (
                <tr key={`${r.relatedEntity}-${r.relationship}`}>
                  <td className="py-1">{r.relatedEntity}</td>
                  <td>{REL_LABEL[r.relationship]}</td>
                  <td>
                    {FRAMEWORK_LABEL_SHORT[r.relatedFramework]}
                    {r.relatedFrameworkSource && (
                      <span className="text-xs text-ink-faint"> · {r.relatedFrameworkSource}</span>
                    )}
                  </td>
                  <td>{EFFECT_LABEL[r.effect]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d?.group?.path && <p className="text-sm text-ink">Path: {d.group.path}</p>}
        <AnswerSelect
          label="Does a group relationship pull this company into Ind AS? (team confirmation)"
          value={c.groupAnswer ?? (c.groupTriggersIndAs ? 'yes' : null)}
          hint={
            d?.group?.result === 'review_required'
              ? 'A related company’s framework is unknown — confirm the group test.'
              : undefined
          }
          disabled={disabled}
          onChange={(v) => save({ groupAnswer: v })}
        />
        <FrameworkReferences contextKey="02.2" anchors={['group_applicability']} effectiveOn={effectiveOn} />
      </Section>

      {/* 02.2G Listing / SME (§12, FRF-04) */}
      <Section id="frf-04" title="02.2G Listing / SME exchange test">
        <dl className="grid gap-3 sm:grid-cols-3">
          <Fact
            label="FRF-04 Listing status used"
            value={
              { listed: 'Listed', in_process: 'In process of listing', unlisted: 'Unlisted' }[
                d?.listing?.status ?? fr.baseFacts.listingStatus ?? 'unlisted'
              ]
            }
          />
          <Fact
            label="Exchange / type"
            value={(d?.listing?.exchanges ?? []).map((x) => x.toUpperCase()).join(', ') || '—'}
          />
          <Fact
            label="SME / ITP proviso"
            value={d?.listing?.provisoApplies ? 'Applies — mandatory roadmap excluded' : 'Does not apply'}
          />
        </dl>
        {d?.listing?.note && <p className="text-xs text-ink-faint">{d.listing.note}</p>}
        {fr.baseFacts.listingStatus !== 'unlisted' && (
          <label className="inline-flex items-center gap-1.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={c.isListedOnSmeExchange}
              disabled={disabled}
              onChange={(e) => save({ isListedOnSmeExchange: e.target.checked })}
            />
            Listed / in process only on an SME exchange or the Institutional Trading Platform
          </label>
        )}
        <FrameworkReferences contextKey="02.2" anchors={['rule_4_proviso']} effectiveOn={effectiveOn} />
      </Section>

      {/* 02.2H NBFC (§13) */}
      {d?.entityBranch === 'nbfc' && (
        <Section id="frf-nbfc" title="02.2H NBFC branch">
          <p className="text-sm text-ink">
            NBFC = Yes — the NBFC roadmap (Rule 4(1)(iv)) is used, not the ordinary company roadmap.
          </p>
          <RulesTable rules={(d.rulesApplied ?? []).filter((r) => r.ruleCode.includes('NBFC'))} />
          <FrameworkReferences contextKey="02.2" anchors={['rule_4_nbfc']} effectiveOn={effectiveOn} />
        </Section>
      )}

      {/* SMC sub-assessment (§16) */}
      {framework === 'accounting_standards' && (
        <Section id="frf-smc" title="If AS applies — SMC sub-assessment" open>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Fact label="AS framework" value="Applicable" />
            <Fact
              label="SMC status"
              value={SMC_STATUS_LABEL[d?.smc?.status ?? d?.smcStatus ?? 'not_applicable']}
            />
            <Fact
              label="Turnover used"
              value={`${crore(d?.smc?.turnover)}; threshold ${crore(d?.smc?.turnoverThreshold)}`}
            />
            <Fact
              label="Maximum borrowings used"
              value={`${crore(d?.smc?.borrowings)}; threshold ${crore(d?.smc?.borrowingsThreshold)}`}
            />
          </dl>
          <ul className="space-y-1 text-sm">
            {(d?.smc?.conditions ?? []).map((cond) => (
              <li key={cond.key} className="flex flex-wrap items-center gap-2">
                <ResultBadge result={cond.result} />
                <span className="text-ink">{cond.label}</span>
                <span className="text-xs text-ink-faint">{cond.detail}</span>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <AnswerSelect
              label="Holding / subsidiary of a non-SMC company?"
              value={c.groupNonSmc ?? null}
              disabled={disabled}
              onChange={(v) => save({ groupNonSmc: v })}
            />
            <NumberSave
              label="Maximum borrowings at any time in the preceding year (₹)"
              value={c.smcMaxBorrowings ?? null}
              disabled={disabled}
              onSave={(v) => save({ smcMaxBorrowings: v })}
            />
          </div>
          <p className="text-xs text-ink-faint">
            SMC is a classification within the AS route — not the Companies Act “small company”
            test in 02.1.
          </p>
          <FrameworkReferences
            contextKey="02.2"
            anchors={['smc_definition', 'as_rules']}
            provisionIds={d?.smc?.authorityProvisionId ? [d.smc.authorityProvisionId] : []}
            effectiveOn={effectiveOn}
          />
        </Section>
      )}

      {/* First-time Ind AS adoption (§17, FRF-06) */}
      {framework === 'ind_as' && (
        <Section id="frf-06" title="First-time Ind AS adoption (FRF-06)" open>
          <FirstTimeAdoption fr={fr} disabled={disabled} onSave={(b) => firstTime.mutate(b)} />
          <FrameworkReferences contextKey="02.2" anchors={['indas_101']} effectiveOn={effectiveOn} />
        </Section>
      )}

      {/* Professional Conclusion (§15, FRF-05) */}
      <Section id="frf-05" title="Professional Conclusion (FRF-05)" open>
        <ProfessionalConclusion
          fr={fr}
          disabled={disabled}
          onDecide={(b) => decision.mutate(b)}
          onPartnerApprove={(note) => partner.mutate(note)}
          partnerBusy={partner.isPending}
          canManage={canManage && !approved}
        />
      </Section>

      {/* Completion (§21) */}
      <Section id="frf-completion" title="Completion" open>
        <ul className="space-y-1 text-sm">
          {(completion?.items ?? [])
            .filter((i) => i.met !== null)
            .map((i) => (
              <li key={i.key} className="flex flex-wrap items-baseline gap-2">
                {i.met ? (
                  <CheckCircle2 className="h-4 w-4 self-center text-success-600" aria-label="Done" />
                ) : (
                  <AlertTriangle className="h-4 w-4 self-center text-warning-600" aria-label="Open" />
                )}
                <span className={i.met ? 'text-ink' : 'text-warning-700'}>{i.label}</span>
                {i.detail && <span className="text-xs text-ink-faint">{i.detail}</span>}
              </li>
            ))}
        </ul>
        {completion?.complete && (
          <p className="text-sm font-medium text-success-700">
            02.2 COMPLETE — the approved framework and rule metadata pass to 02.3–02.9.
          </p>
        )}
      </Section>

      {/* Evidence / Technical memo (§18) */}
      <Section id="frf-evidence" title="Evidence / Technical memo">
        <FrameworkEvidence
          engagementId={engagementId}
          workflowInstanceId={fr.workflowInstanceId}
          subAssessmentId={a.id}
          memoSuggested={fr.memoSuggested ?? false}
          readOnly={!editable}
        />
      </Section>

      {/* Downstream impact (§5, §19) */}
      <Section id="frf-downstream" title="Downstream impact">
        <FinancialReportingDownstream
          engagementId={engagementId}
          workflowInstanceId={fr.workflowInstanceId}
        />
      </Section>
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

function Fact({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="text-sm text-ink">{value ?? '—'}</dd>
    </div>
  );
}

function ResultBadge({ result }: { result: FrfTestResult }): JSX.Element {
  return <Badge tone={RESULT_TONE[result]}>{RESULT_LABEL[result]}</Badge>;
}

function RulesTable({
  rules,
  triggeredOnly = false,
}: {
  rules: NonNullable<StatutoryAuditFinancialReporting['detail']>['rulesApplied'];
  triggeredOnly?: boolean;
}): JSX.Element | null {
  const shown = (rules ?? []).filter((r) => !triggeredOnly || r.result !== 'not_triggered');
  if (shown.length === 0) return null;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
        <tr>
          <th>Rule</th>
          <th>Limit / condition</th>
          <th>Effective</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {shown.map((r) => (
          <tr key={`${r.ruleCode}-${r.ruleVersionId}`}>
            <td className="py-1 font-mono text-xs">{r.ruleCode}</td>
            <td>{r.label}</td>
            <td>{formatDate(r.effectiveFrom)}</td>
            <td>
              {r.result === 'triggered'
                ? 'Applied'
                : r.result === 'exception_applied'
                  ? 'Exception applied'
                  : 'Not met'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AnswerSelect({
  label,
  value,
  hint,
  disabled,
  onChange,
}: {
  label: string;
  value: FrfAnswer | null;
  hint?: string;
  disabled: boolean;
  onChange: (v: FrfAnswer | null) => void;
}): JSX.Element {
  return (
    <Field label={label} hint={hint}>
      <Select
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange((e.target.value || null) as FrfAnswer | null)}
      >
        <option value="">Select…</option>
        {ANSWERS.map((o) => (
          <option key={o} value={o}>
            {ANSWER_LABEL[o]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function FyInput({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  onSave: (v: string | null) => void;
}): JSX.Element {
  const [v, setV] = useState(value ?? '');
  const invalid = v !== '' && !FY_RE.test(v);
  return (
    <Field label={label} hint={invalid ? 'Use the form YYYY-YY, e.g. 2024-25.' : 'YYYY-YY'}>
      <Input
        value={v}
        placeholder="2024-25"
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (!invalid && (v || null) !== value) onSave(v || null);
        }}
      />
    </Field>
  );
}

function TextSave({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onSave: (v: string) => void;
}): JSX.Element {
  const [v, setV] = useState(value);
  return (
    <Field label={label}>
      <Input
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v.trim())}
      />
    </Field>
  );
}

function NumberSave({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onSave: (v: number | null) => void;
}): JSX.Element {
  const [v, setV] = useState(value == null ? '' : String(value));
  return (
    <Field label={label} hint="Leave blank to use the 02.1 borrowings figure.">
      <Input
        inputMode="decimal"
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = v.trim() === '' ? null : Number(v);
          if (n !== null && !Number.isFinite(n)) return;
          if (n !== value) onSave(n);
        }}
      />
    </Field>
  );
}

function FirstTimeAdoption({
  fr,
  disabled,
  onSave,
}: {
  fr: StatutoryAuditFinancialReporting;
  disabled: boolean;
  onSave: (b: { firstTimeAdoption: boolean; firstTimeAdoptionReason?: string | null }) => void;
}): JSX.Element {
  const ft = fr.firstTimeAdoption;
  const [reason, setReason] = useState(ft?.reason ?? '');
  const system = ft?.system ?? false;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-ink">
        FRF-06 Is this the company’s first annual financial statement under Ind AS? System suggests{' '}
        <span className="font-semibold">{system ? 'Yes' : 'No'}</span>
        {ft?.confirmed != null && (
          <>
            {' '}
            — recorded <span className="font-semibold">{ft.confirmed ? 'Yes' : 'No'}</span>
            {ft.confirmed !== system && ' (override)'}
          </>
        )}
        .
      </p>
      {ft?.effective && (
        <p className="text-xs text-ink-muted">
          Ind AS 101 transition work is created downstream; no transition testing happens in 02.2.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => onSave({ firstTimeAdoption: system })}
        >
          Confirm ({system ? 'Yes' : 'No'})
        </Button>
        <div className="min-w-[16rem] flex-1">
          <Field label="Override reason (required to override)">
            <Input value={reason} disabled={disabled} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || !reason.trim()}
          onClick={() => onSave({ firstTimeAdoption: !system, firstTimeAdoptionReason: reason.trim() })}
        >
          Override to {system ? 'No' : 'Yes'}
        </Button>
      </div>
    </div>
  );
}

function ProfessionalConclusion({
  fr,
  disabled,
  canManage,
  onDecide,
  onPartnerApprove,
  partnerBusy,
}: {
  fr: StatutoryAuditFinancialReporting;
  disabled: boolean;
  canManage: boolean;
  onDecide: (b: {
    action: 'confirm' | 'override' | 'information_pending';
    conclusion?: string;
    basis?: string;
    pendingReason?: string;
  }) => void;
  onPartnerApprove: (note: string) => void;
  partnerBusy: boolean;
}): JSX.Element {
  const a = fr.assessment;
  const [mode, setMode] = useState<'none' | 'override' | 'pending'>('none');
  const [conclusion, setConclusion] = useState<string>('');
  const [basis, setBasis] = useState('');
  const [pending, setPending] = useState('');
  const [note, setNote] = useState('');
  const decided = decidedState(a.state);
  const decisive = REPORTING_FRAMEWORK_CONCLUSIONS.includes(
    a.systemOutcome as ReportingFrameworkOutcome,
  );
  const pa = fr.partnerApproval;

  return (
    <div className="space-y-3 text-sm">
      {decided ? (
        <p className="text-ink">
          <span className="font-semibold">{outcomeLabel(a.conclusion)}</span>
          {a.isOverridden ? ' — overrides the system assessment' : ' — system assessment confirmed'}
          {a.decidedByName && ` · ${a.decidedByName}`}
          {a.decidedAt && ` · ${formatDate(a.decidedAt)}`}
          {a.basis && <span className="block text-ink-muted">Basis: {a.basis}</span>}
        </p>
      ) : fr.professionalAction === 'information_pending' ? (
        <p className="text-warning-700">Information Pending — {fr.pendingReason}</p>
      ) : (
        <p className="text-ink-muted">Not concluded yet.</p>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled || !decisive}
            title={decisive ? undefined : 'The system could not determine the framework'}
            onClick={() => onDecide({ action: 'confirm' })}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm System Assessment
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            aria-expanded={mode === 'override'}
            onClick={() => setMode(mode === 'override' ? 'none' : 'override')}
          >
            Override Assessment
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
          <Field label="Framework" required>
            <Select value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
              <option value="">Select…</option>
              {REPORTING_FRAMEWORK_CONCLUSIONS.map((o) => (
                <option key={o} value={o}>
                  {o === 'specialised_framework' ? 'Other / Specialised' : REPORTING_FRAMEWORK_LABEL[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (mandatory)" required hint="A significant override needs Engagement Partner approval.">
            <Textarea rows={3} value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={disabled || !conclusion || !basis.trim()}
            onClick={() => {
              onDecide({ action: 'override', conclusion, basis: basis.trim() });
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
          ) : fr.viewerIsPartner && canManage ? (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <Field label="Approval note (optional)">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>
              <Button size="sm" disabled={partnerBusy} onClick={() => onPartnerApprove(note.trim())}>
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
