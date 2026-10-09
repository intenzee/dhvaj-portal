import type { PoolClient } from 'pg';

/**
 * Plain reads of the 02.4 CARO clause programme for other services (no DI, no
 * service imports — so AuditCaroService and completion can read it without an
 * import cycle). Each runs in the caller's RLS transaction.
 */
/**
 * The live clause items' approval status, for completion / Section 08 (spec
 * §18). Runs in the caller's transaction; null when no programme exists.
 */
export async function readCaroClauseStatus(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<{ total: number; approved: number; reportable: number } | null> {
  const { rows } = await client.query<{ total: number; approved: number; reportable: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE review_state = 'approved')::int AS approved,
            count(*) FILTER (WHERE conclusion = 'reportable_matter')::int AS reportable
       FROM hsdg.audit_caro_clause_item
      WHERE workflow_instance_id = $1 AND status = 'active'`,
    [workflowInstanceId],
  );
  return rows[0] && rows[0].total > 0 ? rows[0] : null;
}

/**
 * The CARO report contexts whose clause programme is instantiated and live
 * (02.4 §19 completion): 'standalone' when the paragraph-3 programme is active,
 * 'consolidated' when the 3(xxi) item is. Runs in the caller's transaction.
 */
export async function caroProgrammeContextsOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<string[]> {
  const { rows } = await client.query<{ report_context: string }>(
    `SELECT DISTINCT i.report_context
       FROM hsdg.audit_caro_clause_item i
       JOIN hsdg.audit_caro_programme p ON p.id = i.programme_id AND p.status = 'active'
      WHERE i.workflow_instance_id = $1 AND i.status = 'active'
      ORDER BY i.report_context DESC`,
    [workflowInstanceId],
  );
  return rows.map((r) => r.report_context);
}
