/**
 * Chat: direct messages between two people in the firm, with WhatsApp's
 * ticks — one grey tick when the portal has it (sent), two grey when it
 * reached the other person's portal (delivered), two blue when they opened
 * the conversation (read) — "typing…", and online / last seen.
 *
 *   GET  /chat/people                         who you can message
 *   GET  /chat/conversations                  your chats, newest first
 *   POST /chat/conversations                  open (or find) the chat with someone
 *   GET  /chat/conversations/:id              one chat's header (the other person)
 *   GET  /chat/conversations/:id/messages     a page of messages, newest last
 *   POST /chat/conversations/:id/messages     send
 *   POST /chat/conversations/:id/read         you read everything in it
 *   POST /chat/conversations/:id/typing       you are typing (a live event, nothing kept)
 *   POST /chat/delivered                      your portal received these messages
 *   GET  /chat/unread                         how many unread, for the sidebar badge
 *
 * Live events (GET /live/stream) carry `chat.message`, `chat.receipt` and
 * `chat.typing` frames whose data is a ChatLiveEvent.
 */

/** A message's ticks, from its sender's side. */
export const CHAT_TICK = {
  /** One grey tick: the portal has it. */
  sent: 'sent',
  /** Two grey ticks: it reached the other person's portal. */
  delivered: 'delivered',
  /** Two blue ticks: they opened the chat. */
  read: 'read',
} as const;
export type ChatTick = (typeof CHAT_TICK)[keyof typeof CHAT_TICK];

/** The longest message. */
export const CHAT_MESSAGE_MAX = 4000;

/** "Online" means the person's portal was seen within this long. */
export const CHAT_ONLINE_WINDOW_MS = 60_000;

/** How long "typing…" shows after the last typing event. */
export const CHAT_TYPING_SHOW_MS = 5_000;

/** Send a typing event at most this often while someone types. */
export const CHAT_TYPING_EVERY_MS = 3_000;

export interface ChatPerson {
  id: string;
  name: string;
  code: string | null;
  officeCode: string | null;
  role: string | null;
  /** Their portal was seen within CHAT_ONLINE_WINDOW_MS. */
  online: boolean;
  /** When their portal was last seen; null if never. */
  lastSeenAt: string | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  /** Sent by the caller. */
  mine: boolean;
  body: string;
  /** The sender's own id for it, so a resend never doubles it. */
  clientRef: string | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  /** The ticks (meaningful on the caller's own messages). */
  tick: ChatTick;
}

export interface ChatConversation {
  id: string;
  other: ChatPerson;
  lastMessage: ChatMessage | null;
  /** Messages to the caller not yet read. */
  unread: number;
  /** When the last message was sent, else when the chat was opened. */
  lastActivityAt: string;
}

export interface ChatMessagesPage {
  /** Oldest first. */
  items: ChatMessage[];
  /** More older messages exist (ask again with `before` = items[0].id). */
  hasMore: boolean;
}

/** POST /chat/conversations */
export interface OpenChatInput {
  employeeId: string;
}

/** POST /chat/conversations/:id/messages */
export interface SendChatMessageInput {
  body: string;
  /** A uuid the sender makes, so a retried send is not stored twice. */
  clientRef?: string;
}

/** POST /chat/delivered */
export interface ChatDeliveredInput {
  /** The messages to the caller that their portal received. */
  messageIds: string[];
}

/** GET /chat/unread */
export interface ChatUnread {
  /** Unread messages across all chats. */
  messages: number;
  /** Chats with at least one unread message. */
  conversations: number;
}

export const CHAT_LIVE_EVENT = {
  /** A new message for you. */
  message: 'chat.message',
  /** Your messages were delivered or read. */
  receipt: 'chat.receipt',
  /** The other person is typing. */
  typing: 'chat.typing',
} as const;
export type ChatLiveEventKind = (typeof CHAT_LIVE_EVENT)[keyof typeof CHAT_LIVE_EVENT];

/** What a chat frame on GET /live/stream carries. */
export interface ChatLiveEvent {
  id: string;
  kind: ChatLiveEventKind;
  conversationId: string;
  /** Who caused it. */
  fromId: string;
  fromName: string | null;
  at: string;
  /** chat.message: the message (its sender's view of the ticks is not the recipient's). */
  message?: ChatMessage;
  /** chat.receipt: which of your messages, and how far they got. */
  receipt?: { messageIds: string[]; tick: Exclude<ChatTick, 'sent'>; at: string };
}

/** Whether a live frame is a chat one (the stream carries quick-task frames too). */
export function isChatLiveKind(kind: string): kind is ChatLiveEventKind {
  return kind === 'chat.message' || kind === 'chat.receipt' || kind === 'chat.typing';
}

/** The tick a message shows. Pure — tested. */
export function chatTick(m: { deliveredAt: string | null; readAt: string | null }): ChatTick {
  if (m.readAt) return CHAT_TICK.read;
  if (m.deliveredAt) return CHAT_TICK.delivered;
  return CHAT_TICK.sent;
}

/** Online when seen within the window. Pure — tested. */
export function chatOnline(lastSeenAt: string | null, now: number = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  return Number.isFinite(t) && now - t < CHAT_ONLINE_WINDOW_MS;
}

/**
 * WhatsApp's header line: "online", "last seen today at 14:05", "last seen
 * yesterday at 09:10", "last seen 03 Nov at 18:00" (with the year when not
 * this year). Times in IST. Pure — tested.
 */
export function lastSeenLabel(
  p: Pick<ChatPerson, 'online' | 'lastSeenAt'>,
  now: Date = new Date(),
): string {
  if (p.online) return 'online';
  if (!p.lastSeenAt) return '';
  const seen = new Date(p.lastSeenAt);
  if (Number.isNaN(seen.getTime())) return '';
  const IST = 330 * 60_000;
  const day = (d: Date): string => new Date(d.getTime() + IST).toISOString().slice(0, 10);
  const time = new Date(seen.getTime() + IST).toISOString().slice(11, 16);
  const today = day(now);
  const yesterday = day(new Date(now.getTime() - 86_400_000));
  const d = day(seen);
  if (d === today) return `last seen today at ${time}`;
  if (d === yesterday) return `last seen yesterday at ${time}`;
  const [y, m, dd] = d.split('-');
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const label = `${dd} ${MONTHS[Number(m) - 1]}${y === today.slice(0, 4) ? '' : ` ${y}`}`;
  return `last seen ${label} at ${time}`;
}
