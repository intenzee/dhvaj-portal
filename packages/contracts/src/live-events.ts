/**
 * Live events: what the API pushes to a signed-in person the moment it
 * happens (GET /live/stream, Server-Sent Events). Today: quick tasks — a new
 * task given to them, and each answer on a task they are on.
 */

export const LIVE_EVENT = {
  /** A quick task was given to the person. */
  quickTaskAssigned: 'quick_task.assigned',
  /** The other person on a quick task answered (a message, a status, an ETA). */
  quickTaskReply: 'quick_task.reply',
} as const;
export type LiveEventKind = (typeof LIVE_EVENT)[keyof typeof LIVE_EVENT];

export interface LiveEvent {
  id: string;
  kind: LiveEventKind;
  taskId: string;
  /** An urgent task rings until it is answered. */
  urgent: boolean;
  /** Who caused it (their name), for the pop-up's first line. */
  fromName: string | null;
  at: string;
}

/** The stream sends a ping this often, so proxies keep it open. */
export const LIVE_PING_MS = 25_000;

/** One Server-Sent Event: its `event:` name and `data:` text. */
export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Splits a growing text buffer into the complete SSE frames in it, and the
 * rest still to come. Comment lines (":") are skipped; multi-line data is
 * joined with "\n". Pure — tested.
 */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const text = buffer.replace(/\r\n/g, '\n');
  const parts = text.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const part of parts) {
    let event = 'message';
    const data: string[] = [];
    for (const line of part.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) frames.push({ event, data: data.join('\n') });
  }
  return { frames, rest };
}

// ── Web Push: alerts on a closed browser or a phone ────────────────────────

/** GET /push/config — whether this portal can push, and its VAPID public key. */
export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

/** POST /push/subscriptions — the browser's PushSubscription.toJSON(). */
export interface PushSubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

/** What the service worker receives in a push and shows as a notification. */
export interface PushAlert {
  kind: LiveEventKind;
  taskId: string;
  title: string;
  body: string;
  urgent: boolean;
  /** Where a click opens. */
  url: string;
  at: string;
  /** 0 the first time; 1, 2 … for the reminders of an unanswered urgent task. */
  ring: number;
}

/**
 * The push services a subscription may point at (Chrome/Edge/Opera/Brave via
 * FCM, Edge via WNS, Firefox, Safari). The API posts only to these.
 */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  '.notify.windows.com',
  '.push.services.mozilla.com',
  'web.push.apple.com',
  '.push.apple.com',
] as const;

/** An https endpoint on a known push service. Pure — tested. */
export function isPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((h) =>
    h.startsWith('.') ? host.endsWith(h) && host.length > h.length : host === h,
  );
}
