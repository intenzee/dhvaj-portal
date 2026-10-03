'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Database, ExternalLink } from 'lucide-react';
import {
  ACCEPTANCE_CONCLUSIONS,
  ACCEPTANCE_QUESTIONS,
  PERMISSION,
  type AcceptanceAnswer,
  type AcceptanceConclusion,
  type AcceptanceSegment,
  type MasterFact,
  type SegmentState,
  type StatutoryAuditAcceptance,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Button, Spinner } from '@/components/ui';
import { Field, Select, Textarea } from '@/components/form';
import { MasterFactList } from './master-fact-list';

/**
 * Section 01 — Engagement & Acceptance (spec §3–§13). The engagement profile
 * is prefilled read-only from the entity / engagement masters — the team
 * confirms it, never re-keys it; corrections are made on the client master.
 * The remaining segments are Yes / No / N/A with narrative only on an
 * exception; adverse answers raise Acceptance Matters automatically.
 */

const STATE_TONE: Record<SegmentState, string> = {
  not_started: 'neutral',
  in_progress: 'info',
  complete: 'success',
  not_applicable: 'neutral',
};
const STATE_LABEL: Record<SegmentState, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  not_applicable: 'Not applicable',
};
const ANSWER_LABEL: Record<AcceptanceAnswer, string> = { yes: 'Yes', no: 'No', na: 'N/A' };
const CONCLUSION_LABEL: Record<AcceptanceConclusion, string> = {
  accept: 'Accept',
  accept_with_conditions: 'Accept with conditions',
  decline: 'Do not accept',
};

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

  const query = useQuery({
    queryKey: QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditAcceptance[]>(`/engagements/${engagementId}/statutory-audit/acceptance`),
  });
  const onSaved = () => {
    void qc.invalidateQueries({ queryKey: QK(engagementId) });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'statutory-audit'] });
  };
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Could not save.');

  const answer = useMutation({
    mutationFn: (v: { segmentId: string; questionKey: string; answer: AcceptanceAnswer; narrative?: string }) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/acceptance/segments/${v.segmentId}/answer`, {
        method: 'POST',
        body: { questionKey: v.questionKey, answer: v.answer, narrative: v.narrative || undefined },
      }),
    onSuccess: onSaved,
    onError,
  });
  const setState = useMutation({
    mutationFn: (v: { segment: AcceptanceSegment; state: SegmentState }) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/acceptance/segments/${v.segment.id}/state`, {
        method: 'POST',
        body: { state: v.state, version: v.segment.version },
      }),
    onSuccess: onSaved,
    onError,
  });

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
  const continuing = acc.engagementProfile.find(
    (f) => f.label === 'First year / continuing audit',
  )?.value;

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Engagement &amp; Acceptance · Section 01</h2>
          <p className="text-xs text-ink-muted">
            {approved
              ? `Approved — ${CONCLUSION_LABEL[acc.approval!.conclusion]}${acc.approval!.approvedByName ? ` · ${acc.approval!.approvedByName}` : ''}`
              : `${acc.unresolvedSegmentCount} segment(s) open · ${acc.openBlockingMatterCount} blocking matter(s)`}
          </p>
        </div>
        <Badge tone={approved ? 'success' : acc.readyForApproval ? 'info' : 'warn'}>
          {approved ? 'Approved' : acc.readyForApproval ? 'Ready for partner approval' : 'In progress'}
        </Badge>
      </Card>

      <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
        <Card className="overflow-hidden p-0">
          <ol className="divide-y divide-line">
            {segments.map((s, i) => (
              <li key={s.id}>
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
                    <span className="text-[11px] text-ink-faint">{STATE_LABEL[s.state]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-3">
          {selected.segmentKey === 'engagement_profile' && (
            <ProfileCard facts={acc.engagementProfile} entityId={entityId} />
          )}
          {selected.segmentKey === 'previous_auditor' &&
            continuing === 'Continuing audit' &&
            selected.state !== 'not_applicable' &&
            editable && (
              <Card className="flex flex-wrap items-center justify-between gap-2 bg-primary-50 p-3 text-xs text-primary-700">
                <span>This is a continuing audit, so previous-auditor communication does not apply.</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={setState.isPending}
                  onClick={() => setState.mutate({ segment: selected, state: 'not_applicable' })}
                >
                  Mark not applicable
                </Button>
              </Card>
            )}
          {selected.segmentKey === 'final_acceptance' ? (
            <ApprovalCard
              acc={acc}
              canManage={canManage}
              engagementId={engagementId}
              onSaved={onSaved}
              onError={onError}
            />
          ) : (
            <SegmentCard
              key={selected.id}
              segment={selected}
              editable={editable}
              busy={answer.isPending || setState.isPending}
              onAnswer={(questionKey, a, narrative) =>
                answer.mutate({ segmentId: selected.id, questionKey, answer: a, narrative })
              }
              onState={(state) => setState.mutate({ segment: selected, state })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ facts, entityId }: { facts: MasterFact[]; entityId?: string }): JSX.Element {
  const missing = facts.filter((f) => !f.value).length;
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Database className="h-4 w-4 text-ink-faint" aria-hidden />
          Prefilled from the client &amp; engagement masters
        </h3>
        {entityId && (
          <Link
            href={`/entities/${entityId}`}
            className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"
          >
            Update entity information <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      <MasterFactList facts={facts} />
      {missing > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          {missing} item(s) are not on the master yet. Use “Add on client master” beside each one
          — the audit file never keeps a separate copy.
        </p>
      )}
    </Card>
  );
}

function SegmentCard({
  segment,
  editable,
  busy,
  onAnswer,
  onState,
}: {
  segment: AcceptanceSegment;
  editable: boolean;
  busy: boolean;
  onAnswer: (questionKey: string, answer: AcceptanceAnswer, narrative?: string) => void;
  onState: (state: SegmentState) => void;
}): JSX.Element {
  const questions = ACCEPTANCE_QUESTIONS.filter((q) => q.segmentKey === segment.segmentKey);
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(segment.answers.map((a) => [a.questionKey, a.narrative ?? ''])),
  );
  const allAnswered = questions.every((q) =>
    segment.answers.some((a) => a.questionKey === q.questionKey && a.answer),
  );

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{segment.title}</h3>
        <Badge tone={STATE_TONE[segment.state]}>{STATE_LABEL[segment.state]}</Badge>
      </div>
      {questions.map((q) => {
        const current = segment.answers.find((a) => a.questionKey === q.questionKey);
        const adverse = current?.answer === q.adverseAnswer;
        return (
          <div key={q.questionKey} className="space-y-2 border-t border-line pt-3 first:border-0 first:pt-0">
            <p className="text-sm text-ink">{q.prompt}</p>
            <div className="flex gap-1.5">
              {(['yes', 'no', 'na'] as const).map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant={current?.answer === a ? 'primary' : 'secondary'}
                  disabled={!editable || busy}
                  onClick={() => onAnswer(q.questionKey, a, notes[q.questionKey])}
                >
                  {ANSWER_LABEL[a]}
                </Button>
              ))}
            </div>
            {adverse && (
              <Field label="Explain the exception" hint="An Acceptance Matter is raised automatically.">
                <Textarea
                  rows={2}
                  value={notes[q.questionKey] ?? ''}
                  disabled={!editable}
                  onChange={(e) => setNotes({ ...notes, [q.questionKey]: e.target.value })}
                  onBlur={() =>
                    editable &&
                    (notes[q.questionKey] ?? '') !== (current?.narrative ?? '') &&
                    onAnswer(q.questionKey, current!.answer!, notes[q.questionKey])
                  }
                />
              </Field>
            )}
          </div>
        );
      })}
      {editable && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button
            size="sm"
            disabled={busy || !allAnswered || segment.state === 'complete'}
            title={!allAnswered ? 'Answer every question first' : undefined}
            onClick={() => onState('complete')}
          >
            <CheckCircle2 className="h-4 w-4" />
            {segment.segmentKey === 'engagement_profile' ? 'Confirm & complete' : 'Mark complete'}
          </Button>
          {segment.state !== 'not_applicable' && segment.segmentKey !== 'engagement_profile' && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onState('not_applicable')}>
              Not applicable
            </Button>
          )}
          {(segment.state === 'complete' || segment.state === 'not_applicable') && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onState('in_progress')}>
              Reopen
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function ApprovalCard({
  acc,
  canManage,
  engagementId,
  onSaved,
  onError,
}: {
  acc: StatutoryAuditAcceptance;
  canManage: boolean;
  engagementId: string;
  onSaved: () => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [conclusion, setConclusion] = useState<AcceptanceConclusion>('accept');
  const [memo, setMemo] = useState('');
  const approve = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/${acc.workflowInstanceId}/acceptance/approve`, {
        method: 'POST',
        body: { conclusion, memo: memo || undefined },
      }),
    onSuccess: onSaved,
    onError,
  });

  if (acc.approval) {
    return (
      <Card className="space-y-1 p-4 text-sm">
        <h3 className="font-semibold text-ink">Partner approval</h3>
        <p className="text-ink">{CONCLUSION_LABEL[acc.approval.conclusion]}</p>
        {acc.approval.memo && <p className="text-ink-muted">{acc.approval.memo}</p>}
        <p className="text-xs text-ink-faint">
          {acc.approval.approvedByName} · {new Date(acc.approval.approvedAt).toLocaleDateString()}
        </p>
      </Card>
    );
  }
  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">Final acceptance &amp; partner approval</h3>
      <p className="text-xs text-ink-muted">
        {acc.readyForApproval
          ? 'Every segment is resolved and no blocking matter is open.'
          : `${acc.unresolvedSegmentCount} segment(s) still open and ${acc.openBlockingMatterCount} blocking matter(s) — resolve them first (a decline can be recorded at any time).`}
      </p>
      <Field label="Conclusion">
        <Select
          value={conclusion}
          disabled={!canManage}
          onChange={(e) => setConclusion(e.target.value as AcceptanceConclusion)}
        >
          {ACCEPTANCE_CONCLUSIONS.map((c) => (
            <option key={c} value={c}>
              {CONCLUSION_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Acceptance memo">
        <Textarea rows={3} value={memo} disabled={!canManage} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <Button
        disabled={!canManage || approve.isPending || (!acc.readyForApproval && conclusion !== 'decline')}
        onClick={() => approve.mutate()}
      >
        <CheckCircle2 className="h-4 w-4" />
        Record partner approval
      </Button>
    </Card>
  );
}
