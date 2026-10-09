import {
  EMPTY_EVAL_CONTEXT,
  evaluateSegment,
  specialistLabels,
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

  describe('01.4 Acceptance / Continuance', () => {
    const clean: AnswersByKey = {
      acc_01: ans('no'),
      acc_02: ans('no'),
      acc_03: ans('no'),
      acc_04: ans('yes'),
      acc_05: ans('no'),
      acc_06: ans('no'),
      acc_conclusion: ans('clear'),
    };

    it('a new engagement answers ACC-01 to ACC-06 and the conclusion', () => {
      const ev = evaluateSegment('acceptance_continuance', clean, ctx({ firstYear: true }));
      expect(ev).toMatchObject({ state: 'complete', required: 7, answered: 7 });
      expect(ev.visible.map((q) => q.questionKey)).not.toContain('con_01');
    });

    it('a continuing engagement confirms continuance on CON-01 alone', () => {
      const ev = evaluateSegment(
        'acceptance_continuance',
        { con_01: ans('no') },
        ctx({ firstYear: false }),
      );
      expect(ev.visible.map((q) => q.questionKey)).toEqual(['con_01']);
      expect(ev.state).toBe('complete');
    });

    it('changes since last year show only the changed areas, plus the conclusion', () => {
      const ev = evaluateSegment(
        'acceptance_continuance',
        { con_01: ans('yes', { changedAreas: ['fee', 'resources'] }) },
        ctx({ firstYear: false }),
      );
      expect(ev.visible.map((q) => q.questionKey)).toEqual([
        'con_01',
        'acc_04',
        'acc_05',
        'acc_conclusion',
      ]);
    });

    it('a specialist names the skills; a fee matter needs Partner review', () => {
      const spec = evaluateSegment(
        'acceptance_continuance',
        { ...clean, acc_04: ans('specialist', { specialistTypes: ['other'] }) },
        ctx({ firstYear: true }),
      );
      expect(spec.pending).toContain('ACC-04: Specify the specialist still to record');
      expect(
        specialistLabels({ specialistTypes: ['it', 'other'], specialistOther: 'Forensic' }),
      ).toEqual(['IT', 'Forensic']);
      const fee = evaluateSegment(
        'acceptance_continuance',
        { ...clean, acc_05: ans('yes', { explanation: 'Last year fees unpaid.' }) },
        ctx({ firstYear: true }),
      );
      expect(fee.state).toBe('attention_required');
      expect(fee.attention).toContain('Fee / commercial matter needs Engagement Partner review');
    });
  });

  describe('01.5 Independence & Ethics', () => {
    const clean: AnswersByKey = {
      ind_01: ans('no'),
      ind_02: ans('no'),
      ind_04: ans('no'),
      ind_conclusion: ans('satisfied'),
    };
    const threat = {
      threat: 'familiarity',
      description: "Article assistant is the CFO's nephew.",
      significance: 'high',
      consultation: 'no',
      conclusion: 'safeguards',
      safeguard: 'Rotated off the engagement.',
    };

    it('completes with no other services once every declaration is in', () => {
      expect(evaluateSegment('independence_ethics', clean, ctx()).state).toBe('complete');
      const waiting = evaluateSegment(
        'independence_ethics',
        clean,
        ctx({ declarationsPending: 2 }),
      );
      expect(waiting.state).toBe('in_progress');
      expect(waiting.pending).toContain('2 team independence declarations pending');
    });

    it('IND-03 assesses each other active service', () => {
      const c = ctx({ otherServiceIds: ['s1', 's2'] });
      const one = evaluateSegment(
        'independence_ethics',
        { ...clean, 'ind_03:s1': ans('no_threat') },
        c,
      );
      expect(one.state).toBe('in_progress');
      expect(one).toMatchObject({ required: 5, answered: 4 });
      const both = evaluateSegment(
        'independence_ethics',
        { ...clean, 'ind_03:s1': ans('no_threat'), 'ind_03:s2': ans('further_review') },
        c,
      );
      expect(both.items).toContainEqual({
        kind: 'pending',
        text: 'Another service needs further independence review',
        questionKey: 'ind_03:s2',
      });
    });

    it('a significant threat needs Partner approval until its matter is settled', () => {
      const answers = { ...clean, ind_02: ans('yes', threat) };
      const open = evaluateSegment('independence_ethics', answers, ctx());
      expect(open.state).toBe('attention_required');
      expect(open.attention[0]).toMatch(/IND-02: significant independence matter/);
      const settled = evaluateSegment(
        'independence_ethics',
        answers,
        ctx({ settledSources: ['acceptance:independence_ethics:ind_02'] }),
      );
      expect(settled.state).toBe('complete');
      const low = evaluateSegment(
        'independence_ethics',
        { ...clean, ind_02: ans('yes', { ...threat, significance: 'low' }) },
        ctx(),
      );
      expect(low.state).toBe('complete');
    });

    it('cannot conclude "satisfied" over a threat that cannot be reduced', () => {
      const ev = evaluateSegment(
        'independence_ethics',
        {
          ...clean,
          ind_04: ans('yes', {
            ...threat,
            significance: 'low',
            conclusion: 'not_acceptable',
          }),
        },
        ctx(),
      );
      expect(ev.state).toBe('attention_required');
      expect(ev.attention.join(' ')).toMatch(/cannot be "satisfied"/);
    });
  });

  describe('01.6 Audit Preconditions', () => {
    const clean: AnswersByKey = {
      pre_01: ans('yes'),
      pre_02: ans('yes'),
      pre_03: ans('yes'),
      pre_04: ans('yes'),
      pre_05: ans('yes'),
      pre_06: ans('no'),
    };

    it('completes on the six preconditions; a pending framework may proceed (methodology)', () => {
      expect(evaluateSegment('audit_preconditions', clean, ctx()).state).toBe('complete');
      expect(
        evaluateSegment('audit_preconditions', { ...clean, pre_01: ans('pending') }, ctx()).state,
      ).toBe('complete');
    });

    it('a "No" on PRE-02 to PRE-05 needs Partner attention, settled with its matter', () => {
      const answers = { ...clean, pre_04: ans('no', { explanation: 'Board minutes refused.' }) };
      const ev = evaluateSegment('audit_preconditions', answers, ctx());
      expect(ev.state).toBe('attention_required');
      expect(ev.attention).toEqual([
        'Management has not agreed to provide all relevant information',
      ]);
      expect(
        evaluateSegment(
          'audit_preconditions',
          answers,
          ctx({ settledSources: ['acceptance:audit_preconditions:pre_04'] }),
        ).state,
      ).toBe('complete');
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
