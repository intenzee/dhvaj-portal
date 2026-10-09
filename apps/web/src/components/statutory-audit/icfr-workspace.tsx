'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  ICFR_BORROWING_DATA_BASES,
  ICFR_BORROWING_SOURCES,
  ICFR_BORROWING_SOURCE_LABEL,
  ICFR_CONCLUSIONS,
  ICFR_CONTROL_REMINDER,
  ICFR_FILING_STATUS_LABEL,
  ICFR_OUTCOME_LABEL,
  ICFR_PROVISION_CODE,
  ICFR_REFERENCE_ANCHOR,
  ICFR_REFERENCE_CONTEXT,
  auditPeriodStartFromFinancialYear,
  type IcfrBorrowingDataBasis,
  type IcfrBorrowingPoint,
  type IcfrConditionResult,
  type IcfrContextStatus,
  type IcfrFilingRecordInput,
  type IcfrOutcome,
  type IcfrRouteResult,
  type RecordIcfrDecisionInput,
  type SetIcfrFactsInput,
  type StatutoryAuditIcfr,
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
 * 02.5 Internal Financial Controls / ICFR Reporting workspace (DHVAJ 02.5 spec
 * v1.1 §4): Header, System Assessment, Facts Used (read-only, Open Source),
 * the Exemption Assessment (OPC / Small Company routes, turnover, borrowings,
 * filing condition), IFC-01/02/03 capture, Rule Basis, report contexts,
 * Professional Conclusion (IFC-04 + Engagement Partner), the persistent control
 * audit reminder, Section 05 workstream / consolidated / evidence slots, Prior
 * Year and the §23 completion checklist. Every section expands in place (no
 * pop-ups). Links resolve through the Provision Library (context `02.5`) —
 * never a URL in this component.
 */

/** Provision Library code → `02.5` reference anchor. */
const ANCHOR: Record<string, string> = {
  [ICFR_PROVISION_CODE.section143_3_i]: ICFR_REFERENCE_ANCHOR.section143_3_i,
  [ICFR_PROVISION_CODE.exemptionNotification]: ICFR_REFERENCE_ANCHOR.mcaExemption,
  [ICFR_PROVISION_CODE.section92]: ICFR_REFERENCE_ANCHOR.section92,
  [ICFR_PROVISION_CODE.section137]: ICFR_REFERENCE_ANCHOR.section137,
  [ICFR_PROVISION_CODE.guidanceNote]: ICFR_REFERENCE_ANCHOR.guidanceNote,
  [ICFR_PROVISION_CODE.implementationGuide]: ICFR_REFERENCE_ANCHOR.implementationGuide,
  [ICFR_PROVISION_CODE.rule11g]: ICFR_REFERENCE_ANCHOR.rule11g,
};
const anchorsFor = (codes: string[] | undefined) =>
  (codes ?? []).map((c) => ANCHOR[c]).filter((a): a is string => !!a);

const outcomeLabel = (o: string | null | undefined) =>
  o ? (ICFR_OUTCOME_LABEL[o as IcfrOutcome] ?? o) : '—';

