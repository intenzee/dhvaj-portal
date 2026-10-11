'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, CheckCheck, Trash2, Plus } from 'lucide-react';
import {
  PERMISSION,
  type FrameworkAssessment,
  type FrameworkConclusion,
  type FrameworkState,
  type StatutoryAuditFramework,
  type StatutoryAuditFrameworkSummary,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Button, Spinner } from '@/components/ui';
import { Textarea } from '@/components/form';
import { ExpandToggle, InlinePanel } from '@/components/inline-panel';
import { EntityProfileCard } from './entity-profile-card';
import { FixLink } from './master-fact-list';
import { GroupCaroCard } from './group-caro-card';
import { ReportingFactsCard } from './reporting-facts-card';
import { ReportingFrameworkCard } from './reporting-framework-card';
import { MattersCard } from './matters-card';
import { FrameworkSummaryWorkspace } from './framework-summary-workspace';
import { FRAMEWORK_SUMMARY_QK } from './framework-summary-types';

/**
 * Framework (Phase 02) screen (Audit Spec §18–§20): the applicability/assessment
 * layer. Each area shows the advisory system suggestion and the professional
 * conclusion (Facts → System Assessment → Evidence → Decision → Basis → Impact).
 * Section 02 is approved once, in 02.8 (AF-01 → memorandum → AF-02), which
 * freezes the conclusions and completes Phase 02.
 */

const STATE_TONE: Record<FrameworkState, string> = {
  not_assessed: 'neutral',
  pending_information: 'warn',
  system_suggested_applicable: 'info',
  system_suggested_not_applicable: 'info',
  professional_judgement_required: 'warn',
  applicable: 'success',
  not_applicable: 'neutral',
  overridden: 'warn',
  reassessment_required: 'danger',
  approved: 'success',
};

const STATE_LABEL: Record<FrameworkState, string> = {
  not_assessed: 'Not assessed',
  pending_information: 'Pending information',
  system_suggested_applicable: 'Suggested: applicable',
  system_suggested_not_applicable: 'Suggested: not applicable',
  professional_judgement_required: 'Professional judgement',
  applicable: 'Applicable',
  not_applicable: 'Not applicable',
  overridden: 'Overridden',
  reassessment_required: 'Reassessment required',
  approved: 'Approved',
};

const FRAMEWORK_QK = (id: string) => ['engagement', id, 'statutory-audit-framework'];

