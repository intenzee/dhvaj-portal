import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { NoticeIntakeResponse, NoticeType } from '@hsdg/contracts';
import { NewNoticeModal } from '../new-notice-modal';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const TYPES: NoticeType[] = [
  {
    id: 't1',
    code: 'GST_ASMT_10',
    stream: 'gst',
    form: 'ASMT-10',
    section: 's.61',
    title: 'Scrutiny of returns',
    defaultReplyDays: 30,
    appealable: false,
    appealRuleCode: null,
    isActive: true,
    version: 1,
  },
];
const INTAKE: NoticeIntakeResponse = {
  documentId: 'doc-1',
  ocrStatus: 'done',
  fields: {
    referenceNo: { value: 'ZA0710260012345', confidence: 0.95, snippet: 'Ref ZA0710260012345' },
    issuedOn: { value: '2026-10-07', confidence: 0.7, snippet: 'Date: 07/10/2026' },
    gstin: { value: '27AAAPL1234C1ZV', confidence: 0.99, snippet: null },
  },
  noticeTypeCode: { value: 'GST_ASMT_10', confidence: 0.9, snippet: 'FORM GST ASMT-10' },
  clients: [
    {
      entityId: 'ent-1',
      entityName: 'Acme Pvt Ltd',
      matchedOn: 'gstin',
      registrationId: 'reg-1',
      engagements: [{ id: 'eng-1', code: 'CMP-001', name: 'GST compliance' }],
    },
  ],
};

beforeEach(() => {
  apiFetch.mockReset();
  let intakeCalls = 0;
  apiFetch.mockImplementation(
    (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/notice-types') return Promise.resolve(TYPES);
      if (path.startsWith('/employees')) return Promise.resolve({ items: [], total: 0 });
      if (path.startsWith('/engagements?entityId=ent-1'))
        return Promise.resolve({
          items: [
            {
              id: 'eng-1',
              engagementCode: 'CMP-001',
              serviceName: 'GST compliance',
              financialYear: '2026-27',
            },
          ],
          total: 1,
        });
      if (path === '/engagements/eng-1/documents') return Promise.resolve({ id: 'doc-1' });
      if (path === '/notices/intake') {
        intakeCalls += 1;
        // OCR still running on the first read.
        return Promise.resolve(
          intakeCalls === 1
            ? { ...INTAKE, ocrStatus: 'pending', fields: {}, noticeTypeCode: null, clients: [] }
            : INTAKE,
        );
      }
      if (path === '/notices' && init?.method === 'POST')
        return Promise.resolve({ id: 'n-1', ...init.body });
      return Promise.reject(new Error(`unexpected ${path}`));
    },
  );
});

it('starts from the PDF: files it, polls the read, pre-fills, and creates with the document', async () => {
  const onCreated = jest.fn();
  render(
    wrap(
      <NewNoticeModal
        onClose={jest.fn()}
        onCreated={onCreated}
        pollMs={50}
        initial={{ entityId: 'ent-1', entityName: 'Acme Pvt Ltd', engagementId: 'eng-1' }}
      />,
    ),
  );
  const user = userEvent.setup();
  const pdf = new File(['%PDF-1.4'], 'asmt10.pdf', { type: 'application/pdf' });
  await user.upload(screen.getByLabelText('Notice PDF'), pdf);

  // The PDF is filed on the engagement as a notice document.
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/eng-1/documents',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ documentType: 'notice', filename: 'asmt10.pdf' }),
      }),
    ),
  );
  // Polls while pending, then pre-fills.
  await waitFor(
    () =>
      expect((screen.getByDisplayValue('ZA0710260012345') as HTMLInputElement).value).toBe(
        'ZA0710260012345',
      ),
    { timeout: 10000 },
  );
  expect(screen.getByDisplayValue('2026-10-07')).toBeInTheDocument();
  // Issued on was read at 0.7 — flagged for checking, with the text it came from.
  expect(screen.getByText(/Date: 07\/10\/2026/)).toBeInTheDocument();
  expect(screen.getByText(/Matches Acme Pvt Ltd on its/)).toBeInTheDocument();
  // Reply due follows the type's 30 days from the issue date.
  expect(screen.getByDisplayValue('2026-11-06')).toBeInTheDocument();
  // Nothing saved yet.
  expect(apiFetch).not.toHaveBeenCalledWith('/notices', expect.anything());

  await user.click(screen.getByRole('button', { name: 'Add notice' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(apiFetch).toHaveBeenCalledWith(
    '/notices',
    expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        engagementId: 'eng-1',
        noticeTypeCode: 'GST_ASMT_10',
        referenceNo: 'ZA0710260012345',
        issuedOn: '2026-10-07',
        replyDueOn: '2026-11-06',
        registrationId: 'reg-1',
        documentId: 'doc-1',
      }),
    }),
  );
}, 30000);
