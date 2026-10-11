import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  FrameworkBaselineRecord,
  FrameworkCompletionCheck,
  FrameworkSummaryMatter,
  StatutoryAuditFrameworkSummary,
} from '@hsdg/contracts';
import {
  ApprovedFrameworkBanner,
  FRAMEWORK_REOPEN_EVENT,
  FrameworkSummaryApproval,
} from '../framework-summary-approval';
import {
  FRAMEWORK_MATTERS_ANCHOR,
  FrameworkDashboard,
  FrameworkSummaryHeaderCard,
} from '../framework-summary-workspace';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const CHECK_KEYS: FrameworkCompletionCheck['key'][] = [
  'sections_complete',
  'conclusions_exist',
  'no_blocking_matter',
  'overrides_documented',
  'consultations_complete',
  'preview_reviewed',
  'manager_confirmed',
  'memo_submitted',
  'partner_approved',
  'versions_stored',
];

const baseline = (over: Partial<FrameworkBaselineRecord> = {}): FrameworkBaselineRecord => ({
  id: 'b1',
  version: '1.0',
  status: 'draft',
  methodologyVersion: null,
  previewReviewedByName: null,
  previewReviewedAt: null,
  managerConfirmedByName: null,
  managerConfirmedAt: null,
  managerNote: null,
  epApprovedByName: null,
  epApprovedAt: null,
  epDecision: null,
  memoDocumentId: null,
  reopen: null,
  recordVersion: 3,
  ...over,
});

function summary(over: Partial<StatutoryAuditFrameworkSummary> = {}): StatutoryAuditFrameworkSummary {
  return {
    workflowInstanceId: 'wf1',
    engagementServiceId: 'es1',
    engagementId: 'e1',
    header: {
      status: 'ready_for_manager_review',
      preparedByName: 'Asha',
      engagementManagerName: 'Manoj',
      engagementPartnerName: 'Priya',
      periodLabel: 'FY 2025-26 · 01 Apr 2025 – 31 Mar 2026',
      frameworkVersion: 'Draft v1.0',
      methodologyVersion: 'DHVAJ Statutory Audit Methodology v1.0',
      openMatterCount: 0,
      blockingMatterCount: 0,
      viewerIsPartner: false,
      viewerIsManager: true,
    },
    profileConfirmed: true,
    dashboard: [
      {
        section: '02.4',
        title: 'CARO 2020',
        conclusion: 'CARO 2020 Applicable',
        detail: null,
        status: 'attention_required',
        attention: ['Returned (AF-01): Fix clause (vii)'],
        state: 'applicable',
        decided: true,
        isOverridden: false,
        ruleVersionId: null,
        anchor: 'framework-02-4',
      },
    ],
    sections: [],
    triggeredRequirements: [],
    downstreamPreview: [
      {
        key: 'caro_programme',
        item: 'CARO programme',
        result: 'Required',
        action: 'activate',
        source: '02.4',
        ruleKey: 'caro',
      },
    ],
    matters: [],
    priorYear: {
      available: false,
      reason: 'Initial audit',
      priorEngagementId: null,
      priorPeriodLabel: null,
      priorBaselineVersion: null,
      changes: [],
    },
    memo: null,
    impact: null,
    returns: [],
    baseline: baseline(),
    history: [baseline()],
    approval: null,
    gates: {
      allSectionsDecided: true,
      profileConfirmed: true,
      hasBlockingMatter: false,
      openReturnCount: 0,
      impactConfirmed: true,
      canConfirm: true,
      canCreateMemo: false,
      canApprove: false,
      canReopen: false,
      confirmBlockers: [],
      approveBlockers: [],
      checks: CHECK_KEYS.map((key, i) => ({ key, label: `Check ${key}`, met: i < 5, detail: null })),
    },
    planning: { unlocked: false, route: 'locked', reason: 'Locked until AF-02.' },
    planningUnlocked: false,
    recordVersion: 3,
    ...over,
  };
}

