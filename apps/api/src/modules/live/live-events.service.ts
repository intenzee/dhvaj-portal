import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client, type PoolClient } from 'pg';
import { Observable, type Subscriber } from 'rxjs';
import type { ChatLiveEvent, LiveEvent } from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';

/** The Postgres channel live events travel on, between every API instance. */
export const LIVE_CHANNEL = 'hsdg_live';

/** Every event the stream carries: quick tasks and chat. */
export type AnyLiveEvent = LiveEvent | ChatLiveEvent;
/** An event before it is stamped with its id and time. */
type Draft<E> = E extends unknown ? Omit<E, 'id' | 'at'> : never;
export type LiveEventDraft = Draft<AnyLiveEvent>;

/** What goes over NOTIFY: who it is for, and the event. */
export interface LiveEnvelope {
  to: string[];
  event: AnyLiveEvent;
}

/** NOTIFY payloads are capped near 8 KB; ours are a few hundred bytes. */
const MAX_PAYLOAD = 7_500;

/**
 * Live events (GET /live/stream). A write publishes with pg_notify inside its
 * own transaction, so the event leaves only when the write commits — and
 * reaches every API instance, each of which hands it to the streams open for
 * the people it is for. If LISTEN cannot run (e.g. a transaction pooler), the
 * web's polling still brings the same news, only later.
 */
@Injectable()
export class LiveEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveEventsService.name);
  private readonly streams = new Map<string, Set<Subscriber<AnyLiveEvent>>>();
  private listener: Client | null = null;
  private retry: NodeJS.Timeout | null = null;
  private closing = false;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    void this.listen();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.retry) clearTimeout(this.retry);
    for (const subs of this.streams.values()) for (const s of subs) s.complete();
    this.streams.clear();
    await this.listener?.end().catch(() => undefined);
    this.listener = null;
  }

  /** How many streams are open (for tests and health). */
  get openStreams(): number {
    let n = 0;
    for (const subs of this.streams.values()) n += subs.size;
    return n;
  }

  /** Whether this instance is hearing NOTIFY (else only polling reaches people). */
  get listening(): boolean {
    return this.listener !== null;
  }

  /** The events for one person, until they disconnect. */
  subscribe(employeeId: string): Observable<AnyLiveEvent> {
    return new Observable<AnyLiveEvent>((sub) => {
      let set = this.streams.get(employeeId);
      if (!set) {
        set = new Set();
        this.streams.set(employeeId, set);
      }
      set.add(sub);
      return () => {
        const s = this.streams.get(employeeId);
        s?.delete(sub);
        if (s && s.size === 0) this.streams.delete(employeeId);
      };
    });
  }

  /**
   * Queue an event inside the caller's transaction: it is sent on commit and
   * dropped on rollback.
   */
  async publishWith(client: PoolClient, to: string[], event: LiveEventDraft): Promise<void> {
    const recipients = [...new Set(to.filter(Boolean))];
    if (recipients.length === 0) return;
    const envelope: LiveEnvelope = {
      to: recipients,
      event: { ...event, id: randomUUID(), at: new Date().toISOString() } as AnyLiveEvent,
    };
    const payload = JSON.stringify(envelope);
    if (payload.length > MAX_PAYLOAD) {
      this.logger.warn(`Live event ${event.kind} too large to send (${payload.length} bytes).`);
      return;
    }
    await client.query('SELECT pg_notify($1, $2)', [LIVE_CHANNEL, payload]);
  }

  /** Hand an envelope to the open streams of the people it is for. */
  deliver(envelope: LiveEnvelope): number {
    let n = 0;
    for (const id of envelope.to) {
      for (const sub of this.streams.get(id) ?? []) {
        sub.next(envelope.event);
        n += 1;
      }
    }
    return n;
  }

  private async listen(): Promise<void> {
    if (this.closing) return;
    const client = new Client({
      connectionString: this.config.get('DATABASE_URL'),
      ssl: this.config.get('DATABASE_SSL') ? { rejectUnauthorized: true } : undefined,
      application_name: 'hsdg-api-live',
    });
    const again = (why: string): void => {
      if (this.closing) return;
      this.logger.warn(`Live events not listening (${why}); retrying in 5 s.`);
      if (this.listener === client) this.listener = null;
      client.removeAllListeners();
      void client.end().catch(() => undefined);
      if (!this.retry) {
        this.retry = setTimeout(() => {
          this.retry = null;
          void this.listen();
        }, 5_000);
        this.retry.unref?.();
      }
    };
    client.on('error', (err) => again(err.message));
    client.on('end', () => again('connection ended'));
    client.on('notification', (msg) => {
      if (msg.channel !== LIVE_CHANNEL || !msg.payload) return;
      try {
        this.deliver(JSON.parse(msg.payload) as LiveEnvelope);
      } catch (err) {
        this.logger.warn(`Unreadable live event: ${(err as Error).message}`);
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${LIVE_CHANNEL}`);
      this.listener = client;
    } catch (err) {
      again((err as Error).message);
    }
  }
}
