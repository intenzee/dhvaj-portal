import type { PoolClient } from 'pg';
import type {
  IcfrConsolidatedStatus,
  IcfrDeficiencyClass,
  IcfrParentConclusion,
  IcfrReportingSummary,
  IcfrWorkstreamConclusion,
  IcfrWorkstreamStatus,
} from '@hsdg/contracts';
import { summariseDeficiencies } from './icfr-controls';

/**
 * Plain reads of the 02.5 ICFR workstream and consolidated consideration for
 * other modules (no DI, no service imports — the 02.5 reader, completion and
 * Section 08 call these without an import cycle). Never imports icfr-read.ts:
 * that module calls these. Each runs in the caller's RLS transaction.
 */

/** §23 checklist: the Section 05 ICFR workstream as it stands. */
export async function icfrWorkstreamStatusOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<IcfrWorkstreamStatus> {
  const { rows } = await client.query<{
    active: boolean;
    process_areas: number;
    open_deficiencies: number;
    material_weaknesses: number;
  }>(
    `SELECT w.status = 'active' AS active,
            (SELECT count(*)::int FROM hsdg.audit_icfr_process_area a
              WHERE a.workstream_id = w.id AND a.status = 'active'
                AND a.scoping = 'in_scope') AS process_areas,
            (SELECT count(*)::int FROM hsdg.audit_icfr_deficiency d
              WHERE d.workflow_instance_id = w.workflow_instance_id
                AND d.withdrawn_at IS NULL AND d.status = 'open') AS open_deficiencies,
            (SELECT count(*)::int FROM hsdg.audit_icfr_deficiency d
              WHERE d.workflow_instance_id = w.workflow_instance_id
                AND d.withdrawn_at IS NULL
                AND d.classification = 'material_weakness') AS material_weaknesses
       FROM hsdg.audit_icfr_workstream w
      WHERE w.workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  const r = rows[0];
  if (!r || !r.active)
    return { instantiated: false, processAreas: 0, openDeficiencies: 0, materialWeaknesses: 0 };
  return {
    instantiated: true,
    processAreas: r.process_areas,
    openDeficiencies: r.open_deficiencies,
    materialWeaknesses: r.material_weaknesses,
  };
}

/** §23 checklist: the consolidated ICFR consideration as it stands. */
export async function icfrConsolidatedStatusOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<IcfrConsolidatedStatus> {
  const { rows } = await client.query<{ active: boolean; components: number; pending: number }>(
    `SELECT c.status = 'active' AS active,
            count(m.id) FILTER (WHERE m.withdrawn_at IS NULL)::int AS components,
            count(m.id) FILTER (WHERE m.withdrawn_at IS NULL
              AND (m.indian_company IS NULL
                   OR (m.indian_company = 'yes' AND m.component_icfr = 'pending')))::int AS pending
       FROM hsdg.audit_icfr_consolidated c
       LEFT JOIN hsdg.audit_icfr_component m ON m.consolidated_id = c.id
      WHERE c.workflow_instance_id = $1
      GROUP BY c.id, c.status`,
    [workflowInstanceId],
  );
  const r = rows[0];
  if (!r || !r.active) return { configured: false, components: 0, pending: 0 };
  return { configured: true, components: r.components, pending: r.pending };
}

/**
 * §22 — what Section 07 / 08 read: the workstream conclusion, the deficiency
 * register by classification (MW / SD named), and the consolidated
 * consideration. Null when no ICFR workstream or consideration was ever set up.
 */
export async function readIcfrReportingOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<IcfrReportingSummary | null> {
  const [{ rows: ws }, { rows: cs }, { rows: ds }] = await Promise.all([
    client.query<{ status: string; conclusion: IcfrWorkstreamConclusion | null }>(
      `SELECT status, conclusion FROM hsdg.audit_icfr_workstream WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    ),
    client.query<{
      status: string;
      parent_conclusion: IcfrParentConclusion | null;
      component_mw: number;
    }>(
      `SELECT c.status, c.parent_conclusion,
              (SELECT count(*)::int FROM hsdg.audit_icfr_component m
                WHERE m.consolidated_id = c.id AND m.withdrawn_at IS NULL
                  AND m.material_weakness IS TRUE) AS component_mw
         FROM hsdg.audit_icfr_consolidated c WHERE c.workflow_instance_id = $1`,
      [workflowInstanceId],
    ),
    client.query<{
      seq: number;
      classification: IcfrDeficiencyClass;
      description: string;
      status: 'open' | 'closed';
      reviewed: boolean;
      partner_concluded: boolean;
    }>(
      `SELECT seq, classification, description, status,
              reviewed_at IS NOT NULL AS reviewed, partner_at IS NOT NULL AS partner_concluded
         FROM hsdg.audit_icfr_deficiency
        WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL
        ORDER BY seq`,
      [workflowInstanceId],
    ),
  ]);
  const w = ws[0];
  const c = cs[0];
  if (!w && !c) return null;
  const named = (cls: IcfrDeficiencyClass) =>
    ds
      .filter((d) => d.classification === cls)
      .map((d) => ({ ref: icfrDeficiencyRef(d.seq), description: d.description }));
  const workstreamActive = w?.status === 'active';
  return {
    workstreamActive,
    conclusion: workstreamActive ? (w?.conclusion ?? null) : null,
    concluded: workstreamActive && w?.conclusion != null,
    deficiencies: summariseDeficiencies(
      ds.map((d) => ({
        classification: d.classification,
        status: d.status,
        reviewed: d.reviewed,
        partnerConcluded: d.partner_concluded,
        withdrawn: false,
      })),
    ),
    materialWeaknesses: named('material_weakness'),
    significantDeficiencies: named('significant_deficiency'),
    consolidated: {
      active: c?.status === 'active',
      parentConclusion: c?.status === 'active' ? c.parent_conclusion : null,
      componentMaterialWeaknesses: c?.status === 'active' ? c.component_mw : 0,
    },
  };
}

export const icfrDeficiencyRef = (seq: number) => `ICD-${String(seq).padStart(3, '0')}`;
