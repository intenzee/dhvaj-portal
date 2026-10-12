'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTO_TIME, type ClockState, type HeartbeatResult } from '@hsdg/contracts';
import { apiFetch, getToken } from './api';

const MINUTE = 60_000;

/** Beat only while the tab is visible and the user was active recently (spec Change 3). */
export function shouldBeat(now: number, lastActivityAt: number, visible: boolean): boolean {
  return visible && now - lastActivityAt < AUTO_TIME.activeWithinMinutes * MINUTE;
}

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * The automatic clock's keep-alive: POST /time/heartbeat every 2 minutes while
 * the tab is visible and the user used mouse or keyboard in the last 10. When
 * the server closed an entry for inactivity it reports `resumable`, which the
 * caller shows as "You were away from 15:10 — resume?".
 */
export function useHeartbeat(enabled: boolean): {
  clock: ClockState | null;
  dismiss: () => void;
  refresh: () => void;
} {
  const lastActivity = useRef(Date.now());
  const [clock, setClock] = useState<ClockState | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!enabled || !getToken()) return;
    apiFetch<ClockState>('/time/clock')
      .then(setClock)
      .catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const mark = () => {
      lastActivity.current = Date.now();
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, mark, { passive: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        mark();
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    refresh();
    const timer = window.setInterval(() => {
      if (!getToken()) return;
      if (!shouldBeat(Date.now(), lastActivity.current, document.visibilityState === 'visible')) return;
      apiFetch<HeartbeatResult>('/time/heartbeat', { method: 'POST' })
        .then(setClock)
        .catch(() => undefined);
    }, AUTO_TIME.heartbeatEveryMinutes * MINUTE);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, mark);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [enabled, refresh]);

  const resumable = clock?.resumable ?? null;
  return {
    clock:
      clock && resumable && dismissed === resumable.entryId ? { ...clock, resumable: null } : clock,
    dismiss: () => setDismissed(resumable?.entryId ?? null),
    refresh,
  };
}
