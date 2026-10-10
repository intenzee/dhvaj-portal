import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  DirectorCheck,
  FraudMatter,
  ReportingEvidenceLink,
  StatutoryAuditReportingRecords,
} from '@hsdg/contracts';
import { OtherReportingFraud } from '../other-reporting-fraud';
import { OtherReportingDirectors } from '../other-reporting-directors';
import { OtherReportingCrossRefs } from '../other-reporting-cross-refs';
import { ReportingCardEvidence } from '../other-reporting-evidence';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  fetchBlob: jest.fn(),
  downloadFile: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
jest.mock('../framework-references', () => ({ FrameworkReferences: () => null }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const BASE = '/engagements/e1/statutory-audit/wf1/reporting-records';
const props = { engagementId: 'e1', workflowInstanceId: 'wf1', canManage: true };

function matter(over: Partial<FraudMatter> = {}): FraudMatter {
  return {
    id: 'm1',
    ref: 'FM-001',
    nature: 'Inventory misappropriation',
    description: null,
    amount: 20000000,
    amountEstimated: false,
    perpetrator: 'employees',
    partiesInvolved: null,
    knowledgeDate: '2024-06-01',
    source: 'audit_procedure',
    sourceRef: null,
    procedureId: null,
    procedureRef: null,
    auditProcedures: null,
    tcwgCommunication: null,
    boardReportedOn: '2024-06-03',
    replyReceivedOn: null,
    cgForwardedOn: null,
    adt4Reference: null,
    regulatoryNote: null,
    route: 'central_government',
    routeBasis: '₹2,00,00,000 is at or above the ₹1 crore threshold.',
    regulatoryStatus: 'awaiting_reply',
    deadlines: [
      {
        key: 'reply_due',
        label: 'Board / Audit Committee reply',
        fromEvent: 'reported',
        fromDate: '2024-06-03',
        days: 45,
        dueDate: '2024-07-18',
        metOn: null,
        status: 'overdue',
        provisional: false,
        ruleCode: 'FRAUD_BOARD_REPLY_DAYS',
      },
    ],
    overdue: true,
    nextDeadline: '2024-07-18',
    partnerConsultedByName: null,
    partnerConsultedAt: null,
    partnerNote: null,
    conclusion: 'pending',
    conclusionNote: null,
    fromLegacy: true,
    evidenceCount: 0,
    withdrawn: false,
    createdByName: 'Partner A',
    createdAt: '2026-10-10T00:00:00Z',
    version: 3,
    ...over,
  };
}

function director(over: Partial<DirectorCheck> = {}): DirectorCheck {
  return {
    id: 'd1',
    name: 'Vikram Shah',
    din: null,
    designation: 'Managing Director',
    appointedOn: null,
    ceasedOn: null,
    directorshipInfo: null,
    representationRef: null,
    mcaSource: null,
    disqualified: 'pending',
    legalAnalysis: null,
    auditorConclusion: null,
    source: 'contacts',
    contactId: 'c1',
    evidenceCount: 0,
    representationLinks: 0,
    mcaLinks: 0,
    withdrawn: false,
    version: 1,
    ...over,
  };
}

function link(over: Partial<ReportingEvidenceLink> = {}): ReportingEvidenceLink {
  return {
    id: 'l1',
    cardKey: 's143_3_g_director_disqualification',
    kind: 'mca_record',
    fraudMatterId: null,
    directorId: 'd1',
    documentId: 'doc1',
    auditEvidenceId: null,
    title: 'DIR-8 Vikram Shah',
    filename: 'dir8.pdf',
    inSharePoint: false,
    note: null,
    linkedByName: 'Partner A',
    linkedAt: '2026-10-10T00:00:00Z',
    ...over,
  };
}

function records(
  over: Partial<StatutoryAuditReportingRecords> = {},
): StatutoryAuditReportingRecords {
  return {
    workflowInstanceId: 'wf1',
    engagementId: 'e1',
    periodStart: '2024-04-01',
    canManage: true,
    viewerIsPartner: true,
    fraud: {
      status: {
        active: true,
        matters: 1,
        open: 1,
        centralGovernmentRoute: 1,
        belowThreshold: 0,
        overdue: 1,
        nextDeadline: '2024-07-18',
        thresholdAmount: 10000000,
        initialNoticeDays: 2,
        responseDays: 45,
        forwardDays: 15,
      },
      rules: {
        thresholdAmount: 10000000,
        initialNoticeDays: 2,
        responseDays: 45,
        forwardDays: 15,
        used: [],
      },
      matters: [matter()],
      candidates: [
        {
          source: 'component_or_branch_auditor',
          sourceRef: 'gf1',
          label: 'Branch cash shortage',
          description: 'Reported by the branch auditor.',
        },
      ],
    },
    directors: {
      status: { total: 1, pending: 1, disqualified: 0, cleared: 0, conclusion: 'pending' },
      rows: [director()],
      contactsAvailable: 2,
    },
    crossRefs: {
      caro: { applicable: true, conclusion: 'applicable', complete: false, reportableClauses: 1 },
      icfr: { reportingRequired: false, conclusion: null, complete: true, deficiencies: 0 },
      group: {
        cfsConclusion: null,
        branchesExist: false,
        branchAuditors: 0,
        branchReportsDealt: 0,
        branchReportsPending: 0,
        branchReturnsReceived: null,
      },
    },
    crossRefLinks: [
      {
        key: 'caro',
        label: 'CARO 2020 (02.4)',
        subSectionKey: '02.4',
        finalStage: '02.4 CARO conclusion and clause programme',
        lines: ['CARO 2020 applies', '1 clause(s) with a reportable matter'],
        attention: true,
      },
      {
        key: 'icfr',
        label: 'Internal financial controls — Section 143(3)(i) (02.5)',
        subSectionKey: '02.5',
        finalStage: '02.5 ICFR workstream conclusion',
        lines: ['Section 143(3)(i) reporting not required (exempt)'],
        attention: false,
      },
    ],
    evidence: { counts: {}, links: [] },
    ...over,
  };
}

beforeEach(() => apiFetch.mockReset());

describe('02.7 Fraud Matters', () => {
  it('shows the status, the rules in force and the Rule 13 timeline inline', async () => {
    apiFetch.mockResolvedValue(records());
    render(wrap(<OtherReportingFraud {...props} />));
    expect(await screen.findByText('1 overdue')).toBeInTheDocument();
    expect(screen.getByLabelText('Rule 13 rules in force')).toHaveTextContent(
      /at or above ₹1,00,00,000(\.00)? · initial notice 2 days · reply 45 days · forward 15 days/,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Expand FM-001' }));
    expect(screen.getByText(/Moved from the earlier 02.7 fraud facts/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Rule 13 deadlines' });
    expect(within(table).getByText('Board / Audit Committee reply')).toBeInTheDocument();
    expect(within(table).getByText('overdue')).toBeInTheDocument();
    expect(screen.getByText(/Not yet consulted/)).toBeInTheDocument();
  });

  it('raises a 02.6 fraud finding as a Fraud Matter', async () => {
    apiFetch.mockResolvedValue(records());
    render(wrap(<OtherReportingFraud {...props} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Raise as Fraud Matter' }));
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/fraud-matters`, {
      method: 'POST',
      body: {
        nature: 'Branch cash shortage',
        description: 'Reported by the branch auditor.',
        source: 'component_or_branch_auditor',
        sourceRef: 'gf1',
      },
    });
  });

  it('the Engagement Partner records the consultation with the matter version', async () => {
    apiFetch.mockResolvedValue(records());
    render(wrap(<OtherReportingFraud {...props} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Expand FM-001' }));
    await userEvent.type(screen.getByLabelText('Consultation note'), 'Consulted.');
    await userEvent.click(screen.getByRole('button', { name: 'Record consultation' }));
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/fraud-matters/m1/partner-consultation`, {
      method: 'POST',
      body: { note: 'Consulted.', version: 3 },
    });
  });

  it('is read-only without manage rights', async () => {
    apiFetch.mockResolvedValue(records({ canManage: false }));
    render(wrap(<OtherReportingFraud {...props} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Expand FM-001' }));
    expect(screen.queryByRole('button', { name: 'Save FM-001' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Raise a Fraud/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Raise as Fraud Matter')).not.toBeInTheDocument();
  });
});

describe('02.7 Section 164(2) directors', () => {
  it('fills from the contacts master and needs the legal analysis for a Yes / No', async () => {
    apiFetch.mockResolvedValue(records());
    render(wrap(<OtherReportingDirectors {...props} />));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add 2 from the contacts master' }),
    );
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/directors/fill`, {
      method: 'POST',
      body: {},
    });

    await userEvent.click(screen.getByRole('button', { name: 'Expand Vikram Shah' }));
    await userEvent.selectOptions(screen.getByLabelText('Disqualified'), 'no');
    expect(screen.getByText(/a DIN status alone is not the conclusion/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save director' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Legal analysis'), 'DIR-8 and MCA data clear.');
    await userEvent.click(screen.getByRole('button', { name: 'Save director' }));
    expect(apiFetch).toHaveBeenLastCalledWith(
      `${BASE}/directors/d1`,
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({
          disqualified: 'no',
          legalAnalysis: 'DIR-8 and MCA data clear.',
          version: 1,
        }),
      }),
    );
  });

  it('rejects a DIN that is not 8 digits before it reaches the server', async () => {
    apiFetch.mockResolvedValue(records());
    render(wrap(<OtherReportingDirectors {...props} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Add a director' }));
    await userEvent.type(screen.getByLabelText('Director name'), 'New Director');
    await userEvent.type(screen.getByLabelText('DIN'), '123');
    expect(screen.getByText('DIN must be 8 digits.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add director' })).toBeDisabled();
  });
});

describe('02.7 per-card evidence', () => {
  it('counts the links on a card and expands them in place', async () => {
    apiFetch.mockResolvedValue(records({ evidence: { counts: {}, links: [link()] } }));
    render(wrap(<ReportingCardEvidence {...props} cardKey="s143_3_g_director_disqualification" />));
    const toggle = await screen.findByRole('button', { name: /1 linked item/ });
    await userEvent.click(toggle);
    expect(screen.getByText('MCA / statutory record')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/evidence/l1/unlink`, {
      method: 'POST',
      body: {},
    });
  });

  it("shows only one record's links when given a director", async () => {
    apiFetch.mockResolvedValue(
      records({ evidence: { counts: {}, links: [link(), link({ id: 'l2', directorId: 'd2' })] } }),
    );
    render(
      wrap(
        <ReportingCardEvidence
          {...props}
          cardKey="s143_3_g_director_disqualification"
          directorId="d2"
        />,
      ),
    );
    expect(await screen.findByRole('button', { name: /1 linked item/ })).toBeInTheDocument();
  });
});

describe('02.7 cross-references', () => {
  it('reads the source workspaces and flags what needs attention', async () => {
    apiFetch.mockResolvedValue(records());
    render(wrap(<OtherReportingCrossRefs {...props} />));
    expect(await screen.findByText('CARO 2020 (02.4)')).toBeInTheDocument();
    expect(screen.getByText('1 clause(s) with a reportable matter')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open 02.4/ })).toBeInTheDocument();
  });
});
