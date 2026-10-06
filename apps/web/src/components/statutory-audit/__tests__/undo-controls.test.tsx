import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuditUndoStatus, AuditUndoStep } from '@hsdg/contracts';
import { UndoControls } from '../undo-controls';

const apiFetch = jest.fn();
const toast = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
  AUDIT_FILE_CHANGED: 'audit-file:changed',
}));
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const step = (id: string, description: string): AuditUndoStep => ({
  id,
  description,
  at: '2026-10-06T10:00:00Z',
  changes: [{ table: 'audit_risks', op: 'UPDATE', count: 1 }],
});

/** Serve the status from `state`; undo / redo move the step across. */
function serve(state: AuditUndoStatus): void {
  apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
    if (opts?.method === 'POST' && path.endsWith('/undo')) {
      const applied = state.undo!;
      state.redo = applied;
      state.undo = null;
      return Promise.resolve({ applied, ...state });
    }
    if (opts?.method === 'POST' && path.endsWith('/redo')) {
      const applied = state.redo!;
      state.undo = applied;
      state.redo = null;
      return Promise.resolve({ applied, ...state });
    }
    return Promise.resolve({ ...state });
  });
}

describe('audit file undo / redo', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    toast.mockReset();
  });

  it('is disabled when there is nothing to undo or redo', async () => {
    serve({ undo: null, redo: null });
    render(wrap(<UndoControls engagementId="e1" />));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('undoes the last click and offers it back as a redo', async () => {
    serve({ undo: step('s1', 'Accept a suggested risk'), redo: null });
    render(wrap(<UndoControls engagementId="e1" />));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Undo: Accept a suggested risk' }),
    );
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/statutory-audit/undo', {
      method: 'POST',
      body: {},
    });
    expect(toast).toHaveBeenCalledWith('Undone: Accept a suggested risk');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Redo: Accept a suggested risk' }),
    );
    expect(toast).toHaveBeenCalledWith('Redone: Accept a suggested risk');
  });

  it('offers Undo right after a click on the file', async () => {
    const state: AuditUndoStatus = { undo: null, redo: null };
    serve(state);
    render(wrap(<UndoControls engagementId="e1" />));
    await screen.findByRole('button', { name: 'Undo' });

    state.undo = step('s2', 'Delete a PBC request');
    act(() => {
      window.dispatchEvent(
        new CustomEvent('audit-file:changed', {
          detail: '/engagements/e1/statutory-audit/pbc/p1',
        }),
      );
    });
    const prompt = await screen.findByRole('status');
    expect(prompt).toHaveTextContent('Delete a PBC request');
    await userEvent.click(within(prompt).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Undone: Delete a PBC request'));
  });

  it('answers ⌘Z / Ctrl+Z outside text fields only', async () => {
    serve({ undo: step('s3', 'Approve planning'), redo: null });
    render(
      wrap(
        <>
          <input aria-label="note" />
          <UndoControls engagementId="e1" />
        </>,
      ),
    );
    await screen.findByRole('button', { name: 'Undo: Approve planning' });

    fireEvent.keyDown(screen.getByLabelText('note'), { key: 'z', ctrlKey: true });
    expect(apiFetch).not.toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/undo',
      expect.anything(),
    );

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Undone: Approve planning'));
  });

  it('shows why an undo was refused', async () => {
    serve({ undo: step('s4', 'Update a risk'), redo: null });
    render(wrap(<UndoControls engagementId="e1" />));
    await screen.findByRole('button', { name: 'Undo: Update a risk' });
    apiFetch.mockRejectedValueOnce(
      new Error("This can't be undone because it has been changed since."),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Undo: Update a risk' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "This can't be undone because it has been changed since.",
        'error',
      ),
    );
  });
});
