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

  describe('01.2 Appointment & Eligibility', () => {
    const clean: AnswersByKey = {
      app_01: ans('agm'),
      app_02: ans('2024-09-27'),
      app_03: ans('recorded', { from: '2024-25', to: '2028-29' }),
      app_04: ans('yes'),
      app_05: ans('yes'),
      el_firm: ans('clear'),
      el_disqualification: ans('clear'),
      el_tenure: ans('na'),
      el_ceiling: ans('clear'),
      el_relationship: ans('clear'),
      el_other: ans('clear'),
    };

    it('completes once appointment, period, communication and the checklist are recorded', () => {
      const ev = evaluateSegment('appointment_eligibility', clean, ctx());
      expect(ev).toMatchObject({ state: 'complete', required: 11, answered: 11 });
    });

    it('"Other" asks for the basis; a missing appointment communication stays in Needs Attention', () => {
      const ev = evaluateSegment(
        'appointment_eligibility',
        { ...clean, app_01: ans('other'), app_04: ans('no') },
        ctx(),
      );
      expect(ev.state).toBe('in_progress');
      expect(ev.pending).toEqual(
        expect.arrayContaining([
          'APP-01: Specify appointment basis still to record',
          'Appointment Communication Pending',
        ]),
      );
    });

    it('an issue needs its description and conclusion; Partner review or a bar needs attention', () => {
      const open = evaluateSegment(
        'appointment_eligibility',
        { ...clean, el_ceiling: ans('issue') },
        ctx(),
      );
      expect(open.state).toBe('in_progress');
      expect(open.pending.join(' ')).toMatch(/Describe the matter, Conclusion/);
      const review = evaluateSegment(
        'appointment_eligibility',
        {
          ...clean,
          el_ceiling: ans('issue', {
            description: '21 audits this year.',
            conclusion: 'partner_review',
          }),
        },
        ctx(),
      );
      expect(review.state).toBe('attention_required');
      expect(review.items).toContainEqual({
        kind: 'attention',
        text: 'Audit ceiling / number of audits consideration: Partner review required',
        questionKey: 'el_ceiling',
      });
      const resolved = evaluateSegment(
        'appointment_eligibility',
        {
          ...clean,
          el_ceiling: ans('issue', {
            description: 'Within limit after count.',
            conclusion: 'resolved',
          }),
        },
        ctx(),
      );
      expect(resolved.state).toBe('complete');
      const blocked = evaluateSegment(
        'appointment_eligibility',
        clean,
        ctx({ openBlockingSources: ['acceptance:appointment_eligibility:el_ceiling'] }),
      );
      expect(blocked.state).toBe('attention_required');
    });
  });

  describe('01.7 Engagement Letter', () => {
    const letter = (status?: string) =>
      evaluateSegment(
        'engagement_letter',
        {},
        ctx({ fileStatuses: status ? { engagement_letter: status } : {} }),
      );

    it('follows the letter: none → Not Started, draft / review → In Progress, approved on → Complete', () => {
      expect(letter().state).toBe('not_started');
      expect(letter('draft')).toMatchObject({ state: 'in_progress', required: 1, answered: 0 });
      expect(letter('partner_review').pending[0]).toMatch(/with the Engagement Partner/);
      for (const s of ['approved', 'issued', 'accepted']) expect(letter(s).state).toBe('complete');
    });
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
        validateAcceptanceAnswer(
          'engagement_profile',
          { questionKey: 'ep_01', answer: 'maybe' },
          noServices,
        ),
      ).toThrow(/options/);
      expect(() =>
        validateAcceptanceAnswer(
          'audit_preconditions',
          { questionKey: 'ep_01', answer: 'yes' },
          noServices,
        ),
      ).toThrow(/Unknown question/);
    });
  });
});
