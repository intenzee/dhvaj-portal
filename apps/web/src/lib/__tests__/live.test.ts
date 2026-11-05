import { parseSseFrames } from '@hsdg/contracts';
import { reconnectDelay } from '../live';
import { isChatEvent, isQuickTaskEvent } from '../live-hub';

describe('the live stream', () => {
  it('reads whole frames and keeps a half-read one for next time', () => {
    const { frames, rest } = parseSseFrames(
      'event: quick_task.assigned\nid: 1\ndata: {"a":1}\n\n: a comment\nevent: ping\ndata: {}\n\nevent: quick_task.reply\ndata: {"b"',
    );
    expect(frames).toEqual([
      { event: 'quick_task.assigned', data: '{"a":1}' },
      { event: 'ping', data: '{}' },
    ]);
    expect(rest).toBe('event: quick_task.reply\ndata: {"b"');
    const next = parseSseFrames(`${rest}:2}\n\n`);
    expect(next.frames).toEqual([{ event: 'quick_task.reply', data: '{"b":2}' }]);
    expect(next.rest).toBe('');
  });

  it('joins several data lines', () => {
    expect(parseSseFrames('data: one\ndata: two\n\n').frames).toEqual([
      { event: 'message', data: 'one\ntwo' },
    ]);
  });

  it('backs off 1 s, 2 s, 4 s … up to 30 s between reconnects', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(reconnectDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});

describe('the shared live stream', () => {
  it('tells quick-task frames from chat frames', () => {
    const chat = { kind: 'chat.message' } as never;
    const task = { kind: 'quick_task.reply' } as never;
    expect([isChatEvent(chat), isQuickTaskEvent(chat)]).toEqual([true, false]);
    expect([isChatEvent(task), isQuickTaskEvent(task)]).toEqual([false, true]);
  });
});
