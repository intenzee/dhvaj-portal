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

  it('an independence threat is a matter at its significance; significant ones block', () => {
    const ind = (questionKey: string, answer: string, details: Record<string, unknown>) =>
      deriveAcceptanceMatters([
        ans({ segmentKey: 'independence_ethics', questionKey, answer, details }),
      ])[0];
    expect(ind('ind_01', 'no', {})).toBeUndefined();
    expect(
      ind('ind_01', 'yes', {
        significance: 'low',
        conclusion: 'acceptable',
        description: 'Shares.',
      }),
    ).toMatchObject({ category: 'independence', severity: 'low', isBlocking: false });
    expect(ind('ind_02', 'yes', { significance: 'high', conclusion: 'safeguards' })).toMatchObject({
      severity: 'high',
      isBlocking: true,
    });
    expect(
      ind('ind_04', 'yes', { significance: 'low', conclusion: 'not_acceptable' }),
    ).toMatchObject({ isBlocking: true });
    const svc = ind('ind_03:5f0e', 'threat', { significance: 'medium', conclusion: 'safeguards' })!;
    expect(svc.source).toBe('acceptance:independence_ethics:ind_03:5f0e');
    expect(svc.isBlocking).toBe(false);
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

  it('01.4 answers raise matters in their spec categories', () => {
    const one = (questionKey: string, answer: string, details: Record<string, unknown> = {}) =>
      deriveAcceptanceMatters([
        ans({ segmentKey: 'acceptance_continuance', questionKey, answer, details }),
      ])[0];
    expect(one('acc_01', 'yes')).toMatchObject({ category: 'integrity', isBlocking: true });
    expect(one('acc_02', 'pending')).toMatchObject({ category: 'integrity', isBlocking: false });
    expect(one('acc_03', 'yes', { effect: 'minor' })).toMatchObject({
      category: 'scope',
      severity: 'low',
      isBlocking: false,
    });
    expect(one('acc_04', 'specialist')).toBeUndefined();
    expect(one('acc_05', 'yes')).toMatchObject({ category: 'fee', isBlocking: true });
    expect(one('acc_conclusion', 'do_not_accept', { basis: 'Integrity.' })).toMatchObject({
      severity: 'critical',
      isBlocking: true,
    });
  });

  it('01.6 preconditions raise blocking Preconditions matters', () => {
    const pre = (questionKey: string, answer: string) =>
      deriveAcceptanceMatters([ans({ segmentKey: 'audit_preconditions', questionKey, answer })])[0];
    expect(pre('pre_01', 'pending')).toBeUndefined();
    expect(pre('pre_01', 'no')).toMatchObject({ category: 'preconditions', severity: 'critical' });
    expect(pre('pre_03', 'no')).toMatchObject({ category: 'preconditions', isBlocking: true });
    expect(pre('pre_06', 'yes')).toMatchObject({ category: 'preconditions', isBlocking: true });
    expect(pre('pre_06', 'no')).toBeUndefined();
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
