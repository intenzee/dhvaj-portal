'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Database,
  History,
  Info,
  Lock,
  MessageSquare,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
} from 'lucide-react';
import {
  DATASET_STATUSES,
  EXPECTATION_BASES,
  EXPECTATION_BASIS_LABEL,
  EXPECTATION_CONCLUSION_LABEL,
  EXPECTATION_CONCLUSIONS,
  FINANCIAL_UNIT_LABEL,
  FINANCIAL_UNITS,
  INVESTIGATION_ASSESSMENT_LABEL,
  INVESTIGATION_ASSESSMENTS,
  METRIC_SOURCE_TYPE_LABEL,
  METRIC_SOURCE_TYPES,
  ANALYTICS_RULE_KIND_LABEL,
  PLANNING_ATTENTION_LABEL,
  UNDERSTANDING_CHALLENGE_TARGETS,
  UNDERSTANDING_SECTION_DEFS,
  planningVersionLabel,
  type AnalyticsRuleOutcome,
  type AreaOfFocusRecord,
  type BusinessUnderstandingSummary,
  type IndustryConsiderationDecision,
  type PlanningCapability,
  type UnderstandingChallengeRecord,
  type UnderstandingChallengeTarget,
  type UnderstandingRevisionDetail,
  type UnderstandingRevisionRecord,
  type UnderstandingStatus,
  type DatasetStatus,
  type ExpectationBasis,
  type ExpectationConclusion,
  type ExpectationDirection,
  type ExpectationType,
  type FinancialPeriod,
  type FinancialUnit,
  type IndustryProfile,
  type InvestigationAssessment,
  type InvestigationCardRecord,
  type InvestigationSignalDecision,
  type MetricSourceType,
  type PlanningExpectationRecord,
  type PlanningSignalRecord,
  type UnderstandingAnswer,
  type UnderstandingFieldDef,
  type UnderstandingSectionDef,
  type UnderstandingSectionRecord,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { CompletionChecklist } from './planning-strategy-sections';
import { FrameworkReferences } from './framework-references';
import { PlanningEvidence } from './planning-evidence';
import { PlanningGovernanceProvider, type PlanningGovernance } from './planning-governance';
import { SectionLauncher } from './section-launcher';

/**
 * 03.2 Business Understanding & Preliminary Analytics (DHVAJ 03.2). The portal
 * calculates, compares and relates; the auditor interprets. Exceptions open
 * Investigation Cards and findings become Planning Signals in the SAME register
 * as 03.1. No trial-balance import in v1 — figures are entered with a source.
 *
 * §23: Article / Senior record facts, figures, explanations and evidence; the
 * Engagement Manager reviews, assesses, links signals and completes; the
 * Engagement Partner views and challenges. A completed 03.2 is frozen until
 * reopened for a controlled revision (§20). The API enforces all of it; the UI
 * only hides what would be refused.
 */

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

type Tab =
  | 'understanding'
  | 'dataset'
  | 'analytics'
  | 'investigations'
  | 'expectations'
  | 'conclusion'
  | 'review';

const STATUS_BADGE: Record<UnderstandingStatus, [string, 'neutral' | 'info' | 'success' | 'danger']> = {
  not_started: ['Not started', 'neutral'],
  in_progress: ['In progress', 'info'],
  complete: ['Complete', 'success'],
  reassessment_required: ['Reassessment required', 'danger'],
};

const CHALLENGE_TARGET_LABEL: Record<UnderstandingChallengeTarget, string> = {
  section: 'An understanding section',
  dataset: 'Financial dataset',
  analytics: 'Analytical review',
  exception: 'An Investigation Card',
  expectation: 'An expectation',
  conclusion: 'Conclusion / BA-01',
};

const DATASET_STATUS_LABEL: Record<DatasetStatus, string> = {
  draft: 'Draft',
  final: 'Final',
  management_accounts: 'Management accounts',
};

const fmt = (n: number | null | undefined, dp = 2) =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: dp });

