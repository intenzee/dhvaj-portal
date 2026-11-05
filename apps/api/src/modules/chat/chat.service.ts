import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CHAT_LIVE_EVENT,
  CHAT_VOICE_MAX_MS,
  baseContentType,
  chatAttachmentAllowed,
  chatTick,
  type ChatAttachmentInput,
  type ChatConversation,
  type ChatLiveEvent,
  type ChatMessage,
  type ChatMessagesPage,
  type ChatPerson,
  type ChatTick,
  type ChatUnread,
  type SendChatMessageInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AppConfigService } from '../../config/config.module';
import { LiveEventsService } from '../live/live-events.service';
import { decodeUpload } from '../documents/documents.upload';
import { STORAGE_PROVIDER, type StorageProvider } from '../documents/storage/storage-provider';
import { notLinkedToEmployee } from '../../common/errors/staff-link.messages';

interface PersonRow {
  id: string;
  full_name: string;
  employee_code: string | null;
  office_code: string | null;
  role_slug: string | null;
  can_receive: boolean;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_employee_id: string;
  recipient_employee_id: string;
  body: string;
  client_ref: string | null;
  attachment_kind: 'image' | 'voice' | 'document' | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: string | null;
  duration_ms: number | null;
  created_at: Date;
  delivered_at: Date | null;
  read_at: Date | null;
}

/** When someone's portal was last seen, and whether it is open now. */
interface Seen {
  at: Date;
  online: boolean;
}

const MESSAGE_COLS = `m.id, m.conversation_id, m.sender_employee_id, m.recipient_employee_id,
  m.body, m.client_ref, m.attachment_kind, m.file_name, m.content_type, m.size_bytes,
  m.duration_ms, m.created_at, m.delivered_at, m.read_at`;

/** Receipts go out in chunks of this many ids (a NOTIFY payload is capped near 8 KB). */
const RECEIPT_CHUNK = 100;

/** A message small enough to ride in a live event (NOTIFY payloads are capped near 8 KB). */
export function fitsLive(m: ChatMessage): boolean {
  return Buffer.byteLength(JSON.stringify(m), 'utf8') <= 5_000;
}

