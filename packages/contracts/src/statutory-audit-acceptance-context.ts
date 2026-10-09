/**
 * Section 01 — facts the questions are evaluated against, read from the file
 * and the masters so nobody re-enters them (spec §1, §8, §13).
 */

/** Where the first-year / continuing call came from. */
export type FirstYearSource = 'profile' | 'history' | 'unknown';

/** Another active service DHVAJ provides to the same client (IND-03). */
export interface AcceptanceOtherService {
  engagementServiceId: string;
  serviceName: string;
  engagementCode: string;
  financialYear: string;
  status: string;
}

/** One team member's independence declaration for this engagement (01.5). */
export interface IndependenceDeclarationRow {
  employeeId: string;
  employeeName: string;
  /** Engagement role: Engagement Partner, Engagement Manager or the team role. */
  role: string;
  status: 'pending' | 'independent' | 'threat_disclosed';
  disclosure: string | null;
  declaredAt: string | null;
}

export interface IndependenceSummary {
  required: number;
  completed: number;
  pending: number;
  threatsDisclosed: number;
  rows: IndependenceDeclarationRow[];
  /** The signed-in user's own row, when they are on the team. */
  mine: IndependenceDeclarationRow | null;
}

/** Last year's Section 01, for a continuing engagement (spec §7.1, §13). */
export interface AcceptancePriorYear {
  workflowInstanceId: string;
  engagementId: string;
  financialYear: string;
  /** Last year's Partner conclusion, when Section 01 was approved. */
  conclusion: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  /** Last year's acceptance matters still open or accepted with conditions. */
  carriedForwardMatters: { matterCode: string; title: string; status: string; resolution: string | null }[];
  /** Last year's answers by question key. */
  answers: Record<string, { answer: string | null; details: Record<string, unknown> }>;
}

export interface AcceptanceContext {
  /** True first-year, false continuing, null unknown (spec §4 "system derived"). */
  firstYear: boolean | null;
  firstYearSource: FirstYearSource;
  otherServices: AcceptanceOtherService[];
  independence: IndependenceSummary;
  /** Working status of Section 01 files by slot key (from the file cards). */
  fileStatuses: Record<string, string>;
  priorYear: AcceptancePriorYear | null;
  /** The engagement's Engagement Partner / Manager (header + matter owners). */
  partner: { employeeId: string | null; name: string | null };
  manager: { employeeId: string | null; name: string | null };
}

/** Record the signed-in user's own independence declaration. */
export interface RecordIndependenceDeclarationInput {
  status: 'independent' | 'threat_disclosed';
  /** Required when a threat is disclosed. */
  disclosure?: string | null;
}
