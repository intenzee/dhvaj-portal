import type { PoolClient } from 'pg';
import type { FrameworkSummarySection, FrameworkTriggeredRequirement } from '@hsdg/contracts';

/**
 * 02.8 §5 — circumstance-driven auditing requirements triggered by Section 02
 * facts (Track B). DI-free: the summary service calls it inside its own
 * transaction. PLACEHOLDER — Track B replaces it with the full trigger set.
 */
export async function readTriggeredRequirementsOn(
  client: PoolClient,
  workflowInstanceId: string,
  _sections: FrameworkSummarySection[],
): Promise<FrameworkTriggeredRequirement[]> {
  const { rows } = await client.query<{ sa510_flag: boolean; sa402_flag: boolean }>(
    `SELECT sa510_flag, sa402_flag FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  const out: FrameworkTriggeredRequirement[] = [];
  if (rows[0]?.sa510_flag)
    out.push({
      key: 'sa_510',
      requirement: 'SA 510 consideration',
      trigger: 'Initial audit engagement',
      source: '02.1',
      downstreamWork: 'Initial balances / predecessor work in Planning and Execution',
      provisionCode: null,
      authorityProvisionId: null,
    });
  if (rows[0]?.sa402_flag)
    out.push({
      key: 'sa_402',
      requirement: 'SA 402 consideration',
      trigger: 'Service organisation used',
      source: '02.1',
      downstreamWork: 'Planning / risk / control procedures',
      provisionCode: null,
      authorityProvisionId: null,
    });
  return out;
}
