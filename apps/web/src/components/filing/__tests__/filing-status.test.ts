import { filingEnd, filingStatusLabel } from '../filing-status';

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
