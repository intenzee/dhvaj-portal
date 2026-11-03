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
  {
    id: 't2',
    employeeId: 'ak',
    employeeName: 'Article K',
    roleOnEngagement: 'member',
    openTaskCount: 3,
  },
  { id: 't3', employeeId: 'mx', employeeName: 'Manager X', roleOnEngagement: 'in_charge' },
] as TeamMember[];

beforeEach(() => apiFetch.mockReset());

describe('who changes the people on an engagement', () => {
  it('shows everyone the leads and team, with nothing to press', () => {
    render(
      wrap(
        <>
          <LeadsCard engagement={engagement} canChangePartner={false} canChangeManager={false} />
          <TeamSection engagementId="eng" team={team} canChange={false} />
        </>,
      ),
    );
    expect(screen.getByText('Partner A')).toBeTruthy();
    expect(screen.getAllByText('Manager X')).toHaveLength(2);
    expect(screen.getByText('Senior Y')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /change/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull();
    expect(screen.queryByLabelText('Remove Senior Y')).toBeNull();
  });

  it('lets whoever may change the team add and remove — never the partner or manager, who are changed', () => {
    render(wrap(<TeamSection engagementId="eng" team={team} canChange leads={engagement} />));
    expect(screen.getByRole('button', { name: /add/i })).toBeTruthy();
    expect(screen.getByLabelText('Remove Senior Y')).toBeTruthy();
    expect(screen.queryByLabelText('Remove Manager X')).toBeNull();
    expect(screen.getByText('3 open')).toBeTruthy();
  });

  it('the EP changes the manager but not the partner', () => {
    render(wrap(<LeadsCard engagement={engagement} canChangePartner={false} canChangeManager />));
    expect(screen.getByRole('button', { name: 'Change Manager' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change Engagement Partner' })).toBeNull();
  });

  it('removing someone with open tasks asks who takes them over, from the people on the engagement', async () => {
    apiFetch.mockResolvedValue({});
    render(wrap(<TeamSection engagementId="eng" team={team} canChange leads={engagement} />));
    fireEvent.click(screen.getByLabelText('Remove Article K'));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByText(/has 3 open tasks here/)).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Article K' })).toBeNull();
    expect(screen.getByRole('option', { name: /Partner A — Engagement Partner/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over and remove' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/engagements/eng/team/ak?handoverTo=sy', {
        method: 'DELETE',
      }),
    );
  });

  it('removes someone with no open tasks straight away', async () => {
    apiFetch.mockResolvedValue({});
    render(wrap(<TeamSection engagementId="eng" team={team} canChange leads={engagement} />));
    fireEvent.click(screen.getByLabelText('Remove Senior Y'));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/engagements/eng/team/sy', { method: 'DELETE' }),
    );
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
    render(wrap(<LeadsCard engagement={engagement} canChangePartner canChangeManager />));
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
    render(wrap(<LeadsCard engagement={engagement} canChangePartner canChangeManager />));
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
