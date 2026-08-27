import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_STATUS,
  type NotificationStatus,
  type NotificationType,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { resolveAmbientCorrelationId } from '../../common/context/request-context';
import {
  EXTERNAL_CHANNELS,
  type NotificationChannel,
  type OutboundNotification,
} from './channels/notification-channel';
import type { NotificationEvent, NotificationRecord } from './notifications.types';

interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  engagement_id: string | null;
  object_type: string | null;
  object_id: string | null;
  status: NotificationStatus;
  read_at: Date | null;
  created_at: Date;
}

/**
 * The notification framework (Phase 11).
 *
 * Emission is the write side: domain services call {@link emitWith} inside their
 * own transaction, so a notification is committed atomically with the event that
 * caused it. Portal delivery is the persisted row (written only through the
 * SECURITY DEFINER `emit_notification`, so recipients are resolved by business
 * logic and the sender's RLS context is irrelevant). External channels
 * (email/Teams) are then dispatched best-effort and never throw.
 *
 * The read side ({@link list}/{@link unreadCount}/{@link markRead}/…) is
 * recipient-scoped by RLS — a user only ever sees and mutates their own inbox.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cls: ClsService,
    @Inject(EXTERNAL_CHANNELS) private readonly channels: NotificationChannel[],
  ) {}

  /**
   * Emit one event on an existing transaction client (atomic with the caller's
   * change). De-duplicated recipients; each is resolved employee → user by the
   * emit function. Returns the number of notifications actually created.
   */
  async emitWith(client: PoolClient, _ctx: RlsContext, event: NotificationEvent): Promise<number> {
    const correlationId = resolveAmbientCorrelationId(this.cls) ?? null;
    const recipients = [
      ...new Set(event.recipientEmployeeIds.filter((id): id is string => Boolean(id))),
    ];
    if (recipients.length === 0) return 0;
    // One round-trip for ALL recipients of this event: emit_notification is
    // called once per element of the array via unnest, rather than a JS loop of
    // one query each. This keeps every emission (dedup + recipient resolution)
    // identical while collapsing R sequential round-trips into 1 — the sweep,
    // now run on a schedule over the whole catalogue, is the hot path.
    const { rows } = await client.query<{ recipient_user_id: string | null }>(
      `SELECT hsdg.emit_notification(e.employee_id, $2,$3,$4,$5,$6,$7,$8,$9) AS recipient_user_id
       FROM unnest($1::uuid[]) AS e(employee_id)`,
      [
        recipients,
        event.type,
        event.title,
        event.body ?? null,
        event.engagementId ?? null,
        event.objectType ?? null,
        event.objectId ?? null,
        event.dedupKey ?? null,
        correlationId,
      ],
    );
    const delivered = rows
      .map((r) => r.recipient_user_id)
      .filter((id): id is string => Boolean(id));
    const created = delivered.length;
    // Fan out to external channels after the rows are staged. Best-effort: a
    // channel failure must never roll back the domain transaction.
    if (delivered.length > 0 && this.channels.length > 0) {
      await this.dispatchExternal(delivered, event);
    }
    return created;
  }

  /** Convenience: emit in its own transaction (for callers not already in one). */
  async emit(ctx: RlsContext, event: NotificationEvent): Promise<number> {
    return this.db.withRlsContext(ctx, (client) => this.emitWith(client, ctx, event));
  }

  private async dispatchExternal(
    recipientUserIds: string[],
    event: NotificationEvent,
  ): Promise<void> {
    for (const recipientUserId of recipientUserIds) {
      const outbound: OutboundNotification = {
        recipientUserId,
        type: event.type,
        title: event.title,
        body: event.body ?? null,
        engagementId: event.engagementId ?? null,
      };
      for (const channel of this.channels) {
        try {
          await channel.deliver(outbound);
        } catch (err) {
          this.logger.warn(
            `Channel "${channel.name}" failed to deliver ${event.type}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }

  // ── Read side (recipient-scoped by RLS) ──────────────────────────────────

  async list(
    ctx: RlsContext,
    page: PageParams,
    filter: { status?: NotificationStatus; unreadOnly?: boolean },
  ): Promise<PageResult<NotificationRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (filter.status) {
        params.push(filter.status);
        conds.push(`status = $${params.length}`);
      }
      if (filter.unreadOnly) conds.push(`status = 'unread'`);
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      params.push(page.limit, page.offset);
      const { rows } = await client.query<NotificationRow>(
        `SELECT id, type, title, body, engagement_id, object_type, object_id, status, read_at, created_at
         FROM hsdg.notifications ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const totalRes = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.notifications ${where}`,
        params.slice(0, params.length - 2),
      );
      return { items: rows.map(mapNotification), total: Number(totalRes.rows[0]?.total ?? 0) };
    });
  }

  async unreadCount(ctx: RlsContext): Promise<{ unread: number }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM hsdg.notifications WHERE status = 'unread'`,
      );
      return { unread: Number(rows[0]?.count ?? 0) };
    });
  }

  async markRead(ctx: RlsContext, id: string): Promise<NotificationRecord> {
    return this.updateStatus(ctx, id, NOTIFICATION_STATUS.read);
  }

  async dismiss(ctx: RlsContext, id: string): Promise<NotificationRecord> {
    return this.updateStatus(ctx, id, NOTIFICATION_STATUS.dismissed);
  }

  /** Mark every unread notification read; returns how many were affected. */
  async markAllRead(ctx: RlsContext): Promise<{ updated: number }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE hsdg.notifications SET status = 'read', read_at = now() WHERE status = 'unread'`,
      );
      return { updated: res.rowCount ?? 0 };
    });
  }

  private async updateStatus(
    ctx: RlsContext,
    id: string,
    status: NotificationStatus,
  ): Promise<NotificationRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const readStamp = status === NOTIFICATION_STATUS.read ? 'now()' : 'read_at';
      const res = await client.query<NotificationRow>(
        `UPDATE hsdg.notifications SET status = $1, read_at = ${readStamp}
         WHERE id = $2
         RETURNING id, type, title, body, engagement_id, object_type, object_id, status, read_at, created_at`,
        [status, id],
      );
      const row = res.rows[0];
      // RLS scopes UPDATE to the recipient, so zero rows means it is not theirs
      // (or does not exist) — 404 without leaking which.
      if (!row) throw new NotFoundException('Notification not found.');
      return mapNotification(row);
    });
  }
}

function mapNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    engagementId: row.engagement_id,
    objectType: row.object_type,
    objectId: row.object_id,
    status: row.status,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}
