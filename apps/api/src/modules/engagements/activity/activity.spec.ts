import { BadRequestException } from '@nestjs/common';
import { activityTitle, decodeCursor, encodeCursor, formatDuration } from './activity.service';

describe('activity helpers', () => {
  it('round-trips a full-precision cursor and rejects junk', () => {
    const c = encodeCursor('2026-10-12 09:15:02.123456+00', 'filing_lodged:abc');
    expect(decodeCursor(c)).toEqual({
      at: '2026-10-12 09:15:02.123456+00',
      id: 'filing_lodged:abc',
    });
    expect(() => decodeCursor('not-a-cursor')).toThrow(BadRequestException);
    expect(() => decodeCursor(Buffer.from('["yesterday","x"]').toString('base64url'))).toThrow(
      BadRequestException,
    );
  });

  it('formats durations', () => {
    expect(formatDuration(45 * 60)).toBe('45m');
    expect(formatDuration(2 * 3600)).toBe('2h');
    expect(formatDuration(2 * 3600 + 15 * 60)).toBe('2h 15m');
  });

  it('titles each kind', () => {
    expect(
      activityTitle('filing_lodged', 'GSTR-3B', {
        periodKey: '2026-09',
        referenceKind: 'arn',
        referenceNo: 'AA1909261234567',
      }),
    ).toBe('GSTR-3B Sep 2026 filed — ARN AA1909261234567');
    expect(activityTitle('filing_lodged', 'GSTR-1', { periodKey: '2026-09', isNil: true })).toBe(
      'GSTR-1 Sep 2026 filed (Nil)',
    );
    expect(activityTitle('filing_waived', 'AOC-4', { periodKey: '2026-27' })).toBe(
      'AOC-4 FY 2026-27 marked not applicable',
    );
    expect(
      activityTitle('task_event', 'Prepare 3B', { from: 'in_progress', to: 'in_review' }),
    ).toBe('Prepare 3B: In progress → In review');
    expect(activityTitle('task_event', 'Prepare 3B', { from: null, to: 'todo' })).toBe(
      'Prepare 3B: To do',
    );
    expect(activityTitle('document_uploaded', 'Sales register', { viaClientUpload: true })).toBe(
      'Client uploaded Sales register',
    );
    expect(activityTitle('dependency_closed', 'Bank statement', { status: 'received' })).toBe(
      'Client request received: Bank statement',
    );
    expect(activityTitle('time_day', '2026-10-12', { seconds: 5400 })).toBe('1h 30m recorded');
    expect(activityTitle('comment', 'Hello', {})).toBe('Hello');
  });
});
