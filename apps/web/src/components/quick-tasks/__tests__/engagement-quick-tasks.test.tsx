import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { QuickTaskPerson, QuickTaskSummary } from '@hsdg/contracts';
import { EngagementQuickTasks } from '../engagement-quick-tasks';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class extends Error {},
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ principal: { employeeId: 'e1', roles: ['partner'], permissions: [] } }),
}));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
jest.mock('@/components/entity-picker', () => ({
  EntityPicker: ({ value }: { value: { label: string } | null }) => (
    <div data-testid="client">{value?.label ?? 'none'}</div>
  ),
}));
const senior: QuickTaskPerson = {
  id: 'e2',
  name: 'Ravi Kumar',
  code: 'EMP005',
  officeCode: 'NORTH',
  role: 'senior',
};
jest.mock('../person-picker', () => ({
  PersonPicker: ({ onChange }: { onChange: (p: QuickTaskPerson) => void }) => (
    <button type="button" onClick={() => onChange(senior)}>
      Pick Ravi
    </button>
  ),
}));

const person = (id: string, name: string): QuickTaskPerson => ({
  id,
  name,
  code: null,
  officeCode: 'NORTH',
  role: 'partner',
});
const task: QuickTaskSummary = {
  id: 't1',
  number: 7,
  title: 'Chase the bank confirmation',
  urgent: true,
  status: 'doing',
  entityId: 'c1',
  entityLabel: 'ENT0001 · Acme Pvt Ltd',
  engagementId: 'g1',
  engagementLabel: 'SA/00001 · Statutory audit',
  assignedBy: person('e1', 'Asha Rao'),
  assignedTo: senior,
  side: 'sent',
  etaAt: '2026-11-04T09:30:00Z',
  dueAt: null,
  late: true,
  lastActivityAt: '2026-11-04T08:00:00Z',
  lastMessage: null,
  unread: 0,
  createdAt: '2026-11-04T07:00:00Z',
};

function renderStrip() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EngagementQuickTasks
        engagement={{ id: 'g1', label: 'SA/00001', client: { id: 'c1', label: 'Acme Pvt Ltd' } }}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  push.mockReset();
  toast.mockReset();
});

describe('Quick tasks on the engagement page', () => {
  it('lists the engagement’s open quick tasks by the tabs', async () => {
    apiFetch.mockResolvedValue([task]);
    renderStrip();
    expect(await screen.findByRole('link', { name: task.title })).toHaveAttribute(
      'href',
      '/quick-tasks?t=t1',
    );
    expect(apiFetch).toHaveBeenCalledWith('/quick-tasks?engagementId=g1&state=open');
    expect(screen.getByText('1 open quick task')).toBeInTheDocument();
    expect(screen.getByText('Asha Rao → Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText(/^Done by /)).toBeInTheDocument();
  });

  it('New task sends it on this engagement and its client, and stays on the page', async () => {
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === 'POST' ? { ...task, id: 't2' } : []),
    );
    renderStrip();
    expect(await screen.findByText('No open quick tasks here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New task/ }));
    expect(screen.getByText('New task · SA/00001')).toBeInTheDocument();
    expect(screen.getByTestId('client')).toHaveTextContent('Acme Pvt Ltd');
    fireEvent.change(screen.getByPlaceholderText(/GSTR-3B challan/), {
      target: { value: 'Chase the bank confirmation' },
    });
    fireEvent.click(screen.getByText('Pick Ravi'));
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/quick-tasks',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            entityId: 'c1',
            engagementId: 'g1',
            assignedToEmployeeId: 'e2',
          }),
        }),
      ),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Sent to Ravi Kumar.'));
    expect(push).not.toHaveBeenCalled();
  });
});
