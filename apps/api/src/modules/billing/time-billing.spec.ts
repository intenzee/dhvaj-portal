import { NO_STREAM_KEY, hoursOf, timeBillingLines, type TimeLinePick } from '@hsdg/contracts';

const pick = (entryId: string, stream: string, seconds: number): TimeLinePick => ({
  entryId,
  stream,
  streamLabel: stream === NO_STREAM_KEY ? 'No stream' : stream.toUpperCase(),
  seconds,
});

describe('PS-206 (fix) hoursOf', () => {
  it('rounds seconds to hours at two places, half up', () => {
    expect(hoursOf(5400)).toBe('1.50');
    expect(hoursOf(0)).toBe('0.00');
    expect(hoursOf(17)).toBe('0.00');
    expect(hoursOf(18)).toBe('0.01');
    expect(hoursOf(3600 * 7 + 1234)).toBe('7.34');
  });
});

describe('PS-206 (fix) timeBillingLines', () => {
  it('a line per stream of its hours at the typed rate, covering its entries', () => {
    const { lines, unpriced, tooShort } = timeBillingLines(
      [pick('a', 'roc', 1800), pick('b', 'gst', 3600), pick('c', 'gst', 1800)],
      { gst: '2000', roc: '1500.5' },
      '1 Sep 2026 to 30 Sep 2026',
    );
    expect(unpriced).toEqual([]);
    expect(tooShort).toEqual([]);
    expect(lines).toEqual([
      {
        stream: 'gst',
        description: 'GST — professional time (1 Sep 2026 to 30 Sep 2026)',
        quantity: '1.50',
        unitAmount: '2000.00',
        sortOrder: 0,
        entries: [
          { entryId: 'b', seconds: 3600 },
          { entryId: 'c', seconds: 1800 },
        ],
      },
      {
        stream: 'roc',
        description: 'ROC — professional time (1 Sep 2026 to 30 Sep 2026)',
        quantity: '0.50',
        unitAmount: '1500.50',
        sortOrder: 1,
        entries: [{ entryId: 'a', seconds: 1800 }],
      },
    ]);
  });

  it('puts time with no stream last, and leaves the period out when none is given', () => {
    const { lines } = timeBillingLines(
      [pick('a', NO_STREAM_KEY, 3600), pick('b', 'tds', 3600)],
      { [NO_STREAM_KEY]: '1000', tds: '1000' },
      '',
    );
    expect(lines.map((l) => l.stream)).toEqual(['tds', NO_STREAM_KEY]);
    expect(lines[1]!.description).toBe('No stream — professional time');
  });

  it('names streams with no rate above nil, or too little time to bill', () => {
    const { lines, unpriced, tooShort } = timeBillingLines(
      [pick('a', 'gst', 3600), pick('b', 'roc', 3600), pick('c', 'mis', 10), pick('d', 'tds', 60)],
      { gst: '0', roc: 'abc', mis: '500', tds: '-5' },
      '',
    );
    expect(lines).toEqual([]);
    expect(unpriced).toEqual(['GST', 'ROC', 'TDS']);
    expect(tooShort).toEqual(['MIS']);
  });
});
