import { isPbcOverdue, nextPbcRef, PBC_STATUS } from '@hsdg/contracts';

describe('nextPbcRef (§16)', () => {
  it('starts at PBC-001 for an empty tracker', () => {
    expect(nextPbcRef([])).toBe('PBC-001');
  });

  it('picks one past the highest existing PBC-number, zero-padded', () => {
    expect(nextPbcRef(['PBC-001', 'PBC-002', 'PBC-003'])).toBe('PBC-004');
    // Robust to gaps left by deletions.
    expect(nextPbcRef(['PBC-001', 'PBC-009'])).toBe('PBC-010');
    // Pads past three digits without truncating.
    expect(nextPbcRef(['PBC-100'])).toBe('PBC-101');
  });

  it('ignores non-conforming refs', () => {
    expect(nextPbcRef(['PBC-002', 'P3', 'foo', 'PBC-'])).toBe('PBC-003');
  });
});

describe('isPbcOverdue (§29)', () => {
  const today = '2026-09-18';

  it('is overdue when outstanding and past the due date', () => {
    expect(isPbcOverdue({ status: PBC_STATUS.requested, dueDate: '2026-09-10' }, today)).toBe(true);
    expect(
      isPbcOverdue({ status: PBC_STATUS.clarificationRequired, dueDate: '2026-09-10' }, today),
    ).toBe(true);
    // Rejected still owes a usable response, so it counts as outstanding.
    expect(isPbcOverdue({ status: PBC_STATUS.rejected, dueDate: '2026-09-10' }, today)).toBe(true);
  });

  it('is not overdue once the information is in hand or settled', () => {
    expect(isPbcOverdue({ status: PBC_STATUS.received, dueDate: '2026-09-10' }, today)).toBe(false);
    expect(isPbcOverdue({ status: PBC_STATUS.underReview, dueDate: '2026-09-10' }, today)).toBe(
      false,
    );
    expect(isPbcOverdue({ status: PBC_STATUS.accepted, dueDate: '2026-09-10' }, today)).toBe(false);
    expect(isPbcOverdue({ status: PBC_STATUS.closed, dueDate: '2026-09-10' }, today)).toBe(false);
  });

  it('is not overdue with no due date or a future due date', () => {
    expect(isPbcOverdue({ status: PBC_STATUS.requested, dueDate: null }, today)).toBe(false);
    expect(isPbcOverdue({ status: PBC_STATUS.requested, dueDate: '2026-09-30' }, today)).toBe(
      false,
    );
    // The due date itself is not yet past.
    expect(isPbcOverdue({ status: PBC_STATUS.requested, dueDate: today }, today)).toBe(false);
  });
});
