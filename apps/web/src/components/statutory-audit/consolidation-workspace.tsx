'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import {
  CONDITION_RESULT_LABEL,
  CONSOLIDATION_CONCLUSIONS,
  CONSOLIDATION_OUTCOME_LABEL,
  CONSOLIDATION_REFERENCE_ANCHOR,
  CONSOLIDATION_REFERENCE_CONTEXT,
  CONVERSION_STATUS_LABEL,
  EMPTY_RULE6_EVIDENCE,
  INVESTEE_RELATIONSHIP_LABEL,
  LOCAL_FRAMEWORK_LABEL,
  RULE6_RESULT_LABEL,
  type ConditionResult,
  type ConsolidationConversion,
  type ConsolidationOutcome,
  type ConversionDifference,
  type ConversionStatus,
  type InvesteeInput,
  type InvesteeRelationship,
  type MemberObjectionStatus,
  type RecordConsolidationDecisionInput,
  type Rule6Evidence,
  type SetConsolidationFactsInput,
  type StatutoryAuditConsolidation,
  type StatutoryAuditTeam,
  type UpdateConsolidationConversionInput,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { LinkPicker } from './acceptance-file-card';
import { ConsolidationPerimeter } from './consolidation-perimeter';
import { FrameworkEvidence } from './framework-evidence';
import { FrameworkReferences } from './framework-references';

/**
 * 02.6 Consolidation & Group Audit Framework workspace (DHVAJ 02.6 spec §4):
 * Header, System Assessment, Group Structure, CFS Exemption (Rule 6),
 * Consolidation Perimeter (relationship assessment, CFS-03 / CFS-04),
 * Other Auditors (Track B slot), Outstanding Information, Professional
 * Conclusion (CFS-05 + Engagement Partner), conversion work items, Workstream
 * (Track B slots), Evidence, Prior Year and the §24 completion checklist.
 * Every section expands in place (no pop-ups); references resolve through the
 * Provision Library (context `02.6`), never a URL here.
 */

type Decision = Omit<RecordConsolidationDecisionInput, 'version'>;
type Facts = Omit<SetConsolidationFactsInput, 'version'>;

const outcomeLabel = (o: string | null | undefined) =>
  o ? (CONSOLIDATION_OUTCOME_LABEL[o as ConsolidationOutcome] ?? o) : '—';

const CONDITION_TONE: Record<ConditionResult, string> = {
  satisfied: 'success',
  failed: 'danger',
  pending: 'warn',
  not_applicable: 'neutral',
};
const OBJECTION_LABEL: Record<MemberObjectionStatus, string> = {
  no_objection: 'No objection received',
  objection_received: 'Objection received',
  awaiting: 'Awaiting responses',
};
const CONVERSION_EDITABLE: ConversionStatus[] = ['open', 'in_review', 'completed'];

const isDecided = (s: string, conclusion: string | null) =>
  s === 'applicable' ||
  s === 'not_applicable' ||
  s === 'overridden' ||
  s === 'approved' ||
  s === 'reassessment_required' ||
  (s === 'professional_judgement_required' && conclusion != null);

const triBool = (v: boolean | null | undefined) => (v == null ? '' : String(v));
const fromTri = (v: string): boolean | null => (v === '' ? null : v === 'true');

/** The Provision Library anchors this assessment rests on. */
function anchorsFor(c: StatutoryAuditConsolidation): string[] {
  const d = c.detail;
  const A = CONSOLIDATION_REFERENCE_ANCHOR;
  const out: string[] = [A.section129_3, A.section2_6];
  if (d?.cfsTriggered) out.push(A.rule6);
  if (d?.groupFramework === 'ind_as') out.push(A.indAs110, A.indAs111, A.indAs28);
  else if (d?.groupFramework === 'as') out.push(A.as21, A.as23, A.as27);
  if (c.groupAudit?.sa600Required || d?.saFramework) out.push(A.sa600);
  if (d?.hasBranches) out.push(A.section143_8);
  return out;
}

