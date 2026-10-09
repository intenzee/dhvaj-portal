'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed, RotateCcw, Send } from 'lucide-react';
import {
  ACCEPTANCE_CONCLUSIONS,
  ACCEPTANCE_CONCLUSION_LABEL,
  ACCEPTANCE_RECOMMENDATIONS,
  ACCEPTANCE_RECOMMENDATION_LABEL,
  FINAL_SEGMENT_STATE_LABEL,
  isApprovingConclusion,
  partnerConclusionError,
  recommendationNeedsComment,
  type AcceptanceConclusion,
  type AcceptanceRecommendation,
  type AcceptanceSignoffView,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { Field, Select, Textarea } from '@/components/form';
import { openAuditPhase } from './audit-file-nav';
import { acceptanceFilesKey, acceptanceSignoffKey } from './acceptance-files';

export const signoffPath = (engagementId: string, workflowInstanceId: string): string =>
  `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/acceptance`;

/** The 01.8 readiness, header and decision history — one query per audit file. */
export function useAcceptanceSignoff(engagementId: string, workflowInstanceId: string | undefined) {
  return useQuery({
    queryKey: acceptanceSignoffKey(engagementId, workflowInstanceId ?? ''),
    queryFn: () =>
      apiFetch<AcceptanceSignoffView>(`${signoffPath(engagementId, workflowInstanceId!)}/signoff`),
    enabled: Boolean(workflowInstanceId),
  });
}

/**
 * 01.8 Final Acceptance & Partner Approval (spec §12, §14). A readiness
 * summary — never a repeat of the questionnaires — with links back to each
 * source; the Manager's recommendation (FINAL-01) submitted to the Engagement
 * Partner, whose conclusion (FINAL-02) locks Section 01 and unlocks Section 02.
 * A later material change needs a controlled reopen with a reason.
 */
export function AcceptanceFinal({
  engagementId,
  workflowInstanceId,
  canManage,
}: {
  engagementId: string;
  workflowInstanceId: string;
  canManage: boolean;
}): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useAcceptanceSignoff(engagementId, workflowInstanceId);
  const base = signoffPath(engagementId, workflowInstanceId);

  const onDone = (v: AcceptanceSignoffView): void => {
    qc.setQueryData(acceptanceSignoffKey(engagementId, workflowInstanceId), v);
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'statutory-audit-acceptance'] });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'statutory-audit'] });
    void qc.invalidateQueries({ queryKey: acceptanceFilesKey(engagementId, workflowInstanceId) });
  };
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error');

  if (query.isLoading) return <Spinner label="Loading final acceptance…" />;
  const s = query.data;
  if (!s) return null;
  const liveApproval = s.decisions.find((d) => isApprovingConclusion(d.conclusion) && !d.reopenedAt) ?? null;

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Final Acceptance &amp; Partner Approval</h3>
          <Badge
            tone={
              s.finalSegmentState === 'complete' ? 'success' : s.finalSegmentState === 'ready_for_approval' ? 'info' : 'warn'
            }
          >
            {FINAL_SEGMENT_STATE_LABEL[s.finalSegmentState]}
          </Badge>
        </div>

        {s.blockers.length > 0 && !liveApproval && (
          <div className="rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Engagement cannot yet be accepted. {s.blockers.length} matter{s.blockers.length === 1 ? '' : 's'}{' '}
              require{s.blockers.length === 1 ? 's' : ''} attention.
            </p>
            <ul className="mt-1 list-disc pl-6 text-xs">
              {s.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        <ReadinessTable s={s} />
        {s.openMatters.length > 0 && <OpenMatters s={s} />}
      </Card>

      {liveApproval ? (
        <ApprovedCard s={s} base={base} onDone={onDone} onError={onError} />
      ) : (
        <>
          <RecommendationCard s={s} base={base} canManage={canManage} onDone={onDone} onError={onError} />
          {s.recommendation?.status === 'submitted' && (
            <DecisionCard s={s} base={base} onDone={onDone} onError={onError} />
          )}
        </>
      )}

      {s.decisions.length > 0 && <DecisionHistory s={s} />}
    </div>
  );
}

function GoTo({ anchor }: { anchor: string }): JSX.Element {
  return (
    <button
      type="button"
      className="text-xs font-medium text-primary-600 hover:underline"
      onClick={() => openAuditPhase('acceptance', anchor)}
    >
      Go to
    </button>
  );
}

function ReadinessTable({ s }: { s: AcceptanceSignoffView }): JSX.Element {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-ink-faint">
        <tr>
          <th className="py-1 font-medium">Readiness</th>
          <th className="py-1 font-medium">Status</th>
          <th className="py-1" />
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {s.readiness.map((r) => (
          <tr key={r.key}>
            <td className="py-1.5 text-ink">
              <span className="inline-flex items-center gap-2">
                {r.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-success-600" aria-label="Ready" />
                ) : (
                  <CircleDashed className="h-4 w-4 text-warning-600" aria-label="Open" />
                )}
                {r.label}
              </span>
            </td>
            <td className="py-1.5 text-ink-muted">{r.statusLabel}</td>
            <td className="py-1.5 text-right">{!r.ok && <GoTo anchor={r.anchor} />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OpenMatters({ s }: { s: AcceptanceSignoffView }): JSX.Element {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Open acceptance matters</h4>
      <ul className="divide-y divide-line text-sm">
        {s.openMatters.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
            <span className="min-w-0">
              <span className="font-mono text-xs text-ink-faint">{m.code}</span>{' '}
              <span className="text-ink">{m.title}</span>
              {m.isBlocking && (
                <Badge tone="danger" className="ml-2">
                  Blocking
                </Badge>
              )}
              {m.severity && <span className="ml-2 text-xs text-ink-faint">{m.severity}</span>}
            </span>
            <GoTo anchor={m.anchor} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** FINAL-01 — the Manager's recommendation, submitted to the Engagement Partner. */
function RecommendationCard({
  s,
  base,
  canManage,
  onDone,
  onError,
}: {
  s: AcceptanceSignoffView;
  base: string;
  canManage: boolean;
  onDone: (v: AcceptanceSignoffView) => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [recommendation, setRecommendation] = useState<AcceptanceRecommendation | ''>('');
  const [comments, setComments] = useState('');
  const submit = useMutation({
    mutationFn: () =>
      apiFetch<AcceptanceSignoffView>(`${base}/recommend`, {
        method: 'POST',
        body: { recommendation, comments: comments.trim() || null },
      }),
    onSuccess: (v) => {
      onDone(v);
      setRecommendation('');
      setComments('');
    },
    onError,
  });

  const rec = s.recommendation;
  if (rec?.status === 'submitted') {
    return (
      <Card className="space-y-1 p-4 text-sm">
        <h3 className="font-semibold text-ink">FINAL-01 · Manager recommendation</h3>
        <p className="text-ink">{ACCEPTANCE_RECOMMENDATION_LABEL[rec.recommendation]}</p>
        {rec.comments && <p className="whitespace-pre-line text-ink-muted">{rec.comments}</p>}
        <p className="text-xs text-ink-faint">
          Submitted to the Engagement Partner{rec.submittedByName ? ` by ${rec.submittedByName}` : ''} ·{' '}
          {formatDate(rec.submittedAt)}
        </p>
      </Card>
    );
  }

  const needsComment = recommendation !== '' && recommendationNeedsComment(recommendation);
  const clear = recommendation === 'accept' || recommendation === 'continue';
  const blockedClear = clear && s.blockers.length > 0;
  const disabled =
    !canManage ||
    !s.canSubmit ||
    submit.isPending ||
    recommendation === '' ||
    (needsComment && comments.trim() === '') ||
    blockedClear;

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">FINAL-01 · Manager recommendation</h3>
      {rec?.status === 'returned' && (
        <p className="text-xs text-warning-700">
          The Engagement Partner returned the previous recommendation — address the reason below and resubmit.
        </p>
      )}
      <Field label="Recommendation" required>
        <Select
          value={recommendation}
          disabled={!canManage || !s.canSubmit}
          onChange={(e) => setRecommendation(e.target.value as AcceptanceRecommendation | '')}
        >
          <option value="">Select…</option>
          {ACCEPTANCE_RECOMMENDATIONS.map((r) => (
            <option key={r} value={r}>
              {ACCEPTANCE_RECOMMENDATION_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Comments"
        required={needsComment}
        hint={needsComment ? 'Required — explain the safeguards, the review needed or why to decline.' : 'Optional.'}
      >
        <Textarea
          rows={3}
          value={comments}
          disabled={!canManage || !s.canSubmit}
          onChange={(e) => setComments(e.target.value)}
        />
      </Field>
      {blockedClear && (
        <p className="text-xs text-warning-700">
          A clear recommendation needs every item above to be ready — resolve the open items, or recommend with
          safeguards, partner review or decline.
        </p>
      )}
      <Button disabled={disabled} onClick={() => submit.mutate()}>
        <Send className="h-4 w-4" />
        Submit to Engagement Partner
      </Button>
    </Card>
  );
}

/** FINAL-02 — the Engagement Partner's conclusion (EP only). */
function DecisionCard({
  s,
  base,
  onDone,
  onError,
}: {
  s: AcceptanceSignoffView;
  base: string;
  onDone: (v: AcceptanceSignoffView) => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [conclusion, setConclusion] = useState<AcceptanceConclusion | ''>('');
  const [reason, setReason] = useState('');
  const [safeguards, setSafeguards] = useState('');
  const [memo, setMemo] = useState(s.draftMemo);
  const [memoEdited, setMemoEdited] = useState(false);
  useEffect(() => {
    if (!memoEdited) setMemo(s.draftMemo);
  }, [s.draftMemo, memoEdited]);
  const decide = useMutation({
    mutationFn: () =>
      apiFetch<AcceptanceSignoffView>(`${base}/approve`, {
        method: 'POST',
        body: {
          conclusion,
          reason: reason.trim() || null,
          safeguards: safeguards.trim() || null,
          memo: memoEdited && memo.trim() ? memo : undefined,
        },
      }),
    onSuccess: onDone,
    onError,
  });

  if (!s.callerIsEngagementPartner) {
    return (
      <Card className="p-4 text-sm text-ink-muted">
        <h3 className="mb-1 font-semibold text-ink">FINAL-02 · Engagement Partner conclusion</h3>
        Awaiting the Engagement Partner{s.header.engagementPartnerName ? ` (${s.header.engagementPartnerName})` : ''}{' '}
        to conclude. Only the Engagement Partner can approve Section 01.
      </Card>
    );
  }

  const approving = conclusion !== '' && isApprovingConclusion(conclusion);
  const ruleError = conclusion === '' ? null : partnerConclusionError({ conclusion, reason, safeguards });
  const blocked = approving && s.blockers.length > 0;

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">FINAL-02 · Engagement Partner conclusion</h3>
      <Field label="Conclusion" required>
        <Select value={conclusion} onChange={(e) => setConclusion(e.target.value as AcceptanceConclusion | '')}>
          <option value="">Select…</option>
          {ACCEPTANCE_CONCLUSIONS.map((c) => (
            <option key={c} value={c}>
              {ACCEPTANCE_CONCLUSION_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>
      {conclusion === 'accept_with_conditions' && (
        <Field label="Safeguards / conditions" required>
          <Textarea rows={3} value={safeguards} onChange={(e) => setSafeguards(e.target.value)} />
        </Field>
      )}
      {(conclusion === 'return' || conclusion === 'decline') && (
        <Field label={conclusion === 'return' ? 'Reason for returning' : 'Reason for declining'} required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      {conclusion !== 'return' && (
        <Field
          label="Acceptance memo"
          hint={memoEdited ? undefined : 'Drafted from the file — recorded as is, ending on your conclusion, unless you edit it.'}
        >
          <Textarea
            rows={8}
            value={memo}
            onChange={(e) => {
              setMemo(e.target.value);
              setMemoEdited(true);
            }}
          />
        </Field>
      )}
      {blocked && (
        <p className="text-xs text-warning-700">
          The engagement cannot be accepted while items above are open — return it for further work, or decline.
        </p>
      )}
      {ruleError && <p className="text-xs text-ink-faint">{ruleError}</p>}
      <Button
        disabled={conclusion === '' || ruleError !== null || blocked || decide.isPending}
        onClick={() => decide.mutate()}
      >
        <CheckCircle2 className="h-4 w-4" />
        Record conclusion
      </Button>
    </Card>
  );
}

function ApprovedCard({
  s,
  base,
  onDone,
  onError,
}: {
  s: AcceptanceSignoffView;
  base: string;
  onDone: (v: AcceptanceSignoffView) => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const live = s.decisions.find((d) => isApprovingConclusion(d.conclusion) && !d.reopenedAt)!;
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const reopen = useMutation({
    mutationFn: () =>
      apiFetch<AcceptanceSignoffView>(`${base}/reopen`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: (v) => {
      onDone(v);
      setReopening(false);
      setReason('');
    },
    onError,
  });
  return (
    <Card className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">Section 01 approved</h3>
        {s.canReopen && s.callerIsEngagementPartner && (
          <Button size="sm" variant="secondary" onClick={() => setReopening((o) => !o)} aria-expanded={reopening}>
            <RotateCcw className="h-4 w-4" /> Reopen Section 01
          </Button>
        )}
      </div>
      <p className="text-ink">{ACCEPTANCE_CONCLUSION_LABEL[live.conclusion]}</p>
      {live.safeguards && (
        <p className="text-ink-muted">
          <span className="font-medium text-ink">Safeguards: </span>
          {live.safeguards}
        </p>
      )}
      <p className="text-xs text-ink-faint">
        {live.decidedByName} · {formatDate(live.decidedAt)} · Section 01 is locked; Section 02 is open.
      </p>
      {reopening && (
        <div className="space-y-2 rounded-md border border-primary-600/30 border-l-4 border-l-primary-600 bg-surface-sunken/40 p-3">
          <Field
            label="Reason for reopening"
            required
            hint="Reopening unlocks Section 01 for changes and sends Section 02 back to Attention Required until it is approved again."
          >
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" disabled={reason.trim() === '' || reopen.isPending} onClick={() => reopen.mutate()}>
              Reopen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReopening(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DecisionHistory({ s }: { s: AcceptanceSignoffView }): JSX.Element {
  return (
    <Card className="p-4 text-sm">
      <h3 className="mb-2 font-semibold text-ink">Decision history</h3>
      <ol className="space-y-2">
        {s.decisions.map((d) => (
          <li key={d.id} className="border-l-2 border-line pl-3">
            <p className="text-ink">
              {ACCEPTANCE_CONCLUSION_LABEL[d.conclusion]}
              <span className="text-xs text-ink-faint">
                {' '}
                · {d.decidedByName ?? '—'} · {formatDate(d.decidedAt)}
              </span>
            </p>
            {d.safeguards && <p className="text-xs text-ink-muted">Safeguards: {d.safeguards}</p>}
            {d.reason && <p className="text-xs text-ink-muted">Reason: {d.reason}</p>}
            {d.memo && (
              <details className="text-xs text-ink-muted">
                <summary className="cursor-pointer text-ink-faint">Acceptance memo</summary>
                <p className="mt-1 whitespace-pre-line">{d.memo}</p>
              </details>
            )}
            {d.reopenedAt && (
              <p className="text-xs text-warning-700">
                Reopened by {d.reopenedByName ?? '—'} on {formatDate(d.reopenedAt)}: {d.reopenReason}
              </p>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
