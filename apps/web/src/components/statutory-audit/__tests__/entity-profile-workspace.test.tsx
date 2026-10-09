import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  PROFILE_CARDS,
  PROFILE_CARD_TITLE,
  PROFILE_CONFIRMATION_STATEMENT,
  SECTION_02_NAV,
  type StatutoryAuditEntityProfile,
} from '@hsdg/contracts';
import { EntityProfileCard } from '../entity-profile-card';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => true }));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));
jest.mock('@/components/document-preview', () => ({ DocumentPreview: () => null }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const BASE = '/engagements/e1/statutory-audit/wf1/profile';

function profile(over: Partial<StatutoryAuditEntityProfile> = {}): StatutoryAuditEntityProfile {
  const row = (parameter: string, label: string, value: number | null) => ({
    parameter,
    label,
    current: { value, origin: value == null ? null : 'captured', sourceLabel: value == null ? null : 'Audited financial statements', asOf: '2025-03-31' },
    prior: { value: null, origin: null, sourceLabel: null, asOf: null },
    captured: null,
    conflict: null,
    required: true,
  });
  return {
    workflowInstanceId: 'wf1',
    engagementServiceId: 'es1',
    engagementId: 'e1',
    state: 'draft',
    financialYear: '2024-25',
    classification: {
      entityTypeName: 'Private Limited Company',
      category: 'company',
      isCompany: true,
      isPrivateCompany: true,
      isListed: false,
    },
    specialEntityTypes: [],
    groupHasRelationships: false,
    initialAudit: false,
    initialAuditSystemDerived: true,
    jointAudit: false,
    accountingEnvironment: null,
    financials: [],
    masterFacts: [],
    smallCompany: { outcome: 'small', basis: 'Within both §2(85) limits.', ruleVersionId: 'r1', authorityProvisionId: 'ap1' },
    saTriggers: [
      { code: 'SA 510', triggered: false, basis: 'Continuing audit.' },
      { code: 'SA 402', triggered: false, basis: '' },
      { code: 'SA 299', triggered: false, basis: '' },
    ],
    confirmation: null,
    needsReevaluation: false,
    missingFacts: [],
    missingFactFixes: [],
    readyToConfirm: false,
    header: { managerName: 'Manager X', partnerName: 'Partner A', lastUpdatedByName: 'Senior Y', lastUpdatedAt: '2026-10-01T10:00:00Z' },
    companyType: 'private',
    listing: { masterListed: false, masterInProcess: false, answer: null, inProcess: null, lines: [] },
    specialEntitySuggested: [],
    nbfcCategory: null,
    regulator: null,
    regulatorName: null,
    regulatorDetails: null,
    groupFlags: { isHolding: false, isSubsidiary: false, isAssociate: false, isJointVenture: false, hasInvestees: false },
    groupEntities: [],
    financialRows: [row('paid_up_capital', 'Paid-up Share Capital', 20000000), row('turnover', 'Turnover / Revenue', null)],
    smallCompanyConclusion: { systemOutcome: 'small', finalOutcome: 'small', override: null, factsConsidered: [] },
    period: { from: '2024-04-01', to: '2025-03-31', nonStandard: false, firstFinancialYear: false, differentFyApproved: null },
    accounting: {
      software: null,
      softwareOther: null,
      recordsElectronic: null,
      recordsDescription: null,
      serviceOrg: null,
      serviceOrgService: null,
      serviceOrgProvider: null,
    },
    jointAuditors: [],
    cards: PROFILE_CARDS.map((key) => ({
      key,
      title: PROFILE_CARD_TITLE[key],
      status: key === 'D' || key === 'G' ? 'derived' : 'system_suggested',
      confirmation: null,
    })),
    completeness: {
      status: 'information_incomplete',
      percent: 18,
      satisfied: 2,
      total: 11,
      items: [
        { key: 'unconfirmed:A', card: 'A', label: 'Confirm Basic Company Classification.', kind: 'unconfirmed', blocking: true, fix: null },
        { key: 'financial:turnover', card: 'D', label: 'Turnover / Revenue unavailable.', kind: 'pending', blocking: false, fix: null },
      ],
    },
    references: [
      {
        anchor: 'small_company',
        label: 'Section 2(85) - Small Company',
        code: 'COS_ACT_2_85',
        provision: {
          id: 'ap1',
          code: 'COS_ACT_2_85',
          authority: 'MCA',
          title: 'Small company',
          provisionNumber: 'Section 2(85)',
          effectiveFrom: '2022-09-15',
          effectiveTo: null,
          sourceReference: null,
          supersededById: null,
          methodologyVersionScope: null,
          referenceKind: 'provision',
          summary: 'Paid-up capital ≤ ₹4 crore and turnover ≤ ₹40 crore.',
          sourceUrl: null,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      },
    ],
    files: [],
    priorYear: null,
    sectionNav: SECTION_02_NAV.map((n) => ({ ...n, status: n.key === '02.1' ? 'in_progress' : 'not_started' })),
    reopen: null,
    version: 4,
    ...over,
  } as StatutoryAuditEntityProfile;
}

function serve(p: StatutoryAuditEntityProfile) {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) =>
    url === '/engagements/e1/statutory-audit/profile' ? Promise.resolve([p]) : Promise.resolve(p),
  );
}

async function openWorkspace() {
  const user = userEvent.setup();
  render(wrap(<EntityProfileCard engagementId="e1" />));
  await user.click(await screen.findByRole('button', { name: /Open the 02.1 workspace/ }));
  return user;
}

describe('02.1 workspace', () => {
  it('shows the header, the Section 02 navigation and Cards A–J', async () => {
    serve(profile());
    await openWorkspace();
    expect(screen.getByText(/DHVAJ will use these facts to determine/)).toBeInTheDocument();
    expect(screen.getByText('Manager X')).toBeInTheDocument();
    expect(screen.getByText('18%')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Section 02' });
    expect(within(nav).getByText('02.10')).toBeInTheDocument();
    for (const key of PROFILE_CARDS) expect(screen.getAllByText(PROFILE_CARD_TITLE[key]).length).toBeGreaterThan(0);
  });

  it('Save Draft sends only what changed, with the version', async () => {
    serve(profile());
    const user = await openWorkspace();
    await user.selectOptions(screen.getByLabelText(/Are any securities of the company listed/), 'no');
    await user.click(screen.getByRole('button', { name: /Save Draft/ }));
    expect(apiFetch).toHaveBeenCalledWith(BASE, { method: 'POST', body: { listingAnswer: 'no', version: 4 } });
  });

  it('confirms a card on its own', async () => {
    serve(profile());
    const user = await openWorkspace();
    const cardA = document.getElementById('profile-card-A')!;
    await user.click(within(cardA).getByRole('button', { name: /^Confirm$/ }));
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/cards/confirm`, {
      method: 'POST',
      body: { card: 'A', version: 4 },
    });
  });

  it('Card E override needs a reason and keeps the system result', async () => {
    serve(profile());
    const user = await openWorkspace();
    const cardE = document.getElementById('profile-card-E')!;
    await user.click(within(cardE).getByRole('button', { name: /^Override$/ }));
    const record = within(cardE).getByRole('button', { name: /Record override/ });
    expect(record).toBeDisabled();
    await user.type(within(cardE).getByLabelText(/Reason for override/), 'Capital raised after year end.');
    await user.click(record);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/small-company`, {
      method: 'POST',
      body: { action: 'override', outcome: 'not_small', reason: 'Capital raised after year end.', version: 4 },
    });
  });

  it('CONFIRM PROFILE waits for Card J and the confirmation statement', async () => {
    serve(profile({ readyToConfirm: true, completeness: { status: 'information_incomplete', percent: 90, satisfied: 10, total: 11, items: [] } }));
    const user = await openWorkspace();
    const confirm = screen.getByRole('button', { name: /CONFIRM PROFILE/ });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByLabelText(PROFILE_CONFIRMATION_STATEMENT));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/confirm`, { method: 'POST', body: { acknowledged: true } });
  });

  it('opens the provision viewer in place for the engagement period', async () => {
    serve(profile());
    const user = await openWorkspace();
    const cardE = document.getElementById('profile-card-E')!;
    await user.click(within(cardE).getByRole('button', { name: /View Provision — Section 2\(85\)/ }));
    expect(within(cardE).getByText(/Paid-up capital ≤ ₹4 crore/)).toBeInTheDocument();
    expect(within(cardE).getByText('No source link maintained yet.')).toBeInTheDocument();
  });

  it('a confirmed profile is read-only and reopens only with a reason', async () => {
    serve(
      profile({
        state: 'confirmed',
        confirmation: { methodologyVersion: 'v2026.1', confirmedByName: 'Partner A', confirmedAt: '2026-10-02T10:00:00Z', statement: PROFILE_CONFIRMATION_STATEMENT, note: null },
      }),
    );
    const user = await openWorkspace();
    expect(screen.queryByRole('button', { name: /Save Draft/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Reopen profile/ }));
    const reopen = screen.getByRole('button', { name: /^Reopen$/ });
    expect(reopen).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason for reopening/), 'Turnover corrected.');
    await user.click(reopen);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/reopen`, { method: 'POST', body: { reason: 'Turnover corrected.' } });
  });
});
