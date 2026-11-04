'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  answerFields,
  TAX_AUDIT_DRAFT_SOURCE_LABEL,
  TAX_AUDIT_FACT_KEYS,
  TAX_AUDIT_FACTS,
  TAX_AUDIT_GRADE_LABEL,
  TAX_AUDIT_PACKAGE_LABEL,
  TAX_AUDIT_WORK_STAGES,
  TAX_AUDIT_WP_STATUS_LABEL,
  TAX_AUDIT_WP_STATUSES,
  type TaxAuditAnswer,
  type TaxAuditFacts,
  type TaxAuditPackageRow,
  type TaxAuditSubItem,
  type TaxAuditWorkingPaper,
  type TaxAuditWorkspace,
  type TaxAuditWpStatus,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { blobToBase64 } from '@/lib/file-kind';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { TAX_AUDITS_KEY } from './keys';

const WP_TONE: Record<TaxAuditWpStatus, string> = {
  not_started: 'neutral',
  in_progress: 'info',
  in_review: 'warn',
  done: 'success',
  not_applicable: 'neutral',
};

/** "2 done · 1 in review · 3 to do of 6" — not-applicable clauses count as settled. */
export function packageProgress(counts: Record<TaxAuditWpStatus, number>): string {
  const total = TAX_AUDIT_WP_STATUSES.reduce((n, s) => n + counts[s], 0);
  const settled = counts.done + counts.not_applicable;
  const todo = counts.not_started + counts.in_progress;
  const parts = [`${settled} settled`];
  if (counts.in_review) parts.push(`${counts.in_review} in review`);
  if (todo) parts.push(`${todo} to do`);
  return `${parts.join(' · ')} of ${total}`;
}

type Act = {
  path: string;
  method?: 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  message?: string;
};

/**
 * Form 3CD workspace (Phase 4, F-5), opened under the year's row once the
 * audit is accepted. The engagement's partner or manager opens the work on
 * the year's library version, sets what the audit knows about the assessee
 * and sends the client the standard list. Each package is a task given out
 * through Assign work; its clauses are prepared here — the answer by field,
 * the evidence, Not applicable with a reason — and sent for review. A Senior
 * or above who did not prepare a clause marks it done or sends it back.
 */
