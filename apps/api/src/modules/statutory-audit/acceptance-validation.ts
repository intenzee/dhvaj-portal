import { BadRequestException } from '@nestjs/common';
import {
  questionByKey,
  type AcceptanceContext,
  type AcceptanceDetailField,
  type RecordAcceptanceAnswerInput,
} from '@hsdg/contracts';

/**
 * Validate one Section 01 answer against its question (spec §4–§9): the answer
 * must be one of the question's options (or a date / a recorded form), and the
 * detail fields are limited to the ones the question defines, each of the right
 * type. Unknown detail keys are dropped, so the stored record never carries
 * anything the screen did not ask for.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FY = /^\d{4}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 4000;

export interface CleanAnswer {
  answer: string | null;
  details: Record<string, unknown>;
}

function validDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

function cleanField(f: AcceptanceDetailField, v: unknown): unknown {
  if (v == null || v === '') return undefined;
  const bad = (why: string) => new BadRequestException(`${f.label}: ${why}`);
  switch (f.type) {
    case 'multiselect': {
      if (!Array.isArray(v)) throw bad('choose from the list.');
      const allowed = new Set((f.options ?? []).map((o) => o.value));
      const out = [...new Set(v.map(String))];
      if (out.some((x) => !allowed.has(x))) throw bad('choose from the list.');
      return out.length ? out : undefined;
    }
    case 'select':
    case 'yesno': {
      const allowed = f.type === 'yesno' ? ['yes', 'no'] : (f.options ?? []).map((o) => o.value);
      if (typeof v !== 'string' || !allowed.includes(v)) throw bad('choose from the list.');
      return v;
    }
    case 'date':
      if (typeof v !== 'string' || !validDate(v)) throw bad('enter a valid date.');
      return v;
    case 'fy':
      if (typeof v !== 'string' || !FY.test(v)) throw bad('enter a financial year like 2024-25.');
      return v;
    case 'email':
      if (typeof v !== 'string' || !EMAIL.test(v.trim())) throw bad('enter a valid email.');
      return v.trim();
    default:
      if (typeof v !== 'string') throw bad('enter text.');
      if (v.length > MAX_TEXT) throw bad(`keep it under ${MAX_TEXT} characters.`);
      return v.trim() || undefined;
  }
}

export function validateAcceptanceAnswer(
  segmentKey: string,
  input: RecordAcceptanceAnswerInput,
  context: Pick<AcceptanceContext, 'otherServices'>,
): CleanAnswer {
  const [base, sub] = input.questionKey.split(':') as [string, string | undefined];
  const q = questionByKey(base);
  if (!q || q.segmentKey !== segmentKey) {
    throw new BadRequestException('Unknown question for this segment.');
  }
  if (q.control === 'services') {
    if (!sub || !context.otherServices.some((o) => o.engagementServiceId === sub)) {
      throw new BadRequestException("Assess one of the client's other active services.");
    }
  } else if (sub) {
    throw new BadRequestException('Unknown question for this segment.');
  }

  const answer = input.answer ?? null;
  if (answer !== null) {
    if (q.control === 'date') {
      if (!validDate(answer)) throw new BadRequestException(`${q.code}: enter a valid date.`);
    } else if (q.control === 'period' || q.control === 'form') {
      if (answer !== 'recorded') throw new BadRequestException(`${q.code}: unexpected answer.`);
    } else if (!(q.options ?? []).some((o) => o.value === answer)) {
      throw new BadRequestException(`${q.code || 'Answer'}: choose one of the options.`);
    }
  }

  // Every field the question can show, for any answer.
  const fields = new Map<string, AcceptanceDetailField>();
  for (const d of q.details ?? []) for (const f of d.fields) fields.set(f.key, f);
  const details: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.details ?? {})) {
    const f = fields.get(k);
    if (!f) continue;
    const c = cleanField(f, v);
    if (c !== undefined) details[k] = c;
  }
  if (q.control === 'period') {
    const from = details.from as string | undefined;
    const to = details.to as string | undefined;
    if (from && to && to < from) {
      throw new BadRequestException(`${q.code}: the period must end on or after it starts.`);
    }
  }
  return { answer, details };
}
