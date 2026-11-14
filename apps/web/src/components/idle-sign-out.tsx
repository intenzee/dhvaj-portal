'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  IDLE_ACTIVITY_EVENTS,
  IDLE_CHANNEL,
  IdleTracker,
  LAST_ACTIVE_KEY,
  browserStore,
  type IdlePhase,
} from '@/lib/idle';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';

/** BroadcastChannel where the browser has one (storage events carry the stamp too). */
function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(IDLE_CHANNEL);
  } catch {
    return null;
  }
}

/**
 * Signs the portal out after 15 minutes without activity in any of its tabs,
 * with a minute's warning. Push alerts keep arriving afterwards (lib/idle.ts).
 */
export function IdleSignOut(): JSX.Element | null {
  const { logout } = useAuth();
  const [phase, setPhase] = useState<IdlePhase>('active');
  const [seconds, setSeconds] = useState(60);
  const tracker = useRef<IdleTracker | null>(null);
  const shown = useRef<IdlePhase>('active');
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    const channel = openChannel();
    const t = new IdleTracker({
      now: () => Date.now(),
      store: browserStore(),
      broadcast: (stamp) => channel?.postMessage(stamp),
    });
    tracker.current = t;
    let done = false;

    const check = (): void => {
      if (done) return;
      const p = t.phase();
      if (p === 'expired') {
        done = true;
        logoutRef.current({ reason: 'idle', at: t.lastActive() });
        return;
      }
      shown.current = p;
      setPhase(p);
      if (p === 'warn') setSeconds(t.secondsLeft());
    };
    const onActivity = (): void => {
      t.record();
      // Close the warning at once rather than on the next tick.
      if (shown.current !== 'active') check();
    };
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== LAST_ACTIVE_KEY) return;
      t.receive(e.newValue);
      check();
    };
    const onVisible = (): void => check();
    if (channel) {
      channel.onmessage = (e: MessageEvent) => {
        t.receive(e.data);
        check();
      };
    }

    for (const e of IDLE_ACTIVITY_EVENTS) {
      // Scroll does not bubble: listen in the capture phase to hear inner panes too.
      document.addEventListener(e, onActivity, { capture: true, passive: true });
    }
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // A hidden tab keeps counting: the browser may slow this timer, so every
    // check works from the stamp, not from ticks.
    const timer = window.setInterval(check, 1000);
    check();
    return () => {
      done = true;
      window.clearInterval(timer);
      for (const e of IDLE_ACTIVITY_EVENTS) {
        document.removeEventListener(e, onActivity, { capture: true });
      }
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      try {
        channel?.close();
      } catch {
        // already closed
      }
    };
  }, []);

  const stay = (): void => {
    tracker.current?.record(true);
    shown.current = 'active';
    setPhase('active');
  };

  if (phase !== 'warn') return null;
  return (
    <Modal
      open
      onClose={stay}
      title="Still there?"
      description={`You'll be signed out in ${seconds} s.`}
      footer={<Button onClick={stay}>Stay signed in</Button>}
    >
      <p className="text-sm text-ink-muted">
        The portal signs out after 15 minutes without activity. Task alerts keep coming to this
        device.
      </p>
    </Modal>
  );
}
