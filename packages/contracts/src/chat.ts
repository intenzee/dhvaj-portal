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
 *   POST /chat/conversations/:id/messages     send text, a photo, a voice note or a document
 *   GET  /chat/messages/:id/file              the attachment's bytes (photo / voice inline)
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

/** An open portal counts as online this long after each live-stream ping. */
export const CHAT_ONLINE_WINDOW_MS = 60_000;

/** How long "typing…" shows after the last typing event. */
export const CHAT_TYPING_SHOW_MS = 5_000;

/** Send a typing event at most this often while someone types. */
export const CHAT_TYPING_EVERY_MS = 3_000;

/** What a message can carry besides text. */
export const CHAT_ATTACHMENT_KINDS = ['image', 'voice', 'document'] as const;
export type ChatAttachmentKind = (typeof CHAT_ATTACHMENT_KINDS)[number];

/** The file types each kind accepts (the API refuses others). */
export const CHAT_ATTACHMENT_TYPES: Record<ChatAttachmentKind, readonly string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
  voice: [
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/aac',
    'audio/wav',
    'audio/x-m4a',
  ],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv',
    'text/plain',
    'application/zip',
    'application/json',
    'application/xml',
    'text/xml',
    // A document may also be any image (sent as a file, not a photo).
    'image/jpeg',
    'image/png',
    'image/webp',
  ],
};

/** The largest attachment (the portal's document limit, before base64). */
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** The longest voice note. */
export const CHAT_VOICE_MAX_MS = 15 * 60_000;

/** The media type without parameters ("audio/webm;codecs=opus" → "audio/webm"). Pure — tested. */
export function baseContentType(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase();
}

/** Whether a file of this type may be sent as this kind. Pure — tested. */
export function chatAttachmentAllowed(kind: ChatAttachmentKind, contentType: string): boolean {
  return CHAT_ATTACHMENT_TYPES[kind].includes(baseContentType(contentType));
}

export interface ChatAttachment {
  kind: ChatAttachmentKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Voice notes: how long. */
  durationMs: number | null;
}

/** An attachment as sent: the file, base64. */
export interface ChatAttachmentInput {
  kind: ChatAttachmentKind;
  fileName: string;
  contentType: string;
  contentBase64: string;
  /** Voice notes: how long, as recorded. */
  durationMs?: number;
}

/** The chat list's one-line preview of a message. Pure — tested. */
export function chatPreview(m: { body: string; attachment: ChatAttachment | null }): string {
  const a = m.attachment;
  if (!a) return m.body;
  if (a.kind === 'voice') {
    const s = Math.round((a.durationMs ?? 0) / 1000);
    return `🎤 Voice message (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`;
  }
  if (a.kind === 'image') return m.body ? `📷 ${m.body}` : '📷 Photo';
  return `📄 ${a.fileName}`;
}

export interface ChatPerson {
  id: string;
  name: string;
  code: string | null;
  officeCode: string | null;
  role: string | null;
  /** Their portal is open now. */
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
  /** The text, or a photo's / document's caption ('' when none). */
  body: string;
  attachment: ChatAttachment | null;
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
  /** The text; optional (a caption) when there is an attachment. */
  body?: string;
  attachment?: ChatAttachmentInput;
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
 * WhatsApp's header line: "online", "last seen today at 2:05 pm", "last seen
 * yesterday at 9:10 am", "last seen 3 Nov at 6:00 pm" (with the year when not
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
  const [hh, mm] = new Date(seen.getTime() + IST).toISOString().slice(11, 16).split(':');
  const h = Number(hh);
  const time = `${h % 12 || 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
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
  const label = `${Number(dd)} ${MONTHS[Number(m) - 1]}${y === today.slice(0, 4) ? '' : ` ${y}`}`;
  return `last seen ${label} at ${time}`;
}
