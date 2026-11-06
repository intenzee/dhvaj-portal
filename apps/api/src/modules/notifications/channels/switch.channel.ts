import { Logger } from '@nestjs/common';
import { NOTIFICATION_TYPE, type NotificationType } from '@hsdg/contracts';
import type { NotificationChannel, OutboundNotification } from './notification-channel';

/** The rooms of the Dhvaj Desk Switch template, by key. */
export type SwitchRoomKey =
  | 'firm-ops'
  | 'compliance-desk'
  | 'client-chase'
  | 'review-queue'
  | 'partner-signoff'
  | 'notices-itr';

/**
 * Which room hears which notification. Only events a team acts on in chat are
 * here; the date sweep's per-filing reminders (approaching, due today, overdue)
 * stay in each person's inbox, since a room would drown in them, and the desk
 * agent's brief summarises them instead.
 */
const ROOM_OF: Partial<Record<NotificationType, SwitchRoomKey>> = {
  [NOTIFICATION_TYPE.taskAssigned]: 'firm-ops',
  [NOTIFICATION_TYPE.highRiskException]: 'firm-ops',
  [NOTIFICATION_TYPE.filingLodged]: 'compliance-desk',
  [NOTIFICATION_TYPE.clientDependencyOverdue]: 'client-chase',
  [NOTIFICATION_TYPE.clientDependencyReminder]: 'client-chase',
  [NOTIFICATION_TYPE.clientCommitmentOverdue]: 'client-chase',
  [NOTIFICATION_TYPE.documentUploaded]: 'client-chase',
  [NOTIFICATION_TYPE.reviewPending]: 'review-queue',
  [NOTIFICATION_TYPE.taskReviewRequested]: 'review-queue',
  [NOTIFICATION_TYPE.taskReturned]: 'review-queue',
  [NOTIFICATION_TYPE.epSignoffPending]: 'partner-signoff',
  [NOTIFICATION_TYPE.certificateSigned]: 'partner-signoff',
  [NOTIFICATION_TYPE.noticeReceived]: 'notices-itr',
  [NOTIFICATION_TYPE.noticeReplyDue]: 'notices-itr',
  [NOTIFICATION_TYPE.noticeHearingDue]: 'notices-itr',
};

/** Whether this notification belongs in team chat at all. */
export function switchAccepts(type: NotificationType): boolean {
  return ROOM_OF[type] !== undefined;
}

export function switchRoomFor(type: NotificationType): SwitchRoomKey {
  return ROOM_OF[type] ?? 'firm-ops';
}

/**
 * The chat message for one notification: bold title, body, and a portal link.
 * With `mention` (a Switch agent's name) the title line @mentions it, which is
 * what wakes that agent: Switch only hands an agent the messages that name it.
 */
export function switchMessage(n: OutboundNotification, webUrl: string, mention?: string): string {
  const lines = [`${mention ? `@${mention} ` : ''}**${n.title}**`];
  if (n.body) lines.push(n.body);
  if (n.engagementId) lines.push(`${webUrl.replace(/\/$/, '')}/engagements/${n.engagementId}`);
  return lines.join('\n');
}

export interface SwitchChannelConfig {
  url: string;
  agentId: string;
  apiKey: string;
  /** Room key → Switch room id (SWITCH_ROOMS). A key left out is found by name. */
  rooms: Record<string, string>;
  /** Notification type → the Switch agent to @mention for it (SWITCH_MENTIONS). */
  mentions?: Record<string, string>;
  webUrl: string;
}

/**
 * Switch team-chat delivery. The portal is a registered external agent on the
 * Switch server ("dhvaj-portal") and posts each notification ONCE into the
 * room its type belongs to, where the firm's people and its agents see it
 * together — so this channel's audience is the room, not each recipient.
 *
 * Unlike the logging stubs this is a real transport: a failed post throws, and
 * the outbox drain retries it with backoff (it never fails the domain change,
 * which committed when the delivery was enqueued).
 *
 * Rooms are found by name among the rooms dhvaj-portal is in (Switch's
 * `list_rooms`), cached for a minute and looked up again after a refused post,
 * so a template redeployed with new rooms needs no restart. SWITCH_ROOMS pins a
 * key to a room id instead.
 */
export class SwitchChannel implements NotificationChannel {
  readonly name = 'switch';
  readonly audience = 'room' as const;
  readonly accepts = switchAccepts;
  private readonly logger = new Logger(SwitchChannel.name);
  private roomCache: { at: number; byName: Map<string, string> } | null = null;
  static readonly ROOM_CACHE_MS = 60_000;

  constructor(
    private readonly config: SwitchChannelConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async deliver(notification: OutboundNotification): Promise<void> {
    // Client-facing deliveries (an e-mail address, no portal user) are not
    // team-chat messages.
    if (!notification.recipientUserId) return;
    // Rows queued before a type left the list (or by an older build) are dropped.
    if (!switchAccepts(notification.type)) return;
    const key = switchRoomFor(notification.type);
    const roomId = await this.roomIdFor(key);
    if (!roomId) {
      // Thrown, not skipped: the outbox retries once the room exists.
      throw new Error(`[switch] dhvaj-portal is in no room named ${key} (nor firm-ops)`);
    }
    const res = await this.fetchImpl(
      `${this.config.url}/agents/${encodeURIComponent(this.config.agentId)}/message`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          room_id: roomId,
          content: switchMessage(
            notification,
            this.config.webUrl,
            this.config.mentions?.[notification.type],
          ),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      // The room may have been replaced (a redeployed template): look again next time.
      this.roomCache = null;
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Switch refused the post to ${key}: ${res.status} ${detail}`);
    }
  }

  private async roomIdFor(key: SwitchRoomKey): Promise<string | undefined> {
    if (this.config.rooms[key]) return this.config.rooms[key];
    const byName = await this.roomsByName();
    const found = byName.get(key);
    if (found) return found;
    this.logger.warn(`[switch] dhvaj-portal is in no room named ${key}; posting to firm-ops`);
    return this.config.rooms['firm-ops'] ?? byName.get('firm-ops');
  }

  /** The rooms dhvaj-portal is in, by name (archived ones left out). */
  private async roomsByName(): Promise<Map<string, string>> {
    if (this.roomCache && Date.now() - this.roomCache.at < SwitchChannel.ROOM_CACHE_MS) {
      return this.roomCache.byName;
    }
    const res = await this.fetchImpl(
      `${this.config.url}/agents/${encodeURIComponent(this.config.agentId)}/ops/list_rooms`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error(`Switch would not list dhvaj-portal's rooms: ${res.status}`);
    const body = (await res.json()) as {
      result?: { room_id: string; name: string; archived?: boolean }[];
    };
    const byName = new Map<string, string>();
    for (const r of body.result ?? []) if (!r.archived) byName.set(r.name, r.room_id);
    this.roomCache = { at: Date.now(), byName };
    return byName;
  }
}
