'use client';

import { useEffect, useState } from 'react';
import { BellOff, BellRing, Smartphone } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { needsHomeScreen, pushState, stopPush, syncPush, type PushState } from '@/lib/push';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';

/** This device's alert state, kept fresh; `null` while it is being read. */
export function usePushState(): [PushState | null, (s: PushState) => void] {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    let live = true;
    pushState()
      .then((s) => live && setState(s))
      .catch(() => live && setState('off-server'));
    return () => {
      live = false;
    };
  }, []);
  return [state, setState];
}

const BLOCKED_HELP =
  'Alerts are blocked for this site. Click the lock icon by the address, set Notifications to Allow, then reload.';
const HOME_SCREEN_HELP =
  'On iPhone or iPad: tap Share → Add to Home Screen, open the portal from that icon, and turn alerts on there.';

/**
 * "Alerts on this device": quick-task alerts that ring here even when the
 * portal — or the browser — is closed. `compact` is the slim link in the
 * full-screen task alert; otherwise a button for page headers.
 */
export function DeviceAlerts({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const toast = useToast();
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);

  if (state === null || state === 'off-server') return null;
  if (state === 'unsupported') {
    if (!needsHomeScreen()) return null;
    return compact ? (
      <p className="border-t border-line px-5 py-2 text-xs text-ink-muted">{HOME_SCREEN_HELP}</p>
    ) : (
      <span className="inline-flex items-center gap-1 text-xs text-ink-muted" title={HOME_SCREEN_HELP}>
        <Smartphone className="h-4 w-4" /> Add to Home Screen for alerts
      </span>
    );
  }

  const turnOn = async (): Promise<void> => {
    setBusy(true);
    try {
      const s = await syncPush(true);
      setState(s);
      if (s === 'on') toast('This device will ring for new tasks, even with the browser closed.', 'success');
      if (s === 'blocked') toast(BLOCKED_HELP, 'error');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not turn alerts on here.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async (): Promise<void> => {
    setBusy(true);
    await stopPush();
    setState('ask');
    setBusy(false);
    toast('Alerts are off on this device.', 'success');
  };

  if (compact) {
    if (state !== 'ask') return null;
    return (
      <button
        type="button"
        disabled={busy}
        className="border-t border-line px-5 py-2 text-left text-xs text-primary-700 hover:bg-surface-sunken"
        onClick={() => void turnOn()}
      >
        Ring this device even when the browser is closed →
      </button>
    );
  }

  if (state === 'blocked') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-muted" title={BLOCKED_HELP}>
        <BellOff className="h-4 w-4" /> Alerts blocked in this browser
      </span>
    );
  }
  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={() => void (state === 'on' ? turnOff() : turnOn())}
      title={
        state === 'on'
          ? 'New tasks ring on this device even with the browser closed. Click to stop.'
          : 'Ring this device for new tasks, even with the browser closed.'
      }
    >
      <BellRing className={cn('h-4 w-4', state === 'on' && 'text-success-600')} />
      {state === 'on' ? 'Alerts on this device: on' : 'Turn on alerts on this device'}
    </Button>
  );
}
