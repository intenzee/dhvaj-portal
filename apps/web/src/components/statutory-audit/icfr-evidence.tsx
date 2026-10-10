'use client';

import { type StatutoryAuditIcfr } from '@hsdg/contracts';
import { FrameworkEvidence } from './framework-evidence';

/**
 * 02.5 Evidence / ICFR Reporting Applicability Memo (DHVAJ 02.5 spec §20).
 * Routine applicability is documented by the structured assessment itself; the
 * memo is suggested for an override, further assessment or a partner approval
 * (or created on demand). It merges the 02.5 assessment, the Section 05 ICFR
 * workstream and the consolidated consideration. Add File / Link Existing File
 * / Open / Version History run through the shared Section 02 evidence
 * plumbing, SharePoint-backed.
 */
export function IcfrEvidence({
  engagementId,
  icfr,
  readOnly,
}: {
  engagementId: string;
  icfr: StatutoryAuditIcfr;
  readOnly: boolean;
}): JSX.Element {
  return (
    <section className="space-y-1.5" aria-label="ICFR evidence and memo">
      <FrameworkEvidence
        engagementId={engagementId}
        workflowInstanceId={icfr.workflowInstanceId}
        subAssessmentId={icfr.assessment.id}
        memoSuggested={!!icfr.memoSuggested}
        readOnly={readOnly}
      />
    </section>
  );
}
