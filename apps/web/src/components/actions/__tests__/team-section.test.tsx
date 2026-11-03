import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TeamMember } from '@/lib/types';
import { LeadsCard, TeamSection } from '../team-section';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => {
  class ApiError extends Error {}
  return { apiFetch: (...args: unknown[]) => apiFetch(...args), ApiError };
});
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const engagement = {
  id: 'eng',
  version: 7,
  engagementPartnerId: 'pa',
  engagementPartnerName: 'Partner A',
  engagementManagerId: 'mx',
  engagementManagerName: 'Manager X',
};
const team = [
  { id: 't1', employeeId: 'sy', employeeName: 'Senior Y', roleOnEngagement: 'member' },
] as TeamMember[];

beforeEach(() => apiFetch.mockReset());

describe('who changes the people on an engagement', () => {
  it('shows everyone the leads and team, with nothing to press', () => {
    render(
      wrap(
        <>
          <LeadsCard engagement={engagement} canChange={false} />
          <TeamSection engagementId="eng" team={team} canChange={false} />
        </>,
      ),
    );
    expect(screen.getByText('Partner A')).toBeTruthy();
    expect(screen.getByText('Manager X')).toBeTruthy();
    expect(screen.getByText('Senior Y')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /change/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull();
    expect(screen.queryByLabelText('Remove Senior Y')).toBeNull();
  });

  it('lets the Managing Partner or an administrator add and remove', () => {
    render(wrap(<TeamSection engagementId="eng" team={team} canChange />));
    expect(screen.getByRole('button', { name: /add/i })).toBeTruthy();
    expect(screen.getByLabelText('Remove Senior Y')).toBeTruthy();
  });

  it('changes the partner with the engagement version, offering partners only', async () => {
    apiFetch.mockImplementation(async (url: string) =>
      url === '/employees/leads'
        ? [
            {
              id: 'pa',
              fullName: 'Partner A',
              gradeName: 'Partner',
              isPartner: true,
              officeCode: 'N',
            },
            {
              id: 'pb',
              fullName: 'Partner B',
              gradeName: 'Partner',
              isPartner: true,
              officeCode: 'N',
            },
            {
              id: 'mz',
              fullName: 'Manager Z',
              gradeName: 'Manager',
              isPartner: false,
              officeCode: 'N',
            },
          ]
        : {},
    );
    render(wrap(<LeadsCard engagement={engagement} canChange />));
    fireEvent.click(screen.getByRole('button', { name: 'Change Engagement Partner' }));
    await screen.findByRole('option', { name: /Partner B/ });
    expect(screen.queryByRole('option', { name: /Manager Z/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Partner A/ })).toBeNull();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pb' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/engagements/eng/reassign-partner', {
        method: 'POST',
        body: { engagementPartnerEmployeeId: 'pb', version: 7 },
      }),
    );
  });

  it('offers any lead as manager and posts to the manager route', async () => {
    apiFetch.mockImplementation(async (url: string) =>
      url === '/employees/leads'
        ? [
            {
              id: 'pb',
              fullName: 'Partner B',
              gradeName: 'Partner',
              isPartner: true,
              officeCode: 'N',
            },
          ]
        : {},
    );
    render(wrap(<LeadsCard engagement={engagement} canChange />));
    fireEvent.click(screen.getByRole('button', { name: 'Change Manager' }));
    await screen.findByRole('option', { name: /Partner B/ });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pb' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/engagements/eng/reassign-manager', {
        method: 'POST',
        body: { engagementManagerEmployeeId: 'pb', version: 7 },
      }),
    );
  });
});
