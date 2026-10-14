import { workItemHref } from '@hsdg/contracts';
import {
  workFilingContextOf,
  workLinkFilingOf,
  workLinkOf,
  type WorkLinkSqlRow,
} from './work-links';

const row = (over: Partial<WorkLinkSqlRow>): WorkLinkSqlRow => ({
  wl_instance_id: 'i1',
  wl_stream: 'gst',
  wl_financial_year: '2026-27',
  wl_period_key: '2026-09',
  wl_section: 'outward',
  wl_reference_month: '2026-09',
  wl_registration_number: '19AAACB1234C1Z5',
  wl_form_label: 'GSTR-1',
  wl_internal_date: '2026-10-09',
  wl_statutory_date: '2026-10-11',
  ...over,
});
const base = { engagementId: 'e1', engagementKind: 'compliance' as const, taskId: 't1' };

describe('workLinkOf', () => {
  it('carries the filing, task and request', () => {
    expect(workLinkOf({ ...base, requestId: 'd1' }, workLinkFilingOf(row({})))).toEqual({
      engagementId: 'e1',
      engagementKind: 'compliance',
      instanceId: 'i1',
      stream: 'gst',
      financialYear: '2026-27',
      periodKey: '2026-09',
      section: 'outward',
      registrationNumber: '19AAACB1234C1Z5',
      taskId: 't1',
      requestId: 'd1',
    });
  });

  it('a row with no filing keeps only its engagement and task', () => {
    expect(workLinkOf(base, workLinkFilingOf(row({ wl_instance_id: null })))).toEqual(base);
  });

  it('a legacy GST filing with no period key opens its reference month', () => {
    const ref = workLinkOf(
      base,
      workLinkFilingOf(row({ wl_period_key: null, wl_financial_year: null })),
    );
    expect(ref.periodKey).toBe('2026-09');
    const url = new URL(workItemHref(ref), 'http://x');
    expect(url.searchParams.get('m')).toBe('9');
    expect(url.searchParams.get('fy')).toBe('2026-27');
  });

  it('a legacy non-GST filing does not guess a period', () => {
    const ref = workLinkOf(base, workLinkFilingOf(row({ wl_stream: 'tds', wl_period_key: null })));
    expect(ref.periodKey).toBeNull();
  });
});

describe('workFilingContextOf', () => {
  it('labels the period, falling back to the reference month', () => {
    expect(workFilingContextOf(row({ wl_period_key: null }))?.periodLabel).toBe(
      workFilingContextOf(row({}))?.periodLabel,
    );
    expect(workFilingContextOf(row({ wl_instance_id: null }))).toBeNull();
  });
});
