import { Injectable } from '@nestjs/common';

/** A request the API answered: whether it could have changed anything. */
export interface ActivityEvent {
  at: number;
  write: boolean;
}

/**
 * When the portal was last used — the last request a person (or the client
 * portal) made, health checks aside.
 *
 * The database is serverless (Neon): it sleeps after 5 minutes with no query
 * and every query wakes it. Background work that only matters while people
 * are working — re-reading rollout flags, closing idle timers, sending the
 * e-mail a change queued — asks this whether anyone has been here, instead of
 * querying on a timer around the clock.
 */
@Injectable()
export class ActivityService {
  private last = 0;
  private readonly listeners = new Set<(e: ActivityEvent) => void>();

  /** Epoch ms of the last request (0 before the first). */
  get lastActiveAt(): number {
    return this.last;
  }

  /** Whether a request came after `since` (epoch ms). */
  activeSince(since: number): boolean {
    return this.last > since;
  }

  /** Record a request; tells every listener. */
  touch(write: boolean, at: number = Date.now()): void {
    this.last = Math.max(this.last, at);
    for (const fn of this.listeners) {
      try {
        fn({ at, write });
      } catch {
        /* a listener never breaks a request */
      }
    }
  }

  /** Be told of each request; returns the unsubscribe. */
  onActivity(fn: (e: ActivityEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** Requests that are not people using the portal: health probes. */
export function countsAsActivity(path: string): boolean {
  return !/\/health(\/|$|\?)/.test(path);
}

/** Methods that can change data (and so queue notifications). */
export function isWriteMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/**
 * Whether a background job that only matters while people work should run on
 * this tick: someone used the portal since its last run, or it is the top of
 * the hour — the hourly sweep's wake, so the database is up then anyway and
 * anything left over (an idle timer, a retried e-mail) is dealt with within
 * the hour.
 */
export function workingTick(now: Date, lastRunAt: number, activity: ActivityService): boolean {
  return now.getMinutes() === 0 || lastRunAt === 0 || activity.activeSince(lastRunAt);
}
