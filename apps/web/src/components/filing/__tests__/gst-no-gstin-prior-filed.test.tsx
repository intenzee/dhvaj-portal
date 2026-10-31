import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { priorFiledChoices } from '@hsdg/contracts';
import { GstinMissingBanner } from '../gstin-missing-banner';
import { AddGstinDialog, stateCodeOfGstin } from '../add-gstin-dialog';
import { PriorFiledPicker, choicesBefore, toggleChoice } from '../prior-filed-picker';
import { PriorFiledPanel } from '../prior-filed-panel';
import {
  priorFiledFor,
  priorFiledSummary,
} from '@/components/engagement-kinds/new-engagement-wizard';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
const toast = jest.fn();
jest.mock('@/lib/toast', () => ({ useToast: () => toast }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
const canManage = jest.fn(() => false);
jest.mock('@/lib/principal', () => ({ can: () => canManage() }));

const GSTIN = '27AAACA1234A1Z5';
const wrap = (ui: JSX.Element) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  apiFetch.mockReset();
  toast.mockReset();
  canManage.mockReturnValue(false);
});

describe('GstinMissingBanner', () => {
  it('says the GSTIN is missing and adds it from a pop-up', async () => {
    apiFetch.mockResolvedValue({});
    wrap(<GstinMissingBanner engagementId="e1" isLead clientName="Acme" />);
    expect(screen.getByRole('alert')).toHaveTextContent('GSTIN missing.');
    fireEvent.click(screen.getByRole('button', { name: 'Add GSTIN' }));

    const save = screen.getByRole('button', { name: 'Save GSTIN' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: GSTIN.toLowerCase() } });
    expect(screen.getByText('State 27 · Maharashtra.')).toBeInTheDocument();
    fireEvent.click(save);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/streams/gst/registration', {
        method: 'POST',
        body: { registrationNumber: GSTIN },
      }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining(GSTIN)));
    expect(screen.queryByRole('button', { name: 'Save GSTIN' })).not.toBeInTheDocument();
  });

  it('names the client on the TAN pop-up', () => {
    wrap(<GstinMissingBanner engagementId="e1" isLead stream="tds" clientName="Drift Logistics" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add TAN' }));
    expect(screen.getByText(/^Drift Logistics — saved on the client/)).toBeInTheDocument();
  });

  it('points anyone else to the engagement’s leads', () => {
    wrap(<GstinMissingBanner engagementId="e1" isLead={false} />);
    expect(screen.queryByRole('button', { name: 'Add GSTIN' })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask the engagement’s partner or manager/)).toBeInTheDocument();
  });

  it('lets a client manager add it although they do not lead', () => {
    canManage.mockReturnValue(true);
    wrap(<GstinMissingBanner engagementId="e1" isLead={false} />);
    expect(screen.getByRole('button', { name: 'Add GSTIN' })).toBeInTheDocument();
  });
});

describe('AddGstinDialog', () => {
  it('keeps the pop-up open with the error when the save fails', async () => {
    const { ApiError } = jest.requireMock('@/lib/api') as { ApiError: new (m: string) => Error };
    const onSave = jest.fn().mockRejectedValue(new ApiError('That GSTIN is on another client.'));
    const onClose = jest.fn();
    render(<AddGstinDialog onClose={onClose} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: GSTIN } });
    fireEvent.click(screen.getByRole('button', { name: 'Save GSTIN' }));
    expect(await screen.findByText('That GSTIN is on another client.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reads the state code off a GSTIN', () => {
    expect(stateCodeOfGstin(GSTIN)).toBe('27');
    expect(stateCodeOfGstin('AB')).toBeNull();
  });
});

describe('PriorFiledPicker', () => {
  it('ticks ended months only, and every ended month at once', () => {
    const onChange = jest.fn();
    render(
      <PriorFiledPicker
        stream="gst"
        financialYears={['2026-27']}
        value={['2026-04']}
        onChange={onChange}
        today="2026-07-15"
      />,
    );
    expect(screen.getByRole('button', { name: /Apr 26/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Jul 26/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Annual returns/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /May 26/ }));
    expect(onChange).toHaveBeenLastCalledWith(['2026-04', '2026-05']);
    fireEvent.click(screen.getByRole('button', { name: 'Tick every period that has ended' }));
    expect(onChange).toHaveBeenLastCalledWith(['2026-04', '2026-05', '2026-06']);
  });

  it('works TDS by the quarter', () => {
    const q1 = priorFiledChoices('tds', '2026-27').periods[0]!;
    expect(toggleChoice(q1, [])).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(toggleChoice(q1, ['2026-04', '2026-05', '2026-06', '2026-07'])).toEqual(['2026-07']);
    expect(choicesBefore('tds', ['2026-27'], '2026-10').map((c) => c.key)).toHaveLength(2);
  });
});

describe('PriorFiledPanel', () => {
  it('marks the ticked months filed on the stream', async () => {
    apiFetch.mockResolvedValue({ filings: 3, byStream: { gst: 3 } });
    const onDone = jest.fn();
    wrap(
      <PriorFiledPanel engagementId="e1" stream="gst" financialYear="2025-26" onDone={onDone} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Apr 25/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark filed' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/streams/gst/prior-filed', {
      method: 'POST',
      body: { periods: ['2025-04'] },
    });
    expect(toast).toHaveBeenCalledWith('3 filings marked filed before the portal.');
  });

  it('puts back months marked by mistake', async () => {
    apiFetch.mockResolvedValue({ filings: 0, byStream: {} });
    wrap(
      <PriorFiledPanel engagementId="e1" stream="gst" financialYear="2025-26" onDone={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /May 25/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/engagements/e1/streams/gst/prior-filed/undo', {
        method: 'POST',
        body: { periods: ['2025-05'] },
      }),
    );
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Nothing to put back/));
  });
});

describe('new engagement: filed before the portal', () => {
  it('sends only the streams and years still picked', () => {
    expect(
      priorFiledFor(
        { gst: ['2026-04', 'FY:2026-27', '2025-04'], tds: ['2026-04'], mis: [] },
        ['gst', 'mis'],
        ['2026-27'],
      ),
    ).toEqual({ gst: ['2026-04', 'FY:2026-27'] });
  });

  it('sums the ticks up per stream', () => {
    expect(priorFiledSummary('gst', ['2026-04', '2026-05', 'FY:2026-27'])).toBe(
      '2 months + annual',
    );
    expect(priorFiledSummary('tds', ['2026-04', '2026-05', '2026-06'])).toBe('1 quarter');
  });
});
