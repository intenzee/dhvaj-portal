import { parseSseFrames, type ChatLiveEvent, type LiveEvent } from '@hsdg/contracts';
import { API_BASE, getToken } from './api';

export type LiveState = 'connecting' | 'live' | 'offline';

/** Any frame the stream carries: a quick-task one or a chat one. */
export type AnyLiveEvent = LiveEvent | ChatLiveEvent;

/** The wait before reconnect attempt `n` (0-based): 1 s, 2 s, 4 s … capped at 30 s. Pure — tested. */
export function reconnectDelay(n: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, n));
}

/**
 * Opens GET /live/stream with the bearer token (fetch, not EventSource, so
 * the token stays in a header) and calls `onEvent` for each live event.
 * Reconnects with back-off; a 401/403 stops until the next sign-in. Returns
 * a stop function.
 */
export function connectLive(
  onEvent: (e: AnyLiveEvent) => void,
  onState: (s: LiveState) => void = () => undefined,
): () => void {
  let stopped = false;
  let attempt = 0;
  let ctrl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const again = (): void => {
    if (stopped) return;
    onState('offline');
    timer = setTimeout(run, reconnectDelay(attempt++));
  };

  async function run(): Promise<void> {
    if (stopped) return;
    const token = getToken();
    if (!token) {
      onState('offline');
      return;
    }
    ctrl = new AbortController();
    onState('connecting');
    try {
      const res = await fetch(`${API_BASE}/live/stream`, {
        headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (res.status === 401 || res.status === 403) {
        onState('offline');
        return;
      }
      if (!res.ok || !res.body) throw new Error(`live ${res.status}`);
      onState('live');
      attempt = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const { frames, rest } = parseSseFrames(buf + decoder.decode(value, { stream: true }));
        buf = rest;
        for (const f of frames) {
          if (f.event === 'ping') continue;
          try {
            onEvent(JSON.parse(f.data) as AnyLiveEvent);
          } catch {
            /* a frame we cannot read */
          }
        }
      }
      again();
    } catch {
      if (!stopped) again();
    }
  }

  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    ctrl?.abort();
  };
}
