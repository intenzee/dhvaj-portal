import { NOTIFICATION_TYPE } from '@hsdg/contracts';
import type { OutboundNotification } from './notification-channel';
import { SwitchChannel, switchAccepts, switchMessage, switchRoomFor } from './switch.channel';

const config = {
  url: 'http://switch.test',
  agentId: 'agent-1',
  apiKey: 'key-1',
  rooms: { 'firm-ops': 'room-ops', 'review-queue': 'room-review' },
  webUrl: 'http://portal.test/',
};

const notice = (over: Partial<OutboundNotification> = {}): OutboundNotification => ({
  recipientUserId: 'user-1',
  recipientEmail: null,
  type: NOTIFICATION_TYPE.taskReviewRequested,
  title: 'GSTR-3B · Oct 2026 sent for review',
  body: 'Sharma Traders — Riya Kapoor asks you to review it.',
  engagementId: 'eng-1',
  ...over,
});

function fakeFetch(
  status = 200,
  rooms: { room_id: string; name: string; archived?: boolean }[] = [],
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/ops/list_rooms')) {
      return new Response(JSON.stringify({ result: rooms }), { status: 200 });
    }
    return new Response(status === 200 ? '{"ok":true}' : 'nope', { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('SwitchChannel', () => {
  it('routes each kind of notification to its room, and the rest to firm-ops', () => {
    expect(switchRoomFor(NOTIFICATION_TYPE.taskReviewRequested)).toBe('review-queue');
    expect(switchRoomFor(NOTIFICATION_TYPE.documentUploaded)).toBe('client-chase');
    expect(switchRoomFor(NOTIFICATION_TYPE.epSignoffPending)).toBe('partner-signoff');
    expect(switchRoomFor(NOTIFICATION_TYPE.certificateSigned)).toBe('partner-signoff');
    expect(switchRoomFor(NOTIFICATION_TYPE.filingLodged)).toBe('compliance-desk');
    expect(switchRoomFor(NOTIFICATION_TYPE.noticeReceived)).toBe('notices-itr');
    expect(switchRoomFor(NOTIFICATION_TYPE.taskAssigned)).toBe('firm-ops');
  });

  it('writes the title in bold, the body, and the portal link', () => {
    expect(switchMessage(notice(), 'http://portal.test/')).toBe(
      '**GSTR-3B · Oct 2026 sent for review**\n' +
        'Sharma Traders — Riya Kapoor asks you to review it.\n' +
        'http://portal.test/engagements/eng-1',
    );
    expect(switchMessage(notice({ body: null, engagementId: null }), 'x')).toBe(
      '**GSTR-3B · Oct 2026 sent for review**',
    );
  });

  it('@mentions the agent configured for the type, and only that type', async () => {
    const f = fakeFetch();
    const ch = new SwitchChannel(
      { ...config, mentions: { [NOTIFICATION_TYPE.taskReviewRequested]: 'dhvaj-reviewer' } },
      f.impl,
    );
    await ch.deliver(notice());
    await ch.deliver(notice({ type: NOTIFICATION_TYPE.taskReturned }));
    const bodies = f.calls.map((c) => JSON.parse(String(c.init.body)).content as string);
    expect(bodies[0]).toMatch(/^@dhvaj-reviewer \*\*GSTR-3B/);
    expect(bodies[1]).toMatch(/^\*\*GSTR-3B/);
  });

  it('posts once as the portal agent into the routed room', async () => {
    const f = fakeFetch();
    await new SwitchChannel(config, f.impl).deliver(notice());
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe('http://switch.test/agents/agent-1/message');
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer key-1');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toMatchObject({ room_id: 'room-review' });
  });

  it('finds an unpinned room by name among dhvaj-portal’s rooms, and looks again after a refusal', async () => {
    const f = fakeFetch(200, [
      { room_id: 'old-chase', name: 'client-chase', archived: true },
      { room_id: 'room-chase', name: 'client-chase' },
    ]);
    const ch = new SwitchChannel({ ...config, rooms: {} }, f.impl);
    await ch.deliver(notice({ type: NOTIFICATION_TYPE.documentUploaded }));
    await ch.deliver(notice({ type: NOTIFICATION_TYPE.documentUploaded }));
    const posts = f.calls.filter((c) => c.url.endsWith('/message'));
    expect(posts.map((c) => JSON.parse(String(c.init.body)).room_id)).toEqual([
      'room-chase',
      'room-chase',
    ]);
    // Listed once: the second delivery used the cache.
    expect(f.calls.filter((c) => c.url.endsWith('/ops/list_rooms'))).toHaveLength(1);

    const refused = fakeFetch(500, [{ room_id: 'room-chase', name: 'client-chase' }]);
    const ch2 = new SwitchChannel({ ...config, rooms: {} }, refused.impl);
    await expect(
      ch2.deliver(notice({ type: NOTIFICATION_TYPE.documentUploaded })),
    ).rejects.toThrow();
    await expect(
      ch2.deliver(notice({ type: NOTIFICATION_TYPE.documentUploaded })),
    ).rejects.toThrow();
    expect(refused.calls.filter((c) => c.url.endsWith('/ops/list_rooms'))).toHaveLength(2);
  });

  it('throws when no room has the name, so the outbox retries later', async () => {
    const f = fakeFetch(200, []);
    await expect(
      new SwitchChannel({ ...config, rooms: {} }, f.impl).deliver(notice()),
    ).rejects.toThrow(/no room named review-queue/);
  });

  it('falls back to firm-ops when the routed room is not mapped', async () => {
    const f = fakeFetch();
    await new SwitchChannel(config, f.impl).deliver(
      notice({ type: NOTIFICATION_TYPE.documentUploaded }),
    );
    const post = f.calls.find((c) => c.url.endsWith('/message'))!;
    expect(JSON.parse(String(post.init.body))).toMatchObject({ room_id: 'room-ops' });
  });

  it('never posts a client-facing (e-mail) delivery into chat', async () => {
    const f = fakeFetch();
    await new SwitchChannel(config, f.impl).deliver(
      notice({ recipientUserId: null, recipientEmail: 'client@example.com' }),
    );
    expect(f.calls).toHaveLength(0);
  });

  it('throws on a refused post so the outbox retries it', async () => {
    const f = fakeFetch(503);
    await expect(new SwitchChannel(config, f.impl).deliver(notice())).rejects.toThrow(/503/);
  });

  it('keeps the date sweep out of chat', () => {
    expect(switchAccepts(NOTIFICATION_TYPE.taskReviewRequested)).toBe(true);
    expect(switchAccepts(NOTIFICATION_TYPE.statutoryDeadlineOverdue)).toBe(false);
    expect(switchAccepts(NOTIFICATION_TYPE.internalSlaOverdue)).toBe(false);
    expect(switchAccepts(NOTIFICATION_TYPE.complianceDueToday)).toBe(false);
  });

  it('is a room channel', () => {
    expect(new SwitchChannel(config).audience).toBe('room');
  });
});
