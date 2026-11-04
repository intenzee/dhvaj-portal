'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TAX_AUDIT_OBSERVATION_KIND_LABEL,
  TAX_AUDIT_REVIEW_LEVEL_LABEL,
  TAX_AUDIT_REVIEW_POINT_STATUS_LABEL,
  type TaxAuditObservation,
  type TaxAuditReview,
  type TaxAuditReviewPoint,
  type TaxAuditReviewPointStatus,
  type TaxAuditWorkspace,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { TAX_AUDITS_KEY } from './keys';

const POINT_TONE: Record<TaxAuditReviewPointStatus, string> = {
  open: 'warn',
  responded: 'info',
  cleared: 'success',
};

/** "cl. 34" / "the report". */
const where = (clauseNo: string | null): string => (clauseNo ? `cl. ${clauseNo}` : 'the report');

type Act = { path: string; method?: 'POST' | 'PUT'; body?: unknown; message?: string };

/**
 * Tax Audit review (Phase 5, F-7), opened under the year's row: the 3CD goes
 * for review once every clause is settled, then Senior, Manager and the
 * signing Partner each sign off once the points raised at their level are
 * cleared. Matters flagged for the report are decided by the signing
 * Partner; the accepted ones are what Form 3CA / 3CB will list. What still
 * blocks signing is spelt out.
 */
