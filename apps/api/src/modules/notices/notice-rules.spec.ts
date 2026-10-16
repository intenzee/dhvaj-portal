import { BadRequestException } from '@nestjs/common';
import {
  addDaysIso,
  decodeNoticeCursor,
  defaultReplyDue,
  encodeNoticeCursor,
  replayNoticeEvents,
} from './notice-rules';

const ID = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';

describe('notice list cursor', () => {
  it('round-trips a dated and an undated position', () => {
    expect(decodeNoticeCursor(encodeNoticeCursor('2026-10-20', ID))).toEqual({
      due: '2026-10-20',
      id: ID,
    });
    expect(decodeNoticeCursor(encodeNoticeCursor(null, ID))).toEqual({ due: null, id: ID });
  });

  it('rejects anything it did not make', () => {
    expect(() => decodeNoticeCursor('not-a-cursor')).toThrow(BadRequestException);
    const bad = Buffer.from(JSON.stringify(['20-10-2026', ID])).toString('base64url');
    expect(() => decodeNoticeCursor(bad)).toThrow(BadRequestException);
    const badId = Buffer.from(JSON.stringify([null, "x' OR 1=1"])).toString('base64url');
    expect(() => decodeNoticeCursor(badId)).toThrow(BadRequestException);
  });
});

describe('default reply date', () => {
  it('is issued + the type’s days, across a month and a year end', () => {
    expect(defaultReplyDue('2026-10-01', 30)).toBe('2026-10-31');
    expect(defaultReplyDue('2026-12-20', 15)).toBe('2027-01-04');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('is empty when the type has no default', () => {
    expect(defaultReplyDue('2026-10-01', null)).toBeNull();
  });
});

describe('replayNoticeEvents (after a void)', () => {
  it('starts from received when nothing is left', () => {
    expect(replayNoticeEvents([], 'reply_filed')).toEqual({
      status: 'received',
      nextHearingOn: null,
    });
  });

  it('keeps a hand-set "in progress" when nothing since says otherwise', () => {
    expect(replayNoticeEvents([{ kind: 'note', nextDate: null }], 'in_progress').status).toBe(
      'in_progress',
    );
  });

  it('follows the remaining events in order, the last hearing winning', () => {
    expect(
      replayNoticeEvents(
        [
          { kind: 'reply_filed', nextDate: null },
          { kind: 'hearing', nextDate: '2026-11-05' },
          { kind: 'adjournment_granted', nextDate: '2026-11-20' },
        ],
        'order_received',
      ),
    ).toEqual({ status: 'hearing_scheduled', nextHearingOn: '2026-11-20' });
  });

  it('a submission moves a fresh notice to in progress only', () => {
    expect(replayNoticeEvents([{ kind: 'submission', nextDate: null }], 'received').status).toBe(
      'in_progress',
    );
    expect(
      replayNoticeEvents(
        [
          { kind: 'reply_filed', nextDate: null },
          { kind: 'submission', nextDate: null },
        ],
        'reply_filed',
      ).status,
    ).toBe('reply_filed');
  });

  it('leaves an appealed or finished notice where it is', () => {
    expect(replayNoticeEvents([], 'appealed').status).toBe('appealed');
    expect(replayNoticeEvents([], 'closed').status).toBe('closed');
  });
});
