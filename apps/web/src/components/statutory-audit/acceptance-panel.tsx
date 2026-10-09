'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import {
  ACCEPTANCE_CONCLUSIONS,
  PERMISSION,
  SEGMENT_STATE_LABEL,
  type AcceptanceConclusion,
  type StatutoryAuditAcceptance,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Button, Spinner } from '@/components/ui';
import { Field, Select, Textarea } from '@/components/form';
import { useAuditAnchor } from './audit-file-nav';
import { AcceptanceSegmentEditor, scrollToQuestion, segmentOfQuestion } from './acceptance-segment';
import { ProfileFacts } from './acceptance-profile';
import { MattersCard } from './matters-card';
import { SectionPackChecks } from './section-pack-card';

/**
 * Section 01 — Engagement & Acceptance (spec §3–§13). The engagement profile
 * is prefilled read-only from the entity / engagement masters — the team
 * confirms it, never re-keys it; corrections are made on the masters.
 * Each segment's questions come from the shared question engine, and its
 * state is derived from the answers — never marked by hand. Adverse answers
 * raise Acceptance Matters automatically.
 */

const CONCLUSION_LABEL: Record<AcceptanceConclusion, string> = {
  accept: 'Accept',
  continue: 'Continue',
  accept_with_conditions: 'Accept with conditions',
  return: 'Return to preparer',
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
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Engagement &amp; Acceptance · Section 01</h2>
          <p className="text-xs text-ink-muted">
            {approved
              ? `Approved — ${CONCLUSION_LABEL[acc.approval!.conclusion]}${acc.approval!.approvedByName ? ` · ${acc.approval!.approvedByName}` : ''}`
              : `${acc.unresolvedSegmentCount} segment(s) open · ${acc.openBlockingMatterCount} blocking matter(s)${acc.pack.attention > 0 ? ` · ${acc.pack.attention} to note` : ''}${acc.unresolvedSegmentCount === 0 ? ` · suggested: ${CONCLUSION_LABEL[acc.pack.suggestedConclusion]}` : ''}`}
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
                    <span className="text-[11px] text-ink-faint">{SEGMENT_STATE_LABEL[s.state]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-3">
          {selected.segmentKey === 'final_acceptance' ? (
            <ApprovalCard
              acc={acc}
              canManage={canManage}
              engagementId={engagementId}
              onSaved={onSaved}
              onError={onError}
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
  const [conclusion, setConclusion] = useState<AcceptanceConclusion>(acc.pack.suggestedConclusion);
  const [conclusionChosen, setConclusionChosen] = useState(false);
  useEffect(() => {
    if (!conclusionChosen) setConclusion(acc.pack.suggestedConclusion);
  }, [acc.pack.suggestedConclusion, conclusionChosen]);
  // The memo is drafted from the file; an unedited draft is recorded server-side,
  // ending on the conclusion chosen here.
  const draft = acc.pack.draftMemo ?? '';
  const [memo, setMemo] = useState(draft);
  const [memoEdited, setMemoEdited] = useState(false);
  useEffect(() => {
    if (!memoEdited) setMemo(draft);
  }, [draft, memoEdited]);
  const approve = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/${acc.workflowInstanceId}/acceptance/approve`, {
        method: 'POST',
        body: { conclusion, memo: memoEdited && memo.trim() ? memo : undefined },
      }),
    onSuccess: onSaved,
    onError,
  });

  if (acc.approval) {
    return (
      <Card className="space-y-1 p-4 text-sm">
        <h3 className="font-semibold text-ink">Partner approval</h3>
        <p className="text-ink">{CONCLUSION_LABEL[acc.approval.conclusion]}</p>
        {acc.approval.memo && (
          <p className="whitespace-pre-line text-ink-muted">{acc.approval.memo}</p>
        )}
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
          : 'Not ready yet — see below for what is open and where to put it right (a decline can be recorded at any time).'}
      </p>
      <SectionPackChecks pack={acc.pack} />
      <Field label="Conclusion">
        <Select
          value={conclusion}
          disabled={!canManage}
          onChange={(e) => {
            setConclusion(e.target.value as AcceptanceConclusion);
            setConclusionChosen(true);
          }}
        >
          {ACCEPTANCE_CONCLUSIONS.map((c) => (
            <option key={c} value={c}>
              {CONCLUSION_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>
      {acc.unresolvedSegmentCount === 0 && (
        <p className="-mt-2 text-[11px] text-ink-faint">
          Suggested from the answers: {CONCLUSION_LABEL[acc.pack.suggestedConclusion]}.
        </p>
      )}
      <Field
        label="Acceptance memo"
        hint={memoEdited ? undefined : 'Drafted from the file — recorded as is, ending on the conclusion chosen above, unless you edit it.'}
      >
        <Textarea
          rows={8}
          value={memo}
          disabled={!canManage}
          onChange={(e) => {
            setMemo(e.target.value);
            setMemoEdited(true);
          }}
        />
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
