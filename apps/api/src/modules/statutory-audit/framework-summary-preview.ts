import type { PoolClient } from 'pg';
import type { DownstreamPreviewItem, FrameworkSummarySection } from '@hsdg/contracts';

/**
 * 02.8 §6 — the rule-driven Downstream Configuration Preview (Track B).
 * DI-free. PLACEHOLDER — Track B replaces it with the full rule set.
 */
export async function readDownstreamPreviewOn(
  _client: PoolClient,
  _workflowInstanceId: string,
  sections: FrameworkSummarySection[],
): Promise<DownstreamPreviewItem[]> {
  const s = sections.find((x) => x.subSectionKey === '02.4');
  const caro = s?.conclusion ?? s?.systemOutcome ?? null;
  return [
    {
      key: 'caro_programme',
      item: 'CARO Work Programme',
      result: caro === 'applicable' ? 'Required' : 'Not Required',
      action: caro === 'applicable' ? 'create' : 'none',
      source: '02.4',
      ruleKey: 'placeholder',
    },
  ];
}
