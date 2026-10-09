'use client';

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CircleDot, History } from 'lucide-react';
import {
  SEGMENT_STATE_LABEL,
  answerLabel,
  detailFieldsFor,
  evaluateSegment,
  fileSlotsFor,
  questionByKey,
  type AcceptanceDetailField,
  type AcceptanceQuestionDefinition,
  type AcceptanceSegment,
  type AnswersByKey,
  type SegmentState,
  type StatutoryAuditAcceptance,
} from '@hsdg/contracts';
import { Badge, Button, Card } from '@/components/ui';
import { Input, Select, Textarea } from '@/components/form';
import { cn } from '@/lib/cn';
import { AcceptanceFileCard } from './acceptance-file-card';

/**
 * One Section 01 segment, rendered from the question engine (spec §4–§9, §13):
 * the control each question asks for, detail fields only for the answers that
 * need an explanation, questions that appear only when an earlier answer makes
 * them relevant, and a Needs Attention list whose every line jumps to its
 * question. Answers save as they are given — there is no separate Save.
 */

export type SaveAnswer = (
  questionKey: string,
  answer: string | null,
  details: Record<string, unknown>,
) => void;

export const SEGMENT_TONE: Record<SegmentState, string> = {
  not_started: 'neutral',
  in_progress: 'info',
  attention_required: 'warn',
  complete: 'success',
  not_applicable: 'neutral',
  locked: 'neutral',
  ready_for_approval: 'info',
};

/** Titles for question groups rendered as one compact table. */
const GROUP_TITLE: Record<string, string> = {
  eligibility_checklist: 'Eligibility check — Clear / Issue / N/A',
};

export const questionAnchor = (questionKey: string): string =>
  `audit-anchor-question-${questionKey.split(':')[0]}`;

export function scrollToQuestion(questionKey: string): void {
  const el = document.getElementById(questionAnchor(questionKey));
  el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  if (el) {
    el.classList.add('ring-2', 'ring-primary-400');
    setTimeout(() => el.classList.remove('ring-2', 'ring-primary-400'), 1600);
  }
}

export interface SegmentExtrasProps {
  acc: StatutoryAuditAcceptance;
  segment: AcceptanceSegment;
  editable: boolean;
}

