'use client';

import { relationshipEvidenceKey, type StatutoryAuditConsolidation } from '@hsdg/contracts';
import { FrameworkEvidence } from './framework-evidence';

/** Investee evidence key → investee name, so relationship files are badged by name (§5). */
export function relationshipEvidenceLabels(c: StatutoryAuditConsolidation): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of c.capturedFacts.investees) if (i.id) out[relationshipEvidenceKey(i.id)] = i.name;
  return out;
}

/**
 * 02.6 Evidence / Consolidation & Group Audit Framework Memo. Routine
 * consolidation is documented by the structured assessment and the group-audit
 * matrix; the memo is suggested for an override, a Rule 6 exemption, pending
 * information or a partner approval (or created on demand). It merges the 02.6
 * conclusion, the perimeter, the component / branch auditors, the findings and
 * the consolidation work programme. Add File / Link Existing File / Open /
 * Version History run through the shared Section 02 evidence plumbing,
 * SharePoint-backed.
 */
export function ConsolidationEvidence({
  engagementId,
  consolidation,
  readOnly,
}: {
  engagementId: string;
  consolidation: StatutoryAuditConsolidation;
  readOnly: boolean;
}): JSX.Element {
  return (
    <section className="space-y-1.5" aria-label="Consolidation evidence and memo">
      <FrameworkEvidence
        engagementId={engagementId}
        workflowInstanceId={consolidation.workflowInstanceId}
        subAssessmentId={consolidation.assessment.id}
        memoSuggested={!!consolidation.memoSuggested}
        readOnly={readOnly}
        keyLabels={relationshipEvidenceLabels(consolidation)}
      />
    </section>
  );
}
