import {
  BadRequestException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as webpush from 'web-push';
import {
  LIVE_EVENT,
  isPushEndpoint,
  type LiveEventKind,
  type PushAlert,
  type PushConfig,
  type PushSubscribeInput,
} from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';

/** What a quick-task write hands over, to push once it has committed. */
export interface TaskPush {
  kind: LiveEventKind;
  taskId: string;
  to: string;
  urgent: boolean;
  fromName: string | null;
  taskTitle: string;
  /** The answer's own words (a status line and/or the message), for a reply. */
  line?: string | null;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one push; resolves with the push service's status code. */
export type PushTransport = (
  target: PushTarget,
  payload: string,
  options: { TTL: number; urgency: 'high' | 'normal'; topic: string },
) => Promise<number>;

/** An unanswered urgent task rings again after 1, 2, 4 and 8 minutes. */
export const RE_RING_AFTER_MS = [60_000, 120_000, 240_000, 480_000] as const;
/** A push waits this long at the push service for a device that is off. */
const PUSH_TTL_S = 12 * 60 * 60;

/** The notification for a quick-task event. Pure — tested. */
export function taskPushAlert(p: TaskPush, ring: number, at: Date): PushAlert {
  const who = p.fromName ?? 'Someone';
  const assigned = p.kind === LIVE_EVENT.quickTaskAssigned;
  const title = assigned
    ? `${ring > 0 ? '⏰ Still waiting — ' : '🔔 '}${p.urgent ? 'Urgent task' : 'New task'} from ${who}`
    : `💬 ${who} answered`;
  const body = assigned ? p.taskTitle : [p.line, p.taskTitle].filter(Boolean).join(' · ');
  return {
    kind: p.kind,
    taskId: p.taskId,
    title: title.slice(0, 120),
    body: body.slice(0, 300),
    urgent: p.urgent,
    url: `/quick-tasks?t=${p.taskId}`,
    at: at.toISOString(),
    ring,
  };
}

/** A topic lets a newer push replace one not yet delivered: 32 URL-safe characters. Pure — tested. */
export function pushTopic(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
}

/**
 * Web Push for quick tasks: the person's phone or closed browser gets a
 * system notification (with its sound) the moment a task or an answer
 * commits; an urgent task nobody has picked up rings again a few times.
 * Off unless WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY are set. Never fails
 * the write that caused it.
 */
@Injectable()
export class PushService implements OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly publicKey: string | null;
  /** Replaced in tests; by default posts to the push service with VAPID. */
  transport: PushTransport;
  /** When an unanswered urgent task rings again (shortened in tests). */
  reRingAfterMs: readonly number[] = RE_RING_AFTER_MS;

  constructor(
    config: AppConfigService,
    private readonly db: DatabaseService,
  ) {
    const pub = config.get('WEB_PUSH_PUBLIC_KEY') ?? null;
    const priv = config.get('WEB_PUSH_PRIVATE_KEY') ?? null;
    const subject =
      config.get('WEB_PUSH_SUBJECT') ??
      (config.get('WEB_PUBLIC_URL').startsWith('https://')
        ? config.get('WEB_PUBLIC_URL')
        : 'mailto:alerts@dhvaj.in');
    this.publicKey = null;
    if (pub && priv) {
      try {
        webpush.setVapidDetails(subject, pub, priv);
        this.publicKey = pub;
      } catch (err) {
        this.logger.error(`Web Push is off: the VAPID keys were refused (${String(err)}).`);
      }
    }
    this.transport = async (target, payload, options) => {
      const res = await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        options,
      );
      return res.statusCode;
    };
  }

  get enabled(): boolean {
    return this.publicKey !== null;
  }

  config(): PushConfig {
    return { enabled: this.enabled, publicKey: this.publicKey };
  }

  /** Keeps this browser's subscription for the signed-in person. */
  async subscribe(ctx: RlsContext, input: PushSubscribeInput, userAgent?: string): Promise<void> {
    if (!this.enabled)
      throw new ServiceUnavailableException(
        'Alerts to closed browsers are not set up on this portal.',
      );
    if (!isPushEndpoint(input.endpoint))
      throw new BadRequestException('This browser’s push service is not one the portal can use.');
    await this.db.withRlsContext(ctx, (client) =>
      client.query('SELECT hsdg.push_subscribe($1, $2, $3, $4)', [
        input.endpoint,
        input.keys.p256dh,
        input.keys.auth,
        userAgent?.slice(0, 300) ?? null,
      ]),
    );
  }

  /** Stops alerts to this browser (sign-out, or turned off). Only one's own. */
  async unsubscribe(ctx: RlsContext, endpoint: string): Promise<void> {
    await this.db.withRlsContext(ctx, (client) =>
      client.query('DELETE FROM hsdg.push_subscriptions WHERE endpoint = $1', [endpoint]),
    );
  }

  /** How many devices the signed-in person gets alerts on. */
  async myDevices(ctx: RlsContext): Promise<number> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM hsdg.push_subscriptions',
      );
      return Number(rows[0]?.n ?? 0);
    });
  }

  /**
   * Pushes a quick-task event to the other person's devices — call after the
   * write has committed. Never throws. An urgent new task re-rings while it
   * is still unanswered.
   */
  taskEvent(ctx: RlsContext, p: TaskPush): void {
    if (!this.enabled) return;
    void this.send(ctx, p, 0).catch((err) =>
      this.logger.warn(`Push for quick task ${p.taskId} failed: ${String(err)}`),
    );
    if (p.kind === LIVE_EVENT.quickTaskAssigned && p.urgent) {
      this.reRingAfterMs.forEach((ms, i) => {
        const t = setTimeout(() => {
          this.timers.delete(t);
          void this.reRing(ctx, p, i + 1).catch((err) =>
            this.logger.warn(`Reminder push for quick task ${p.taskId} failed: ${String(err)}`),
          );
        }, ms);
        t.unref();
        this.timers.add(t);
      });
    }
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Pending reminder pushes (tests). */
  get pendingReminders(): number {
    return this.timers.size;
  }

  private async reRing(ctx: RlsContext, p: TaskPush, ring: number): Promise<void> {
    // Read as the sender: still waiting for its person to pick it up?
    const waiting = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ status: string }>(
        'SELECT status FROM hsdg.quick_tasks WHERE id = $1',
        [p.taskId],
      );
      return rows[0]?.status === 'sent';
    });
    if (waiting) await this.send(ctx, p, ring);
  }

  private async send(ctx: RlsContext, p: TaskPush, ring: number): Promise<void> {
    const targets = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<PushTarget>(
        'SELECT endpoint, p256dh, auth FROM hsdg.push_targets($1, $2)',
        [p.taskId, p.to],
      );
      return rows;
    });
    if (targets.length === 0) return;
    const payload = JSON.stringify(taskPushAlert(p, ring, new Date()));
    const gone: string[] = [];
    await Promise.all(
      targets
        .filter((t) => isPushEndpoint(t.endpoint))
        .map(async (t) => {
          try {
            await this.transport(t, payload, {
              TTL: PUSH_TTL_S,
              urgency: p.urgent ? 'high' : 'normal',
              topic: pushTopic(p.taskId),
            });
          } catch (err) {
            const code = (err as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) gone.push(t.endpoint);
            else this.logger.warn(`Push to a device failed (${code ?? 'no status'}).`);
          }
        }),
    );
    if (gone.length > 0) {
      await this.db.withRlsContext(ctx, async (client) => {
        for (const e of gone) await client.query('SELECT hsdg.push_forget($1)', [e]);
      });
    }
  }
}