export function BusinessUnderstandingPanel({
  engagementId,
  workflowInstanceId,
  team,
  editable,
  onChanged,
}: {
  engagementId: string;
  workflowInstanceId: string;
  team: TeamMember[];
  /** Section 03 is open (02.8 §14) — the §23 role and the 03.2 lock gate the rest. */
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab | null>(null);
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}`;
  const qk = ['engagement', engagementId, 'business-understanding', workflowInstanceId];
  const summary = useQuery({
    queryKey: [...qk, 'summary'],
    queryFn: () => apiFetch<BusinessUnderstandingSummary>(`${base}/business-understanding`),
  });
  const signals = useQuery({
    queryKey: ['engagement', engagementId, 'planning-intelligence', workflowInstanceId, 'signals'],
    queryFn: () => apiFetch<PlanningSignalRecord[]>(`${base}/planning-signals`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk });
    // 03.2 writes into the shared 03.1 register.
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'planning-intelligence'] });
    onChanged();
  };

  const setProfile = useMutation({
    mutationFn: (industryProfile: IndustryProfile) =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/business-understanding`, {
        method: 'POST',
        body: { industryProfile, version: summary.data!.record.version },
      }),
    onSuccess: () => {
      toast('Industry profile updated — analytics recalculated.');
      refresh();
    },
    onError: (e) => toast(errMsg(e, 'Could not change the industry profile.')),
  });

  const prefill = useMutation({
    mutationFn: () =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/business-understanding/prefill`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      toast('Blanks filled from the client master — nothing you recorded was changed.');
      refresh();
    },
    onError: (e) => toast(errMsg(e, 'Could not fill from the client master.')),
  });

  if (summary.isLoading) return <Spinner label="Loading 03.2…" />;
  const s = summary.data;
  if (!s) return <p className="text-sm text-ink-muted">03.2 is unavailable.</p>;
  const outstanding = s.completion.filter((c) => !c.met).length;
  const a = s.access;
  /** The §23 capability alone — for steps the 03.2 lock does not stop (EP review, reopen). */
  const has = (c: PlanningCapability) => editable && !!a.capabilities[c];
  /** May the caller do this now (capability and the completion / 03.12 lock)? */
  const can = (c: PlanningCapability) => has(c) && !a.locked;
  const facts = can('addFacts');
  const assess = can('assess');
  const gov: PlanningGovernance = { view: null, engagementId, base, can, has, refresh };
  const openChallenges = s.challenges.filter((c) => c.status !== 'closed').length;
  const [statusLabel, statusTone] = STATUS_BADGE[s.record.status];

  const sections: [Tab, string][] = [
        ['understanding', 'Understanding (03.2.1–6)'],
        ['dataset', 'Financial dataset'],
        ['analytics', 'Analytical review'],
        ['investigations', `Investigations${s.openInvestigations ? ` (${s.openInvestigations})` : ''}`],
        ['expectations', 'Expectations'],
        ['conclusion', outstanding ? `Conclusion (${outstanding} to do)` : 'Conclusion'],
        ['review', `Partner review & revisions${openChallenges ? ` (${openChallenges})` : ''}`],
      ];

  return (
    <PlanningGovernanceProvider value={gov}>
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone}>{statusLabel}</Badge>
          <Badge tone="neutral">{s.versionInfo.versionLabel}</Badge>
          {s.openInvestigations > 0 && <Badge tone="warn">{s.openInvestigations} open investigation(s)</Badge>}
          <span className="text-xs text-ink-faint">
            You: {a.roleLabel}
            {a.actingAsManager ? ' (acting as Engagement Manager)' : ''}
          </span>
          {facts && (
            <Button
              size="sm"
              variant="ghost"
              disabled={prefill.isPending}
              title="Fill empty fields from the client master and the entity's financial profiles. Recorded figures are never overwritten."
              onClick={() => prefill.mutate()}
            >
              <Database className="h-4 w-4" />
              Fill from client master
            </Button>
          )}
        </div>
        <div className="w-64">
          <Field label="Industry analytics profile">
            <Select
              value={s.record.industryProfile}
              disabled={!assess || setProfile.isPending}
              onChange={(e) => setProfile.mutate(e.target.value as IndustryProfile)}
            >
              {!s.industryProfiles.some((p) => p.key === s.record.industryProfile) && (
                <option value={s.record.industryProfile}>
                  {s.record.industryProfile} (retired — using {s.analyticsMethodology.profileLabel})
                </option>
              )}
              {s.industryProfiles.map((p) => (
                <option key={p.key} value={p.key} title={p.description}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <UnderstandingStatusStrip base={base} summary={s} mayReopen={has('reopen')} onChanged={refresh} />

      <FrameworkReferences contextKey="03.2" anchors={s.authorityAnchors} />

      <SectionLauncher sections={sections} open={tab} onToggle={setTab} context="03.2 Business Understanding & Preliminary Analytics">
        {tab === 'understanding' && (
          <div className="space-y-2">
            {UNDERSTANDING_SECTION_DEFS.map((def) => {
              const evidenceId = s.recordIds.sections[def.key];
              return (
                <SectionCard
                  key={`${def.key}-${s.sections.find((x) => x.key === def.key)!.version}`}
                  base={base}
                  def={def}
                  section={s.sections.find((x) => x.key === def.key)!}
                  industryConsiderations={def.key === 'industry' ? s.industryConsiderations : []}
                  subIndustryOptions={s.subIndustryOptions}
                  decisions={s.industryConsiderationDecisions}
                  evidenceId={evidenceId ?? null}
                  evidenceCount={evidenceId ? (s.evidenceCounts[evidenceId] ?? 0) : 0}
                  facts={facts}
                  assess={assess}
                  canPropose={can('proposeSignals')}
                  onChanged={refresh}
                />
              );
            })}
          </div>
        )}
        {tab === 'dataset' && (
          <DatasetSection key={s.dataset.version} base={base} summary={s} editable={facts} onChanged={refresh} />
        )}
        {tab === 'analytics' && (
          <AnalyticsSection
            base={base}
            summary={s}
            // Refresh runs on a completed 03.2 too — a changed figure flags reassessment (§20).
            editable={has('addFacts') && !a.planningLocked}
            onChanged={refresh}
          />
        )}
        {tab === 'investigations' && (
          <InvestigationsSection
            engagementId={engagementId}
            base={base}
            qk={qk}
            team={team}
            signals={signals.data ?? []}
            evidenceCounts={s.evidenceCounts}
            facts={facts}
            assess={assess}
            canFocus={can('focusAreas')}
            onChanged={refresh}
          />
        )}
        {tab === 'expectations' && (
          <ExpectationsSection
            engagementId={engagementId}
            base={base}
            qk={qk}
            summary={s}
            facts={facts}
            assess={assess}
            onChanged={refresh}
          />
        )}
        {tab === 'conclusion' && (
          <ConclusionSection key={s.record.version} base={base} summary={s} editable={assess} onChanged={refresh} />
        )}
        {tab === 'review' && (
          <ReviewSection
            engagementId={engagementId}
            base={base}
            qk={qk}
            summary={s}
            mayChallenge={has('partnerReview')}
            mayRespond={has('respondToChallenge')}
            onChanged={refresh}
          />
        )}
      </SectionLauncher>
    </div>
    </PlanningGovernanceProvider>
  );
}

// ── §20 status, completion lock and controlled revision ─────────────────────

function UnderstandingStatusStrip({
  base,
  summary: s,
  mayReopen,
  onChanged,
}: {
  base: string;
  summary: BusinessUnderstandingSummary;
  mayReopen: boolean;
  onChanged: () => void;
}): JSX.Element | null {
  const toast = useToast();
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const v = s.versionInfo;
  const a = s.access;
  const next = planningVersionLabel(v.versionNo + 1);
  const reopen = useMutation({
    mutationFn: () =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/business-understanding/reopen`, {
        method: 'POST',
        body: { reason, version: s.record.version },
      }),
    onSuccess: () => {
      toast(`03.2 reopened — revising as ${next}.`);
      setReopening(false);
      setReason('');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not reopen 03.2.')),
  });
  const reassess = s.record.status === 'reassessment_required' && v.reassessmentReason;
  if (!reassess && !a.lockReason) return null;
  return (
    <div className="space-y-2">
      {reassess && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Reassessment required — {v.reassessmentReason} The completed version is frozen in the revision history;
            reassess the cards and answer BA-01 again.
          </span>
        </div>
      )}
      {a.lockReason && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink-muted">
          <span className="flex items-start gap-1.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {a.lockReason}
              {s.record.status === 'complete' && v.completedByName
                ? ` Completed by ${v.completedByName}${v.completedAt ? ` on ${new Date(v.completedAt).toLocaleDateString()}` : ''}.`
                : ''}
            </span>
          </span>
          {s.record.status === 'complete' && !a.planningLocked && mayReopen && (
            <Button size="sm" variant="secondary" onClick={() => setReopening((o) => !o)} aria-expanded={reopening}>
              <RotateCcw className="h-4 w-4" /> {reopening ? '−' : '+'} Reopen for revision
            </Button>
          )}
        </div>
      )}
      {reopening && (
        <Card className="space-y-2 p-3">
          <Field label="Why is 03.2 being revised?" required>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <p className="text-[11px] text-ink-faint">
            {v.versionLabel} is frozen as the revision baseline; the revision becomes {next}. BA-01 must be answered
            again before 03.2 is complete.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => reopen.mutate()} disabled={reopen.isPending || !reason.trim()}>
              Reopen as {next}
            </Button>
            <Button variant="ghost" onClick={() => setReopening(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── 03.2.1–03.2.6 Understanding sections ────────────────────────────────────

function SectionCard({
  base,
  def,
  section,
  industryConsiderations,
  subIndustryOptions,
  decisions,
  evidenceId,
  evidenceCount,
  facts,
  assess,
  canPropose,
  onChanged,
}: {
  base: string;
  def: UnderstandingSectionDef;
  section: UnderstandingSectionRecord;
  industryConsiderations: string[];
  /** §7 sub-industry taxonomy of the in-force industry profile ([] = free text). */
  subIndustryOptions: string[];
  decisions: Record<string, IndustryConsiderationDecision>;
  evidenceId: string | null;
  evidenceCount: number;
  /** Record answers (Article / Senior up). */
  facts: boolean;
  /** Mark reviewed (Engagement Manager). */
  assess: boolean;
  canPropose: boolean;
  onChanged: () => void;
}): JSX.Element {
  const editable = facts;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState<'yes' | 'no' | null>(section.anythingChanged);
  const [answers, setAnswers] = useState<Record<string, UnderstandingAnswer>>(section.answers);
  const [raising, setRaising] = useState(false);
  // Ask "has anything changed?" before showing the detail (spec §5).
  const showDetail = changed !== null || section.version > 0;
  const dirty =
    changed !== section.anythingChanged || JSON.stringify(answers) !== JSON.stringify(section.answers);

  const save = useMutation({
    mutationFn: (reviewed?: boolean) =>
      apiFetch<UnderstandingSectionRecord>(`${base}/business-understanding/sections/${def.key}`, {
        method: 'POST',
        body: { anythingChanged: changed ?? undefined, answers, reviewed, version: section.version },
      }),
    onSuccess: (_r, reviewed) => {
      toast(reviewed ? `${def.code} marked reviewed.` : `${def.code} saved.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the section.')),
  });

  return (
    <Card className="p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-ink-faint" /> : <ChevronRight className="h-4 w-4 text-ink-faint" />}
          <span className="font-mono text-xs text-ink-faint">{def.code}</span>
          <span className="text-sm font-medium text-ink">{def.title}</span>
        </span>
        <span className="flex gap-1.5">
          {section.anythingChanged === 'yes' && <Badge tone="warn">Changed</Badge>}
          <Badge tone={section.reviewed ? 'success' : 'neutral'}>{section.reviewed ? 'Reviewed' : 'Not reviewed'}</Badge>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
          <p className="text-xs text-ink-muted">{def.purpose}</p>
          {section.context.length > 0 && (
            <div className="rounded-lg bg-surface-raised p-2">
              <div className="mb-1 text-xs font-medium text-ink-muted">Already recorded elsewhere (not asked again)</div>
              <ul className="space-y-0.5 text-xs text-ink">
                {section.context.map((c, i) => (
                  <li key={i}>
                    <span className="text-ink-faint">[{c.source}]</span> {c.label}: {c.value}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {industryConsiderations.length > 0 && (
            <ConsiderationList
              base={base}
              items={industryConsiderations}
              decisions={decisions}
              assess={assess}
              onChanged={onChanged}
            />
          )}
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm text-ink">Has anything changed since the prior understanding?</span>
            {(['no', 'yes'] as const).map((v) => (
              <label key={v} className="inline-flex items-center gap-1.5 text-sm text-ink">
                <input type="radio" name={`changed-${def.key}`} disabled={!editable} checked={changed === v} onChange={() => setChanged(v)} />
                {v === 'yes' ? 'Yes' : 'No'}
              </label>
            ))}
          </div>
          {showDetail && (
            <div className="grid gap-3 sm:grid-cols-2">
              {def.fields.map((f) => (
                <div key={f.key} className={f.type === 'repeat' || f.type === 'multi' ? 'sm:col-span-2' : ''}>
                  {f.key === 'sub_industry' && subIndustryOptions.length > 0 ? (
                    <SubIndustryInput
                      field={f}
                      options={subIndustryOptions}
                      value={(answers[f.key] as string | null) ?? null}
                      disabled={!editable}
                      onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))}
                    />
                  ) : (
                    <FieldInput
                      field={f}
                      value={answers[f.key] ?? null}
                      disabled={!editable}
                      onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          {section.reviewed && facts && !assess && (
            <p className="text-[11px] text-ink-faint">
              Saving a change clears “Reviewed” — the Engagement Manager reviews the section again.
            </p>
          )}
          {evidenceId && <PlanningEvidence targetType="understanding_section" targetId={evidenceId} count={evidenceCount} />}
          {(facts || canPropose) && (
            <div className="flex flex-wrap gap-2">
              {facts && (
                <Button variant="secondary" onClick={() => save.mutate(undefined)} disabled={save.isPending || changed === null || !dirty}>
                  Save
                </Button>
              )}
              {assess && (
                <Button onClick={() => save.mutate(true)} disabled={save.isPending || changed === null || (section.reviewed && !dirty)}>
                  {section.reviewed && !dirty ? 'Reviewed' : 'Save & mark reviewed'}
                </Button>
              )}
              {canPropose && (
                <Button variant="ghost" onClick={() => setRaising((r) => !r)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  {assess ? 'Raise Planning Signal' : 'Propose Planning Signal'}
                </Button>
              )}
            </div>
          )}
          {raising && <RaiseSignalForm base={base} sourceLink={`03.2/${def.key}`} onDone={() => setRaising(false)} onChanged={onChanged} />}
        </div>
      )}
    </Card>
  );
}

/** §7 — the Manager confirms whether each suggested consideration is relevant here. */
function ConsiderationList({
  base,
  items,
  decisions,
  assess,
  onChanged,
}: {
  base: string;
  items: string[];
  decisions: Record<string, IndustryConsiderationDecision>;
  assess: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: (body: { consideration: string; relevant: boolean | null; note?: string }) =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/business-understanding/considerations`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => onChanged(),
    onError: (e) => toast(errMsg(e, 'Could not record the decision.')),
  });
  const undecided = items.filter((c) => !decisions[c]).length;
  return (
    <div className="rounded-lg bg-primary-50 p-2 text-xs text-primary-700">
      <div className="mb-1 font-medium">
        Suggested industry considerations — the Engagement Manager confirms relevance
        {undecided ? ` (${undecided} to confirm)` : ''}
      </div>
      <ul className="space-y-1.5">
        {items.map((c) => {
          const d = decisions[c];
          return (
            <li key={c} className="rounded-md bg-surface px-2 py-1.5 text-ink">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">{c}</span>
                {d ? (
                  <Badge tone={d.relevant ? 'warn' : 'neutral'}>{d.relevant ? 'Relevant' : 'Not relevant'}</Badge>
                ) : (
                  <Badge tone="neutral">Not confirmed</Badge>
                )}
              </div>
              {d && (
                <p className="text-[11px] text-ink-faint">
                  {d.note ? `${d.note} · ` : ''}
                  {d.byName ?? '—'}, {new Date(d.at).toLocaleDateString()}
                </p>
              )}
              {assess && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <div className="w-56">
                    <Input
                      placeholder="Note (optional)"
                      aria-label={`Note on ${c}`}
                      value={notes[c] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [c]: e.target.value }))}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ consideration: c, relevant: true, note: notes[c] || undefined })}
                  >
                    Relevant
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ consideration: c, relevant: false, note: notes[c] || undefined })}
                  >
                    Not relevant
                  </Button>
                  {d && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ consideration: c, relevant: null })}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const OTHER_SUB_INDUSTRY = '__other__';

/**
 * §7 sub-industry: a pick list from the in-force industry profile, with "Other"
 * free text always allowed. The answer stays a plain string, so a value the
 * profile no longer lists (a later methodology version) shows as Other with its
 * text — never silently cleared.
 */
function SubIndustryInput({
  field,
  options,
  value,
  disabled,
  onChange,
}: {
  field: UnderstandingFieldDef;
  options: string[];
  value: string | null;
  disabled: boolean;
  onChange: (v: string | null) => void;
}): JSX.Element {
  const listed = !!value && options.includes(value);
  // Other is derived from the value, so a value a newly selected profile does not
  // list still shows (and stays editable); state only holds an Other picked with no text yet.
  const [otherPicked, setOtherPicked] = useState(false);
  const [saved] = useState(value);
  const selected = listed ? value! : value || otherPicked ? OTHER_SUB_INDUSTRY : '';
  return (
    <Field label={field.label} hint={field.hint}>
      <div className="space-y-1.5">
        <Select
          aria-label={field.label}
          disabled={disabled}
          value={selected}
          onChange={(e) => {
            const v = e.target.value;
            setOtherPicked(v === OTHER_SUB_INDUSTRY);
            onChange(v === OTHER_SUB_INDUSTRY ? (listed ? null : value) : v || null);
          }}
        >
          <option value="">— Select —</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value={OTHER_SUB_INDUSTRY}>Other (specify)</option>
        </Select>
        {selected === OTHER_SUB_INDUSTRY && (
          <Input
            aria-label={`${field.label} — other`}
            placeholder="Describe the sub-industry"
            disabled={disabled}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
          />
        )}
        {!!value && !listed && value === saved && (
          <p className="text-[11px] text-ink-faint">Not in the current profile list — kept as entered.</p>
        )}
      </div>
    </Field>
  );
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: UnderstandingFieldDef;
  value: UnderstandingAnswer;
  disabled: boolean;
  onChange: (v: UnderstandingAnswer) => void;
}): JSX.Element {
  const label = field.code ? `${field.code} · ${field.label}` : field.label;
  switch (field.type) {
    case 'text':
      return (
        <Field label={label} hint={field.hint}>
          <Textarea rows={2} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'yes_no':
    case 'yes_no_unknown':
    case 'select':
      return (
        <Field label={label} hint={field.hint}>
          <Select disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">— Select —</option>
            {field.options!.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'multi': {
      const picked = (value as string[]) ?? [];
      return (
        <Field label={label} hint={field.hint}>
          <div className="flex flex-wrap gap-3">
            {field.options!.map((o) => (
              <label key={o} className="inline-flex items-center gap-1.5 text-xs text-ink">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={picked.includes(o)}
                  onChange={(e) => onChange(e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))}
                />
                {o}
              </label>
            ))}
          </div>
        </Field>
      );
    }
    case 'repeat': {
      const rows = (value as string[][]) ?? [];
      const cols = field.columns!;
      const set = (r: number, c: number, v: string) =>
        onChange(rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row)));
      return (
        <Field label={label} hint={field.hint}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c} className="px-1 py-1 text-left font-medium text-ink-muted">
                      {c}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className="px-1 py-0.5">
                        <Input disabled={disabled} value={cell} onChange={(e) => set(r, c, e.target.value)} />
                      </td>
                    ))}
                    <td>
                      {!disabled && (
                        <Button variant="ghost" onClick={() => onChange(rows.filter((_, i) => i !== r))}>
                          ✕
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!disabled && (
            <Button variant="ghost" onClick={() => onChange([...rows, cols.map(() => '')])}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add row
            </Button>
          )}
        </Field>
      );
    }
  }
}

