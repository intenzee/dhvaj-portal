'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, CheckCircle2, CheckCheck, Trash2, Plus } from 'lucide-react';
import {
  PERMISSION,
  type FrameworkAssessment,
  type FrameworkConclusion,
  type FrameworkState,
  type StatutoryAuditFramework,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Button, Spinner } from '@/components/ui';
import { Field, Textarea } from '@/components/form';
import { ExpandToggle, InlinePanel } from '@/components/inline-panel';
import { EntityProfileCard } from './entity-profile-card';
import { FixLink } from './master-fact-list';
import { GroupCaroCard } from './group-caro-card';
import { ReportingFactsCard } from './reporting-facts-card';
import { ReportingFrameworkCard } from './reporting-framework-card';
import { MattersCard } from './matters-card';
import { SectionPackChecks } from './section-pack-card';

/**
 * Framework (Phase 02) screen (Audit Spec §18–§20): the applicability/assessment
 * layer. Each area shows the advisory system suggestion and the professional
 * conclusion (Facts → System Assessment → Evidence → Decision → Basis → Impact).
 * Approving the Framework Memo freezes the conclusions and completes Phase 02.
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

  const [memo, setMemo] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: (workflowInstanceId: string) =>
      apiFetch<StatutoryAuditFramework>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/framework/approve`,
        // An unedited memo is left to the server, which records the draft.
        { method: 'POST', body: memo?.trim() ? { memo } : {} },
      ),
    onSuccess: () => {
      toast('Framework approved — Phase 02 complete.');
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not approve the framework.'),
  });

  if (query.isLoading) return <Spinner label="Loading framework…" />;
  const framework = query.data?.[0];
  if (!framework) return null;

  const approved = framework.approval != null;
  const ready = framework.pack.ready;
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
        id="framework-02-10"
        className="flex scroll-mt-2 flex-wrap items-center justify-between gap-3 p-4"
      >
        <div>
          <h2 className="text-sm font-semibold text-ink">Audit Framework · Phase 02</h2>
          <p className="text-xs text-ink-muted">
            {approved ? (
              <>
                Approved
                {framework.approval?.version ? ` (v${framework.approval.version})` : ''}
                {framework.approval?.approvedByName
                  ? ` · ${framework.approval.approvedByName}`
                  : ''}
              </>
            ) : ready ? (
              'All areas decided — ready to approve the Framework Memo.'
            ) : framework.undecidedCount > 0 ? (
              `${framework.undecidedCount} area(s) still need a professional conclusion.`
            ) : (
              'A blocking matter is open — resolve it below.'
            )}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => runSuggestions.mutate(framework.workflowInstanceId)}
              disabled={runSuggestions.isPending || approved}
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              Run system assessment
            </Button>
            {waiting > 0 && !approved && (
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
            <Button
              onClick={() => approve.mutate(framework.workflowInstanceId)}
              disabled={approve.isPending || approved || !ready}
              title={!ready ? 'See "What approval needs" below' : undefined}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              {approved ? 'Approved' : 'Approve framework'}
            </Button>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-ink">Framework memo</h3>
        {approved ? (
          <p className="whitespace-pre-line text-sm text-ink-muted">
            {framework.approval?.memo ?? 'No memo recorded.'}
          </p>
        ) : (
          <>
            <SectionPackChecks pack={framework.pack} />
            <Field
              label="Memo"
              hint={
                memo == null
                  ? 'Drafted from the conclusions — recorded as is on approval unless you edit it.'
                  : undefined
              }
            >
              <Textarea
                rows={7}
                value={memo ?? framework.pack.draftMemo ?? ''}
                disabled={!canManage}
                onChange={(e) => setMemo(e.target.value)}
              />
            </Field>
          </>
        )}
      </Card>

      <MattersCard
        engagementId={engagementId}
        workflowInstanceId={framework.workflowInstanceId}
        section="framework"
        canManage={canManage && !approved}
      />

      <div id="framework-02-8" className="scroll-mt-2 space-y-3">
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

          {/* Decision controls */}
          {canManage && (
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
