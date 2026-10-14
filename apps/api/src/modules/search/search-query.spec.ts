import { namesWork, parseSearchQuery } from './search-query';

// 14 Oct 2026: FY 2026-27.
const TODAY = '2026-10-14';
const parse = (q: string, today = TODAY) => parseSearchQuery(q, today);

describe('parseSearchQuery (WF-304)', () => {
  it('reads "bharat gstr1 sep" as a client, a form and a month of this FY', () => {
    expect(parse('bharat gstr1 sep')).toMatchObject({
      text: ['bharat'],
      forms: ['gstr1'],
      period: '2026-09',
      periodKind: 'month',
      periodLabel: 'Sep 2026',
    });
  });

  it('places Jan–Mar in the second calendar year of the FY', () => {
    expect(parse('gstr3b feb').period).toBe('2027-02');
    // In May 2027 (FY 2027-28) a bare "feb" is Feb 2028.
    expect(parse('gstr3b feb', '2027-05-01').period).toBe('2028-02');
    // …and in Feb 2027 it is still FY 2026-27.
    expect(parse('gstr3b feb', '2027-02-10').period).toBe('2027-02');
  });

  it('honours an explicit year in any spelling', () => {
    expect(parse('sep 2025').period).toBe('2025-09');
    expect(parse('sep-25').period).toBe('2025-09');
    expect(parse('sept25').period).toBe('2025-09');
    expect(parse('2025-09').period).toBe('2025-09');
    expect(parse('september 2025').text).toEqual([]);
  });

  it('places a bare month in a named FY', () => {
    expect(parse('gstr1 jan fy2025-26').period).toBe('2026-01');
    expect(parse('gstr1 jun fy25').period).toBe('2025-06');
  });

  it('normalises form spellings, split or punctuated', () => {
    expect(parse('GSTR-1').forms).toEqual(['gstr1']);
    expect(parse('gstr 3b').forms).toEqual(['gstr3b']);
    expect(parse('form 24q').forms).toEqual(['24q']);
    expect(parse('MGT-7 AOC-4').forms).toEqual(['mgt7', 'aoc4']);
    expect(parse('itr 6').forms).toEqual(['itr6']);
    expect(parse('gstr1 GSTR-1').forms).toEqual(['gstr1']);
  });

  it('reads quarters and financial years', () => {
    expect(parse('26q q2')).toMatchObject({ period: '2026-27:Q2', periodKind: 'quarter' });
    expect(parse('26q q4 2025-26')).toMatchObject({ period: '2025-26:Q4' });
    expect(parse('mgt7 fy 2025-26')).toMatchObject({
      period: '2025-26',
      periodKind: 'fy',
      periodLabel: 'FY 2025-26',
    });
    expect(parse('2025-27').period).toBeNull();
  });

  it('keeps every other word as text, without LIKE wildcards', () => {
    expect(parse('Bharat   Textiles, pvt')).toMatchObject({
      text: ['bharat', 'textiles', 'pvt'],
      forms: [],
      period: null,
    });
    expect(parse('50% off_ice').text).toEqual(['50', 'office']);
    expect(parse('19AAACB1234C1Z5').text).toEqual(['19aaacb1234c1z5']);
  });

  it('says when the query names work', () => {
    expect(namesWork(parse('bharat'))).toBe(false);
    expect(namesWork(parse('bharat sep'))).toBe(true);
    expect(namesWork(parse('gstr1'))).toBe(true);
  });
});
