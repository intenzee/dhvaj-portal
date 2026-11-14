import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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

/** LISTEN stays up this long after the last stream closes. */
export const LISTEN_IDLE_CLOSE_MS = 30_000;

/**
 * Live events (GET /live/stream). A write publishes with pg_notify inside its
 * own transaction, so the event leaves only when the write commits — and
 * reaches every API instance, each of which hands it to the streams open for
 * the people it is for. If LISTEN cannot run (e.g. a transaction pooler), the
 * web's polling still brings the same news, only later.
 *
 * The LISTEN connection is held only while someone has the portal open: it
 * opens with the first stream and closes a little after the last one, and it
 * is never re-opened for nobody. A connection held all the time — or re-made
 * every few seconds after the database scaled to zero — would keep a
 * serverless database (Neon) awake around the clock. With no stream open
 * there is no one to hand an event to, so nothing is lost; people who are not
 * looking hear through push and e-mail, which do not depend on it.
 */
@Injectable()
export class LiveEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveEventsService.name);
  private readonly streams = new Map<string, Set<Subscriber<AnyLiveEvent>>>();
  private listener: Client | null = null;
  private connecting: Promise<void> | null = null;
  private retry: NodeJS.Timeout | null = null;
  private idleClose: NodeJS.Timeout | null = null;
  private closing = false;
  /** How long LISTEN stays up after the last stream closes (a reload reopens it). */
  idleCloseMs = LISTEN_IDLE_CLOSE_MS;

  constructor(private readonly config: AppConfigService) {}

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.idleClose) clearTimeout(this.idleClose);
    for (const subs of this.streams.values()) for (const s of subs) s.complete();
    this.streams.clear();
    await this.connecting?.catch(() => undefined);
    await this.listener?.end().catch(() => undefined);
    this.listener = null;
  }

  /**
   * Resolves once this instance hears NOTIFY (true), or false if it cannot
   * right now — opening the connection if a stream wants it.
   */
  async whenListening(timeoutMs = 5_000): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (!this.listener && Date.now() < end) {
      if (!this.connecting && !this.retry && this.openStreams > 0) this.ensureListening();
      await new Promise((r) => setTimeout(r, 25));
    }
    return this.listener !== null;
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
      this.ensureListening();
      return () => {
        const s = this.streams.get(employeeId);
        s?.delete(sub);
        if (s && s.size === 0) this.streams.delete(employeeId);
        if (this.openStreams === 0) this.scheduleIdleClose();
      };
    });
  }

  /** Someone is watching: hold LISTEN (and stop any pending close). */
  private ensureListening(): void {
    if (this.idleClose) {
      clearTimeout(this.idleClose);
      this.idleClose = null;
    }
    if (this.closing || this.listener || this.connecting || this.retry) return;
    this.connecting = this.listen().finally(() => {
      this.connecting = null;
    });
  }

  /** Nobody is watching: let the database sleep once the grace has passed. */
  private scheduleIdleClose(): void {
    if (this.idleClose || this.closing) return;
    this.idleClose = setTimeout(() => {
      this.idleClose = null;
      if (this.openStreams > 0) return;
      if (this.retry) {
        clearTimeout(this.retry);
        this.retry = null;
      }
      const client = this.listener;
      this.listener = null;
      if (client) {
        client.removeAllListeners();
        client.on('error', () => undefined);
        void client.end().catch(() => undefined);
      }
    }, this.idleCloseMs);
    this.idleClose.unref?.();
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
      if (this.listener === client) this.listener = null;
      client.removeAllListeners();
      client.on('error', () => undefined);
      void client.end().catch(() => undefined);
      if (this.closing) return;
      // Nobody watching (e.g. the database scaled to zero overnight and closed
      // the session): stay down until a stream wants it again.
      if (this.openStreams === 0) {
        this.logger.log(`Live events stopped listening (${why}); no one is watching.`);
        return;
      }
      this.logger.warn(`Live events not listening (${why}); retrying in 5 s.`);
      if (!this.retry) {
        this.retry = setTimeout(() => {
          this.retry = null;
          if (this.openStreams > 0) this.ensureListening();
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
      // Everyone left while it was connecting.
      if (this.openStreams === 0) this.scheduleIdleClose();
    } catch (err) {
      again((err as Error).message);
    }
  }
}
