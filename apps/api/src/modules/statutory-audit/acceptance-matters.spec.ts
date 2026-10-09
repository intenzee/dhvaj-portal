import { deriveAcceptanceMatters, type AcceptanceAnswerInput } from './acceptance-matters';

const ans = (over: Partial<AcceptanceAnswerInput> = {}): AcceptanceAnswerInput => ({
  segmentKey: 'appointment_eligibility',
  questionKey: 'el_firm',
  answer: 'clear',
  ...over,
});

describe('deriveAcceptanceMatters (Section 01 matters, guide §8.4)', () => {
  it('a non-adverse answer raises no matter', () => {
    expect(deriveAcceptanceMatters([ans({ answer: 'clear' })])).toEqual([]);
    expect(deriveAcceptanceMatters([ans({ answer: 'na' })])).toEqual([]);
  });

  it('an eligibility issue raises a matter weighted by its conclusion, with a source back-link', () => {
    const issue = (conclusion?: string) =>
      deriveAcceptanceMatters([
        ans({ answer: 'issue', details: { description: 'Partner holds shares.', conclusion } }),
      ])[0]!;
    const open = issue();
    expect(open).toMatchObject({
      source: 'acceptance:appointment_eligibility:el_firm',
      category: 'eligibility',
      severity: 'high',
      isBlocking: true,
      title: 'Eligibility — Firm / auditor eligibility: Partner holds shares.',
    });
    expect(issue('resolved')).toMatchObject({ severity: 'medium', isBlocking: false });
    expect(issue('cannot_accept')).toMatchObject({ severity: 'critical', isBlocking: true });
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

  it("a previous auditor's matter is weighted by its impact on acceptance", () => {
    const pa = (impact: string) =>
      deriveAcceptanceMatters([
        ans({
          segmentKey: 'previous_auditor',
          questionKey: 'pa_05',
          answer: 'yes',
          details: { matterCommunicated: 'Unpaid fees.', impact },
        }),
      ])[0]!;
    expect(pa('no_impact')).toMatchObject({
      category: 'previous_auditor',
      severity: 'low',
      isBlocking: false,
    });
    expect(pa('should_not_accept')).toMatchObject({ severity: 'critical', isBlocking: true });
    expect(pa('no_impact').title).toContain('Unpaid fees.');
  });

  it('ignores unknown questions and yields one matter per distinct adverse answer', () => {
    expect(deriveAcceptanceMatters([ans({ questionKey: 'nonexistent', answer: 'issue' })])).toEqual(
      [],
    );
    const answers = [
      ans({ questionKey: 'el_firm', answer: 'issue' }),
      ans({ questionKey: 'el_ceiling', answer: 'issue' }),
    ];
    const derived = deriveAcceptanceMatters(answers);
    expect(derived).toHaveLength(2);
    expect(new Set(derived.map((m) => m.source)).size).toBe(derived.length);
  });
});
