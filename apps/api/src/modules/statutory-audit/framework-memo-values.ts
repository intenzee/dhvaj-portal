import type { FinancialReportingMemoFacts } from '@hsdg/contracts';
import { formatLongDate } from './acceptance-merge-values';

/**
 * The `frf.*` merge values of the Financial Reporting Framework technical memo
 * (02.2 spec §18): the current 02.2 assessment as display text — the system
 * conclusion with its rule basis and limits, the facts used, and the
 * professional conclusion (override, partner approval, pending information).
 * Pure; an absent assessment leaves every field blank so the memo shows its
 * `[label]` gaps rather than guessing.
 */
export function frameworkMemoMergeValues(
  f: FinancialReportingMemoFacts | null,
): Record<string, string | null> {
  if (!f) return {};
  // A blank display string is a gap — the memo shows `[label]`, never ''.
  const t = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);
  const facts = f.factsUsed.filter((x) => t(x.label));
  return {
    'frf.framework': t(f.framework),
    'frf.applicabilityType': t(f.applicabilityType),
    'frf.effectiveFrom': t(f.effectiveFromFy),
    'frf.primaryTrigger': t(f.primaryTrigger),
    'frf.secondaryTriggers': t(f.secondaryTriggers),
    'frf.ruleApplied': t(f.ruleApplied),
    'frf.limitApplied': t(f.limitApplied),
    'frf.factsUsed': facts.length
      ? facts.map((x) => `${x.label.trim()}: ${t(x.value) ?? '—'}`).join('; ')
      : null,
    'frf.systemConclusion': t(f.systemConclusion),
    'frf.systemBasis': t(f.systemBasis),
    'frf.professionalConclusion': t(f.professionalConclusion),
    'frf.overridden': f.isOverridden ? 'Yes' : 'No',
    'frf.overrideReason': t(f.overrideReason),
    'frf.smcStatus': t(f.smcStatus),
    'frf.firstTimeAdoption': t(f.firstTimeAdoption),
    'frf.partnerApproval': t(f.partnerApproval),
    'frf.pendingReason': t(f.pendingReason),
    'frf.decidedBy': t(f.decidedBy),
    'frf.decidedAt': /^\d{4}-\d{2}-\d{2}/.test(f.decidedAt ?? '')
      ? formatLongDate(f.decidedAt.slice(0, 10))
      : t(f.decidedAt),
  };
}
