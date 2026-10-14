/**
 * Staff Workflow · How we measure it — lightweight client events with no
 * content, and the measures report built on them.
 *
 * An event is a route change or a list row opened: the path with every id
 * replaced, the NAMES of its query parameters (never their values), the list it
 * came from, and a per-tab session id. Shared so the web app and the API strip
 * content the same way.
 */

export const TELEMETRY_KIND = { route: 'route', rowOpen: 'row_open' } as const;
export type TelemetryKind = (typeof TELEMETRY_KIND)[keyof typeof TELEMETRY_KIND];
export const TELEMETRY_KINDS: TelemetryKind[] = Object.values(TELEMETRY_KIND);

/** POST /telemetry, at most this many events per batch. */
export const TELEMETRY_BATCH_MAX = 50;

export interface TelemetryEventInput {
  kind: TelemetryKind;
  /** Normalised by `telemetryPath`: ids replaced, no query string. */
  path: string;
  /** Query parameter names only. */
  params: string[];
  /** The list a row was opened from ('today', 'my-work', 'search', …). */
  source?: string | null;
  sessionId: string;
  /** When it happened (client clock; the API clamps it to the last day). */
  at?: string;
}

export interface TelemetryBatch {
  events: TelemetryEventInput[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARAM = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * A URL with its content stripped: `/engagements/<uuid>?tab=gst&part=outward`
 * → `{ path: '/engagements/:id', params: ['part', 'tab'] }`. Long numbers and
 * anything that is not a plain word become `:id` too. Pure — tested.
 */
export function telemetryPath(href: string): { path: string; params: string[] } {
  const url = new URL(href, 'http://x');
  const path =
    url.pathname
      .split('/')
      .map((seg) =>
        seg === '' ? '' : UUID.test(seg) || !/^[a-z][a-z0-9-]{0,39}$/i.test(seg) ? ':id' : seg,
      )
      .join('/')
      .slice(0, 200) || '/';
  const params = [...new Set([...url.searchParams.keys()])]
    .filter((k) => PARAM.test(k))
    .sort()
    .slice(0, 20);
  return { path, params };
}

/** Parameters that mean the URL lands on one exact item of work. */
export const EXACT_PARAMS = ['part', 'task', 'request', 'open'] as const;

/** A URL lands on one exact item: a filing's section, a task, a request or the drawer. */
export function isExactLanding(params: readonly string[]): boolean {
  return params.some((p) => (EXACT_PARAMS as readonly string[]).includes(p));
}

/** The six "How we measure it" numbers. */
export const WORKFLOW_MEASURE = {
  stepsToFirstAction: 'steps_to_first_action',
  exactLinkShare: 'exact_link_share',
  reviewWait: 'review_wait',
  filingsPastInternal: 'filings_past_internal',
  receivedToFiled: 'received_to_filed',
  unreadPerUser: 'unread_per_user',
} as const;
export type WorkflowMeasureKey = (typeof WORKFLOW_MEASURE)[keyof typeof WORKFLOW_MEASURE];

export interface WorkflowMeasure {
  key: WorkflowMeasureKey;
  label: string;
  /** How it is measured, in a line. */
  how: string;
  /** Null when there is nothing to measure yet. */
  value: number | null;
  /** The same measure over the window just before, for the relative targets. */
  previous: number | null;
  unit: 'steps' | 'percent' | 'hours' | 'filings' | 'days' | 'notifications';
  /** How many sessions / opens / tasks / filings / users the value rests on. */
  sample: number;
  target: string;
  /** Against an absolute target; null for a target relative to the baseline. */
  meetsTarget: boolean | null;
}

/** GET /telemetry/measures */
export interface WorkflowMeasuresReport {
  /** IST days, inclusive. */
  from: string;
  to: string;
  officeId: string | null;
  measures: WorkflowMeasure[];
}
