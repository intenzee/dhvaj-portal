import type { PoolClient } from 'pg';
import {
  CONSOLIDATION_METHOD,
  CONSOLIDATION_OUTCOME,
  FRAMEWORK_AREA_KEY,
  INVESTEE_RELATIONSHIP,
  PERIMETER_INCLUSION,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type ConsolidationApprovedResult,
  type ConsolidationComponentRef,
  type ConsolidationOutcome,
  type FrameworkState,
  type ReportingFrameworkOutcome,
} from '@hsdg/contracts';

/**
 * DI-free 02.6 readers (Track A): downstream modules (Track B's group-audit
 * framework, 02.4 3(xxi), 02.5 consolidated, 03.3 materiality) read the 02.6
 * result from the stored sub-assessment without injecting
 * AuditConsolidationService — importing a service into a helper that service
 * imports breaks Nest DI (ESM cycle, 02.4 lesson). Runs inside the caller's RLS
 * transaction.
 */

const SUB = SUB_SECTION_KEY.consolidation;
const AREA = FRAMEWORK_AREA_KEY.cfs;
const DECIDED = new Set<FrameworkState>(['applicable', 'not_applicable', 'overridden', 'approved']);

interface StoredPerimeterEntry {
  id?: string;
  name?: string;
  relationship?: string;
  method?: string;
  included?: string;
  country?: string | null;
  isIndianCompany?: boolean | null;
  reportingDate?: string | null;
  localFramework?: string | null;
}

/** The stored perimeter as component refs (entries without a name are skipped). */
export function componentsFromDetail(detail: unknown): ConsolidationComponentRef[] {
  const perimeter = (detail as { perimeter?: StoredPerimeterEntry[] } | null)?.perimeter ?? [];
  return perimeter
    .filter((p) => p?.name?.trim())
    .map((p) => ({
      id: p.id ?? `name:${p.name!.trim().toLowerCase()}`,
      name: p.name!.trim(),
      relationship: (p.relationship ??
        INVESTEE_RELATIONSHIP.none) as ConsolidationComponentRef['relationship'],
      method: (p.method ?? CONSOLIDATION_METHOD.none) as ConsolidationComponentRef['method'],
      included: (p.included ??
        (p.relationship && p.relationship !== INVESTEE_RELATIONSHIP.none
          ? PERIMETER_INCLUSION.yes
          : PERIMETER_INCLUSION.no)) as ConsolidationComponentRef['included'],
      country: p.country ?? null,
      isIndianCompany: p.isIndianCompany ?? null,
      reportingDate: p.reportingDate ?? null,
      localFramework: p.localFramework ?? null,
    }));
}

function cfsRequiredOf(outcome: ConsolidationOutcome | null): boolean | null {
  if (outcome === CONSOLIDATION_OUTCOME.cfsRequired) return true;
  if (
    outcome === CONSOLIDATION_OUTCOME.cfsExempt ||
    outcome === CONSOLIDATION_OUTCOME.notApplicable
  )
    return false;
  return null;
}

/**
 * The 02.6 result for one workflow instance: the conclusion when decided, else
 * the stored system suggestion. Null when the 02.6 row has not been seeded yet.
 */
export async function readConsolidationResultOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<ConsolidationApprovedResult | null> {
  const { rows } = await client.query<{
    state: FrameworkState;
    conclusion: string | null;
    system_outcome: string | null;
    system_detail: unknown;
    facts: { hasBranches?: boolean } | null;
    financial_year: string | null;
    fr_state: FrameworkState | null;
    fr_conclusion: string | null;
  }>(
    `SELECT s.state, s.conclusion, s.system_outcome, s.system_detail, s.facts,
            e.financial_year, fr.state AS fr_state, fr.conclusion AS fr_conclusion
       FROM hsdg.audit_framework_subassessment s
       JOIN hsdg.engagements e ON e.id = s.engagement_id
       LEFT JOIN hsdg.audit_framework_subassessment fr
         ON fr.workflow_instance_id = s.workflow_instance_id
        AND fr.sub_section_key = $4 AND fr.area_key = $5
      WHERE s.workflow_instance_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3`,
    [
      workflowInstanceId,
      SUB,
      AREA,
      SUB_SECTION_KEY.financialReporting,
      FRAMEWORK_AREA_KEY.financialReportingFramework,
    ],
  );
  const r = rows[0];
  if (!r) return null;
  const decided = DECIDED.has(r.state) && r.conclusion != null;
  const outcome = (decided ? r.conclusion : r.system_outcome) as ConsolidationOutcome | null;
  const fy = r.financial_year;
  return {
    workflowInstanceId,
    outcome,
    decided,
    complete: false,
    cfsRequired: cfsRequiredOf(outcome),
    groupFramework:
      r.fr_state && DECIDED.has(r.fr_state) && r.fr_conclusion
        ? (r.fr_conclusion as ReportingFrameworkOutcome)
        : null,
    components: componentsFromDetail(r.system_detail),
    branchesOnMaster: r.facts?.hasBranches === true,
    financialYear: fy,
    periodStart: fy ? auditPeriodStartFromFinancialYear(fy) : new Date().toISOString().slice(0, 10),
  };
}
