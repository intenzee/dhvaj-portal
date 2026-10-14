import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { PoolClient } from 'pg';
import {
  FEATURE_FLAG,
  NOTIFICATION_DELIVERY,
  NOTIFICATION_KIND,
  NOTIFICATION_STATUS,
  NOTIFICATION_TYPE_LABEL,
  NOTIFICATION_TYPES,
  notificationDelivery,
  notificationKind,
  type EngagementKind,
  type NotificationDelivery,
  type NotificationDigest,
  type NotificationPreference,
  type NotificationPreferenceUpdate,
  type NotificationStatus,
  type NotificationType,
  type WorkItemRef,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import {
  WORK_LINK_COLUMNS,
  workLinkFilingOf,
  workLinkJoin,
  workLinkOf,
  type WorkLinkSqlRow,
} from '../../common/work-links';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { resolveAmbientCorrelationId } from '../../common/context/request-context';
import { EXTERNAL_CHANNELS, type NotificationChannel } from './channels/notification-channel';
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
  resolved_at: Date | null;
  created_at: Date;
  link: WorkItemRef | null;
  /** The engagement's kind, for the fallback link of a row stored without one. */
  engagement_kind: EngagementKind | null;
}

const NOTIFICATION_COLUMNS = `id, type, title, body, engagement_id, object_type, object_id, status,
  read_at, resolved_at, created_at, link`;

/** Page rows, then the engagement kind for the few stored without a link. */
const withEngagementKind = (pagedSql: string): string =>
  `SELECT p.*, CASE WHEN p.link IS NULL AND p.engagement_id IS NOT NULL
                    THEN (SELECT e.kind FROM hsdg.engagements e WHERE e.id = p.engagement_id)
               END AS engagement_kind
     FROM (${pagedSql}) p
    ORDER BY p.created_at DESC, p.id DESC`;

/**
 * Staff Workflow WF-305 — where an emitted notification opens. Each source maps
 * its object to (engagement, task, request, filing); the filing's section and
 * period come from the shared work-link SQL. Read through the emitter's RLS (the
 * emitter is acting on that object, so it can see it).
 */
const LINK_SOURCE: Record<string, string> = {
  task: `SELECT t.engagement_id, t.id, NULL::uuid, t.source_compliance_instance_id
           FROM hsdg.tasks t WHERE t.id = $1`,
  client_dependency: `SELECT d.engagement_id, d.task_id, d.id, d.compliance_instance_id
                        FROM hsdg.client_dependencies d WHERE d.id = $1`,
  compliance_instance: `SELECT ci.engagement_id, NULL::uuid, NULL::uuid, ci.id
                          FROM hsdg.compliance_instances ci WHERE ci.id = $1`,
  compliance_instance_deadline: `SELECT d.engagement_id, NULL::uuid, NULL::uuid, d.compliance_instance_id
                                   FROM hsdg.compliance_instance_deadlines d WHERE d.id = $1`,
  document: `SELECT d.engagement_id, NULL::uuid, NULL::uuid, d.compliance_instance_id
               FROM hsdg.documents d WHERE d.id = $1`,
  engagement_time_entry: `SELECT te.engagement_id, te.task_id, NULL::uuid, NULL::uuid
                            FROM hsdg.engagement_time_entries te WHERE te.id = $1`,
};
const ENGAGEMENT_SOURCE = `SELECT $1::uuid, NULL::uuid, NULL::uuid, NULL::uuid`;

interface LinkRow extends WorkLinkSqlRow {
  engagement_id: string;
  engagement_kind: EngagementKind;
  task_id: string | null;
  request_id: string | null;
}

