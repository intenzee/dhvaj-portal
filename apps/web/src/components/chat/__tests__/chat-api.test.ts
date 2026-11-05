import { QueryClient } from '@tanstack/react-query';
import { apiFetch as mockedApiFetch } from '@/lib/api';
import type { ChatConversation, ChatLiveEvent, ChatMessage } from '@hsdg/contracts';
import {
  CHAT_KEYS,
  applyReceipt,
  attachmentProblem,
  bubbleTime,
  dayLabel,
  flattenPages,
  formatBytes,
  formatDuration,
  groupByDay,
  handleChatEvent,
  initials,
  isTyping,
  listTime,
  mergeMessage,
  unreadFromThem,
  voiceExtension,
  type MessagePages,
  type ShownMessage,
} from '../chat-api';
import { guessType } from '../chat-composer';
import { personMatches } from '../chat-list';

jest.mock('@/lib/api', () => ({
  apiFetch: jest.fn(() => Promise.resolve(undefined)),
  ApiError: class extends Error {},
}));
const apiFetch = jest.mocked(mockedApiFetch);

const msg = (over: Partial<ShownMessage> = {}): ShownMessage => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: 'me',
  mine: true,
  body: 'hello',
  attachment: null,
  clientRef: null,
  createdAt: '2026-11-05T08:00:00.000Z',
  deliveredAt: null,
  readAt: null,
  tick: 'sent',
  ...over,
});

const NOW = new Date('2026-11-05T10:00:00.000Z'); // 15:30 IST

