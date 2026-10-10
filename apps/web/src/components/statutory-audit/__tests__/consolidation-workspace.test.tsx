import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  relationshipEvidenceKey,
  type GroupAuditStatus,
  type StatutoryAuditConsolidation,
} from '@hsdg/contracts';
import { ConsolidationWorkspace } from '../consolidation-workspace';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
const evidenceProps = jest.fn();
const referenceProps = jest.fn();
jest.mock('../framework-evidence', () => ({
  FrameworkEvidence: (p: unknown) => {
    evidenceProps(p);
    return null;
  },
}));
jest.mock('../framework-references', () => ({
  FrameworkReferences: (p: unknown) => {
    referenceProps(p);
    return null;
  },
}));
jest.mock('../acceptance-file-card', () => ({
  LinkPicker: ({ onPick }: { onPick: (id: string) => void }) => (
    <button type="button" onClick={() => onPick('doc-tb')}>
      Pick TB
    </button>
  ),
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const BASE = '/engagements/e1/statutory-audit/wf1/consolidation';

function fixture(over: Partial<StatutoryAuditConsolidation> = {}): StatutoryAuditConsolidation {
  return {
    workflowInstanceId: 'wf1',
    engagementServiceId: 'es1',
    engagementId: 'e1',
    assessment: {
      id: 'sa1',
      subSectionKey: '02.6',
      areaKey: 'cfs',
      state: 'system_suggested_applicable',
      systemOutcome: 'cfs_required',
      systemBasis: '§129(3): the company has a subsidiary — CFS required.',
      conclusion: null,
      isOverridden: false,
      basis: null,
      version: 7,
      needsReevaluation: false,
      authorityProvisionId: null,
    } as unknown as StatutoryAuditConsolidation['assessment'],
    detail: {
      cfsTriggered: true,
      rule6: null,
      perimeter: [
        {
          id: 'c1',
          name: 'Sub One Pvt Ltd',
          ownershipPercent: 80,
          votingPercent: 80,
          relationship: 'subsidiary',
          method: 'full_consolidation',
          standard: 'Ind AS 110',
          auditedByOtherAuditor: false,
          basis: 'Subsidiary indicated by voting power 80% > 50%.',
          factors: ['Voting power 80%'],
          judgementRequired: true,
          presumptionRebutted: null,
          systemIncluded: 'yes',
          included: 'yes',
          inclusionReason: 'Subsidiary for the full period.',
          periodImpact: 'full_period',
          effectiveFrom: null,
          effectiveTo: null,
          country: 'IN',
          isIndianCompany: true,
          reportingDate: null,
          policy: {
            localFramework: 'ifrs',
            groupFramework: 'ind_as',
            systemResult: 'conversion_required',
            result: 'conversion_required',
            basis: 'IFRS differs from the group Ind AS.',
          },
        },
      ],
      usesOtherAuditors: false,
      saFramework: null,
      hasBranches: false,
      materialityNote: 'Materiality is set in 03.3.',
      crossLinkNote: 'One group structure.',
      groupFramework: 'ind_as',
      counts: { subsidiary: 1 },
      missingFacts: [
        { key: 'reporting_date', label: 'Reporting date', componentId: 'c1', blocking: false },
      ],
    },
    capturedFacts: {
      investees: [
        {
          id: 'c1',
          name: 'Sub One Pvt Ltd',
          ownershipPercent: 80,
          votingDirect: 80,
          hasControl: null,
          isJointArrangement: false,
          jointArrangementIsOperation: false,
          significantInfluenceRebutted: null,
          auditedByOtherAuditor: false,
          localFramework: 'ifrs',
        },
      ],
      isWhollyOwnedSubsidiary: false,
      isPartiallyOwnedSubsidiary: false,
      otherMembersIntimatedNoObjection: false,
      securitiesListedOrInProcess: false,
      parentFilesCompliantCfs: null,
      hasBranches: false,
    },
    baseFacts: {} as StatutoryAuditConsolidation['baseFacts'],
    masterFacts: [],
    upstreamReady: true,
    completion: {
      complete: false,
      status: 'in_progress',
      items: [
        { key: 'cfs_concluded', label: 'CFS conclusion recorded', met: false, detail: null },
        { key: 'versions_resolved', label: 'Rule versions resolved', met: true, detail: null },
        { key: 'auditor_matrix', label: 'Auditor matrix', met: null, detail: null },
      ],
    },
    conversions: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        componentId: 'c1',
        componentName: 'Sub One Pvt Ltd',
        localFramework: 'ifrs',
        groupFramework: 'ind_as',
        status: 'open',
        differences: [],
        reviewerEmployeeId: null,
        reviewerName: null,
        reportingPackageDocumentId: null,
        reportingPackageName: null,
        adjustedTbDocumentId: null,
        adjustedTbName: null,
        reviewedAt: null,
        version: 2,
      },
    ],
    groupAudit: null,
    ...over,
  };
}

beforeEach(() => {
  evidenceProps.mockReset();
  referenceProps.mockReset();
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) =>
    url.endsWith('/statutory-audit/team')
      ? Promise.resolve([
          {
            engagementPartnerId: 'ep1',
            engagementPartnerName: 'Partner A',
            engagementManagerId: null,
            engagementManagerName: null,
            members: [],
          },
        ])
      : Promise.resolve({}),
  );
});

