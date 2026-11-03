import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MoveWorkForm, MoveWorkTab } from '../move-work';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

jest.setTimeout(20_000);

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const takers = [
  { employeeId: 's1', fullName: 'Arjun Senior' },
  { employeeId: 'a2', fullName: 'Bela Article' },
];

describe('Move all open work (C-6)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('moves every open task to the person picked, with the reason', async () => {
    apiFetch.mockResolvedValue({ assigned: 2, reviews: 1 });
    const onMoved = jest.fn();
    render(wrap(<MoveWorkForm fromId="a1" openTasks={3} takers={takers} onMoved={onMoved} />));
    const button = screen.getByRole('button', { name: 'Move all open work' });
    expect(button).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Move to'), 's1');
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Why the work is moving'), 'On leave');
    await userEvent.click(button);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/people/admin/move-work', {
        method: 'POST',
        body: { fromEmployeeId: 'a1', toEmployeeId: 's1', reason: 'On leave' },
      }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Moved 2 tasks and 1 review.'));
    expect(onMoved).toHaveBeenCalled();
  });

  it('has nothing to move when nothing is open', () => {
    render(wrap(<MoveWorkForm fromId="a1" openTasks={0} takers={takers} />));
    expect(screen.getByText('Nothing open is theirs.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move all open work' })).toBeDisabled();
  });

  it('offers only the takers the server allowed', () => {
    render(
      wrap(
        <MoveWorkTab
          options={{
            employeeId: 'a1',
            fullName: 'Chetan Article',
            openTasks: 1,
            canMove: true,
            takers: [takers[0]!],
          }}
        />,
      ),
    );
    expect(screen.getByRole('option', { name: 'Arjun Senior' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Bela Article' })).not.toBeInTheDocument();
  });
});