describe('the thread’s messages', () => {
  it('adds a new one in time order', () => {
    const a = msg({ id: 'a', createdAt: '2026-11-05T08:00:00.000Z' });
    const c = msg({ id: 'c', createdAt: '2026-11-05T08:02:00.000Z' });
    const b = msg({ id: 'b', createdAt: '2026-11-05T08:01:00.000Z' });
    expect(mergeMessage([a, c], b).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces the same message rather than doubling it — by id, or the pending copy by clientRef', () => {
    const pending = msg({ id: 'pending:r1', clientRef: 'r1', pending: true });
    const saved = msg({ id: 'm9', clientRef: 'r1' });
    expect(mergeMessage([pending], saved)).toEqual([saved]);
    expect(mergeMessage([saved], { ...saved, body: 'x' })).toHaveLength(1);
  });

  it('never takes the ticks back down when an older copy arrives', () => {
    const read = msg({ tick: 'read', deliveredAt: 'd', readAt: 'r' });
    const stale = msg({ tick: 'delivered', deliveredAt: 'd' });
    expect(mergeMessage([read], stale)[0]!.tick).toBe('read');
  });

  it('a receipt moves my messages on: sent → delivered → read', () => {
    const items = [msg({ id: 'a' }), msg({ id: 'b' }), msg({ id: 't', mine: false })];
    const delivered = applyReceipt(items, ['a', 'b', 't'], 'delivered', 'D');
    expect(delivered.map((m) => m.tick)).toEqual(['delivered', 'delivered', 'sent']);
    expect(delivered[0]!.deliveredAt).toBe('D');
    const read = applyReceipt(delivered, ['a'], 'read', 'R');
    expect(read[0]).toMatchObject({ tick: 'read', deliveredAt: 'D', readAt: 'R' });
    expect(read[1]!.tick).toBe('delivered');
    // A late "delivered" after "read" changes nothing.
    expect(applyReceipt(read, ['a'], 'delivered', 'X')).toBe(read);
  });

  it('a read receipt on a message never marked delivered fills both', () => {
    expect(applyReceipt([msg()], ['m1'], 'read', 'R')[0]).toMatchObject({
      deliveredAt: 'R',
      readAt: 'R',
    });
  });

  it('finds what they sent that I have not read', () => {
    const items = [
      msg({ id: 'a', mine: false }),
      msg({ id: 'b', mine: false, readAt: 'r', deliveredAt: 'r' }),
      msg({ id: 'c' }),
    ];
    expect(unreadFromThem(items).map((m) => m.id)).toEqual(['a']);
  });

  it('reads the pages oldest first (the newest page comes first)', () => {
    const data: MessagePages = {
      pages: [
        { items: [msg({ id: 'c' }), msg({ id: 'd' })], hasMore: true },
        { items: [msg({ id: 'a' }), msg({ id: 'b' })], hasMore: false },
      ],
      pageParams: [undefined, 'c'],
    };
    expect(flattenPages(data).map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(flattenPages(undefined)).toEqual([]);
  });
});

describe('days and times (IST)', () => {
  it('labels the day: Today, Yesterday, else the date', () => {
    expect(dayLabel('2026-11-05T01:00:00.000Z', NOW)).toBe('Today');
    // 23:00 IST on the 4th.
    expect(dayLabel('2026-11-04T17:30:00.000Z', NOW)).toBe('Yesterday');
    // 00:10 IST on the 5th is today, though it is still the 4th in UTC.
    expect(dayLabel('2026-11-04T18:40:00.000Z', NOW)).toBe('Today');
    expect(dayLabel('2026-10-03T06:00:00.000Z', NOW)).toBe('3 Oct 2026');
  });

  it('groups messages under their day', () => {
    const groups = groupByDay(
      [
        msg({ id: 'a', createdAt: '2026-11-04T10:00:00.000Z' }),
        msg({ id: 'b', createdAt: '2026-11-04T12:00:00.000Z' }),
        msg({ id: 'c', createdAt: '2026-11-05T05:00:00.000Z' }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.items.map((m) => m.id)])).toEqual([
      ['Yesterday', ['a', 'b']],
      ['Today', ['c']],
    ]);
  });

  it('shows a bubble’s time and the list’s time', () => {
    expect(bubbleTime('2026-11-05T08:35:00.000Z')).toBe('2:05 pm');
    expect(listTime('2026-11-05T08:35:00.000Z', NOW)).toBe('2:05 pm');
    expect(listTime('2026-11-04T08:35:00.000Z', NOW)).toBe('Yesterday');
    expect(listTime('2026-10-28T08:35:00.000Z', NOW)).toBe('28/10/26');
  });
});

describe('small labels', () => {
  it('formats a voice note’s length and a file’s size', () => {
    expect(formatDuration(7_400)).toBe('0:07');
    expect(formatDuration(750_000)).toBe('12:30');
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(820 * 1024)).toBe('820 KB');
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2.4 MB');
  });

  it('makes initials', () => {
    expect(initials('Deepak Gupta')).toBe('DG');
    expect(initials('  harvinder  singh  bedi ')).toBe('HB');
    expect(initials('Mohan')).toBe('M');
    expect(initials('')).toBe('?');
  });

  it('names a voice note’s file by what the browser recorded', () => {
    expect(voiceExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(voiceExtension('audio/ogg')).toBe('ogg');
    expect(voiceExtension('audio/mp4')).toBe('m4a');
  });

  it('matches people by name, code or office', () => {
    const p = { name: 'Deepak Gupta', code: 'EMP014', officeCode: 'DEL' };
    expect(personMatches(p, 'deep')).toBe(true);
    expect(personMatches(p, 'emp014')).toBe(true);
    expect(personMatches(p, 'del')).toBe(true);
    expect(personMatches(p, 'mumbai')).toBe(false);
    expect(personMatches(p, '  ')).toBe(true);
  });
});

describe('what may be sent', () => {
  it('takes photos and documents of the right type and size', () => {
    expect(attachmentProblem('image', { size: 100, type: 'image/jpeg' })).toBeNull();
    expect(attachmentProblem('document', { size: 100, type: 'application/pdf' })).toBeNull();
    expect(attachmentProblem('voice', { size: 100, type: 'audio/webm;codecs=opus' })).toBeNull();
  });

  it('refuses empty, too big, or the wrong type', () => {
    expect(attachmentProblem('image', { size: 0, type: 'image/png' })).toMatch(/empty/);
    expect(
      attachmentProblem('document', { size: 11 * 1024 * 1024, type: 'application/pdf' }),
    ).toMatch(/10 MB/);
    expect(attachmentProblem('image', { size: 10, type: 'application/pdf' })).toMatch(/photo/);
    expect(attachmentProblem('document', { size: 10, type: 'application/x-msdownload' })).toMatch(
      /cannot be sent/,
    );
  });

  it('guesses a type from the name when the system gives none', () => {
    expect(guessType('Balance Sheet FY25.XLSX')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(guessType('notice.pdf')).toBe('application/pdf');
    expect(guessType('setup.exe')).toBe('');
  });
});

describe('live chat frames', () => {
  const event = (over: Partial<ChatLiveEvent>): ChatLiveEvent => ({
    id: 'e1',
    kind: 'chat.message',
    conversationId: 'c1',
    fromId: 'them',
    fromName: 'Deepak Gupta',
    at: '2026-11-05T08:00:00.000Z',
    ...over,
  });

  const seeded = (): QueryClient => {
    const qc = new QueryClient();
    qc.setQueryData<MessagePages>(CHAT_KEYS.messages('c1'), {
      pages: [{ items: [msg({ id: 'mine1' })], hasMore: false }],
      pageParams: [undefined],
    });
    qc.setQueryData<ChatConversation[]>(CHAT_KEYS.conversations, [
      {
        id: 'c1',
        other: {
          id: 'them',
          name: 'Deepak Gupta',
          code: null,
          officeCode: null,
          role: null,
          online: true,
          lastSeenAt: null,
        },
        lastMessage: msg({ id: 'mine1' }),
        unread: 0,
        lastActivityAt: '2026-11-05T08:00:00.000Z',
      },
    ]);
    return qc;
  };

  beforeEach(() => apiFetch.mockClear());

  it('a new message joins the thread, and the portal says it was delivered', async () => {
    const qc = seeded();
    const m: ChatMessage = msg({ id: 'theirs', mine: false, senderId: 'them' });
    handleChatEvent(qc, event({ message: m }));
    const items = flattenPages(qc.getQueryData(CHAT_KEYS.messages('c1')));
    expect(items.map((x) => x.id)).toEqual(['mine1', 'theirs']);
    await Promise.resolve();
    expect(apiFetch).toHaveBeenCalledWith('/chat/delivered', {
      method: 'POST',
      body: { messageIds: ['theirs'] },
    });
  });

  it('a receipt turns my ticks blue in the thread and the list', () => {
    const qc = seeded();
    handleChatEvent(
      qc,
      event({ kind: 'chat.receipt', receipt: { messageIds: ['mine1'], tick: 'read', at: 'R' } }),
    );
    expect(flattenPages(qc.getQueryData(CHAT_KEYS.messages('c1')))[0]!.tick).toBe('read');
    expect(
      qc.getQueryData<ChatConversation[]>(CHAT_KEYS.conversations)![0]!.lastMessage!.tick,
    ).toBe('read');
  });

  it('typing shows for a few seconds, and a message from them ends it', () => {
    const qc = seeded();
    handleChatEvent(qc, event({ kind: 'chat.typing' }));
    expect(isTyping('c1')).toBe(true);
    expect(isTyping('c1', Date.now() + 6_000)).toBe(false);
    handleChatEvent(qc, event({ message: msg({ id: 'x', mine: false }) }));
    expect(isTyping('c1')).toBe(false);
  });
});
