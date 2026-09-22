import { FRAMEWORK_BASELINE_STATUS, computeFrameworkGates } from '@hsdg/contracts';

const sixDecided = Array.from({ length: 6 }, () => ({ decided: true }));
const oneUndecided = [...Array.from({ length: 5 }, () => ({ decided: true })), { decided: false }];

describe('computeFrameworkGates — 02.8 two-gate approval (§9.8)', () => {
  it('1. AF-01 can confirm only when all sections are decided, profile confirmed, no blocking matter', () => {
    const g = computeFrameworkGates({
      sections: sixDecided,
      profileConfirmed: true,
      hasBlockingMatter: false,
      baselineStatus: null,
    });
    expect(g.allSectionsDecided).toBe(true);
    expect(g.canConfirm).toBe(true);
    expect(g.canApprove).toBe(false);
  });

  it('2. an undecided section blocks AF-01', () => {
    const g = computeFrameworkGates({
      sections: oneUndecided,
      profileConfirmed: true,
      hasBlockingMatter: false,
      baselineStatus: null,
    });
    expect(g.allSectionsDecided).toBe(false);
    expect(g.canConfirm).toBe(false);
  });

  it('3. an unconfirmed 02.1 profile blocks AF-01', () => {
    const g = computeFrameworkGates({
      sections: sixDecided,
      profileConfirmed: false,
      hasBlockingMatter: false,
      baselineStatus: null,
    });
    expect(g.canConfirm).toBe(false);
  });

  it('4. a blocking matter blocks both AF-01 and AF-02', () => {
    const g = computeFrameworkGates({
      sections: sixDecided,
      profileConfirmed: true,
      hasBlockingMatter: true,
      baselineStatus: FRAMEWORK_BASELINE_STATUS.managerConfirmed,
    });
    expect(g.canConfirm).toBe(false);
    expect(g.canApprove).toBe(false);
  });

  it('5. AF-02 can approve only from a Manager-confirmed baseline', () => {
    const g = computeFrameworkGates({
      sections: sixDecided,
      profileConfirmed: true,
      hasBlockingMatter: false,
      baselineStatus: FRAMEWORK_BASELINE_STATUS.managerConfirmed,
    });
    expect(g.canApprove).toBe(true);
    // Already approved → cannot re-confirm.
    expect(
      computeFrameworkGates({
        sections: sixDecided,
        profileConfirmed: true,
        hasBlockingMatter: false,
        baselineStatus: FRAMEWORK_BASELINE_STATUS.approved,
      }).canConfirm,
    ).toBe(false);
  });

  it('6. no sections at all is not "all decided"', () => {
    const g = computeFrameworkGates({
      sections: [],
      profileConfirmed: true,
      hasBlockingMatter: false,
      baselineStatus: null,
    });
    expect(g.allSectionsDecided).toBe(false);
    expect(g.canConfirm).toBe(false);
  });
});
