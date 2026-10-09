import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuthorityProvisionRecord, AuthorityReference } from '@hsdg/contracts';
import { FrameworkEvidence } from '../framework-evidence';
import { FrameworkReferences } from '../framework-references';
import { FinancialReportingDownstream } from '../framework-downstream';
import { ProvisionViewer } from '../provision-viewer';
import { OpenSourceLink } from '../framework-source-link';

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

// ── Evidence / Technical memo (§7, §18) ──────────────────────────────────────

const BASE = '/engagements/e1/statutory-audit/wf1/framework/s1/evidence';
const evidence = (over: Record<string, unknown> = {}) => ({
  subAssessmentId: 's1',
  subSectionKey: '02.2',
  workflowInstanceId: 'wf1',
  readOnly: false,
  m365Enabled: false,
  files: [
    {
      id: 'f1',
      documentId: 'd1',
      kind: 'evidence',
      title: 'Listing certificate',
      filename: 'Listing certificate.pdf',
      currentVersionNo: 1,
      lastEditedBy: null,
      lastSavedAt: null,
      linkedByName: 'Partner A',
      linkedAt: '2026-05-04T10:00:00Z',
      inSharePoint: false,
      editLocked: false,
      templateVariantKey: null,
      templateVersionNo: null,
      questionKey: null,
    },
  ],
  memo: { templateAvailable: true, reason: null, memoFileId: null },
  ...over,
});
const evidencePanel = (props: { memoSuggested?: boolean; readOnly?: boolean } = {}) =>
  wrap(
    <FrameworkEvidence
      engagementId="e1"
      workflowInstanceId="wf1"
      subAssessmentId="s1"
      memoSuggested={props.memoSuggested ?? false}
      readOnly={props.readOnly ?? false}
    />,
  );

