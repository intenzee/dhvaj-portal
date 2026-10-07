/**
 * Statutory Audit — Completion / Reporting / Sign-off / Archive vocabulary
 * (Audit Spec §27, §28, §29). SA-8 closes the ten-phase file: phases 07–10.
 *
 *   • COMPLETION (§27.07) and REPORTING (§27.08) are professional CHECKLISTS —
 *     a fixed set of items (subsequent events, going concern, misstatements,
 *     auditor's report, CARO, IFC …) each carried through not_started →
 *     in_progress → complete (or not_applicable). Seeded on provisioning like the
 *     Planning sub-areas (§21), so every engagement member can read them.
 *   • PARTNER SIGN-OFF (§27.09) is gated server-side (§28 "The UI must not permit
 *     an action merely because a button is visible"): no OPEN BLOCKING review note
 *     (§29), every active audit area concluded, and both checklists resolved.
 *   • ARCHIVING (§27.10) locks the file — status → archived, and further writes
 *     are rejected so professional history is immutable (§37).
 *
 * This module is the single source of truth for the SA-8 vocabulary and is shared
 * by the pure gate helpers, the service and the screen. All gate maths lives here
 * as pure functions so it is unit-tested independent of the database (§36).
 */

import type { AuditWorkflowStatus } from './statutory-audit';

/** The two SA-8 checklist sections (§27.07, §27.08). */
export const COMPLETION_SECTION = {
  completion: 'completion',
  reporting: 'reporting',
} as const;
export type CompletionSection =
  (typeof COMPLETION_SECTION)[keyof typeof COMPLETION_SECTION];

/**
 * Professional state of a completion/reporting checklist item. `not_applicable`
 * is first-class (many reports — CARO, IFC — simply do not apply to an entity),
 * and counts as RESOLVED for gating (§27, §29).
 */
export const COMPLETION_ITEM_STATE = {
  notStarted: 'not_started',
  inProgress: 'in_progress',
  complete: 'complete',
  notApplicable: 'not_applicable',
} as const;
export type CompletionItemState =
  (typeof COMPLETION_ITEM_STATE)[keyof typeof COMPLETION_ITEM_STATE];

/** Item states that count as resolved for the completion / sign-off gate. */
export const COMPLETION_RESOLVED_STATES: readonly CompletionItemState[] = [
  'complete',
  'not_applicable',
];

/** A checklist item in the canonical catalogue: section, key, title, order. */
export interface CompletionItemDefinition {
  section: CompletionSection;
  itemKey: string;
  title: string;
  sortOrder: number;
}

/**
 * The canonical Completion (§27.07) checklist. Provisioning seeds exactly these
 * rows; the panel renders them in order. Keys are stable machine identifiers.
 */
export const COMPLETION_ITEMS: readonly CompletionItemDefinition[] = [
  { section: 'completion', itemKey: 'subsequent_events', title: 'Subsequent Events', sortOrder: 1 },
  { section: 'completion', itemKey: 'going_concern', title: 'Going Concern', sortOrder: 2 },
  { section: 'completion', itemKey: 'misstatements', title: 'Misstatements Summary', sortOrder: 3 },
  { section: 'completion', itemKey: 'final_analytics', title: 'Final Analytical Review', sortOrder: 4 },
  { section: 'completion', itemKey: 'fs_final_review', title: 'FS Final Review', sortOrder: 5 },
  { section: 'completion', itemKey: 'disclosure_review', title: 'Disclosure Review', sortOrder: 6 },
  { section: 'completion', itemKey: 'completion_memo', title: 'Completion Memo', sortOrder: 7 },
] as const;

/** The canonical Reporting (§27.08) checklist. */
export const REPORTING_ITEMS: readonly CompletionItemDefinition[] = [
  { section: 'reporting', itemKey: 'auditors_report', title: "Auditor's Report", sortOrder: 1 },
  { section: 'reporting', itemKey: 'caro', title: 'CARO', sortOrder: 2 },
  { section: 'reporting', itemKey: 'ifc', title: 'IFC Report', sortOrder: 3 },
  { section: 'reporting', itemKey: 'rule_11_143', title: 'Rule 11 / Section 143', sortOrder: 4 },
  { section: 'reporting', itemKey: 'other_reports', title: 'Other Reports / Certificates', sortOrder: 5 },
] as const;

