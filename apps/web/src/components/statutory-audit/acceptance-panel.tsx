'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FINAL_SEGMENT_STATE_LABEL,
  PERMISSION,
  SECTION01_STATUS_LABEL,
  SEGMENT_STATE_LABEL,
  type Section01Header,
  type StatutoryAuditAcceptance,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Spinner } from '@/components/ui';
import { useAuditAnchor } from './audit-file-nav';
import { AcceptanceSegmentEditor, scrollToQuestion, segmentOfQuestion } from './acceptance-segment';
import { ProfileFacts } from './acceptance-profile';
import { MattersCard } from './matters-card';
import { AcceptanceFinal, useAcceptanceSignoff } from './acceptance-final';
import { EngagementLetterSection } from './acceptance-engagement-letter';

/**
 * Section 01 — Engagement & Acceptance (spec §3–§13). The engagement profile
 * is prefilled read-only from the entity / engagement masters — the team
 * confirms it, never re-keys it; corrections are made on the masters.
 * Each segment's questions come from the shared question engine, and its
 * state is derived from the answers — never marked by hand. Adverse answers
 * raise Acceptance Matters automatically.
 */

const QK = (id: string) => ['engagement', id, 'statutory-audit-acceptance'];

export function AcceptancePanel({
  engagementId,
  entityId,
}: {
  engagementId: string;
  entityId?: string;
}): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // "Go to" links from the approval checks select the segment they name.
  useAuditAnchor('acceptance', (anchor) => {
    if (anchor.startsWith('segment-')) setSelectedKey(anchor.slice('segment-'.length));
    else if (anchor.startsWith('question-')) {
      const key = anchor.slice('question-'.length);
      const seg = segmentOfQuestion(key);
      if (seg) setSelectedKey(seg);
      setTimeout(() => scrollToQuestion(key), 150);
    }
    else if (anchor === 'engagement-profile') setSelectedKey('engagement_profile');
    else if (anchor === 'acceptance-matters') setSelectedKey('final_acceptance');
  });

  const query = useQuery({
    queryKey: QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditAcceptance[]>(`/engagements/${engagementId}/statutory-audit/acceptance`),
  });
  const onSaved = () => {
    void qc.invalidateQueries({ queryKey: QK(engagementId) });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'statutory-audit'] });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'statutory-audit-acceptance-signoff'] });
  };
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Could not save.');

  const answer = useMutation({
    mutationFn: (v: {
      segmentId: string;
      questionKey: string;
      answer: string | null;
      details: Record<string, unknown>;
    }) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/acceptance/segments/${v.segmentId}/answer`, {
        method: 'POST',
        body: { questionKey: v.questionKey, answer: v.answer, details: v.details },
      }),
    onSuccess: onSaved,
    onError,
  });

  const signoff = useAcceptanceSignoff(engagementId, query.data?.[0]?.workflowInstanceId);

  if (query.isLoading) return <Spinner label="Loading acceptance…" />;
  const acc = query.data?.[0];
  if (!acc) return null;

  const approved = acc.approval !== null;
  const editable = canManage && !approved;
  const segments = acc.segments;
  const selected =
    segments.find((s) => s.segmentKey === selectedKey) ??
    segments.find((s) => s.state !== 'complete' && s.state !== 'not_applicable') ??
    segments[0]!;

  return (
    <div className="space-y-3">
      <Section01HeaderCard header={signoff.data?.header} approved={approved} />

      <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
        <Card className="overflow-hidden p-0">
          <ol className="divide-y divide-line">
            {segments.map((s, i) => (
              <li key={s.id} id={`audit-anchor-segment-${s.segmentKey}`}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(s.segmentKey)}
                  className={`flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-surface-sunken ${
                    s.id === selected.id ? 'bg-surface-sunken' : ''
                  }`}
                >
                  <span className="w-8 shrink-0 font-mono text-xs text-ink-faint">01.{i + 1}</span>
                  <span className="flex-1">
                    <span className="block text-ink">{s.title}</span>
                    <span className="text-[11px] text-ink-faint">
                      {s.segmentKey === 'final_acceptance' && signoff.data
                        ? FINAL_SEGMENT_STATE_LABEL[signoff.data.finalSegmentState]
                        : SEGMENT_STATE_LABEL[s.state]}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-3">
          {selected.segmentKey === 'final_acceptance' ? (
            <AcceptanceFinal
              engagementId={engagementId}
              workflowInstanceId={acc.workflowInstanceId}
              canManage={canManage}
            />
          ) : (
            <AcceptanceSegmentEditor
              key={selected.id}
              acc={acc}
              segment={selected}
              editable={editable}
              busy={answer.isPending}
              onAnswer={(questionKey, a, details) =>
                answer.mutate({ segmentId: selected.id, questionKey, answer: a, details })
              }
              intro={
                selected.segmentKey === 'engagement_profile' ? (
                  <ProfileFacts
                    facts={acc.engagementProfile}
                    entityId={entityId}
                    engagementId={engagementId}
                    editable={editable}
                    correcting={
                      selected.answers.find((a) => a.questionKey === 'ep_01')?.answer === 'correction'
                    }
                  />
                ) : selected.segmentKey === 'engagement_letter' ? (
                  <EngagementLetterSection
                    engagementId={engagementId}
                    workflowInstanceId={acc.workflowInstanceId}
                    editable={editable}
                  />
                ) : undefined
              }
            />
          )}
          <MattersCard
            engagementId={engagementId}
            workflowInstanceId={acc.workflowInstanceId}
            section="acceptance"
            canManage={editable}
          />
        </div>
      </div>
    </div>
  );
}

/** The Section 01 header (spec §3): status, progress, people and open matters. */
function Section01HeaderCard({
  header,
  approved,
}: {
  header: Section01Header | undefined;
  approved: boolean;
}): JSX.Element {
  const tone =
    header?.status === 'complete'
      ? 'success'
      : header?.status === 'attention_required'
        ? 'danger'
        : header?.status === 'ready_for_review'
          ? 'info'
          : 'warn';
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">Engagement &amp; Acceptance · Section 01</h2>
        {header && (
          <p className="text-xs text-ink-muted">
            {header.completedSegments} of {header.applicableSegments} segments complete · Prepared by{' '}
            {header.preparedByName ?? '—'} · Engagement Partner {header.engagementPartnerName ?? '—'} ·{' '}
            {header.openMatterCount} open matter{header.openMatterCount === 1 ? '' : 's'}
            {header.openBlockingMatterCount > 0 ? ` (${header.openBlockingMatterCount} blocking)` : ''}
          </p>
        )}
      </div>
      <Badge tone={header ? tone : approved ? 'success' : 'warn'}>
        {header ? SECTION01_STATUS_LABEL[header.status] : approved ? 'Complete' : 'In Progress'}
      </Badge>
    </Card>
  );
}