function RaiseSignalForm({
  base,
  sourceLink,
  onDone,
  onChanged,
}: {
  base: string;
  sourceLink: string;
  onDone: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [observation, setObservation] = useState('');
  const [why, setWhy] = useState('');
  const create = useMutation({
    mutationFn: () =>
      apiFetch<PlanningSignalRecord>(`${base}/planning-signals`, {
        method: 'POST',
        body: { source: 'manager', sourceLink, observation, whyMayMatter: why || undefined },
      }),
    onSuccess: (sig) => {
      toast(`${sig.signalCode} added to the Planning Signal Register.`);
      onChanged();
      onDone();
    },
    onError: (e) => toast(errMsg(e, 'Could not raise the signal.')),
  });
  return (
    <div className="space-y-2 rounded-lg bg-surface-raised p-3">
      <Field label="Observation" hint="The fact only — not a risk conclusion." required>
        <Textarea rows={2} value={observation} onChange={(e) => setObservation(e.target.value)} />
      </Field>
      <Field label="Why it may matter">
        <Input value={why} onChange={(e) => setWhy(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button onClick={() => create.mutate()} disabled={create.isPending || !observation.trim()}>
          Raise signal
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── 03.2.7 Focused Financial Dataset ────────────────────────────────────────

interface CellState {
  amount: string;
  source: MetricSourceType | '';
  version: number;
  original: string;
  originalSource: MetricSourceType | '';
}

function DatasetSection({
  base,
  summary: s,
  editable,
  onChanged,
}: {
  base: string;
  summary: BusinessUnderstandingSummary;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const h = s.dataset;
  const [header, setHeader] = useState({
    periodEnd: h.periodEnd ?? '',
    pyPeriodEnd: h.pyPeriodEnd ?? '',
    currency: h.currency ?? 'INR',
    units: (h.units ?? '') as FinancialUnit | '',
    pyUnits: (h.pyUnits ?? '') as FinancialUnit | '',
    cySource: h.cySource ?? '',
    pySource: h.pySource ?? '',
    dataStatus: (h.dataStatus ?? '') as DatasetStatus | '',
    sourceDate: h.sourceDate ?? '',
  });
  const ready = !!(h.periodEnd && h.currency && h.units);
  const defaultSource = (p: FinancialPeriod): MetricSourceType =>
    p === 'py' ? 'audited_py_fs' : h.dataStatus === 'management_accounts' ? 'management_accounts' : 'draft_fs';

  const metrics = [
    ...s.analyticsMethodology.metrics.map((d) => ({
      key: d.key,
      label: d.valueType === 'amount' ? d.label : `${d.label} (${d.valueType === 'count' ? 'number' : '%'} — not in ${h.units ? FINANCIAL_UNIT_LABEL[h.units] : 'units'})`,
      note: d.note,
    })),
    // Figures recorded under a metric the profile no longer offers stay visible (and clearable).
    ...[...new Set(s.values.map((v) => v.metricKey))]
      .filter(
        (k) =>
          !s.analyticsMethodology.metrics.some((d) => d.key === k) &&
          !s.customMetrics.some((c) => c.key === k),
      )
      .map((k) => ({ key: k, label: k, note: 'Not in this profile' })),
    ...s.customMetrics.map((c) => ({ key: c.key, label: c.label, note: 'Custom' })),
  ];
  const initialCells = () => {
    const out: Record<string, CellState> = {};
    for (const m of metrics) {
      for (const p of ['cy', 'py'] as FinancialPeriod[]) {
        const v = s.values.find((x) => x.metricKey === m.key && x.period === p);
        const amount = v ? String(v.amount) : '';
        out[`${m.key}:${p}`] = {
          amount,
          source: v?.sourceType ?? '',
          version: v?.version ?? 0,
          original: amount,
          originalSource: v?.sourceType ?? '',
        };
      }
    }
    return out;
  };
  const [cells, setCells] = useState<Record<string, CellState>>(initialCells);
  const [newMetric, setNewMetric] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const dirty = Object.entries(cells).filter(([, c]) => c.amount !== c.original || c.source !== c.originalSource);
  const valueOf = (key: string) => {
    const [metricKey, period] = key.split(':') as [string, FinancialPeriod];
    return s.values.find((x) => x.metricKey === metricKey && x.period === period);
  };
  // §21 — changing or clearing a figure rolled forward from last year's approved file needs a reason.
  const overridden = new Set(
    dirty
      .filter(([key, c]) => {
        const rf = valueOf(key)?.rolledForward;
        if (!rf?.approved) return false;
        const amount = c.amount.trim() === '' ? null : Number(c.amount);
        return amount === null || Math.abs(amount - rf.amount) >= 0.005;
      })
      .map(([key]) => key),
  );

  const saveHeader = useMutation({
    mutationFn: () =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/financial-dataset`, {
        method: 'POST',
        body: {
          periodEnd: header.periodEnd || undefined,
          pyPeriodEnd: header.pyPeriodEnd || undefined,
          currency: header.currency || undefined,
          units: header.units || undefined,
          pyUnits: header.pyUnits || undefined,
          cySource: header.cySource || undefined,
          pySource: header.pySource || undefined,
          dataStatus: header.dataStatus || undefined,
          sourceDate: header.sourceDate || undefined,
          version: h.version,
        },
      }),
    onSuccess: () => {
      toast('Dataset header saved.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the header.')),
  });

  const saveValues = useMutation({
    mutationFn: () =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/financial-dataset/values`, {
        method: 'POST',
        body: {
          values: dirty.map(([key, c]) => {
            const [metricKey, period] = key.split(':') as [string, FinancialPeriod];
            return {
              metricKey,
              period,
              amount: c.amount.trim() === '' ? null : Number(c.amount),
              sourceType: c.source || defaultSource(period),
              overrideReason: overridden.has(key) ? overrideReason : undefined,
              version: c.version,
            };
          }),
        },
      }),
    onSuccess: (r) => {
      toast(`Figures saved — ${r.analytics.exceptions.length} exception(s) surfaced for investigation.`);
      setOverrideReason('');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the figures.')),
  });

  const addMetric = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/financial-dataset/custom-metrics`, { method: 'POST', body: { label: newMetric } }),
    onSuccess: () => {
      toast('Custom metric added.');
      setNewMetric('');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not add the metric.')),
  });

  const invalid = dirty.some(([, c]) => c.amount.trim() !== '' && Number.isNaN(Number(c.amount)));
  const set = (key: string, patch: Partial<CellState>) => setCells((cur) => ({ ...cur, [key]: { ...cur[key]!, ...patch } }));

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        No trial-balance import in v1 — enter the planning figures from management accounts or draft
        statements. Every figure records its source.
      </p>
      <Card className="space-y-3 p-3">
        <div className="text-sm font-medium text-ink">Dataset header</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Period end" required>
            <Input type="date" disabled={!editable} value={header.periodEnd} onChange={(e) => setHeader({ ...header, periodEnd: e.target.value })} />
          </Field>
          <Field label="Prior period end">
            <Input type="date" disabled={!editable} value={header.pyPeriodEnd} onChange={(e) => setHeader({ ...header, pyPeriodEnd: e.target.value })} />
          </Field>
          <Field label="Currency" required>
            <Input disabled={!editable} maxLength={3} value={header.currency} onChange={(e) => setHeader({ ...header, currency: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Units" required>
            <Select disabled={!editable} value={header.units} onChange={(e) => setHeader({ ...header, units: e.target.value as FinancialUnit })}>
              <option value="">— Select —</option>
              {FINANCIAL_UNITS.map((u) => (
                <option key={u} value={u}>
                  {FINANCIAL_UNIT_LABEL[u]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prior-year units" hint="Only if different — the portal converts.">
            <Select disabled={!editable} value={header.pyUnits} onChange={(e) => setHeader({ ...header, pyUnits: e.target.value as FinancialUnit })}>
              <option value="">Same as current year</option>
              {FINANCIAL_UNITS.map((u) => (
                <option key={u} value={u}>
                  {FINANCIAL_UNIT_LABEL[u]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Data status" required>
            <Select disabled={!editable} value={header.dataStatus} onChange={(e) => setHeader({ ...header, dataStatus: e.target.value as DatasetStatus })}>
              <option value="">— Select —</option>
              {DATASET_STATUSES.map((d) => (
                <option key={d} value={d}>
                  {DATASET_STATUS_LABEL[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Current-year source" required>
            <Input disabled={!editable} placeholder="e.g. Draft FS FY26 v2" value={header.cySource} onChange={(e) => setHeader({ ...header, cySource: e.target.value })} />
          </Field>
          <Field label="Prior-year source">
            <Input disabled={!editable} placeholder="e.g. Audited FS FY25" value={header.pySource} onChange={(e) => setHeader({ ...header, pySource: e.target.value })} />
          </Field>
          <Field label="Source date">
            <Input type="date" disabled={!editable} value={header.sourceDate} onChange={(e) => setHeader({ ...header, sourceDate: e.target.value })} />
          </Field>
        </div>
        {h.preparedByName && <p className="text-[11px] text-ink-faint">Prepared by {h.preparedByName}</p>}
        {s.recordIds.dataset && (
          <div>
            <p className="text-[11px] text-ink-faint">
              Board / management pack, budget or draft statements the figures come from:
            </p>
            <PlanningEvidence
              targetType="financial_dataset"
              targetId={s.recordIds.dataset}
              count={s.evidenceCounts[s.recordIds.dataset] ?? 0}
            />
          </div>
        )}
        {editable && (
          <Button variant="secondary" onClick={() => saveHeader.mutate()} disabled={saveHeader.isPending || !header.periodEnd || !header.units || !header.currency}>
            Save header
          </Button>
        )}
      </Card>

      {h.dataStatus && h.dataStatus !== 'final' && (
        <p className="flex items-center gap-1.5 rounded-md bg-warning-50 px-2 py-1.5 text-xs text-warning-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          Current-year figures are {DATASET_STATUS_LABEL[h.dataStatus].toLowerCase()} — unaudited.
        </p>
      )}

      {!ready ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
          Record the period end, currency and units before entering figures.
        </p>
      ) : (
        <Card className="p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="py-1 pr-2 font-medium">Metric ({FINANCIAL_UNIT_LABEL[h.units!]})</th>
                  <th className="py-1 pr-2 font-medium">Current year</th>
                  <th className="py-1 pr-2 font-medium">CY source</th>
                  <th className="py-1 pr-2 font-medium">Prior year</th>
                  <th className="py-1 pr-2 font-medium">PY source</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.key} className="border-t border-line">
                    <td className="py-1 pr-2">
                      <div className="text-ink">{m.label}</div>
                      <div className="text-[11px] text-ink-faint">{m.note}</div>
                    </td>
                    {(['cy', 'py'] as FinancialPeriod[]).map((p) => {
                      const key = `${m.key}:${p}`;
                      const c = cells[key]!;
                      const rf = valueOf(key)?.rolledForward;
                      return [
                        <td key={`${key}-a`} className="w-32 py-1 pr-2">
                          <Input
                            inputMode="decimal"
                            disabled={!editable}
                            aria-label={`${m.label} ${p.toUpperCase()}`}
                            value={c.amount}
                            onChange={(e) => set(key, { amount: e.target.value })}
                          />
                          {rf && (
                            <span
                              className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-faint"
                              title={
                                rf.approved
                                  ? `Rolled forward from the approved FY ${rf.fromFinancialYear ?? ''} audit file (${fmt(rf.amount)}). Changing it needs a reason.`
                                  : `Rolled forward from the FY ${rf.fromFinancialYear ?? ''} audit file (${fmt(rf.amount)}).`
                              }
                            >
                              <RotateCcw className="h-3 w-3" />
                              {rf.fromFinancialYear ? `FY ${rf.fromFinancialYear}` : 'Prior file'}
                              {rf.approved ? ' · approved' : ''}
                              {valueOf(key)?.overrideReason ? ' · overridden' : ''}
                            </span>
                          )}
                        </td>,
                        <td key={`${key}-s`} className="w-44 py-1 pr-2">
                          <Select
                            disabled={!editable || c.amount.trim() === ''}
                            value={c.source || (c.amount.trim() ? defaultSource(p) : '')}
                            onChange={(e) => set(key, { source: e.target.value as MetricSourceType })}
                          >
                            <option value="">—</option>
                            {METRIC_SOURCE_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {METRIC_SOURCE_TYPE_LABEL[t]}
                              </option>
                            ))}
                          </Select>
                        </td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && overridden.size > 0 && (
            <div className="mt-3 space-y-1 rounded-md bg-warning-50 p-2 text-xs text-warning-700">
              <p className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {overridden.size} figure(s) were rolled forward from last year’s approved audit file. Say why they
                change — the reason is kept with the figure.
              </p>
              <Input
                aria-label="Reason for changing rolled-forward figures"
                placeholder="e.g. Prior year restated — note 42 of FY25 financial statements"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            </div>
          )}
          {editable && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Button
                onClick={() => saveValues.mutate()}
                disabled={saveValues.isPending || dirty.length === 0 || invalid || (overridden.size > 0 && !overrideReason.trim())}
              >
                Save {dirty.length ? `${dirty.length} change(s)` : 'figures'}
              </Button>
              <div className="w-56">
                <Input placeholder="Custom metric, e.g. Order book" value={newMetric} onChange={(e) => setNewMetric(e.target.value)} />
              </div>
              <Button variant="ghost" onClick={() => addMetric.mutate()} disabled={addMetric.isPending || !newMetric.trim()}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add metric
              </Button>
            </div>
          )}
          {invalid && <p className="mt-1 text-xs text-danger-700">Amounts must be numbers.</p>}
        </Card>
      )}
    </div>
  );
}

// ── 03.2.8 Preliminary Analytical Review ────────────────────────────────────

const RULE_OUTCOME: Record<AnalyticsRuleOutcome, { label: string; tone: 'warn' | 'neutral' | 'info' }> = {
  flagged: { label: 'Flagged', tone: 'warn' },
  not_flagged: { label: 'Not flagged', tone: 'neutral' },
  not_applicable: { label: 'Not applicable', tone: 'neutral' },
  insufficient_data: { label: 'Insufficient data', tone: 'info' },
  data_quality: { label: 'Below data quality', tone: 'info' },
};

function AnalyticsSection({
  base,
  summary: s,
  editable,
  onChanged,
}: {
  base: string;
  summary: BusinessUnderstandingSummary;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const a = s.analytics;
  const m = s.analyticsMethodology;
  const unit = s.dataset.units ? FINANCIAL_UNIT_LABEL[s.dataset.units] : '';
  const [showRules, setShowRules] = useState(false);
  const rerun = useMutation({
    mutationFn: () =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/analytics/refresh`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast('Analytics re-run on the methodology now in force.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not refresh the analytics.')),
  });
  const attentionRules = a.rules.filter((r) => r.kind !== 'ratio');
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Preliminary planning analytics — not substantive evidence. Attention
          parameters only surface items to investigate; they are not materiality and never a
          conclusion. Methodology {m.methodologyVersion} · {m.profileLabel} profile v{m.profileVersion} (in
          force on {m.resolvedOn}) · Debt = {m.debtDefinition} · finance cost on{' '}
          {m.financeCostBasis === 'average' ? 'average' : 'closing'} debt ·{' '}
          {m.averageBalances ? 'day ratios on average balances where available' : 'day ratios on closing balances'}.
        </span>
      </p>
      {m.staleCards > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary-50 px-2 py-1.5 text-xs text-primary-700">
          <span>
            {m.staleCards} investigation card(s) were raised under an earlier methodology version.
          </span>
          {editable && (
            <Button size="sm" variant="ghost" disabled={rerun.isPending} onClick={() => rerun.mutate()}>
              Refresh analytics
            </Button>
          )}
        </div>
      )}
      {a.warnings.map((w) => (
        <p key={w.code} className="flex items-center gap-1.5 rounded-md bg-warning-50 px-2 py-1.5 text-xs text-warning-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          {w.message}
        </p>
      ))}
      <Card className="p-3">
        <div className="mb-2 text-sm font-medium text-ink">Movements ({unit})</div>
        {a.movements.length === 0 ? (
          <p className="text-sm text-ink-muted">No figures entered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="py-1 pr-2 font-medium">Metric</th>
                  <th className="py-1 pr-2 text-right font-medium">CY</th>
                  <th className="py-1 pr-2 text-right font-medium">PY</th>
                  <th className="py-1 pr-2 text-right font-medium">CY − PY</th>
                  <th className="py-1 pr-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {a.movements.map((m) => (
                  <tr key={m.metricKey} className="border-t border-line">
                    <td className="py-1 pr-2 text-ink">{m.label}</td>
                    <td className="py-1 pr-2 text-right">{fmt(m.cy)}</td>
                    <td className="py-1 pr-2 text-right">{fmt(m.py)}</td>
                    <td className="py-1 pr-2 text-right">{fmt(m.absolute)}</td>
                    <td className="py-1 pr-2 text-right" title={m.percentLabel === 'N/M' ? 'Not meaningful — prior year is zero' : undefined}>
                      {m.percentLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="p-3">
        <div className="mb-2 text-sm font-medium text-ink">Ratios & relationships</div>
        <div className="space-y-2">
          {a.ratios.map((r) => (
            <div key={r.key} className="border-t border-line pt-2 text-sm first:border-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ink">{r.label}</span>
                {r.status === 'calculated' ? (
                  <span className="font-mono text-xs text-ink">
                    CY {fmt(r.cy, 2)}
                    {r.unit === '%' ? '%' : r.unit === 'days' ? ' days' : r.unit === 'x' ? '×' : ''} · PY {fmt(r.py, 2)}
                    {r.unit === '%' ? '%' : r.unit === 'days' ? ' days' : r.unit === 'x' ? '×' : ''}
                  </span>
                ) : (
                  <Badge tone="neutral">
                    {r.status === 'not_applicable' ? 'Not applicable' : r.status === 'not_meaningful' ? 'Not meaningful' : 'Insufficient data'}
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-ink-faint">
                {r.formula}
                {r.reason ? ` — ${r.reason}` : ''}
                {r.basisNote ? ` · ${r.basisNote}` : ''}
                {r.ruleCode ? ` · ${r.ruleCode} v${r.ruleVersion}` : ''}
                {r.status === 'calculated' &&
                  ` · inputs: ${r.inputs.map((i) => `${i.label} ${fmt(i.cy)} / ${fmt(i.py)}`).join('; ')}`}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-3">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left text-sm font-medium text-ink"
          onClick={() => setShowRules((v) => !v)}
        >
          <span>
            Attention rules applied ({attentionRules.filter((r) => r.outcome === 'flagged').length} flagged of{' '}
            {attentionRules.length})
          </span>
          {showRules ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showRules && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink-muted">
                  <th className="py-1 pr-2 font-medium">Rule</th>
                  <th className="py-1 pr-2 font-medium">Type</th>
                  <th className="py-1 pr-2 font-medium">Attention parameter</th>
                  <th className="py-1 pr-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {attentionRules.map((r) => (
                  <tr key={r.ruleCode} className="border-t border-line align-top">
                    <td className="py-1 pr-2">
                      <div className="text-ink">{r.name}</div>
                      <div className="text-ink-faint">
                        {r.ruleCode} v{r.ruleVersion} · {r.formula}
                      </div>
                    </td>
                    <td className="py-1 pr-2 text-ink-muted">{ANALYTICS_RULE_KIND_LABEL[r.kind]}</td>
                    <td className="py-1 pr-2 text-ink-muted">{r.parameterText ?? '—'}</td>
                    <td className="py-1 pr-2">
                      <Badge tone={RULE_OUTCOME[r.outcome].tone}>{RULE_OUTCOME[r.outcome].label}</Badge>
                      {r.reason && <div className="mt-0.5 text-ink-faint">{r.reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── 03.2.9 Investigation Cards ──────────────────────────────────────────────

function InvestigationsSection({
  engagementId,
  base,
  qk,
  team,
  signals,
  evidenceCounts,
  facts,
  assess,
  canFocus,
  onChanged,
}: {
  engagementId: string;
  base: string;
  qk: string[];
  team: TeamMember[];
  signals: PlanningSignalRecord[];
  evidenceCounts: Record<string, number>;
  facts: boolean;
  assess: boolean;
  canFocus: boolean;
  onChanged: () => void;
}): JSX.Element {
  const cards = useQuery({
    queryKey: [...qk, 'exceptions'],
    queryFn: () => apiFetch<InvestigationCardRecord[]>(`${base}/analytics-exceptions`),
  });
  if (cards.isLoading) return <Spinner label="Loading investigations…" />;
  const list = cards.data ?? [];
  // §18 — Enhanced / Immediate-Partner findings with a signal should feed an Area of Focus.
  const unfocused = list.filter(
    (c) => c.signalId && c.suggestedAttention !== 'standard' && !c.noLongerFlagged && c.focusAreas.length === 0,
  );
  return (
    <div className="space-y-2">
      {unfocused.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-700">
          <Target className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {unfocused.map((c) => c.cardCode).join(', ')} {unfocused.length === 1 ? 'is' : 'are'} Enhanced / Immediate
            Partner attention with a Planning Signal but no Area of Focus. Consider grouping{' '}
            {unfocused.length === 1 ? 'it' : 'them'} so the risk flows into 03.5.
          </span>
        </div>
      )}
      {canFocus && <FocusLinker base={base} engagementId={engagementId} qk={qk} cards={list} onChanged={onChanged} />}
      <p className="text-xs text-ink-muted">
        Each flagged exception needs an auditor assessment. A management explanation on its own does
        not close it. Findings become Planning Signals in the 03.1 register — no separate risk register.
      </p>
      {list.length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
          No exceptions surfaced. Enter comparable figures in the financial dataset.
        </p>
      )}
      {list.map((c) => (
        <InvestigationCard
          key={`${c.id}-${c.version}`}
          engagementId={engagementId}
          card={c}
          team={team}
          signals={signals}
          evidenceCount={evidenceCounts[c.id] ?? 0}
          facts={facts}
          assess={assess}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

/** §18 — the Manager groups investigation findings into an Area of Focus (03.1 register). */
function FocusLinker({
  base,
  engagementId,
  qk,
  cards,
  onChanged,
}: {
  base: string;
  engagementId: string;
  qk: string[];
  cards: InvestigationCardRecord[];
  onChanged: () => void;
}): JSX.Element | null {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const focus = useQuery({
    queryKey: [...qk, 'focus-areas'],
    queryFn: () => apiFetch<AreaOfFocusRecord[]>(`${base}/areas-of-focus`),
    enabled: open,
  });
  const withSignal = cards.filter((c) => c.signalId && !c.noLongerFlagged);
  const signalIds = [...new Set(withSignal.filter((c) => picked.includes(c.id)).map((c) => c.signalId!))];
  const link = useMutation({
    mutationFn: () => {
      if (target) {
        const fa = (focus.data ?? []).find((f) => f.id === target)!;
        return apiFetch<AreaOfFocusRecord>(`/engagements/${engagementId}/statutory-audit/areas-of-focus/${target}`, {
          method: 'POST',
          body: { signalIds: [...new Set([...fa.signalIds, ...signalIds])] },
        });
      }
      return apiFetch<AreaOfFocusRecord>(`${base}/areas-of-focus`, { method: 'POST', body: { name, signalIds } });
    },
    onSuccess: (fa) => {
      toast(`${signalIds.length} signal(s) linked to ${fa.focusCode}.`);
      setPicked([]);
      setName('');
      setTarget('');
      setOpen(false);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not link to the Area of Focus.')),
  });
  if (withSignal.length === 0) return null;
  return (
    <Card className="p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-ink"
      >
        {open ? <ChevronDown className="h-4 w-4 text-ink-faint" /> : <ChevronRight className="h-4 w-4 text-ink-faint" />}
        <Target className="h-4 w-4 text-ink-faint" />
        Link findings to an Area of Focus
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
          <div className="space-y-1">
            {withSignal.map((c) => (
              <label key={c.id} className="flex items-start gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={picked.includes(c.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                />
                <span>
                  <span className="mr-1 font-mono text-ink-faint">{c.cardCode}</span>
                  {c.signalCode} — {c.observation}
                  {c.focusAreas.length > 0 && (
                    <span className="text-ink-faint"> · in {c.focusAreas.map((f) => f.code).join(', ')}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {focus.isLoading ? (
            <Spinner label="Loading Areas of Focus…" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Area of Focus">
                <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">+ New Area of Focus</option>
                  {(focus.data ?? [])
                    .filter((f) => f.status !== 'superseded')
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.focusCode} — {f.name}
                      </option>
                    ))}
                </Select>
              </Field>
              {!target && (
                <Field label="Name" required>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Revenue cut-off on project billing" />
                </Field>
              )}
            </div>
          )}
          <Button onClick={() => link.mutate()} disabled={link.isPending || signalIds.length === 0 || (!target && !name.trim())}>
            Link {signalIds.length || ''} signal(s)
          </Button>
        </div>
      )}
    </Card>
  );
}

function InvestigationCard({
  engagementId,
  card: c,
  team,
  signals,
  evidenceCount,
  facts,
  assess,
  onChanged,
}: {
  engagementId: string;
  card: InvestigationCardRecord;
  team: TeamMember[];
  signals: PlanningSignalRecord[];
  evidenceCount: number;
  /** Explanation, corroboration and affected areas (Article / Senior up). */
  facts: boolean;
  /** Assessment, signal decision, owner and due date (Engagement Manager). */
  assess: boolean;
  onChanged: () => void;
}): JSX.Element {
  const editable = facts || assess;
  const toast = useToast();
  const [open, setOpen] = useState(c.needsReassessment);
  const [explanation, setExplanation] = useState(c.managementExplanation ?? '');
  const [by, setBy] = useState(c.explanationBy ?? '');
  const [date, setDate] = useState(c.explanationDate ?? '');
  const [evidence, setEvidence] = useState(c.evidence ?? '');
  const [assessment, setAssessment] = useState<InvestigationAssessment | ''>(c.assessment ?? '');
  const [areas, setAreas] = useState(c.affectedAreas.join(', '));
  const [decision, setDecision] = useState<InvestigationSignalDecision | ''>(c.signalDecision ?? '');
  const [linkId, setLinkId] = useState('');
  const [rationale, setRationale] = useState(c.noSignalRationale ?? '');
  const [owner, setOwner] = useState(c.ownerEmployeeId ?? '');
  const [due, setDue] = useState(c.dueDate ?? '');

  const elevated = c.suggestedAttention !== 'standard';
  const blocked =
    assess &&
    ((assessment === 'further_information_required' && !owner) ||
      (decision === 'none' && elevated && !rationale.trim()) ||
      (decision === 'link' && !linkId && !c.signalId));

  const save = useMutation({
    mutationFn: () =>
      apiFetch<InvestigationCardRecord>(`/engagements/${engagementId}/statutory-audit/analytics-exceptions/${c.id}`, {
        method: 'POST',
        // The team records facts only; the Manager's fields are sent only by the Manager (§23).
        body: {
          managementExplanation: explanation || undefined,
          explanationBy: by || undefined,
          explanationDate: date || undefined,
          evidence: evidence || undefined,
          affectedAreas: areas.split(',').map((x) => x.trim()).filter(Boolean),
          ...(assess
            ? {
                assessment: assessment || undefined,
                signalDecision: decision || undefined,
                linkSignalId: decision === 'link' && linkId ? linkId : undefined,
                noSignalRationale: decision === 'none' ? rationale || undefined : undefined,
                ownerEmployeeId: owner || undefined,
                dueDate: due || undefined,
              }
            : {}),
          version: c.version,
        },
      }),
    onSuccess: (r) => {
      toast(r.signalCode && !c.signalCode ? `${c.cardCode} saved — ${r.signalCode} raised.` : `${c.cardCode} saved.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save the investigation.')),
  });

  return (
    <Card className={c.noLongerFlagged ? 'p-3 opacity-70' : 'p-3'}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start justify-between gap-3 text-left">
        <span className="flex min-w-0 items-start gap-2">
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />}
          <span className="min-w-0">
            <span className="mr-2 font-mono text-xs text-ink-faint">{c.cardCode}</span>
            <span className="text-sm text-ink">{c.observation}</span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              {c.assessment ? <Badge tone="info">{INVESTIGATION_ASSESSMENT_LABEL[c.assessment]}</Badge> : <Badge tone="warn">Not assessed</Badge>}
              {c.needsReassessment && <Badge tone="danger">Figures changed — reassess</Badge>}
              {c.noLongerFlagged && <Badge>No longer flagged</Badge>}
              {c.signalCode && <Badge>{c.signalCode}</Badge>}
              {c.focusAreas.map((f) => (
                <span key={f.id} title={f.name}>
                  <Badge tone="info">{f.code}</Badge>
                </span>
              ))}
              {c.ownerName && <Badge>Owner: {c.ownerName}</Badge>}
            </span>
          </span>
        </span>
        <Badge tone={c.suggestedAttention === 'standard' ? 'neutral' : c.suggestedAttention === 'enhanced' ? 'warn' : 'danger'} className="shrink-0">
          {PLANNING_ATTENTION_LABEL[c.suggestedAttention]}
        </Badge>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
          <p className="text-xs text-ink-muted">Why flagged: {c.whyFlagged}</p>
          {c.whyMayMatter && <p className="text-xs text-ink-muted">Why it may matter: {c.whyMayMatter}</p>}
          {c.ruleCode && (
            <p className="text-[11px] text-ink-faint">
              Rule {c.ruleCode} v{c.ruleVersion} · {c.methodologyVersion}
            </p>
          )}
          <PlanningEvidence targetType="analytics_exception" targetId={c.id} count={evidenceCount} />
          {editable ? (
            <div className="space-y-3 rounded-lg bg-surface-raised p-3">
              <Field label="Management explanation">
                <Textarea rows={2} disabled={!facts} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Provided by">
                  <Input disabled={!facts} value={by} onChange={(e) => setBy(e.target.value)} />
                </Field>
                <Field label="Date">
                  <Input type="date" disabled={!facts} value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Evidence / corroboration" hint="Link or reference; optional until obtained.">
                  <Input disabled={!facts} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Auditor assessment" hint={assess ? undefined : 'The Engagement Manager assesses.'}>
                  <Select disabled={!assess} value={assessment} onChange={(e) => setAssessment(e.target.value as InvestigationAssessment)}>
                    <option value="">— Not yet assessed —</option>
                    {INVESTIGATION_ASSESSMENTS.map((x) => (
                      <option key={x} value={x}>
                        {INVESTIGATION_ASSESSMENT_LABEL[x]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Potentially affected FS areas" hint="Suggested — edit as needed. Final areas are 03.5.">
                  <Input disabled={!facts} value={areas} onChange={(e) => setAreas(e.target.value)} />
                </Field>
              </div>
              {assess && (
              <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Owner" required={assessment === 'further_information_required'}>
                  <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">— Select —</option>
                    {team.map((m) => (
                      <option key={m.employeeId} value={m.employeeId}>
                        {m.employeeName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due">
                  <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                </Field>
              </div>
              <div>
                <div className="mb-1 text-sm font-medium text-ink">Planning Signal</div>
                <div className="flex flex-wrap gap-3 text-xs text-ink">
                  {(
                    [
                      ['create', c.signalCode && c.signalDecision === 'create' ? `Raised (${c.signalCode})` : 'Create signal'],
                      ['link', 'Link existing signal'],
                      ['none', 'No signal'],
                    ] as [InvestigationSignalDecision, string][]
                  ).map(([k, label]) => (
                    <label key={k} className="inline-flex items-center gap-1.5">
                      <input type="radio" name={`dec-${c.id}`} checked={decision === k} onChange={() => setDecision(k)} />
                      {label}
                    </label>
                  ))}
                </div>
                {decision === 'link' && (
                  <div className="mt-2">
                    <Select value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                      <option value="">{c.signalCode ? `Keep ${c.signalCode}` : '— Select a signal —'}</option>
                      {signals.map((sg) => (
                        <option key={sg.id} value={sg.id}>
                          {sg.signalCode} — {sg.observation.slice(0, 80)}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                {decision === 'none' && (
                  <div className="mt-2">
                    <Input
                      placeholder={elevated ? 'Rationale (required for Enhanced / Immediate Partner)' : 'Rationale'}
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                    />
                  </div>
                )}
              </div>
              </>
              )}
              <Button onClick={() => save.mutate()} disabled={save.isPending || blocked}>
                Save investigation
              </Button>
            </div>
          ) : (
            <div className="space-y-1 text-xs text-ink-muted">
              {c.managementExplanation && (
                <p>
                  Management ({c.explanationBy ?? '—'}, {c.explanationDate ?? '—'}): {c.managementExplanation}
                </p>
              )}
              {c.evidence && <p>Corroboration: {c.evidence}</p>}
              {c.noSignalRationale && <p>No signal because: {c.noSignalRationale}</p>}
              {c.dueDate && <p>Due {c.dueDate}</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── §14 Expectation vs Actual ───────────────────────────────────────────────

function ExpectationsSection({
  engagementId,
  base,
  qk,
  summary: s,
  facts,
  assess,
  onChanged,
}: {
  engagementId: string;
  base: string;
  qk: string[];
  summary: BusinessUnderstandingSummary;
  /** Record an expectation (Article / Senior up). */
  facts: boolean;
  /** Conclude on it (Engagement Manager). */
  assess: boolean;
  onChanged: () => void;
}): JSX.Element {
  const editable = facts;
  const toast = useToast();
  const list = useQuery({
    queryKey: [...qk, 'expectations'],
    queryFn: () => apiFetch<PlanningExpectationRecord[]>(`${base}/planning-expectations`),
  });
  const [metric, setMetric] = useState('');
  const [type, setType] = useState<ExpectationType>('amount');
  const [amount, setAmount] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [direction, setDirection] = useState<ExpectationDirection | ''>('');
  const [tolerance, setTolerance] = useState('');
  const [basis, setBasis] = useState<ExpectationBasis | ''>('');
  const [basisNote, setBasisNote] = useState('');

  const metrics = [
    ...s.analyticsMethodology.metrics.map((d) => ({ key: d.key, label: d.label })),
    ...s.customMetrics.map((c) => ({ key: c.key, label: c.label })),
  ];
  const create = useMutation({
    mutationFn: () =>
      apiFetch<PlanningExpectationRecord>(`${base}/planning-expectations`, {
        method: 'POST',
        body: {
          metricKey: metric,
          expectationType: type,
          expectedAmount: type === 'amount' ? Number(amount) : undefined,
          expectedLow: type === 'range' ? Number(low) : undefined,
          expectedHigh: type === 'range' ? Number(high) : undefined,
          expectedDirection: type === 'direction' ? direction : undefined,
          tolerancePct: tolerance ? Number(tolerance) : undefined,
          basis,
          basisNote: basisNote || undefined,
        },
      }),
    onSuccess: () => {
      toast('Expectation recorded.');
      setMetric('');
      setAmount('');
      setLow('');
      setHigh('');
      setDirection('');
      setTolerance('');
      setBasis('');
      setBasisNote('');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not record the expectation.')),
  });
  const shapeOk =
    (type === 'amount' && amount.trim() !== '' && !Number.isNaN(Number(amount))) ||
    (type === 'range' && low.trim() !== '' && high.trim() !== '' && Number(low) <= Number(high)) ||
    (type === 'direction' && !!direction);

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Optional planning expectations from budget, prior trend or operational drivers. If later used
        as a substantive analytical procedure, the audit-programme workpaper must separately meet the
        standard on substantive analytical procedures (see Framework references).
      </p>
      {(list.data ?? []).map((e) => (
        <ExpectationCard
          key={`${e.id}-${e.version}`}
          engagementId={engagementId}
          expectation={e}
          evidenceCount={s.evidenceCounts[e.id] ?? 0}
          editable={assess}
          onChanged={onChanged}
        />
      ))}
      {editable && (
        <Card className="space-y-3 p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Metric" required>
              <Select value={metric} onChange={(e) => setMetric(e.target.value)}>
                <option value="">— Select —</option>
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expectation" required>
              <Select value={type} onChange={(e) => setType(e.target.value as ExpectationType)}>
                <option value="amount">Amount</option>
                <option value="range">Range</option>
                <option value="direction">Direction</option>
              </Select>
            </Field>
            {type === 'amount' && (
              <Field label="Expected amount" required>
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            )}
            {type === 'range' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Low" required>
                  <Input inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
                </Field>
                <Field label="High" required>
                  <Input inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
                </Field>
              </div>
            )}
            {type === 'direction' && (
              <Field label="Direction" required>
                <Select value={direction} onChange={(e) => setDirection(e.target.value as ExpectationDirection)}>
                  <option value="">— Select —</option>
                  <option value="increase">Increase</option>
                  <option value="decrease">Decrease</option>
                  <option value="stable">Stable</option>
                </Select>
              </Field>
            )}
            <Field label="Basis" required>
              <Select value={basis} onChange={(e) => setBasis(e.target.value as ExpectationBasis)}>
                <option value="">— Select —</option>
                {EXPECTATION_BASES.map((b) => (
                  <option key={b} value={b}>
                    {EXPECTATION_BASIS_LABEL[b]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tolerance %" hint="Only used to suggest investigation.">
              <Input inputMode="decimal" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
            </Field>
            <Field label="Basis note">
              <Input value={basisNote} onChange={(e) => setBasisNote(e.target.value)} />
            </Field>
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !metric || !basis || !shapeOk}>
            Record expectation
          </Button>
        </Card>
      )}
    </div>
  );
}

function ExpectationCard({
  engagementId,
  expectation: e,
  evidenceCount,
  editable,
  onChanged,
}: {
  engagementId: string;
  expectation: PlanningExpectationRecord;
  evidenceCount: number;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [requires, setRequires] = useState<boolean | null>(e.requiresInvestigation ?? e.suggestedInvestigation);
  const [conclusion, setConclusion] = useState<ExpectationConclusion | ''>(e.conclusion ?? '');
  const save = useMutation({
    mutationFn: () =>
      apiFetch<PlanningExpectationRecord>(`/engagements/${engagementId}/statutory-audit/planning-expectations/${e.id}`, {
        method: 'POST',
        body: { requiresInvestigation: requires ?? undefined, conclusion: conclusion || undefined, version: e.version },
      }),
    onSuccess: (r) => {
      toast(r.signalCode && !e.signalCode ? `Saved — ${r.signalCode} raised.` : 'Expectation saved.');
      onChanged();
    },
    onError: (err) => toast(errMsg(err, 'Could not save.')),
  });
  const expected =
    e.expectationType === 'amount'
      ? fmt(e.expectedAmount)
      : e.expectationType === 'range'
        ? `${fmt(e.expectedLow)} – ${fmt(e.expectedHigh)}`
        : e.expectedDirection;
  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-ink">{e.metricLabel}</div>
          <p className="text-xs text-ink-faint">
            Expected {expected} ({EXPECTATION_BASIS_LABEL[e.basis]}
            {e.basisNote ? `: ${e.basisNote}` : ''}) · Actual {fmt(e.actual)} · Variance {fmt(e.variance)}
          </p>
        </div>
        <div className="flex gap-1.5">
          {e.suggestedInvestigation && <Badge tone="warn">Investigation suggested</Badge>}
          {e.conclusion && <Badge tone="info">{EXPECTATION_CONCLUSION_LABEL[e.conclusion]}</Badge>}
          {e.signalCode && <Badge>{e.signalCode}</Badge>}
        </div>
      </div>
      <PlanningEvidence targetType="planning_expectation" targetId={e.id} count={evidenceCount} />
      {editable && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-raised p-2 text-xs text-ink">
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={!!requires} onChange={(ev) => setRequires(ev.target.checked)} />
            Requires investigation
          </label>
          {EXPECTATION_CONCLUSIONS.map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5">
              <input type="radio" name={`exp-${e.id}`} checked={conclusion === k} onChange={() => setConclusion(k)} />
              {EXPECTATION_CONCLUSION_LABEL[k]}
            </label>
          ))}
          <Button variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── 03.2.10 Conclusion + BA-01 ──────────────────────────────────────────────

function ConclusionSection({
  base,
  summary: s,
  editable,
  onChanged,
}: {
  base: string;
  summary: BusinessUnderstandingSummary;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [text, setText] = useState(s.record.conclusionSummary ?? '');
  const draft = useMutation({
    mutationFn: () => apiFetch<{ draft: string }>(`${base}/business-understanding/conclusion-draft`, { method: 'POST', body: {} }),
    onSuccess: (d) => {
      setText(d.draft);
      toast('Conclusion drafted from the structured record — review and edit before saving.');
    },
    onError: (e) => toast(errMsg(e, 'Could not draft the conclusion.')),
  });
  const save = useMutation({
    mutationFn: (ba01?: 'yes_complete' | 'no_further_work') =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/business-understanding`, {
        method: 'POST',
        body: { conclusionSummary: text, ba01, version: s.record.version },
      }),
    onSuccess: (_r, ba01) => {
      toast(ba01 === 'yes_complete' ? '03.2 completed.' : ba01 ? 'Recorded — further work required.' : 'Conclusion saved.');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save.')),
  });

  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-ink">Understanding & analytics conclusion</div>
          {editable && (
            <Button variant="ghost" onClick={() => draft.mutate()} disabled={draft.isPending}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              Draft from structured data
            </Button>
          )}
        </div>
        <Textarea rows={12} disabled={!editable} value={text} onChange={(e) => setText(e.target.value)} />
      </Card>
      <CompletionChecklist checks={s.completion} />
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">BA-01</div>
        <p className="text-sm text-ink-muted">
          Does the documented understanding and preliminary analytical review appropriately identify
          the significant business, financial and operating matters that should be considered in
          further audit planning?
        </p>
        {s.record.ba01 && (
          <Badge tone={s.record.ba01 === 'yes_complete' ? 'success' : 'warn'}>
            {s.record.ba01 === 'yes_complete' ? 'Yes — Complete' : 'No — Further work required'}
          </Badge>
        )}
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
              Save conclusion
            </Button>
            <Button variant="ghost" onClick={() => save.mutate('no_further_work')} disabled={save.isPending}>
              No — further work required
            </Button>
            <Button onClick={() => save.mutate('yes_complete')} disabled={save.isPending || s.record.status === 'complete'}>
              Yes — Complete 03.2
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── §23 Engagement Partner review + §20 revision history ────────────────────

function ReviewSection({
  engagementId,
  base,
  qk,
  summary: s,
  mayChallenge,
  mayRespond,
  onChanged,
}: {
  engagementId: string;
  base: string;
  qk: string[];
  summary: BusinessUnderstandingSummary;
  mayChallenge: boolean;
  mayRespond: boolean;
  onChanged: () => void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <MessageSquare className="h-4 w-4 text-ink-faint" /> Engagement Partner comments &amp; challenges
        </h4>
        <p className="text-xs text-ink-muted">
          The Engagement Partner reviews 03.2 and may comment on or challenge any part of it. An open challenge
          stops 03.2 being completed until the Manager responds and the Partner closes it.
        </p>
        {s.challenges.length === 0 && (
          <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-sm text-ink-muted">
            No Partner comments yet.
          </p>
        )}
        {s.challenges.map((c) => (
          <ChallengeCard
            key={`${c.id}-${c.version}`}
            engagementId={engagementId}
            challenge={c}
            mayClose={mayChallenge}
            mayRespond={mayRespond}
            onChanged={onChanged}
          />
        ))}
        {mayChallenge && <RaiseChallengeForm base={base} qk={qk} onChanged={onChanged} />}
      </div>
      <div className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <History className="h-4 w-4 text-ink-faint" /> Version history
        </h4>
        <p className="text-xs text-ink-muted">
          Current version {s.versionInfo.versionLabel}. Each reopening freezes the completed version as a baseline —
          expand a revision to see what changed.
        </p>
        {s.revisions.length === 0 && (
          <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-sm text-ink-muted">
            No revisions — 03.2 has not been reopened.
          </p>
        )}
        {s.revisions.map((r) => (
          <RevisionRow key={r.id} base={base} qk={qk} revision={r} />
        ))}
      </div>
    </div>
  );
}

function RaiseChallengeForm({
  base,
  qk,
  onChanged,
}: {
  base: string;
  qk: string[];
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [targetType, setTargetType] = useState<UnderstandingChallengeTarget>('section');
  const [targetRef, setTargetRef] = useState('');
  const [kind, setKind] = useState<'comment' | 'challenge'>('challenge');
  const [body, setBody] = useState('');
  const cards = useQuery({
    queryKey: [...qk, 'exceptions'],
    queryFn: () => apiFetch<InvestigationCardRecord[]>(`${base}/analytics-exceptions`),
    enabled: targetType === 'exception',
  });
  const expectations = useQuery({
    queryKey: [...qk, 'expectations'],
    queryFn: () => apiFetch<PlanningExpectationRecord[]>(`${base}/planning-expectations`),
    enabled: targetType === 'expectation',
  });
  const refs: Array<{ value: string; label: string }> =
    targetType === 'section'
      ? UNDERSTANDING_SECTION_DEFS.map((d) => ({ value: d.key, label: `${d.code} ${d.title}` }))
      : targetType === 'exception'
        ? (cards.data ?? []).map((c) => ({ value: c.id, label: `${c.cardCode} — ${c.observation.slice(0, 70)}` }))
        : targetType === 'expectation'
          ? (expectations.data ?? []).map((e) => ({ value: e.id, label: e.metricLabel }))
          : [];
  const raise = useMutation({
    mutationFn: () =>
      apiFetch<BusinessUnderstandingSummary>(`${base}/business-understanding/challenges`, {
        method: 'POST',
        body: { targetType, targetRef: targetRef || null, kind, body },
      }),
    onSuccess: (r) => {
      toast(`${r.challenges[0]?.code ?? 'Comment'} raised — the Engagement Manager has been notified.`);
      setBody('');
      setTargetRef('');
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not raise the comment.')),
  });
  return (
    <Card className="space-y-3 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="About">
          <Select
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value as UnderstandingChallengeTarget);
              setTargetRef('');
            }}
          >
            {UNDERSTANDING_CHALLENGE_TARGETS.map((t) => (
              <option key={t} value={t}>
                {CHALLENGE_TARGET_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        {refs.length > 0 && (
          <Field label="Which one">
            <Select value={targetRef} onChange={(e) => setTargetRef(e.target.value)}>
              <option value="">— The whole area —</option>
              {refs.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'comment' | 'challenge')}>
            <option value="challenge">Challenge — needs a response</option>
            <option value="comment">Comment</option>
          </Select>
        </Field>
      </div>
      <Field label="Comment" required>
        <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Button onClick={() => raise.mutate()} disabled={raise.isPending || !body.trim()}>
        Raise {kind}
      </Button>
    </Card>
  );
}

function ChallengeCard({
  engagementId,
  challenge: c,
  mayClose,
  mayRespond,
  onChanged,
}: {
  engagementId: string;
  challenge: UnderstandingChallengeRecord;
  mayClose: boolean;
  mayRespond: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [response, setResponse] = useState(c.response ?? '');
  const url = `/engagements/${engagementId}/statutory-audit/understanding-challenges/${c.id}`;
  const respond = useMutation({
    mutationFn: () =>
      apiFetch<BusinessUnderstandingSummary>(`${url}/respond`, { method: 'POST', body: { response, version: c.version } }),
    onSuccess: () => {
      toast(`Response to ${c.code} recorded.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not record the response.')),
  });
  const close = useMutation({
    mutationFn: () => apiFetch<BusinessUnderstandingSummary>(`${url}/close`, { method: 'POST', body: { version: c.version } }),
    onSuccess: () => {
      toast(`${c.code} closed.`);
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not close it.')),
  });
  const tone = c.status === 'closed' ? 'neutral' : c.status === 'responded' ? 'info' : 'warn';
  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-2 font-mono text-xs text-ink-faint">{c.code}</span>
          <span className="text-xs text-ink-muted">{c.targetLabel}</span>
          <p className="mt-1 whitespace-pre-wrap text-ink">{c.body}</p>
          <p className="text-[11px] text-ink-faint">
            {c.raisedByName ?? '—'}, {new Date(c.raisedAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Badge tone={c.kind === 'challenge' ? 'warn' : 'neutral'}>{c.kind === 'challenge' ? 'Challenge' : 'Comment'}</Badge>
          <Badge tone={tone}>{c.status === 'open' ? 'Open' : c.status === 'responded' ? 'Responded' : 'Closed'}</Badge>
        </div>
      </div>
      {c.response && (
        <div className="rounded-md bg-surface-raised p-2 text-xs text-ink">
          <span className="font-medium">Response</span> ({c.respondedByName ?? '—'}
          {c.respondedAt ? `, ${new Date(c.respondedAt).toLocaleDateString()}` : ''}): {c.response}
        </div>
      )}
      {c.status !== 'closed' && (mayRespond || mayClose) && (
        <div className="space-y-2">
          {mayRespond && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <Textarea
                  rows={2}
                  aria-label={`Response to ${c.code}`}
                  placeholder="Manager's response"
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                />
              </div>
              <Button variant="secondary" onClick={() => respond.mutate()} disabled={respond.isPending || !response.trim() || response === c.response}>
                {c.response ? 'Update response' : 'Respond'}
              </Button>
            </div>
          )}
          {mayClose && (
            <Button
              variant="ghost"
              onClick={() => close.mutate()}
              disabled={close.isPending || (c.kind === 'challenge' && !c.response)}
              title={c.kind === 'challenge' && !c.response ? 'A challenge is closed once the Manager has responded.' : undefined}
            >
              Close {c.kind}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function RevisionRow({
  base,
  qk,
  revision: r,
}: {
  base: string;
  qk: string[];
  revision: UnderstandingRevisionRecord;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: [...qk, 'revision', r.id, r.status],
    queryFn: () => apiFetch<UnderstandingRevisionDetail>(`${base}/business-understanding/revisions/${r.id}`),
    enabled: open,
  });
  return (
    <Card className="p-3 text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-start gap-2">
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />}
          <span className="min-w-0">
            <span className="font-medium text-ink">
              {r.fromLabel} → {r.toLabel}
            </span>
            <span className="block text-xs text-ink-muted">{r.reason}</span>
            <span className="block text-[11px] text-ink-faint">
              Reopened by {r.openedByName ?? 'the system'} on {new Date(r.openedAt).toLocaleDateString()}
              {r.completedAt ? ` · completed by ${r.completedByName ?? '—'} on ${new Date(r.completedAt).toLocaleDateString()}` : ''}
            </span>
          </span>
        </span>
        <Badge tone={r.status === 'open' ? 'warn' : 'success'}>{r.status === 'open' ? 'In revision' : 'Completed'}</Badge>
      </button>
      {open && (
        <div className="mt-3 border-t border-line pt-3">
          {detail.isLoading ? (
            <Spinner label="Comparing versions…" />
          ) : !detail.data || detail.data.changes.length === 0 ? (
            <p className="text-xs text-ink-muted">No differences from {r.fromLabel}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-faint">
                    <th className="py-1 pr-2 font-medium">What</th>
                    <th className="py-1 pr-2 font-medium">{r.fromLabel}</th>
                    <th className="py-1 font-medium">{r.status === 'open' ? 'Now' : r.toLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.changes.map((ch, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="py-1 pr-2 text-ink">{ch.label}</td>
                      <td className="py-1 pr-2 text-ink-muted">{ch.before ?? '—'}</td>
                      <td className="py-1 text-ink">{ch.after ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
