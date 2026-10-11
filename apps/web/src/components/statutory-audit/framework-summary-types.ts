import type { StatutoryAuditFrameworkSummary } from '@hsdg/contracts';

/** The props every 02.8 panel receives from `FrameworkSummaryWorkspace`. */
export interface FrameworkSummaryPanelProps {
  engagementId: string;
  summary: StatutoryAuditFrameworkSummary;
  /** Engagement lead with engagement.manage (and the framework not frozen, where relevant). */
  canManage: boolean;
  /** Re-read the 02.8 summary (and the Section 02 views that depend on it). */
  onChanged: () => void;
}

/** React Query key of the 02.8 summary. */
export const FRAMEWORK_SUMMARY_QK = (engagementId: string) =>
  ['engagement', engagementId, 'statutory-audit-framework-summary'] as const;
