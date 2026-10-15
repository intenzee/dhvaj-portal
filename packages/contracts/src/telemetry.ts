/**
 * Staff Workflow · How we measure it — lightweight client events with no
 * content, and the measures report built on them.
 *
 * An event is a page the person moved to (`route`), a URL the app changed on
 * its own — a redirect or a default filled in (`redirect`, not a step), or a
 * list row opened (`row_open`): the path with every id
 * replaced, the NAMES of its query parameters (never their values), the list it
 * came from, and a per-tab session id. Shared so the web app and the API strip
 * content the same way.
 */

export const TELEMETRY_KIND = {
  route: 'route',
  redirect: 'redirect',
  rowOpen: 'row_open',
} as const;
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

/**
 * A target the partners set: an absolute ceiling or floor, or a change on the
 * baseline in per cent (−30 = thirty per cent lower).
 */
export const WORKFLOW_TARGET_RULE = {
  atMost: 'at_most',
  atLeast: 'at_least',
  changeBy: 'change_by',
} as const;
export type WorkflowTargetRule = (typeof WORKFLOW_TARGET_RULE)[keyof typeof WORKFLOW_TARGET_RULE];
export const WORKFLOW_TARGET_RULES: WorkflowTargetRule[] = Object.values(WORKFLOW_TARGET_RULE);

export interface WorkflowTarget {
  key: WorkflowMeasureKey;
  rule: WorkflowTargetRule;
  value: number;
}

export type WorkflowMeasureUnit =
  'steps' | 'percent' | 'hours' | 'filings' | 'days' | 'notifications';

/** The change from the baseline, in per cent (one decimal); null without both, or on a zero baseline. */
export function changeOnBaseline(value: number | null, baseline: number | null): number | null {
  if (value === null || baseline === null || baseline === 0) return null;
  return Math.round(((value - baseline) / baseline) * 1000) / 10;
}

/**
 * Whether a measure is on track for its target. A change target needs a
 * baseline: on a zero baseline only "no higher" (for a cut) or "higher" (for a
 * rise) can be judged. Null when there is nothing to judge. Pure — tested.
 */
export function measureOnTrack(
  value: number | null,
  baseline: number | null,
  target: Pick<WorkflowTarget, 'rule' | 'value'>,
): boolean | null {
  if (value === null) return null;
  if (target.rule === WORKFLOW_TARGET_RULE.atMost) return value <= target.value;
  if (target.rule === WORKFLOW_TARGET_RULE.atLeast) return value >= target.value;
  if (baseline === null) return null;
  if (baseline === 0) return target.value <= 0 ? value <= 0 : value > 0;
  const change = ((value - baseline) / baseline) * 100;
  return target.value <= 0 ? change <= target.value : change >= target.value;
}

/** "≤ 2 steps", "≥ 90%", "−30% on the baseline". */
export function workflowTargetLabel(
  target: Pick<WorkflowTarget, 'rule' | 'value'>,
  unit: WorkflowMeasureUnit,
): string {
  const n = String(target.value);
  if (target.rule === WORKFLOW_TARGET_RULE.changeBy) {
    const sign = target.value > 0 ? '+' : target.value < 0 ? '−' : '±';
    return `${sign}${Math.abs(target.value)}% on the baseline`;
  }
  const noun = target.value === 1 ? unit.slice(0, -1) : unit;
  const amount = unit === 'percent' ? `${n}%` : unit === 'hours' ? `${n} h` : `${n} ${noun}`;
  return `${target.rule === WORKFLOW_TARGET_RULE.atMost ? '≤' : '≥'} ${amount}`;
}

export interface WorkflowMeasure {
  key: WorkflowMeasureKey;
  label: string;
  /** How it is measured, in a line. */
  how: string;
  /** Null when there is nothing to measure yet. */
  value: number | null;
  /** The same measure over the window just before, for the relative targets. */
  previous: number | null;
  unit: WorkflowMeasureUnit;
  /** How many sessions / opens / tasks / filings / users the value rests on. */
  sample: number;
  /** The saved baseline's value for this measure, if a baseline is saved. */
  baseline: number | null;
  /** `changeOnBaseline(value, baseline)`. */
  vsBaseline: number | null;
  target: WorkflowTarget;
  /** `workflowTargetLabel(target, unit)`. */
  targetLabel: string;
  /** `measureOnTrack(value, baseline, target)`. */
  onTrack: boolean | null;
}

/** The baseline a report compares with. */
export interface WorkflowBaselineInfo {
  id: string;
  /** IST days, inclusive. */
  from: string;
  to: string;
  officeId: string | null;
  savedAt: string;
  savedBy: string | null;
}

/** POST /telemetry/baselines */
export interface SaveWorkflowBaselineInput {
  from: string;
  to: string;
  officeId?: string | null;
}

/** PUT /telemetry/targets */
export interface WorkflowTargetsUpdate {
  items: WorkflowTarget[];
}

/** GET /telemetry/measures */
export interface WorkflowMeasuresReport {
  /** IST days, inclusive. */
  from: string;
  to: string;
  officeId: string | null;
  /** The latest baseline saved for this scope (the firm, or the office). */
  baseline: WorkflowBaselineInfo | null;
  measures: WorkflowMeasure[];
}

/** One person in a practice session (GET /telemetry/practice). */
export interface PracticePerson {
  employeeId: string;
  name: string;
  sessions: number;
  /** Sessions that reached a filing, task or request. */
  sessionsWithFiling: number;
  /** Steps from sign-in to the first filing, median over those sessions. */
  steps: number | null;
  /** Pages moved to (redirects not counted). */
  routes: number;
  rowOpens: number;
  exactRowOpens: number;
  /** Per cent of row opens that landed on the exact item. */
  exactShare: number | null;
  /** Work done: task status changes and filings lodged by the person. */
  actions: number;
  /** Pages moved to per action. */
  routesPerAction: number | null;
}

export interface PracticeReport {
  /** ISO instants: the window watched. */
  from: string;
  to: string;
  people: PracticePerson[];
}