export function FrameworkPanel({ engagementId }: { engagementId: string }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const query = useQuery({
    queryKey: FRAMEWORK_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditFramework[]>(`/engagements/${engagementId}/statutory-audit/framework`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: FRAMEWORK_QK(engagementId) });
    // The phase skeleton changes when the framework is approved.
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'statutory-audit'] });
  };

  const runSuggestions = useMutation({
    mutationFn: (workflowInstanceId: string) =>
      apiFetch<StatutoryAuditFramework>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/framework/run-suggestions`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      toast('System assessment updated the undecided areas.');
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not run suggestions.'),
  });

  const acceptAll = useMutation({
    mutationFn: (workflowInstanceId: string) =>
      apiFetch<StatutoryAuditFramework>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/framework/accept-suggestions`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      toast('System suggestions accepted as the conclusions.');
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not accept the suggestions.'),
  });

  // 02.8 owns the single Section 02 approval; the area cards freeze with it.
  const summaryQuery = useQuery({
    queryKey: FRAMEWORK_SUMMARY_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditFrameworkSummary[]>(
        `/engagements/${engagementId}/statutory-audit/framework-summary`,
      ),
  });

  if (query.isLoading) return <Spinner label="Loading framework…" />;
  const framework = query.data?.[0];
  if (!framework) return null;

  const summary = summaryQuery.data?.find(
    (x) => x.workflowInstanceId === framework.workflowInstanceId,
  );
  // Frozen while the 02.8 baseline is approved (a pre-02.8 file: its legacy approval).
  const approved = summary
    ? summary.baseline?.status === 'approved' ||
      (summary.baseline == null && framework.approval != null)
    : framework.approval != null;
  const waiting = framework.assessments.filter(
    (a) =>
      a.systemSuggestion != null &&
      (a.state === 'system_suggested_applicable' || a.state === 'system_suggested_not_applicable'),
  ).length;

  return (
    <div className="space-y-3">
      {/* Anchors for the 02.1 workspace's Section 02 navigation (SECTION_ANCHOR). */}
      <div id="framework-02-1" className="scroll-mt-2">
        <EntityProfileCard engagementId={engagementId} />
      </div>
      <div id="framework-02-2" className="scroll-mt-2">
        <ReportingFrameworkCard engagementId={engagementId} />
      </div>
      <div id="framework-02-4" className="scroll-mt-2">
        <GroupCaroCard engagementId={engagementId} />
      </div>
      <div id="framework-02-5" className="scroll-mt-2">
        <ReportingFactsCard engagementId={engagementId} />
      </div>
      <Card
        id="framework-02-areas"
        className="flex scroll-mt-2 flex-wrap items-center justify-between gap-3 p-4"
      >
        <div>
          <h2 className="text-sm font-semibold text-ink">Other framework areas · Phase 02</h2>
          <p className="text-xs text-ink-muted">
            {approved
              ? 'Frozen with the approved Audit Framework Baseline (02.8).'
              : framework.undecidedCount > 0
                ? `${framework.undecidedCount} area(s) still need a professional conclusion.`
                : 'Every area carries a conclusion — approve the framework in 02.8 below.'}
          </p>
        </div>
        {canManage && !approved && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => runSuggestions.mutate(framework.workflowInstanceId)}
              disabled={runSuggestions.isPending}
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              Run system assessment
            </Button>
            {waiting > 0 && (
              <Button
                variant="secondary"
                onClick={() => acceptAll.mutate(framework.workflowInstanceId)}
                disabled={acceptAll.isPending}
                title="Record each waiting system suggestion as the conclusion"
              >
                <CheckCheck className="mr-1.5 h-4 w-4" />
                Accept {waiting} suggestion{waiting === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        )}
      </Card>

      <MattersCard
        engagementId={engagementId}
        workflowInstanceId={framework.workflowInstanceId}
        section="framework"
        canManage={canManage && !approved}
      />

      <div className="space-y-3">
        {framework.assessments.map((a) => (
          <FrameworkAreaCard
            key={a.id}
            engagementId={engagementId}
            assessment={a}
            canManage={canManage && !approved}
            onChanged={invalidate}
          />
        ))}
      </div>

      <div id="framework-02-8" className="scroll-mt-2">
        <FrameworkSummaryWorkspace engagementId={engagementId} />
      </div>
    </div>
  );
}