describe('02.6 Consolidation workspace (spec §4)', () => {
  it('lands on the system assessment, structure, perimeter, outstanding information and completion', () => {
    render(wrap(<ConsolidationWorkspace engagementId="e1" consolidation={fixture()} canManage />));
    const ws = screen.getByTestId('consolidation-workspace');
    expect(within(ws).getByText('In progress')).toBeInTheDocument();
    expect(within(ws).getAllByText('CFS Required').length).toBeGreaterThan(0);
    expect(within(ws).getByText(/the company has a subsidiary/)).toBeInTheDocument();
    expect(within(ws).getByText('Subsidiary: 1')).toBeInTheDocument();
    // The perimeter row with its badges.
    const perimeter = screen.getByTestId('consolidation-perimeter');
    expect(within(perimeter).getByText('Sub One Pvt Ltd')).toBeInTheDocument();
    expect(within(perimeter).getByText('Judgement required')).toBeInTheDocument();
    expect(within(perimeter).getByText('Conversion required')).toBeInTheDocument();
    // Outstanding information names the component.
    expect(within(ws).getByText('Sub One Pvt Ltd: Reporting date')).toBeInTheDocument();
    // Not-relevant checklist items are hidden.
    expect(within(ws).getByText('CFS conclusion recorded')).toBeInTheDocument();
    expect(within(ws).queryByText('Auditor matrix')).not.toBeInTheDocument();
  });

  it('confirms the system assessment (CFS-05)', async () => {
    const user = userEvent.setup();
    render(wrap(<ConsolidationWorkspace engagementId="e1" consolidation={fixture()} canManage />));
    await user.click(screen.getByRole('button', { name: /Confirm System Assessment/ }));
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/decision`, {
      method: 'POST',
      body: { action: 'confirm', version: 7 },
    });
  });

  it('an override needs the conclusion, reason and technical basis', async () => {
    const user = userEvent.setup();
    render(wrap(<ConsolidationWorkspace engagementId="e1" consolidation={fixture()} canManage />));
    await user.click(screen.getByRole('button', { name: 'Override Assessment' }));
    const record = screen.getByRole('button', { name: 'Record override' });
    expect(record).toBeDisabled();
    await user.selectOptions(screen.getByLabelText(/Final conclusion/), 'cfs_exempt');
    await user.type(screen.getByLabelText(/Reason \(mandatory\)/), 'Rule 6 met');
    expect(record).toBeDisabled();
    await user.type(screen.getByLabelText(/Technical basis/), 'Rule 6');
    await user.type(screen.getByLabelText(/Supporting evidence/), 'Parent CFS on file');
    await user.click(record);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/decision`, {
      method: 'POST',
      body: {
        action: 'override',
        conclusion: 'cfs_exempt',
        basis: 'Rule 6 met',
        technicalBasis: 'Rule 6',
        supportingEvidence: 'Parent CFS on file',
        version: 7,
      },
    });
  });

  it('only the Engagement Partner sees the approval action', async () => {
    const user = userEvent.setup();
    const decided = fixture({
      assessment: {
        ...fixture().assessment,
        state: 'overridden',
        conclusion: 'cfs_exempt',
        isOverridden: true,
      },
      partnerApproval: {
        required: true,
        reason: 'A significant override of the system conclusion.',
        approvedAt: null,
        approvedByName: null,
        note: null,
      },
    });
    const { unmount } = render(
      wrap(<ConsolidationWorkspace engagementId="e1" consolidation={decided} canManage />),
    );
    expect(screen.getByText('Awaiting Engagement Partner approval.')).toBeInTheDocument();
    unmount();

    render(
      wrap(
        <ConsolidationWorkspace
          engagementId="e1"
          consolidation={{ ...decided, viewerIsPartner: true }}
          canManage
        />,
      ),
    );
    await user.type(screen.getByLabelText(/Approval note/), 'Reviewed');
    await user.click(screen.getByRole('button', { name: 'Approve as Engagement Partner' }));
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/partner-approval`, {
      method: 'POST',
      body: { note: 'Reviewed', version: 7 },
    });
  });

  it('records a control conclusion on a component in place', async () => {
    const user = userEvent.setup();
    render(wrap(<ConsolidationWorkspace engagementId="e1" consolidation={fixture()} canManage />));
    const perimeter = screen.getByTestId('consolidation-perimeter');
    await user.click(within(perimeter).getByRole('button', { name: /Sub One Pvt Ltd/ }));
    await user.selectOptions(
      within(perimeter).getByLabelText(/Control \(professional conclusion\)/),
      'yes',
    );
    await user.click(within(perimeter).getByRole('button', { name: 'Save component' }));
    const call = apiFetch.mock.calls.find(([u]) => u === `${BASE}/facts`);
    expect(call?.[1].body.version).toBe(7);
    expect(call?.[1].body.investees).toEqual([
      expect.objectContaining({ id: 'c1', name: 'Sub One Pvt Ltd', controlConclusion: 'yes' }),
    ]);
  });

  it('files evidence and shows the authority per relationship (§5)', async () => {
    const user = userEvent.setup();
    render(wrap(<ConsolidationWorkspace engagementId="e1" consolidation={fixture()} canManage />));
    const perimeter = screen.getByTestId('consolidation-perimeter');
    await user.click(within(perimeter).getByRole('button', { name: /Sub One Pvt Ltd/ }));
    expect(within(perimeter).getByText(/Relationship evidence/)).toBeInTheDocument();
    expect(evidenceProps).toHaveBeenCalledWith(
      expect.objectContaining({
        subAssessmentId: 'sa1',
        question: relationshipEvidenceKey('c1'),
        questionLabel: 'Sub One Pvt Ltd',
        readOnly: false,
      }),
    );
    expect(relationshipEvidenceKey('c1')).toMatch(/^rel_[0-9a-f]{16}$/);
    expect(referenceProps).toHaveBeenCalledWith(
      expect.objectContaining({ anchors: ['ind_as_110'], effectiveOn: fixture().periodStart }),
    );
  });

  it('shows Section 143(8) and Rule 12 once branch auditors exist (BR-01 Yes)', () => {
    const groupAudit = {
      branchAuditPresent: 'yes',
      byComponent: {},
    } as unknown as GroupAuditStatus;
    render(
      wrap(
        <ConsolidationWorkspace
          engagementId="e1"
          consolidation={fixture({ groupAudit })}
          canManage
        />,
      ),
    );
    expect(referenceProps).toHaveBeenCalledWith(
      expect.objectContaining({
        anchors: expect.arrayContaining(['section_143_8', 'audit_rule_12']),
      }),
    );
  });

  it('a conversion completes only with a reviewer and the adjusted group TB (CFS-04)', async () => {
    const user = userEvent.setup();
    render(wrap(<ConsolidationWorkspace engagementId="e1" consolidation={fixture()} canManage />));
    await user.click(screen.getByRole('button', { name: /Sub One Pvt Ltd.*Open/ }));
    expect(screen.getByRole('option', { name: 'Completed' })).toBeDisabled();
    await user.click(screen.getAllByRole('button', { name: 'Link document' })[1]!);
    await user.click(screen.getByRole('button', { name: 'Pick TB' }));
    expect(apiFetch).toHaveBeenCalledWith(
      `${BASE}/conversions/11111111-1111-1111-1111-111111111111`,
      {
        method: 'PATCH',
        body: { adjustedTbDocumentId: 'doc-tb', version: 2 },
      },
    );
    await user.click(screen.getByRole('button', { name: /Add difference/ }));
    await user.type(screen.getByLabelText(/^Area/), 'Revenue');
    await user.type(screen.getByLabelText(/^Difference/), 'IFRS 15 vs Ind AS 115');
    await user.selectOptions(await screen.findByLabelText(/^Reviewer/), 'ep1');
    await user.click(screen.getByRole('button', { name: 'Save work item' }));
    expect(apiFetch).toHaveBeenCalledWith(
      `${BASE}/conversions/11111111-1111-1111-1111-111111111111`,
      {
        method: 'PATCH',
        body: {
          status: undefined,
          differences: [
            {
              area: 'Revenue',
              description: 'IFRS 15 vs Ind AS 115',
              adjustmentReference: null,
              amount: null,
            },
          ],
          reviewerEmployeeId: 'ep1',
          version: 2,
        },
      },
    );
  });

  it('mounts the Track B group-audit components in their slots', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <ConsolidationWorkspace
          engagementId="e1"
          consolidation={fixture()}
          canManage
          otherAuditors={<p>MATRIX SLOT</p>}
          workProgramme={<p>PROGRAMME SLOT</p>}
        />,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Other auditors (SA 600)' }));
    expect(screen.getByText('MATRIX SLOT')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Consolidation workstream (Section 05)' }));
    expect(screen.getByText('PROGRAMME SLOT')).toBeInTheDocument();
  });

  it('is read-only once Section 02 is approved', () => {
    render(
      wrap(
        <ConsolidationWorkspace
          engagementId="e1"
          consolidation={fixture({ approved: true })}
          canManage
        />,
      ),
    );
    expect(screen.getByText('Approved (Section 02)')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Confirm System Assessment/ }),
    ).not.toBeInTheDocument();
  });
});