export function ConsolidationWorkspace({
  engagementId,
  consolidation: c,
  canManage,
  otherAuditors,
  branchAuditors,
  workProgramme,
  evidence,
}: {
  engagementId: string;
  consolidation: StatutoryAuditConsolidation;
  canManage: boolean;
  /** Track B: component auditor matrix, SA 600, instructions, packages, findings. */
  otherAuditors?: ReactNode;
  /** Track B: §143(8) branch auditors. */
  branchAuditors?: ReactNode;
  /** Track B: consolidation work programme (Section 05). */
  workProgramme?: ReactNode;
  /** Evidence / 02.6 memo; defaults to the shared Section 02 evidence. */
  evidence?: ReactNode;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/engagements/${engagementId}/statutory-audit/${c.workflowInstanceId}/consolidation`;
  const a = c.assessment;
  const d = c.detail;
  const decided = isDecided(a.state, a.conclusion);
  const approved = c.approved ?? a.state === 'approved';
  const editable = canManage && !approved;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  const fail = (e: unknown, what: string) =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`);

  const facts = useMutation({
    mutationFn: (body: Facts) =>
      apiFetch<StatutoryAuditConsolidation>(`${base}/facts`, {
        method: 'POST',
        body: { ...body, version: a.version },
      }),
    onSuccess: () => {
      toast(decided ? 'Saved — the conclusion is checked against the change.' : 'Saved.');
      refresh();
    },
    onError: (e) => fail(e, 'save'),
  });
  const rerun = useMutation({
    mutationFn: () => apiFetch(`${base}/run-suggestions`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast('Assessment re-run on the current facts and rules.');
      refresh();
    },
    onError: (e) => fail(e, 're-run the assessment'),
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
      apiFetch(`${base}/partner-approval`, {
        method: 'POST',
        body: { note: note || undefined, version: a.version },
      }),
    onSuccess: () => {
      toast('Partner approval recorded.');
      refresh();
    },
    onError: (e) => fail(e, 'approve'),
  });
  const conversion = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateConsolidationConversionInput }) =>
      apiFetch(`${base}/conversions/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast('Conversion work item saved.');
      refresh();
    },
    onError: (e) => fail(e, 'save the conversion work item'),
  });
  const busy =
    facts.isPending ||
    rerun.isPending ||
    decision.isPending ||
    partner.isPending ||
    conversion.isPending;

  const completion = c.completion;
  const status = approved
    ? 'Approved (Section 02)'
    : completion?.complete
      ? '02.6 COMPLETE'
      : completion?.status === 'not_started'
        ? 'Not started'
        : 'In progress';
  const finalOutcome = decided ? a.conclusion : null;
  const cfsRequired = (finalOutcome ?? a.systemOutcome) === 'cfs_required';
  const missing = d?.missingFacts ?? [];
  const nameOf = (id: string | null) =>
    id ? (d?.perimeter.find((p) => p.id === id)?.name ?? null) : null;
  const ga = c.groupAudit;
  const conversions = c.conversions ?? [];
  const isSubsidiary =
    c.capturedFacts.isWhollyOwnedSubsidiary || c.capturedFacts.isPartiallyOwnedSubsidiary;

  return (
    <div className="space-y-3" data-testid="consolidation-workspace">
      {/* Header (§4) */}
      <div className="space-y-1 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">Consolidation &amp; Group Audit Framework</span>
          <Badge tone={completion?.complete || approved ? 'success' : 'warn'}>{status}</Badge>
          <span className="text-ink-muted">
            Current conclusion:{' '}
            <span className="font-medium text-ink">
              {decided
                ? outcomeLabel(a.conclusion)
                : c.professionalAction === 'information_pending'
                  ? 'Information Pending'
                  : 'Not concluded'}
            </span>
          </span>
          {a.needsReevaluation && (
            <Badge tone="warn">Needs re-evaluation — the perimeter or Rule 6 result changed</Badge>
          )}
          {!c.upstreamReady && (
            <Badge tone="neutral">Provisional — 02.1 / 02.2 not concluded</Badge>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Whether consolidated financial statements are required under Section 129(3) and Rule 6,
          the consolidation perimeter, and how the group audit is organised (component auditors, SA
          600, branch auditors). One group structure feeds CARO 3(xxi), consolidated ICFR and
          planning — nothing is entered twice.
        </p>
      </div>

      {/* System Assessment (§4, §6) */}
      <Section id="cfs-system" title="System Assessment" open>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={a.systemOutcome === 'cfs_required' ? 'info' : 'neutral'}>
            {outcomeLabel(a.systemOutcome)}
          </Badge>
          {d?.groupFramework && (
            <span className="text-xs text-ink-muted">
              Group framework: {d.groupFramework === 'ind_as' ? 'Ind AS' : 'AS'}
              {d.groupReportingDate ? ` · reporting date ${d.groupReportingDate}` : ''}
            </span>
          )}
          {editable && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => rerun.mutate()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Re-run
            </Button>
          )}
        </div>
        {a.systemBasis && <p className="text-sm text-ink">{a.systemBasis}</p>}
        {(d?.factsUsed ?? []).length > 0 && (
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {d!.factsUsed!.map((f) => (
              <Fact key={f.key} label={`${f.label} · ${f.source}`} value={f.value} />
            ))}
          </dl>
        )}
        {(d?.rulesUsed ?? []).length > 0 && (
          <ul className="space-y-0.5 text-xs text-ink-muted" aria-label="Rules used">
            {d!.rulesUsed!.map((r) => (
              <li key={`${r.code}-${r.version}`}>
                {r.label}: {r.value}{' '}
                <span className="text-ink-faint">
                  ({r.code} v{r.version}, from {r.effectiveFrom})
                </span>
              </li>
            ))}
          </ul>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-primary-600">
            View the provisions behind this assessment
          </summary>
          <div className="mt-2">
            <FrameworkReferences
              contextKey={CONSOLIDATION_REFERENCE_CONTEXT}
              anchors={anchorsFor(c)}
              provisionIds={a.authorityProvisionId ? [a.authorityProvisionId] : []}
              effectiveOn={c.periodStart}
            />
          </div>
        </details>
      </Section>

      {/* Group Structure (§4, §5) */}
      <Section id="cfs-structure" title="Group structure" open>
        {d?.counts && Object.keys(d.counts).length > 0 ? (
          <p className="flex flex-wrap gap-2 text-sm">
            {(Object.entries(d.counts) as [InvesteeRelationship, number][])
              .filter(([, n]) => n > 0)
              .map(([k, n]) => (
                <Badge key={k} tone="info">
                  {INVESTEE_RELATIONSHIP_LABEL[k]}: {n}
                </Badge>
              ))}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">No component is in the perimeter yet.</p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="This company's own holding position">
            <Select
              value={
                c.capturedFacts.isWhollyOwnedSubsidiary
                  ? 'wholly'
                  : c.capturedFacts.isPartiallyOwnedSubsidiary
                    ? 'partially'
                    : 'none'
              }
              disabled={!editable || busy}
              onChange={(e) =>
                facts.mutate({
                  isWhollyOwnedSubsidiary: e.target.value === 'wholly',
                  isPartiallyOwnedSubsidiary: e.target.value === 'partially',
                })
              }
            >
              <option value="none">Not a subsidiary of another company</option>
              <option value="wholly">Wholly-owned subsidiary</option>
              <option value="partially">Partially-owned subsidiary</option>
            </Select>
          </Field>
          <Field label="Securities listed or in the process of listing?">
            <Select
              value={String(c.capturedFacts.securitiesListedOrInProcess)}
              disabled={!editable || busy}
              onChange={(e) =>
                facts.mutate({ securitiesListedOrInProcess: e.target.value === 'true' })
              }
            >
              <option value="false">No</option>
              <option value="true">Yes (in or outside India)</option>
            </Select>
          </Field>
          <Field
            label="Branches on the client master?"
            hint="Drives the §143(8) branch auditor question."
          >
            <Select
              value={String(c.capturedFacts.hasBranches)}
              disabled={!editable || busy}
              onChange={(e) => facts.mutate({ hasBranches: e.target.value === 'true' })}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </Select>
          </Field>
        </div>
      </Section>

      {/* CFS Exemption — Rule 6 (§7, CFS-02) */}
      {(d?.cfsTriggered || isSubsidiary) && (
        <Section id="cfs-rule6" title="CFS exemption — Rule 6 (CFS-02)" open={!!d?.cfsTriggered}>
          {d?.rule6 ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <Badge
                  tone={
                    d.rule6.result === 'available'
                      ? 'success'
                      : d.rule6.result === 'pending'
                        ? 'warn'
                        : 'neutral'
                  }
                >
                  {d.rule6.result ? RULE6_RESULT_LABEL[d.rule6.result] : '—'}
                </Badge>
                <span className="text-ink-muted">{d.rule6.basis}</span>
              </p>
              {(d.rule6.conditions ?? []).length > 0 && (
                <ul className="space-y-1 text-sm">
                  {d.rule6.conditions!.map((cond) => (
                    <li key={cond.key} className="flex flex-wrap items-baseline gap-2">
                      <Badge tone={CONDITION_TONE[cond.result]}>
                        {CONDITION_RESULT_LABEL[cond.result]}
                      </Badge>
                      <span className="font-medium text-ink">{cond.label}</span>
                      <span className="text-xs text-ink-muted">{cond.requirement}</span>
                      {cond.evidence && (
                        <span className="text-xs text-ink-faint">— {cond.evidence}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              Rule 6 is tested once §129(3) triggers (a subsidiary, associate or joint venture is in
              the perimeter).
            </p>
          )}
          <Rule6Form
            key={a.version}
            evidence={{ ...EMPTY_RULE6_EVIDENCE, ...c.capturedFacts.rule6Evidence }}
            parentFilesCompliantCfs={c.capturedFacts.parentFilesCompliantCfs}
            partiallyOwned={c.capturedFacts.isPartiallyOwnedSubsidiary}
            disabled={!editable || busy}
            onSave={(rule6Evidence, parentFilesCompliantCfs) =>
              facts.mutate({ rule6Evidence, parentFilesCompliantCfs })
            }
          />
        </Section>
      )}

      {/* Consolidation Perimeter (§8, §10, §11) */}
      <Section id="cfs-perimeter" title="Consolidation perimeter" open>
        <ConsolidationPerimeter
          investees={c.capturedFacts.investees}
          perimeter={d?.perimeter ?? []}
          groupAudit={ga}
          editable={editable}
          busy={busy}
          onSave={(investees: InvesteeInput[]) => facts.mutate({ investees })}
        />
        {d?.materialityNote && <p className="text-xs text-ink-faint">{d.materialityNote}</p>}
      </Section>

      {/* Other Auditors (§12–§16, Track B) */}
      {cfsRequired && (
        <Section id="cfs-other-auditors" title="Other auditors (SA 600)">
          {ga && (
            <p className="flex flex-wrap gap-2 text-xs">
              <Badge tone="neutral">DHVAJ: {ga.dhvajComponents}</Badge>
              <Badge tone="info">Other auditors: {ga.otherAuditorComponents}</Badge>
              {ga.tbdComponents > 0 && <Badge tone="warn">TBD: {ga.tbdComponents}</Badge>}
              {ga.sa600Required && <Badge tone="info">SA 600 applies</Badge>}
              {ga.pendingReports > 0 && (
                <Badge tone="warn">Reports pending: {ga.pendingReports}</Badge>
              )}
            </p>
          )}
          {otherAuditors ?? (
            <p className="text-sm text-ink-muted">
              The component auditor matrix, SA 600 questions, instructions and reporting packages
              open here.
            </p>
          )}
        </Section>
      )}

      {/* Outstanding Information (§4) */}
      <Section
        id="cfs-outstanding"
        title={`Outstanding information${missing.length ? ` (${missing.length})` : ''}`}
        open={missing.length > 0}
      >
        {missing.length === 0 && !(ga && (ga.sa600Pending || ga.instructionsPending)) ? (
          <p className="text-sm text-ink-muted">Nothing outstanding.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {missing.map((m) => (
              <li
                key={`${m.key}-${m.componentId ?? 'group'}`}
                className="flex items-baseline gap-2"
              >
                <AlertTriangle
                  className={`h-3.5 w-3.5 self-center ${m.blocking ? 'text-danger-600' : 'text-warning-600'}`}
                  aria-hidden
                />
                <span>
                  {nameOf(m.componentId) ? `${nameOf(m.componentId)}: ` : ''}
                  {m.label}
                </span>
                {m.blocking && <Badge tone="danger">Blocks the conclusion</Badge>}
              </li>
            ))}
            {ga && ga.sa600Pending > 0 && (
              <li className="text-warning-700">SA 600 answers pending: {ga.sa600Pending}</li>
            )}
            {ga && ga.instructionsPending > 0 && (
              <li className="text-warning-700">
                Component instructions not issued: {ga.instructionsPending}
              </li>
            )}
          </ul>
        )}
      </Section>

      {/* Professional Conclusion (CFS-05, §22) */}
      <Section id="cfs-05" title="Professional Conclusion (CFS-05)" open>
        {c.summary && (
          <p className="flex flex-wrap gap-2 text-xs text-ink-muted">
            <span>
              CFS required:{' '}
              {c.summary.cfsRequired == null ? 'not known' : c.summary.cfsRequired ? 'Yes' : 'No'}
            </span>
            {c.summary.framework && <span>· {c.summary.framework}</span>}
            <span>· DHVAJ components {c.summary.dhvajComponents}</span>
            <span>· other auditors {c.summary.otherAuditorComponents}</span>
            <span>· branch auditors {c.summary.branchAuditors}</span>
            <span>
              · work programme {c.summary.workProgrammeGenerated ? 'generated' : 'not generated'}
            </span>
          </p>
        )}
        <ProfessionalConclusion
          c={c}
          disabled={!editable || busy}
          canManage={editable}
          onDecide={(b) => decision.mutate(b)}
          onPartnerApprove={(note) => partner.mutate(note)}
          partnerBusy={partner.isPending}
        />
      </Section>

      {/* CFS-04 conversion work items (§11) */}
      {conversions.length > 0 && (
        <Section
          id="cfs-conversions"
          title={`GAAP / policy conversions (CFS-04) — ${conversions.filter((x) => x.status !== 'withdrawn').length} active`}
          open
        >
          <p className="text-xs text-ink-muted">
            Each component on a different framework gets its own conversion layer; its statutory
            accounts are never altered.
          </p>
          <ConversionList
            engagementId={engagementId}
            conversions={conversions}
            editable={editable}
            busy={busy}
            onSave={(id, body) => conversion.mutate({ id, body })}
          />
        </Section>
      )}

      {/* Workstream (§18, §19, Track B) */}
      {cfsRequired && (
        <Section id="cfs-workstream" title="Consolidation workstream (Section 05)">
          {!decided && (
            <p className="text-xs text-warning-700">
              Provisional — follows the system suggestion until CFS-05 confirms CFS Required.
            </p>
          )}
          {workProgramme ?? (
            <p className="text-sm text-ink-muted">
              The consolidation work programme is generated once the perimeter and auditor matrix
              are complete.
            </p>
          )}
        </Section>
      )}

      {/* Branch auditors — §143(8) applies with or without CFS (§17, Track B) */}
      {branchAuditors && (
        <Section
          id="cfs-branches"
          title="Branch auditors (§143(8))"
          open={!!d?.hasBranches || ga?.branchAuditPresent === 'yes'}
        >
          {branchAuditors}
        </Section>
      )}

      {/* Cross-links (§20) */}
      {c.crossLinks &&
        (c.crossLinks.caroComponents != null || c.crossLinks.icfrComponents != null) && (
          <Section id="cfs-cross-links" title="Cross-links (CARO 3(xxi), consolidated ICFR)">
            <ul className="space-y-0.5 text-sm">
              {c.crossLinks.caroComponents != null && (
                <li>CARO 3(xxi): {c.crossLinks.caroComponents} component(s) from this perimeter</li>
              )}
              {c.crossLinks.icfrComponents != null && (
                <li>
                  Consolidated ICFR: {c.crossLinks.icfrComponents} component(s) from this perimeter
                </li>
              )}
            </ul>
            {d?.crossLinkNote && <p className="text-xs text-ink-faint">{d.crossLinkNote}</p>}
          </Section>
        )}

      {/* Evidence / memo (§23) */}
      <Section id="cfs-evidence" title="Evidence / 02.6 memo" open={!!c.memoSuggested}>
        {c.memoSuggested && (
          <p className="text-xs text-warning-700">
            A consolidation memo is suggested — override, further assessment or partner approval.
          </p>
        )}
        {evidence ?? (
          <FrameworkEvidence
            engagementId={engagementId}
            workflowInstanceId={c.workflowInstanceId}
            subAssessmentId={a.id}
            memoSuggested={!!c.memoSuggested}
            readOnly={!editable}
          />
        )}
      </Section>

      {/* Prior Year (§21) */}
      <Section id="cfs-prior" title="Prior year" open={(c.priorYear?.changes.length ?? 0) > 0}>
        {c.priorYear ? (
          <div className="space-y-1 text-sm">
            <p>
              FY {c.priorYear.financialYear}:{' '}
              <span className="font-medium">{outcomeLabel(c.priorYear.outcome)}</span> ·{' '}
              {c.priorYear.components} component(s) in the CFS
            </p>
            {c.priorYear.basis && (
              <p className="text-xs text-ink-muted">Prior basis: {c.priorYear.basis}</p>
            )}
            {c.priorYear.changes.length > 0 ? (
              <ul
                className="ml-5 list-disc text-xs text-warning-700"
                aria-label="Changes from last year"
              >
                {c.priorYear.changes.map((ch, n) => (
                  <li key={`${ch.kind}-${ch.componentId ?? n}`}>{ch.message}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-muted">No change in the group structure.</p>
            )}
            <p className="text-xs text-ink-faint">
              Rolled forward as suggestions — the current-year rules always rerun on current facts.
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No prior-year 02.6 assessment on record.</p>
        )}
      </Section>

      {/* Completion (§24) */}
      <Section id="cfs-completion" title="Completion" open>
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
            02.6 COMPLETE — the perimeter passes to planning (03.3 materiality), CARO 3(xxi),
            consolidated ICFR and the Section 08 CFS report.
          </p>
        )}
      </Section>
    </div>
  );
}

// ── Rule 6 evidence (§7) ─────────────────────────────────────────────────────

function Rule6Form({
  evidence,
  parentFilesCompliantCfs,
  partiallyOwned,
  disabled,
  onSave,
}: {
  evidence: Rule6Evidence;
  parentFilesCompliantCfs: boolean | null;
  partiallyOwned: boolean;
  disabled: boolean;
  onSave: (e: Partial<Rule6Evidence>, parentFilesCompliantCfs: boolean | null) => void;
}): JSX.Element {
  const [e, setE] = useState<Rule6Evidence>(evidence);
  const [parent, setParent] = useState<boolean | null>(parentFilesCompliantCfs);
  const set = <K extends keyof Rule6Evidence>(k: K, v: Rule6Evidence[K]) =>
    setE((x) => ({ ...x, [k]: v }));
  const str = (v: string) => (v.trim() === '' ? null : v);
  return (
    <fieldset className="space-y-2 rounded-md border border-line p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Rule 6 evidence
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {partiallyOwned && (
          <>
            <Field label="All other members intimated in writing?">
              <Select
                value={triBool(e.otherMembersIntimatedInWriting)}
                disabled={disabled}
                onChange={(x) => set('otherMembersIntimatedInWriting', fromTri(x.target.value))}
              >
                <option value="">Not known</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            </Field>
            <Field label="Intimation date">
              <Input
                type="date"
                value={e.intimationDate ?? ''}
                disabled={disabled}
                onChange={(x) => set('intimationDate', str(x.target.value))}
              />
            </Field>
            <Field label="Proof of delivery retained?">
              <Select
                value={triBool(e.proofOfDeliveryRetained)}
                disabled={disabled}
                onChange={(x) => set('proofOfDeliveryRetained', fromTri(x.target.value))}
              >
                <option value="">Not known</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            </Field>
            <Field label="Objection status">
              <Select
                value={e.objectionStatus ?? ''}
                disabled={disabled}
                onChange={(x) =>
                  set('objectionStatus', (x.target.value || null) as MemberObjectionStatus | null)
                }
              >
                <option value="">Not recorded</option>
                {(Object.keys(OBJECTION_LABEL) as MemberObjectionStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {OBJECTION_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label="Does a parent file Companies-Act-compliant CFS?">
          <Select
            value={triBool(parent)}
            disabled={disabled}
            onChange={(x) => setParent(fromTri(x.target.value))}
          >
            <option value="">Not known yet</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </Field>
        <Field label="Intermediate / ultimate parent">
          <Input
            value={e.parentName ?? ''}
            disabled={disabled}
            onChange={(x) => set('parentName', str(x.target.value))}
          />
        </Field>
        <Field label="Parent's CFS filing SRN (AOC-4 CFS)">
          <Input
            value={e.parentFilingSrn ?? ''}
            disabled={disabled}
            onChange={(x) => set('parentFilingSrn', str(x.target.value))}
          />
        </Field>
        <Field label="Parent's filing date">
          <Input
            type="date"
            value={e.parentFilingDate ?? ''}
            disabled={disabled}
            onChange={(x) => set('parentFilingDate', str(x.target.value))}
          />
        </Field>
      </div>
      {!disabled && (
        <Button size="sm" onClick={() => onSave(e, parent)}>
          Save Rule 6 evidence
        </Button>
      )}
    </fieldset>
  );
}

// ── CFS-05 professional conclusion (§22) ─────────────────────────────────────

function ProfessionalConclusion({
  c,
  disabled,
  canManage,
  onDecide,
  onPartnerApprove,
  partnerBusy,
}: {
  c: StatutoryAuditConsolidation;
  disabled: boolean;
  canManage: boolean;
  onDecide: (b: Decision) => void;
  onPartnerApprove: (note: string) => void;
  partnerBusy: boolean;
}): JSX.Element {
  const a = c.assessment;
  const [mode, setMode] = useState<'none' | 'override' | 'pending'>('none');
  const [conclusion, setConclusion] = useState('');
  const [basis, setBasis] = useState('');
  const [technical, setTechnical] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [pending, setPending] = useState('');
  const [note, setNote] = useState('');
  const decided = isDecided(a.state, a.conclusion);
  const decisive =
    a.systemOutcome === 'cfs_required' ||
    a.systemOutcome === 'cfs_exempt' ||
    a.systemOutcome === 'not_applicable';
  const pa = c.partnerApproval;
  const blocking = (c.detail?.missingFacts ?? []).filter((m) => m.blocking);

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
          {a.conclusion !== a.systemOutcome && (
            <p className="text-ink-muted">
              System conclusion retained: {outcomeLabel(a.systemOutcome)}
            </p>
          )}
          {a.basis && <p className="text-ink-muted">Reason: {a.basis}</p>}
          {c.capturedFacts.technicalBasis && (
            <p className="text-ink-muted">Technical basis: {c.capturedFacts.technicalBasis}</p>
          )}
          {c.capturedFacts.supportingEvidence && (
            <p className="text-ink-muted">
              Supporting evidence: {c.capturedFacts.supportingEvidence}
            </p>
          )}
        </div>
      ) : c.professionalAction === 'information_pending' ? (
        <p className="text-warning-700">Information Pending — {c.pendingReason}</p>
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
            title={decisive ? undefined : 'The system could not determine whether CFS is required'}
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
          <Field label="Final conclusion" required>
            <Select value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
              <option value="">Select…</option>
              {CONSOLIDATION_CONCLUSIONS.filter((o) => !decisive || o !== a.systemOutcome).map(
                (o) => (
                  <option key={o} value={o}>
                    {CONSOLIDATION_OUTCOME_LABEL[o]}
                  </option>
                ),
              )}
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
                conclusion: conclusion as ConsolidationOutcome,
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
          ) : c.viewerIsPartner && canManage ? (
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

// ── CFS-04 conversion work items (§11) ───────────────────────────────────────

function ConversionList({
  engagementId,
  conversions,
  editable,
  busy,
  onSave,
}: {
  engagementId: string;
  conversions: ConsolidationConversion[];
  editable: boolean;
  busy: boolean;
  onSave: (id: string, body: UpdateConsolidationConversionInput) => void;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {conversions.map((cv) => {
        const isOpen = open === cv.id;
        return (
          <li key={cv.id} className="px-3 py-2">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : cv.id)}
              className="group flex w-full flex-wrap items-center gap-2 text-left"
            >
              <ExpandToggle open={isOpen} />
              <span className="text-sm font-medium text-ink">{cv.componentName}</span>
              <span className="text-xs text-ink-muted">
                {cv.localFramework ? LOCAL_FRAMEWORK_LABEL[cv.localFramework] : '—'} →{' '}
                {cv.groupFramework ? LOCAL_FRAMEWORK_LABEL[cv.groupFramework] : '—'}
              </span>
              <Badge
                tone={
                  cv.status === 'completed'
                    ? 'success'
                    : cv.status === 'withdrawn'
                      ? 'neutral'
                      : 'warn'
                }
              >
                {CONVERSION_STATUS_LABEL[cv.status]}
              </Badge>
              {cv.differences.length > 0 && (
                <span className="text-xs text-ink-faint">
                  {cv.differences.length} difference(s)
                </span>
              )}
            </button>
            {isOpen && (
              <ConversionEditor
                key={cv.version}
                engagementId={engagementId}
                cv={cv}
                editable={editable && cv.status !== 'withdrawn'}
                busy={busy}
                onSave={(body) => onSave(cv.id, body)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ConversionEditor({
  engagementId,
  cv,
  editable,
  busy,
  onSave,
}: {
  engagementId: string;
  cv: ConsolidationConversion;
  editable: boolean;
  busy: boolean;
  onSave: (body: UpdateConsolidationConversionInput) => void;
}): JSX.Element {
  const [status, setStatus] = useState<ConversionStatus>(cv.status);
  const [diffs, setDiffs] = useState<ConversionDifference[]>(cv.differences);
  const [reviewer, setReviewer] = useState<string | null>(cv.reviewerEmployeeId);
  const [picking, setPicking] = useState<'package' | 'tb' | null>(null);
  const team = useQuery({
    queryKey: ['engagement', engagementId, 'statutory-audit-team'],
    queryFn: () =>
      apiFetch<StatutoryAuditTeam[]>(`/engagements/${engagementId}/statutory-audit/team`),
    enabled: editable,
  });
  const t = team.data?.[0];
  const people = new Map<string, string>();
  if (t?.engagementPartnerId) people.set(t.engagementPartnerId, t.engagementPartnerName ?? 'EP');
  if (t?.engagementManagerId)
    people.set(t.engagementManagerId, t.engagementManagerName ?? 'Manager');
  for (const m of t?.members ?? []) people.set(m.employeeId, `${m.name} (${m.role})`);
  if (cv.reviewerEmployeeId && !people.has(cv.reviewerEmployeeId))
    people.set(cv.reviewerEmployeeId, cv.reviewerName ?? 'Reviewer');

  const setDiff = (n: number, patch: Partial<ConversionDifference>) =>
    setDiffs((ds) => ds.map((x, k) => (k === n ? { ...x, ...patch } : x)));
  const disabled = !editable || busy;
  const readyToComplete = !!reviewer && !!cv.adjustedTbDocumentId;

  return (
    <div className="mt-2 space-y-3 pl-7 text-sm">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          GAAP / policy differences
        </p>
        {diffs.length === 0 && <p className="text-xs text-ink-muted">None recorded yet.</p>}
        {diffs.map((df, n) => (
          <div key={n} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-4">
            <Field label="Area" required>
              <Input
                value={df.area}
                disabled={disabled}
                onChange={(e) => setDiff(n, { area: e.target.value })}
              />
            </Field>
            <Field label="Difference" required className="sm:col-span-2">
              <Input
                value={df.description}
                disabled={disabled}
                onChange={(e) => setDiff(n, { description: e.target.value })}
              />
            </Field>
            <Field label="Adjustment ref.">
              <Input
                value={df.adjustmentReference ?? ''}
                disabled={disabled}
                onChange={(e) => setDiff(n, { adjustmentReference: e.target.value || null })}
              />
            </Field>
            <Field label="Amount (₹)">
              <Input
                inputMode="decimal"
                value={df.amount ?? ''}
                disabled={disabled}
                onChange={(e) => {
                  const v = e.target.value.replace(/,/g, '').trim();
                  setDiff(n, {
                    amount: v === '' || !Number.isFinite(Number(v)) ? null : Number(v),
                  });
                }}
              />
            </Field>
            {editable && (
              <div className="flex items-end">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setDiffs((ds) => ds.filter((_, k) => k !== n))}
                  aria-label={`Remove difference ${n + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {editable && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              setDiffs((ds) => [
                ...ds,
                { area: '', description: '', adjustmentReference: null, amount: null },
              ])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add difference
          </Button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Reviewer" hint="Must be on the engagement team.">
          <Select
            value={reviewer ?? ''}
            disabled={disabled}
            onChange={(e) => setReviewer(e.target.value || null)}
          >
            <option value="">Not assigned</option>
            {[...people.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Status"
          hint={
            readyToComplete ? undefined : 'Completed needs a reviewer and the adjusted group TB.'
          }
        >
          <Select
            value={status}
            disabled={disabled}
            onChange={(e) => setStatus(e.target.value as ConversionStatus)}
          >
            {CONVERSION_EDITABLE.map((s) => (
              <option key={s} value={s} disabled={s === 'completed' && !readyToComplete}>
                {CONVERSION_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <dl className="grid gap-2 sm:grid-cols-2">
        <DocSlot
          label="Component reporting package"
          name={cv.reportingPackageName}
          editable={editable}
          busy={busy}
          onPick={() => setPicking(picking === 'package' ? null : 'package')}
          onClear={() => onSave({ reportingPackageDocumentId: null, version: cv.version })}
        />
        <DocSlot
          label="Final adjusted group TB"
          name={cv.adjustedTbName}
          editable={editable && cv.status !== 'completed'}
          busy={busy}
          onPick={() => setPicking(picking === 'tb' ? null : 'tb')}
          onClear={() => onSave({ adjustedTbDocumentId: null, version: cv.version })}
        />
      </dl>
      {picking && (
        <LinkPicker
          engagementId={engagementId}
          exclude={[cv.reportingPackageDocumentId, cv.adjustedTbDocumentId].filter(
            (x): x is string => !!x,
          )}
          onPick={async (documentId) => {
            onSave(
              picking === 'package'
                ? { reportingPackageDocumentId: documentId, version: cv.version }
                : { adjustedTbDocumentId: documentId, version: cv.version },
            );
            setPicking(null);
          }}
        />
      )}
      {cv.reviewedAt && (
        <p className="text-xs text-success-700">
          Completed {formatDate(cv.reviewedAt)}
          {cv.reviewerName ? ` · reviewed by ${cv.reviewerName}` : ''}
        </p>
      )}

      {editable && (
        <Button
          size="sm"
          disabled={busy || diffs.some((x) => !x.area.trim() || !x.description.trim())}
          onClick={() =>
            onSave({
              status: status === cv.status ? undefined : status,
              differences: diffs,
              reviewerEmployeeId: reviewer,
              version: cv.version,
            })
          }
        >
          Save work item
        </Button>
      )}
    </div>
  );
}

function DocSlot({
  label,
  name,
  editable,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  name: string | null;
  editable: boolean;
  busy: boolean;
  onPick: () => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-sm text-ink">
        {name ?? <span className="text-ink-muted">Not linked</span>}
        {editable && (
          <>
            <Button size="sm" variant="secondary" disabled={busy} onClick={onPick}>
              {name ? 'Replace' : 'Link document'}
            </Button>
            {name && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={onClear}>
                Unlink
              </Button>
            )}
          </>
        )}
      </dd>
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
