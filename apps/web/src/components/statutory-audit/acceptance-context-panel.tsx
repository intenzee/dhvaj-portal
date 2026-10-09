'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, History, MessageSquare, TriangleAlert } from 'lucide-react';
import {
  ACCEPTANCE_CONCLUSION_LABEL,
  ACCEPTANCE_FILE_SLOTS,
  ACCEPTANCE_FILE_STATUS_LABEL,
  rollForwardQuestions,
  type AcceptanceConclusion,
  type AcceptanceFileStatus,
  type AcceptanceSegment,
  type AuditMatterRecord,
  type StatutoryAuditAcceptance,
  type StatutoryAuditReview,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';
import { Textarea } from '@/components/form';
import { scrollToQuestion } from './acceptance-segment';
import { matterQuestionKey } from './matters-card';
import { NoteRow, REVIEW_QK } from './review-panel';

const OPEN_MATTER = ['open', 'under_review', 'blocking'];

/**
 * The right-hand context panel for a Section 01 segment (spec §13): its
 * documents, last year's answers (with roll-forward), the matters it raised
 * and the review notes on it — beside the questions, never in a pop-up.
 */
export function AcceptanceContextPanel({
  acc,
  segment,
  editable,
  canReview,
}: {
  acc: StatutoryAuditAcceptance;
  segment: AcceptanceSegment;
  editable: boolean;
  canReview: boolean;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <SegmentDocuments acc={acc} segment={segment} />
      <PriorYearContext acc={acc} segment={segment} editable={editable} />
      <SegmentMatters acc={acc} segment={segment} />
      <SegmentReviewNotes acc={acc} segment={segment} canReview={canReview} />
    </div>
  );
}

function PanelCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Card className="space-y-2 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <Icon className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
        {title}
      </p>
      {children}
    </Card>
  );
}

function SegmentDocuments({
  acc,
  segment,
}: {
  acc: StatutoryAuditAcceptance;
  segment: AcceptanceSegment;
}): JSX.Element {
  const slots = ACCEPTANCE_FILE_SLOTS.filter((s) => s.segmentKey === segment.segmentKey);
  const linked = segment.answers.filter((a) => a.documentId).length;
  return (
    <PanelCard icon={FileText} title="Evidence & documents">
      {slots.length === 0 && linked === 0 ? (
        <p className="text-xs text-ink-muted">This segment needs no documents.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {slots.map((s) => {
            const status = acc.context.fileStatuses[s.slot] as AcceptanceFileStatus | undefined;
            return (
              <li key={s.slot} className="flex items-start justify-between gap-2">
                <span className="text-ink">{s.title}</span>
                <Badge tone={status ? 'success' : 'neutral'}>
                  {status ? ACCEPTANCE_FILE_STATUS_LABEL[status] : 'Not added'}
                </Badge>
              </li>
            );
          })}
          {linked > 0 && (
            <li className="text-ink-muted">
              {linked} answer{linked === 1 ? '' : 's'} with linked evidence
            </li>
          )}
        </ul>
      )}
    </PanelCard>
  );
}