/** yyyy-mm-dd, a real day. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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
  constructor(
    private readonly db: DatabaseService,
    private readonly cls: ClsService,
    @Inject(EXTERNAL_CHANNELS) private readonly channels: NotificationChannel[],
    private readonly flags: FeatureFlagsService,
  ) {}

  /**
   * Informational notices wait for the daily digest instead of going out by
   * e-mail one by one — once actionable notifications are on firm-wide (an
   * office-limited rollout keeps e-mail as it was, since the digest e-mail is
   * firm-wide too).
   */
  private get digestFirmWide(): boolean {
    return this.flags.isOnFor(FEATURE_FLAG.filingRuns, null);
  }

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
    const link = event.link !== undefined ? event.link : await this.linkFor(client, event);
    // One round-trip for ALL recipients of this event: emit_notification is
    // called once per element of the array via unnest, rather than a JS loop of
    // one query each. This keeps every emission (dedup + recipient resolution)
    // identical while collapsing R sequential round-trips into 1 — the sweep,
    // now run on a schedule over the whole catalogue, is the hot path.
    const { rows } = await client.query<{ recipient_user_id: string | null }>(
      `SELECT hsdg.emit_notification(e.employee_id, $2,$3,$4,$5,$6,$7,$8,$9,$10) AS recipient_user_id
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
        link ? JSON.stringify(link) : null,
      ],
    );
    const delivered = rows
      .map((r) => r.recipient_user_id)
      .filter((id): id is string => Boolean(id));
    const created = delivered.length;
    // Enqueue external delivery to the durable outbox, ATOMIC with the portal
    // rows (same transaction). A scheduled worker drains it with retry, so a
    // channel outage never drops a message and never rolls back the domain op.
    const waitsForDigest =
      notificationKind(event.type) === NOTIFICATION_KIND.informational && this.digestFirmWide;
    if (delivered.length > 0 && this.channels.length > 0 && !waitsForDigest) {
      for (const channel of this.channels) {
        await client.query(
          `SELECT hsdg.enqueue_delivery(u.uid, $2, $3, $4, $5, $6)
           FROM unnest($1::uuid[]) AS u(uid)`,
          [
            delivered,
            channel.name,
            event.type,
            event.title,
            event.body ?? null,
            event.engagementId ?? null,
          ],
        );
      }
    }
    return created;
  }

  /** Convenience: emit in its own transaction (for callers not already in one). */
  async emit(ctx: RlsContext, event: NotificationEvent): Promise<number> {
    return this.db.withRlsContext(ctx, (client) => this.emitWith(client, ctx, event));
  }

  /**
   * WF-305 — the WorkItemRef a notification stores: its object's filing, section,
   * task or request when it has one, else its engagement. Null when neither.
   */
  private async linkFor(client: PoolClient, event: NotificationEvent): Promise<WorkItemRef | null> {
    const attempts: [string, string][] = [];
    const source = event.objectType ? LINK_SOURCE[event.objectType] : undefined;
    if (source && event.objectId) attempts.push([source, event.objectId]);
    if (event.engagementId) attempts.push([ENGAGEMENT_SOURCE, event.engagementId]);
    for (const [sql, id] of attempts) {
      const { rows } = await client.query<LinkRow>(
        `SELECT src.engagement_id, e.kind AS engagement_kind, src.task_id, src.request_id,
                ${WORK_LINK_COLUMNS}
           FROM (${sql}) AS src(engagement_id, task_id, request_id, instance_id)
           JOIN hsdg.engagements e ON e.id = src.engagement_id
           ${workLinkJoin('src.instance_id')}`,
        [id],
      );
      const r = rows[0];
      if (r) {
        return workLinkOf(
          {
            engagementId: r.engagement_id,
            engagementKind: r.engagement_kind,
            taskId: r.task_id,
            requestId: r.request_id,
          },
          r.wl_instance_id ? workLinkFilingOf(r) : null,
        );
      }
    }
    return null;
  }

  /** An external channel (e-mail) is configured, so a client can be reached. */
  get hasExternalChannels(): boolean {
    return this.channels.length > 0;
  }

  /**
   * Enqueue a CLIENT-facing delivery (external email) on an existing transaction
   * — §24 client-facing routing. Clients have no portal row; this addresses the
   * client contact's email through every enabled external channel, drained by the
   * same outbox worker. A no-op when no external channel is enabled or no email.
   * Returns the number of deliveries enqueued.
   */
  async enqueueClientDeliveryWith(
    client: PoolClient,
    event: {
      recipientEmail: string | null;
      type: string;
      title: string;
      body?: string | null;
      engagementId?: string | null;
    },
  ): Promise<number> {
    if (!event.recipientEmail || this.channels.length === 0) return 0;
    for (const channel of this.channels) {
      await client.query(`SELECT hsdg.enqueue_client_delivery($1, $2, $3, $4, $5, $6)`, [
        event.recipientEmail,
        channel.name,
        event.type,
        event.title,
        event.body ?? null,
        event.engagementId ?? null,
      ]);
    }
    return this.channels.length;
  }

  // ── Read side (recipient-scoped by RLS) ──────────────────────────────────

  async list(
    ctx: RlsContext,
    page: PageParams,
    filter: {
      status?: NotificationStatus;
      unreadOnly?: boolean;
      type?: NotificationType;
      /** WF-305: leave out what goes to the digest (or nowhere) — the bell's list. */
      bellOnly?: boolean;
    },
  ): Promise<PageResult<NotificationRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (filter.bellOnly && !filter.type) {
        params.push(await this.offBell(client));
        conds.push(`type <> ALL($${params.length}::text[])`);
      }
      if (filter.status) {
        params.push(filter.status);
        conds.push(`status = $${params.length}`);
      }
      if (filter.type) {
        params.push(filter.type);
        conds.push(`type = $${params.length}`);
      }
      if (filter.unreadOnly) conds.push(`status = 'unread'`);
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      params.push(page.limit, page.offset);
      const { rows } = await client.query<NotificationRow>(
        withEngagementKind(
          `SELECT ${NOTIFICATION_COLUMNS}
             FROM hsdg.notifications ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}`,
        ),
        params,
      );
      const totalRes = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM hsdg.notifications ${where}`,
        params.slice(0, params.length - 2),
      );
      return { items: rows.map(mapNotification), total: Number(totalRes.rows[0]?.total ?? 0) };
    });
  }

  /**
   * The bell's badge. With `bellOnly` (WF-305) it counts only what reaches the
   * bell — actionable notices and any informational type moved there — so it
   * equals the number of things the user must act on.
   */
  async unreadCount(ctx: RlsContext, bellOnly = false): Promise<{ unread: number }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const off = bellOnly ? await this.offBell(client) : [];
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM hsdg.notifications
          WHERE status = 'unread' AND type <> ALL($1::text[])`,
        [off],
      );
      return { unread: Number(rows[0]?.count ?? 0) };
    });
  }

  // ── WF-305: digest and per-type settings ─────────────────────────────────

  /** The caller's chosen delivery per type (only the ones they changed). */
  private async chosen(client: PoolClient): Promise<Map<NotificationType, NotificationDelivery>> {
    const { rows } = await client.query<{ type: NotificationType; delivery: NotificationDelivery }>(
      `SELECT type, delivery FROM hsdg.notification_preferences WHERE user_id = hsdg.ctx_user_id()`,
    );
    return new Map(rows.map((r) => [r.type, r.delivery]));
  }

  /** Types that do not reach the caller's bell. */
  private async offBell(client: PoolClient): Promise<NotificationType[]> {
    const chosen = await this.chosen(client);
    return NOTIFICATION_TYPES.filter(
      (t) => notificationDelivery(t, chosen.get(t)) !== NOTIFICATION_DELIVERY.bell,
    );
  }

  async preferences(ctx: RlsContext): Promise<NotificationPreference[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const chosen = await this.chosen(client);
      return NOTIFICATION_TYPES.map((type) => ({
        type,
        label: NOTIFICATION_TYPE_LABEL[type],
        kind: notificationKind(type),
        delivery: notificationDelivery(type, chosen.get(type)),
        editable: notificationKind(type) === NOTIFICATION_KIND.informational,
      }));
    });
  }

  /** Set informational types' delivery; an actionable type always reaches the bell. */
  async setPreferences(
    ctx: RlsContext,
    items: NotificationPreferenceUpdate[],
  ): Promise<NotificationPreference[]> {
    const fixed = items.filter((i) => notificationKind(i.type) === NOTIFICATION_KIND.actionable);
    if (fixed.length > 0) {
      throw new BadRequestException(
        `${NOTIFICATION_TYPE_LABEL[fixed[0]!.type]} needs action, so it always reaches the bell.`,
      );
    }
    await this.db.withRlsContext(ctx, async (client) => {
      for (const i of items) {
        await client.query(
          `INSERT INTO hsdg.notification_preferences (user_id, type, delivery)
           VALUES (hsdg.ctx_user_id(), $1, $2)
           ON CONFLICT (user_id, type) DO UPDATE SET delivery = EXCLUDED.delivery, updated_at = now()`,
          [i.type, i.delivery],
        );
      }
    });
    return this.preferences(ctx);
  }

  /**
   * The day's digest (IST): informational notices the caller left in the digest,
   * newest first, grouped by type in the contract's order. Dismissed ones drop out.
   */
  async digest(ctx: RlsContext, day: string): Promise<NotificationDigest> {
    if (!ISO_DAY.test(day) || Number.isNaN(Date.parse(day))) {
      throw new BadRequestException('date must be yyyy-mm-dd.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const chosen = await this.chosen(client);
      const types = NOTIFICATION_TYPES.filter(
        (t) => notificationDelivery(t, chosen.get(t)) === NOTIFICATION_DELIVERY.digest,
      );
      const { rows } = await client.query<NotificationRow>(
        withEngagementKind(
          `SELECT ${NOTIFICATION_COLUMNS}
             FROM hsdg.notifications
            WHERE type = ANY($1::text[]) AND status <> 'dismissed'
              AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
            ORDER BY created_at DESC, id DESC
            LIMIT 300`,
        ),
        [types, day],
      );
      const items = rows.map(mapNotification);
      const groups = types
        .map((type) => ({
          type,
          label: NOTIFICATION_TYPE_LABEL[type],
          items: items.filter((n) => n.type === type),
        }))
        .filter((g) => g.items.length > 0);
      return { date: day, total: items.length, groups };
    });
  }

  /**
   * Queue the day's digest e-mail/Teams message to every user with notices in it
   * (once per day — a re-run is a no-op). Returns how many users get one.
   */
  async sendDigests(ctx: RlsContext, day: string): Promise<{ users: number }> {
    if (this.channels.length === 0) return { users: 0 };
    const informational = NOTIFICATION_TYPES.filter(
      (t) => notificationKind(t) === NOTIFICATION_KIND.informational,
    );
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ users: number }>(
        `SELECT hsdg.enqueue_notification_digests($1::date, $2::text[], $3::text[]) AS users`,
        [day, informational, this.channels.map((c) => c.name)],
      );
      return { users: rows[0]?.users ?? 0 };
    });
  }

  async markRead(ctx: RlsContext, id: string): Promise<NotificationRecord> {
    return this.updateStatus(ctx, id, NOTIFICATION_STATUS.read);
  }

  async dismiss(ctx: RlsContext, id: string): Promise<NotificationRecord> {
    return this.updateStatus(ctx, id, NOTIFICATION_STATUS.dismissed);
  }

  /** Mark every unread notification read; returns how many were affected. */
  async markAllRead(ctx: RlsContext, bellOnly = false): Promise<{ updated: number }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const off = bellOnly ? await this.offBell(client) : [];
      const res = await client.query(
        `UPDATE hsdg.notifications SET status = 'read', read_at = now()
          WHERE status = 'unread' AND type <> ALL($1::text[])`,
        [off],
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
        `WITH u AS (
           UPDATE hsdg.notifications SET status = $1, read_at = ${readStamp}
            WHERE id = $2
           RETURNING ${NOTIFICATION_COLUMNS})
         ${withEngagementKind('SELECT * FROM u')}`,
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
  const link =
    row.link ??
    (row.engagement_id && row.engagement_kind
      ? { engagementId: row.engagement_id, engagementKind: row.engagement_kind }
      : null);
  return {
    id: row.id,
    type: row.type,
    kind: notificationKind(row.type),
    title: row.title,
    body: row.body,
    engagementId: row.engagement_id,
    objectType: row.object_type,
    objectId: row.object_id,
    link,
    status: row.status,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}