export function ReviewDesk({
  engagementId,
  auditId,
}: {
  engagementId: string;
  auditId: string;
}): JSX.Element {
  const base = `/engagements/${engagementId}/tax-audits/${auditId}`;
  const key = [...TAX_AUDITS_KEY, 'review', auditId];
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key, queryFn: () => apiFetch<TaxAuditReview>(`${base}/review`) });
  // The clause list for picking where a point or a flag belongs.
  const clauses = useQuery({
    queryKey: [...TAX_AUDITS_KEY, 'clauses', auditId],
    queryFn: () => apiFetch<TaxAuditWorkspace>(`${base}/clauses`),
  });
  const act = useMutation({
    mutationFn: ({ path, method = 'POST', body }: Act) =>
      apiFetch<TaxAuditReview>(`${base}${path}`, { method, body }),
    onSuccess: (next, { message }) => {
      qc.setQueryData(key, next);
      void qc.invalidateQueries({ queryKey: TAX_AUDITS_KEY });
      if (message) toast(message);
    },
    onError: (err: unknown) =>
      toast(err instanceof ApiError ? err.message : 'Could not save.', 'error'),
  });

  if (q.isLoading) return <Spinner label="Loading the review…" />;
  if (q.isError || !q.data) return <p className="text-sm text-danger-700">Could not load it.</p>;
  const r = q.data;
  const run = (a: Act): void => act.mutate(a);
  const busy = act.isPending;
  const papers = clauses.data?.papers ?? [];

  return (
    <div className="space-y-5 text-sm">
      {r.stage === 'clause_work' && (
        <section className="space-y-2">
          <p className="text-ink-muted">
            The 3CD goes for review once every clause is done or Not applicable.
          </p>
          {r.startBlockers.map((b) => (
            <p key={b} className="text-xs text-ink-muted">
              {b}
            </p>
          ))}
          {r.canStart && (
            <Button
              size="sm"
              disabled={busy || r.startBlockers.length > 0}
              onClick={() =>
                run({
                  path: '/review/start',
                  body: { version: r.version },
                  message: 'The 3CD is in review.',
                })
              }
            >
              Send the 3CD for review
            </Button>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h4 className="font-medium text-ink">Review chain</h4>
        <ol className="space-y-1">
          {r.chain.map((c) => (
            <li key={c.level} className="flex flex-wrap items-center gap-2">
              <span className="w-48 text-ink">{TAX_AUDIT_REVIEW_LEVEL_LABEL[c.level]}</span>
              {c.signoff ? (
                <Badge tone="success">
                  Signed off by {c.signoff.employeeName ?? '—'} ·{' '}
                  {formatDate(c.signoff.signedOffAt)}
                </Badge>
              ) : (
                <span className="text-ink-faint">
                  {c.level === 'partner' && r.signingPartnerName
                    ? `Waiting for ${r.signingPartnerName}`
                    : 'Not signed off'}
                </span>
              )}
              {r.canSignOff === c.level && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run({
                      path: '/review/sign-off',
                      body: { level: c.level, version: r.version },
                      message: `${TAX_AUDIT_REVIEW_LEVEL_LABEL[c.level]} signed off.`,
                    })
                  }
                >
                  Sign off
                </Button>
              )}
            </li>
          ))}
        </ol>
        {r.signingBlockers.length > 0 && r.stage === 'review' && (
          <div className="rounded-lg border border-line bg-surface p-3">
            <p className="font-medium text-ink">Before the report can be signed</p>
            <ul className="list-disc pl-5 text-ink-muted">
              {r.signingBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="font-medium text-ink">Review points</h4>
        {r.points.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {r.points.map((p) => (
              <PointRow key={`${p.id}:${p.version}`} p={p} busy={busy} run={run} />
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">No review points.</p>
        )}
        {r.editable && r.myLevel && (
          <NewEntry
            label={`Raise a point (${TAX_AUDIT_REVIEW_LEVEL_LABEL[r.myLevel]})`}
            button="Raise"
            papers={papers}
            busy={busy}
            onSubmit={(text, workingPaperId) =>
              run({
                path: '/review/points',
                body: { body: text, workingPaperId },
                message: 'Review point raised.',
              })
            }
          />
        )}
      </section>

      <section className="space-y-2">
        <h4 className="font-medium text-ink">Flagged for the report</h4>
        <p className="text-xs text-ink-faint">
          Anything that may need reporting. The signing Partner decides whether each becomes a
          qualification or an observation in Form 3CA / 3CB.
        </p>
        {r.observations.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {r.observations.map((o) => (
              <ObservationRow
                key={`${o.id}:${o.version}`}
                o={o}
                canDecide={r.canDecide}
                busy={busy}
                run={run}
              />
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">Nothing flagged.</p>
        )}
        {r.editable && (
          <NewEntry
            label="Flag a matter"
            button="Flag"
            papers={papers}
            busy={busy}
            onSubmit={(text, workingPaperId) =>
              run({
                path: '/observations',
                body: { wording: text, workingPaperId },
                message: 'Flagged for the signing Partner.',
              })
            }
          />
        )}
      </section>

      <section className="space-y-2">
        <h4 className="font-medium text-ink">What the report will list</h4>
        {r.report.length ? (
          <ol className="list-decimal space-y-1 pl-5">
            {r.report.map((o) => (
              <li key={o.id} className="text-ink">
                <span className="font-medium">{TAX_AUDIT_OBSERVATION_KIND_LABEL[o.kind!]}</span>
                {o.clauseNo ? ` (clause ${o.clauseNo})` : ''}: {o.wording}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-ink-muted">No qualifications or observations.</p>
        )}
      </section>
    </div>
  );
}

function NewEntry({
  label,
  button,
  papers,
  busy,
  onSubmit,
}: {
  label: string;
  button: string;
  papers: TaxAuditWorkspace['papers'];
  busy: boolean;
  onSubmit: (text: string, workingPaperId: string | undefined) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [paper, setPaper] = useState('');
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
      <Field label={label}>
        <Textarea
          value={text}
          rows={2}
          maxLength={4000}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <Field label="On">
        <Select value={paper} disabled={busy} onChange={(e) => setPaper(e.target.value)}>
          <option value="">The report as a whole</option>
          {papers.map((p) => (
            <option key={p.id} value={p.id}>
              Clause {p.clauseNo}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || !text.trim()}
        onClick={() => {
          onSubmit(text.trim(), paper || undefined);
          setText('');
        }}
      >
        {button}
      </Button>
    </div>
  );
}

function PointRow({
  p,
  busy,
  run,
}: {
  p: TaxAuditReviewPoint;
  busy: boolean;
  run: (a: Act) => void;
}): JSX.Element {
  const [response, setResponse] = useState('');
  const path = `/review/points/${p.id}`;
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={POINT_TONE[p.status]}>{TAX_AUDIT_REVIEW_POINT_STATUS_LABEL[p.status]}</Badge>
        <span className="text-xs text-ink-faint">
          {where(p.clauseNo)} · {TAX_AUDIT_REVIEW_LEVEL_LABEL[p.level]} · {p.raisedByName ?? '—'} ·{' '}
          {formatDate(p.raisedAt)}
        </span>
      </div>
      <p className="text-ink">{p.body}</p>
      {p.response && (
        <p className="text-ink-muted">
          <span className="text-xs text-ink-faint">{p.respondedByName ?? '—'}:</span> {p.response}
        </p>
      )}
      {p.status === 'cleared' && (
        <p className="text-xs text-ink-faint">
          Cleared by {p.clearedByName ?? '—'} · {formatDate(p.clearedAt!)}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {p.canRespond && (
          <>
            <Field label="Response" className="min-w-64 flex-1">
              <Input
                value={response}
                maxLength={4000}
                disabled={busy}
                onChange={(e) => setResponse(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !response.trim()}
              onClick={() =>
                run({
                  path: `${path}/respond`,
                  body: { response: response.trim(), version: p.version },
                  message: 'Response sent.',
                })
              }
            >
              Respond
            </Button>
          </>
        )}
        {p.canClear && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run({
                path: `${path}/clear`,
                body: { version: p.version },
                message: 'Point cleared.',
              })
            }
          >
            Clear
          </Button>
        )}
      </div>
    </li>
  );
}

function ObservationRow({
  o,
  canDecide,
  busy,
  run,
}: {
  o: TaxAuditObservation;
  canDecide: boolean;
  busy: boolean;
  run: (a: Act) => void;
}): JSX.Element {
  const [wording, setWording] = useState(o.wording);
  const [note, setNote] = useState('');
  const path = `/observations/${o.id}`;
  const decide = (outcome: 'qualification' | 'observation' | 'dropped'): void =>
    run({
      path: `${path}/decide`,
      body: { outcome, note: note.trim() || undefined, version: o.version },
      message: outcome === 'dropped' ? 'Left out of the report.' : 'Goes into the report.',
    });
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={o.status === 'accepted' ? 'success' : 'neutral'}>
          {o.status === 'accepted'
            ? TAX_AUDIT_OBSERVATION_KIND_LABEL[o.kind!]
            : o.status === 'dropped'
              ? 'Left out'
              : 'To decide'}
        </Badge>
        <span className="text-xs text-ink-faint">
          {where(o.clauseNo)} · {o.raisedByName ?? '—'} · {formatDate(o.createdAt)}
        </span>
      </div>
      {o.canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Wording" className="min-w-64 flex-1">
            <Textarea
              value={wording}
              rows={2}
              maxLength={4000}
              disabled={busy}
              onChange={(e) => setWording(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !wording.trim() || wording.trim() === o.wording}
            onClick={() =>
              run({
                path,
                method: 'PUT',
                body: { wording: wording.trim(), version: o.version },
                message: 'Reworded.',
              })
            }
          >
            Save wording
          </Button>
        </div>
      ) : (
        <p className="text-ink">{o.wording}</p>
      )}
      {o.decidedAt && (
        <p className="text-xs text-ink-faint">
          Decided by {o.decidedByName ?? '—'} · {formatDate(o.decidedAt)}
          {o.decisionNote ? ` — ${o.decisionNote}` : ''}
        </p>
      )}
      {canDecide && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Note (needed to leave it out)" className="min-w-64 flex-1">
            <Input
              value={note}
              maxLength={1000}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => decide('qualification')}
          >
            Qualification
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => decide('observation')}
          >
            Observation
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !note.trim()}
            onClick={() => decide('dropped')}
          >
            Leave out
          </Button>
        </div>
      )}
    </li>
  );
}
