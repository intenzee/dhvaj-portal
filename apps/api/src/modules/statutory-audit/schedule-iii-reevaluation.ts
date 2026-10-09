import type { PoolClient } from 'pg';
import { FRAMEWORK_AREA_KEY, SUB_SECTION_KEY } from '@hsdg/contracts';

/**
 * Mark a decided 02.3 Schedule III assessment "Needs Re-evaluation" after an
 * upstream fact it froze has changed (DHVAJ 02.3 spec §2, §21 test 5) — the
 * 02.2 conclusion, the 02.6 consolidation result or CSR applicability. An
 * approved 02.3 drops back to `reassessment_required`. Undecided rows are
 * recomputed live on every read, so they need no flag.
 *
 * `factKey` / `newValue` compare against the fact frozen in
 * `system_detail.factsUsed`, so re-recording the same upstream answer does not
 * flag 02.3. Lives in its own module so 02.2 / 02.6 can call it without an
 * import cycle through the 02.3 service. Returns true when a row was flagged.
 */
export async function flagScheduleIiiReevaluationOn(
  client: PoolClient,
  workflowInstanceId: string,
  change: { factKey: string; newValue: string },
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE hsdg.audit_framework_subassessment s
        SET needs_reevaluation = true,
            state = CASE WHEN s.state = 'approved' THEN 'reassessment_required' ELSE s.state END
      WHERE s.workflow_instance_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
        AND s.state IN ('applicable','not_applicable','overridden','approved')
        AND COALESCE((
              SELECT f->>'value'
                FROM jsonb_array_elements(COALESCE(s.system_detail->'factsUsed', '[]'::jsonb)) f
               WHERE f->>'key' = $4
               LIMIT 1), '') IS DISTINCT FROM $5`,
    [
      workflowInstanceId,
      SUB_SECTION_KEY.scheduleIii,
      FRAMEWORK_AREA_KEY.scheduleIii,
      change.factKey,
      change.newValue,
    ],
  );
  return (rowCount ?? 0) > 0;
}
