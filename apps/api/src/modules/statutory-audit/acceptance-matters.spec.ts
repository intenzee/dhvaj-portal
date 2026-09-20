import { deriveAcceptanceMatters, type AcceptanceAnswerInput } from './acceptance-matters';

const ans = (over: Partial<AcceptanceAnswerInput> = {}): AcceptanceAnswerInput => ({
  segmentKey: 'appointment_eligibility',
  questionKey: 'properly_appointed',
  answer: 'yes',
  ...over,
});

describe('deriveAcceptanceMatters (Section 01 matters, guide §8.4)', () => {
  it('a non-adverse answer raises no matter', () => {
    expect(deriveAcceptanceMatters([ans({ answer: 'yes' })])).toEqual([]);
  });

  it('the adverse answer raises a classified, blocking matter with a source back-link', () => {
    const m = deriveAcceptanceMatters([ans({ answer: 'no' })])[0]!;
    expect(m.source).toBe('acceptance:appointment_eligibility:properly_appointed');
    expect(m.category).toBe('eligibility');
    expect(m.severity).toBe('critical');
    expect(m.isBlocking).toBe(true);
  });

  it('honours a "yes-is-adverse" question (e.g. prohibited services)', () => {
    const clean = deriveAcceptanceMatters([
      ans({ segmentKey: 'independence_ethics', questionKey: 'prohibited_services', answer: 'no' }),
    ]);
    expect(clean).toEqual([]);
    const raised = deriveAcceptanceMatters([
      ans({ segmentKey: 'independence_ethics', questionKey: 'prohibited_services', answer: 'yes' }),
    ])[0]!;
    expect(raised.category).toBe('independence');
    expect(raised.isBlocking).toBe(true);
  });

  it('a non-blocking question raises a non-blocking matter', () => {
    const m = deriveAcceptanceMatters([
      ans({ segmentKey: 'engagement_letter', questionKey: 'client_acknowledged', answer: 'no' }),
    ])[0]!;
    expect(m.isBlocking).toBe(false);
  });

  it('ignores unknown questions and yields one matter per distinct adverse answer', () => {
    expect(deriveAcceptanceMatters([ans({ questionKey: 'nonexistent', answer: 'no' })])).toEqual(
      [],
    );
    const answers = [
      ans({ questionKey: 'properly_appointed', answer: 'no' }),
      ans({ questionKey: 'eligible_141', answer: 'no' }),
    ];
    const derived = deriveAcceptanceMatters(answers);
    expect(derived).toHaveLength(2);
    expect(new Set(derived.map((m) => m.source)).size).toBe(derived.length);
  });
});
