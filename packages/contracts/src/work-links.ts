import type { EngagementKind, PeriodSection, Stream } from './engagement-restructure';

/**
 * Work links (Staff Workflow Plan, "Shared design: work links") — the one
 * contract every list, notification and search result uses to point at work,
 * so a row opens the filing / task / request itself, never a parent page.
 *
 * The API returns a `link: WorkItemRef` on each list row; the web app (and the
 * mobile app, and notification e-mails) turn it into a URL with
 * `workItemHref`. Pure, so it can run anywhere.
 */
export interface WorkItemRef {
  engagementId: string;
  engagementKind: EngagementKind;
  /** A compliance filing (hsdg.compliance_instances.id). */
  instanceId?: string | null;
  stream?: Stream | null;
  /** '2026-27'. Derived from `periodKey` when absent. */
  financialYear?: string | null;
  /** '2026-09' (GST month), '2026-27:Q2', '2026-27' (the year), … */
  periodKey?: string | null;
  /** The part of the filing's period (GST: outward / inward / summary / annual). */
  section?: PeriodSection | null;
  /** GSTIN / TAN / CIN — the stream tab resolves its registration by number. */
  registrationNumber?: string | null;
  /** A task, when the item is a task (with or without a filing). */
  taskId?: string | null;
  /** A client request (hsdg.client_dependencies.id). */
  requestId?: string | null;
  /** A statutory-audit task's area of the audit file (hsdg.audit_work_areas.id). */
  auditAreaId?: string | null;
  /** A notice (hsdg.notices.id, PS-101): opens the notice itself. */
  noticeId?: string | null;
}

/**
 * Query keys the engagement page reads for a work link. `part` (not `section`)
 * carries the filing part, because `?section=` already means the work area
 * (GST only, Income Tax only …) on the firm-wide lists.
 */
export const WORK_LINK_PARAM = {
  tab: 'tab',
  financialYear: 'fy',
  registration: 'gstin',
  month: 'm',
  period: 'p',
  part: 'part',
  task: 'task',
  request: 'request',
  /** The audit file: the section (phase) to open, e.g. `audit_areas`, `risk`. */
  auditSection: 'phase',
  /** The audit file: the area to open (hsdg.audit_work_areas.id). */
  auditArea: 'area',
} as const;

/** The audit file section that lists every area. */
export const AUDIT_AREAS_SECTION = 'audit_areas';

/** `2026-09` → `9` (the GST tab's `m`); null for any other period key. */
export function workLinkMonthParam(periodKey: string): string | null {
  const m = /^\d{4}-(\d{2})$/.exec(periodKey);
  return m ? String(Number(m[1])) : null;
}

/** The financial year a period key falls in: `2026-02` → `2025-26`, `2026-27:Q2` → `2026-27`. */
export function financialYearOfPeriod(periodKey: string | null | undefined): string | null {
  const k = periodKey ? /^(\d{4})-(\d{2})([-:].+)?$/.exec(periodKey) : null;
  if (!k) return null;
  const year = Number(k[1]);
  const two = Number(k[2]);
  // '2026-27' / '2026-27:Q2': already a financial year (next year's last two digits).
  if (two === (year + 1) % 100) return `${k[1]}-${k[2]}`;
  // '2026-09': a calendar month; April starts the year.
  if (k[3] || two < 1 || two > 12) return null;
  const start = two >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The tab a task with no filing opens on, by engagement kind. */
const NO_FILING_TAB: Record<EngagementKind, string> = {
  compliance: 'services',
  assignment: 'work',
  statutory_audit: 'audit_file',
};

/**
 * The URL of a piece of work (see the plan's URL rules table):
 * - a filing → `/engagements/:id?tab=<stream>&fy=…&gstin=…&m=9|p=Q2&part=outward`
 *   (+ `&task=` / `&request=` to highlight a row in it);
 * - a task with no filing → its kind's work tab with `&task=` — on a statutory
 *   audit, with `&phase=audit_areas&area=` when the task is about one area;
 * - otherwise the engagement itself (with `?request=` when it is a request).
 */
export function workItemHref(ref: WorkItemRef): string {
  if (ref.noticeId) return `/notices/${ref.noticeId}`;
  const base = `/engagements/${ref.engagementId}`;
  const p = new URLSearchParams();
  const filing = Boolean(ref.instanceId || (ref.stream && ref.periodKey));

  if (filing) {
    p.set(WORK_LINK_PARAM.tab, ref.stream ?? 'compliance');
    const fy = ref.financialYear ?? financialYearOfPeriod(ref.periodKey);
    if (fy) p.set(WORK_LINK_PARAM.financialYear, fy);
    if (ref.stream && ref.registrationNumber)
      p.set(WORK_LINK_PARAM.registration, ref.registrationNumber);
    if (ref.periodKey) {
      const m = ref.stream === 'gst' ? workLinkMonthParam(ref.periodKey) : null;
      if (m) p.set(WORK_LINK_PARAM.month, m);
      else p.set(WORK_LINK_PARAM.period, ref.periodKey);
    }
    if (ref.section) p.set(WORK_LINK_PARAM.part, ref.section);
  } else if (ref.taskId) {
    p.set(WORK_LINK_PARAM.tab, NO_FILING_TAB[ref.engagementKind] ?? 'overview');
    if (ref.engagementKind === 'statutory_audit' && ref.auditAreaId) {
      p.set(WORK_LINK_PARAM.auditSection, AUDIT_AREAS_SECTION);
      p.set(WORK_LINK_PARAM.auditArea, ref.auditAreaId);
    }
  }
  if (ref.taskId) p.set(WORK_LINK_PARAM.task, ref.taskId);
  if (ref.requestId) p.set(WORK_LINK_PARAM.request, ref.requestId);

  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}
