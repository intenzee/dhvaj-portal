/**
 * 02.6 Part B — Group / Component / Branch Auditor Framework (DHVAJ Section
 * 02.6 spec §12–§17, §19, §20; build split Track B).
 *
 * Once 02.6 puts consolidated financial statements in scope, every component
 * included in the perimeter gets ONE row in the component / other-auditor
 * matrix (§12), keyed on the stable component `id` from the perimeter — never a
 * second group master. Another auditor brings in SA 600 "Using the Work of
 * Another Auditor" (the current Indian standard — not IAASB ISA 600 (Revised)):
 * GA-01 is answered once for the group, GA-02..GA-04 per other auditor (§13).
 * Component Auditor Instructions are generated from the approved Word template
 * in SharePoint (§14); the reporting package is a 10-document checklist (§15);
 * other-auditor findings carry their group impact (§16). Branch auditors under
 * section 143(8) are recorded whether or not CFS is required (§17). The
 * consolidation work programme is generated in Section 06 when CFS is required
 * (§19), and the matrix feeds 02.4 3(xxi) and 02.5 consolidated ICFR (§20).
 *
 * NO materiality percentage lives here (§18): amounts reach the instructions
 * only from an approved Section 03.3.
 */

import type {
  ComponentAuditorType,
  ConsolidationMethod,
  ConsolidationOutcome,
  GroupAuditStatus,
  InvesteeRelationship,
  PerimeterInclusion,
} from './statutory-audit-consolidation';

// ── §23: references beyond Track A's anchor list ─────────────────────────────

/** Extra `authority_reference_link` anchors under context '02.6' (spec §17, §23). */
export const GROUP_AUDIT_REFERENCE_ANCHOR = {
  /** Companies (Audit and Auditors) Rules 2014, Rule 12 — audit of branch accounts. */
  branchAuditRule: 'audit_rule_12',
} as const;

// ── §12 matrix ───────────────────────────────────────────────────────────────

/** Where the matrix auditor value came from. */
export const GROUP_AUDIT_VALUE_SOURCE = {
  /** Suggested from the 02.6 relationship record. */
  system: 'system',
  /** Carried from last year's matrix (stable master data, spec §21). */
  priorYear: 'prior_year',
  /** Recorded by the team. */
  team: 'team',
} as const;
export type GroupAuditValueSource =
  (typeof GROUP_AUDIT_VALUE_SOURCE)[keyof typeof GROUP_AUDIT_VALUE_SOURCE];

/** SA 600 consideration for a component (spec §12). */
export const SA600_CONSIDERATIONS = ['required', 'not_applicable', 'pending'] as const;
export type Sa600Consideration = (typeof SA600_CONSIDERATIONS)[number];
export const SA600_CONSIDERATION_LABEL: Record<Sa600Consideration, string> = {
  required: 'Required',
  not_applicable: 'N/A',
  pending: 'Pending',
};

/**
 * The component's significance to the group — a professional judgment
 * documented under GA-01, never a percentage test (spec §18). A material
 * (significant) component's GA-04 Pending blocks group-audit completion.
 */
export const COMPONENT_SIGNIFICANCE = ['significant', 'not_significant', 'pending'] as const;
export type ComponentSignificance = (typeof COMPONENT_SIGNIFICANCE)[number];
export const COMPONENT_SIGNIFICANCE_LABEL: Record<ComponentSignificance, string> = {
  significant: 'Significant / material',
  not_significant: 'Not significant',
  pending: 'Pending',
};

/** The component auditor's report, structured (spec §12). */
export const COMPONENT_REPORT_TYPES = [
  'unmodified',
  'unmodified_emphasis',
  'qualified',
  'adverse',
  'disclaimer',
  'review_report',
  'special_purpose',
  'not_issued',
] as const;
export type ComponentReportType = (typeof COMPONENT_REPORT_TYPES)[number];
export const COMPONENT_REPORT_TYPE_LABEL: Record<ComponentReportType, string> = {
  unmodified: 'Unmodified opinion',
  unmodified_emphasis: 'Unmodified — Emphasis of Matter / Other Matter',
  qualified: 'Qualified opinion',
  adverse: 'Adverse opinion',
  disclaimer: 'Disclaimer of opinion',
  review_report: 'Review report',
  special_purpose: 'Special purpose report',
  not_issued: 'Not yet issued',
};
/** Report types that are a modified opinion (feed GA-04 and the findings register). */
export const MODIFIED_REPORT_TYPES: readonly ComponentReportType[] = [
  'qualified',
  'adverse',
  'disclaimer',
];

