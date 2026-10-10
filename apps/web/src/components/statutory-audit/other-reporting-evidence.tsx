'use client';

import type { ReportingCardKey } from '@hsdg/contracts';

/**
 * 02.7 per-card evidence (spec §16 "View Evidence") — Track B slot
 * (docs/02-7-other-reporting-build-split.md). Link / unlink engagement
 * documents to one requirement card; the count feeds the card's "N linked items".
 * PLACEHOLDER from the Track A interface commit; Track B replaces it.
 */
export function ReportingCardEvidence(_props: {
  engagementId: string;
  workflowInstanceId: string;
  cardKey: ReportingCardKey;
  canManage: boolean;
}): JSX.Element | null {
  return null;
}
