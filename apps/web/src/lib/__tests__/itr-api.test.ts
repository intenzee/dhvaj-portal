import { PERMISSION, type ItrSeasonRow } from '@hsdg/contracts';
import { visibleNav } from '../nav';
import {
  currentItrYear,
  filterSeason,
  intimationOpensNotice,
  itrActionable,
  itrReturnHref,
  itrScopeOf,
  itrYearOf,
  normaliseAmount,
  itrSeasonPath,
  itrYearOptions,
  refundMoveNeedsAmount,
  refundMoves,
} from '../itr-api';
import type { Principal } from '../principal';

const row = (over: Partial<ItrSeasonRow>): ItrSeasonRow => ({
  instanceId: 'i1',
  returnId: null,
  engagementId: 'g1',
  engagementCode: 'ENG-001',
  entityId: 'e1',
  entityName: 'Asha Example',
  entityType: 'individual',
  pan: 'ABCPE1234F',
  itrForm: null,
  preparerName: null,
  reviewerName: null,
  workflowStatus: 'not_started',
  statutoryDate: '2026-07-31',
  requestsOpen: 0,
  stage: 'preparing',
  filedOn: null,
  ackNo: null,
  eVerifyDueOn: null,
  eVerifyOverdue: false,
  refundStatus: 'none',
  canAssign: true,
  ...over,
});

describe('ITR season year', () => {
  it('is the financial year that ended last, turning over in April', () => {
    expect(currentItrYear('2026-11-05')).toBe('2025-26');
    expect(currentItrYear('2026-03-31')).toBe('2024-25');
    expect(currentItrYear('2026-04-01')).toBe('2025-26');
    expect(itrYearOptions('2026-11-05')).toEqual(['2025-26', '2024-25', '2023-24', '2022-23']);
  });
  it('builds the season path, leaving the default scope out', () => {
    expect(itrSeasonPath('2025-26', 'all')).toBe('/itr/season?financialYear=2025-26');
    expect(itrSeasonPath('2025-26', 'mine')).toBe('/itr/season?financialYear=2025-26&scope=mine');
    expect(itrReturnHref('r1')).toBe('/itr/r1');
  });
});

describe('the season grid', () => {
  const rows = [
    row({ instanceId: 'a', entityName: 'Asha Example' }),
    row({
      instanceId: 'b',
      entityName: 'Bharat HUF',
      pan: 'AAAHB1234C',
      stage: 'awaiting_verification',
      ackNo: '123456789012345',
      eVerifyOverdue: true,
      canAssign: false,
    }),
    row({ instanceId: 'c', entityName: 'Chitra Traders', stage: 'verified' }),
  ];

  it('filters by stage, overdue e-verification, and client / PAN / ack no.', () => {
    const f = { search: '', stage: '' as const, overdue: false };
    expect(filterSeason(rows, f)).toHaveLength(3);
    expect(filterSeason(rows, { ...f, stage: 'verified' }).map((r) => r.instanceId)).toEqual(['c']);
    expect(filterSeason(rows, { ...f, overdue: true }).map((r) => r.instanceId)).toEqual(['b']);
    expect(filterSeason(rows, { ...f, search: 'aaahb' }).map((r) => r.instanceId)).toEqual(['b']);
    expect(filterSeason(rows, { ...f, search: '12345678901' }).map((r) => r.instanceId)).toEqual([
      'b',
    ]);
  });

  it('assigns only where the caller may, and reminds only returns not filed', () => {
    const all = new Set(['a', 'b', 'c']);
    expect(itrActionable(rows, all, 'assign')).toEqual(['a', 'c']);
    expect(itrActionable(rows, all, 'remind')).toEqual(['a']);
    expect(itrActionable(rows, new Set(['b']), 'remind')).toEqual([]);
  });
});

describe('refund moves', () => {
  it('follows the refund from claimed to settled', () => {
    expect(refundMoves('issued')).toEqual([]);
    expect(refundMoves('pending')).toEqual(
      expect.arrayContaining(['issued', 'adjusted', 'failed']),
    );
    expect(refundMoveNeedsAmount('issued')).toBe(true);
    expect(refundMoveNeedsAmount('failed')).toBe(false);
  });
});

describe('the ITR desk in the sidebar', () => {
  const principal: Principal = {
    userId: 'u',
    email: 'x@dhvaj.in',
    displayName: 'X',
    officeId: 'o',
    officeCode: 'NORTH',
    employeeId: 'e',
    roles: [],
    effectiveRole: undefined,
    permissions: [PERMISSION.engagementRead],
    mfaRequired: false,
    mfaSatisfied: false,
  };
  const hrefs = (itrDesk: boolean): string[] =>
    visibleNav(principal, { itrDesk }).map((i) => i.href);

  it('shows only while ff_itr_desk is on', () => {
    expect(hrefs(true)).toContain('/itr');
    expect(hrefs(false)).not.toContain('/itr');
  });
});

describe('ITR desk inputs', () => {
  it('reads amounts as typed, in the API shape', () => {
    expect(normaliseAmount('15,000')).toBe('15000');
    expect(normaliseAmount(' ₹ 1,20,000.50 ')).toBe('120000.50');
    expect(normaliseAmount('Rs. 9100')).toBe('9100');
    expect(normaliseAmount('12.345')).toBeNull();
    expect(normaliseAmount('-5')).toBeNull();
    expect(normaliseAmount('')).toBeNull();
  });

  it('never sends a bad scope or year from the URL', () => {
    expect(itrScopeOf('mine')).toBe('mine');
    expect(itrScopeOf('everyone')).toBe('all');
    expect(itrScopeOf(null)).toBe('all');
    expect(itrYearOf('2024-25', '2026-11-05')).toBe('2024-25');
    expect(itrYearOf('2024-26', '2026-11-05')).toBe('2025-26');
    expect(itrYearOf('x', '2026-11-05')).toBe('2025-26');
  });

  it('opens a notice by default only for a demand or a 245 set-off', () => {
    expect(intimationOpensNotice('143_1', 'demand')).toBe(true);
    expect(intimationOpensNotice('143_1', 'refund')).toBe(false);
    expect(intimationOpensNotice('143_1', 'no_change')).toBe(false);
    expect(intimationOpensNotice('245', 'no_change')).toBe(true);
  });
});
