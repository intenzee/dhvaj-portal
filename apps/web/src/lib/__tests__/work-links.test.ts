import { financialYearOfPeriod, workItemHref, type WorkItemRef } from '@hsdg/contracts';

const E = 'e1';
const href = (ref: Partial<WorkItemRef>) =>
  workItemHref({ engagementId: E, engagementKind: 'compliance', ...ref });
const query = (url: string) => Object.fromEntries(new URL(url, 'http://x').searchParams);

describe('workItemHref — the URL rules table', () => {
  it('GST filing: tab, fy, gstin, m and part', () => {
    const url = href({
      instanceId: 'i1',
      stream: 'gst',
      financialYear: '2026-27',
      periodKey: '2026-09',
      section: 'outward',
      registrationNumber: '19AAACB1234C1Z5',
    });
    expect(url.startsWith(`/engagements/${E}?`)).toBe(true);
    expect(query(url)).toEqual({
      tab: 'gst',
      fy: '2026-27',
      gstin: '19AAACB1234C1Z5',
      m: '9',
      part: 'outward',
    });
  });

  it('a prior-year GST filing keeps its year (F3)', () => {
    expect(query(href({ instanceId: 'i1', stream: 'gst', periodKey: '2025-02' }))).toEqual({
      tab: 'gst',
      fy: '2024-25',
      m: '2',
    });
  });

  it('other stream filing: p instead of m', () => {
    expect(
      query(
        href({
          instanceId: 'i2',
          stream: 'tds',
          financialYear: '2026-27',
          periodKey: '2026-27:Q2',
          section: null,
        }),
      ),
    ).toEqual({ tab: 'tds', fy: '2026-27', p: '2026-27:Q2' });
  });

  it('task on a filing: the filing URL plus task', () => {
    expect(
      query(
        href({
          instanceId: 'i1',
          stream: 'gst',
          periodKey: '2026-09',
          section: 'inward',
          taskId: 't1',
        }),
      ),
    ).toEqual({
      tab: 'gst',
      fy: '2026-27',
      m: '9',
      part: 'inward',
      task: 't1',
    });
  });

  it('task with no filing opens the kind’s work tab', () => {
    expect(query(href({ taskId: 't1' }))).toEqual({ tab: 'services', task: 't1' });
    expect(query(href({ engagementKind: 'assignment', taskId: 't1' }))).toEqual({
      tab: 'work',
      task: 't1',
    });
    expect(query(href({ engagementKind: 'statutory_audit', taskId: 't1' }))).toEqual({
      tab: 'audit_file',
      task: 't1',
    });
  });

  it('client request on a filing: the filing URL plus request', () => {
    expect(
      query(href({ instanceId: 'i1', stream: 'gst', periodKey: '2026-09', requestId: 'd1' })),
    ).toEqual({
      tab: 'gst',
      fy: '2026-27',
      m: '9',
      request: 'd1',
    });
  });

  it('a filing with no stream falls back to the compliance tab', () => {
    expect(query(href({ instanceId: 'i1', periodKey: '2026-27' }))).toEqual({
      tab: 'compliance',
      fy: '2026-27',
      p: '2026-27',
    });
  });

  it('nothing to point at: the engagement itself', () => {
    expect(href({})).toBe(`/engagements/${E}`);
    expect(href({ requestId: 'd1' })).toBe(`/engagements/${E}?request=d1`);
  });
});

describe('financialYearOfPeriod', () => {
  it.each([
    ['2026-04', '2026-27'],
    ['2026-03', '2025-26'],
    ['2026-12', '2026-27'],
    ['2026-27', '2026-27'],
    ['2026-27:Q2', '2026-27'],
    ['2026-27-Q2', '2026-27'],
    ['FY', null],
    [null, null],
  ])('%s → %s', (key, fy) => expect(financialYearOfPeriod(key)).toBe(fy));
});
