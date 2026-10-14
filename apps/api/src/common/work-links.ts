import {
  periodKeyLabel,
  type EngagementKind,
  type PeriodSection,
  type Stream,
  type WorkFilingContext,
  type WorkItemRef,
} from '@hsdg/contracts';

/**
 * Staff Workflow WF-102 — the ONE "compliance instance → work-link fields" SQL,
 * shared by every list that returns a `link: WorkItemRef` (My Work tasks, the
 * client-dependency list, the legacy compliance calendar and the review queue),
 * so they can never disagree on a filing's stream, period or registration.
 *
 * `workLinkJoin(expr)` is a LEFT JOIN LATERAL keyed on the instance id (one PK
 * probe per row; a row with no filing gets nulls), selecting the columns in
 * `WORK_LINK_COLUMNS` under the alias `wl`. It reads through the caller's RLS
 * like any other join: a registration the caller may not see is simply null.
 *
 * The stream resolves like the firm calendar's (rule version → rule's service →
 * the stream that service was folded into), then the filing's own stream line.
 */
export function workLinkJoin(instanceIdExpr: string): string {
  return `LEFT JOIN LATERAL (
    SELECT wci.id AS instance_id,
           COALESCE(wv.stream, wrs.stream, wrf.stream, wsv.stream) AS stream,
           wci.financial_year, wci.period_key, wci.section,
           to_char(wci.reference_date, 'YYYY-MM') AS reference_month,
           wer.registration_number,
           COALESCE(wci.form_label, wv.form_label, wcr.name) AS form_label,
           COALESCE(wci.internal_sla_override, wci.internal_sla_date)::text AS internal_date,
           COALESCE(wci.statutory_deadline_override, wge.revised_due_date,
                    wci.statutory_deadline)::text AS statutory_date
      FROM hsdg.compliance_instances wci
      JOIN hsdg.compliance_rules wcr ON wcr.id = wci.compliance_rule_id
      LEFT JOIN hsdg.compliance_rule_versions wv ON wv.id = wci.compliance_rule_version_id
      LEFT JOIN hsdg.services wrs ON wrs.id = wcr.service_id
      LEFT JOIN hsdg.services wrf ON wrf.id = wrs.folded_into_service_id
      LEFT JOIN hsdg.engagement_services wes ON wes.id = wci.engagement_service_id
      LEFT JOIN hsdg.services wsv ON wsv.id = wes.service_id
      LEFT JOIN hsdg.entity_registrations wer ON wer.id = wci.registration_id
      LEFT JOIN hsdg.government_extensions wge ON wge.id = wci.government_extension_id
     WHERE wci.id = ${instanceIdExpr}
  ) wl ON true`;
}

/**
 * Add the link columns to an already-paged query: the lateral then probes one
 * filing per page row, instead of the planner flattening it into a scan of
 * every filing the caller can see before the LIMIT. `instanceColumn` and
 * `orderBy` name columns of the paged query's select-list (alias `p`).
 */
export function withWorkLinks(pagedSql: string, instanceColumn: string, orderBy: string): string {
  return `SELECT p.*, ${WORK_LINK_COLUMNS}
    FROM (${pagedSql}) p
    ${workLinkJoin(`p.${instanceColumn}`)}
   ORDER BY ${orderBy}`;
}

/** The select-list for `workLinkJoin` (prefix `wl_` so it never shadows a row's own columns). */
export const WORK_LINK_COLUMNS = `wl.instance_id AS wl_instance_id, wl.stream AS wl_stream,
       wl.financial_year AS wl_financial_year, wl.period_key AS wl_period_key,
       wl.section AS wl_section, wl.reference_month AS wl_reference_month,
       wl.registration_number AS wl_registration_number, wl.form_label AS wl_form_label,
       wl.internal_date AS wl_internal_date, wl.statutory_date AS wl_statutory_date`;

/** The row fields `WORK_LINK_COLUMNS` adds. */
export interface WorkLinkSqlRow {
  wl_instance_id: string | null;
  wl_stream: Stream | null;
  wl_financial_year: string | null;
  wl_period_key: string | null;
  wl_section: PeriodSection | null;
  wl_reference_month: string | null;
  wl_registration_number: string | null;
  wl_form_label: string | null;
  wl_internal_date: string | null;
  wl_statutory_date: string | null;
}

/** The filing columns of a link, from any row that has them (the calendar maps its own). */
export interface WorkLinkFiling {
  instanceId: string | null;
  stream: Stream | null;
  financialYear: string | null;
  periodKey: string | null;
  section: PeriodSection | null;
  registrationNumber: string | null;
}

export function workLinkFilingOf(row: WorkLinkSqlRow): WorkLinkFiling {
  return {
    instanceId: row.wl_instance_id,
    stream: row.wl_stream,
    financialYear: row.wl_financial_year,
    periodKey: row.wl_period_key,
    section: row.wl_section,
    registrationNumber: row.wl_registration_number,
  };
}

/**
 * A row's `link`. A row with no filing still carries its engagement (and its
 * task / request), so the web can open the right tab on it.
 */
export function workLinkOf(
  base: {
    engagementId: string;
    engagementKind: EngagementKind;
    taskId?: string | null;
    requestId?: string | null;
  },
  filing?: WorkLinkFiling | null,
): WorkItemRef {
  const ref: WorkItemRef = {
    engagementId: base.engagementId,
    engagementKind: base.engagementKind,
  };
  if (filing?.instanceId) {
    ref.instanceId = filing.instanceId;
    ref.stream = filing.stream;
    ref.financialYear = filing.financialYear;
    ref.periodKey = filing.periodKey;
    ref.section = filing.section;
    ref.registrationNumber = filing.registrationNumber;
  }
  if (base.taskId) ref.taskId = base.taskId;
  if (base.requestId) ref.requestId = base.requestId;
  return ref;
}

/** The filing context a task row shows (null when the task has no filing). */
export function workFilingContextOf(row: WorkLinkSqlRow): WorkFilingContext | null {
  if (!row.wl_instance_id) return null;
  return {
    instanceId: row.wl_instance_id,
    formLabel: row.wl_form_label ?? '',
    // A legacy filing has no period key; its reference month stands in.
    periodLabel: periodKeyLabel(row.wl_period_key ?? row.wl_reference_month),
    registrationNumber: row.wl_registration_number,
    internalDate: row.wl_internal_date,
    statutoryDate: row.wl_statutory_date,
  };
}
