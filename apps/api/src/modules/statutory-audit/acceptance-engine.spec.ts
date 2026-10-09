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

  describe('01.3 Previous Auditor Communication', () => {
    const had = {
      pa_02: ans('yes'),
      pa_details: ans('recorded', {
        firmName: 'Rao & Co',
        lastAuditPeriod: '2023-24',
        changeReason: 'tenure_completed',
      }),
    };

    it('is Not Applicable on a continuing engagement, with PA-01 derived from the file', () => {
      const ev = evaluateSegment('previous_auditor', {}, ctx({ firstYear: false }));
      expect(ev.state).toBe('not_applicable');
      expect(ev.notApplicableReason).toMatch(/Continuing Engagement/);
      expect(ev.derived).toEqual(['pa_01']);
      expect(ev.visible.map((q) => q.questionKey)).toEqual(['pa_01']);
    });

    it('applies again when a special circumstance is recorded on PA-01', () => {
      const ev = evaluateSegment(
        'previous_auditor',
        { pa_01: ans('no', { special: 'yes', specialReason: 'Group restructuring.' }) },
        ctx({ firstYear: false }),
      );
      expect(ev.state).toBe('in_progress');
      expect(ev.visible.map((q) => q.questionKey)).toContain('pa_02');
    });

    it('a first-year audit with no previous auditor completes on the reason', () => {
      expect(evaluateSegment('previous_auditor', {}, ctx({ firstYear: true })).state).toBe(
        'not_started',
      );
      const ev = evaluateSegment(
        'previous_auditor',
        { pa_02: ans('no', { reason: 'newly_incorporated' }) },
        ctx({ firstYear: true }),
      );
      expect(ev.state).toBe('complete');
      const pending = evaluateSegment(
        'previous_auditor',
        { pa_02: ans('pending') },
        ctx({ firstYear: true }),
      );
      expect(pending.state).toBe('in_progress');
      expect(pending.pending).toContain('Previous auditor information pending');
    });

    it('PA-03 "No" stays open until the communication is marked Sent', () => {
      const answers = { ...had, pa_03: ans('no'), pa_04: ans('no') };
      const draft = evaluateSegment(
        'previous_auditor',
        answers,
        ctx({ firstYear: true, fileStatuses: { previous_auditor_communication: 'draft' } }),
      );
      expect(draft.state).toBe('in_progress');
      expect(draft.items[0]).toMatchObject({ questionKey: 'pa_03', kind: 'pending' });
      const sent = evaluateSegment(
        'previous_auditor',
        answers,
        ctx({ firstYear: true, fileStatuses: { previous_auditor_communication: 'sent' } }),
      );
      expect(sent.state).toBe('complete');
    });

    it("a previous auditor's matter needs its assessment; Partner review needs attention", () => {
      const base = {
        ...had,
        pa_03: ans('yes', { dateCommunicated: '2024-08-01', mode: 'email' }),
        pa_04: ans('yes', { responseDate: '2024-08-10' }),
      };
      expect(
        evaluateSegment('previous_auditor', { ...base, pa_05: ans('no') }, ctx({ firstYear: true }))
          .state,
      ).toBe('complete');
      const review = evaluateSegment(
        'previous_auditor',
        {
          ...base,
          pa_05: ans('yes', {
            matterCommunicated: 'Unpaid fees.',
            managerAssessment: 'Fees now settled.',
            impact: 'partner_review',
          }),
        },
        ctx({ firstYear: true }),
      );
      expect(review.state).toBe('attention_required');
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