/** Every seeded checklist item, both sections, in provisioning order. */
export const ALL_COMPLETION_ITEMS: readonly CompletionItemDefinition[] = [
  ...COMPLETION_ITEMS,
  ...REPORTING_ITEMS,
];

/** One completion/reporting checklist item on a live audit file. */
export interface AuditCompletionItem {
  id: string;
  section: CompletionSection;
  itemKey: string;
  title: string;
  state: CompletionItemState;
  /** Optional professional note / conclusion recorded against the item. */
  note: string | null;
  version: number;
  updatedAt: string;
  /** The state still follows the file (nobody has set it yet). */
  stateSuggested: boolean;
  /** The note is a draft written from the file (nobody has edited it yet). */
  noteSuggested: boolean;
  /** What the file says about this item right now. */
  evidence: CompletionItemEvidence;
}

/** Where the work behind a checklist item is done — a phase of the audit file. */
export interface CompletionGoTo {
  /** Audit-file phase / tracker key (e.g. `audit_areas`, `risk`, `framework`). */
  phaseKey: string;
  label: string;
  /** A place inside the section to scroll to (e.g. `segment-independence_ethics`). */
  anchor?: string;
}

/**
 * The live facts behind one checklist item, read from the rest of the file:
 * linked procedures, risks, exceptions, materiality and framework conclusions.
 */
export interface CompletionItemEvidence {
  /** Short, plain facts ("2 of 3 linked procedures complete"). */
  facts: string[];
  /** The state the evidence supports (never `complete` — that is a judgement). */
  suggestedState: CompletionItemState;
  /** The linked work is all done — the item is ready to be marked complete. */
  ready: boolean;
  goTo: CompletionGoTo | null;
}

/** Result of refreshing the checklist from the file. */
export interface CompletionSuggestionResult {
  completion: StatutoryAuditCompletion;
  /** Items whose suggested state or drafted note changed. */
  itemsUpdated: number;
}

/**
 * The state of the SA-8 gate for one audit file — every input the §28/§29 action
 * rules depend on, derived from the checklists, the audit areas and the review
 * notes. Carried to the screen so it can explain WHY an action is not yet
 * permitted (§32 actionable states), never merely hide a button.
 */
export interface CompletionGate {
  /** Every Completion-section item is complete or not_applicable. */
  completionItemsResolved: boolean;
  /** Every Reporting-section item is complete or not_applicable. */
  reportingItemsResolved: boolean;
  /** Open blocking review notes (§29) — any > 0 prevents completion and sign-off. */
  openBlockingNotes: number;
  /** Active audit areas whose conclusion is not yet submitted/approved (§29). */
  areasOpen: number;
  /** Completion has been approved (phase 07 signed off internally). */
  completionApproved: boolean;
  /** The partner has signed off the file (phase 09). */
  signedOff: boolean;
  /** The file has been archived and locked (phase 10). */
  archived: boolean;
}

/** The SA-8 dashboard for one statutory-audit shell — the shape the screen reads. */
export interface StatutoryAuditCompletion {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  status: AuditWorkflowStatus;
  items: AuditCompletionItem[];
  gate: CompletionGate;
  completionApprovedAt: string | null;
  completionApprovedByName: string | null;
  completionMemo: string | null;
  signedOffAt: string | null;
  signedOffByName: string | null;
  signoffMemo: string | null;
  archivedAt: string | null;
  archivedByName: string | null;
  archiveNote: string | null;
  /** Section 09 — the partner's sign-off pack, drafted from the file. */
  signOffPack: SignOffPack;
  /** Date of the auditor's report (recorded on archiving; sign-off date until then). */
  reportDate: string | null;
  /** ICAI UDIN of the auditor's report, recorded on archiving. */
  udin: string | null;
  /** Keep the file until (report date + 7 years, SQC 1), set on archiving. */
  retainUntil: string | null;
  /** Section 10 — the archive pack, drafted from the file. */
  archivePack: ArchivePack;
}

/**
 * Section 10 — the archive pack: whether the file can be archived (the
 * sign-off gate), the SA 230 assembly deadline and SQC 1 retention, what
 * archiving will freeze while still open, evidence gaps, and what next
 * year's file will bring forward. Only `blocking` checks stop archiving.
 */
