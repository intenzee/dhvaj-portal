'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  CARO_BORROWING_DATA_BASES,
  CARO_CONCLUSIONS,
  CARO_PROVISION_CODE,
  auditPeriodStartFromFinancialYear,
  type CaroAnswer,
  type CaroBorrowingDataBasis,
  type CaroBorrowingPoint,
  type CaroConditionResult,
  type CaroContextStatus,
  type CaroOutcome,
  type CaroProfessionalAction,
  type RecordCaroDecisionInput,
  type SetCaroFactsInput,
  type StatutoryAuditCaro,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { FrameworkEvidence } from './framework-evidence';
import { FrameworkReferences } from './framework-references';

/**
 * 02.4 CARO 2020 Applicability workspace (DHVAJ 02.4 spec §4): Header, System
 * Assessment, Facts Used (read-only, Open Source Assessment), Exemption Tests
 * (CARO-01..05 and the cumulative private-company test with actual vs configured
 * limit), measurement inputs, Rule Basis (View Provision), report contexts,
 * Professional Conclusion (CARO-06 + Engagement Partner), the CARO Work
 * Programme (generated only after applicability is confirmed), evidence /
 * technical memo, Prior Year and the §19 completion checklist. Every section
 * expands in place (no pop-ups). Links resolve through the Provision Library
 * (context `02.4`) — never a URL in this component.
 */

export const CARO_REFERENCE_CONTEXT = '02.4';

/** Provision Library code → `02.4` reference anchor. */
const ANCHOR: Record<string, string> = {
  [CARO_PROVISION_CODE.order]: 'caro_order',
  [CARO_PROVISION_CODE.paragraph1]: 'caro_para_1',
  [CARO_PROVISION_CODE.guidanceNote]: 'icai_gn_caro',
  [CARO_PROVISION_CODE.section8]: 'section_8',
  [CARO_PROVISION_CODE.section2_62]: 'section_2_62',
  [CARO_PROVISION_CODE.section2_85]: 'section_2_85',
  [CARO_PROVISION_CODE.section143_11]: 'section_143_11',
};
const anchorsFor = (codes: string[]) => codes.map((c) => ANCHOR[c]).filter((a): a is string => !!a);

export const CARO_OUTCOME_LABEL: Record<CaroOutcome, string> = {
  applicable: 'CARO Applicable',
  not_applicable_exempt: 'CARO Not Applicable - Exempt',
  further_assessment: 'Further Assessment Required',
  information_insufficient: 'Information Pending',
};
const outcomeLabel = (o: string | null | undefined) =>
  o ? (CARO_OUTCOME_LABEL[o as CaroOutcome] ?? o) : '—';

