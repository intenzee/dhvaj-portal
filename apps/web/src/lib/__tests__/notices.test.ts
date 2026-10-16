import type { NoticeListItem, NoticesReport } from '@hsdg/contracts';
import {
  DEFAULT_NOTICE_FILTERS,
  addDaysIso,
  clockBadge,
  defaultReplyDue,
  emptyNoticeForm,
  intakePrefill,
  isStaleNotice,
  noticeFiltersFrom,
  noticeFiltersPatch,
  noticeListPath,
  noticesReportCsv,
  toCreateNoticeRequest,
} from '../notices';

const TODAY = '2026-10-16';
const params = (q: string) => {
  const p = new URLSearchParams(q);
  return (k: string) => p.get(k);
};
const query = (path: string) => Object.fromEntries(new URLSearchParams(path.split('?')[1]));

describe('notice list filters → GET /notices', () => {
  it('defaults to open notices, anyone, any date', () => {
    expect(noticeFiltersFrom(params(''))).toEqual(DEFAULT_NOTICE_FILTERS);
    expect(noticeListPath(DEFAULT_NOTICE_FILTERS, TODAY)).toBe('/notices?status=open&limit=50');
  });

  it('maps stream, status, owner, due and search', () => {
    const f = noticeFiltersFrom(
      params('stream=gst&status=hearing_scheduled&owner=me&due=7&q=DIN123'),
    );
    expect(query(noticeListPath(f, TODAY))).toEqual({
      status: 'hearing_scheduled',
      stream: 'gst',
      ownerId: 'me',
      dueBefore: '2026-10-23',
      search: 'DIN123',
      limit: '50',
    });
  });

  it('due in 30 days crosses the month; every status drops the status param', () => {
    const f = { ...DEFAULT_NOTICE_FILTERS, status: 'all' as const, due: '30' as const };
    expect(query(noticeListPath(f, TODAY))).toEqual({ dueBefore: '2026-11-15', limit: '50' });
  });

  it('passes the cursor for "Load more"', () => {
    expect(
      query(noticeListPath(DEFAULT_NOTICE_FILTERS, TODAY, { cursor: 'abc', limit: 20 })),
    ).toEqual({
      status: 'open',
      cursor: 'abc',
      limit: '20',
    });
  });

  it('ignores unknown values in the URL', () => {
    expect(noticeFiltersFrom(params('stream=vat&status=lost&owner=you&due=12'))).toEqual(
      DEFAULT_NOTICE_FILTERS,
    );
  });

  it('round-trips through the URL patch, dropping defaults', () => {
    expect(noticeFiltersPatch(DEFAULT_NOTICE_FILTERS)).toEqual({
      status: null,
      stream: null,
      owner: null,
      due: null,
      q: null,
    });
    const f = {
      status: 'closed' as const,
      stream: 'tds' as const,
      owner: 'me' as const,
      due: '7' as const,
      search: ' x ',
    };
    const patch = noticeFiltersPatch(f);
    const qs = new URLSearchParams(
      Object.entries(patch).filter(([, v]) => v) as [string, string][],
    );
    expect(noticeFiltersFrom((k) => qs.get(k))).toEqual({ ...f, search: 'x' });
  });

  it('adds days across month and year ends', () => {
    expect(addDaysIso('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDaysIso('2028-02-27', 2)).toBe('2028-02-29');
  });
});

describe('clockBadge', () => {
  it('is null without a clock', () => {
    expect(clockBadge(null)).toBeNull();
    expect(clockBadge(undefined)).toBeNull();
  });

  it('is red when overdue', () => {
    expect(
      clockBadge({ due: '2026-10-13', label: 'Reply due', daysLeft: -3, overdue: true }),
    ).toEqual({
      label: 'Reply due',
      date: '13 Oct 2026',
      left: '3 days overdue',
      tone: 'danger',
    });
    expect(
      clockBadge({ due: '2026-10-15', label: 'Hearing', daysLeft: -1, overdue: true })!.left,
    ).toBe('1 day overdue');
  });

  it('reads "due today" on the day, amber', () => {
    expect(clockBadge({ due: TODAY, label: 'Hearing', daysLeft: 0, overdue: false })).toMatchObject(
      {
        left: 'due today',
        tone: 'warn',
      },
    );
  });

  it('counts down when upcoming, quieter further out', () => {
    expect(
      clockBadge({ due: '2026-10-17', label: 'Appeal by', daysLeft: 1, overdue: false }),
    ).toMatchObject({
      left: '1 day left',
      tone: 'warn',
    });
    expect(
      clockBadge({ due: '2026-10-22', label: 'Reply due', daysLeft: 6, overdue: false })!.tone,
    ).toBe('info');
    expect(
      clockBadge({ due: '2026-12-01', label: 'Appeal by', daysLeft: 46, overdue: false }),
    ).toMatchObject({
      left: '46 days left',
      tone: 'neutral',
    });
  });
});

describe('intakePrefill (PS-104)', () => {
  const s = (value: string, confidence: number, snippet: string | null = null) => ({
    value,
    confidence,
    snippet,
  });

  it('pre-fills at 0.5 and above, flags below 0.8 with the snippet, hints below 0.5', () => {
    const p = intakePrefill({
      fields: {
        referenceNo: s('ZA0710260012345', 0.95, 'Reference No.: ZA0710260012345'),
        issuedOn: s('2026-10-07', 0.8),
        replyDueOn: s('2026-11-06', 0.79, 'reply within 30 days'),
        amountDemanded: s('1,25,000.00', 0.5, 'Rs. 1,25,000'),
        financialYear: s('2024-25', 0.49, 'F.Y. 2024-25'),
        gstin: s('27AAAPL1234C1ZV', 0.99, 'GSTIN 27AAAPL1234C1ZV'),
        form: s('ASMT-10', 0.9),
      },
      noticeTypeCode: s('GST_ASMT_10', 0.6, 'FORM GST ASMT-10'),
    });
    expect(p.values).toEqual({
      referenceNo: 'ZA0710260012345',
      issuedOn: '2026-10-07',
      replyDueOn: '2026-11-06',
      amountDemanded: '125000.00',
      noticeTypeCode: 'GST_ASMT_10',
    });
    expect(Object.keys(p.check).sort()).toEqual(['amountDemanded', 'noticeTypeCode', 'replyDueOn']);
    expect(p.check.replyDueOn!.snippet).toBe('reply within 30 days');
    // 0.8 is confident enough not to flag.
    expect(p.check.issuedOn).toBeUndefined();
    expect(p.values.financialYear).toBeUndefined();
    expect(p.unsure.financialYear).toEqual({
      value: '2024-25',
      confidence: 0.49,
      snippet: 'F.Y. 2024-25',
    });
    // GSTIN and form are shown, never put in a form field.
    expect(p.read.gstin!.value).toBe('27AAAPL1234C1ZV');
    expect(p.read.form!.value).toBe('ASMT-10');
    expect('gstin' in p.values).toBe(false);
  });

  it('is empty when nothing was read', () => {
    expect(intakePrefill({ fields: {}, noticeTypeCode: null })).toEqual({
      values: {},
      check: {},
      unsure: {},
      read: {},
    });
  });
});

describe('the create request', () => {
  it('drops blanks, strips ₹ grouping, and carries the PDF', () => {
    const v = {
      ...emptyNoticeForm(TODAY),
      engagementId: 'eng-1',
      noticeTypeCode: 'IT_143_2',
      referenceNo: ' ITBA/AST/S/143(2)/2026 ',
      issuedOn: '2026-10-01',
      amountDemanded: '₹ 1,25,000',
      replyDueOn: '2026-10-31',
    };
    expect(toCreateNoticeRequest(v, 'doc-1')).toEqual({
      engagementId: 'eng-1',
      noticeTypeCode: 'IT_143_2',
      referenceNo: 'ITBA/AST/S/143(2)/2026',
      issuedOn: '2026-10-01',
      receivedOn: TODAY,
      servedVia: 'portal',
      amountDemanded: '125000',
      replyDueOn: '2026-10-31',
      documentId: 'doc-1',
    });
  });

  it('reply due defaults from the type', () => {
    expect(defaultReplyDue('2026-10-01', 30)).toBe('2026-10-31');
    expect(defaultReplyDue('2026-10-01', null)).toBe('');
    expect(defaultReplyDue('', 30)).toBe('');
  });
});

describe('isStaleNotice', () => {
  it('treats a 409 as a stale copy unless it is a duplicate', () => {
    expect(isStaleNotice(409, 'This notice changed; refresh and retry.')).toBe(true);
    expect(isStaleNotice(409, 'A notice with this reference already exists for the client.')).toBe(
      false,
    );
    expect(isStaleNotice(400, 'Bad')).toBe(false);
  });
});

describe('noticesReportCsv (PS-105)', () => {
  const due: NoticeListItem = {
    id: 'n1',
    entityId: 'e1',
    entityName: 'Acme, Pvt "Ltd"',
    engagementId: 'g1',
    engagementCode: 'CMP-001',
    registrationNumber: null,
    noticeType: {
      id: 't',
      code: 'GST_ASMT_10',
      stream: 'gst',
      form: 'ASMT-10',
      section: 's.61',
      title: 'Scrutiny',
      appealable: false,
    },
    referenceNo: 'ZA07',
    issuedOn: '2026-10-01',
    receivedOn: '2026-10-02',
    financialYear: '2024-25',
    assessmentYear: null,
    amountDemanded: '50000.00',
    ownerId: 'o',
    ownerName: 'Asha',
    reviewerId: null,
    reviewerName: null,
    outcome: null,
    version: 1,
    status: 'received',
    internalDueOn: '2026-10-20',
    replyDueOn: '2026-10-23',
    nextHearingOn: null,
    appealDueOn: null,
    clock: { due: '2026-10-20', label: 'Reply due', daysLeft: 4, overdue: false },
  };
  const report: NoticesReport = {
    asOf: TODAY,
    open: {
      total: 3,
      amountDemanded: '150000.00',
      byStream: [
        { stream: 'gst', count: 2, amountDemanded: '100000.00' },
        { stream: 'income_tax', count: 1, amountDemanded: '50000.00' },
      ],
      byStatus: [{ status: 'received', count: 3 }],
      byOffice: [{ officeId: 'o1', officeName: 'Delhi', count: 3, amountDemanded: '150000.00' }],
    },
    dueSoon: [due],
    closed: {
      count: 1,
      amountDemanded: '80000.00',
      outcomeAmount: '20000.00',
      byOutcome: [
        {
          outcome: 'demand_reduced',
          count: 1,
          amountDemanded: '80000.00',
          outcomeAmount: '20000.00',
        },
      ],
    },
    avgDaysToReply: 12.345,
  };

  it('lays every table out under a Section column', () => {
    const { headers, rows } = noticesReportCsv(report);
    expect(headers).toEqual([
      'Section',
      'Group',
      'Count',
      'Amount demanded',
      'Outcome amount',
      'Due',
      'Clock',
    ]);
    expect(rows).toEqual([
      ['Open', 'Total', 3, '150000.00', null, null, null],
      ['Open by stream', 'GST', 2, '100000.00', null, null, null],
      ['Open by stream', 'Income tax', 1, '50000.00', null, null, null],
      ['Open by status', 'Received', 3, null, null, null, null],
      ['Open by office', 'Delhi', 3, '150000.00', null, null, null],
      ['Closed', 'Total', 1, '80000.00', '20000.00', null, null],
      ['Closed by outcome', 'Demand reduced', 1, '80000.00', '20000.00', null, null],
      [
        'Due in 7 days',
        'Acme, Pvt "Ltd" · ASMT-10 · s.61 · Scrutiny · ZA07',
        1,
        '50000.00',
        null,
        '2026-10-20',
        'Reply due',
      ],
      ['Average days to reply', 'All', 12.3, null, null, null, null],
    ]);
  });

  it('leaves the average blank when nothing has been replied to', () => {
    const { rows } = noticesReportCsv({ ...report, avgDaysToReply: null, dueSoon: [] });
    expect(rows[rows.length - 1]).toEqual([
      'Average days to reply',
      'All',
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