export interface ArchivePack {
  checks: SignOffCheck[];
  /** The file can be archived now (signed off, not yet archived). */
  ready: boolean;
  /** How many advisory checks need attention before archiving. */
  attention: number;
  /** Auditor's report date used for the deadlines (yyyy-mm-dd). */
  reportDate: string | null;
  /** Assemble the final file by (report date + 60 days, SA 230 / SQC 1). */
  assemblyDueBy: string | null;
  /** Days left to the assembly deadline (negative when overdue). */
  daysToAssemble: number | null;
  /** Keep the file until (report date + 7 years, SQC 1). */
  retainUntil: string | null;
  /** What next year's planning (03.1.6) will bring forward from this file. */
  carryForward: string[];
  /** Drafted archive note, recorded when archiving without one. */
  draftNote: string;
}

/** ICAI UDIN: 18 characters — 2-digit year, 6-digit membership no., 10 alphanumerics. */
export const UDIN_PATTERN = /^\d{8}[A-Z0-9]{10}$/;

/**
 * Section 09 — one line of the partner's sign-off pack. A `blocking` check
 * is a §29 gate (sign-off is refused until it is `ok`); the others are what a
 * partner should know before signing (misstatements, significant risks, PBC,
 * reassessments) and never stop sign-off.
 */
export interface SignOffCheck {
  key: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  facts: string[];
  /** Where to put it right, when it is not ok. */
  goTo: CompletionGoTo | null;
}

/** Section 09 — the partner's sign-off pack, read from the whole file. */
export interface SignOffPack {
  checks: SignOffCheck[];
  /** Every blocking check is ok (same rule as the §29 gate). */
  ready: boolean;
  /** How many advisory checks need the partner's attention. */
  attention: number;
  /** The engagement partner, who signs. */
  engagementPartnerName: string | null;
  /** Drafted partner sign-off memo, used when signing off without one. */
  draftMemo: string;
}

/** Whether a checklist item counts as resolved (complete or not applicable). Pure. */
export function completionItemResolved(item: { state: CompletionItemState }): boolean {
  return COMPLETION_RESOLVED_STATES.includes(item.state);
}

/** Whether every item in a section is resolved (empty section ⇒ true). Pure. */
export function sectionResolved(
  items: readonly { section: CompletionSection; state: CompletionItemState }[],
  section: CompletionSection,
): boolean {
  return items
    .filter((i) => i.section === section)
    .every((i) => completionItemResolved(i));
}

/**
 * Approve-Completion gate (§28 "Complete only when completion criteria are
 * satisfied"): the Completion checklist is fully resolved and no open blocking
 * review note remains (§29). Not yet approved. Pure.
 */
export function canApproveCompletion(gate: CompletionGate): boolean {
  return (
    !gate.completionApproved &&
    !gate.archived &&
    gate.completionItemsResolved &&
    gate.openBlockingNotes === 0
  );
}

/**
 * Partner sign-off gate (§28, §29): completion approved, every reporting item
 * resolved, every active audit area concluded, and no open blocking review note.
 * Not yet signed off. Pure.
 */
export function canSignOff(gate: CompletionGate): boolean {
  return (
    gate.completionApproved &&
    !gate.signedOff &&
    !gate.archived &&
    gate.reportingItemsResolved &&
    gate.areasOpen === 0 &&
    gate.openBlockingNotes === 0
  );
}

/** Archive gate (§27.10): the file is signed off and not already archived. Pure. */
export function canArchive(gate: CompletionGate): boolean {
  return gate.signedOff && !gate.archived;
}

/**
 * A short, ordered list of human-readable reasons the file cannot yet be signed
 * off — drives the §32 "explain why / next required action" panel. Pure.
 */
export function signOffBlockers(gate: CompletionGate): string[] {
  const reasons: string[] = [];
  if (!gate.completionApproved) reasons.push('Completion is not yet approved.');
  if (!gate.completionItemsResolved) reasons.push('Completion checklist has open items.');
  if (!gate.reportingItemsResolved) reasons.push('Reporting checklist has open items.');
  if (gate.areasOpen > 0) {
    reasons.push(`${gate.areasOpen} audit area(s) are not yet concluded.`);
  }
  if (gate.openBlockingNotes > 0) {
    reasons.push(`${gate.openBlockingNotes} blocking review note(s) are open.`);
  }
  return reasons;
}