// ── §13 SA 600 ───────────────────────────────────────────────────────────────

/** GA-01 — DHVAJ's own participation sufficient to act as principal auditor. */
export const GA01_ANSWERS = ['yes', 'further_assessment'] as const;
export type Ga01Answer = (typeof GA01_ANSWERS)[number];
export const GA01_ANSWER_LABEL: Record<Ga01Answer, string> = {
  yes: 'Yes',
  further_assessment: 'Further Assessment Required',
};
/** GA-02 — the other auditor's professional competence considered. */
export const GA02_ANSWERS = ['yes', 'no', 'not_applicable', 'pending'] as const;
export type Ga02Answer = (typeof GA02_ANSWERS)[number];
/** GA-03 — group requirements / instructions communicated. GA-04 — sufficient evidence. */
export const GA_YES_NO_PENDING = ['yes', 'no', 'pending'] as const;
export type GaYesNoPending = (typeof GA_YES_NO_PENDING)[number];
export const GA_ANSWER_LABEL: Record<Ga02Answer, string> = {
  yes: 'Yes',
  no: 'No',
  not_applicable: 'N/A',
  pending: 'Pending',
};

export const SA600_QUESTION = {
  ga01: 'ga_01',
  ga02: 'ga_02',
  ga03: 'ga_03',
  ga04: 'ga_04',
} as const;
export type Sa600Question = (typeof SA600_QUESTION)[keyof typeof SA600_QUESTION];
export const SA600_QUESTION_TEXT: Record<Sa600Question, string> = {
  ga_01: "Is DHVAJ's own participation sufficient to enable it to act as principal auditor?",
  ga_02: 'Has the professional competence of the other auditor been considered where required?',
  ga_03: 'Have relevant group requirements / instructions been communicated to the other auditor?',
  ga_04:
    "Has sufficient appropriate evidence been obtained that the other auditor's work is adequate for DHVAJ's purposes?",
};

/** GA-02..GA-04 answered for one other auditor (component or branch). */
export interface Sa600Answers {
  ga02: Ga02Answer;
  ga02Basis: string | null;
  ga03: GaYesNoPending;
  ga03Note: string | null;
  ga04: GaYesNoPending;
  ga04Basis: string | null;
}

// ── §15 reporting package ────────────────────────────────────────────────────

export const PACKAGE_DOCUMENT_KEYS = [
  'component_tb',
  'financial_statements',
  'audit_report',
  'completion_memo',
  'misstatement_summary',
  'related_party',
  'intercompany_confirmation',
  'icfr_report',
  'caro_report',
  'other_findings',
] as const;
export type PackageDocumentKey = (typeof PACKAGE_DOCUMENT_KEYS)[number];
export const PACKAGE_DOCUMENT_LABEL: Record<PackageDocumentKey, string> = {
  component_tb: 'Component trial balance',
  financial_statements: 'Financial statements / reporting package',
  audit_report: 'Audit report',
  completion_memo: 'Component auditor completion memorandum / communication',
  misstatement_summary: 'Misstatement summary',
  related_party: 'Related-party information',
  intercompany_confirmation: 'Inter-company balance / transaction confirmation',
  icfr_report: 'ICFR report (where relevant)',
  caro_report: 'CARO report (where relevant)',
  other_findings: 'Other significant findings',
};

export const PACKAGE_DOCUMENT_STATUSES = [
  'pending',
  'received',
  'approved',
  'not_applicable',
] as const;
export type PackageDocumentStatus = (typeof PACKAGE_DOCUMENT_STATUSES)[number];
export const PACKAGE_DOCUMENT_STATUS_LABEL: Record<PackageDocumentStatus, string> = {
  pending: 'Pending',
  received: 'Received',
  approved: 'Approved',
  not_applicable: 'N/A',
};