const ROUTE_RESULT: Record<IcfrRouteResult, { label: string; tone: string }> = {
  exempt_route: { label: 'Exempt route', tone: 'success' },
  no: { label: 'No', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'warn' },
  not_tested: { label: 'Not tested', tone: 'neutral' },
  not_available: { label: 'No rule in force', tone: 'warn' },
};
const CONDITION: Record<IcfrConditionResult, { label: string; tone: string }> = {
  satisfied: { label: 'Satisfied', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  pending: { label: 'Pending', tone: 'warn' },
  not_tested: { label: 'Not tested', tone: 'neutral' },
};
const CONTEXT: Record<IcfrContextStatus, { label: string; tone: string }> = {
  applicable: { label: 'ICFR reporting applies', tone: 'info' },
  not_applicable: { label: 'Not applicable', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'warn' },
};
const ENTITY_ROUTE: Record<string, string> = {
  not_company: 'Not a company',
  public_company: 'Public company (no private-company exemption)',
  private_company: 'Private company',
  unknown: 'Not yet classified (02.1)',
};
const BASIS_LABEL: Record<IcfrBorrowingDataBasis, string> = {
  daily: 'Daily balances',
  monthly: 'Month-end balances',
  quarterly: 'Quarter-end balances',
  year_end_only: 'Year-end balance only',
};
const FILING_SOURCE: Record<string, string> = {
  compliance_calendar: 'Compliance calendar',
  mca: 'MCA record',
  manual: 'Manual entry',
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
        : section === '02.5'
          ? 'icfr-capture'
          : null;
  if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

type Decision = Omit<RecordIcfrDecisionInput, 'version'>;

export function IcfrWorkspace({
  engagementId,
  icfr,
  canManage,
  workstream,
  consolidated,
  evidence,
}: {
  engagementId: string;
  icfr: StatutoryAuditIcfr;
  canManage: boolean;
  /** Section 05 ICFR workstream configuration (mounted once Applicable is confirmed). */
  workstream?: ReactNode;
  /** Consolidated ICFR reporting consideration (when CFS is in scope). */
  consolidated?: ReactNode;
  /** Evidence / ICFR applicability memo; defaults to the shared Section 02 evidence. */
  evidence?: ReactNode;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/engagements/${engagementId}/statutory-audit/${icfr.workflowInstanceId}/icfr`;
  const a = icfr.assessment;
  const d = icfr.detail;
  const decided = isDecided(a.state, a.conclusion);
  const approved = icfr.approved ?? a.state === 'approved';
  const editable = canManage && !approved;
  const fy = icfr.auditFinancialYear ?? null;
  const effectiveOn = fy ? auditPeriodStartFromFinancialYear(fy) : undefined;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  const fail = (e: unknown, what: string) =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`);

  const facts = useMutation({
    mutationFn: (body: Omit<SetIcfrFactsInput, 'version'>) =>
      apiFetch<StatutoryAuditIcfr>(`${base}/facts`, {
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

  const completion = icfr.completion;
  const status = approved
    ? 'Approved (Section 02)'
    : completion?.complete
      ? '02.5 COMPLETE'
      : completion?.status === 'not_started'
        ? 'Not started'
        : 'In progress';
  const finalOutcome = decided ? a.conclusion : null;
  const exempt = (finalOutcome ?? a.systemOutcome) === 'exempt';
  const workstreamReady = decided && finalOutcome === 'applicable';
  const cfsInScope = d?.reportContexts?.find((c) => c.context === 'consolidated');
  const cited = [a.authorityProvisionId].filter((x): x is string => !!x);
  const conditions = d?.conditions ?? [];

  return (
    <div className="space-y-3" data-testid="icfr-workspace">
      {/* Header (§4) */}
      <div className="space-y-1 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">
            Internal Financial Controls / ICFR Reporting
          </span>
          <Badge tone={completion?.complete || approved ? 'success' : 'warn'}>{status}</Badge>
          <span className="text-ink-muted">
            Current conclusion:{' '}
            <span className="font-medium text-ink">
              {decided
                ? outcomeLabel(a.conclusion)
                : icfr.professionalAction === 'information_pending'
                  ? 'Information Pending'
                  : 'Not concluded'}
            </span>
          </span>
          {a.needsReevaluation && (
            <Badge tone="warn">Needs re-evaluation — a source fact changed</Badge>
          )}
          {!icfr.upstreamReady && <Badge tone="neutral">Provisional — 02.1 not confirmed</Badge>}
        </div>
        <p className="text-xs text-ink-muted">
          Whether the auditor reports under Section 143(3)(i) on internal financial controls with
          reference to the financial statements. Reporting applicability is separate from the
          control work every audit performs, and from Rule 11(g) audit-trail reporting (02.7).
        </p>
        {(icfr.reevaluation?.changes ?? []).length > 0 && (
          <ul className="ml-5 list-disc text-xs text-warning-700" aria-label="Changed source facts">
            {icfr.reevaluation!.changes.map((c) => (
              <li key={c.key}>
                {c.label}: {c.before} → {c.after} — affects {c.affectedRules.join(', ')}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Persistent control audit reminder (§12) */}
      {exempt && (
        <div
          role="note"
          className="flex gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-800"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{ICFR_CONTROL_REMINDER}</span>
        </div>
      )}

      {/* System Assessment (§4, §10) */}
      <Section id="icfr-system" title="System Assessment" open>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={a.systemOutcome === 'applicable' ? 'info' : 'neutral'}>
            {outcomeLabel(a.systemOutcome)}
          </Badge>
          <span className="text-ink">{a.systemBasis}</span>
        </p>
        {d?.conclusion && (
          <dl className="grid gap-3 sm:grid-cols-3" aria-label="ICFR system conclusion">
            <Fact label="ICFR reporting" value={outcomeLabel(d.conclusion.result)} />
            <Fact label="Entity route" value={ENTITY_ROUTE[d.conclusion.entityRoute]} />
            <Fact label="OPC route" value={ROUTE_RESULT[d.conclusion.opc].label} />
            <Fact
              label="Small company route"
              value={ROUTE_RESULT[d.conclusion.smallCompany].label}
            />
            <Fact
              label="Turnover"
              value={`${d.conclusion.turnover ?? '—'}${d.conclusion.turnoverLimit ? ` (limit ${d.conclusion.turnoverLimit})` : ''}`}
            />
            <Fact
              label="Peak covered borrowings"
              value={`${d.conclusion.peakBorrowings ?? '—'}${d.conclusion.borrowingLimit ? ` (limit ${d.conclusion.borrowingLimit})` : ''}`}
            />
            <Fact label="Filing condition" value={CONDITION[d.conclusion.filingCondition].label} />
            <Fact label="Reason" value={d.conclusion.reason} />
            <Fact
              label="Notification version"
              value={d.conclusion.notificationVersion ?? 'No exemption notification in force'}
            />
          </dl>
        )}
        <FrameworkReferences
          contextKey={ICFR_REFERENCE_CONTEXT}
          anchors={[ICFR_REFERENCE_ANCHOR.section143_3_i, ICFR_REFERENCE_ANCHOR.mcaExemption]}
          provisionIds={cited}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Facts Used (§2, §4) */}
      <Section id="icfr-facts" title="Facts used" open>
        {(d?.missingFacts ?? []).length > 0 && (
          <div className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800">
            <p className="font-medium">Information Pending — blocking facts:</p>
            <ul className="ml-5 list-disc">
              {d!.missingFacts!.map((m) => (
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
                    Open Source
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-faint">
          Classification and the Small Company result come from 02.1 and are never recalculated
          here; correcting them there marks 02.5 for re-evaluation.
        </p>
      </Section>

      {/* Exemption Assessment (§5, §6) */}
      <Section id="icfr-exemption" title="Exemption assessment" open>
        {d?.entityRoute === 'public_company' || d?.entityRoute === 'not_company' ? (
          <p className="text-sm text-ink-muted">
            The private-company exemption tests are not run — {ENTITY_ROUTE[d.entityRoute]}.
          </p>
        ) : (
          <>
            <table className="w-full text-sm" aria-label="Exemption routes">
              <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="py-1">Route</th>
                  <th>Actual</th>
                  <th>System</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {(d?.routes ?? []).map((r) => (
                  <tr key={r.key}>
                    <td className="py-1.5">
                      {r.label}
                      {r.ruleCode && (
                        <span className="block font-mono text-[11px] text-ink-faint">
                          {r.ruleCode}
                        </span>
                      )}
                    </td>
                    <td className="pr-2">{r.actual}</td>
                    <td>
                      <Badge tone={ROUTE_RESULT[r.result].tone}>
                        {ROUTE_RESULT[r.result].label}
                      </Badge>
                    </td>
                    <td className="space-y-1 text-xs text-ink-muted">
                      <p>{r.basis}</p>
                      <button
                        type="button"
                        className="text-primary-600 underline"
                        onClick={() => goTo(r.sourceSection)}
                      >
                        Open 02.1
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="w-full text-sm" aria-label="Exemption conditions">
              <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="py-1">Condition</th>
                  <th>Requirement</th>
                  <th>Actual</th>
                  <th>Limit</th>
                  <th>System output</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {conditions.map((c) => (
                  <tr key={c.key}>
                    <td className="py-1.5">
                      {c.label}
                      {c.ruleCode && (
                        <span className="block font-mono text-[11px] text-ink-faint">
                          {c.ruleCode}
                          {c.ruleVersion != null && ` v${c.ruleVersion}`}
                        </span>
                      )}
                    </td>
                    <td className="pr-2 text-xs text-ink-muted">
                      {c.requirement}
                      {c.calculation && <span className="block">{c.calculation}</span>}
                      {c.pendingReason && (
                        <span className="block text-warning-700">{c.pendingReason}</span>
                      )}
                      <FrameworkReferences
                        contextKey={ICFR_REFERENCE_CONTEXT}
                        anchors={anchorsFor(c.provisionCodes)}
                        effectiveOn={effectiveOn}
                      />
                    </td>
                    <td>{c.actualDisplay}</td>
                    <td>{c.limitDisplay ?? '—'}</td>
                    <td>
                      <Badge tone={CONDITION[c.result].tone}>{CONDITION[c.result].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d?.monetaryJoin && (
              <p className="text-xs text-ink-muted">
                Monetary conditions are joined by{' '}
                <span className="font-semibold uppercase">{d.monetaryJoin}</span> (Rules Library);
                the filing condition must be satisfied for any exemption route.
                {d.filingDefaultBlocks &&
                  ' A §92 / §137 filing default makes the exemption unavailable.'}
              </p>
            )}
          </>
        )}
      </Section>

      {/* IFC-01 / IFC-02 / IFC-03 capture (§7–§9) */}
      <Section id="icfr-capture" title="Turnover, borrowings and filings (IFC-01 to IFC-03)" open>
        <CaptureForm icfr={icfr} disabled={disabled} onSave={(b) => facts.mutate(b)} />
      </Section>

      {/* Rule Basis (§3, §21) */}
      <Section id="icfr-rules" title="Rule basis">
        {conditions.length === 0 ? (
          <p className="text-sm text-ink-muted">No exemption limit was used for this conclusion.</p>
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
              {conditions.map((c) => (
                <tr key={c.key}>
                  <td className="py-1 font-mono text-xs">
                    {c.ruleCode ?? '—'}
                    {c.ruleVersion != null && ` v${c.ruleVersion}`}
                  </td>
                  <td>
                    {c.requirement}
                    {c.operator && c.limitDisplay && (
                      <span className="block text-xs text-ink-muted">
                        {c.operator} {c.limitDisplay}
                      </span>
                    )}
                  </td>
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
        {d?.notificationVersion && (
          <p className="text-xs text-ink-muted">
            Exemption notification {d.notificationVersion.code}, effective{' '}
            {formatDate(d.notificationVersion.effectiveFrom)}.
          </p>
        )}
        <p className="text-xs text-ink-faint">
          Limits, operators, the monetary join and the covered borrowing sources come from the
          versioned Rules Library for the audit period — none is hard-coded.
        </p>
        <FrameworkReferences
          contextKey={ICFR_REFERENCE_CONTEXT}
          anchors={[
            ICFR_REFERENCE_ANCHOR.guidanceNote,
            ICFR_REFERENCE_ANCHOR.implementationGuide,
            ICFR_REFERENCE_ANCHOR.section92,
            ICFR_REFERENCE_ANCHOR.section137,
          ]}
          provisionIds={cited}
          effectiveOn={effectiveOn}
        />
      </Section>

      {/* Report contexts (§17) */}
      <Section id="icfr-contexts" title="Report contexts — standalone / consolidated" open>
        <ul className="space-y-2 text-sm">
          {(d?.reportContexts ?? []).map((c) => (
            <li key={c.context} className="flex flex-wrap items-baseline gap-2">
              <span className="w-56 font-medium text-ink">
                {c.context === 'standalone'
                  ? 'Standalone financial statements'
                  : 'Consolidated financial statements'}
              </span>
              <Badge tone={CONTEXT[c.status].tone}>{CONTEXT[c.status].label}</Badge>
              <span className="text-xs text-ink-muted">{c.basis}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* IFC-04 Professional Conclusion (§11) */}
      <Section id="icfr-04" title="Professional Conclusion (IFC-04)" open>
        <ProfessionalConclusion
          icfr={icfr}
          disabled={disabled}
          canManage={canManage && !approved}
          onDecide={(b) => decision.mutate(b)}
          onPartnerApprove={(note) => partner.mutate(note)}
          partnerBusy={partner.isPending}
        />
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-primary-600">
            View all triggered ICFR provisions
          </summary>
          <div className="mt-2">
            <FrameworkReferences
              contextKey={ICFR_REFERENCE_CONTEXT}
              anchors={[...anchorsFor(d?.provisionCodes), ICFR_REFERENCE_ANCHOR.rule11g]}
              provisionIds={cited}
              effectiveOn={effectiveOn}
            />
          </div>
        </details>
      </Section>

      {/* Section 05 ICFR workstream (§13) */}
      <Section id="icfr-workstream" title="ICFR workstream configuration (Section 05)" open>
        {workstreamReady ? (
          (workstream ?? (
            <p className="text-sm text-ink-muted">
              ICFR reporting applies — the ICFR workstream is configured in Section 05 controls.
            </p>
          ))
        ) : (
          <p className="text-sm text-ink-muted">
            Configured only after Applicable is confirmed
            {decided ? ' — the current conclusion does not require ICFR reporting work.' : '.'}{' '}
            Normal control understanding and evaluation in Section 05 continue either way.
          </p>
        )}
      </Section>

      {/* Consolidated ICFR consideration (§17) */}
      {cfsInScope && cfsInScope.status !== 'not_applicable' && (
        <Section id="icfr-consolidated" title="Consolidated ICFR reporting consideration">
          {consolidated ?? (
            <p className="text-sm text-ink-muted">
              Component ICFR applicability and reports are considered for the consolidated financial
              statements once 02.6 confirms CFS scope.
            </p>
          )}
        </Section>
      )}

      {/* Evidence / ICFR applicability memo (§20) */}
      <Section
        id="icfr-evidence"
        title="Evidence / ICFR applicability memo"
        open={!!icfr.memoSuggested}
      >
        {icfr.memoSuggested && (
          <p className="text-xs text-warning-700">
            An ICFR applicability memo is suggested — override, further assessment or partner
            approval.
          </p>
        )}
        {evidence ?? (
          <FrameworkEvidence
            engagementId={engagementId}
            workflowInstanceId={icfr.workflowInstanceId}
            subAssessmentId={a.id}
            memoSuggested={!!icfr.memoSuggested}
            readOnly={!editable}
          />
        )}
      </Section>

      {/* Prior Year (§19) */}
      <Section id="icfr-prior" title="Prior year">
        {icfr.priorYear ? (
          <div className="space-y-1 text-sm">
            <p>
              FY {icfr.priorYear.financialYear}:{' '}
              <span className="font-medium">{outcomeLabel(icfr.priorYear.outcome)}</span>
              {icfr.priorYear.isOverridden && ' (overridden)'}
              {icfr.priorYear.decidedAt && ` · ${formatDate(icfr.priorYear.decidedAt)}`}
            </p>
            {icfr.priorYear.exemptionBasis && (
              <p className="text-xs text-ink-muted">Prior basis: {icfr.priorYear.exemptionBasis}</p>
            )}
            {icfr.priorYear.changedFacts.length > 0 && (
              <ul className="ml-5 list-disc text-xs text-warning-700">
                {icfr.priorYear.changedFacts.map((c) => (
                  <li key={c.label}>
                    {c.label} changed: {c.prior} → {c.current}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-faint">
              Context only — the current-year rules always rerun on current-year facts.
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No prior-year ICFR assessment on record.</p>
        )}
      </Section>

      {/* Completion (§23) */}
      <Section id="icfr-completion" title="Completion" open>
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
            02.5 COMPLETE — the ICFR result passes to Section 05 controls and the Section 08 report
            (Annexure B).
          </p>
        )}
      </Section>
    </div>
  );
}

// ── IFC-01 / IFC-02 / IFC-03 capture ─────────────────────────────────────────

function num(v: string): number | null {
  const t = v.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const str = (v: number | null | undefined) => (v == null ? '' : String(v));

const BLANK_POINT: IcfrBorrowingPoint = { asOn: '', lender: '', source: 'bank', amount: 0 };
const BLANK_FILING: IcfrFilingRecordInput = {
  form: 'AOC-4',
  section: '137',
  period: '',
  dueDate: '',
  filedOn: '',
  srn: '',
  source: 'manual',
};

function CaptureForm({
  icfr,
  disabled,
  onSave,
}: {
  icfr: StatutoryAuditIcfr;
  disabled: boolean;
  onSave: (b: Omit<SetIcfrFactsInput, 'version'>) => void;
}): JSX.Element {
  const f = icfr.capturedFacts;
  const d = icfr.detail;
  const [turnover, setTurnover] = useState(str(f.auditedTurnover));
  const [turnoverPeriod, setTurnoverPeriod] = useState(f.auditedTurnoverPeriod ?? '');
  const [turnoverSource, setTurnoverSource] = useState(f.auditedTurnoverSource ?? '');
  const [dataBasis, setDataBasis] = useState<string>(f.borrowingDataBasis ?? '');
  const [peak, setPeak] = useState(str(f.peakCoveredBorrowings));
  const [peakDate, setPeakDate] = useState(f.peakDate ?? '');
  const [schedule, setSchedule] = useState<IcfrBorrowingPoint[]>(f.borrowingSchedule ?? []);
  const [row, setRow] = useState<IcfrBorrowingPoint>(BLANK_POINT);
  const [filings, setFilings] = useState<IcfrFilingRecordInput[]>(f.filings ?? []);
  const [filing, setFiling] = useState<IcfrFilingRecordInput>(BLANK_FILING);
  const [filingAnswer, setFilingAnswer] = useState(
    f.filingDefault == null ? '' : String(f.filingDefault),
  );
  const [filingEvidence, setFilingEvidence] = useState(f.filingEvidence ?? '');

  const t = d?.turnover;
  const b = d?.borrowing;
  const calendarRecords = (d?.filing?.records ?? []).filter(
    (r) => r.source === 'compliance_calendar',
  );
  const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          auditedTurnover: num(turnover),
          auditedTurnoverPeriod: blank(turnoverPeriod),
          auditedTurnoverSource: blank(turnoverSource),
          borrowingDataBasis: (dataBasis || null) as IcfrBorrowingDataBasis | null,
          peakCoveredBorrowings: num(peak),
          peakDate: blank(peakDate),
          borrowingSchedule: schedule.length ? schedule : null,
          filings: filings.length ? filings : null,
          filingDefault: filingAnswer === '' ? null : filingAnswer === 'true',
          filingEvidence: blank(filingEvidence),
        });
      }}
    >
      {/* IFC-01 */}
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="mb-1 text-xs font-semibold text-ink">
          IFC-01 · Turnover per the latest audited financial statements
        </legend>
        <p className="text-xs text-ink-muted">
          Used now: <span className="font-medium text-ink">{rupees(t?.amount)}</span>
          {t?.period && ` · FY ${t.period}`}
          {t?.source && ` · ${t.source}`}
          {t?.audited === false && (
            <span className="text-warning-700"> · not audited — the test stays Pending</span>
          )}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <MoneyField
            label="Audited turnover (₹), if different"
            hint="Leave blank to use the audited comparative from 02.1."
            value={turnover}
            onChange={setTurnover}
          />
          <Field label="Financial year">
            <Input
              placeholder="2023-24"
              value={turnoverPeriod}
              onChange={(e) => setTurnoverPeriod(e.target.value)}
            />
          </Field>
          <Field label="Source">
            <Input
              placeholder="Audited financial statements FY 2023-24"
              value={turnoverSource}
              onChange={(e) => setTurnoverSource(e.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      {/* IFC-02 */}
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="mb-1 text-xs font-semibold text-ink">
          IFC-02 · Borrowings from banks, financial institutions and bodies corporate — at any point
          in the year
        </legend>
        {b && b.maximumAggregate != null && (
          <p className="text-xs text-ink-muted" aria-label="Computed peak">
            Peak aggregate covered borrowings:{' '}
            <span className="font-medium text-ink">{rupees(b.maximumAggregate)}</span>
            {b.peakDate && ` on ${formatDate(b.peakDate)}`}
            {' · '}
            {b.coveredSources
              .filter((s) => b.bySource[s] != null)
              .map((s) => `${ICFR_BORROWING_SOURCE_LABEL[s]} ${rupees(b.bySource[s])}`)
              .join(', ')}
            {b.excludedSources.length > 0 &&
              ` · excluded: ${b.excludedSources.map((s) => ICFR_BORROWING_SOURCE_LABEL[s]).join(', ')}`}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Data available" hint="Year-end balances alone cannot prove 'at any point'.">
            <Select value={dataBasis} onChange={(e) => setDataBasis(e.target.value)}>
              <option value="">Not stated</option>
              {ICFR_BORROWING_DATA_BASES.map((x) => (
                <option key={x} value={x}>
                  {BASIS_LABEL[x]}
                </option>
              ))}
            </Select>
          </Field>
          <MoneyField
            label="Documented peak (₹), when no schedule is entered"
            value={peak}
            onChange={setPeak}
          />
          <Field label="Date of the peak">
            <Input type="date" value={peakDate} onChange={(e) => setPeakDate(e.target.value)} />
          </Field>
        </div>
        <table className="w-full text-sm" aria-label="Borrowing balance schedule">
          <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="py-1">As on</th>
              <th>Lender</th>
              <th>Source</th>
              <th>Outstanding</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {schedule.map((p, i) => (
              <tr key={`${p.asOn}-${p.lender}-${i}`}>
                <td className="py-1">{formatDate(p.asOn)}</td>
                <td>{p.lender}</td>
                <td>{ICFR_BORROWING_SOURCE_LABEL[p.source]}</td>
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
                  aria-label="Borrowing source"
                  value={row.source}
                  onChange={(e) =>
                    setRow({ ...row, source: e.target.value as IcfrBorrowingPoint['source'] })
                  }
                >
                  {ICFR_BORROWING_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {ICFR_BORROWING_SOURCE_LABEL[s]}
                    </option>
                  ))}
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
                    setRow({ ...BLANK_POINT, source: row.source });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-ink-faint">
          Balances on the same date are added across covered sources; which sources count is set by
          the rule in force (other borrowings are shown but excluded unless the rule includes them).
        </p>
      </fieldset>

      {/* IFC-03 */}
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="mb-1 text-xs font-semibold text-ink">
          IFC-03 · Filing of financial statements (§137) and annual return (§92)
        </legend>
        {d?.filing && (
          <p className="text-xs text-ink-muted">
            Status:{' '}
            <span className="font-medium text-ink">
              {ICFR_FILING_STATUS_LABEL[d.filing.status]}
            </span>{' '}
            — {d.filing.basis}
          </p>
        )}
        {filings.length === 0 && calendarRecords.length > 0 && (
          <p className="text-xs text-ink-muted">
            Read from the compliance calendar. Add records below to replace them with the
            team&rsquo;s own traceable records.
          </p>
        )}
        <table className="w-full text-sm" aria-label="Filing records">
          <thead className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="py-1">Form</th>
              <th>Period</th>
              <th>Due</th>
              <th>Filed</th>
              <th>SRN</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(filings.length ? filings : calendarRecords).map((r, i) => (
              <tr key={`${r.form}-${r.period}-${i}`}>
                <td className="py-1">
                  {r.form} <span className="text-xs text-ink-faint">§{r.section}</span>
                </td>
                <td>{r.period || '—'}</td>
                <td>{r.dueDate ? formatDate(r.dueDate) : '—'}</td>
                <td>{r.filedOn ? formatDate(r.filedOn) : 'Not filed'}</td>
                <td className="font-mono text-xs">{r.srn || '—'}</td>
                <td className="text-xs">{FILING_SOURCE[r.source] ?? r.source}</td>
                <td>
                  {filings.length > 0 && (
                    <button
                      type="button"
                      aria-label={`Remove ${r.form} ${r.period ?? ''}`}
                      className="text-ink-faint hover:text-danger-600"
                      onClick={() => setFilings(filings.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-1 pr-1">
                <Select
                  aria-label="Form"
                  value={filing.form}
                  onChange={(e) =>
                    setFiling({
                      ...filing,
                      form: e.target.value,
                      section: e.target.value === 'AOC-4' ? '137' : '92',
                    })
                  }
                >
                  <option value="AOC-4">AOC-4 (§137)</option>
                  <option value="MGT-7">MGT-7 (§92)</option>
                  <option value="MGT-7A">MGT-7A (§92)</option>
                </Select>
              </td>
              <td className="pr-1">
                <Input
                  aria-label="Period"
                  placeholder="2023-24"
                  value={filing.period ?? ''}
                  onChange={(e) => setFiling({ ...filing, period: e.target.value })}
                />
              </td>
              <td className="pr-1">
                <Input
                  type="date"
                  aria-label="Due date"
                  value={filing.dueDate ?? ''}
                  onChange={(e) => setFiling({ ...filing, dueDate: e.target.value })}
                />
              </td>
              <td className="pr-1">
                <Input
                  type="date"
                  aria-label="Filed on"
                  value={filing.filedOn ?? ''}
                  onChange={(e) => setFiling({ ...filing, filedOn: e.target.value })}
                />
              </td>
              <td className="pr-1">
                <Input
                  aria-label="SRN"
                  value={filing.srn ?? ''}
                  onChange={(e) => setFiling({ ...filing, srn: e.target.value })}
                />
              </td>
              <td className="pr-1">
                <Select
                  aria-label="Filing source"
                  value={filing.source}
                  onChange={(e) =>
                    setFiling({
                      ...filing,
                      source: e.target.value as IcfrFilingRecordInput['source'],
                    })
                  }
                >
                  <option value="manual">Manual entry</option>
                  <option value="mca">MCA record</option>
                </Select>
              </td>
              <td>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label="Add filing"
                  disabled={!filing.dueDate}
                  onClick={() => {
                    setFilings([
                      ...filings,
                      {
                        form: filing.form,
                        section: filing.section,
                        source: filing.source,
                        period: blank(filing.period),
                        dueDate: blank(filing.dueDate),
                        filedOn: blank(filing.filedOn),
                        srn: blank(filing.srn),
                      },
                    ]);
                    setFiling(BLANK_FILING);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Documented answer when no filing record exists"
            hint="Unknown is never treated as 'no default'."
          >
            <Select value={filingAnswer} onChange={(e) => setFilingAnswer(e.target.value)}>
              <option value="">Not known (Pending)</option>
              <option value="false">No default</option>
              <option value="true">Default identified</option>
            </Select>
          </Field>
          <Field
            label="Filing evidence"
            hint="A 'no default' answer needs evidence (e.g. the MCA master data check)."
          >
            <Input value={filingEvidence} onChange={(e) => setFilingEvidence(e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <Button type="submit" size="sm" disabled={disabled}>
        Save IFC-01 to IFC-03
      </Button>
    </form>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}): JSX.Element {
  const n = num(value);
  return (
    <Field label={label} hint={crore(n) ?? hint}>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

// ── IFC-04 ───────────────────────────────────────────────────────────────────

function ProfessionalConclusion({
  icfr,
  disabled,
  canManage,
  onDecide,
  onPartnerApprove,
  partnerBusy,
}: {
  icfr: StatutoryAuditIcfr;
  disabled: boolean;
  canManage: boolean;
  onDecide: (b: Decision) => void;
  onPartnerApprove: (note: string) => void;
  partnerBusy: boolean;
}): JSX.Element {
  const a = icfr.assessment;
  const [mode, setMode] = useState<'none' | 'override' | 'pending'>('none');
  const [conclusion, setConclusion] = useState('');
  const [basis, setBasis] = useState('');
  const [technical, setTechnical] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [pending, setPending] = useState('');
  const [note, setNote] = useState('');
  const decided = isDecided(a.state, a.conclusion);
  const decisive = a.systemOutcome === 'applicable' || a.systemOutcome === 'exempt';
  const pa = icfr.partnerApproval;
  const blocking = icfr.detail?.missingFacts ?? [];

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
          {icfr.capturedFacts.technicalBasis && (
            <p className="text-ink-muted">Technical basis: {icfr.capturedFacts.technicalBasis}</p>
          )}
          {icfr.capturedFacts.supportingEvidence && (
            <p className="text-ink-muted">
              Supporting evidence: {icfr.capturedFacts.supportingEvidence}
            </p>
          )}
        </div>
      ) : icfr.professionalAction === 'information_pending' ? (
        <div className="text-warning-700">
          <p>Information Pending — {icfr.pendingReason}</p>
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
            title={decisive ? undefined : 'The system could not determine ICFR reporting'}
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
          <Field label="Final selection" required>
            <Select value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
              <option value="">Select…</option>
              {ICFR_CONCLUSIONS.map((o) => (
                <option key={o} value={o}>
                  {ICFR_OUTCOME_LABEL[o]}
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
                conclusion: conclusion as IcfrOutcome,
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
          ) : icfr.viewerIsPartner && canManage ? (
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