const props = (s: StatutoryAuditFrameworkSummary, canManage = true) => ({
  engagementId: 'e1',
  summary: s,
  canManage,
  onChanged: jest.fn(),
});

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) =>
    url.startsWith('/employees')
      ? Promise.resolve({ items: [{ id: 'emp1', fullName: 'Ravi' }], total: 1 })
      : url.includes('/documents')
        ? Promise.resolve({
            items: [
              {
                id: 'doc9',
                title: 'Listing approval',
                currentFilename: 'nse.pdf',
                currentVersionNo: 1,
              },
            ],
            total: 1,
          })
        : Promise.resolve(summary()),
  );
});

describe('02.8 framework summary & approval', () => {
  it('the dashboard shows each conclusion with its attention and a link back to its section', async () => {
    const target = document.createElement('div');
    target.id = 'framework-02-4';
    target.scrollIntoView = jest.fn();
    document.body.appendChild(target);
    const user = userEvent.setup();
    render(<FrameworkDashboard rows={summary().dashboard} />);
    expect(screen.getByText('CARO 2020')).toBeInTheDocument();
    expect(screen.getByText('Returned (AF-01): Fix clause (vii)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(target.scrollIntoView).toHaveBeenCalled();
    target.remove();
  });

  it('shows the §18 checklist progress', () => {
    render(wrap(<FrameworkSummaryApproval {...props(summary())} />));
    expect(screen.getByText('5/10 met')).toBeInTheDocument();
  });

  it('AF-01 Yes needs the preview reviewed and posts the decision with the record version', async () => {
    const user = userEvent.setup();
    render(wrap(<FrameworkSummaryApproval {...props(summary())} />));
    await user.click(screen.getByRole('button', { name: /Yes – Submit for Partner Approval/ }));
    const record = screen.getByRole('button', { name: 'Record AF-01' });
    expect(record).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /reviewed the Downstream/ }));
    await user.click(record);
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/framework-summary/confirm',
      {
        method: 'POST',
        body: {
          decision: 'submit_for_partner_approval',
          note: undefined,
          previewReviewed: true,
          recordVersion: 3,
        },
      },
    );
  });

  it('AF-01 Yes is disabled with the reasons while blocked', () => {
    const s = summary({
      gates: {
        ...summary().gates,
        canConfirm: false,
        confirmBlockers: ['A Blocking Matter is unresolved.'],
      },
    });
    render(wrap(<FrameworkSummaryApproval {...props(s)} />));
    expect(screen.getByText('A Blocking Matter is unresolved.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Yes – Submit for Partner Approval/ }),
    ).toBeDisabled();
  });

  it('AF-01 No returns the named section with its action', async () => {
    const user = userEvent.setup();
    render(wrap(<FrameworkSummaryApproval {...props(summary())} />));
    await user.click(screen.getByRole('button', { name: /No – Further Work Required/ }));
    await user.selectOptions(screen.getByLabelText('Source section'), '02.5');
    await user.type(screen.getByLabelText('Further work required'), 'Re-test ELCs');
    await user.click(screen.getByRole('button', { name: 'Return for further work' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/framework-summary/confirm',
      {
        method: 'POST',
        body: {
          decision: 'further_work_required',
          note: undefined,
          returnItems: [{ section: '02.5', action: 'Re-test ELCs', ownerEmployeeId: undefined }],
          recordVersion: 3,
        },
      },
    );
  });

  it('AF-02 waits for the Engagement Partner when someone else is viewing', () => {
    const s = summary({
      baseline: baseline({ status: 'manager_confirmed', managerConfirmedByName: 'Manoj' }),
    });
    render(wrap(<FrameworkSummaryApproval {...props(s)} />));
    expect(screen.getByText(/Awaiting the Engagement Partner \(Priya\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Yes – Submit/ })).not.toBeInTheDocument();
  });

  it('the Engagement Partner approves subject to a condition', async () => {
    const s = summary({
      header: { ...summary().header, viewerIsPartner: true },
      baseline: baseline({ status: 'manager_confirmed' }),
      gates: { ...summary().gates, canApprove: true },
    });
    const user = userEvent.setup();
    render(wrap(<FrameworkSummaryApproval {...props(s)} />));
    await user.click(screen.getByRole('button', { name: 'Approve Subject to Conditions' }));
    const submit = screen.getByRole('button', { name: 'Approve subject to conditions' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Condition 1/), 'Obtain sanction letter');
    await user.type(screen.getByLabelText(/Due date/), '2026-11-30');
    await user.type(screen.getByLabelText(/Impact if not met/), 'CARO 3(ii)(b)');
    await user.click(screen.getByRole('checkbox', { name: /Planning may commence/ }));
    await user.click(submit);
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/framework-summary/approve',
      {
        method: 'POST',
        body: {
          decision: 'approve_subject_to_conditions',
          conditions: [
            {
              condition: 'Obtain sanction letter',
              ownerEmployeeId: undefined,
              dueDate: '2026-11-30',
              impact: 'CARO 3(ii)(b)',
              planningMayCommence: false,
            },
          ],
          recordVersion: 3,
        },
      },
    );
  });

  it('shows the approval record and reopens with the mandatory fields', async () => {
    const approved = baseline({ status: 'approved', epApprovedAt: '2026-10-01T00:00:00Z' });
    const s = summary({
      baseline: approved,
      history: [approved],
      gates: { ...summary().gates, canReopen: true },
      approval: {
        decision: 'approve',
        partnerName: 'Priya',
        approvedAt: '2026-10-01T00:00:00Z',
        auditPeriod: 'FY 2025-26',
        baselineVersion: '1.0',
        methodologyVersion: 'DHVAJ Statutory Audit Methodology v1.0',
        ruleVersions: [
          { ruleVersionId: 'rv1', ruleCode: 'CARO_PVT', versionLabel: 'v1', section: '02.4' },
        ],
        memoDocumentId: 'd1',
        memoVersion: '2',
        memoReference: 'AFM.docx',
        conditions: [],
      },
    });
    const user = userEvent.setup();
    render(wrap(<FrameworkSummaryApproval {...props(s)} />));
    const record = screen.getByText('Framework approval record').closest('div')!.parentElement!;
    expect(within(record).getByText('AFM.docx (v2)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Reopen the approved framework/ }));
    const reopen = screen.getByRole('button', { name: 'Reopen framework' });
    expect(reopen).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason for reopening/), 'Debt listed after approval');
    await user.click(screen.getByRole('checkbox', { name: '02.1 Entity & Regulatory Profile' }));
    await user.click(reopen);
    const [url, init] = apiFetch.mock.calls.find((c) => String(c[0]).endsWith('/reopen'))!;
    expect(url).toBe('/engagements/e1/statutory-audit/wf1/framework-summary/reopen');
    expect(init.body).toMatchObject({
      reason: 'Debt listed after approval',
      affectedSections: ['02.1'],
      reapprovalRequired: true,
      recordVersion: 3,
    });
  });

  it('reopen records who identified the change and links an evidence document', async () => {
    const approved = baseline({ status: 'approved' });
    const s = summary({
      baseline: approved,
      history: [approved],
      gates: { ...summary().gates, canReopen: true },
    });
    const user = userEvent.setup();
    render(wrap(<FrameworkSummaryApproval {...props(s)} />));
    await user.click(screen.getByRole('button', { name: /Reopen the approved framework/ }));
    await user.type(screen.getByLabelText(/Reason for reopening/), 'NCD listing');
    await user.click(screen.getByRole('checkbox', { name: '02.1 Entity & Regulatory Profile' }));
    await screen.findByRole('option', { name: 'Ravi' });
    await user.selectOptions(screen.getByLabelText('Change identified by'), 'emp1');
    await user.click(screen.getByRole('button', { name: /Link an evidence document/ }));
    await user.click(await screen.findByRole('button', { name: 'Link' }));
    expect(screen.getByText('Listing approval')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen framework' }));
    const [, init] = apiFetch.mock.calls.find((c) => String(c[0]).endsWith('/reopen'))!;
    expect(init.body).toMatchObject({
      identifiedByEmployeeId: 'emp1',
      evidenceDocumentId: 'doc9',
    });
  });

  it('the reopen form opens when the Section 02 banner asks for it', async () => {
    const approved = baseline({ status: 'approved' });
    const s = summary({
      baseline: approved,
      history: [approved],
      gates: { ...summary().gates, canReopen: true },
    });
    render(wrap(<FrameworkSummaryApproval {...props(s)} />));
    expect(screen.queryByLabelText(/Reason for reopening/)).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent(FRAMEWORK_REOPEN_EVENT));
    });
    expect(await screen.findByLabelText(/Reason for reopening/)).toBeInTheDocument();
  });

  it('the baseline history keeps the §15 reopen record and opens its evidence', async () => {
    const reopened = baseline({
      id: 'b2',
      version: '1.1',
      reopen: {
        reason: 'NCD listing',
        affectedSections: ['02.1', '02.5'],
        identifiedAt: '2026-10-05T00:00:00Z',
        identifiedByName: 'Ravi',
        evidenceNote: 'NSE intimation',
        evidenceDocumentId: 'doc9',
        reapprovalRequired: true,
        reopenedByName: 'Priya',
        reopenedAt: '2026-10-06T00:00:00Z',
        fromVersion: '1.0',
      } as FrameworkBaselineRecord['reopen'],
    });
    const user = userEvent.setup();
    render(wrap(<FrameworkSummaryApproval {...props(summary({ history: [reopened] }))} />));
    await user.click(screen.getByRole('button', { name: /Baseline history/ }));
    expect(screen.getByText(/by Ravi/)).toBeInTheDocument();
    expect(screen.getByText('Evidence: NSE intimation')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Open the evidence document/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/documents/doc9');
  });
});