function FrameworkAreaCard({
  engagementId,
  assessment,
  canManage,
  onChanged,
}: {
  engagementId: string;
  assessment: FrameworkAssessment;
  canManage: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [basis, setBasis] = useState(assessment.basis ?? '');
  const [impact, setImpact] = useState(assessment.impact ?? '');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const decide = useMutation({
    mutationFn: (conclusion: FrameworkConclusion) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/framework/${assessment.id}/decision`, {
        method: 'POST',
        body: {
          conclusion,
          basis: basis || undefined,
          impact: impact || undefined,
          version: assessment.version,
        },
      }),
    onSuccess: () => {
      toast(`${assessment.title}: conclusion recorded.`);
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not record the conclusion.'),
  });

  const addEvidence = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/framework/${assessment.id}/evidence`, {
        method: 'POST',
        body: { note },
      }),
    onSuccess: () => {
      setNote('');
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not add evidence.'),
  });

  const removeEvidence = useMutation({
    mutationFn: (evidenceId: string) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/framework/evidence/${evidenceId}`, {
        method: 'DELETE',
      }),
    onSuccess: onChanged,
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not remove evidence.'),
  });

  return (
    <Card className="p-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2.5">
          <ExpandToggle open={open} />
          <span className="font-mono text-xs text-ink-faint">
            {String(assessment.sortOrder).padStart(2, '0')}
          </span>
          <span className="text-sm font-medium text-ink">{assessment.title}</span>
        </span>
        <Badge tone={STATE_TONE[assessment.state]}>{STATE_LABEL[assessment.state]}</Badge>
      </button>
      {assessment.fix && (
        <p className="mt-1.5 pl-9 text-xs text-warning-700">
          {assessment.systemBasis ?? 'Information missing on the client master.'}{' '}
          <FixLink fix={assessment.fix} missing />
        </p>
      )}

      {/* The area's work (conclusion + evidence) opens in a pop-up. */}
      <InlinePanel
        open={open}
        onClose={() => setOpen(false)}
        title={assessment.title}
        description={`Framework · ${STATE_LABEL[assessment.state]}`}
        size="lg"
      >
        <div className="space-y-3">
          {/* System assessment (advisory) */}
          {assessment.systemBasis && (
            <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
              <span className="font-semibold text-ink">System:</span>{' '}
              {assessment.systemSuggestion
                ? assessment.systemSuggestion === 'applicable'
                  ? 'Applicable'
                  : 'Not applicable'
                : 'Judgement required'}{' '}
              — {assessment.systemBasis}
            </p>
          )}

          {/* Current conclusion */}
          {assessment.conclusion && (
            <p className="text-xs text-ink-muted">
              Conclusion:{' '}
              <span className="font-medium text-ink">
                {assessment.conclusion === 'applicable' ? 'Applicable' : 'Not applicable'}
              </span>
              {assessment.isOverridden && (
                <span className="ml-1 text-warning-700">(overridden)</span>
              )}
              {assessment.decidedByName && ` · ${assessment.decidedByName}`}
            </p>
          )}

          {/* CARO is concluded in 02.4 (CARO-06) — this area mirrors it. */}
          {assessment.areaKey === 'caro' && (
            <p className="rounded-md border border-line px-3 py-2 text-xs text-ink-muted">
              Concluded in the 02.4 CARO 2020 workspace (exemption tests, CARO-06 and Partner
              approval); this row mirrors it.{' '}
              <button
                type="button"
                className="font-medium text-primary-600 underline"
                onClick={() => {
                  setOpen(false);
                  document
                    .getElementById('framework-02-4')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                Open the 02.4 CARO workspace
              </button>
            </p>
          )}

          {/* ICFR reporting is concluded in 02.5 (IFC-04) — this area mirrors it. */}
          {assessment.areaKey === 'ifc' && (
            <p className="rounded-md border border-line px-3 py-2 text-xs text-ink-muted">
              Concluded in the 02.5 ICFR Reporting workspace (exemption routes, IFC-04 and Partner
              approval); this row mirrors it.{' '}
              <button
                type="button"
                className="font-medium text-primary-600 underline"
                onClick={() => {
                  setOpen(false);
                  document
                    .getElementById('framework-02-5')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                Open the 02.5 ICFR workspace
              </button>
            </p>
          )}

          {/* Decision controls */}
          {canManage && assessment.areaKey !== 'caro' && assessment.areaKey !== 'ifc' && (
            <div className="space-y-2">
              <Textarea
                placeholder="Basis / rationale (required when overriding the system suggestion)"
                value={basis}
                onChange={(e) => setBasis(e.target.value)}
                rows={2}
              />
              <Textarea
                placeholder="Downstream impact (optional)"
                value={impact}
                onChange={(e) => setImpact(e.target.value)}
                rows={2}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => decide.mutate('applicable')}
                  disabled={decide.isPending}
                >
                  Mark applicable
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => decide.mutate('not_applicable')}
                  disabled={decide.isPending}
                >
                  Mark not applicable
                </Button>
              </div>
            </div>
          )}

          {/* Evidence */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Evidence
            </p>
            {assessment.evidence.length === 0 && (
              <p className="text-xs text-ink-faint">No evidence linked yet.</p>
            )}
            {assessment.evidence.map((ev) => (
              <div
                key={ev.id}
                className="flex items-center justify-between gap-2 text-xs text-ink-muted"
              >
                <span>{ev.note ?? `Document ${ev.documentId?.slice(0, 8)}`}</span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => removeEvidence.mutate(ev.id)}
                    className="text-ink-faint hover:text-danger-600"
                    title="Remove evidence"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {canManage && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  className="flex-1 rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-xs"
                  placeholder="Add an evidence note…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={() => addEvidence.mutate()}
                  disabled={addEvidence.isPending || note.trim().length === 0}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </InlinePanel>
    </Card>
  );
}
