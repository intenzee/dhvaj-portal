import { Client } from 'pg';

/**
 * Put a statutory-audit file into the "Section 02 approved" state the way 02.8
 * AF-02 leaves it — an approved Audit Framework Baseline v1.0, the legacy
 * Phase-02 approval record, the frozen area cards / sub-assessments and the
 * completed 'framework' phase — without walking AF-01 → memorandum → AF-02.
 *
 * For suites that test what happens AFTER the framework is approved (planning,
 * work, review, completion …). The 02.8 flow itself is exercised end to end in
 * statutory-audit-framework-summary.e2e-spec.ts. Uses the superuser connection,
 * so it bypasses RLS and the role checks by design.
 */
export async function approveFrameworkForTest(
  shellId: string,
  opts: { memo?: string } = {},
): Promise<void> {
  const su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
  await su.connect();
  try {
    await su.query('BEGIN');
    const { rows } = await su.query<{ engagement_id: string; ep: string | null }>(
      `SELECT w.engagement_id, e.engagement_partner_id AS ep
         FROM hsdg.service_workflow_instances w
         JOIN hsdg.engagements e ON e.id = w.engagement_id
        WHERE w.id = $1`,
      [shellId],
    );
    const shell = rows[0];
    if (!shell) throw new Error(`approveFrameworkForTest: unknown shell ${shellId}`);
    const { rows: areas } = await su.query<{
      area_key: string;
      conclusion: string | null;
      is_overridden: boolean;
    }>(
      `UPDATE hsdg.audit_framework_assessments SET state = 'approved'
        WHERE workflow_instance_id = $1
          AND state IN ('applicable', 'not_applicable', 'overridden')
        RETURNING area_key, conclusion, is_overridden`,
      [shellId],
    );
    await su.query(
      `UPDATE hsdg.audit_framework_subassessment SET state = 'approved'
        WHERE workflow_instance_id = $1
          AND state IN ('applicable', 'not_applicable', 'overridden')`,
      [shellId],
    );
    const snapshot = areas.map((a) => ({
      areaKey: a.area_key,
      conclusion: a.conclusion,
      isOverridden: a.is_overridden,
    }));
    // Supersede any live baseline, then record the approved one.
    await su.query(
      `UPDATE hsdg.audit_framework_baseline SET status = 'superseded', superseded_at = now()
        WHERE workflow_instance_id = $1 AND status <> 'superseded'`,
      [shellId],
    );
    const { rows: prior } = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.audit_framework_baseline WHERE workflow_instance_id = $1`,
      [shellId],
    );
    await su.query(
      `INSERT INTO hsdg.audit_framework_baseline
         (workflow_instance_id, engagement_id, version, status, methodology_version, snapshot,
          ep_decision, ep_approved_by_employee_id, ep_approved_at, audit_period)
       VALUES ($1, $2, $3, 'approved', 'DHVAJ Statutory Audit Methodology v1.0', $4::jsonb,
               'approve', $5, now(), 'e2e')`,
      [
        shellId,
        shell.engagement_id,
        `1.${prior[0]!.n}`,
        JSON.stringify({ legacyAreas: snapshot }),
        shell.ep,
      ],
    );
    await su.query(
      `INSERT INTO hsdg.audit_framework_approvals
         (workflow_instance_id, engagement_id, version, memo, snapshot, approved_by_employee_id)
       SELECT $1, $2, COALESCE(MAX(version), 0) + 1, $3, $4::jsonb, $5
         FROM hsdg.audit_framework_approvals WHERE workflow_instance_id = $1`,
      [
        shellId,
        shell.engagement_id,
        opts.memo ?? 'Framework approved (e2e).',
        JSON.stringify(snapshot),
        shell.ep,
      ],
    );
    await su.query(
      `UPDATE hsdg.audit_workflow_phases SET state = 'complete'
        WHERE workflow_instance_id = $1 AND phase_key = 'framework'`,
      [shellId],
    );
    // The same immutable audit event the real AF-02 approval writes.
    await su.query(
      `INSERT INTO hsdg.audit_events (actor_role, action, object_type, object_id, after_state)
       VALUES ('e2e', 'statutory_audit.framework_ep_approved', 'audit_framework_baseline', $1,
               '{"decision":"approve","source":"approveFrameworkForTest"}'::jsonb)`,
      [shellId],
    );
    await su.query('COMMIT');
  } catch (err) {
    await su.query('ROLLBACK');
    throw err;
  } finally {
    await su.end();
  }
}