export function AcceptanceSegmentEditor({
  acc,
  segment,
  editable,
  busy,
  onAnswer,
  intro,
  afterQuestion,
}: {
  acc: StatutoryAuditAcceptance;
  segment: AcceptanceSegment;
  editable: boolean;
  busy: boolean;
  onAnswer: SaveAnswer;
  /** Segment-specific content above the questions (e.g. the profile facts). */
  intro?: ReactNode;
  /** Segment-specific content after a question (e.g. a file card). */
  afterQuestion?: (q: AcceptanceQuestionDefinition, answer: string | null) => ReactNode;
}): JSX.Element {
  const answers = useMemo(() => {
    const out: Record<string, { answer: string | null; details: Record<string, unknown> }> = {};
    for (const a of segment.answers) out[a.questionKey] = { answer: a.answer, details: a.details };
    return out as AnswersByKey;
  }, [segment.answers]);
  // The same evaluation the server stores — decides which questions show.
  const ev = evaluateSegment(segment.segmentKey, answers, {
    firstYear: acc.context.firstYear,
    otherServiceIds: acc.context.otherServices.map((o) => o.engagementServiceId),
    declarationsPending: acc.context.independence.pending,
    fileStatuses: acc.context.fileStatuses,
    openBlockingSources: [],
  });
  const items = segment.attentionItems ?? [];

  // Consecutive questions of one group render as one table.
  const blocks: { group: string | null; questions: AcceptanceQuestionDefinition[] }[] = [];
  for (const q of ev.visible) {
    const last = blocks[blocks.length - 1];
    if (q.group && last?.group === q.group) last.questions.push(q);
    else blocks.push({ group: q.group ?? null, questions: [q] });
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{segment.title}</h3>
        <div className="flex items-center gap-2">
          {segment.required > 0 && segment.state !== 'not_applicable' && (
            <span className="text-xs text-ink-faint">
              {Math.min(segment.answered, segment.required)} of {segment.required} done
            </span>
          )}
          <Badge tone={SEGMENT_TONE[segment.state]}>{SEGMENT_STATE_LABEL[segment.state]}</Badge>
        </div>
      </div>

      {segment.notApplicableReason && (
        <p className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
          Not applicable — {segment.notApplicableReason}
        </p>
      )}

      {items.length > 0 && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-warning-700">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Needs attention
          </p>
          <ul className="space-y-0.5">
            {items.map((it, i) => (
              <li key={i}>
                <button
                  type="button"
                  disabled={!it.questionKey}
                  onClick={() => it.questionKey && scrollToQuestion(it.questionKey)}
                  className="text-left text-xs text-warning-700 hover:underline disabled:no-underline"
                >
                  {it.kind === 'attention' ? 'Partner attention: ' : ''}
                  {it.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {intro}

      {blocks.map((b, i) =>
        b.group ? (
          <div key={`g-${i}`} className="overflow-hidden rounded-lg border border-line">
            {GROUP_TITLE[b.group] && (
              <p className="border-b border-line bg-surface-sunken px-3 py-2 text-xs font-semibold text-ink">
                {GROUP_TITLE[b.group]}
              </p>
            )}
            <div className="divide-y divide-line">
              {b.questions.map((q) => (
                <QuestionBlock
                  key={q.questionKey}
                  compact
                  q={q}
                  acc={acc}
                  answers={answers}
                  editable={editable}
                  busy={busy}
                  onAnswer={onAnswer}
                  after={afterQuestion}
                />
              ))}
            </div>
          </div>
        ) : (
          <Fragment key={b.questions[0]!.questionKey}>
            {b.questions.map((q) => (
              <QuestionBlock
                key={q.questionKey}
                q={q}
                acc={acc}
                answers={answers}
                editable={editable}
                busy={busy}
                onAnswer={onAnswer}
                after={afterQuestion}
              />
            ))}
          </Fragment>
        ),
      )}
    </Card>
  );
}

function QuestionBlock({
  q,
  acc,
  answers,
  editable,
  busy,
  onAnswer,
  after,
  compact,
}: {
  q: AcceptanceQuestionDefinition;
  acc: StatutoryAuditAcceptance;
  answers: AnswersByKey;
  editable: boolean;
  busy: boolean;
  onAnswer: SaveAnswer;
  after?: (q: AcceptanceQuestionDefinition, answer: string | null) => ReactNode;
  compact?: boolean;
}): JSX.Element {
  if (q.control === 'services') {
    return (
      <div id={questionAnchor(q.questionKey)} className="space-y-2 rounded-lg">
        <QuestionPrompt q={q} />
        {acc.context.otherServices.length === 0 ? (
          <p className="text-xs text-ink-muted">
            DHVAJ provides no other active service to this client — nothing to assess.
          </p>
        ) : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {acc.context.otherServices.map((svc) => {
              const key = `${q.questionKey}:${svc.engagementServiceId}`;
              return (
                <div key={key} className="p-3">
                  <AnswerRow
                    q={q}
                    rowKey={key}
                    label={
                      <span className="text-sm text-ink">
                        {svc.serviceName}
                        <span className="ml-1 text-xs text-ink-faint">
                          {svc.engagementCode} · FY {svc.financialYear}
                        </span>
                      </span>
                    }
                    state={answers[key]}
                    editable={editable}
                    busy={busy}
                    onAnswer={onAnswer}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  const state = answers[q.questionKey];
  const prior = acc.context.priorYear?.answers[q.questionKey];
  return (
    <div
      id={questionAnchor(q.questionKey)}
      className={cn(
        'space-y-2 rounded-lg',
        compact ? 'p-3' : 'border-t border-line pt-3 first:border-0 first:pt-0',
      )}
    >
      <AnswerRow
        q={q}
        rowKey={q.questionKey}
        label={<QuestionPrompt q={q} />}
        state={state}
        editable={editable}
        busy={busy}
        onAnswer={onAnswer}
        defaults={periodDefaults(q, acc)}
      />
      {prior && prior.answer != null && (
        <p className="flex items-center gap-1 text-[11px] text-ink-faint">
          <History className="h-3 w-3" aria-hidden />
          Last year (FY {acc.context.priorYear!.financialYear}): {answerLabel(q, prior.answer)}
        </p>
      )}
      {fileSlotsFor(q, state?.answer ?? null).map((f) => (
        <AcceptanceFileCard
          key={f.slot}
          engagementId={acc.engagementId}
          workflowInstanceId={acc.workflowInstanceId}
          slotKey={f.slot}
          editable={editable}
          hint={f.hint}
        />
      ))}
      {after?.(q, state?.answer ?? null)}
    </div>
  );
}

/** FY prefill for a From → To period (spec APP-03 "prefill where available"). */
function periodDefaults(
  q: AcceptanceQuestionDefinition,
  acc: StatutoryAuditAcceptance,
): Record<string, unknown> | undefined {
  if (q.control !== 'period') return undefined;
  const fy = acc.engagementProfile.find((f) => f.label === 'Financial year')?.value ?? null;
  return fy ? { from: fy, to: fy } : undefined;
}

function QuestionPrompt({ q }: { q: AcceptanceQuestionDefinition }): JSX.Element {
  return (
    <span className="block text-sm text-ink">
      {q.code && <span className="mr-1.5 font-mono text-[11px] text-ink-faint">{q.code}</span>}
      {q.prompt}
      {q.hint && <span className="mt-0.5 block text-xs text-ink-faint">{q.hint}</span>}
    </span>
  );
}

/** A question's control plus the detail fields its current answer needs. */
function AnswerRow({
  q,
  rowKey,
  label,
  state,
  editable,
  busy,
  onAnswer,
  defaults,
}: {
  q: AcceptanceQuestionDefinition;
  rowKey: string;
  label: ReactNode;
  state: { answer: string | null; details: Record<string, unknown> } | undefined;
  editable: boolean;
  busy: boolean;
  onAnswer: SaveAnswer;
  defaults?: Record<string, unknown>;
}): JSX.Element {
  const serverDetails = state?.details ?? {};
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({
    ...defaults,
    ...serverDetails,
  }));
  const serverKey = JSON.stringify(serverDetails);
  useEffect(() => {
    setDraft({ ...defaults, ...JSON.parse(serverKey) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const answer = state?.answer ?? null;
  const recordedForm = q.control === 'form' || q.control === 'period';
  const fields = detailFieldsFor(q, { answer: recordedForm ? 'recorded' : answer, details: draft });
  const disabled = !editable || busy;
  const save = (nextAnswer: string | null, nextDetails: Record<string, unknown>) =>
    onAnswer(rowKey, nextAnswer, nextDetails);
  const saveDetails = (next: Record<string, unknown>) => {
    if (JSON.stringify(next) === serverKey && answer != null) return;
    save(recordedForm ? 'recorded' : answer, next);
  };

  return (
    <div className="space-y-2">
      <div
        className={cn('flex flex-wrap items-start gap-2', q.group ? 'justify-between' : 'flex-col')}
      >
        {label}
        <Control q={q} answer={answer} disabled={disabled} onChange={(a) => save(a, draft)} />
      </div>
      {fields.length > 0 && (answer != null || recordedForm) && (
        <div className="grid gap-2 rounded-lg bg-surface-sunken p-3 sm:grid-cols-2">
          {fields.map((f) => (
            <DetailInput
              key={f.key}
              field={f}
              value={draft[f.key]}
              disabled={disabled}
              onDraft={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
              onCommit={(v) => saveDetails({ ...draft, [f.key]: v })}
            />
          ))}
        </div>
      )}
      {recordedForm && answer == null && editable && (
        <p className="flex items-center gap-1 text-[11px] text-ink-faint">
          <CircleDot className="h-3 w-3" aria-hidden /> Saved as you leave each field.
        </p>
      )}
    </div>
  );
}

function Control({
  q,
  answer,
  disabled,
  onChange,
}: {
  q: AcceptanceQuestionDefinition;
  answer: string | null;
  disabled: boolean;
  onChange: (answer: string | null) => void;
}): JSX.Element | null {
  switch (q.control) {
    case 'choice':
    case 'services':
      return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={q.code || q.prompt}>
          {(q.options ?? []).map((o) => (
            <Button
              key={o.value}
              size="sm"
              variant={answer === o.value ? 'primary' : 'secondary'}
              aria-pressed={answer === o.value}
              disabled={disabled}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      );
    case 'select':
      return (
        <Select
          aria-label={q.code || q.prompt}
          className="max-w-sm"
          value={answer ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Choose…</option>
          {(q.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case 'date':
      return (
        <Input
          type="date"
          aria-label={q.code || q.prompt}
          className="max-w-[12rem]"
          defaultValue={answer ?? ''}
          key={answer ?? ''}
          disabled={disabled}
          onBlur={(e) => e.target.value !== (answer ?? '') && onChange(e.target.value || null)}
        />
      );
    default:
      return null;
  }
}

function DetailInput({
  field,
  value,
  disabled,
  onDraft,
  onCommit,
}: {
  field: AcceptanceDetailField;
  value: unknown;
  disabled: boolean;
  onDraft: (v: unknown) => void;
  onCommit: (v: unknown) => void;
}): JSX.Element {
  const label = (
    <span className="mb-1 block text-xs font-medium text-ink">
      {field.label}
      {field.required && <span className="ml-0.5 text-danger-600">*</span>}
    </span>
  );
  const wide = field.type === 'textarea' || field.type === 'multiselect';
  const str = typeof value === 'string' ? value : '';
  let input: ReactNode;
  switch (field.type) {
    case 'textarea':
      input = (
        <Textarea
          rows={2}
          value={str}
          disabled={disabled}
          onChange={(e) => onDraft(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
        />
      );
      break;
    case 'select':
      input = (
        <Select
          value={str}
          disabled={disabled}
          onChange={(e) => {
            onDraft(e.target.value);
            onCommit(e.target.value || null);
          }}
        >
          <option value="">Choose…</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
      break;
    case 'yesno':
      input = (
        <div className="flex gap-1.5">
          {(['yes', 'no'] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={value === v ? 'primary' : 'secondary'}
              aria-pressed={value === v}
              disabled={disabled}
              onClick={() => {
                onDraft(v);
                onCommit(v);
              }}
            >
              {v === 'yes' ? 'Yes' : 'No'}
            </Button>
          ))}
        </div>
      );
      break;
    case 'multiselect': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      input = (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((o) => {
            const on = list.includes(o.value);
            return (
              <Button
                key={o.value}
                size="sm"
                variant={on ? 'primary' : 'secondary'}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => {
                  const next = on ? list.filter((x) => x !== o.value) : [...list, o.value];
                  onDraft(next);
                  onCommit(next);
                }}
              >
                {o.label}
              </Button>
            );
          })}
        </div>
      );
      break;
    }
    default:
      input = (
        <Input
          type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
          placeholder={field.type === 'fy' ? '2024-25' : undefined}
          value={str}
          disabled={disabled}
          onChange={(e) => onDraft(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
        />
      );
  }
  return (
    <label className={cn('block', wide && 'sm:col-span-2')}>
      {label}
      {input}
      {field.hint && <span className="mt-1 block text-[11px] text-ink-faint">{field.hint}</span>}
    </label>
  );
}

/** The question an anchor names (`question-<key>`), for "Go to" links. */
export function segmentOfQuestion(questionKey: string): string | null {
  return questionByKey(questionKey.split(':')[0]!)?.segmentKey ?? null;
}
