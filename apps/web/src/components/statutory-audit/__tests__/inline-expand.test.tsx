import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AuditFileNav } from '../audit-file-nav';
import { SectionLauncher } from '../section-launcher';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const phase = (n: number, phaseKey: string, title: string) => ({
  id: phaseKey,
  phaseNo: n,
  phaseKey,
  title,
  state: 'not_started',
  sortOrder: n,
});

describe('audit-file phases expand in place', () => {
  beforeEach(() =>
    apiFetch.mockResolvedValue([
      {
        workflowInstanceId: 'wf1',
        templateVersion: 'v1',
        phases: [
          phase(1, 'acceptance', 'Engagement & Acceptance'),
          phase(3, 'planning', 'Planning'),
          phase(5, 'controls', 'Internal Controls / IFC'),
        ],
      },
    ]),
  );

  it('opens a phase under its row with +, keeps others independent, collapses on second click', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <AuditFileNav
          engagementId="e1"
          panelKeys={['acceptance', 'planning', 'pbc']}
          renderPhase={(key) => <p>workspace:{key}</p>}
        />,
      ),
    );
    const acceptance = await screen.findByRole('button', { name: /Engagement & Acceptance/ });
    expect(acceptance).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('workspace:acceptance')).not.toBeInTheDocument();

    await user.click(acceptance);
    await user.click(screen.getByRole('button', { name: /Planning/ }));
    expect(screen.getByText('workspace:acceptance')).toBeInTheDocument();
    expect(screen.getByText('workspace:planning')).toBeInTheDocument();
    // Rendered in the list itself, not a dialog.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(acceptance);
    expect(screen.queryByText('workspace:acceptance')).not.toBeInTheDocument();
    expect(screen.getByText('workspace:planning')).toBeInTheDocument();

    // A phase with no workspace yet has no toggle.
    expect(screen.getByRole('button', { name: /Internal Controls/ })).toBeDisabled();
  });
});

function Launcher(): JSX.Element {
  const [open, setOpen] = useState<'a' | 'b' | null>(null);
  return (
    <SectionLauncher
      sections={[
        ['a', 'Signal register'],
        ['b', 'Areas of focus'],
      ]}
      open={open}
      onToggle={setOpen}
      context="03.1 Planning Intelligence"
    >
      <p>content:{open}</p>
    </SectionLauncher>
  );
}

describe('sub-sections expand in place', () => {
  it('shows the open sub-section directly below its row and toggles it closed', async () => {
    const user = userEvent.setup();
    render(<Launcher />);
    const row = screen.getByRole('button', { name: /Signal register/ });
    await user.click(row);
    const panel = screen.getByRole('region', { name: 'Signal register' });
    expect(panel).toHaveTextContent('content:a');
    expect(row.closest('li')).toContainElement(panel);

    await user.click(row);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
