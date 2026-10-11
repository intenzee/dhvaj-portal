import type { PoolClient } from 'pg';
import {
  CONSOLIDATION_OUTCOME_LABEL,
  ICFR_OUTCOME_LABEL,
  OTHER_REPORTING_OUTCOME_LABEL,
  REPORTING_FRAMEWORK_LABEL,
  SCHEDULE_III_OUTCOME_LABEL,
  SMALL_COMPANY_OUTCOME_LABEL,
  type FrameworkSourceSection,
  type FrameworkSystemOverride,
} from '@hsdg/contracts';
import { OTHER_AREA_KEYS } from './framework-summary-engine';

/**
 * The §12 System Overrides: every system result a professional replaced with a
 * different conclusion — the 02.1 Small Company override, the 02.2–02.7
 * sub-assessments and the other Phase-02 areas. One list feeds both the
 * Engagement Partner's review screen and the memorandum, so the two never
 * disagree. DI-free: runs inside the caller's RLS transaction.
 */

const OUTCOME_LABEL: Record<string, Record<string, string>> = {
  '02.1': SMALL_COMPANY_OUTCOME_LABEL,
  '02.2': REPORTING_FRAMEWORK_LABEL,
  '02.3': SCHEDULE_III_OUTCOME_LABEL,
  '02.5': ICFR_OUTCOME_LABEL,
  '02.6': CONSOLIDATION_OUTCOME_LABEL,
  '02.7': OTHER_REPORTING_OUTCOME_LABEL,
};

/** An outcome key in words: the section's own label, else the key de-underscored. */
export function outcomeInWords(source: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const label = OUTCOME_LABEL[source]?.[value];
  if (label) return label;
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface OverrideRow {
  source: FrameworkSourceSection;
  title: string;
  system_result: string | null;
  conclusion: string | null;
  reason: string | null;
  overridden_by_name: string | null;
  overridden_at: Date | string | null;
}

const iso = (d: Date | string | null) =>
  d === null ? null : typeof d === 'string' ? d : d.toISOString();

/** The rows in words, in source order (pure). */
export function frameworkOverridesOf(rows: OverrideRow[]): FrameworkSystemOverride[] {
  const order = (s: string) => (s === 'other_areas' ? '99' : s);
  return [...rows]
    .sort(
      (a, b) => order(a.source).localeCompare(order(b.source)) || a.title.localeCompare(b.title),
    )
    .map((r) => ({
      source: r.source,
      title: r.title,
      systemResult: outcomeInWords(r.source, r.system_result),
      conclusion: outcomeInWords(r.source, r.conclusion),
      reason: r.reason?.trim() || null,
      overriddenByName: r.overridden_by_name,
      overriddenAt: iso(r.overridden_at),
    }));
}

/** Read every recorded override of the workflow's framework. */
export async function readFrameworkOverridesOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkSystemOverride[]> {
  const { rows } = await client.query<OverrideRow>(
    `SELECT '02.1' AS source, 'Small Company classification' AS title,
            COALESCE(p.small_company_override_system_outcome, p.small_company_system_outcome)
              AS system_result,
            p.small_company_override AS conclusion, p.small_company_override_reason AS reason,
            e.full_name AS overridden_by_name, p.small_company_override_at AS overridden_at
       FROM hsdg.audit_entity_profile p
       LEFT JOIN hsdg.employees e ON e.id = p.small_company_override_by_employee_id
      WHERE p.workflow_instance_id = $1 AND p.small_company_override IS NOT NULL
     UNION ALL
     SELECT s.sub_section_key, s.title, s.system_outcome, s.conclusion, s.basis,
            e.full_name, s.decided_at
       FROM hsdg.audit_framework_subassessment s
       LEFT JOIN hsdg.employees e ON e.id = s.decided_by_employee_id
      WHERE s.workflow_instance_id = $1 AND s.is_overridden
     UNION ALL
     SELECT 'other_areas', a.title, a.system_suggestion, a.conclusion, a.basis,
            e.full_name, a.decided_at
       FROM hsdg.audit_framework_assessments a
       LEFT JOIN hsdg.employees e ON e.id = a.decided_by_employee_id
      WHERE a.workflow_instance_id = $1 AND a.is_overridden AND a.area_key = ANY($2::text[])`,
    [workflowInstanceId, [...OTHER_AREA_KEYS]],
  );
  return frameworkOverridesOf(rows);
}