/** A file name safe to store and to put in a header. Pure — tested. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base
    .replace(/[\u0000-\u001f\u007f"<>|]/g, '_')
    .trim()
    .slice(0, 255);
  return clean || 'file';
}

/** Whether the first bytes match what the type says (for the types that have a signature). */
export function bytesMatchType(buffer: Buffer, contentType: string): boolean {
  const t = baseContentType(contentType);
  const starts = (sig: number[], at = 0): boolean => sig.every((b, i) => buffer[at + i] === b);
  switch (t) {
    case 'application/pdf':
      return starts([0x25, 0x50, 0x44, 0x46]); // %PDF
    case 'image/png':
      return starts([0x89, 0x50, 0x4e, 0x47]);
    case 'image/jpeg':
      return starts([0xff, 0xd8, 0xff]);
    case 'image/gif':
      return starts([0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
    default:
      return true;
  }
}

/**
 * Chat: direct messages between two people in the firm, with WhatsApp's
 * ticks, typing and last seen. Row Level Security keeps a chat to its two
 * people. Delivery and reading are set by the recipient only; each sends the
 * sender a `chat.receipt` live event, so their ticks turn as it happens.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly live: LiveEventsService,
    private readonly config: AppConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private me(ctx: RlsContext, action: string): string {
    if (!ctx.employeeId) throw new BadRequestException(notLinkedToEmployee(action));
    return ctx.employeeId;
  }

  // ── People and presence ─────────────────────────────────────────────────

  private async peopleMap(client: PoolClient): Promise<Map<string, PersonRow>> {
    const { rows } = await client.query<PersonRow>(
      `SELECT id, full_name, employee_code, office_code, role_slug, can_receive
         FROM hsdg.quick_task_people()`,
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async seenMap(client: PoolClient, ids: string[]): Promise<Map<string, Seen>> {
    if (ids.length === 0) return new Map();
    const { rows } = await client.query<{
      employee_id: string;
      last_seen_at: Date;
      online: boolean;
    }>(
      `SELECT employee_id, last_seen_at, online_until > now() AS online
         FROM hsdg.chat_presence WHERE employee_id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((r) => [r.employee_id, { at: r.last_seen_at, online: r.online }]));
  }

  private person(people: Map<string, PersonRow>, seen: Map<string, Seen>, id: string): ChatPerson {
    const p = people.get(id);
    const s = seen.get(id);
    return {
      id,
      name: p?.full_name ?? 'Former colleague',
      code: p?.employee_code ?? null,
      officeCode: p?.office_code ?? null,
      role: p?.role_slug ?? null,
      online: s?.online ?? false,
      lastSeenAt: s?.at.toISOString() ?? null,
    };
  }

  /** Seen now (being online is the live stream's to say). */
  private async touchWith(client: PoolClient, me: string): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.chat_presence (employee_id, last_seen_at) VALUES ($1, now())
       ON CONFLICT (employee_id) DO UPDATE SET last_seen_at = now()`,
      [me],
    );
  }

  /** Everyone you can message: the firm's people with a working login, but you. */
  async people(ctx: RlsContext): Promise<ChatPerson[]> {
    const me = this.me(ctx, 'chat');
    return this.db.withRlsContext(ctx, async (client) => {
      const people = await this.peopleMap(client);
      const ids = [...people.values()].filter((p) => p.can_receive && p.id !== me).map((p) => p.id);
      const seen = await this.seenMap(client, ids);
      return ids
        .map((id) => this.person(people, seen, id))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  // ── Conversations ───────────────────────────────────────────────────────

  private message(r: MessageRow, me: string): ChatMessage {
    const deliveredAt = r.delivered_at?.toISOString() ?? null;
    const readAt = r.read_at?.toISOString() ?? null;
    return {
      id: r.id,
      conversationId: r.conversation_id,
      senderId: r.sender_employee_id,
      mine: r.sender_employee_id === me,
      body: r.body,
      attachment: r.attachment_kind
        ? {
            kind: r.attachment_kind,
            fileName: r.file_name ?? 'file',
            contentType: r.content_type ?? 'application/octet-stream',
            sizeBytes: Number(r.size_bytes ?? 0),
            durationMs: r.duration_ms,
          }
        : null,
      clientRef: r.client_ref,
      createdAt: r.created_at.toISOString(),
      deliveredAt,
      readAt,
      tick: chatTick({ deliveredAt, readAt }),
    };
  }

  /** The other person in a chat the caller is in (RLS hides the rest: 404). */
  private async conversationOf(
    client: PoolClient,
    id: string,
    me: string,
  ): Promise<{ id: string; other: string; created_at: Date; last_message_at: Date | null }> {
    const { rows } = await client.query<{
      id: string;
      employee_a_id: string;
      employee_b_id: string;
      created_at: Date;
      last_message_at: Date | null;
    }>(
      `SELECT id, employee_a_id, employee_b_id, created_at, last_message_at
         FROM hsdg.chat_conversations WHERE id = $1`,
      [id],
    );
    const c = rows[0];
    if (!c) throw new NotFoundException('That chat was not found.');
    return { ...c, other: c.employee_a_id === me ? c.employee_b_id : c.employee_a_id };
  }

  /**
   * Your chats, newest first. Opening the list is your portal receiving
   * what was waiting: those messages turn delivered.
   */
  async conversations(ctx: RlsContext): Promise<ChatConversation[]> {
    const me = this.me(ctx, 'chat');
    return this.db.withRlsContext(ctx, async (client) => {
      await this.touchWith(client, me);
      await this.markDelivered(client, me, null);
      const { rows } = await client.query<
        MessageRow & {
          c_id: string;
          other_id: string;
          c_created_at: Date;
          c_last_message_at: Date | null;
          unread: number;
          has_last: boolean;
        }
      >(
        `SELECT c.id AS c_id,
                CASE WHEN c.employee_a_id = $1 THEN c.employee_b_id ELSE c.employee_a_id END AS other_id,
                c.created_at AS c_created_at, c.last_message_at AS c_last_message_at,
                (SELECT count(*)::int FROM hsdg.chat_messages u
                  WHERE u.conversation_id = c.id AND u.recipient_employee_id = $1
                    AND u.read_at IS NULL) AS unread,
                (m.id IS NOT NULL) AS has_last, ${MESSAGE_COLS}
           FROM hsdg.chat_conversations c
           LEFT JOIN LATERAL (
             SELECT * FROM hsdg.chat_messages x WHERE x.conversation_id = c.id
              ORDER BY x.created_at DESC, x.id DESC LIMIT 1) m ON true
          ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
        [me],
      );
      const people = await this.peopleMap(client);
      const seen = await this.seenMap(
        client,
        rows.map((r) => r.other_id),
      );
      return rows.map((r) => ({
        id: r.c_id,
        other: this.person(people, seen, r.other_id),
        lastMessage: r.has_last ? this.message(r, me) : null,
        unread: r.unread,
        lastActivityAt: (r.c_last_message_at ?? r.c_created_at).toISOString(),
      }));
    });
  }

  /** One chat's header. */
  async conversation(ctx: RlsContext, id: string): Promise<ChatConversation> {
    const me = this.me(ctx, 'chat');
    return this.db.withRlsContext(ctx, (client) => this.conversationWith(client, id, me));
  }

  private async conversationWith(
    client: PoolClient,
    id: string,
    me: string,
  ): Promise<ChatConversation> {
    const c = await this.conversationOf(client, id, me);
    const people = await this.peopleMap(client);
    const seen = await this.seenMap(client, [c.other]);
    const { rows } = await client.query<MessageRow>(
      `SELECT ${MESSAGE_COLS} FROM hsdg.chat_messages m WHERE m.conversation_id = $1
        ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
      [id],
    );
    const { rows: unread } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.chat_messages
        WHERE conversation_id = $1 AND recipient_employee_id = $2 AND read_at IS NULL`,
      [id, me],
    );
    return {
      id: c.id,
      other: this.person(people, seen, c.other),
      lastMessage: rows[0] ? this.message(rows[0], me) : null,
      unread: unread[0]?.n ?? 0,
      lastActivityAt: (c.last_message_at ?? c.created_at).toISOString(),
    };
  }

  /** Open the chat with someone (or the one already open). */
  async open(ctx: RlsContext, employeeId: string): Promise<ChatConversation> {
    const me = this.me(ctx, 'chat');
    if (employeeId === me) throw new BadRequestException('You cannot chat with yourself.');
    return this.db.withRlsContext(ctx, async (client) => {
      const people = await this.peopleMap(client);
      const them = people.get(employeeId);
      if (!them) throw new NotFoundException('That person was not found.');
      const [a, b] = me < employeeId ? [me, employeeId] : [employeeId, me];
      const { rows: found } = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.chat_conversations WHERE employee_a_id = $1 AND employee_b_id = $2`,
        [a, b],
      );
      let id = found[0]?.id;
      if (!id) {
        if (!them.can_receive)
          throw new BadRequestException(`${them.full_name} has no working login to chat with.`);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.chat_conversations (employee_a_id, employee_b_id) VALUES ($1, $2)
           ON CONFLICT (employee_a_id, employee_b_id) DO UPDATE SET employee_a_id = EXCLUDED.employee_a_id
           RETURNING id`,
          [a, b],
        );
        id = rows[0]!.id;
      }
      return this.conversationWith(client, id, me);
    });
  }

  // ── Messages ────────────────────────────────────────────────────────────

  /** A page of messages, oldest first; `before` pages back from a message. */
  async messages(
    ctx: RlsContext,
    id: string,
    before: string | undefined,
    limit = 50,
  ): Promise<ChatMessagesPage> {
    const me = this.me(ctx, 'chat');
    const take = Math.min(Math.max(limit, 1), 100);
    return this.db.withRlsContext(ctx, async (client) => {
      await this.conversationOf(client, id, me);
      const params: unknown[] = [id, take + 1];
      let cursor = '';
      if (before) {
        const { rows: b } = await client.query<{ created_at: Date; id: string }>(
          `SELECT created_at, id FROM hsdg.chat_messages WHERE id = $1 AND conversation_id = $2`,
          [before, id],
        );
        if (!b[0]) throw new BadRequestException('That message is not in this chat.');
        params.push(b[0].created_at, b[0].id);
        cursor = 'AND (m.created_at, m.id) < ($3, $4)';
      }
      const { rows } = await client.query<MessageRow>(
        `SELECT ${MESSAGE_COLS} FROM hsdg.chat_messages m
          WHERE m.conversation_id = $1 ${cursor}
          ORDER BY m.created_at DESC, m.id DESC LIMIT $2`,
        params,
      );
      const hasMore = rows.length > take;
      const page = rows.slice(0, take).reverse();
      // Seeing them is receiving them.
      const waiting = page
        .filter((r) => r.recipient_employee_id === me && !r.delivered_at)
        .map((r) => r.id);
      if (waiting.length) {
        const marked = await this.markDelivered(client, me, waiting);
        const at = new Set(marked.map((m) => m.id));
        for (const r of page) if (at.has(r.id)) r.delivered_at = new Date();
      }
      return { items: page.map((r) => this.message(r, me)), hasMore };
    });
  }

  /** Send text, or a photo / voice note / document with an optional caption. */
  async send(ctx: RlsContext, id: string, input: SendChatMessageInput): Promise<ChatMessage> {
    const me = this.me(ctx, 'chat');
    const body = (input.body ?? '').trim();
    const a = input.attachment;
    if (!body && !a) throw new BadRequestException('Write a message or attach a file.');
    if (a) this.checkAttachment(a);
    const file = a ? decodeUpload(a.contentBase64, this.config.get('DOCUMENT_MAX_BYTES')) : null;
    if (a && file && !bytesMatchType(file.buffer, a.contentType)) {
      throw new BadRequestException('The file is not what its type says it is.');
    }

    return this.db.withRlsContext(ctx, async (client) => {
      const c = await this.conversationOf(client, id, me);
      if (input.clientRef) {
        const { rows: again } = await client.query<MessageRow>(
          `SELECT ${MESSAGE_COLS} FROM hsdg.chat_messages m
            WHERE m.sender_employee_id = $1 AND m.client_ref = $2`,
          [me, input.clientRef],
        );
        if (again[0]) return this.message(again[0], me);
      }
      const people = await this.peopleMap(client);
      if (!people.get(c.other)?.can_receive) {
        throw new ForbiddenException(
          'They have left or have no working login; they cannot receive messages.',
        );
      }

      let reference: string | null = null;
      const { rows: idRow } = await client.query<{ id: string }>('SELECT gen_random_uuid() AS id');
      const messageId = idRow[0]!.id;
      if (a && file) {
        reference = this.storage.newReference(`chat/${id}`, messageId);
        await this.storage.write(reference, file.buffer, baseContentType(a.contentType));
      }
      try {
        const { rows } = await client.query<MessageRow>(
          `INSERT INTO hsdg.chat_messages AS m
             (id, conversation_id, sender_employee_id, recipient_employee_id, body, client_ref,
              attachment_kind, file_name, content_type, size_bytes, duration_ms,
              checksum_sha256, storage_reference)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING ${MESSAGE_COLS}`,
          [
            messageId,
            id,
            me,
            c.other,
            body,
            input.clientRef ?? null,
            a?.kind ?? null,
            a ? cleanFileName(a.fileName) : null,
            a ? baseContentType(a.contentType) : null,
            file?.sizeBytes ?? null,
            a?.kind === 'voice' ? Math.round(a.durationMs ?? 0) : null,
            file?.checksumSha256 ?? null,
            reference,
          ],
        );
        const row = rows[0]!;
        await client.query(
          `UPDATE hsdg.chat_conversations SET last_message_at = $2 WHERE id = $1`,
          [id, row.created_at],
        );
        await this.touchWith(client, me);
        const msg = this.message(row, me);
        await this.publish(client, [c.other], {
          kind: CHAT_LIVE_EVENT.message,
          conversationId: id,
          fromId: me,
          fromName: people.get(me)?.full_name ?? null,
          // The recipient's view of it; a long one is fetched instead (NOTIFY's cap).
          message: fitsLive(msg) ? { ...msg, mine: false } : undefined,
        });
        return msg;
      } catch (err) {
        if (reference) await this.storage.remove(reference).catch(() => undefined);
        throw err;
      }
    });
  }

  private checkAttachment(a: ChatAttachmentInput): void {
    if (!chatAttachmentAllowed(a.kind, a.contentType)) {
      throw new BadRequestException(
        a.kind === 'image'
          ? 'Send a JPEG, PNG, WebP, GIF or HEIC photo.'
          : a.kind === 'voice'
            ? 'That recording format is not supported.'
            : 'That file type cannot be shared here (PDF, Word, Excel, PowerPoint, CSV, text, ZIP or images).',
      );
    }
    if (a.kind === 'voice') {
      if (a.durationMs === undefined || a.durationMs <= 0)
        throw new BadRequestException('A voice note needs its length.');
      if (a.durationMs > CHAT_VOICE_MAX_MS)
        throw new BadRequestException('A voice note can be at most 15 minutes.');
    }
  }

  /** An attachment's bytes, for one of the two people in the chat. */
  async file(
    ctx: RlsContext,
    messageId: string,
  ): Promise<{
    buffer: Buffer;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    kind: string;
  }> {
    this.me(ctx, 'chat');
    const row = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        storage_reference: string | null;
        file_name: string | null;
        content_type: string | null;
        attachment_kind: string | null;
      }>(
        `SELECT storage_reference, file_name, content_type, attachment_kind
           FROM hsdg.chat_messages WHERE id = $1`,
        [messageId],
      );
      return rows[0];
    });
    if (!row?.storage_reference) throw new NotFoundException('That file was not found.');
    const buffer = await this.storage.read(row.storage_reference);
    return {
      buffer,
      fileName: row.file_name ?? 'file',
      contentType: row.content_type ?? 'application/octet-stream',
      sizeBytes: buffer.length,
      kind: row.attachment_kind ?? 'document',
    };
  }

  // ── Ticks and typing ────────────────────────────────────────────────────

  /**
   * Mark messages to the caller delivered — the given ones, or (ids null)
   * everything waiting — and tell each sender. Returns what turned.
   */
  private async markDelivered(
    client: PoolClient,
    me: string,
    ids: string[] | null,
  ): Promise<{ id: string; conversation_id: string; sender_employee_id: string }[]> {
    const { rows } = await client.query<{
      id: string;
      conversation_id: string;
      sender_employee_id: string;
    }>(
      `UPDATE hsdg.chat_messages SET delivered_at = now()
        WHERE recipient_employee_id = $1 AND delivered_at IS NULL
          AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
        RETURNING id, conversation_id, sender_employee_id`,
      [me, ids],
    );
    await this.receipts(client, me, rows, 'delivered');
    return rows;
  }

  private async receipts(
    client: PoolClient,
    me: string,
    rows: { id: string; conversation_id: string; sender_employee_id: string }[],
    tick: Exclude<ChatTick, 'sent'>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const groups = new Map<string, { to: string; ids: string[] }>();
    for (const r of rows) {
      const g = groups.get(r.conversation_id) ?? { to: r.sender_employee_id, ids: [] };
      g.ids.push(r.id);
      groups.set(r.conversation_id, g);
    }
    const at = new Date().toISOString();
    for (const [conversationId, g] of groups) {
      for (let i = 0; i < g.ids.length; i += RECEIPT_CHUNK) {
        await this.publish(client, [g.to], {
          kind: CHAT_LIVE_EVENT.receipt,
          conversationId,
          fromId: me,
          fromName: null,
          receipt: { messageIds: g.ids.slice(i, i + RECEIPT_CHUNK), tick, at },
        });
      }
    }
  }

  /** Your portal received these messages (two grey ticks for their sender). */
  async delivered(ctx: RlsContext, messageIds: string[]): Promise<{ delivered: number }> {
    const me = this.me(ctx, 'chat');
    return this.db.withRlsContext(ctx, async (client) => {
      const rows = await this.markDelivered(client, me, messageIds);
      return { delivered: rows.length };
    });
  }

  /** You read everything in the chat (two blue ticks for the other person). */
  async read(ctx: RlsContext, id: string): Promise<{ read: number }> {
    const me = this.me(ctx, 'chat');
    return this.db.withRlsContext(ctx, async (client) => {
      await this.conversationOf(client, id, me);
      await this.touchWith(client, me);
      const { rows } = await client.query<{
        id: string;
        conversation_id: string;
        sender_employee_id: string;
      }>(
        `UPDATE hsdg.chat_messages
            SET read_at = now(), delivered_at = COALESCE(delivered_at, now())
          WHERE conversation_id = $1 AND recipient_employee_id = $2 AND read_at IS NULL
          RETURNING id, conversation_id, sender_employee_id`,
        [id, me],
      );
      await this.receipts(client, me, rows, 'read');
      return { read: rows.length };
    });
  }

  /** You are typing: a live event to the other person, nothing kept. */
  async typing(ctx: RlsContext, id: string): Promise<void> {
    const me = this.me(ctx, 'chat');
    await this.db.withRlsContext(ctx, async (client) => {
      const c = await this.conversationOf(client, id, me);
      await this.touchWith(client, me);
      await this.publish(client, [c.other], {
        kind: CHAT_LIVE_EVENT.typing,
        conversationId: id,
        fromId: me,
        fromName: null,
      });
    });
  }

  /** Unread across all chats; asking is your portal receiving what waited. */
  async unread(ctx: RlsContext): Promise<ChatUnread> {
    const me = this.me(ctx, 'chat');
    return this.db.withRlsContext(ctx, async (client) => {
      await this.touchWith(client, me);
      await this.markDelivered(client, me, null);
      const { rows } = await client.query<{ messages: number; conversations: number }>(
        `SELECT count(*)::int AS messages, count(DISTINCT conversation_id)::int AS conversations
           FROM hsdg.chat_messages WHERE recipient_employee_id = $1 AND read_at IS NULL`,
        [me],
      );
      return rows[0] ?? { messages: 0, conversations: 0 };
    });
  }

  private publish(
    client: PoolClient,
    to: string[],
    event: Omit<ChatLiveEvent, 'id' | 'at'>,
  ): Promise<void> {
    return this.live.publishWith(client, to, event);
  }
}
