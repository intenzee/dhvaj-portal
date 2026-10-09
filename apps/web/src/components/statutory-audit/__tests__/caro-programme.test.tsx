import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CaroClauseItem, StatutoryAuditCaroProgramme } from '@hsdg/contracts';
import { CaroProgramme } from '../caro-programme';
import { CaroEvidence } from '../caro-evidence';

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

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => apiFetch.mockReset());

const BASE = '/engagements/e1/statutory-audit/wf1/caro';

function item(over: Partial<CaroClauseItem> = {}): CaroClauseItem {
  return {
    id: 'i1',
    clauseCode: 'CARO_2020_3_I_B',
    parentClauseCode: 'CARO_2020_3_I',
    clauseRef: '3(i)(b)',
    parentTitle: 'Property, plant and equipment and intangible assets',
    title: 'Physical verification of property, plant and equipment',
    requirement: 'Whether property, plant and equipment have been physically verified.',
    reportContext: 'standalone',
    provisionCode: 'CARO_2020_3_I_B',
    guidanceProvisionCode: 'ICAI_GN_CARO_2020',
    guidanceReference: 'Guidance Note on CARO 2020 — clause (i)(b)',
    relevanceHint: null,
    scheduleIiiKeys: [],
    scheduleIiiRequirementCodes: [],
    auditAreaCodes: ['PPE'],
    relatedWorkAreas: [{ workAreaKey: 'fs_ppe', title: 'Property, Plant & Equipment' }],
    procedures: [
      { key: 'v', title: 'Verification programme', objective: 'Obtain it.', evidence: null },
    ],
    requiresPartnerReview: false,
    relevance: 'assessment_required',
    relevanceReason: null,
    workPerformed: null,
    managementResponse: null,
    draftReporting: null,
    conclusion: null,
    conclusionNote: null,
    reviewState: 'open',
    returnNote: null,
    submittedByName: null,
    submittedAt: null,
    approvedByName: null,
    approvedAt: null,
    partnerReviewedByName: null,
    partnerReviewedAt: null,
    procedureId: 'p1',
    procedureRef: 'P-07',
    withdrawn: false,
    evidence: [],
    findings: [],
    components: [],
    priorYear: {
      financialYear: '2023-24',
      conclusion: 'reportable_matter',
      reportingLanguage: 'Verification was not carried out.',
      findings: [],
      evidence: ['FY24 verification report'],
    },
    approvalBlockers: ["Decide the clause's relevance to the entity's facts."],
    version: 1,
    ...over,
  };
}

function programme(over: Partial<StatutoryAuditCaroProgramme> = {}): StatutoryAuditCaroProgramme {
  return {
    workflowInstanceId: 'wf1',
    engagementId: 'e1',
    state: 'active',
    reason:
      'CARO applies to the standalone report — the paragraph 3 clause programme is instantiated.',
    level1: {
      outcome: 'applicable',
      decided: true,
      complete: false,
      standaloneApplies: true,
      consolidatedApplies: null,
      consolidatedStatus: 'not_applicable',
      cfsInScope: false,
      financialYear: '2024-25',
      periodStart: '2024-04-01',
    },
    programme: {
      id: 'pr1',
      orderCode: 'CARO_2020',
      orderTitle: "Companies (Auditor's Report) Order, 2020",
      orderVersionLabel: 'CARO 2020 — applicable from FY 2021-22',
      periodStart: '2024-04-01',
      status: 'active',
      withdrawnAt: null,
      withdrawnReason: null,
      instantiatedAt: '2025-05-02T10:00:00Z',
    },
    orderVersion: null,
    standalone: [item()],
    consolidatedState: 'not_required',
    consolidated: null,
    summary: {
      total: 1,
      applicable: 0,
      notApplicableToFacts: 0,
      assessmentRequired: 1,
      approved: 0,
      reportable: 0,
      openFindings: 0,
    },
    priorYear: null,
    readOnly: false,
    ...over,
  };
}

const panel = (canManage = true) =>
  wrap(<CaroProgramme engagementId="e1" workflowInstanceId="wf1" canManage={canManage} />);

