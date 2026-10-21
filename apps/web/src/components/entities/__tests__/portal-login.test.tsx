import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  ClientCredential,
  ClientImportPreview,
  ClientImportResult,
  ClientImportRow,
  EntityCredentials,
} from '@hsdg/contracts';
import {
  ClientLogins,
  PortalLogin,
  hidesIn,
  loginTargetsOf,
  pendingNote,
  type LoginTarget,
} from '../portal-login';
import { gstLine, importButtonLabel, monthLabel, resultLines } from '../client-import';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
let permissions: string[] = [];
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: { permissions } }) }));

const credential: ClientCredential = {
  id: 'c1',
  entityId: 'e1',
  registrationId: 'r1',
  registrationNumber: '07AAACB1234C1Z5',
  stateCode: '07',
  portal: 'gst',
  account: 'main',
  usernameHint: 'bh•••tr',
  pendingFrequency: null,
  updatedAt: '2026-10-15T05:00:00Z',
  updatedBy: 'Partner A',
};
const gstTarget: LoginTarget = { portal: 'gst', account: 'main', registrationId: 'r1' };

const wrap = (ui: JSX.Element) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const renderIt = (c: ClientCredential | undefined, vaultReady = true) =>
  wrap(<PortalLogin entityId="e1" target={gstTarget} credential={c} vaultReady={vaultReady} />);

describe('portal logins (ADR-0035)', () => {
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
        body: {
          entityId: 'e1',
          registrationId: 'r1',
          portal: 'gst',
          account: 'main',
          username: 'bharat_tr',
          password: 'pw',
        },
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

  it('a TAN carries the income-tax and TRACES deductor logins; a GSTIN the GST one', () => {
    expect(loginTargetsOf({ id: 't1', registrationType: 'tan' }).map((t) => t.account)).toEqual([
      'tan',
      'deductor',
    ]);
    expect(loginTargetsOf({ id: 'r1', registrationType: 'gstin' })).toEqual([gstTarget]);
    expect(loginTargetsOf({ id: 'x', registrationType: 'cin' })).toEqual([]);
  });

  it('lists the PAN logins and the GST logins waiting for a GSTIN', () => {
    permissions = ['credential.reveal'];
    const pending: ClientCredential = {
      ...credential,
      id: 'c2',
      registrationId: null,
      registrationNumber: null,
      stateCode: '27',
      pendingFrequency: 'quarterly',
      usernameHint: 'mh•••01',
    };
    const pan: ClientCredential = {
      ...credential,
      id: 'c3',
      registrationId: null,
      registrationNumber: null,
      stateCode: null,
      portal: 'income_tax',
      usernameHint: 'AB•••Z',
    };
    expect(pendingNote(pending)).toBe('Maharashtra · GSTIN to come · Quarterly');
    expect(pendingNote(credential)).toBeUndefined();
    const data: EntityCredentials = {
      vaultReady: true,
      items: [credential, pending, pan],
      recentAccess: [],
    };
    wrap(<ClientLogins entityId="e1" data={data} />);
    expect(screen.getByText('Income-tax (PAN) login')).toBeInTheDocument();
    expect(screen.getByText('AB•••Z')).toBeInTheDocument();
    expect(screen.getByText('· Maharashtra · GSTIN to come · Quarterly')).toBeInTheDocument();
    // The GSTIN's own login is shown under its registration, not here.
    expect(screen.queryByText('bh•••tr')).toBeNull();
    // Without credential.manage there is nothing to add.
    expect(screen.queryByText(/Add TRACES/)).toBeNull();
  });
});

describe('client login workbook import', () => {
  const row = (over: Partial<ClientImportRow>): ClientImportRow => ({
    key: 'k',
    source: 'GST Login 5',
    sheet: 'GST Login',
    row: 5,
    name: 'X',
    pan: 'P1',
    tan: null,
    email: null,
    typeSlug: 'private_limited',
    typeGuessed: false,
    gst: [],
    logins: [{ portal: 'gst', account: 'main', usernameHint: 'x•••', target: 'GSTIN 07…' }],
    action: 'create_client',
    entityId: null,
    entityName: null,
    warnings: [],
    error: null,
    ...over,
  });
  const preview = (rows: ClientImportRow[]): ClientImportPreview => {
    const counts = { create_client: 0, update_client: 0, unchanged: 0, error: 0 };
    for (const r of rows) counts[r.action] += 1;
    return { sheets: [], months: [], rows, counts, logins: 0, marks: 0, vaultReady: true };
  };

  it('counts new and updated clients and the logins that will be saved', () => {
    expect(
      importButtonLabel(
        preview([
          row({}),
          row({ key: 'b', logins: [] }),
          row({ key: 'c', action: 'update_client' }),
          row({ key: 'd', action: 'error' }),
        ]),
      ),
    ).toBe('Import 2 new clients, update 1 client, 2 logins');
    expect(importButtonLabel(preview([row({ action: 'unchanged', logins: [] })]))).toBe(
      'Nothing to import',
    );
  });

  it('describes months and GST registrations', () => {
    expect(monthLabel('2026-04')).toBe('Apr 2026');
    expect(
      gstLine({
        sheet: 'S',
        row: 1,
        gstin: null,
        stateCode: '27',
        frequency: 'quarterly',
        filed: 3,
        notApplicable: 1,
      }),
    ).toBe('Maharashtra · Quarterly · 3 filed, 1 NA');
  });

  it('says which marks waited for a GST engagement', () => {
    const r: ClientImportResult = {
      clientsCreated: 3,
      clientsUpdated: 0,
      unchanged: 0,
      registrationsAdded: 3,
      loginsSaved: 8,
      schemesSet: 2,
      marksRecorded: 4,
      marksApplied: 0,
      marksAlreadyDone: 0,
      marksWithoutFiling: 4,
      marksNotAllowed: 0,
      failed: [],
      notes: [],
    };
    const lines = resultLines(r);
    expect(lines[0]).toBe('3 new clients · 0 clients updated · 0 already here');
    expect(lines[1]).toBe(
      '3 registrations added · 8 logins saved (encrypted) · 2 GSTINs set monthly / quarterly',
    );
    expect(lines[2]).toBe(
      "4 filed / NA marks kept as the clients' GST return history (Clients → GST returns)",
    );
    expect(lines[3]).toMatch(
      /^4 filed \/ NA marks not applied to a filing: the client has no GST engagement/,
    );
  });
});
