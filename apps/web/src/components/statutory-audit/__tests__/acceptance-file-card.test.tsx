import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AcceptanceFileCard } from '../acceptance-file-card';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  fetchBlob: jest.fn(),
  downloadFile: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const file = {
  id: 'f1',
  slotKey: 'previous_auditor_communication',
  documentId: 'd1',
  title: 'Communication to Previous Auditor',
  filename: 'Communication to Previous Auditor - Acme.docx',
  status: 'ready_to_send',
  meta: {},
  templateKey: 'previous_auditor_communication',
  templateVariantKey: 'standard',
  templateVersionNo: 2,
  currentVersionNo: 3,
  lastEditedBy: 'Asha Manager',
  lastSavedAt: '2024-04-10T10:00:00Z',
  inSharePoint: true,
  editLocked: false,
  version: 4,
};

const view = (over: Record<string, unknown> = {}) => ({
  workflowInstanceId: 'wf1',
  sectionLocked: false,
  callerIsEngagementPartner: false,
  m365Enabled: true,
  files: [],
  templates: [
    {
      templateKey: 'auditor_consent_certificate',
      title: 'Auditor Consent / Eligibility Certificate',
      variantKey: null,
      versionNo: null,
      available: false,
      reason: 'No approved DHVAJ template yet — an administrator must upload and approve one.',
    },
  ],
  ...over,
});

beforeEach(() => apiFetch.mockReset());

describe('Section 01 file card', () => {
  it('explains why Create from Template is unavailable', async () => {
    apiFetch.mockResolvedValue(view());
    render(
      wrap(
        <AcceptanceFileCard engagementId="e1" workflowInstanceId="wf1" slotKey="consent_certificate" editable />,
      ),
    );
    expect(await screen.findByRole('button', { name: /Create from DHVAJ Template/ })).toBeDisabled();
    expect(screen.getByText(/an administrator must upload and approve one/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add File/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Link Existing File/ })).toBeEnabled();
  });

  it('asks for the date and mode inline before marking the communication sent', async () => {
    apiFetch.mockResolvedValue(view({ files: [file] }));
    render(
      wrap(
        <AcceptanceFileCard
          engagementId="e1"
          workflowInstanceId="wf1"
          slotKey="previous_auditor_communication"
          editable
        />,
      ),
    );
    expect(await screen.findByText(/v3 · last edited by Asha Manager/)).toBeInTheDocument();
    expect(screen.getByText(/template v2/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Mark Sent' })[0]!);
    const submit = screen.getAllByRole('button', { name: 'Mark Sent' })[1]!;
    expect(submit).toBeDisabled(); // the mode is still missing
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Mode/ }), 'registered_post');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/acceptance/files/f1/status',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          status: 'sent',
          version: 4,
          meta: expect.objectContaining({ sentMode: 'registered_post' }),
        }),
      }),
    );
  });

  it('leaves a locked section read-only', async () => {
    apiFetch.mockResolvedValue(view({ sectionLocked: true, files: [{ ...file, status: 'sent', editLocked: true }] }));
    render(
      wrap(
        <AcceptanceFileCard
          engagementId="e1"
          workflowInstanceId="wf1"
          slotKey="previous_auditor_communication"
          editable
        />,
      ),
    );
    expect(await screen.findByText('Read-only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Version History/ })).toBeInTheDocument();
  });
});
