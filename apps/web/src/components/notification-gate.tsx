'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { needsHomeScreen, pushState, syncPush, type PushState } from '@/lib/push';
import { gateView, unblockSteps, type GateView } from '@/lib/notification-gate';
import { Button } from './ui';

const permissionNow = (): NotificationPermission | null =>
  typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : null;

/**
 * Notifications are required: until this browser has them on, every load of
 * the portal opens with this prompt — there is no "don't show again". It looks
 * again whenever the window comes back into focus, so allowing them in the
 * browser's settings clears it. Automated browsers (tests) are left alone.
 */
export function NotificationGate(): JSX.Element | null {
  const [state, setState] = useState<PushState | null>(null);
  const [view, setView] = useState<GateView>('none');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async (): Promise<void> => {
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    const s = await pushState().catch((): PushState => 'off-server');
    setState(s);
    setView(gateView(s, permissionNow(), needsHomeScreen()));
  }, []);

  useEffect(() => {
    void check();
    const again = (): void => {
      if (document.visibilityState === 'visible') void check();
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [check]);

  const enable = async (): Promise<void> => {
    setBusy(true);
    try {
      if (state === 'off-server') {
        await Notification.requestPermission();
      } else {
        await syncPush(true);
      }
    } catch {
      /* the check below shows where it stands */
    } finally {
      setBusy(false);
      await check();
    }
  };

  if (view === 'none') return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-gate-title"
    >
      <div className="w-full max-w-md rounded-xl border border-line-strong bg-surface p-6 shadow-pop">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
          <BellRing className="h-6 w-6" aria-hidden />
        </div>
        <h2 id="notification-gate-title" className="text-lg font-semibold text-ink">
          Turn on notifications to use the portal
        </h2>
        <p className="mt-1.5 text-sm text-ink-muted">
          Tasks, reminders and replies reach you as notifications — even when the portal is in
          another tab or closed. They are important, so they must be on before you continue.
        </p>

        {view === 'ask' && (
          <div className="mt-5">
            <Button className="w-full justify-center" disabled={busy} onClick={() => void enable()}>
              <BellRing className="h-4 w-4" />{' '}
              {busy ? 'Waiting for the browser…' : 'Enable notifications'}
            </Button>
            <p className="mt-2 text-xs text-ink-faint">
              Your browser will ask — choose <strong>Allow</strong>.
            </p>
          </div>
        )}

        {view === 'blocked' && (
          <div className="mt-4">
            <p className="text-sm font-medium text-ink">
              Notifications are blocked for this site in your browser. To allow them:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
              {unblockSteps(navigator.userAgent).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <Button className="mt-4 w-full justify-center" onClick={() => window.location.reload()}>
              I have allowed them — reload
            </Button>
          </div>
        )}

        {view === 'home-screen' && (
          <div className="mt-4">
            <p className="text-sm font-medium text-ink">
              On iPhone and iPad, notifications work only from the portal’s Home Screen app:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
              <li>Tap Share in Safari, then “Add to Home Screen”.</li>
              <li>Open the portal from the new icon on your Home Screen.</li>
              <li>Choose Enable notifications there, and Allow.</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