/** A SharePoint-backed file linked in the group-audit framework. */
export interface GroupAuditFile {
  /** The link row id (Version History reads `/group-audit/files/:id/versions`). */
  id: string;
  documentId: string;
  title: string;
  filename: string | null;
  versionNo: number;
  inSharePoint: boolean;
  linkedByName: string | null;
  linkedAt: string;
  /** How it arrived: uploaded, linked from the engagement, or generated from a template. */
  how: 'added' | 'linked' | 'generated';
}

export interface PackageDocument {
  key: PackageDocumentKey;
  label: string;
  /** Not relevant for this component (e.g. CARO for a foreign component) — shown greyed. */
  relevant: boolean;
  status: PackageDocumentStatus;
  file: GroupAuditFile | null;
  /** Earlier files replaced after approval (kept, never silently overwritten). */
  superseded: GroupAuditFile[];
  approvedByName: string | null;
  approvedAt: string | null;
  note: string | null;
}

// ── §16 findings ─────────────────────────────────────────────────────────────

export const FINDING_CATEGORIES = [
  'no_significant_matter',
  'modified_opinion',
  'emphasis_other_matter',
  'material_misstatement',
  'going_concern',
  'control_deficiency',
  'fraud',
  'other_significant',
] as const;
export type GroupFindingCategory = (typeof FINDING_CATEGORIES)[number];
export const FINDING_CATEGORY_LABEL: Record<GroupFindingCategory, string> = {
  no_significant_matter: 'No significant matter',
  modified_opinion: 'Modified opinion',
  emphasis_other_matter: 'Emphasis / Other Matter',
  material_misstatement: 'Material misstatement',
  going_concern: 'Going concern',
  control_deficiency: 'Control deficiency / material weakness',
  fraud: 'Fraud / suspected fraud',
  other_significant: 'Other significant matter',
};

export const FINDING_IMPACTS = [
  'no_impact',
  'additional_procedures',
  'group_reporting_impact',
  'partner_attention',
  'assess_group_relevance',
  'consolidation_adjustment',
  'additional_work',
  'group_going_concern',
  'icfr_group_risk_cross_reference',
  'escalation_audit_response',
  'document_professional_conclusion',
] as const;
export type GroupFindingImpact = (typeof FINDING_IMPACTS)[number];
export const FINDING_IMPACT_LABEL: Record<GroupFindingImpact, string> = {
  no_impact: 'No impact',
  additional_procedures: 'Additional procedures',
  group_reporting_impact: 'Group reporting impact',
  partner_attention: 'Partner attention',
  assess_group_relevance: 'Assess group relevance',
  consolidation_adjustment: 'Consolidation adjustment',
  additional_work: 'Additional work',
  group_going_concern: 'Group going-concern assessment',
  icfr_group_risk_cross_reference: 'ICFR / group risk cross-reference',
  escalation_audit_response: 'Escalation and audit response',
  document_professional_conclusion: 'Document professional conclusion',
};
/** The impact choices each category allows (spec §16). */
export const FINDING_IMPACT_CHOICES: Record<GroupFindingCategory, readonly GroupFindingImpact[]> = {
  no_significant_matter: ['no_impact'],
  modified_opinion: ['additional_procedures', 'group_reporting_impact', 'partner_attention'],
  emphasis_other_matter: ['assess_group_relevance'],
  material_misstatement: ['consolidation_adjustment', 'additional_work'],
  going_concern: ['group_going_concern'],
  control_deficiency: ['icfr_group_risk_cross_reference'],
  fraud: ['escalation_audit_response'],
  other_significant: ['document_professional_conclusion'],
};
/** Categories that are significant to the group: unresolved, they block completion. */
export const BLOCKING_FINDING_CATEGORIES: readonly GroupFindingCategory[] = [
  'modified_opinion',
  'material_misstatement',
  'going_concern',
  'control_deficiency',
  'fraud',
  'other_significant',
];

export const FINDING_STATUSES = ['open', 'resolved'] as const;
export type GroupFindingStatus = (typeof FINDING_STATUSES)[number];

