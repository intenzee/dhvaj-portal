import type { PoolClient } from 'pg';
import {
  COMPONENT_AUDITOR_TYPE,
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  type Br01Answer,
  type ComponentAuditorFeed,
  type ComponentAuditorType,
  type ComponentReportType,
  type ComponentSignificance,
  type Ga01Answer,
  type Ga02Answer,
  type GaYesNoPending,
  type GroupAuditStatus,
  type GroupFindingCategory,
  type PackageDocumentKey,
  type PackageDocumentStatus,
} from '@hsdg/contracts';
import { readConsolidationResultOn } from './consolidation-read';
import {
  computeGroupAuditStatus,
  emptyGroupAuditStatus,
  findingRef,
  matrixComponents,
  packageRelevance,
  pendingPackageDocuments,
  perimeterFromDetail,
  suggestBr01,
  suggestGa01,
} from './group-audit';

/**
 * DI-free 02.6 Part B readers (Track B — group / component / branch auditor
 * framework). Track A's landing screen, CFS-05 summary and §24 checklist, and
 * the 02.4 3(xxi) / 02.5 consolidated component syncs (§20), read the
 * group-audit state here without injecting AuditGroupAuditService (importing a
 * service into a helper that service imports breaks Nest DI — 02.4 lesson).
 * Runs inside the caller's RLS transaction; reads only, never seeds.
 */

interface GroupRow {
  id: string;
  ga01: Ga01Answer | null;
  br01: Br01Answer;
  br01_source: 'system' | 'team';
  work_status: 'none' | 'active' | 'withdrawn';
}

interface ComponentRow {
  id: string;
  component_id: string;
  component_name: string;
  is_indian_company: boolean | null;
  auditor_type: ComponentAuditorType;
  firm_name: string | null;
  significance: ComponentSignificance;
  ga02: Ga02Answer;
  ga03: GaYesNoPending;
  ga04: GaYesNoPending;
  report_type: ComponentReportType | null;
  report_document_id: string | null;
  caro_report_document_id: string | null;
  icfr_report_document_id: string | null;
  has_instructions: boolean;
  packages: Array<{ key: PackageDocumentKey; status: PackageDocumentStatus }> | null;
}