const ANSWER: Record<CaroAnswer, { label: string; tone: string }> = {
  yes: { label: 'Yes', tone: 'success' },
  no: { label: 'No', tone: 'neutral' },
  pending: { label: 'Information Pending', tone: 'warn' },
};
const CONDITION: Record<CaroConditionResult, { label: string; tone: string }> = {
  satisfied: { label: 'Satisfied', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  pending: { label: 'Pending', tone: 'warn' },
  not_tested: { label: 'Not tested', tone: 'neutral' },
};
const CONTEXT: Record<CaroContextStatus, { label: string; tone: string }> = {
  applicable: { label: 'Applicable', tone: 'info' },
  not_applicable: { label: 'Not applicable', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'warn' },
};
const ROUTE: Record<string, string> = {
  non_company: 'Not a company',
  direct_exemption: 'Direct exemption',
  private_company: 'Private Company',
  public_company: 'Public Company',
  undetermined: 'Not determined',
};
const PRIVATE_EXEMPTION: Record<string, string> = {
  qualified: 'Qualified',
  not_qualified: 'Not Qualified',
  pending: 'Pending',
  not_required: 'Not required',
};
const BASIS_LABEL: Record<CaroBorrowingDataBasis, string> = {
  daily: 'Daily balances',
  monthly: 'Monthly balances',
  quarterly: 'Quarterly balances',
  year_end_only: 'Year-end only (insufficient for "any point")',
};

const isDecided = (s: string, conclusion: string | null) =>
  s === 'applicable' ||
  s === 'not_applicable' ||
  s === 'overridden' ||
  s === 'approved' ||
  s === 'reassessment_required' ||
  (s === 'professional_judgement_required' && conclusion != null);

const rupees = (v: number | null | undefined) =>
  v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`;
const crore = (v: number | null | undefined) =>
  v == null ? null : `₹${(v / 10_000_000).toFixed(2)} cr`;

/** Scroll to a source section on the same Section 02 page. */
function goTo(section: string): void {
  const id =
    section === '02.1'
      ? 'framework-02-1'
      : section === '02.6'
        ? 'framework-02-4'
        : section === '02.4'
          ? 'caro-measurement'
          : null;
  if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

type Decision = Omit<RecordCaroDecisionInput, 'version'>;

export function CaroWorkspace({
  engagementId,
  caro,
  canManage,
  programme,
  evidence,
}: {
  engagementId: string;
  caro: StatutoryAuditCaro;
  canManage: boolean;
  /** The Level-2 clause work programme (mounted once applicability is confirmed). */
  programme?: ReactNode;
  /** Evidence / technical memo panel; defaults to the shared Section 02 evidence. */
  evidence?: ReactNode;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/engagements/${engagementId}/statutory-audit/${caro.workflowInstanceId}/caro`;
  const a = caro.assessment;
  const d = caro.detail;
  const decided = isDecided(a.state, a.conclusion);
  const approved = caro.approved ?? a.state === 'approved';
  const editable = canManage && !approved;
  const fy = caro.auditFinancialYear ?? null;
  const effectiveOn = fy ? auditPeriodStartFromFinancialYear(fy) : undefined;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  const fail = (e: unknown, what: string) =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`);

  const facts = useMutation({
    mutationFn: (body: Omit<SetCaroFactsInput, 'version'>) =>
      apiFetch<StatutoryAuditCaro>(`${base}/facts`, {
        method: 'POST',
        body: { ...body, version: a.version },
      }),
    onSuccess: () => {
      toast(decided ? 'Saved — the change is flagged for re-evaluation.' : 'Saved.');
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
  const busy = facts.isPending || decision.isPending || partner.isPending;
  const disabled = !editable || busy;

  const completion = caro.completion;
  const status = approved
    ? 'Approved (Section 02)'
    : completion?.complete
      ? '02.4 COMPLETE'
      : completion?.status === 'not_started'
        ? 'Not started'
        : 'In progress';
  const conclusionOutcome = decided ? a.conclusion : null;
  const programmeReady = decided && conclusionOutcome === 'applicable';
  const cited = [
    a.authorityProvisionId,
    ...(d?.privateTest?.conditions ?? []).map((c) => c.authorityProvisionId),
  ].filter((x): x is string => !!x);
  const pt = d?.privateTest ?? null;

  return (
    <div className="space-y-3" data-testid="caro-workspace">
      {/* Header (§4) */}
      <div className="space-y-1 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">CARO 2020 Applicability</span>
          <Badge tone={completion?.complete || approved ? 'success' : 'warn'}>{status}</Badge>
          <span className="text-ink-muted">
            Current conclusion:{' '}
            <span className="font-medium text-ink">
              {decided
                ? outcomeLabel(a.conclusion)
                : caro.professionalAction === 'information_pending'
                  ? 'Information Pending'
                  : 'Not concluded'}
            </span>
          </span>
          {a.needsReevaluation && (
            <Badge tone="warn">Needs re-evaluation — a source fact changed</Badge>
          )}
          {!caro.upstreamReady && <Badge tone="neutral">Provisional — 02.1 not confirmed</Badge>}
        </div>
        <p className="text-xs text-ink-muted">
          Whether the Companies (Auditor&rsquo;s Report) Order, 2020 applies to this audit; if it
          does, the clause-by-clause work programme is instantiated. Applicability and clause
          relevance are separate decisions.
        </p>
        {(caro.reevaluation?.changes ?? []).length > 0 && (
          <ul className="ml-5 list-disc text-xs text-warning-700" aria-label="Changed source facts">
            {caro.reevaluation!.changes.map((c) => (
              <li key={c.key}>
                {c.label}: {c.before} → {c.after} — affects {c.affectedRules.join(', ')}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* System Assessment (§4, §8) */}
      <Section id="caro-system" title="System Assessment" open>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={a.systemOutcome === 'applicable' ? 'info' : 'neutral'}>
            {outcomeLabel(a.systemOutcome)}
          </Badge>
          <span className="text-ink">{a.systemBasis}</span>
        </p>
        {d && (
          <dl className="grid gap-3 sm:grid-cols-3" aria-label="Applicability conclusion">
            <Fact label="CARO result" value={outcomeLabel(d.conclusion.result)} />
            <Fact label="Entity route" value={ROUTE[d.conclusion.entityRoute]} />
            <Fact label="Direct exemption" value={d.conclusion.directExemption ?? 'None'} />
            <Fact
              label="Private-company exemption"
              value={PRIVATE_EXEMPTION[d.conclusion.privateExemption]}
            />
            <Fact label="Failed condition" value={d.conclusion.failedCondition ?? '—'} />
            <Fact label="Actual value" value={d.conclusion.actualValue ?? '—'} />
            <Fact label="Applicable configured limit" value={d.conclusion.configuredLimit ?? '—'} />
            <Fact
              label="Rule version"
              value={d.conclusion.orderVersion ?? 'No CARO version in force'}
            />
          </dl>
        )}
        <FrameworkReferences
          contextKey={CARO_REFERENCE_CONTEXT}
          anchors={['caro_order', 'icai_gn_caro']}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Facts Used (§2, §4) */}
      <Section id="caro-facts" title="Facts used" open>
        {(d?.missingFacts ?? []).length > 0 && (
          <div className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800">
            <p className="font-medium">Information Pending — blocking facts:</p>
            <ul className="ml-5 list-disc">
              {d!.missingFacts.map((m) => (
                <li key={m.key}>
                  {m.label} ({m.source})
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
              <span className="flex items-center gap-2 text-xs">
                <span className="text-ink-faint">{f.source}</span>
                {f.sourceSection !== 'master' && (
                  <button
                    type="button"
                    className="text-primary-600 underline"
                    onClick={() => goTo(f.sourceSection)}
                  >
                    Open Source Assessment
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-faint">
          Read-only — 02.1 / 02.6 facts are corrected where they are assessed, which marks 02.4 for
          re-evaluation. Captured once; never re-entered here.
        </p>
      </Section>

      {/* Exemption Tests (§5, §6) */}
      <Section id="caro-exemptions" title="Exemption tests" open>
        <p className="text-xs text-ink-muted">
          Direct exemptions run first; once one is established the private-company limits are not
          tested (facts and rules stay traceable).
        </p>
        <table className="w-full text-sm" aria-label="Direct exemption tests">
          <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="py-1">Test</th>
              <th>Question</th>
              <th>System</th>
              <th>Basis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {(d?.directTests ?? []).map((t) => (
              <tr key={t.code}>
                <td className="py-1.5 font-mono text-xs">{t.code}</td>
                <td className="pr-2">{t.question}</td>
                <td>
                  <Badge tone={ANSWER[t.answer].tone}>{ANSWER[t.answer].label}</Badge>
                  {t.decisive && <span className="ml-1 text-xs text-success-700">decides</span>}
                </td>
                <td className="space-y-1 text-xs text-ink-muted">
                  <p>{t.basis}</p>
                  <FrameworkReferences
                    contextKey={CARO_REFERENCE_CONTEXT}
                    anchors={anchorsFor(t.provisionCodes)}
                    effectiveOn={effectiveOn}
                  />
                  {t.key === 'small_company' && (
                    <button
                      type="button"
                      className="text-primary-600 underline"
                      onClick={() => goTo('02.1')}
                    >
                      Open 02.1 Small Company Assessment
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">
            Private company exemption — cumulative test
          </p>
          {!pt?.tested ? (
            <p className="text-sm text-ink-muted">
              Not run —{' '}
              {d?.conclusion.directExemption
                ? `the ${d.conclusion.directExemption.toLowerCase()} exemption already resolved the assessment.`
                : 'it applies only to a private limited company with no direct exemption.'}
            </p>
          ) : (
            <>
              <table className="w-full text-sm" aria-label="Private company cumulative test">
                <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="py-1">Condition</th>
                    <th>Current CARO 2020 test</th>
                    <th>Actual</th>
                    <th>Limit</th>
                    <th>System output</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line align-top">
                  {pt.conditions.map((c) => (
                    <tr key={c.key}>
                      <td className="py-1.5">
                        {c.label}
                        <span className="block font-mono text-[11px] text-ink-faint">
                          {c.ruleCode} v{c.ruleVersion}
                        </span>
                      </td>
                      <td className="pr-2 text-xs text-ink-muted">
                        {c.requirement}
                        {c.calculation && <span className="block">{c.calculation}</span>}
                        {c.pendingReason && (
                          <span className="block text-warning-700">{c.pendingReason}</span>
                        )}
                      </td>
                      <td>{c.actualDisplay ?? '—'}</td>
                      <td>{c.limitDisplay ?? '—'}</td>
                      <td>
                        <Badge tone={CONDITION[c.result].tone}>{CONDITION[c.result].label}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-sm">
                Private Company CARO Exemption ={' '}
                <span className="font-semibold">
                  {pt.qualified === true
                    ? 'Qualified'
                    : pt.qualified === false
                      ? 'Not Qualified'
                      : 'Pending'}
                </span>{' '}
                <span className="text-xs text-ink-muted">
                  (qualified only if every condition is satisfied)
                </span>
              </p>
            </>
          )}
        </div>
      </Section>

      {/* Measurement inputs (§6, §7) */}
      <Section id="caro-measurement" title="Measurement data (CARO basis)" open={!!pt?.tested}>
        <MeasurementForm caro={caro} disabled={disabled} onSave={(b) => facts.mutate(b)} />
      </Section>

      {/* Rule Basis (§3, §4, §21) */}
      <Section id="caro-rules" title="Rule basis">
        {(pt?.conditions ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">
            No private-company limit was used for this conclusion
            {d?.conclusion.directExemption ? ' (direct exemption)' : ''}.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="py-1">Rule ID</th>
                <th>Condition / threshold used</th>
                <th>Measurement basis</th>
                <th>Effective</th>
                <th>Guidance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {pt!.conditions.map((c) => (
                <tr key={c.key}>
                  <td className="py-1 font-mono text-xs">
                    {c.ruleCode} v{c.ruleVersion}
                  </td>
                  <td>{c.requirement}</td>
                  <td className="text-xs">{c.measurementBasis?.replace(/_/g, ' ') ?? '—'}</td>
                  <td className="text-xs">
                    {c.ruleEffectiveFrom ? `from ${formatDate(c.ruleEffectiveFrom)}` : '—'}
                  </td>
                  <td className="text-xs text-ink-muted">{c.guidanceReference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-ink-faint">
          Limits come from the versioned Rules Library for the audit period — none is hard-coded; a
          future change affects future periods only.
        </p>
        <FrameworkReferences
          contextKey={CARO_REFERENCE_CONTEXT}
          anchors={['caro_para_1']}
          provisionIds={cited}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Standalone vs consolidated (§10) */}
      <Section id="caro-contexts" title="Report contexts — standalone / consolidated" open>
        <ul className="space-y-2 text-sm">
          {(d?.reportContexts ?? []).map((c) => (
            <li key={c.context} className="flex flex-wrap items-baseline gap-2">
              <span className="w-56 font-medium text-ink">
                {c.context === 'standalone'
                  ? 'Standalone financial statements'
                  : 'Consolidated financial statements'}
              </span>
              <Badge tone={CONTEXT[c.status].tone}>{CONTEXT[c.status].label}</Badge>
              {c.scope && (
                <Badge tone="neutral">
                  {c.scope === 'paragraph_3' ? 'Paragraph 3 programme' : 'Clause 3(xxi) only'}
                </Badge>
              )}
              <span className="text-xs text-ink-muted">{c.basis}</span>
            </li>
          ))}
        </ul>
        {completion?.contexts && (
          <p className="text-xs text-ink-muted">
            02.4 COMPLETE — standalone: {completion.contexts.standalone ? 'yes' : 'no'}
            {completion.contexts.consolidated != null &&
              ` · consolidated: ${completion.contexts.consolidated ? 'yes' : 'no'}`}
          </p>
        )}
      </Section>

      {/* CARO-06 Professional Conclusion (§9) */}
      <Section id="caro-06" title="Professional Conclusion (CARO-06)" open>
        <ProfessionalConclusion
          caro={caro}
          disabled={disabled}
          canManage={canManage && !approved}
          onDecide={(b) => decision.mutate(b)}
          onPartnerApprove={(note) => partner.mutate(note)}
          partnerBusy={partner.isPending}
        />
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-primary-600">
            View all triggered CARO provisions
          </summary>
          <div className="mt-2">
            <FrameworkReferences
              contextKey={CARO_REFERENCE_CONTEXT}
              anchors={anchorsFor(d?.provisionCodes ?? [])}
              provisionIds={cited}
              effectiveOn={effectiveOn}
            />
          </div>
        </details>
      </Section>

      {/* CARO Work Programme (§4, §11) */}
      <Section id="caro-programme" title="CARO Work Programme" open>
        {programmeReady ? (
          (programme ?? (
            <p className="text-sm text-ink-muted">
              CARO applies — the versioned paragraph 3 clause programme is generated in the audit
              work areas.
            </p>
          ))
        ) : (
          <p className="text-sm text-ink-muted">
            Generated only after CARO applicability is confirmed
            {decided ? ' — the current conclusion does not require the programme.' : '.'}
          </p>
        )}
      </Section>

      {/* Evidence / Technical memo (§16) */}
      <Section id="caro-evidence" title="Evidence / technical memo" open={!!caro.memoSuggested}>
        {caro.memoSuggested && (
          <p className="text-xs text-warning-700">
            A technical memo is suggested — override, complexity or consultation.
          </p>
        )}
        {evidence ?? (
          <FrameworkEvidence
            engagementId={engagementId}
            workflowInstanceId={caro.workflowInstanceId}
            subAssessmentId={a.id}
            memoSuggested={!!caro.memoSuggested}
            readOnly={!editable}
          />
        )}
      </Section>

      {/* Prior Year (§15) */}
      <Section id="caro-prior" title="Prior year">
        {caro.priorYear ? (
          <div className="space-y-1 text-sm">
            <p>
              FY {caro.priorYear.financialYear}:{' '}
              <span className="font-medium">{outcomeLabel(caro.priorYear.outcome)}</span>
              {caro.priorYear.isOverridden && ' (overridden)'}
              {caro.priorYear.decidedAt && ` · ${formatDate(caro.priorYear.decidedAt)}`}
            </p>
            {caro.priorYear.exemptionBasis && (
              <p className="text-xs text-ink-muted">
                Prior exemption basis: {caro.priorYear.exemptionBasis}
              </p>
            )}
            {caro.priorYear.changedFacts.length > 0 && (
              <ul className="ml-5 list-disc text-xs text-warning-700">
                {caro.priorYear.changedFacts.map((c) => (
                  <li key={c.label}>
                    {c.label} changed: {c.prior} → {c.current}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-faint">
              Context only — the current-year rules always rerun; prior clause conclusions never
              conclude this year.
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No prior-year CARO assessment on record.</p>
        )}
      </Section>

      {/* Completion (§19) */}
      <Section id="caro-completion" title="Completion" open>
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
            02.4 COMPLETE — CARO metadata and work items pass to the audit work areas and Section 08
            reporting.
          </p>
        )}
      </Section>
    </div>
  );
}

// ── Measurement inputs ───────────────────────────────────────────────────────

function num(v: string): number | null {
  const t = v.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const str = (v: number | null | undefined) => (v == null ? '' : String(v));

function MeasurementForm({
  caro,
  disabled,
  onSave,
}: {
  caro: StatutoryAuditCaro;
  disabled: boolean;
  onSave: (b: Omit<SetCaroFactsInput, 'version'>) => void;
}): JSX.Element {
  const f = caro.capturedFacts;
  const [group, setGroup] = useState(
    f.isHoldingOrSubsidiaryOfPublic == null ? '' : String(f.isHoldingOrSubsidiaryOfPublic),
  );
  const [groupNote, setGroupNote] = useState(f.publicGroupNote ?? '');
  const [paidUp, setPaidUp] = useState(str(f.paidUpCapital));
  const [reserves, setReserves] = useState(str(f.reservesAndSurplus));
  const [capTotal, setCapTotal] = useState(str(f.capitalPlusReserves));
  const [dataBasis, setDataBasis] = useState<string>(f.borrowingDataBasis ?? '');
  const [peak, setPeak] = useState(str(f.peakBankFiBorrowings));
  const [schedule, setSchedule] = useState<CaroBorrowingPoint[]>(f.borrowingSchedule ?? []);
  const [rfo, setRfo] = useState(str(f.revenueFromOperations));
  const [other, setOther] = useState(str(f.otherIncome));
  const [disc, setDisc] = useState(str(f.discontinuedOperationsRevenue));
  const [revTotal, setRevTotal] = useState(str(f.totalRevenue));
  const [row, setRow] = useState<CaroBorrowingPoint>({
    asOn: '',
    lender: '',
    lenderType: 'bank',
    amount: 0,
  });

  const masterTotal = (label: string) =>
    caro.masterFacts.find((m) => m.label === label)?.source ?? null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          isHoldingOrSubsidiaryOfPublic: group === '' ? null : group === 'true',
          publicGroupNote: groupNote.trim() || null,
          paidUpCapital: num(paidUp),
          reservesAndSurplus: num(reserves),
          capitalPlusReserves: num(capTotal),
          borrowingDataBasis: (dataBasis || null) as CaroBorrowingDataBasis | null,
          peakBankFiBorrowings: num(peak),
          borrowingSchedule: schedule.length ? schedule : null,
          revenueFromOperations: num(rfo),
          otherIncome: num(other),
          discontinuedOperationsRevenue: num(disc),
          totalRevenue: num(revTotal),
        });
      }}
    >
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={disabled}>
        <legend className="mb-1 text-xs font-semibold text-ink">
          Public-company group relationship
        </legend>
        <Field
          label="Holding or subsidiary company of a public company?"
          hint={masterTotal('Holding / subsidiary of a public company') ?? 'Relevant period'}
        >
          <Select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Not confirmed (Pending)</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </Field>
        <Field label="Relationship note">
          <Input value={groupNote} onChange={(e) => setGroupNote(e.target.value)} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3" disabled={disabled}>
        <legend className="mb-1 text-xs font-semibold text-ink">
          Paid-up capital + reserves &amp; surplus (balance-sheet date)
        </legend>
        <MoneyField label="Paid-up capital (₹)" value={paidUp} onChange={setPaidUp} />
        <MoneyField
          label="Reserves & surplus (₹)"
          value={reserves}
          onChange={setReserves}
          allowNegative
        />
        <MoneyField
          label="Or the total (₹)"
          hint="Used when the components are not split (e.g. from the client master)."
          value={capTotal}
          onChange={setCapTotal}
        />
      </fieldset>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="mb-1 text-xs font-semibold text-ink">
          Bank / FI borrowings — aggregate at any point during the year
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Data available"
            hint="Year-end balances alone cannot satisfy an 'any point' test."
          >
            <Select value={dataBasis} onChange={(e) => setDataBasis(e.target.value)}>
              <option value="">Not stated</option>
              {CARO_BORROWING_DATA_BASES.map((b) => (
                <option key={b} value={b}>
                  {BASIS_LABEL[b]}
                </option>
              ))}
            </Select>
          </Field>
          <MoneyField
            label="Aggregate peak (₹), when no schedule is entered"
            value={peak}
            onChange={setPeak}
          />
        </div>
        <table className="w-full text-sm" aria-label="Borrowing balance schedule">
          <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="py-1">As on</th>
              <th>Lender</th>
              <th>Type</th>
              <th>Outstanding</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {schedule.map((p, i) => (
              <tr key={`${p.asOn}-${p.lender}-${i}`}>
                <td className="py-1">{formatDate(p.asOn)}</td>
                <td>{p.lender}</td>
                <td>{p.lenderType === 'bank' ? 'Bank' : 'Financial institution'}</td>
                <td>{rupees(p.amount)}</td>
                <td>
                  <button
                    type="button"
                    aria-label={`Remove ${p.lender} ${p.asOn}`}
                    className="text-ink-faint hover:text-danger-600"
                    onClick={() => setSchedule(schedule.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-1 pr-1">
                <Input
                  type="date"
                  aria-label="As on"
                  value={row.asOn}
                  onChange={(e) => setRow({ ...row, asOn: e.target.value })}
                />
              </td>
              <td className="pr-1">
                <Input
                  aria-label="Lender"
                  value={row.lender}
                  onChange={(e) => setRow({ ...row, lender: e.target.value })}
                />
              </td>
              <td className="pr-1">
                <Select
                  aria-label="Lender type"
                  value={row.lenderType}
                  onChange={(e) =>
                    setRow({
                      ...row,
                      lenderType: e.target.value as CaroBorrowingPoint['lenderType'],
                    })
                  }
                >
                  <option value="bank">Bank</option>
                  <option value="financial_institution">Financial institution</option>
                </Select>
              </td>
              <td className="pr-1">
                <Input
                  type="number"
                  min={0}
                  aria-label="Outstanding (₹)"
                  value={row.amount ? String(row.amount) : ''}
                  onChange={(e) => setRow({ ...row, amount: Number(e.target.value) || 0 })}
                />
              </td>
              <td>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label="Add balance"
                  disabled={!row.asOn || !row.lender.trim()}
                  onClick={() => {
                    setSchedule([...schedule, { ...row, lender: row.lender.trim() }]);
                    setRow({ asOn: '', lender: '', lenderType: row.lenderType, amount: 0 });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-ink-faint">
          Balances on the same date are added across banks and financial institutions; the peak
          aggregate is tested (fluctuating facilities included).
        </p>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-4" disabled={disabled}>
        <legend className="mb-1 text-xs font-semibold text-ink">
          Total revenue (CARO basis, incl. discontinuing operations)
        </legend>
        <MoneyField label="Revenue from operations (₹)" value={rfo} onChange={setRfo} />
        <MoneyField label="Other income (₹)" value={other} onChange={setOther} />
        <MoneyField label="Discontinuing operations (₹)" value={disc} onChange={setDisc} />
        <MoneyField
          label="Or the total (₹)"
          hint="Used when the components are not entered."
          value={revTotal}
          onChange={setRevTotal}
        />
      </fieldset>

      <Button type="submit" size="sm" disabled={disabled}>
        Save measurement data
      </Button>
    </form>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  hint,
  allowNegative,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  allowNegative?: boolean;
}): JSX.Element {
  const n = num(value);
  return (
    <Field label={label} hint={hint ?? crore(n) ?? undefined}>
      <Input
        type="number"
        inputMode="decimal"
        min={allowNegative ? undefined : 0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

// ── CARO-06 ──────────────────────────────────────────────────────────────────

function ProfessionalConclusion({
  caro,
  disabled,
  canManage,
  onDecide,
  onPartnerApprove,
  partnerBusy,
}: {
  caro: StatutoryAuditCaro;
  disabled: boolean;
  canManage: boolean;
  onDecide: (b: Decision) => void;
  onPartnerApprove: (note: string) => void;
  partnerBusy: boolean;
}): JSX.Element {
  const a = caro.assessment;
  const [mode, setMode] = useState<'none' | 'override' | 'pending'>('none');
  const [conclusion, setConclusion] = useState('');
  const [basis, setBasis] = useState('');
  const [technical, setTechnical] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [pending, setPending] = useState('');
  const [note, setNote] = useState('');
  const decided = isDecided(a.state, a.conclusion);
  const decisive = a.systemOutcome === 'applicable' || a.systemOutcome === 'not_applicable_exempt';
  const pa = caro.partnerApproval;
  const blocking = caro.detail?.missingFacts ?? [];
  const action = (x: CaroProfessionalAction) => x;

  return (
    <div className="space-y-3 text-sm">
      {decided ? (
        <div className="text-ink">
          <p>
            <span className="font-semibold">{outcomeLabel(a.conclusion)}</span>
            {a.isOverridden
              ? ' — overrides the system assessment'
              : ' — system assessment confirmed'}
            {a.decidedByName && ` · ${a.decidedByName}`}
            {a.decidedAt && ` · ${formatDate(a.decidedAt)}`}
          </p>
          {(a.isOverridden || a.conclusion !== a.systemOutcome) && (
            <p className="text-ink-muted">
              System conclusion retained: {outcomeLabel(a.systemOutcome)}
            </p>
          )}
          {a.basis && <p className="text-ink-muted">Reason: {a.basis}</p>}
          {caro.capturedFacts.technicalBasis && (
            <p className="text-ink-muted">Technical basis: {caro.capturedFacts.technicalBasis}</p>
          )}
          {caro.capturedFacts.supportingEvidence && (
            <p className="text-ink-muted">
              Supporting evidence: {caro.capturedFacts.supportingEvidence}
            </p>
          )}
        </div>
      ) : caro.professionalAction === 'information_pending' ? (
        <div className="text-warning-700">
          <p>Information Pending — {caro.pendingReason}</p>
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
        <p className="text-ink-muted">
          Not concluded yet — the Manager normally confirms the system assessment.
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled || !decisive}
            title={decisive ? undefined : 'The system could not determine CARO applicability'}
            onClick={() => onDecide({ action: action('confirm') })}
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
          <Field label="Final selection" required>
            <Select value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
              <option value="">Select…</option>
              {CARO_CONCLUSIONS.map((o) => (
                <option key={o} value={o}>
                  {CARO_OUTCOME_LABEL[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (mandatory)" required>
            <Textarea rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
          <Field label="Technical basis (mandatory)" required>
            <Textarea rows={2} value={technical} onChange={(e) => setTechnical(e.target.value)} />
          </Field>
          <Field
            label="Supporting evidence"
            hint="Describe it, or link a file under Evidence. A significant override needs Engagement Partner approval; the system conclusion is retained."
          >
            <Textarea
              rows={2}
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            disabled={disabled || !conclusion || !basis.trim() || !technical.trim()}
            onClick={() => {
              onDecide({
                action: 'override',
                conclusion: conclusion as CaroOutcome,
                basis: basis.trim(),
                technicalBasis: technical.trim(),
                supportingEvidence: evidenceNote.trim() || undefined,
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
          {blocking.length > 0 && (
            <p className="text-xs text-ink-muted">
              Blocking facts identified by the system: {blocking.map((m) => m.label).join(', ')}.
            </p>
          )}
          <Field label="Which information is pending?" required={blocking.length === 0}>
            <Input value={pending} onChange={(e) => setPending(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={disabled || (!pending.trim() && blocking.length === 0)}
            onClick={() => {
              onDecide({
                action: 'information_pending',
                pendingReason: pending.trim() || undefined,
              });
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
          ) : caro.viewerIsPartner && canManage ? (
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

function Fact({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="text-sm text-ink">{value ?? '—'}</dd>
    </div>
  );
}
