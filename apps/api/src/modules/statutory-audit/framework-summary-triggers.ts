import type { PoolClient } from 'pg';
import type { FrameworkSummarySection, FrameworkTriggeredRequirement } from '@hsdg/contracts';
import { deriveTriggeredRequirements } from './framework-summary-records';
import {
  readFrameworkEngagementOn,
  readFrameworkRecordInputsOn,
  resolveProvisionIdsOn,
} from './framework-summary-inputs';

/**
 * 02.8 §5 — circumstance-driven auditing requirements triggered by Section 02
 * facts (Track B): SA 510, SA 402, joint audit (SA 299), SA 600, SA 620, CFS
 * consolidation and a significant IT environment (SA 315). Never a checklist of
 * every SA. Each row's View Standard resolves through the central Provision
 * Library at the version applicable to the audit period. DI-free: the summary
 * service calls it inside its own transaction.
 */
export async function readTriggeredRequirementsOn(
  client: PoolClient,
  workflowInstanceId: string,
  _sections: FrameworkSummarySection[],
): Promise<FrameworkTriggeredRequirement[]> {
  const rows = deriveTriggeredRequirements(
    await readFrameworkRecordInputsOn(client, workflowInstanceId),
  );
  const eng = await readFrameworkEngagementOn(client, workflowInstanceId);
  const codes = rows.map((r) => r.provisionCode).filter((c): c is string => !!c);
  const ids = eng ? await resolveProvisionIdsOn(client, codes, eng.periodEnd) : new Map();
  return rows.map((r) => ({
    ...r,
    authorityProvisionId: r.provisionCode ? (ids.get(r.provisionCode) ?? null) : null,
  }));
}
