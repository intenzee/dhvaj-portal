import { BadRequestException } from '@nestjs/common';
import { fyMonthKeys, priorFiledChoices, priorFiledCovers } from '@hsdg/contracts';
import { normalisePriorFiled } from './prior-filed.service';

describe('fyMonthKeys', () => {
  it('runs April to March across the calendar year', () => {
    const keys = fyMonthKeys('2026-27');
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe('2026-04');
    expect(keys[8]).toBe('2026-12');
    expect(keys[11]).toBe('2027-03');
  });
});

describe('priorFiledChoices', () => {
  it('offers GST by month, with the annual returns', () => {
    const { periods, annual } = priorFiledChoices('gst', '2026-27');
    expect(periods).toHaveLength(12);
    expect(periods[0]).toMatchObject({ tokens: ['2026-04'], firstMonth: '2026-04' });
    expect(annual).toMatchObject({ tokens: ['FY:2026-27'], firstMonth: '2027-03' });
  });

  it('offers TDS by quarter, each quarter its three months', () => {
    const { periods } = priorFiledChoices('tds', '2026-27');
    expect(periods).toHaveLength(4);
    expect(periods[0]!.tokens).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(periods[3]).toMatchObject({
      tokens: ['2027-01', '2027-02', '2027-03'],
      firstMonth: '2027-01',
    });
  });

  it('has no annual choice for a stream without annual returns', () => {
    expect(priorFiledChoices('bookkeeping', '2026-27').annual).toBeNull();
  });
});

describe('priorFiledCovers', () => {
  const covers = (tokens: string[], f: Parameters<typeof priorFiledCovers>[1]) =>
    priorFiledCovers(new Set(tokens), f);
  const month = {
    periodKey: '2026-05',
    financialYear: '2026-27',
    periodStart: '2026-05-01',
    periodEnd: '2026-05-31',
  };
  const quarter = {
    periodKey: '2026-27:Q1',
    financialYear: '2026-27',
    periodStart: '2026-04-01',
    periodEnd: '2026-06-30',
  };

  it('covers a month that is ticked', () => {
    expect(covers(['2026-05'], month)).toBe(true);
    expect(covers(['2026-04'], month)).toBe(false);
  });

  it('covers a quarter only when all three of its months are ticked', () => {
    expect(covers(['2026-04', '2026-05', '2026-06'], quarter)).toBe(true);
    expect(covers(['2026-04', '2026-05'], quarter)).toBe(false);
  });

  it('covers the year’s returns only with its FY token', () => {
    const annual = {
      periodKey: '2026-27',
      financialYear: '2026-27',
      periodStart: '2026-04-01',
      periodEnd: '2027-03-31',
    };
    expect(covers(fyMonthKeys('2026-27'), annual)).toBe(false);
    expect(covers(['FY:2026-27'], annual)).toBe(true);
    expect(covers(['FY:2025-26'], annual)).toBe(false);
  });

  it('never covers an event or a filing without a period', () => {
    expect(covers(['2026-05'], { ...month, periodKey: 'EVT:abc' })).toBe(false);
    expect(covers(['2026-05'], { ...month, periodKey: null })).toBe(false);
  });
});

describe('normalisePriorFiled', () => {
  it('passes nothing through as nothing', () => {
    expect(normalisePriorFiled(undefined)).toEqual({});
    expect(normalisePriorFiled(null)).toEqual({});
  });

  it('de-duplicates and drops empty streams', () => {
    expect(
      normalisePriorFiled({ gst: ['2026-04', '2026-04', 'FY:2026-27'], tds: [] }, ['gst', 'tds']),
    ).toEqual({ gst: ['2026-04', 'FY:2026-27'] });
  });

  it.each([
    [{ gst: ['2026-13'] }, /not a period/],
    [{ gst: ['2011-12-01'] }, /not a period/],
    [{ gst: '2026-04' }, /list of periods/],
    [{ nope: ['2026-04'] }, /unknown stream/],
    [['2026-04'], /\{stream: periods\}/],
  ])('rejects %j', (input, message) => {
    expect(() => normalisePriorFiled(input)).toThrow(BadRequestException);
    expect(() => normalisePriorFiled(input)).toThrow(message);
  });

  it('rejects a stream that is not in scope', () => {
    expect(() => normalisePriorFiled({ tds: ['2026-04'] }, ['gst'])).toThrow(
      /not a stream in scope/,
    );
  });

  it('caps the number of periods', () => {
    const many = Array.from(
      { length: 401 },
      (_, i) => `FY:${1600 + i}-${String((i + 1) % 100).padStart(2, '0')}`,
    );
    expect(() => normalisePriorFiled({ gst: many })).toThrow(/too many/);
  });
});
