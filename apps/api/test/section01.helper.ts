import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  detailFieldsFor,
  evaluateSegment,
  type AcceptanceDetailField,
  type AcceptanceQuestionDefinition,
  type AnswersByKey,
  type StatutoryAuditAcceptance,
} from '@hsdg/contracts';
import { progressEngagementLetter } from './section01-files.helper';

/**
 * Section 01 for e2e tests: answer every question the screen would show with a
 * clean answer (no exception, nothing pending), the way a manager clears a
 * routine acceptance, and take the engagement letter to Issued (01.7 follows
 * the letter). Re-reads the file after each round because earlier answers
 * decide which later questions appear. `token` must be the Engagement
 * Partner's (approving the letter is partner-only).
 */

/** A plausible value for a required detail field. */
function cleanValue(f: AcceptanceDetailField, financialYear: string): unknown {
  switch (f.type) {
    case 'date':
      return '2024-04-01';
    case 'fy':
      return financialYear;
    case 'email':
      return 'auditor@example.com';
    case 'select':
      return f.options?.[0]?.value;
    case 'multiselect':
      return f.options?.[0] ? [f.options[0].value] : [];
    case 'yesno':
      return 'no';
    default:
      return `E2E ${f.label}`;
  }
}

/** The clean answer for a question (its first "clear" option). */
function cleanAnswer(q: AcceptanceQuestionDefinition): string {
  if (q.control === 'date') return '2024-04-01';
  if (q.control === 'period' || q.control === 'form') return 'recorded';
  const clear = q.options?.find((o) => o.tone === 'clear') ?? q.options?.[0];
  return clear!.value;
}

export async function answerSection01Clean(
  app: INestApplication,
  token: string,
  engId: string,
): Promise<StatutoryAuditAcceptance> {
  const http = app.getHttpServer();
  const base = `/api/v1/engagements/${engId}/statutory-audit/acceptance`;
  const read = async (): Promise<StatutoryAuditAcceptance> =>
    (await request(http).get(base).set('Authorization', `Bearer ${token}`).expect(200)).body[0];

  let acc = await read();
  const fy = acc.engagementProfile.find((f) => f.label === 'Financial year')?.value ?? '2024-25';
  for (let round = 0; round < 12; round += 1) {
    let posted = 0;
    for (const seg of acc.segments) {
      if (seg.segmentKey === 'final_acceptance') continue;
      const byKey: Record<string, { answer: string | null; details: Record<string, unknown> }> = {};
      for (const a of seg.answers) byKey[a.questionKey] = { answer: a.answer, details: a.details };
      const ev = evaluateSegment(seg.segmentKey, byKey as AnswersByKey, {
        firstYear: acc.context.firstYear,
        otherServiceIds: acc.context.otherServices.map((o) => o.engagementServiceId),
        declarationsPending: acc.context.independence.pending,
        fileStatuses: acc.context.fileStatuses,
        openBlockingSources: [],
      });
      if (ev.state === 'not_applicable') continue;
      for (const q of ev.visible) {
        const keys =
          q.control === 'services'
            ? acc.context.otherServices.map((o) => `${q.questionKey}:${o.engagementServiceId}`)
            : [q.questionKey];
        for (const key of keys) {
          // Answered already, or system-derived (e.g. PA-01 from the first-year call).
          if (ev.answers[key]?.answer != null) continue;
          const answer = cleanAnswer(q);
          const details: Record<string, unknown> = {};
          // Fill required fields, twice so fields revealed by another field appear.
          for (let i = 0; i < 2; i += 1) {
            for (const f of detailFieldsFor(q, { answer, details })) {
              if (f.required && details[f.key] == null) details[f.key] = cleanValue(f, fy);
            }
          }
          await request(http)
            .post(`${base}/segments/${seg.id}/answer`)
            .set('Authorization', `Bearer ${token}`)
            .send({ questionKey: key, answer, details })
            .expect(201);
          posted += 1;
        }
      }
    }
    acc = await read();
    if (posted === 0) break;
  }
  await progressEngagementLetter(app, token, engId, acc.workflowInstanceId);
  return read();
}

/** Record one Section 01 answer (e.g. the single exception a test needs). */
export async function answerSection01(
  app: INestApplication,
  token: string,
  engId: string,
  segmentKey: string,
  questionKey: string,
  answer: string | null,
  details: Record<string, unknown> = {},
): Promise<StatutoryAuditAcceptance> {
  const http = app.getHttpServer();
  const base = `/api/v1/engagements/${engId}/statutory-audit/acceptance`;
  const acc = (await request(http).get(base).set('Authorization', `Bearer ${token}`).expect(200))
    .body[0] as StatutoryAuditAcceptance;
  const seg = acc.segments.find((s) => s.segmentKey === segmentKey)!;
  const res = await request(http)
    .post(`${base}/segments/${seg.id}/answer`)
    .set('Authorization', `Bearer ${token}`)
    .send({ questionKey, answer, details })
    .expect(201);
  return res.body as StatutoryAuditAcceptance;
}

/**
 * FINAL-01: the Manager's recommendation, submitted to the Engagement Partner
 * (required before the Partner's decision). The engagement letter is taken to
 * Issued first (01.7 must be partner-approved), so `token` must be the
 * Engagement Partner's. The status is not asserted, so a test can go on to
 * check that the decision itself is refused.
 */
export async function recommendSection01(
  app: INestApplication,
  token: string,
  engId: string,
  shellId: string,
  recommendation = 'accept',
): Promise<number> {
  await progressEngagementLetter(app, token, engId, shellId);
  const res = await request(app.getHttpServer())
    .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/acceptance/recommend`)
    .set('Authorization', `Bearer ${token}`)
    .send({ recommendation });
  return res.status;
}