export interface GroupAuditFinding {
  id: string;
  seq: number;
  /** GF-001 … */
  ref: string;
  subjectKind: 'component' | 'branch';
  /** The matrix row or branch record id. */
  subjectId: string;
  subjectName: string;
  category: GroupFindingCategory;
  impacts: GroupFindingImpact[];
  description: string;
  /** Control deficiency → the 02.5 ICFR cross-reference (deficiency ref / note). */
  icfrCrossRef: string | null;
  /** Fraud → escalated to the Engagement Partner. */
  escalated: boolean;
  /** Section 07 / 08 consideration (modified opinion, misstatement, fraud …). */
  reportingConsideration: boolean;
  status: GroupFindingStatus;
  /** The principal auditor's response / professional conclusion. */
  response: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  /** Carried from last year's unresolved finding (spec §21) — a follow-up, not a conclusion. */
  priorYearRef: string | null;
  withdrawn: boolean;
  version: number;
}

// ── §12 / §13 / §14 / §15 component row ──────────────────────────────────────

export interface GroupAuditComponent {
  id: string;
  /** The stable 02.6 perimeter component id. */
  componentId: string;
  componentName: string;
  relationship: InvesteeRelationship;
  method: ConsolidationMethod;
  included: PerimeterInclusion;
  /** The component's country (02.6 perimeter). */
  country: string | null;
  isIndianCompany: boolean | null;
  auditorType: ComponentAuditorType;
  auditorSource: GroupAuditValueSource;
  /** What the system suggests (relationship record / prior year), for the badge. */
  suggestedAuditorType: ComponentAuditorType;
  suggestedBasis: string;
  firmName: string | null;
  /** FRN / ICAI membership / foreign professional body registration. */
  frn: string | null;
  professionalBody: string | null;
  auditorCountry: string | null;
  partnerContact: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  reportType: ComponentReportType | null;
  reportDate: string | null;
  /** The group reporting deadline given to the component auditor (instructions). */
  reportingDeadline: string | null;
  sa600: Sa600Consideration;
  sa600Source: 'system' | 'team';
  significance: ComponentSignificance;
  significanceNote: string | null;
  answers: Sa600Answers;
  /** SharePoint: the component audit report and the completion memorandum. */
  report: GroupAuditFile | null;
  completionMemo: GroupAuditFile | null;
  /** Component Auditor Instructions generated from the Word template (§14). */
  instructions: GroupAuditFile | null;
  /** Package checklist — present for another auditor / unaudited components. */
  package: PackageDocument[];
  openFindings: number;
  /** What keeps this row from being complete (empty = complete). */
  missing: string[];
  priorYear: {
    auditorType: ComponentAuditorType | null;
    firmName: string | null;
    reportType: ComponentReportType | null;
  } | null;
  /** The auditor differs from last year — reassess SA 600 and instructions (spec §21). */
  auditorChanged: boolean;
  /** The component left the perimeter — kept for the record. */
  withdrawn: boolean;
  version: number;
}

// ── §17 branches ─────────────────────────────────────────────────────────────

export const BR01_ANSWERS = ['yes', 'no', 'pending'] as const;
export type Br01Answer = (typeof BR01_ANSWERS)[number];
export const BR01_ANSWER_LABEL: Record<Br01Answer, string> = {
  yes: 'Yes',
  no: 'No',
  pending: 'Pending',
};
export const BR01_QUESTION =
  'Does the company have a branch whose accounts are audited by another auditor?';

export const BRANCH_APPOINTMENT_BASES = [
  'section_139_general_meeting',
  'board_authorised',
  'foreign_branch_local_law',
  'other',
] as const;
export type BranchAppointmentBasis = (typeof BRANCH_APPOINTMENT_BASES)[number];
export const BRANCH_APPOINTMENT_BASIS_LABEL: Record<BranchAppointmentBasis, string> = {
  section_139_general_meeting: 'Appointed under section 139 / general meeting (section 143(8))',
  board_authorised: 'Board authorised by the general meeting (section 143(8))',
  foreign_branch_local_law: 'Foreign branch — accountant qualified under local law',
  other: 'Other (record in the note)',
};

export const BRANCH_CONCLUSIONS = [
  'pending',
  'relied',
  'relied_with_procedures',
  'not_relied',
] as const;
export type BranchConclusion = (typeof BRANCH_CONCLUSIONS)[number];
export const BRANCH_CONCLUSION_LABEL: Record<BranchConclusion, string> = {
  pending: 'Pending',
  relied: "Branch auditor's report relied on",
  relied_with_procedures: 'Relied on with additional procedures',
  not_relied: 'Not relied on — further work / reporting impact',
};

