import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GstImportPreview, GstImportRow, RegistrationCredential } from '@hsdg/contracts';
import { PortalLogin, hidesIn } from '../portal-login';
import { importButtonLabel } from '../gst-import';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
let permissions: string[] = [];
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: { permissions } }) }));

const credential: RegistrationCredential = {
  id: 'c1',
  registrationId: 'r1',
  portal: 'gst',
  usernameHint: 'bh•••tr',
  updatedAt: '2026-10-15T05:00:00Z',
  updatedBy: 'Partner A',
};

const renderIt = (c: RegistrationCredential | undefined, vaultReady = true) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PortalLogin registrationId="r1" credential={c} vaultReady={vaultReady} />
    </QueryClientProvider>,
  );

describe('GST portal login (ADR-0035)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
    permissions = ['credential.reveal'];
  });
  afterEach(() => jest.useRealTimers());

  it('counts down the seconds a login stays shown', () => {
    expect(hidesIn(0, 0)).toBe(30);
    expect(hidesIn(0, 12_400)).toBe(18);
    expect(hidesIn(0, 45_000)).toBe(0);
  });

  it('shows only the masked user name until Show, then hides itself after 30 s', async () => {
    jest.useFakeTimers();
    apiFetch.mockResolvedValue({
      id: 'c1',
      portal: 'gst',
      username: 'bharat_tr',
      password: 'S3cret!',
    });
    renderIt(credential);
    expect(screen.getByText('bh•••tr')).toBeInTheDocument();
    expect(screen.queryByText('S3cret!')).toBeNull();
    expect(screen.queryByLabelText('Change GST login')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(await screen.findByText('S3cret!')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/credentials/c1/reveal', { method: 'POST' });
    expect(screen.getByText(/hides in 30s/i)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(31_000);
    });
    await waitFor(() => expect(screen.queryByText('S3cret!')).toBeNull());
  });

  it('Hide forgets the login at once', async () => {
    apiFetch.mockResolvedValue({ id: 'c1', portal: 'gst', username: 'u', password: 'pw-1' });
    renderIt(credential);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    await screen.findByText('pw-1');
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(screen.queryByText('pw-1')).toBeNull();
  });

  it('lets a manager add a login, sending it once and clearing the field', async () => {
    permissions = ['credential.manage'];
    apiFetch.mockResolvedValue(credential);
    renderIt(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Add GST login' }));
    fireEvent.change(screen.getByLabelText('GST user name'), { target: { value: 'bharat_tr' } });
    fireEvent.change(screen.getByLabelText('GST password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/credentials', {
        method: 'PUT',
        body: { registrationId: 'r1', portal: 'gst', username: 'bharat_tr', password: 'pw' },
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText('GST password')).toBeNull());
  });

  it('says so when the server cannot keep logins, and shows nothing to people without one', () => {
    permissions = ['credential.manage'];
    renderIt(undefined, false);
    expect(screen.getByText(/no encryption key/i)).toBeInTheDocument();
    permissions = ['credential.reveal'];
    const { container } = renderIt(undefined);
    expect(container.querySelector('button')).toBeNull();
  });
});

describe('GST client import button', () => {
  const row = (over: Partial<GstImportRow>): GstImportRow => ({
    row: 2,
    gstin: 'G',
    legalName: 'X',
    tradeName: null,
    pan: 'P1',
    stateCode: '07',
    typeSlug: 'private_limited',
    hasLogin: true,
    usernameHint: 'x•••',
    email: null,
    phone: null,
    action: 'create_client',
    entityId: null,
    entityName: null,
    message: null,
    ...over,
  });
  const preview = (rows: GstImportRow[]): GstImportPreview => {
    const counts = {
      create_client: 0,
      add_registration: 0,
      update_login: 0,
      unchanged: 0,
      error: 0,
    };
    for (const r of rows) counts[r.action] += 1;
    return { sheet: 'S', headers: [], mapping: {} as never, rows, counts, vaultReady: true };
  };

  it('counts clients by PAN, added GSTINs and logins', () => {
    expect(
      importButtonLabel(
        preview([
          row({}),
          row({ row: 3 }),
          row({ row: 4, pan: 'P2', hasLogin: false }),
          row({ row: 5, action: 'add_registration' }),
          row({ row: 6, action: 'error' }),
        ]),
      ),
    ).toBe('Import 2 new clients, 1 GSTIN to existing clients, 3 logins');
    expect(importButtonLabel(preview([row({ action: 'unchanged', hasLogin: false })]))).toBe(
      'Nothing to import',
    );
  });
});