describe('§14 approved banner', () => {
  it('routes a change through Reopen Audit Framework', async () => {
    const heard = jest.fn();
    window.addEventListener(FRAMEWORK_REOPEN_EVENT, heard);
    const user = userEvent.setup();
    render(<ApprovedFrameworkBanner version="1.0" canReopen />);
    expect(screen.getByText(/Audit Framework v1.0 approved/)).toBeInTheDocument();
    expect(screen.getByText(/Section 02 is read-only/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen Audit Framework' }));
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(FRAMEWORK_REOPEN_EVENT, heard);
  });

  it('points everyone else to the engagement lead', () => {
    render(<ApprovedFrameworkBanner version="1.0" canReopen={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Ask the engagement lead/)).toBeInTheDocument();
  });
});

const matter = (over: Partial<FrameworkSummaryMatter>): FrameworkSummaryMatter => ({
  id: 'm',
  code: 'M-001',
  source: '02.4',
  category: 'other' as FrameworkSummaryMatter['category'],
  title: 'Matter',
  description: null,
  impact: null,
  ownerEmployeeId: null,
  ownerName: null,
  dueDate: null,
  status: 'open',
  partnerAttention: false,
  resolution: null,
  evidenceDocumentId: null,
  blocking: false,
  open: true,
  ...over,
});

describe('§3 header and §4 matters row', () => {
  let target: HTMLDivElement;
  beforeEach(() => {
    target = document.createElement('div');
    target.id = FRAMEWORK_MATTERS_ANCHOR;
    target.scrollIntoView = jest.fn();
    document.body.appendChild(target);
  });
  afterEach(() => target.remove());

  it('shows the purpose, links the matter counts and warns while a matter blocks', async () => {
    const s = summary();
    const user = userEvent.setup();
    render(
      <FrameworkSummaryHeaderCard
        summary={{ ...s, header: { ...s.header, openMatterCount: 3, blockingMatterCount: 2 } }}
      />,
    );
    expect(screen.getByText(/before audit planning begins/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      '2 blocking matters prevent Manager confirmation (AF-01) and Partner approval (AF-02).',
    );
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: 'Resolve matters' }));
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('no warning without a blocking matter', () => {
    render(<FrameworkSummaryHeaderCard summary={summary()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('the dashboard counts the Framework Matters and links to them', async () => {
    const user = userEvent.setup();
    render(
      <FrameworkDashboard
        rows={[]}
        matters={[
          matter({ id: 'a' }),
          matter({ id: 'b', status: 'blocking', blocking: true }),
          matter({ id: 'c', status: 'resolved', open: false }),
        ]}
      />,
    );
    expect(screen.getByText('Framework Matters')).toBeInTheDocument();
    expect(screen.getByText('2 open · 1 resolved · 1 blocking')).toBeInTheDocument();
    expect(screen.getByText('Blocking')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View Matters' }));
    expect(target.scrollIntoView).toHaveBeenCalled();
  });
});
