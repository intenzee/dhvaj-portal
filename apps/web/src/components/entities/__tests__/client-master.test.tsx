import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ExportWithPasswords,
  masterButtonLabel,
  passwordExportLine,
} from '@/components/entities/client-master';
import type { ClientMasterPreview } from '@hsdg/contracts';

const downloadFile = jest.fn();
let allowed = true;
jest.mock('@/lib/api', () => ({
  apiFetch: jest.fn(),
  downloadFile: (...args: unknown[]) => downloadFile(...args),
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ principal: {} }) }));
jest.mock('@/lib/principal', () => ({ can: () => allowed }));

beforeEach(() => {
  downloadFile.mockReset();
  allowed = true;
});

describe('Client Master labels', () => {
  it('says how many passwords the export wrote and kept masked', () => {
    expect(passwordExportLine(12, 0)).toBe('12 passwords written in full');
    expect(passwordExportLine(1, 3)).toBe(
      '1 password written in full · 3 left masked (clients whose logins you may not see)',
    );
  });

  it('counts the logins the import saves', () => {
    const p = {
      counts: { create_client: 1, update_client: 2, unchanged: 0, error: 0 },
      logins: 3,
      engagements: 0,
    } as unknown as ClientMasterPreview;
    expect(masterButtonLabel(p)).toBe('Import: 1 new client, fill in 2 clients, 3 logins');
  });
});

describe('ExportWithPasswords', () => {
  it('is not there without the right to see passwords', () => {
    allowed = false;
    const { container } = render(<ExportWithPasswords />);
    expect(container).toBeEmptyDOMElement();
  });

  it('downloads the export with passwords and says what it held', async () => {
    downloadFile.mockResolvedValue(
      new Headers({ 'x-passwords-shown': '5', 'x-passwords-masked': '2' }),
    );
    render(<ExportWithPasswords />);
    expect(screen.getByText(/logged against your name/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Export with passwords/ }));
    expect(downloadFile).toHaveBeenCalledWith(
      '/client-imports/master/export?passwords=true',
      'DHVAJ-Client-Master-with-passwords.xlsx',
    );
    expect(
      await screen.findByText(
        '5 passwords written in full · 2 left masked (clients whose logins you may not see)',
      ),
    ).toBeInTheDocument();
  });

  it('says when the hourly limit is reached', async () => {
    const { ApiError } = jest.requireMock('@/lib/api') as {
      ApiError: new (s: number, m: string) => Error;
    };
    downloadFile.mockRejectedValue(new ApiError(429, 'Download failed (429)'));
    render(<ExportWithPasswords />);
    await userEvent.click(screen.getByRole('button', { name: /Export with passwords/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/5 times in the last hour/);
  });
});
