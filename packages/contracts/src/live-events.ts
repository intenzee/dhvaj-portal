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
