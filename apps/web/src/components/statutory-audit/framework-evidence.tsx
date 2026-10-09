'use client';

/**
 * 02.2 Evidence / Technical Memo (Section 02.2 spec §7, §18) — SharePoint-backed
 * Add / Link / Open / Remove / Version history, and "Create Financial Reporting
 * Framework Memo" when `memoSuggested`. Owned by the evidence & memo segment;
 * this is the mount point the 02.2 workspace renders.
 */
export function FrameworkEvidence(_props: {
  engagementId: string;
  workflowInstanceId: string;
  subAssessmentId: string;
  memoSuggested: boolean;
  readOnly: boolean;
}): JSX.Element | null {
  return null;
}
