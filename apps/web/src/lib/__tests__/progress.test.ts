import type { ProgressRow } from '@hsdg/contracts';
import { donePercent, holdersLine, periodRange, progressCsv, progressQuery } from '../progress';

const row = (over: Partial<ProgressRow> = {}): ProgressRow => ({
  key: 'k',
  label: 'GSTR-1 · Oct 2026',
  notStarted: 1,
  inProgress: 1,
  completed: 14,
  overdue: 1,
  waitingOnClient: 0,
  inReview: 1,
  total: 16,
  ...over,
});

describe('progress helpers (D-2)', () => {
  it('reads the period presets around today (IST dates)', () => {
    expect(periodRange('this_week', '2026-11-04')).toEqual({
      from: '2026-11-02',
      to: '2026-11-08',
    });
    expect(periodRange('this_month', '2026-11-04')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(periodRange('last_month', '2026-11-04')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(periodRange('last_month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(periodRange('this_month', '2028-02-10').to).toBe('2028-02-29');
    expect(periodRange('custom', '2026-11-04', { from: '2026-04-01', to: '2026-06-30' })).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
    });
  });

  it('leaves empty filters out of the query', () => {
    expect(
      progressQuery({
        groupBy: 'filing',
        from: '2026-11-01',
        to: '',
        officeId: '',
        overdueOnly: false,
      }),
    ).toBe('groupBy=filing&from=2026-11-01');
    expect(progressQuery({ key: 'GSTR-1|2026-10', limit: 50 })).toBe(
      'key=GSTR-1%7C2026-10&limit=50',
    );
  });

  it('says who holds a filing’s open work', () => {
    const r = row({
      holders: [
        { employeeId: 'k', fullName: 'Kirandeep', open: 2 },
        { employeeId: null, fullName: null, open: 1 },
      ],
    });
    expect(holdersLine(r)).toBe('2 with Kirandeep, 1 with no one yet');
    expect(donePercent(r)).toBe(88);
    expect(donePercent(row({ completed: 0, total: 0 }))).toBe(0);
  });

  it('exports the columns each table shows, overdue first', () => {
    const person = progressCsv('person', [row({ label: 'Kirandeep' })]);
    expect(person.headers.slice(0, 2)).toEqual(['Person', 'Overdue']);
    expect(person.rows[0]).toEqual(['Kirandeep', 1, 1, 1, 0, 1, 14, 16]);
    const client = progressCsv('client', [
      row({ label: 'Sunrise', clientName: 'Sunrise Traders', engagementLabel: 'GST · 2026-27' }),
    ]);
    expect(client.headers.slice(0, 3)).toEqual(['Client', 'Engagement', 'Overdue']);
    expect(client.rows[0]!.slice(0, 2)).toEqual(['Sunrise Traders', 'GST · 2026-27']);
    const filing = progressCsv('filing', [
      row({ holders: [{ employeeId: 'k', fullName: 'Kirandeep', open: 2 }] }),
    ]);
    expect(filing.rows[0]!.slice(0, 2)).toEqual(['GSTR-1 · Oct 2026', '2 with Kirandeep']);
  });
});
