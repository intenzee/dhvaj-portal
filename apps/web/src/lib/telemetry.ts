/**
 * Staff Workflow · How we measure it — route changes and list rows opened,
 * with no content: the path with ids replaced and the names of its query
 * parameters (`telemetryPath`). Queued and sent in small batches; a failure is
 * dropped, never retried or shown.
 */
import {
  TELEMETRY_BATCH_MAX,
  telemetryPath,
  type TelemetryEventInput,
  type TelemetryKind,
} from '@hsdg/contracts';
import { API_BASE, getToken } from './api';

const SESSION_KEY = 'hsdg.telemetry.session';
const FLUSH_MS = 10_000;

const ENGAGEMENT = /^\/engagements\/(?!new$)[^/]+$/;

/** The list a URL is on, as a source name: `/my-work?tab=x` → `my-work`, `/` → `home`. */
export function sourceOf(href: string): string {
  const seg = new URL(href, 'http://x').pathname.split('/')[1] ?? '';
  return (
    seg
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40) || 'home'
  );
}

/**
 * Whether moving from `prev` to `next` opened a row from a list: an engagement
 * opened from another page, or the filing drawer (`open`) opened in place.
 * Pure — tested.
 */
export function rowOpenFrom(prev: string | null, next: string): { source: string } | null {
  if (!prev) return null;
  const a = new URL(prev, 'http://x');
  const b = new URL(next, 'http://x');
  const elsewhere = a.pathname !== b.pathname && !a.pathname.startsWith(`${b.pathname}/`);
  if (ENGAGEMENT.test(b.pathname) && elsewhere) return { source: sourceOf(prev) };
  if (a.pathname === b.pathname && b.searchParams.has('open') && !a.searchParams.has('open'))
    return { source: sourceOf(prev) };
  return null;
}

/** Whether `next` is a different place: another page, or a different set of parameters. */
export function isNewRoute(prev: string | null, next: string): boolean {
  if (!prev) return true;
  const a = telemetryPath(prev);
  const b = telemetryPath(next);
  return (
    new URL(prev, 'http://x').pathname !== new URL(next, 'http://x').pathname ||
    a.params.join() !== b.params.join()
  );
}

/** How long a click or key press stays the reason for the next URL change. */
export const INPUT_WINDOW_MS = 5_000;

/**
 * What a URL change was: a page the person moved to (`route`, a step), one
 * the app made on its own — the sign-in landing redirect, a default month or
 * section filled in (`redirect`, not a step), or neither (`null`: the same
 * place with other values). The first page of a load is always a route.
 * Pure — tested.
 */
export function classifyChange(
  prev: string | null,
  next: string,
  byPerson: boolean,
): 'route' | 'redirect' | null {
  if (!prev) return 'route';
  if (!isNewRoute(prev, next)) return null;
  return byPerson ? 'route' : 'redirect';
}

function randomId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** This tab's session id; a new one at each sign-in. */
function sessionId(): string {
  try {
    const id = window.sessionStorage.getItem(SESSION_KEY);
    if (id) return id;
    const fresh = randomId();
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return 'nostorage';
  }
}

/** Start a new session — at sign-in, so steps count from the landing page. */
export function newTelemetrySession(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, randomId());
  } catch {
    /* storage unavailable — events share one id */
  }
}

let queue: TelemetryEventInput[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Send what is queued. `keepalive` lets it finish as the page is hidden or closed. */
export function flushTelemetry(keepalive = false): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const token = getToken();
  if (!token || queue.length === 0) {
    queue = [];
    return;
  }
  const events = queue.slice(0, TELEMETRY_BATCH_MAX);
  queue = queue.slice(TELEMETRY_BATCH_MAX);
  void fetch(`${API_BASE}/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ events }),
    keepalive,
  }).catch(() => undefined);
  if (queue.length) flushTelemetry(keepalive);
}

/** Queue one event for `href`. */
export function track(kind: TelemetryKind, href: string, source?: string): void {
  if (typeof window === 'undefined') return;
  const { path, params } = telemetryPath(href);
  queue.push({
    kind,
    path,
    params,
    source: source ?? null,
    sessionId: sessionId(),
    at: new Date().toISOString(),
  });
  if (queue.length >= TELEMETRY_BATCH_MAX) flushTelemetry();
  else timer ??= setTimeout(() => flushTelemetry(), FLUSH_MS);
}
