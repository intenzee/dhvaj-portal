/**
 * Signing out after 15 minutes without activity, in every tab of the browser
 * at once. The last activity is one stamp in localStorage that every tab
 * writes and reads, so working in one tab keeps the others signed in. A
 * hidden tab keeps counting. At 14 minutes a warning gives a minute to stay;
 * at 15 the portal signs out.
 *
 * An idle sign-out is not a "Sign out": the browser keeps its push
 * subscription, so task alerts keep arriving with the portal closed. Only the
 * Sign out button (a shared computer) stops them.
 *
 * Pure apart from the storage it is handed; `now` is injected so it is tested
 * like lib/session.ts.
 */

export const IDLE_WARN_MS = 14 * 60_000;
export const IDLE_SIGN_OUT_MS = 15 * 60_000;
/** Activity is written to storage (and told to the other tabs) at most once a second. */
export const ACTIVITY_WRITE_EVERY_MS = 1000;
export const LAST_ACTIVE_KEY = 'hsdg.lastActive';
export const SIGN_OUT_NOTICE_KEY = 'hsdg.signOutNotice';
export const IDLE_CHANNEL = 'hsdg.idle';
export const IDLE_NOTICE = 'Signed out after 15 minutes without activity.';

/** What counts as using the portal. mousemove is throttled like every other write. */
export const IDLE_ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'scroll',
  'mousemove',
] as const;

export type IdlePhase = 'active' | 'warn' | 'expired';
export type SignOutReason = 'manual' | 'idle';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function idlePhase(lastActive: number, now: number): IdlePhase {
  const idle = now - lastActive;
  if (idle >= IDLE_SIGN_OUT_MS) return 'expired';
  if (idle >= IDLE_WARN_MS) return 'warn';
  return 'active';
}

/** Whole seconds until the sign-out (never below 0). */
export function secondsUntilSignOut(lastActive: number, now: number): number {
  return Math.max(0, Math.ceil((lastActive + IDLE_SIGN_OUT_MS - now) / 1000));
}

/** True when there was activity in the last `withinMs` (no stamp counts as none). */
export function activeWithin(
  lastActive: number | null,
  now: number,
  withinMs: number = IDLE_SIGN_OUT_MS,
): boolean {
  return lastActive !== null && now - lastActive < withinMs;
}

/** A stored stamp as ms since epoch, or null if it is missing or not a number. */
export function parseStamp(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** localStorage, or null where the browser refuses it (private mode, blocked storage). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(store: KeyValueStore | null | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: KeyValueStore | null | undefined, key: string, value: string | null): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // Storage blocked: this tab still counts on its own.
  }
}

/** The last activity any tab recorded. */
export function readLastActive(store: KeyValueStore | null = browserStore()): number | null {
  return parseStamp(read(store, LAST_ACTIVE_KEY));
}

/** A fresh sign-in is activity: an old stamp must not sign the new session straight out. */
export function markActive(
  now: number = Date.now(),
  store: KeyValueStore | null = browserStore(),
): void {
  write(store, LAST_ACTIVE_KEY, String(now));
}

export function writeSignOutNotice(
  notice: string | null,
  store: KeyValueStore | null = browserStore(),
): void {
  write(store, SIGN_OUT_NOTICE_KEY, notice);
}

export function readSignOutNotice(store: KeyValueStore | null = browserStore()): string | null {
  return read(store, SIGN_OUT_NOTICE_KEY);
}

export interface IdleTrackerDeps {
  now: () => number;
  store?: KeyValueStore | null;
  /** Tell the other tabs (BroadcastChannel); storage events cover it too. */
  broadcast?: (stamp: number) => void;
}

/** One tab's view of the shared last-activity stamp. */
export class IdleTracker {
  private last: number;
  private lastWrite = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: IdleTrackerDeps) {
    const stored = readLastActive(deps.store ?? null);
    this.last = stored ?? deps.now();
    if (stored === null) write(deps.store, LAST_ACTIVE_KEY, String(this.last));
  }

  /** Activity in this tab. Written (and broadcast) at most once a second unless forced. */
  record(force = false): void {
    const t = this.deps.now();
    this.last = Math.max(this.last, t);
    if (!force && t - this.lastWrite < ACTIVITY_WRITE_EVERY_MS) return;
    this.lastWrite = t;
    write(this.deps.store, LAST_ACTIVE_KEY, String(this.last));
    try {
      this.deps.broadcast?.(this.last);
    } catch {
      // A closed channel: storage carries it.
    }
  }

  /** Activity another tab reported. */
  receive(stamp: unknown): void {
    const t = parseStamp(stamp);
    if (t !== null) this.last = Math.max(this.last, t);
  }

  /** The latest activity in any tab (storage is read again, in case an event was missed). */
  lastActive(): number {
    const stored = readLastActive(this.deps.store ?? null);
    if (stored !== null) this.last = Math.max(this.last, stored);
    return this.last;
  }

  phase(): IdlePhase {
    return idlePhase(this.lastActive(), this.deps.now());
  }

  secondsLeft(): number {
    return secondsUntilSignOut(this.lastActive(), this.deps.now());
  }
}

export interface SignOutPlan {
  /** Drop this browser's push subscription (no more alerts here). */
  stopPush: boolean;
  /** Also sign out of the Microsoft account (a redirect / pop-up). */
  entraSignOut: boolean;
  /** Shown on the sign-in page. */
  notice: string | null;
}

/**
 * What signing out does. The Sign out button: alerts stop on this browser and
 * a Microsoft session ends too. An idle sign-out: this tab only forgets the
 * session — push keeps working (24x7 alerts) and there is no Microsoft
 * pop-up for someone who is not there.
 */
export function signOutPlan(
  reason: SignOutReason,
  viaMicrosoft: boolean,
  entraConfigured: boolean,
): SignOutPlan {
  const manual = reason === 'manual';
  return {
    stopPush: manual,
    entraSignOut: manual && viaMicrosoft && entraConfigured,
    notice: manual ? null : IDLE_NOTICE,
  };
}
