import { baselineLine } from './planning-intelligence-facts';

describe('03.1 Engagement Intelligence — 02.8 approved baseline line (§5)', () => {
  const approval = (over: Partial<Parameters<typeof baselineLine>[0]> = {}) => ({
    everApproved: true,
    approvedVersion: '1.0',
    currentVersion: '1.0',
    reopened: false,
    planning: { route: 'approved' },
    ...over,
  });
  const by = { ep_approved_at: new Date('2026-10-01T09:30:00Z'), approved_by: 'A. Partner' };

  it('is empty before the framework is first approved', () => {
    expect(
      baselineLine(approval({ everApproved: false, approvedVersion: null }), undefined),
    ).toBeNull();
  });

  it('names the version, approver and date', () => {
    expect(baselineLine(approval(), by)).toBe('v1.0 approved by A. Partner on 2026-10-01');
  });

  it('says when Planning runs on a conditional approval', () => {
    expect(baselineLine(approval({ planning: { route: 'conditional' } }), by)).toBe(
      'v1.0 approved by A. Partner on 2026-10-01, subject to conditions',
    );
  });

  it('shows a controlled revision in progress', () => {
    expect(
      baselineLine(approval({ reopened: true, currentVersion: '1.1' }), {
        ep_approved_at: '2026-10-01T09:30:00.000Z',
        approved_by: null,
      }),
    ).toBe('v1.0 approved on 2026-10-01; controlled revision v1.1 in progress');
  });

  it('covers a file approved before the 02.8 summary existed', () => {
    expect(baselineLine(approval({ approvedVersion: null }), undefined)).toBe(
      'Approved (before the 02.8 summary existed)',
    );
  });
});
