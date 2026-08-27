import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { EXTERNAL_CHANNELS, type NotificationChannel } from './channels/notification-channel';

interface DeliveryRow {
  id: string;
  recipient_user_id: string | null;
  recipient_email: string | null;
  channel: string;
  type: string;
  title: string;
  body: string | null;
  engagement_id: string | null;
  attempts: number;
}

/** What one drain pass produced. */
export interface DrainResult {
  sent: number;
  failed: number;
  retried: number;
  pending: number;
}

/**
 * Drains the notification delivery outbox (Phase: durable delivery). Reads due
 * pending rows under the firm-wide operator context, delivers each through its
 * external channel, and records the outcome — marking `sent`, or scheduling a
 * retry with exponential backoff until `maxAttempts`, after which it is `failed`.
 * At-least-once: a crash mid-drain leaves the row pending for the next pass.
 *
 * NOTE: for the current logging stubs, delivery happens inside the claim
 * transaction. A real (slow) transport should claim rows first (mark attempts,
 * commit) and deliver outside the lock — the row shapes here already support it.
 */
@Injectable()
export class NotificationOutboxService {
  private readonly logger = new Logger(NotificationOutboxService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(EXTERNAL_CHANNELS) private readonly channels: NotificationChannel[],
  ) {}

  async drain(
    ctx: RlsContext,
    opts: { limit?: number; maxAttempts?: number } = {},
  ): Promise<DrainResult> {
    const limit = opts.limit ?? 100;
    const maxAttempts = opts.maxAttempts ?? 5;
    const byName = new Map(this.channels.map((c) => [c.name, c]));

    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<DeliveryRow>(
        `SELECT id, recipient_user_id, recipient_email, channel, type, title, body,
                engagement_id, attempts
         FROM hsdg.notification_deliveries
         WHERE status = 'pending' AND next_attempt_at <= now()
         ORDER BY next_attempt_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      );

      let sent = 0;
      let failed = 0;
      let retried = 0;
      for (const row of rows) {
        const channel = byName.get(row.channel);
        if (!channel) {
          // The channel is no longer enabled; leave it pending rather than lose it.
          continue;
        }
        try {
          await channel.deliver({
            recipientUserId: row.recipient_user_id,
            recipientEmail: row.recipient_email,
            type: row.type as never,
            title: row.title,
            body: row.body,
            engagementId: row.engagement_id,
          });
          await client.query(
            `UPDATE hsdg.notification_deliveries
             SET status = 'sent', sent_at = now(), attempts = attempts + 1
             WHERE id = $1`,
            [row.id],
          );
          sent += 1;
        } catch (err) {
          const attempts = row.attempts + 1;
          const done = attempts >= maxAttempts;
          // Exponential backoff, capped at 60 minutes.
          const backoffMinutes = Math.min(2 ** attempts, 60);
          await client.query(
            `UPDATE hsdg.notification_deliveries
             SET status = $2, attempts = $3, last_error = $4,
                 next_attempt_at = now() + ($5 || ' minutes')::interval
             WHERE id = $1`,
            [
              row.id,
              done ? 'failed' : 'pending',
              attempts,
              String(err).slice(0, 500),
              backoffMinutes,
            ],
          );
          if (done) failed += 1;
          else retried += 1;
        }
      }

      const { rows: p } = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM hsdg.notification_deliveries WHERE status = 'pending'`,
      );
      const result: DrainResult = { sent, failed, retried, pending: p[0]?.c ?? 0 };
      if (sent + failed + retried > 0) {
        this.logger.log(
          `Outbox drain — ${sent} sent, ${retried} retried, ${failed} failed, ${result.pending} pending.`,
        );
      }
      return result;
    });
  }
}