/** The stored 02.6 perimeter (the same system_detail Track A's reader parses). */
async function readPerimeterOn(client: PoolClient, workflowInstanceId: string) {
  const { rows } = await client.query<{ system_detail: unknown }>(
    `SELECT system_detail FROM hsdg.audit_framework_subassessment
      WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
    [workflowInstanceId, SUB_SECTION_KEY.consolidation, FRAMEWORK_AREA_KEY.cfs],
  );
  return perimeterFromDetail(rows[0]?.system_detail ?? null);
}

async function readComponentRowsOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<ComponentRow[]> {
  const { rows } = await client.query<ComponentRow>(
    `SELECT c.id, c.component_id, c.component_name, c.is_indian_company, c.auditor_type,
            c.firm_name, c.significance, c.ga02, c.ga03, c.ga04, c.report_type,
            (SELECT f.document_id FROM hsdg.audit_group_file f
              WHERE f.component_row_id = c.id AND f.slot = 'report' AND f.superseded_at IS NULL
              LIMIT 1) AS report_document_id,
            (SELECT f.document_id FROM hsdg.audit_group_file f
              WHERE f.component_row_id = c.id AND f.slot = 'package'
                AND f.package_key = 'caro_report' AND f.superseded_at IS NULL
              LIMIT 1) AS caro_report_document_id,
            (SELECT f.document_id FROM hsdg.audit_group_file f
              WHERE f.component_row_id = c.id AND f.slot = 'package'
                AND f.package_key = 'icfr_report' AND f.superseded_at IS NULL
              LIMIT 1) AS icfr_report_document_id,
            EXISTS (SELECT 1 FROM hsdg.audit_group_file f
                     WHERE f.component_row_id = c.id AND f.slot = 'instructions'
                       AND f.superseded_at IS NULL) AS has_instructions,
            (SELECT json_agg(json_build_object('key', p.package_key, 'status', p.status))
               FROM hsdg.audit_group_package p WHERE p.component_row_id = c.id) AS packages
       FROM hsdg.audit_group_component c
      WHERE c.workflow_instance_id = $1 AND c.withdrawn_at IS NULL
      ORDER BY c.sort_order, c.component_name`,
    [workflowInstanceId],
  );
  return rows;
}

function pendingPackageOf(r: ComponentRow): number {
  const status: Partial<Record<PackageDocumentKey, PackageDocumentStatus>> = {};
  for (const p of r.packages ?? []) status[p.key] = p.status;
  return pendingPackageDocuments(packageRelevance(r.auditor_type, r.is_indian_company), status)
    .length;
}

/**
 * The group-audit status of one statutory-audit workflow for Track A: matrix
 * counts, SA 600 / instructions / package pendings, branch auditors, the work
 * programme and the blocking matters. Reflects the current 02.6 perimeter even
 * before the group-audit panel was first opened (unsynced components count as
 * missing rows).
 */
export async function groupAuditStatusOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<GroupAuditStatus> {
  const result = await readConsolidationResultOn(client, workflowInstanceId);
  if (!result) return emptyGroupAuditStatus();
  const perimeter = await readPerimeterOn(client, workflowInstanceId);
  const expected = matrixComponents(perimeter).map((c) => c.id);
  const expectedSet = new Set(expected);

  const { rows: groups } = await client.query<GroupRow>(
    `SELECT id, ga01, br01, br01_source, work_status
       FROM hsdg.audit_group_audit WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  const group = groups[0] ?? null;
  const components = group
    ? (await readComponentRowsOn(client, workflowInstanceId)).filter((c) =>
        expectedSet.has(c.component_id),
      )
    : [];

  const [{ rows: branches }, { rows: findings }] = group
    ? await Promise.all([
        client.query<{
          branch_name: string;
          significance: ComponentSignificance;
          ga02: Ga02Answer;
          ga03: GaYesNoPending;
          ga04: GaYesNoPending;
          principal_response: string | null;
          conclusion: string;
          has_report: boolean;
        }>(
          `SELECT b.branch_name, b.significance, b.ga02, b.ga03, b.ga04, b.principal_response,
                  b.conclusion,
                  EXISTS (SELECT 1 FROM hsdg.audit_group_file f
                           WHERE f.branch_id = b.id AND f.slot = 'branch_report'
                             AND f.superseded_at IS NULL) AS has_report
             FROM hsdg.audit_group_branch b
            WHERE b.workflow_instance_id = $1 AND b.withdrawn_at IS NULL`,
          [workflowInstanceId],
        ),
        client.query<{
          seq: number;
          subject_name: string | null;
          category: GroupFindingCategory;
          status: 'open' | 'resolved';
        }>(
          `SELECT f.seq, COALESCE(c.component_name, b.branch_name) AS subject_name, f.category,
                  f.status
             FROM hsdg.audit_group_finding f
             LEFT JOIN hsdg.audit_group_component c ON c.id = f.component_row_id
             LEFT JOIN hsdg.audit_group_branch b ON b.id = f.branch_id
            WHERE f.workflow_instance_id = $1 AND f.withdrawn_at IS NULL
              AND COALESCE(c.withdrawn_at, b.withdrawn_at) IS NULL`,
          [workflowInstanceId],
        ),
      ])
    : [{ rows: [] }, { rows: [] }];

  const br01 =
    group && group.br01_source === 'team'
      ? group.br01
      : suggestBr01({ branchesOnMaster: result.branchesOnMaster, branchRecords: branches.length })
          .answer;
  const ga01 = group?.ga01 ?? suggestGa01(components.map((c) => c.auditor_type)).answer;

  return computeGroupAuditStatus({
    cfsRequired: result.cfsRequired,
    expectedComponentIds: expected,
    components: components.map((c) => ({
      componentId: c.component_id,
      componentName: c.component_name,
      auditorType: c.auditor_type,
      firmName: c.firm_name,
      significance: c.significance,
      ga02: c.ga02,
      ga03: c.ga03,
      ga04: c.ga04,
      hasInstructions: c.has_instructions,
      pendingPackage: pendingPackageOf(c),
    })),
    ga01,
    br01,
    branches: branches.map((b) => ({
      branchName: b.branch_name,
      significance: b.significance,
      ga02: b.ga02,
      ga03: b.ga03,
      ga04: b.ga04,
      hasReport: b.has_report,
      principalResponse: b.principal_response,
      conclusion: b.conclusion,
    })),
    findings: findings.map((f) => ({
      ref: findingRef(f.seq),
      subjectName: f.subject_name ?? 'Component',
      category: f.category,
      status: f.status,
    })),
    workProgrammeActive: group?.work_status === 'active',
  });
}

/**
 * Every live matrix value for another module (§20 — one group structure feeds
 * 02.4 CARO 3(xxi) and 02.5 consolidated ICFR; no duplicate component entry).
 * Keyed on the stable 02.6 component id; empty until the matrix exists.
 */
export async function componentAuditorFeedOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<ComponentAuditorFeed[]> {
  const rows = await readComponentRowsOn(client, workflowInstanceId);
  return rows
    .filter((r) => r.auditor_type !== COMPONENT_AUDITOR_TYPE.tbd)
    .map((r) => ({
      componentId: r.component_id,
      componentName: r.component_name,
      auditorType: r.auditor_type,
      auditorName:
        r.auditor_type === COMPONENT_AUDITOR_TYPE.dhvaj ? 'DHVAJ' : r.firm_name?.trim() || null,
      reportDocumentId: r.report_document_id,
      caroReportDocumentId: r.caro_report_document_id,
      icfrReportDocumentId: r.icfr_report_document_id,
      reportType: r.report_type,
    }));
}