export function ClauseWorkspace({
  engagementId,
  auditId,
}: {
  engagementId: string;
  auditId: string;
}): JSX.Element {
  const base = `/engagements/${engagementId}/tax-audits/${auditId}`;
  const key = [...TAX_AUDITS_KEY, 'clauses', auditId];
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<TaxAuditWorkspace>(`${base}/clauses`),
  });
  const act = useMutation({
    mutationFn: ({ path, method = 'POST', body }: Act) =>
      apiFetch<TaxAuditWorkspace>(`${base}${path}`, { method, body }),
    onSuccess: (next, { message }) => {
      qc.setQueryData(key, next);
      void qc.invalidateQueries({ queryKey: TAX_AUDITS_KEY });
      if (message) toast(message);
    },
    onError: (err: unknown) =>
      toast(err instanceof ApiError ? err.message : 'Could not save.', 'error'),
  });
  const [open, setOpen] = useState<string | null>(null);

  if (q.isLoading) return <Spinner label="Loading the 3CD work…" />;
  if (q.isError || !q.data) return <p className="text-sm text-danger-700">Could not load it.</p>;
  const w = q.data;
  const run = (a: Act): void => act.mutate(a);
  const busy = act.isPending;

  if (!w.library) {
    const ready = TAX_AUDIT_WORK_STAGES.includes(w.stage);
    return (
      <div className="space-y-2 text-sm">
        <p className="text-ink-muted">
          {ready
            ? 'The 3CD work is not open yet. Opening it lays out the year’s clauses as working papers and gives each package out as a task.'
            : 'The 3CD work opens once the audit is accepted.'}
        </p>
        {ready && w.canLead && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run({
                path: '/clauses/open',
                body: { version: w.version },
                message: '3CD work opened.',
              })
            }
          >
            Open the 3CD work
          </Button>
        )}
      </div>
    );
  }

  const lead = w.canLead && w.editable;
  return (
    <div className="space-y-5 text-sm">
      <p className="text-ink-muted">
        Library v{w.library.versionNo} · {w.library.label} (Act {w.library.act})
        {w.openedAt ? ` · opened ${formatDate(w.openedAt)}` : ''}
        {!w.editable && ' · closed: the report is signed'}
      </p>

      <section className="space-y-2">
        <h4 className="font-medium text-ink">What the audit knows</h4>
        <p className="text-xs text-ink-faint">
          A clause the facts rule out falls away as Not applicable; a fact left unknown never takes
          a clause out.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {TAX_AUDIT_FACT_KEYS.map((f) => (
            <Field key={f} label={TAX_AUDIT_FACTS[f]}>
              <Select
                value={w.facts[f] === undefined ? '' : String(w.facts[f])}
                disabled={!lead || busy}
                onChange={(e) => {
                  const facts: TaxAuditFacts = { ...w.facts };
                  if (e.target.value === '') delete facts[f];
                  else facts[f] = e.target.value === 'true';
                  run({ path: '/facts', method: 'PUT', body: { facts, version: w.version } });
                }}
              >
                <option value="">Not known</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            </Field>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-medium text-ink">Information from the client</h4>
          {lead && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run({
                  path: '/information-requests',
                  body: {},
                  message: 'The standard list is with the client.',
                })
              }
            >
              {w.requests.length ? 'Ask for the rest of the list' : 'Ask for the standard list'}
            </Button>
          )}
        </div>
        {w.requests.length ? (
          <ul className="divide-y divide-line">
            {w.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-1">
                <span className="text-ink">{r.label}</span>
                <Badge tone={r.receivedDate ? 'success' : 'neutral'}>
                  {r.receivedDate ? `Received ${formatDate(r.receivedDate)}` : r.status}
                </Badge>
                <span className="text-xs text-ink-faint">
                  Asked {formatDate(r.requestDate)}
                  {r.documentCount ? ` · ${r.documentCount} file(s)` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">Nothing asked for yet.</p>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="font-medium text-ink">Packages</h4>
        <p className="text-xs text-ink-faint">
          Each package is a task: give it out from Assign work. It moves on as its clauses do.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="py-1 pr-3">Package</th>
                <th className="py-1 pr-3">Grade</th>
                <th className="py-1 pr-3">With</th>
                <th className="py-1">Clauses</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {w.packages.map((p) => (
                <PackageRow key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-medium text-ink">Clauses</h4>
          {lead && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run({
                  path: '/clauses/refresh-drafts',
                  body: { version: w.version },
                  message: 'Drafts brought up to date with the portal.',
                })
              }
            >
              Refresh drafts
            </Button>
          )}
        </div>
        {lead && (
          <p className="text-xs text-ink-faint">
            Clauses the portal can answer (client master, the GST and TDS returns the firm filed,
            last year’s tax audit, the MSME list) open with a draft. Refresh once more has come in;
            a changed draft needs confirming again.
          </p>
        )}
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {w.papers.map((wp) => (
            <li key={wp.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised"
                aria-expanded={open === wp.id}
                onClick={() => setOpen(open === wp.id ? null : wp.id)}
              >
                <span className="font-mono text-xs text-ink-faint">{wp.clauseNo}</span>
                <span className="flex-1 text-ink">{wp.title}</span>
                {wp.draftSource && !wp.draftConfirmedAt && wp.status !== 'not_applicable' && (
                  <Badge tone="info">Draft to confirm</Badge>
                )}
                <Badge tone={WP_TONE[wp.status]}>{TAX_AUDIT_WP_STATUS_LABEL[wp.status]}</Badge>
              </button>
              {open === wp.id && (
                <div className="border-t border-line bg-surface-sunken px-3 py-3">
                  <PaperEditor
                    key={wp.version}
                    wp={wp}
                    editable={w.editable}
                    lead={w.canLead}
                    busy={busy}
                    run={run}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PackageRow({ p }: { p: TaxAuditPackageRow }): JSX.Element {
  return (
    <tr>
      <td className="py-1 pr-3 text-ink">
        {TAX_AUDIT_PACKAGE_LABEL[p.package]}
        <div className="text-xs text-ink-faint">cl. {p.clauseNos.join(', ')}</div>
      </td>
      <td className="py-1 pr-3">{TAX_AUDIT_GRADE_LABEL[p.grade]}</td>
      <td className="py-1 pr-3">{p.assigneeName ?? 'Not given out'}</td>
      <td className="py-1">{packageProgress(p.counts)}</td>
    </tr>
  );
}

/** What the portal's draft says, field by field (tables as their rows). */
function DraftValues({ wp }: { wp: TaxAuditWorkingPaper }): JSX.Element | null {
  const d = wp.draftAnswer;
  if (!d) return null;
  const shown = answerFields(wp.subItems).filter((f) => d[f.key] !== undefined && d[f.key] !== '');
  if (shown.length === 0) return null;
  const text = (v: TaxAuditAnswer[string]): string =>
    typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
  return (
    <dl className="space-y-1 text-xs" aria-label="Draft values">
      {shown.map((f) => (
        <div key={f.key}>
          <dt className="text-ink-faint">{f.label}</dt>
          <dd
            className={f.kind === 'table' ? 'whitespace-pre-wrap font-mono text-ink' : 'text-ink'}
          >
            {text(d[f.key]!)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FieldInput({
  f,
  value,
  disabled,
  onChange,
}: {
  f: TaxAuditSubItem;
  value: TaxAuditAnswer[string] | undefined;
  disabled: boolean;
  onChange: (v: TaxAuditAnswer[string] | undefined) => void;
}): JSX.Element {
  switch (f.kind) {
    case 'yes_no':
      return (
        <Select
          value={value === undefined ? '' : String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
        >
          <option value="">Not answered</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      );
    case 'amount':
      return (
        <Input
          type="number"
          step="0.01"
          value={value === undefined ? '' : String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <Input
          type="date"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    default:
      return (
        <Textarea
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          rows={f.kind === 'table' ? 4 : 2}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function PaperEditor({
  wp,
  editable,
  lead,
  busy,
  run,
}: {
  wp: TaxAuditWorkingPaper;
  editable: boolean;
  /** The engagement's partner or manager: the only one who reopens a done clause. */
  lead: boolean;
  busy: boolean;
  run: (a: Act) => void;
}): JSX.Element {
  const path = `/clauses/${wp.id}`;
  const file = useRef<HTMLInputElement>(null);
  const [answer, setAnswer] = useState<TaxAuditAnswer>(wp.answer);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const reopen =
    editable &&
    (wp.status === 'done'
      ? lead
      : (wp.status === 'not_applicable' || wp.status === 'in_review') && wp.canPrepare);
  const prepare =
    editable && wp.canPrepare && (wp.status === 'not_started' || wp.status === 'in_progress');
  const dirty = JSON.stringify(answer) !== JSON.stringify(wp.answer);
  const v = { version: wp.version };

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-faint">
        {[
          wp.preparerName && `Prepared by ${wp.preparerName}`,
          wp.sentForReviewAt && `sent for review ${formatDate(wp.sentForReviewAt)}`,
          wp.doneAt &&
            `done ${formatDate(wp.doneAt)}${wp.doneByName ? ` by ${wp.doneByName}` : ''}`,
          wp.partnerReview && 'the signing partner reviews this clause',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {wp.status === 'not_applicable' ? (
        <p className="text-ink">
          Not applicable{wp.notApplicableSource === 'condition' ? ' (the facts rule it out)' : ''}:{' '}
          {wp.notApplicableReason}
        </p>
      ) : (
        <>
          {wp.draftSource && (
            <div className="space-y-1 rounded-lg border border-line bg-surface p-3">
              <p className="text-ink">
                Draft from {TAX_AUDIT_DRAFT_SOURCE_LABEL[wp.draftSource]}
                {wp.draftConfirmedAt
                  ? ` · confirmed ${formatDate(wp.draftConfirmedAt)}${wp.draftConfirmedByName ? ` by ${wp.draftConfirmedByName}` : ''}`
                  : ''}
              </p>
              {wp.draftNote && <p className="text-xs text-ink-muted">{wp.draftNote}</p>}
              <DraftValues wp={wp} />
              {prepare && !wp.draftConfirmedAt && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || dirty}
                  onClick={() =>
                    run({ path: `${path}/confirm-draft`, body: v, message: 'Draft confirmed.' })
                  }
                >
                  Confirm the draft
                </Button>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {answerFields(wp.subItems).map((f) => (
              <Field
                key={f.key}
                label={f.label}
                hint={f.kind === 'table' ? 'One row a line; columns separated by tabs.' : undefined}
                className={f.kind === 'table' || f.kind === 'text' ? 'sm:col-span-2' : undefined}
              >
                <FieldInput
                  f={f}
                  value={answer[f.key]}
                  disabled={!prepare || busy}
                  onChange={(val) =>
                    setAnswer((a) => {
                      const next = { ...a };
                      if (val === undefined) delete next[f.key];
                      else next[f.key] = val;
                      return next;
                    })
                  }
                />
              </Field>
            ))}
          </div>
          {prepare && (
            <Button
              size="sm"
              disabled={busy || !dirty}
              onClick={() =>
                run({ path, method: 'PUT', body: { answer, ...v }, message: 'Answer saved.' })
              }
            >
              Save the answer
            </Button>
          )}

          <div className="space-y-1">
            <h5 className="font-medium text-ink">Evidence</h5>
            {wp.evidenceRequired.length > 0 && (
              <p className="text-xs text-ink-faint">Needs: {wp.evidenceRequired.join(', ')}</p>
            )}
            {wp.documents.length ? (
              <ul className="space-y-1">
                {wp.documents.map((d) => (
                  <li key={d.documentId} className="flex flex-wrap items-center gap-2">
                    <span className="text-ink">{d.title}</span>
                    <span className="text-xs text-ink-faint">
                      {d.addedByName ?? '—'} · {formatDate(d.addedAt)}
                    </span>
                    {prepare && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run({
                            path: `${path}/evidence/${d.documentId}`,
                            method: 'DELETE',
                            message: 'Taken off the clause; it stays in the documents.',
                          })
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-muted">None attached.</p>
            )}
            {prepare && (
              <>
                <input
                  ref={file}
                  type="file"
                  className="hidden"
                  aria-label={`Evidence for clause ${wp.clauseNo}`}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    run({
                      path: `${path}/evidence`,
                      body: {
                        filename: f.name,
                        contentType: f.type || undefined,
                        contentBase64: await blobToBase64(f),
                      },
                      message: 'Evidence attached.',
                    });
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => file.current?.click()}
                >
                  Attach evidence
                </Button>
              </>
            )}
          </div>

          {prepare && (
            <div className="space-y-2">
              {wp.blockers.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-ink-muted">
                  {wp.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              <Button
                size="sm"
                disabled={busy || dirty || wp.blockers.length > 0}
                onClick={() =>
                  run({ path: `${path}/send-for-review`, body: v, message: 'Sent for review.' })
                }
              >
                Send for review
              </Button>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Not applicable because" className="min-w-64 flex-1">
                  <Input
                    value={reason}
                    maxLength={1000}
                    disabled={busy}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    run({
                      path: `${path}/not-applicable`,
                      body: { reason: reason.trim(), ...v },
                      message: 'Marked Not applicable.',
                    })
                  }
                >
                  Mark Not applicable
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {editable && wp.canReview && wp.status === 'in_review' && (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
          <h5 className="font-medium text-ink">Review</h5>
          <Field label="Comment (needed to send it back)">
            <Textarea
              value={note}
              maxLength={4000}
              rows={2}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run({
                  path: `${path}/review`,
                  body: { outcome: 'done', comment: note.trim() || undefined, ...v },
                  message: 'Clause done.',
                })
              }
            >
              Mark done
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !note.trim()}
              onClick={() =>
                run({
                  path: `${path}/review`,
                  body: { outcome: 'send_back', comment: note.trim(), ...v },
                  message: 'Sent back to the preparer.',
                })
              }
            >
              Send back
            </Button>
          </div>
        </div>
      )}

      {reopen && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => run({ path: `${path}/reopen`, body: v, message: 'Clause reopened.' })}
        >
          Reopen
        </Button>
      )}

      <div className="space-y-1">
        <h5 className="font-medium text-ink">Comments</h5>
        {wp.comments.map((c) => (
          <p key={c.id} className="text-ink">
            <span className="text-xs text-ink-faint">
              {c.authorName ?? '—'} · {formatDate(c.createdAt)}:
            </span>{' '}
            {c.body}
          </p>
        ))}
        {editable && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Add a comment" className="min-w-64 flex-1">
              <Input
                value={comment}
                maxLength={4000}
                disabled={busy}
                onChange={(e) => setComment(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !comment.trim()}
              onClick={() => {
                run({ path: `${path}/comments`, body: { body: comment.trim() } });
                setComment('');
              }}
            >
              Comment
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