export interface GroupAuditBranch {
  id: string;
  branchName: string;
  location: string | null;
  country: string | null;
  firmName: string | null;
  frn: string | null;
  partnerContact: string | null;
  appointmentBasis: BranchAppointmentBasis | null;
  appointmentNote: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** Instructions / materiality communicated (SharePoint). */
  instructions: GroupAuditFile | null;
  /** The branch auditor's report sent to the company's auditor (section 143(8)). */
  report: GroupAuditFile | null;
  answers: Sa600Answers;
  significance: ComponentSignificance;
  /** The principal auditor's response — how the branch report is dealt with. */
  principalResponse: string | null;
  conclusion: BranchConclusion;
  openFindings: number;
  missing: string[];
  /** Carried from last year's branch record (spec §21). */
  fromPriorYear: boolean;
  withdrawn: boolean;
  version: number;
}

// ── §19 work programme ───────────────────────────────────────────────────────

/** When a library item applies (facts from the 02.6 perimeter). */
export const WORK_ITEM_ACTIVATIONS = [
  'always',
  'subsidiary',
  'associate_jv',
  'foreign',
  'conversion',
  'other_auditor',
] as const;
export type WorkItemActivation = (typeof WORK_ITEM_ACTIVATIONS)[number];

export interface ConsolidationWorkLibraryItem {
  id: string;
  frameworkCode: string;
  frameworkLabel: string;
  itemKey: string;
  title: string;
  objective: string;
  evidence: string;
  activation: WorkItemActivation;
  sortOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ConsolidationWorkItem {
  id: string;
  itemKey: string;
  title: string;
  objective: string;
  evidence: string;
  activation: WorkItemActivation;
  /** The facts make it relevant; else marked N/A with the system's reason. */
  applicable: boolean;
  basis: string;
  /** The Section 06 procedure it generated (linked once Section 06 suggests it). */
  procedureId: string | null;
  procedureRef: string | null;
  procedureStatus: string | null;
  withdrawn: boolean;
}

export const GROUP_WORK_PROGRAMME_STATE = {
  /** 02.6 has not decided whether CFS is required. */
  awaiting: 'awaiting',
  active: 'active',
  /** CFS not required — no programme (or the earlier one withdrawn). */
  notRequired: 'not_required',
  withdrawn: 'withdrawn',
} as const;
export type GroupWorkProgrammeState =
  (typeof GROUP_WORK_PROGRAMME_STATE)[keyof typeof GROUP_WORK_PROGRAMME_STATE];

export interface ConsolidationWorkProgramme {
  workflowInstanceId: string;
  engagementId: string;
  state: GroupWorkProgrammeState;
  reason: string;
  frameworkLabel: string | null;
  generatedAt: string | null;
  items: ConsolidationWorkItem[];
  /** Applicable items with a Section 06 procedure. */
  linked: number;
  readOnly: boolean;
}

// ── The group-audit view ─────────────────────────────────────────────────────

export const GROUP_MATRIX_STATE = {
  /** 02.6 has not decided whether CFS is required. */
  awaiting: 'awaiting',
  active: 'active',
  notRequired: 'not_required',
} as const;
export type GroupMatrixState = (typeof GROUP_MATRIX_STATE)[keyof typeof GROUP_MATRIX_STATE];

export interface StatutoryAuditGroupAudit {
  workflowInstanceId: string;
  engagementId: string;
  /** The component matrix exists while CFS is required. */
  matrixState: GroupMatrixState;
  matrixReason: string;
  consolidationOutcome: ConsolidationOutcome | null;
  cfsRequired: boolean | null;
  /** Audit period start — references resolve to the version in force. */
  periodStart: string;
  /** GA-01, answered once for the group. */
  ga01: Ga01Answer | null;
  ga01Basis: string | null;
  ga01Source: 'system' | 'team' | null;
  ga01Suggested: Ga01Answer | null;
  ga01SuggestedBasis: string;
  components: GroupAuditComponent[];
  /** BR-01 (spec §17). */
  br01: Br01Answer;
  br01Source: 'system' | 'team';
  br01Basis: string;
  branches: GroupAuditBranch[];
  findings: GroupAuditFinding[];
  status: GroupAuditStatus;
  /** Materiality is not set here (spec §18). */
  materialityNote: string;
  /** Section 03.3 materiality approved — amounts can go into the instructions. */
  materialityApproved: boolean;
  version: number;
  readOnly: boolean;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface UpdateGroupAuditInput {
  ga01?: Ga01Answer | null;
  ga01Basis?: string | null;
  br01?: Br01Answer;
  br01Basis?: string | null;
  version: number;
}

export interface UpdateGroupAuditComponentInput {
  auditorType?: ComponentAuditorType;
  firmName?: string | null;
  frn?: string | null;
  professionalBody?: string | null;
  auditorCountry?: string | null;
  partnerContact?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  reportType?: ComponentReportType | null;
  reportDate?: string | null;
  reportingDeadline?: string | null;
  sa600?: Sa600Consideration;
  significance?: ComponentSignificance;
  significanceNote?: string | null;
  ga02?: Ga02Answer;
  ga02Basis?: string | null;
  ga03?: GaYesNoPending;
  ga03Note?: string | null;
  ga04?: GaYesNoPending;
  ga04Basis?: string | null;
  version: number;
}

/** The SharePoint slot a file goes into. */
export const GROUP_AUDIT_FILE_SLOTS = [
  'report',
  'completion_memo',
  'instructions',
  'package',
  'branch_report',
  'branch_instructions',
] as const;
export type GroupAuditFileSlot = (typeof GROUP_AUDIT_FILE_SLOTS)[number];

interface FileTarget {
  slot: GroupAuditFileSlot;
  /** Matrix row (component slots) or branch record (branch slots). */
  ownerId: string;
  /** Required for the 'package' slot. */
  packageKey?: PackageDocumentKey | null;
  /** Replacing an APPROVED package document needs a reason (never silent). */
  replaceReason?: string | null;
}
export interface AddGroupAuditFileInput extends FileTarget {
  filename: string;
  contentType?: string;
  contentBase64: string;
  title?: string | null;
}
export interface LinkGroupAuditFileInput extends FileTarget {
  documentId: string;
}

export interface UpdatePackageDocumentInput {
  status: PackageDocumentStatus;
  note?: string | null;
}

export interface CreateGroupAuditFindingInput {
  subjectKind: 'component' | 'branch';
  subjectId: string;
  category: GroupFindingCategory;
  impacts: GroupFindingImpact[];
  description: string;
  icfrCrossRef?: string | null;
  reportingConsideration?: boolean;
}
export interface UpdateGroupAuditFindingInput {
  category?: GroupFindingCategory;
  impacts?: GroupFindingImpact[];
  description?: string;
  icfrCrossRef?: string | null;
  escalated?: boolean;
  reportingConsideration?: boolean;
  status?: GroupFindingStatus;
  response?: string | null;
  withdrawn?: boolean;
  version: number;
}

export interface CreateGroupAuditBranchInput {
  branchName: string;
  location?: string | null;
  country?: string | null;
}
export interface UpdateGroupAuditBranchInput {
  branchName?: string;
  location?: string | null;
  country?: string | null;
  firmName?: string | null;
  frn?: string | null;
  partnerContact?: string | null;
  appointmentBasis?: BranchAppointmentBasis | null;
  appointmentNote?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  significance?: ComponentSignificance;
  ga02?: Ga02Answer;
  ga02Basis?: string | null;
  ga03?: GaYesNoPending;
  ga03Note?: string | null;
  ga04?: GaYesNoPending;
  ga04Basis?: string | null;
  principalResponse?: string | null;
  conclusion?: BranchConclusion;
  withdrawn?: boolean;
  version: number;
}

export interface CreateComponentInstructionsInput {
  /** Template variant (default: the one the engagement selects). */
  variantKey?: string;
}
export interface ComponentInstructionsCreated {
  groupAudit: StatutoryAuditGroupAudit;
  documentId: string;
  /** Open in Microsoft 365 (AutoSave) when the tenant is connected. */
  editorUrl: string | null;
  missingFields: string[];
}

/** Every 02.6 auditor-matrix value for another module (02.4 3(xxi), 02.5 consolidated). */
export interface ComponentAuditorFeed {
  componentId: string;
  componentName: string;
  auditorType: ComponentAuditorType;
  /** "DHVAJ" or the other firm's name. */
  auditorName: string | null;
  reportDocumentId: string | null;
  reportType: ComponentReportType | null;
}
