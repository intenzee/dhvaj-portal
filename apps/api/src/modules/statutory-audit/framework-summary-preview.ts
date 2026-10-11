import type { PoolClient } from 'pg';
import type { DownstreamPreviewItem, FrameworkSummarySection } from '@hsdg/contracts';
import { deriveDownstreamPreview } from './framework-summary-records';
import { readFrameworkRecordInputsOn } from './framework-summary-inputs';

/**
 * 02.8 §6 — the rule-driven Downstream Configuration Preview (Track B): the 12
 * configuration results the approved framework will create, activate or
 * parameterise, each naming its originating 02.x assessment. Generated from the
 * rules, never maintained text — an incorrect result is fixed at its source.
 * DI-free.
 */
export async function readDownstreamPreviewOn(
  client: PoolClient,
  workflowInstanceId: string,
  _sections: FrameworkSummarySection[],
): Promise<DownstreamPreviewItem[]> {
  return deriveDownstreamPreview(await readFrameworkRecordInputsOn(client, workflowInstanceId));
}
