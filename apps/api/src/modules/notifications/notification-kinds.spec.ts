import {
  NOTIFICATION_KIND,
  NOTIFICATION_TYPE_KIND,
  NOTIFICATION_TYPE_LABEL,
  NOTIFICATION_TYPES,
  notificationDelivery,
} from '@hsdg/contracts';
import { previousDay } from './notification-digest.scheduler';

describe('notification kinds (WF-305)', () => {
  it('classifies and names all 38 types', () => {
    expect(NOTIFICATION_TYPES).toHaveLength(38);
    for (const t of NOTIFICATION_TYPES) {
      expect(Object.values(NOTIFICATION_KIND)).toContain(NOTIFICATION_TYPE_KIND[t]);
      expect(NOTIFICATION_TYPE_LABEL[t]).toBeTruthy();
    }
  });

  it('asks for action on reviews, returns and overdue work; only informs on heads-ups', () => {
    expect(NOTIFICATION_TYPE_KIND.task_review_requested).toBe('actionable');
    expect(NOTIFICATION_TYPE_KIND.task_returned).toBe('actionable');
    expect(NOTIFICATION_TYPE_KIND.statutory_deadline_overdue).toBe('actionable');
    expect(NOTIFICATION_TYPE_KIND.statutory_deadline_approaching).toBe('informational');
    expect(NOTIFICATION_TYPE_KIND.filing_lodged).toBe('informational');
  });

  it('sends actionable types to the bell whatever was chosen; informational to the digest by default', () => {
    expect(notificationDelivery('task_returned', 'off')).toBe('bell');
    expect(notificationDelivery('filing_lodged')).toBe('digest');
    expect(notificationDelivery('filing_lodged', 'bell')).toBe('bell');
    expect(notificationDelivery('filing_lodged', 'off')).toBe('off');
  });

  it('digests the IST day before', () => {
    expect(previousDay('2026-10-14')).toBe('2026-10-13');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });
});
