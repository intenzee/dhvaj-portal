import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  ConsolidationWorkProgramme as Programme,
  GroupAuditBranch,
  GroupAuditComponent,
  StatutoryAuditConsolidation,
  StatutoryAuditGroupAudit,
} from '@hsdg/contracts';
import { ConsolidationOtherAuditors } from '../consolidation-other-auditors';
import { ConsolidationBranchAuditors } from '../consolidation-branch-auditors';
import { ConsolidationWorkProgramme } from '../consolidation-work-programme';
import { ConsolidationEvidence } from '../consolidation-evidence';

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
const frameworkEvidence = jest.fn();
jest.mock('../framework-evidence', () => ({
  FrameworkEvidence: (props: unknown) => {
    frameworkEvidence(props);
    return <p>shared evidence</p>;
  },
}));

const frameworkReferences = jest.fn();
jest.mock('../framework-references', () => ({
  FrameworkReferences: (props: { anchors?: string[] }) => {
    frameworkReferences(props);
    return <p>references: {props.anchors?.join(', ')}</p>;
  },
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  apiFetch.mockReset();
  frameworkEvidence.mockReset();
  frameworkReferences.mockReset();
});

const BASE = '/engagements/e1/statutory-audit/wf1/group-audit';
const pending = {
  ga02: 'pending',
  ga02Basis: null,
  ga03: 'pending',
  ga03Note: null,
  ga04: 'pending',
  ga04Basis: null,
} as const;

function component(over: Partial<GroupAuditComponent> = {}): GroupAuditComponent {
  return {
    id: 'r1',
    componentId: 'cmp-alpha',
    componentName: 'Alpha Holdings Ltd (UK)',
    relationship: 'subsidiary',
    method: 'full_consolidation',
    included: 'yes',
    country: 'United Kingdom',
    isIndianCompany: false,
    auditorType: 'other_auditor',
    auditorSource: 'system',
    suggestedAuditorType: 'other_auditor',
    suggestedBasis: 'Marked as audited by another auditor in the perimeter.',
    firmName: null,
    frn: null,
    professionalBody: null,
    auditorCountry: null,
    partnerContact: null,
    periodFrom: null,
    periodTo: null,
    reportType: null,
    reportDate: null,
    reportingDeadline: null,
    sa600: 'required',
    significance: 'significant',
    significanceNote: null,
    answers: { ...pending },
    report: null,
    completionMemo: null,
    instructions: null,
    package: [
      {
        key: 'audit_report',
        label: 'Audit report',
        relevant: true,
        status: 'approved',
        file: {
          id: 'gf1',
          documentId: 'd1',
          title: 'Alpha audit report',
          filename: 'alpha-report.pdf',
          versionNo: 1,
          inSharePoint: true,
          linkedByName: 'Manager M',
          linkedAt: '2026-05-04T10:00:00Z',
          how: 'added',
        },
        superseded: [],
        approvedByName: 'Manager M',
        approvedAt: '2026-05-05T10:00:00Z',
        note: null,
      },
    ],
    openFindings: 0,
    missing: ['Answer GA-04 — the component is material.'],
    priorYear: null,
    auditorChanged: false,
    withdrawn: false,
    version: 3,
    ...over,
  } as GroupAuditComponent;
}

function branch(over: Partial<GroupAuditBranch> = {}): GroupAuditBranch {
  return {
    id: 'b1',
    branchName: 'Dubai branch',
    location: 'Dubai',
    country: 'UAE',
    firmName: 'Gulf & Co',
    frn: null,
    partnerContact: null,
    appointmentBasis: 'board_authorised',
    appointmentNote: null,
    periodFrom: null,
    periodTo: null,
    instructions: null,
    report: null,
    answers: { ...pending },
    significance: 'pending',
    principalResponse: null,
    conclusion: 'pending',
    openFindings: 0,
    missing: ['Add the branch audit report.'],
    fromPriorYear: true,
    withdrawn: false,
    version: 2,
    ...over,
  } as GroupAuditBranch;
}

function view(over: Partial<StatutoryAuditGroupAudit> = {}): StatutoryAuditGroupAudit {
  return {
    workflowInstanceId: 'wf1',
    engagementId: 'e1',
    matrixState: 'active',
    matrixReason: 'CFS is required — every included component needs an auditor.',
    consolidationOutcome: 'cfs_required',
    cfsRequired: true,
    periodStart: '2025-04-01',
    ga01: 'yes',
    ga01Basis: 'Alpha is audited by another firm.',
    ga01Source: 'system',
    ga01Suggested: 'yes',
    ga01SuggestedBasis: 'Alpha is audited by another firm.',
    components: [component()],
    br01: 'yes',
    br01Source: 'system',
    br01Basis: 'A branch auditor is recorded.',
    branches: [branch()],
    findings: [
      {
        id: 'f1',
        seq: 1,
        ref: 'GF-001',
        subjectKind: 'component',
        subjectId: 'r1',
        subjectName: 'Alpha Holdings Ltd (UK)',
        category: 'fraud',
        impacts: ['escalation_audit_response'],
        description: 'Suspected fraud in procurement.',
        icfrCrossRef: null,
        escalated: true,
        reportingConsideration: false,
        status: 'open',
        response: null,
        resolvedByName: null,
        resolvedAt: null,
        priorYearRef: null,
        withdrawn: false,
        version: 1,
      },
    ],
    status: {
      matrixComplete: false,
      dhvajComponents: 0,
      otherAuditorComponents: 1,
      tbdComponents: 0,
      byComponent: {},
      sa600Required: true,
      sa600Pending: 3,
      instructionsPending: 1,
      pendingReports: 0,
      branchAuditPresent: 'yes',
      branchAuditors: 1,
      branchPending: 1,
      workProgrammeGenerated: true,
      blockingMatters: ['GA-04 is pending for Alpha Holdings Ltd (UK), a material component.'],
    },
    materialityNote: 'Materiality comes from Section 03.3.',
    materialityApproved: false,
    version: 7,
    readOnly: false,
    ...over,
  } as StatutoryAuditGroupAudit;
}

describe('02.6 component auditors (§12–§16)', () => {
  it('shows the matrix, the blocking matters and expands a component inline', async () => {
    apiFetch.mockResolvedValue(view());
    render(wrap(<ConsolidationOtherAuditors engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText('Matrix incomplete')).toBeInTheDocument();
    expect(screen.getByLabelText('Blocking matters')).toHaveTextContent(/GA-04 is pending/);
    expect(screen.getByLabelText('GA-01')).toHaveTextContent('references: sa_600');
    expect(screen.queryByLabelText('SA 600 questions')).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Expand component Alpha Holdings Ltd (UK)' }),
    );
    expect(screen.getByLabelText('SA 600 questions')).toBeInTheDocument();
    expect(screen.getByLabelText('Still needed')).toHaveTextContent(/GA-04/);
    expect(screen.getByRole('button', { name: /Create instructions/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse component Alpha Holdings Ltd (UK)' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('needs a basis before GA-04 is answered and saves it with the row version', async () => {
    apiFetch.mockResolvedValue(view());
    render(wrap(<ConsolidationOtherAuditors engagementId="e1" workflowInstanceId="wf1" />));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Expand component Alpha Holdings Ltd (UK)' }),
    );
    const qs = screen.getByLabelText('SA 600 questions');
    await userEvent.selectOptions(
      within(qs).getByRole('combobox', { name: 'GA-04 answer' }),
      'yes',
    );
    const ga04 = within(qs)
      .getByRole('combobox', { name: 'GA-04 answer' })
      .closest('div.space-y-1')!;
    const save = within(ga04 as HTMLElement).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(
      within(ga04 as HTMLElement).getByLabelText(/Evidence obtained/),
      'Reviewed working papers.',
    );
    apiFetch.mockResolvedValueOnce(view());
    await userEvent.click(save);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/components/r1`, {
      method: 'PATCH',
      body: { ga04: 'yes', ga04Basis: 'Reviewed working papers.', version: 3 },
    });
  });

  it('asks why before replacing approved package evidence', async () => {
    apiFetch.mockResolvedValue(view());
    render(wrap(<ConsolidationOtherAuditors engagementId="e1" workflowInstanceId="wf1" />));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Expand component Alpha Holdings Ltd (UK)' }),
    );
    const pkg = screen.getByLabelText('Alpha Holdings Ltd (UK) reporting package');
    expect(within(pkg).getByText('Approved')).toBeInTheDocument();
    await userEvent.click(within(pkg).getByRole('button', { name: /Expand .*Audit report/ }));
    const add = within(pkg).getByRole('button', { name: /Replace — Add File/ });
    expect(add).toBeDisabled();
    await userEvent.type(
      within(pkg).getByLabelText(/Reason for replacing approved evidence/),
      'Re-signed report.',
    );
    expect(add).toBeEnabled();
  });

  it('lists findings with escalation and is read-only without edit rights', async () => {
    apiFetch.mockResolvedValue(view({ readOnly: true }));
    render(wrap(<ConsolidationOtherAuditors engagementId="e1" workflowInstanceId="wf1" />));
    const reg = await screen.findByLabelText('Findings register');
    expect(within(reg).getByText('GF-001')).toBeInTheDocument();
    expect(within(reg).getByText('Escalated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Raise finding/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Record GA-01/ })).toBeNull();
  });

  it('shows the awaiting state without the matrix', async () => {
    apiFetch.mockResolvedValue(
      view({ matrixState: 'awaiting', matrixReason: 'Conclude 02.6 first.', components: [] }),
    );
    render(wrap(<ConsolidationOtherAuditors engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText('Awaiting 02.6')).toBeInTheDocument();
    expect(screen.getByText('Conclude 02.6 first.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Component auditor matrix')).toBeNull();
  });
});

describe('02.6 branch auditors (§17)', () => {
  it('shows BR-01 with its suggestion and records an answer', async () => {
    apiFetch.mockResolvedValue(view());
    render(wrap(<ConsolidationBranchAuditors engagementId="e1" workflowInstanceId="wf1" />));
    const br = await screen.findByLabelText('BR-01');
    expect(br).toHaveTextContent('(system suggestion)');
    // View Section 143(8) / Rule 12 (spec §17, §23).
    expect(br).toHaveTextContent('references: section_143_8, audit_rule_12');
    apiFetch.mockResolvedValueOnce(view());
    await userEvent.click(within(br).getByRole('button', { name: 'Record BR-01' }));
    expect(apiFetch).toHaveBeenCalledWith(BASE, {
      method: 'PATCH',
      body: { br01: 'yes', br01Basis: null, version: 7 },
    });
  });

  it('adds a branch auditor inline', async () => {
    apiFetch.mockResolvedValue(view());
    render(wrap(<ConsolidationBranchAuditors engagementId="e1" workflowInstanceId="wf1" />));
    await userEvent.click(await screen.findByRole('button', { name: /Add branch auditor/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /^Branch/ }), 'Singapore branch');
    apiFetch.mockResolvedValueOnce(view());
    const buttons = screen.getAllByRole('button', { name: /Add branch auditor/ });
    await userEvent.click(buttons[buttons.length - 1]!);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/branches`, {
      method: 'POST',
      body: { branchName: 'Singapore branch', location: null },
    });
  });

  it('needs a principal-auditor response before concluding on a branch report', async () => {
    apiFetch.mockResolvedValue(view());
    render(wrap(<ConsolidationBranchAuditors engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText('Carried from last year')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expand branch Dubai branch' }));
    const box = screen.getByLabelText('Principal auditor conclusion');
    await userEvent.selectOptions(
      within(box).getByRole('combobox', { name: 'Branch conclusion' }),
      'relied',
    );
    const save = within(box).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(
      within(box).getByLabelText(/Principal auditor's response/),
      'Reviewed the report.',
    );
    apiFetch.mockResolvedValueOnce(view());
    await userEvent.click(save);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/branches/b1`, {
      method: 'PATCH',
      body: { principalResponse: 'Reviewed the report.', conclusion: 'relied', version: 2 },
    });
  });

  it('stays editable when CFS is not required (section 143(8) applies regardless)', async () => {
    apiFetch.mockResolvedValue(view({ matrixState: 'not_required', components: [] }));
    render(wrap(<ConsolidationBranchAuditors engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByRole('button', { name: 'Record BR-01' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add branch auditor/ })).toBeInTheDocument();
  });
});

describe('02.6 consolidation work programme (§19)', () => {
  const programme = (over: Partial<Programme> = {}): Programme =>
    ({
      workflowInstanceId: 'wf1',
      engagementId: 'e1',
      state: 'active',
      reason: 'CFS is required — the consolidation programme is generated.',
      frameworkLabel: 'DHVAJ consolidation programme v1',
      generatedAt: '2026-05-04T10:00:00Z',
      items: [
        {
          id: 'w1',
          itemKey: 'perimeter',
          title: 'Consolidation perimeter',
          objective: 'Confirm every investee is in or out for a reason.',
          evidence: 'Perimeter schedule.',
          activation: 'always',
          applicable: true,
          basis: 'Always applies.',
          procedureId: 'p1',
          procedureRef: 'P-21',
          procedureStatus: 'in_progress',
          withdrawn: false,
        },
        {
          id: 'w2',
          itemKey: 'equity_method',
          title: 'Equity-method investees',
          objective: 'Apply the equity method.',
          evidence: 'Associate accounts.',
          activation: 'associate_jv',
          applicable: false,
          basis: 'No associates or joint ventures in the perimeter.',
          procedureId: null,
          procedureRef: null,
          procedureStatus: null,
          withdrawn: false,
        },
      ],
      linked: 1,
      readOnly: false,
      ...over,
    }) as Programme;

  it('lists the items with their Section 06 link and expands the applicability basis', async () => {
    apiFetch.mockResolvedValue(programme());
    render(wrap(<ConsolidationWorkProgramme engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText('Generated')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/work-programme`);
    expect(screen.getByText('1 of 1 in Section 06')).toBeInTheDocument();
    expect(screen.getByText('P-21 · in progress')).toBeInTheDocument();
    expect(screen.getByText('N/A')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Expand work item Equity-method investees' }),
    );
    expect(screen.getByText(/No associates or joint ventures/)).toBeInTheDocument();
  });

  it('shows a withdrawn programme without the Section 06 count', async () => {
    apiFetch.mockResolvedValue(
      programme({ state: 'withdrawn', reason: 'CFS is no longer required.' }),
    );
    render(wrap(<ConsolidationWorkProgramme engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
    expect(screen.queryByText(/in Section 06$/)).toBeNull();
  });
});

describe('02.6 evidence and memo', () => {
  it('hands the 02.6 sub-assessment to the shared evidence panel', () => {
    const consolidation = {
      workflowInstanceId: 'wf1',
      assessment: { id: 'sa-026' },
      memoSuggested: true,
      capturedFacts: {
        investees: [
          { id: '0b6f2c1e-3d4a-4b5c-8d9e-0f1a2b3c4d5e', name: 'Alpha Ltd' },
          { name: 'Unsaved' },
        ],
      },
    } as unknown as StatutoryAuditConsolidation;
    render(
      wrap(<ConsolidationEvidence engagementId="e1" consolidation={consolidation} readOnly />),
    );
    expect(screen.getByText('shared evidence')).toBeInTheDocument();
    expect(frameworkEvidence).toHaveBeenCalledWith({
      engagementId: 'e1',
      workflowInstanceId: 'wf1',
      subAssessmentId: 'sa-026',
      memoSuggested: true,
      readOnly: true,
      // Relationship files (§5) are badged with the investee's name.
      keyLabels: { rel_0b6f2c1e3d4a4b5c8d9e0f1a2b3c4d5e: 'Alpha Ltd' },
    });
  });
});
