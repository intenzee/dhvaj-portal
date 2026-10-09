import {
  EMPTY_EVAL_CONTEXT,
  evaluateSegment,
  type AcceptanceEvalContext,
  type AnswersByKey,
} from '@hsdg/contracts';
import { validateAcceptanceAnswer } from './acceptance-validation';

const ctx = (over: Partial<AcceptanceEvalContext> = {}): AcceptanceEvalContext => ({
  ...EMPTY_EVAL_CONTEXT,
  ...over,
});
const ans = (answer: string | null, details: Record<string, unknown> = {}) => ({ answer, details });
const noServices = { otherServices: [] };

describe('Section 01 question engine', () => {
  describe('01.1 Engagement Profile (EP-01)', () => {
    it('is Not Started until confirmed, and completes on "Yes"', () => {
      expect(evaluateSegment('engagement_profile', {}, ctx()).state).toBe('not_started');
      const ev = evaluateSegment('engagement_profile', { ep_01: ans('yes') }, ctx());
      expect(ev.state).toBe('complete');
      expect(ev).toMatchObject({ required: 1, answered: 1, pending: [] });
    });

    it('stays open with a Needs Attention line while a correction is outstanding', () => {
      const ev = evaluateSegment('engagement_profile', { ep_01: ans('correction') }, ctx());
      expect(ev.state).toBe('in_progress');
      expect(ev.answered).toBe(0);
      expect(ev.pending.join(' ')).toMatch(/correct/i);
    });
  });

  it('an explained exception completes the segment unless its matter is still blocking', () => {
    const answers: AnswersByKey = {
      properly_appointed: ans('no', { explanation: 'Board resolution awaited.' }),
      eligible_141: ans('yes'),
      within_ceiling: ans('yes'),
    };
    expect(evaluateSegment('appointment_eligibility', answers, ctx()).state).toBe('complete');
    const blocked = evaluateSegment(
      'appointment_eligibility',
      answers,
      ctx({ openBlockingSources: ['acceptance:appointment_eligibility:properly_appointed'] }),
    );
    expect(blocked.state).toBe('attention_required');
  });

  it('an exception with no explanation is still open, naming what to record', () => {
    const ev = evaluateSegment(
      'appointment_eligibility',
      { properly_appointed: ans('no'), eligible_141: ans('yes'), within_ceiling: ans('yes') },
      ctx(),
    );
    expect(ev.state).toBe('in_progress');
    expect(ev.pending.join(' ')).toMatch(/Explain the exception/);
  });

  describe('validateAcceptanceAnswer', () => {
    it('accepts an option and keeps only the fields the question defines', () => {
      const out = validateAcceptanceAnswer(
        'engagement_profile',
        { questionKey: 'ep_01', answer: 'yes', details: { stray: 'x' } },
        noServices,
      );
      expect(out).toEqual({ answer: 'yes', details: {} });
    });

    it('rejects an answer that is not one of the options, or a question of another segment', () => {
      expect(() =>
        validateAcceptanceAnswer('engagement_profile', { questionKey: 'ep_01', answer: 'maybe' }, noServices),
      ).toThrow(/options/);
      expect(() =>
        validateAcceptanceAnswer('audit_preconditions', { questionKey: 'ep_01', answer: 'yes' }, noServices),
      ).toThrow(/Unknown question/);
    });
  });
});
