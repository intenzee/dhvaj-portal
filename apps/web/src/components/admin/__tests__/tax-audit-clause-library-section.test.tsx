import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  TaxAuditLibraryClause,
  TaxAuditLibraryVersion,
  TaxAuditLibraryView,
} from '@hsdg/contracts';
import { TaxAuditClauseLibrarySection } from '../tax-audit-clause-library-section';

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

const version = (x: Partial<TaxAuditLibraryVersion>): TaxAuditLibraryVersion => ({
  id: 'v1',
  versionNo: 1,
  label: 'Form 3CD — Income-tax Rules 1962',
  act: '1961',
  form: '3CD',
  appliesFromFy: '2018-19',
  status: 'published',
  notes: null,
  basedOnVersionNo: null,
  clauseCount: 1,
  publishedAt: '2026-10-01T00:00:00.000Z',
  publishedByName: 'Admin',
  version: 2,
  ...x,
});

const clause = (x: Partial<TaxAuditLibraryClause>): TaxAuditLibraryClause => ({
  id: 'c31',
  clauseNo: '31',
  part: 'B',
  title: 'Loans and deposits',
  subItems: [{ key: 'a', label: 'Loans accepted', kind: 'table' }],
  appliesWhen: { fact: 'loansOrDeposits', is: true },
  notApplicableReason: 'No loans or deposits.',
  defaultPackage: 'loans_deposits',
  defaultGrade: 'article',
  evidence: ['Loan ledgers'],
  draftSource: null,
  partnerReview: false,
  sortOrder: 10,
  ...x,
});

const PUBLISHED: TaxAuditLibraryView = {
  versions: [version({})],
  selected: version({}),
  clauses: [clause({})],
};
const draft = version({
  id: 'v2',
  versionNo: 2,
  label: '2027 amendment',
  appliesFromFy: '2026-27',
  status: 'draft',
  basedOnVersionNo: 1,
  publishedAt: null,
  publishedByName: null,
  version: 1,
});
const DRAFT: TaxAuditLibraryView = {
  versions: [draft, version({})],
  selected: draft,
  clauses: [clause({})],
};

const serve = (view: TaxAuditLibraryView) =>
  apiFetch.mockImplementation(() => Promise.resolve(view));

beforeEach(() => apiFetch.mockReset());

