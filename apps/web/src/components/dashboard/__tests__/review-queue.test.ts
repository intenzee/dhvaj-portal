import type { FilingReviewItem, ReviewPointItem, SignOffItem } from '@hsdg/contracts';
import { daysWaitingLabel, reviewItemContext } from '../review-queue';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const base = {
  id: 'x',
  engagementId: 'e1',
  engagementCode: 'ENG-1',
  engagementKind: 'compliance' as const,
  entityName: 'Bharat Textiles',
  title: 'GSTR-1',
  waitingSince: '2026-10-12T05:00:00Z',
  daysWaiting: 2,
  link: { engagementId: 'e1', engagementKind: 'compliance' as const },
};

describe('review queue panel helpers', () => {
  it('a filing review names its period and preparer', () => {
    const item: FilingReviewItem = {
      ...base,
      type: 'filing_review',
      taskId: 't1',
      preparerId: 'p',
      preparerName: 'Asha',
      dueDate: null,
      internalDate: null,
      statutoryDate: null,
      reviewStarted: false,
      reviewStartedAt: null,
      taskVersion: 1,
      filing: {
        instanceId: 'i1',
        formLabel: 'GSTR-1',
        periodLabel: 'Sep 2026',
        registrationNumber: null,
        internalDate: null,
        statutoryDate: null,
      },
    };
    expect(reviewItemContext(item)).toBe('Sep 2026 · Bharat Textiles · from Asha');
  });
  it('a review point names who raised it; a sign-off who cleared it', () => {
    const point: ReviewPointItem = {
      ...base,
      type: 'review_point',
      reviewPointId: 'rp',
      raisedById: 'm',
      raisedByName: 'Meera',
      isKeyMatter: false,
    };
    const signOff: SignOffItem = {
      ...base,
      type: 'sign_off',
      reviewModelName: 'EP',
      clearedByName: null,
    };
    expect(reviewItemContext(point)).toBe('Bharat Textiles · from Meera');
    expect(reviewItemContext(signOff)).toBe('Bharat Textiles');
  });
  it('days waiting', () => {
    expect(daysWaitingLabel(0)).toBe('today');
    expect(daysWaitingLabel(1)).toBe('1 day');
    expect(daysWaitingLabel(5)).toBe('5 days');
  });
});
