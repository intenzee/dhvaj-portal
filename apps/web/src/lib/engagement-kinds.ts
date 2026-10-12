import type { EngagementKind } from '@hsdg/contracts';

/** How each engagement kind reads in the UI (spec Change 1). */
export const KIND_LABEL: Record<EngagementKind, string> = {
  statutory_audit: 'Statutory Audit',
  compliance: 'Compliance',
  assignment: 'Assignment',
};