describe('02.4 CARO Work Programme', () => {
  it('waits for the applicability conclusion — nothing is created by hand', async () => {
    apiFetch.mockResolvedValue(
      programme({
        state: 'awaiting_conclusion',
        reason:
          'The CARO work programme is generated once the applicability conclusion is confirmed.',
        programme: null,
        standalone: [],
        summary: { ...programme().summary, total: 0, assessmentRequired: 0 },
      }),
    );
    render(panel());
    expect(
      await screen.findByText('Generated after applicability is confirmed'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Expand clause/ })).toBeNull();
  });

  it('shows the instantiated clauses grouped under their paragraph 3 clause', async () => {
    apiFetch.mockResolvedValue(programme());
    render(panel());
    expect(await screen.findByText('Instantiated')).toBeInTheDocument();
    expect(screen.getByText(/CARO 2020 — applicable from FY 2021-22/)).toBeInTheDocument();
    expect(
      screen.getByText('3(i) Property, plant and equipment and intangible assets'),
    ).toBeInTheDocument();
    expect(screen.getByText(/never changes the overall CARO applicability/)).toBeInTheDocument();
  });

  it('expands a clause in place (+/−) with its references, cross-references and prior year', async () => {
    apiFetch.mockResolvedValue(programme());
    render(panel());
    await userEvent.click(await screen.findByRole('button', { name: 'Expand clause 3(i)(b)' }));
    expect(screen.getByRole('button', { name: 'Collapse clause 3(i)(b)' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /View CARO Clause 3\(i\)\(b\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View ICAI Guidance/ })).toBeInTheDocument();
    expect(screen.getByText(/Section 06 procedure/)).toHaveTextContent('P-07');
    expect(screen.getByText(/Related audit work: Property, Plant & Equipment/)).toBeInTheDocument();
    expect(screen.getByText(/FY 2023-24 \(reference only/)).toBeInTheDocument();
    expect(screen.getByText(/Prior evidence .*FY24 verification report/)).toBeInTheDocument();
    expect(screen.getByText(/decide the clause's relevance/i)).toBeInTheDocument();
  });

  it('saves the clause work against the clause version', async () => {
    apiFetch.mockResolvedValueOnce(programme()).mockResolvedValueOnce(programme());
    render(panel());
    await userEvent.click(await screen.findByRole('button', { name: 'Expand clause 3(i)(b)' }));
    await userEvent.selectOptions(screen.getByLabelText('Relevance to facts'), 'applicable');
    await userEvent.selectOptions(
      screen.getByLabelText('Clause conclusion'),
      'no_reportable_exception',
    );
    await userEvent.type(
      screen.getByLabelText('Proposed reporting language'),
      'Verified at reasonable intervals.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save clause' }));
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/clauses/i1`, {
      method: 'PATCH',
      body: expect.objectContaining({
        relevance: 'applicable',
        conclusion: 'no_reportable_exception',
        draftReporting: 'Verified at reasonable intervals.',
        version: 1,
      }),
    });
  });

  it('submits for review; an approved clause is read-only until reopened', async () => {
    apiFetch.mockResolvedValueOnce(programme({ standalone: [item({ approvalBlockers: [] })] }));
    apiFetch.mockResolvedValueOnce(programme());
    render(panel());
    await userEvent.click(await screen.findByRole('button', { name: 'Expand clause 3(i)(b)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/clauses/i1/review`, {
      method: 'POST',
      body: { action: 'submit', version: 1 },
    });
  });

  it('an approved clause shows no form and offers Reopen', async () => {
    apiFetch.mockResolvedValue(
      programme({
        standalone: [
          item({
            relevance: 'applicable',
            conclusion: 'no_reportable_exception',
            draftReporting: 'Verified.',
            reviewState: 'approved',
            approvedByName: 'Asha Manager',
            approvedAt: '2025-06-01T10:00:00Z',
            approvalBlockers: [],
          }),
        ],
      }),
    );
    render(panel());
    await userEvent.click(await screen.findByRole('button', { name: 'Expand clause 3(i)(b)' }));
    expect(screen.queryByRole('button', { name: 'Save clause' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.getByText(/approved by Asha Manager/)).toBeInTheDocument();
  });

  it('is read-only for a member who cannot manage the file', async () => {
    apiFetch.mockResolvedValue(programme());
    render(panel(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Expand clause 3(i)(b)' }));
    expect(screen.queryByRole('button', { name: 'Save clause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
  });

  it('configures only clause 3(xxi) for the CFS, with the companies from 02.6', async () => {
    apiFetch.mockResolvedValue(
      programme({
        level1: { ...programme().level1!, cfsInScope: true, consolidatedStatus: 'applicable' },
        consolidatedState: 'configured',
        consolidated: item({
          id: 'x1',
          clauseCode: 'CARO_2020_3_XXI',
          parentClauseCode: null,
          clauseRef: '3(xxi)',
          title: 'Qualifications or adverse remarks in component CARO reports',
          reportContext: 'consolidated',
          requiresPartnerReview: true,
          priorYear: null,
          components: [
            {
              id: 'c1',
              source: '02.6',
              componentName: 'Sub One Pvt Ltd',
              relationship: 'subsidiary',
              caroApplicable: 'pending',
              auditorName: null,
              auditorReportDocumentId: null,
              auditorReportTitle: null,
              qualificationIdentified: null,
              paragraphRefs: null,
              remarks: null,
              withdrawn: false,
              version: 1,
            },
          ],
        }),
      }),
    );
    render(panel());
    expect(await screen.findByText('Clause 3(xxi) configured')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expand clause 3(xxi)' }));
    const comps = screen.getByLabelText('Companies included in the CFS');
    expect(within(comps).getByText('Sub One Pvt Ltd')).toBeInTheDocument();
    expect(within(comps).getByText('From 02.6')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record Partner review' })).toBeInTheDocument();
  });
});

describe('02.4 CARO findings', () => {
  it('a finding raised in error is withdrawn, never deleted', async () => {
    const finding = {
      id: 'f1',
      code: 'CF-001',
      itemId: 'i1',
      clauseRef: '3(i)(b)',
      description: 'Raised on the wrong clause.',
      severity: 'low' as const,
      workAreaKey: 'caro',
      workAreaTitle: 'CARO',
      procedureId: null,
      procedureRef: null,
      amount: null,
      includeInReport: false,
      managementResponse: null,
      status: 'open' as const,
      resolution: null,
      raisedByName: 'Asha',
      withdrawn: false,
      createdAt: '2025-06-01T10:00:00Z',
      version: 3,
    };
    apiFetch
      .mockResolvedValueOnce(programme({ standalone: [item({ findings: [finding] })] }))
      .mockResolvedValueOnce(programme());
    render(panel());
    await userEvent.click(await screen.findByRole('button', { name: 'Expand clause 3(i)(b)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw finding CF-001' }));
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/findings/f1`, {
      method: 'PATCH',
      body: { withdrawn: true, version: 3 },
    });
  });
});

describe('02.4 CARO evidence', () => {
  it('suggests the CARO Applicability Memo only for an override or complex case', async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === '/engagements/e1/statutory-audit/caro') {
        return Promise.resolve([
          {
            workflowInstanceId: 'wf1',
            assessment: {
              id: 's4',
              isOverridden: true,
              systemOutcome: 'applicable',
              conclusion: 'not_applicable_exempt',
            },
          },
        ]);
      }
      return Promise.resolve({
        subAssessmentId: 's4',
        subSectionKey: '02.4',
        workflowInstanceId: 'wf1',
        readOnly: false,
        m365Enabled: false,
        files: [],
        memo: { templateAvailable: true, reason: null, memoFileId: null },
      });
    });
    render(wrap(<CaroEvidence engagementId="e1" workflowInstanceId="wf1" canManage />));
    expect(await screen.findByText('CARO 2020 Applicability Memo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Technical Memo/ })).toBeEnabled();
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/framework/s4/evidence',
    );
  });
});