function PriorYearContext({
  acc,
  segment,
  editable,
}: {
  acc: StatutoryAuditAcceptance;
  segment: AcceptanceSegment;
  editable: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const py = acc.context.priorYear;
  const roll = useMutation({
    mutationFn: () =>
      apiFetch<StatutoryAuditAcceptance>(
        `/engagements/${acc.engagementId}/statutory-audit/acceptance/segments/${segment.id}/roll-forward`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      toast("Last year's answers copied — review what is different this year.");
      void qc.invalidateQueries({ queryKey: ['engagement', acc.engagementId] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not roll forward.'),
  });

  if (acc.context.firstYear !== false) {
    return (
      <PanelCard icon={History} title="Prior year">
        <p className="text-xs text-ink-muted">First-year audit — there is no prior year.</p>
      </PanelCard>
    );
  }
  if (!py) {
    return (
      <PanelCard icon={History} title="Prior year">
        <p className="text-xs text-ink-muted">
          Last year&apos;s audit file is not in DHVAJ, so there is nothing to roll forward.
        </p>
      </PanelCard>
    );
  }
  const answered = new Set(segment.answers.map((a) => a.questionKey));
  const available = rollForwardQuestions(segment.segmentKey).filter(
    (q) => py.answers[q.questionKey]?.answer != null,
  );
  const toCopy = available.filter((q) => !answered.has(q.questionKey));
  const conclusion = py.conclusion
    ? (ACCEPTANCE_CONCLUSION_LABEL[py.conclusion as AcceptanceConclusion] ?? py.conclusion)
    : 'Not concluded';
  return (
    <PanelCard icon={History} title={`Prior year · FY ${py.financialYear}`}>
      <p className="text-xs text-ink-muted">
        {conclusion}
        {py.approvedByName ? ` · ${py.approvedByName}` : ''}
      </p>
      {available.length === 0 ? (
        <p className="text-xs text-ink-muted">Last year recorded nothing for this segment.</p>
      ) : (
        <p className="text-xs text-ink-muted">
          {available.length} answer{available.length === 1 ? '' : 's'} from last year
          {toCopy.length < available.length
            ? ` · ${available.length - toCopy.length} already answered this year`
            : ''}
        </p>
      )}
      {editable && toCopy.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          disabled={roll.isPending}
          onClick={() => roll.mutate()}
        >
          Use last year&apos;s answers ({toCopy.length})
        </Button>
      )}
    </PanelCard>
  );
}

function SegmentMatters({
  acc,
  segment,
}: {
  acc: StatutoryAuditAcceptance;
  segment: AcceptanceSegment;
}): JSX.Element {
  // Shares the matters card's query.
  const query = useQuery({
    queryKey: ['engagement', acc.engagementId, 'matters', acc.workflowInstanceId, 'acceptance'],
    queryFn: () =>
      apiFetch<AuditMatterRecord[]>(
        `/engagements/${acc.engagementId}/statutory-audit/${acc.workflowInstanceId}/matters?section=acceptance`,
      ),
  });
  const mine = (query.data ?? []).filter((m) =>
    m.source.startsWith(`acceptance:${segment.segmentKey}:`),
  );
  const open = mine.filter((m) => OPEN_MATTER.includes(m.status));
  return (
    <PanelCard icon={TriangleAlert} title="Matters">
      {mine.length === 0 ? (
        <p className="text-xs text-ink-muted">No matter raised from this segment.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {mine.map((m) => {
            const q = matterQuestionKey(m.source);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={!q}
                  onClick={() => q && scrollToQuestion(q)}
                  className="text-left hover:underline disabled:no-underline"
                >
                  <span className="font-medium text-ink">{m.matterCode}</span>{' '}
                  <span className="text-ink-muted">{m.description ?? m.title}</span>
                </button>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {m.isBlocking && OPEN_MATTER.includes(m.status) && (
                    <Badge tone="danger">Blocking</Badge>
                  )}
                  <Badge tone="neutral">{humanize(m.status)}</Badge>
                  {m.ownerName && <span className="text-ink-faint">{m.ownerName}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {open.length > 0 && (
        <p className="text-[11px] text-ink-faint">Resolve them in the matters register below.</p>
      )}
    </PanelCard>
  );
}

function SegmentReviewNotes({
  acc,
  segment,
  canReview,
}: {
  acc: StatutoryAuditAcceptance;
  segment: AcceptanceSegment;
  canReview: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [adding, setAdding] = useState(false);
  // Shares the review panel's query.
  const query = useQuery({
    queryKey: REVIEW_QK(acc.engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditReview[]>(`/engagements/${acc.engagementId}/statutory-audit/review`),
  });
  const notes = (
    query.data?.find((r) => r.workflowInstanceId === acc.workflowInstanceId)?.notes ?? []
  ).filter((n) => n.targetType === 'acceptance_segment' && n.targetId === segment.id);
  const raise = useMutation({
    mutationFn: () =>
      apiFetch(
        `/engagements/${acc.engagementId}/statutory-audit/${acc.workflowInstanceId}/review/notes`,
        { method: 'POST', body: { targetType: 'acceptance_segment', targetId: segment.id, body } },
      ),
    onSuccess: () => {
      toast('Review note raised.');
      setBody('');
      setAdding(false);
      void qc.invalidateQueries({ queryKey: REVIEW_QK(acc.engagementId) });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not raise the note.'),
  });
  return (
    <PanelCard icon={MessageSquare} title="Review notes">
      {notes.length === 0 ? (
        <p className="text-xs text-ink-muted">No review notes on this segment.</p>
      ) : (
        <ul className="divide-y divide-line">
          {notes.map((n) => (
            <NoteRow key={n.id} engagementId={acc.engagementId} note={n} canManage={canReview} />
          ))}
        </ul>
      )}
      {canReview &&
        (adding ? (
          <div className="space-y-2">
            <Textarea
              rows={3}
              aria-label="Review note"
              placeholder="What needs to be looked at"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={raise.isPending || !body.trim()}
                onClick={() => raise.mutate()}
              >
                Raise note
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            Add review note
          </Button>
        ))}
    </PanelCard>
  );
}