describe('Form 3CD Library administration', () => {
  it('a published version is read-only; a draft copies the newest one', async () => {
    serve(PUBLISHED);
    const user = userEvent.setup();
    render(wrap(<TaxAuditClauseLibrarySection />));
    expect(await screen.findByText(/^Published/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish draft' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Loans and deposits/ }));
    expect(screen.getByDisplayValue('Loans and deposits')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save clause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    const start = screen.getByRole('button', { name: 'Start draft' });
    await user.type(screen.getByLabelText(/Name of the version/), '2027 amendment');
    await user.type(screen.getByLabelText(/First year audited/), '2026');
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText(/First year audited/), '-27');
    serve(DRAFT);
    await user.click(start);
    expect(apiFetch).toHaveBeenCalledWith('/tax-audit-clause-library/drafts', {
      method: 'POST',
      body: {
        label: '2027 amendment',
        act: '1961',
        appliesFromFy: '2026-27',
        notes: null,
        basedOnVersionNo: 1,
      },
    });
    expect(await screen.findByRole('button', { name: 'Publish draft' })).toBeInTheDocument();
  });

  it('a new form is imported as a JSON list of clauses', async () => {
    serve(PUBLISHED);
    const user = userEvent.setup();
    render(wrap(<TaxAuditClauseLibrarySection />));
    await user.click(await screen.findByLabelText(/Import a new form/));
    await user.type(screen.getByLabelText(/Name of the version/), 'Act 2025');
    await user.selectOptions(screen.getByLabelText('Act'), '2025');
    await user.type(screen.getByLabelText(/First year audited/), '2030-31');
    await user.click(screen.getByLabelText('Clauses JSON'));
    await user.paste('{"clauseNo": "1"}');
    await user.click(screen.getByRole('button', { name: 'Start draft' }));
    expect(screen.getByText('The import must be a JSON list of clauses.')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await user.clear(screen.getByLabelText('Clauses JSON'));
    await user.paste('[{"clauseNo": "1"}]');
    await user.click(screen.getByRole('button', { name: 'Start draft' }));
    expect(apiFetch).toHaveBeenCalledWith('/tax-audit-clause-library/drafts', {
      method: 'POST',
      body: expect.objectContaining({
        act: '2025',
        appliesFromFy: '2030-31',
        clauses: [{ clauseNo: '1' }],
      }),
    });
    const body = apiFetch.mock.calls.find((c) => c[0] === '/tax-audit-clause-library/drafts')![1]
      .body as Record<string, unknown>;
    expect(body).not.toHaveProperty('basedOnVersionNo');
  });

  it('publishing and discarding ask first', async () => {
    serve(DRAFT);
    const user = userEvent.setup();
    render(wrap(<TaxAuditClauseLibrarySection />));
    await user.click(await screen.findByRole('button', { name: 'Publish draft' }));
    expect(screen.getByText(/can no longer be edited/)).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(apiFetch).toHaveBeenCalledWith('/tax-audit-clause-library/2/publish', {
      method: 'POST',
      body: {},
    });

    await user.click(await screen.findByRole('button', { name: 'Discard draft' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(apiFetch).toHaveBeenCalledWith('/tax-audit-clause-library/2', {
      method: 'DELETE',
      body: undefined,
    });
  });

  it('edits a draft clause, reads its condition out, and asks for the N/A reason', async () => {
    serve(DRAFT);
    const user = userEvent.setup();
    render(wrap(<TaxAuditClauseLibrarySection />));
    const item = (await screen.findByRole('button', { name: /Loans and deposits/ })).closest('li')!;
    await user.click(within(item).getByRole('button', { name: /Loans and deposits/ }));
    expect(
      within(item).getByText(/Took or repaid loans, deposits or specified sums/),
    ).toBeInTheDocument();

    const reason = within(item).getByLabelText(/Why it is Not applicable/);
    await user.clear(reason);
    expect(within(item).getByText(/Say why the clause is Not applicable/)).toBeInTheDocument();
    expect(within(item).getByRole('button', { name: 'Save clause' })).toBeDisabled();
    await user.type(reason, 'None taken or repaid.');

    const evidence = within(item).getByLabelText(/Evidence/);
    await user.type(evidence, '\nConfirmations');
    await user.click(within(item).getByRole('button', { name: 'Save clause' }));
    expect(apiFetch).toHaveBeenCalledWith('/tax-audit-clause-library/2/clauses/c31', {
      method: 'PUT',
      body: expect.objectContaining({
        clauseNo: '31',
        notApplicableReason: 'None taken or repaid.',
        evidence: ['Loan ledgers', 'Confirmations'],
        appliesWhen: { fact: 'loansOrDeposits', is: true },
      }),
    });
    const body = apiFetch.mock.calls.find((c) => String(c[0]).endsWith('/clauses/c31'))![1]
      .body as Record<string, unknown>;
    expect(body).not.toHaveProperty('id');
  });

  it('refuses an unknown fact before saving, and removes a clause', async () => {
    serve(DRAFT);
    const user = userEvent.setup();
    render(wrap(<TaxAuditClauseLibrarySection />));
    await user.click(await screen.findByRole('button', { name: /Add a clause to v2/ }));
    const add = screen.getByRole('button', { name: 'Add clause' });
    const item = add.closest('li')!;
    await user.type(within(item).getByLabelText(/^Clause/), '45');
    await user.type(within(item).getByLabelText(/Title/), 'A new clause');
    await user.click(within(item).getByLabelText('Applies when'));
    await user.paste('{"fact": "hasYacht", "is": true}');
    expect(within(item).getByText(/"hasYacht" is not an audit fact/)).toBeInTheDocument();
    expect(add).toBeDisabled();
    await user.clear(within(item).getByLabelText('Applies when'));
    expect(add).toBeEnabled();
    await user.click(add);
    expect(apiFetch).toHaveBeenCalledWith('/tax-audit-clause-library/2/clauses', {
      method: 'POST',
      body: expect.objectContaining({
        clauseNo: '45',
        appliesWhen: null,
        notApplicableReason: null,
        sortOrder: 20,
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(apiFetch).toHaveBeenCalledWith('/tax-audit-clause-library/2/clauses/c31', {
      method: 'DELETE',
      body: undefined,
    });
  });
});
