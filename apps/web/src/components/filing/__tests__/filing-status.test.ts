import { formatDate } from '@/lib/format';
import { boardMeetingsText, filingEnd, filingStatusLabel } from '../filing-status';

describe('filing end-state wording', () => {
  it('a return is lodged and Filed', () => {
    expect(filingEnd('gst', 'outward')).toMatchObject({ action: 'Lodge filing', done: 'Filed' });
    expect(filingEnd('tds', null).done).toBe('Filed');
    expect(filingStatusLabel('ready_to_file', 'gst', 'summary')).toBe('Ready to file');
  });

  it('Inward, Bookkeeping and MIS end inside the firm', () => {
    expect(filingEnd('gst', 'inward')).toMatchObject({ action: 'Mark reconciled', done: 'Reconciled' });
    expect(filingStatusLabel('filed', 'bookkeeping', null)).toBe('Books closed');
    expect(filingStatusLabel('ready_to_file', 'mis', null)).toBe('Ready to send');
    expect(filingStatusLabel('in_review', 'mis', null)).toBe('In review');
  });

  it('a meeting is recorded as Held (spec P1-2)', () => {
    expect(filingEnd('roc', null, 'ROC_BOARD_MEETING')).toEqual({
      action: 'Record meeting',
      done: 'Held',
      ready: 'Ready to record',
    });
    expect(filingStatusLabel('filed', 'roc', null, 'ROC_AGM')).toBe('Held');
    expect(filingStatusLabel('filed', 'roc', null, 'ROC_AOC4')).toBe('Filed');
  });
});

describe('MGT-7 meetings line', () => {
  it('lists the FY’s held board meetings, of how many', () => {
    expect(
      boardMeetingsText({ financialYear: '2025-26', heldOn: ['2025-05-12', '2025-08-14'], total: 4 }),
    ).toBe(
      `Board meetings FY 2025-26: held ${formatDate('2025-05-12')}, ${formatDate('2025-08-14')} — 2 of 4 recorded`,
    );
    expect(boardMeetingsText({ financialYear: '2025-26', heldOn: [], total: 2 })).toBe(
      'Board meetings FY 2025-26: none held yet — 0 of 2 recorded',
    );
    expect(boardMeetingsText({ financialYear: '2025-26', heldOn: [], total: 0 })).toMatch(
      /No board meetings tracked for FY 2025-26/,
    );
  });
});