describe('02.2 evidence and technical memo', () => {
  it('lists the evidence with its actions; the memo is offered only on demand for routine cases', async () => {
    apiFetch.mockResolvedValue(evidence());
    render(evidencePanel());
    expect(await screen.findByText('Listing certificate.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add File/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Link Existing File/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create Technical Memo/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Technical memo…/ }));
    expect(screen.getByRole('button', { name: /Create Technical Memo/ })).toBeEnabled();
  });

  it('suggests the memo when the conclusion needs one and creates it', async () => {
    apiFetch.mockResolvedValueOnce(evidence()).mockResolvedValueOnce({
      evidence: evidence({ memo: { templateAvailable: true, reason: null, memoFileId: 'f2' } }),
      fileId: 'f2',
      documentId: 'd2',
      editorUrl: null,
      missingFields: [],
    });
    apiFetch.mockResolvedValue({ id: 'd2', title: 'Memo' });
    render(evidencePanel({ memoSuggested: true }));
    await userEvent.click(await screen.findByRole('button', { name: /Create Technical Memo/ }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/financial-reporting/memo',
      { method: 'POST', body: {} },
    );
  });

  it('explains why the memo cannot be created without a firm template', async () => {
    apiFetch.mockResolvedValue(
      evidence({
        memo: {
          templateAvailable: false,
          reason: 'No approved DHVAJ template yet — an administrator must upload and approve one.',
          memoFileId: null,
        },
      }),
    );
    render(evidencePanel({ memoSuggested: true }));
    expect(await screen.findByText(/administrator must upload/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Technical Memo/ })).toBeDisabled();
  });

  it('removes a file and is read-only when the section is', async () => {
    apiFetch.mockResolvedValue(evidence());
    const { unmount } = render(evidencePanel());
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove Listing certificate.pdf' }),
    );
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/f1/unlink`, { method: 'POST', body: {} });
    unmount();

    apiFetch.mockResolvedValue(evidence({ readOnly: true }));
    render(evidencePanel());
    expect(await screen.findByText('Listing certificate.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add File/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Version History/ })).toBeInTheDocument();
  });
});

describe('per-question evidence (FRF-02 / FRF-03)', () => {
  const withQuestion = () =>
    evidence({
      files: [
        { ...evidence().files[0], id: 'f2', filename: 'Ind AS FS.pdf', questionKey: 'frf_02' },
        evidence().files[0],
      ],
    });

  it("shows only the question's files, files new ones under it and offers no memo", async () => {
    apiFetch.mockResolvedValue(withQuestion());
    render(
      wrap(
        <FrameworkEvidence
          engagementId="e1"
          workflowInstanceId="wf1"
          subAssessmentId="s1"
          memoSuggested
          readOnly={false}
          question="frf_02"
        />,
      ),
    );
    expect(await screen.findByText('Ind AS FS.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Listing certificate.pdf')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Technical memo|Create Technical Memo/ }),
    ).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Link Existing File/ }));
    expect(screen.getByLabelText('FRF-02 evidence')).toBeInTheDocument();
  });

  it('the main evidence list shows every file, badged with its question', async () => {
    apiFetch.mockResolvedValue(withQuestion());
    render(evidencePanel());
    expect(await screen.findByText('Ind AS FS.pdf')).toBeInTheDocument();
    expect(screen.getByText('Listing certificate.pdf')).toBeInTheDocument();
    expect(screen.getByText('FRF-02')).toBeInTheDocument();
  });
});

describe('net worth Open Source (§10)', () => {
  it('opens the linked statements from the portal, or the master link', async () => {
    apiFetch.mockResolvedValue({ id: 'd9', title: 'FS' });
    const { unmount } = render(wrap(<OpenSourceLink engagementId="e1" documentId="d9" />));
    await userEvent.click(screen.getByRole('button', { name: /Open Source/ }));
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/documents/d9');
    unmount();
    render(wrap(<OpenSourceLink engagementId="e1" url="https://example.com/fs.pdf" />));
    expect(screen.getByRole('link', { name: /Open Source/ })).toHaveAttribute(
      'href',
      'https://example.com/fs.pdf',
    );
  });

  it('shows nothing without a source', () => {
    const { container } = render(wrap(<OpenSourceLink engagementId="e1" url="file:///c/fs.pdf" />));
    expect(container).toBeEmptyDOMElement();
  });
});

// ── References (§20) ────────────────────────────────────────────────────────

const ref = (anchor: string, label: string, code: string): AuthorityReference => ({
  anchor,
  label,
  code,
  provision: {
    id: `p-${code}`,
    code,
    authority: 'MCA',
    title: label.replace(/^View /, ''),
    provisionNumber: code,
    effectiveFrom: '2015-04-01',
    effectiveTo: null,
    sourceReference: null,
    supersededById: null,
    methodologyVersionScope: null,
    referenceKind: 'provision',
    summary: 'Summary.',
    sourceUrl: 'https://www.mca.gov.in/MinistryV2/Stand.html',
    versionNo: 1,
    changeNote: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
});

describe('02.2 references', () => {
  it('resolves the context through the library for the audit period and narrows to anchors', async () => {
    apiFetch.mockResolvedValue([
      ref('rule_4', 'View Rule 4', 'INDAS_RULE_4'),
      ref('net_worth', 'View Net Worth Definition', 'COS_ACT_2_57'),
      ref('cited_as_rules_2006_smc', 'Rule 2(1)(e) - SMC (2006)', 'AS_RULES_2006_SMC'),
    ]);
    render(
      wrap(
        <FrameworkReferences
          contextKey="02.2"
          anchors={['rule_4']}
          provisionIds={['p2', 'p1']}
          effectiveOn="2024-04-01"
        />,
      ),
    );
    expect(await screen.findByRole('button', { name: /View Rule 4/ })).toBeInTheDocument();
    expect(screen.queryByText(/Net Worth Definition/)).toBeNull();
    // A cited provision always shows.
    expect(screen.getByRole('button', { name: /SMC \(2006\)/ })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      '/authority-provisions/references/02.2?on=2024-04-01&cited=p1%2Cp2',
    );
    await userEvent.click(screen.getByRole('button', { name: /View Rule 4/ }));
    expect(screen.getByRole('link', { name: /Open the MCA source/ })).toHaveAttribute(
      'href',
      'https://www.mca.gov.in/MinistryV2/Stand.html',
    );
  });
});

describe('provision versions (§20)', () => {
  const r = ref('rule_4', 'View Rule 4', 'INDAS_RULE_4');
  const v2: AuthorityProvisionRecord = {
    ...r.provision!,
    id: 'p-v2',
    versionNo: 2,
    effectiveFrom: '2024-04-01',
    provisionNumber: 'Rule 4 (as amended)',
    changeNote: 'Substituted in 2024.',
  };
  const v1: AuthorityProvisionRecord = {
    ...r.provision!,
    effectiveTo: '2024-03-31',
    supersededById: 'p-v2',
  };

  it('shows the version history and, for an earlier period, says a later version exists', async () => {
    apiFetch.mockResolvedValue([v2, v1]);
    render(wrap(<ProvisionViewer reference={{ ...r, provision: v1 }} canAdmin={false} />));
    expect(screen.getByText(/A later version applies from/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Version history/ }));
    expect(await screen.findByText(/Version 2 · Rule 4 \(as amended\)/)).toBeInTheDocument();
    expect(screen.getByText('Substituted in 2024.')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/authority-provisions/INDAS_RULE_4/versions');
    // An older version cannot be superseded, and non-admins see no admin controls.
    expect(screen.queryByRole('button', { name: /Supersede/ })).toBeNull();
  });

  it('lets an administrator supersede the current version with a dated change note', async () => {
    apiFetch.mockResolvedValue(v2);
    render(wrap(<ProvisionViewer reference={r} canAdmin />));
    await userEvent.click(screen.getByRole('button', { name: 'Supersede with a new version' }));
    const form = screen.getByRole('form', { name: 'Supersede with a new version' });
    const submit = screen.getByRole('button', { name: 'Supersede' });
    expect(submit).toBeDisabled();
    const date = form.querySelector('input[type="date"]') as HTMLInputElement;
    await userEvent.type(date, '2024-04-01');
    await userEvent.type(screen.getByLabelText('What changed'), 'Substituted in 2024.');
    await userEvent.click(submit);
    expect(apiFetch).toHaveBeenCalledWith('/authority-provisions/p-INDAS_RULE_4/supersede', {
      method: 'POST',
      body: {
        effectiveFrom: '2024-04-01',
        provisionNumber: null,
        title: null,
        sourceUrl: null,
        summary: null,
        changeNote: 'Substituted in 2024.',
      },
    });
  });
});

// ── Downstream impact (§5, §19) ──────────────────────────────────────────────

const item = (over: Record<string, unknown>) => ({
  key: 'as_review',
  title: 'Accounting Standards review framework',
  detail: 'The AS review applies.',
  target: '02.3',
  provisionCode: null,
  workAreaKey: 'schedule_iii_work',
  managedBy02_2: false,
  status: 'pending',
  activatedAt: null,
  activatedByName: null,
  relaxations: [],
  ...over,
});

describe('02.2 downstream impact', () => {
  it('previews what activates on approval, with the Division and the SMC relaxations', async () => {
    apiFetch.mockResolvedValue({
      workflowInstanceId: 'wf1',
      approved: false,
      framework: 'accounting_standards',
      scheduleIiiDivision: 'I',
      items: [
        item({}),
        item({
          key: 'smc_relaxations',
          title: 'SMC exemptions and relaxations',
          target: 'AS review methodology',
          relaxations: [
            {
              key: 'as17_segment',
              standardCode: 'AS_17',
              standardLabel: 'AS 17 Segment Reporting',
              kind: 'not_applicable',
              paragraphs: null,
              relaxation: 'AS 17 does not apply to an SMC.',
              provisionCode: 'AS_RULES_2021_SMC',
            },
          ],
        }),
      ],
    });
    render(wrap(<FinancialReportingDownstream engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText(/activate when Section 02 is approved/)).toBeInTheDocument();
    expect(screen.getByText('Schedule III Division I')).toBeInTheDocument();
    expect(screen.getAllByText('Activates on approval')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: /Show the 1 SMC exemptions/ }));
    expect(screen.getByText('AS 17 does not apply to an SMC.')).toBeInTheDocument();
  });

  it('shows activated items once Section 02 is approved', async () => {
    apiFetch.mockResolvedValue({
      workflowInstanceId: 'wf1',
      approved: true,
      framework: 'ind_as',
      scheduleIiiDivision: 'II',
      items: [
        item({
          key: 'ind_as_review',
          title: 'Ind AS financial-statement review framework',
          status: 'activated',
          activatedAt: '2026-05-04T10:00:00Z',
          activatedByName: 'Partner A',
        }),
      ],
    });
    render(wrap(<FinancialReportingDownstream engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText(/live in 02.3 and the audit work/)).toBeInTheDocument();
    expect(screen.getByText(/Partner A/)).toBeInTheDocument();
  });

  it('says nothing activates while 02.2 has no conclusion', async () => {
    apiFetch.mockResolvedValue({
      workflowInstanceId: 'wf1',
      approved: false,
      framework: null,
      scheduleIiiDivision: null,
      items: [],
    });
    render(wrap(<FinancialReportingDownstream engagementId="e1" workflowInstanceId="wf1" />));
    expect(await screen.findByText(/Nothing activates yet/)).toBeInTheDocument();
  });
});
