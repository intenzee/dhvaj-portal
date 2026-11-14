import { act, fireEvent, render, screen } from '@testing-library/react';
import { IdleSignOut } from '../idle-sign-out';
import { LAST_ACTIVE_KEY } from '@/lib/idle';

const logout = jest.fn();
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ logout }) }));

const MIN = 60_000;

describe('IdleSignOut', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    window.localStorage.clear();
    logout.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('warns at 14 minutes, stays on request, and signs out idle at 15 with the last activity', () => {
    const start = Date.now();
    render(<IdleSignOut />);
    expect(window.localStorage.getItem(LAST_ACTIVE_KEY)).toBe(String(start));

    act(() => void jest.advanceTimersByTime(14 * MIN));
    expect(screen.getByText("You'll be signed out in 60 s.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(screen.queryByText(/signed out in/)).not.toBeInTheDocument();
    const stayedAt = Number(window.localStorage.getItem(LAST_ACTIVE_KEY));
    expect(stayedAt).toBeGreaterThanOrEqual(start + 14 * MIN);

    act(() => void jest.advanceTimersByTime(15 * MIN));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledWith({ reason: 'idle', at: stayedAt });
  });

  it('activity in another tab (the shared stamp) keeps this one signed in', () => {
    render(<IdleSignOut />);
    act(() => void jest.advanceTimersByTime(14 * MIN + 5000));
    expect(screen.getByText(/signed out in/)).toBeInTheDocument();

    // The other tab writes the stamp; this tab hears the storage event.
    const now = String(Date.now());
    act(() => {
      window.localStorage.setItem(LAST_ACTIVE_KEY, now);
      window.dispatchEvent(new StorageEvent('storage', { key: LAST_ACTIVE_KEY, newValue: now }));
    });
    expect(screen.queryByText(/signed out in/)).not.toBeInTheDocument();
    act(() => void jest.advanceTimersByTime(10 * MIN));
    expect(logout).not.toHaveBeenCalled();
  });

  it('typing anywhere counts as activity', () => {
    render(<IdleSignOut />);
    act(() => void jest.advanceTimersByTime(10 * MIN));
    fireEvent.keyDown(document.body, { key: 'a' });
    act(() => void jest.advanceTimersByTime(10 * MIN));
    expect(logout).not.toHaveBeenCalled();
    expect(screen.queryByText(/signed out in/)).not.toBeInTheDocument();
    act(() => void jest.advanceTimersByTime(5 * MIN));
    expect(logout).toHaveBeenCalledWith(expect.objectContaining({ reason: 'idle' }));
  });
});
