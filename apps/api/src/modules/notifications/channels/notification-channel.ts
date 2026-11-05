import type { NotificationType } from '@hsdg/contracts';

/**
 * What an external channel receives to deliver one notification. The recipient
 * is EITHER an internal user (recipientUserId) OR an external client email
 * (recipientEmail) — exactly one is set (§24 client-facing delivery).
 */
export interface OutboundNotification {
  recipientUserId: string | null;
  recipientEmail?: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  engagementId: string | null;
}

/**
 * An external delivery channel (email, Teams, …). The in-app "portal" channel is
 * the persisted notification row itself and is always on, so it is not a channel
 * object; only out-of-band channels implement this. Implementations must be
 * best-effort and MUST NOT throw — a channel outage can never fail the domain
 * operation that emitted the notification.
 */
export interface NotificationChannel {
  readonly name: string;
  /**
   * `recipient` (the default): one delivery per recipient, as e-mail is.
   * `room`: a shared space (a team-chat room) hears an event once, so one
   * delivery is enqueued per event, and client-facing deliveries skip it.
   */
  readonly audience?: 'recipient' | 'room';
  /** Which notification types it carries; all of them when absent. */
  accepts?(type: NotificationType): boolean;
  deliver(notification: OutboundNotification): Promise<void>;
}

/** DI token for the set of enabled external channels. */
export const EXTERNAL_CHANNELS = Symbol('EXTERNAL_CHANNELS');
