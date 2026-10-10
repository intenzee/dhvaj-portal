/**
 * 02.7 Track B — the records behind the statutory reporting configurator
 * (DHVAJ 02.7 spec v1.0; build split docs/02-7-other-reporting-build-split.md):
 *
 *   • Section 143(12) Fraud Matter records (spec §14) — ONE central record per
 *     fraud / suspected fraud, raisable from anywhere in the audit, with the
 *     Rule 13 deadline engine computed from the legally relevant event dates
 *     (knowledge, report to the Board / Audit Committee, reply received) — never
 *     the engagement creation date. Every ₹ threshold and day count resolves
 *     from the Rules Library by the audit period.
 *   • Section 164(2) director workpaper (spec §12) — one row per director, filled
 *     from the contacts master, with the evidence and the legal analysis (no
 *     DIN-status shortcut).
 *   • Cross-references to 02.4 CARO, 02.5 ICFR and 02.6 group / branch reporting
 *     (spec §15, §17) — read from the source modules, never a second register.
 *   • Per-card evidence links (spec §16 "View Evidence").
 *
 * Track A's names (cards, status types, provision / rule codes) are imported
 * from statutory-audit-other-reporting.ts and never re-exported here.
 */

import type {
  DirectorDisqualificationStatus,
  FraudFrameworkStatus,
  ReportingCardKey,
  ReportingCrossRefs,
  ReportingEvidenceCounts,
  Tri,
} from './statutory-audit-other-reporting';

// ── §14 Fraud Matter ────────────────────────────────────────────────────────

/** Where a fraud / suspected fraud came to the team's notice (spec §14 "source"). */
export const FRAUD_SOURCE = {
  auditProcedure: 'audit_procedure',
  riskAssessment: 'risk_assessment',
  componentOrBranchAuditor: 'component_or_branch_auditor',
  management: 'management',
  whistleblower: 'whistleblower',
  internalAudit: 'internal_audit',
  regulator: 'regulator',
  other: 'other',
} as const;
export type FraudSource = (typeof FRAUD_SOURCE)[keyof typeof FRAUD_SOURCE];
export const FRAUD_SOURCES: FraudSource[] = Object.values(FRAUD_SOURCE);
export const FRAUD_SOURCE_LABEL: Record<FraudSource, string> = {
  audit_procedure: 'Audit procedure (Section 06)',
  risk_assessment: 'Risk assessment (Section 04)',
  component_or_branch_auditor: 'Component / branch auditor (02.6)',
  management: 'Management / TCWG',
  whistleblower: 'Whistle-blower / complaint',
  internal_audit: 'Internal audit',
  regulator: 'Regulator / investigating agency',
  other: 'Other',
};

/** Who is involved — Section 143(12) covers fraud against the company by its officers or employees. */
export const FRAUD_PERPETRATOR = {
  officers: 'officers',
  employees: 'employees',
  officersAndEmployees: 'officers_and_employees',
  otherParties: 'other_parties',
  unknown: 'unknown',
} as const;
export type FraudPerpetrator = (typeof FRAUD_PERPETRATOR)[keyof typeof FRAUD_PERPETRATOR];
export const FRAUD_PERPETRATORS: FraudPerpetrator[] = Object.values(FRAUD_PERPETRATOR);
export const FRAUD_PERPETRATOR_LABEL: Record<FraudPerpetrator, string> = {
  officers: 'Officers',
  employees: 'Employees',
  officers_and_employees: 'Officers and employees',
  other_parties: 'Other parties only',
  unknown: 'Not yet known',
};

/** Rule 13 reporting route for one matter (`pending` until an amount / estimate exists). */
export const FRAUD_MATTER_ROUTE = {
  centralGovernment: 'central_government',
  auditCommitteeBoard: 'audit_committee_board',
  pending: 'pending',
} as const;
export type FraudMatterRoute = (typeof FRAUD_MATTER_ROUTE)[keyof typeof FRAUD_MATTER_ROUTE];
export const FRAUD_MATTER_ROUTE_LABEL: Record<FraudMatterRoute, string> = {
  central_government: 'Central Government (Rule 13(1)–(2), Form ADT-4)',
  audit_committee_board: 'Audit Committee / Board (Rule 13(3))',
  pending: 'Pending — amount or estimate not yet recorded',
};

/** The matter's regulatory status, derived from the recorded event dates. */
export const FRAUD_REGULATORY_STATUS = {
  identified: 'identified',
  reportedToBoard: 'reported_to_board',
  awaitingReply: 'awaiting_reply',
  replyReceived: 'reply_received',
  noReply: 'no_reply',
  forwardedToCg: 'forwarded_to_cg',
  closed: 'closed',
} as const;
export type FraudRegulatoryStatus =
  (typeof FRAUD_REGULATORY_STATUS)[keyof typeof FRAUD_REGULATORY_STATUS];
export const FRAUD_REGULATORY_STATUS_LABEL: Record<FraudRegulatoryStatus, string> = {
  identified: 'Identified — not yet reported to the Board / Audit Committee',
  reported_to_board: 'Reported to the Audit Committee / Board',
  awaiting_reply: 'Reported — awaiting the reply / observations',
  reply_received: 'Reply received — forward to the Central Government',
  no_reply: 'No reply in the response period — forward with the Rule 13 note',
  forwarded_to_cg: 'Forwarded to the Central Government',
  closed: 'Concluded',
};

/** The final conclusion on a matter (spec §14 "final conclusion"). */
export const FRAUD_CONCLUSION = {
  pending: 'pending',
  reportedCentralGovernment: 'reported_central_government',
  reportedAuditCommitteeBoard: 'reported_audit_committee_board',
  notReportable: 'not_reportable',
} as const;
export type FraudConclusion = (typeof FRAUD_CONCLUSION)[keyof typeof FRAUD_CONCLUSION];
export const FRAUD_CONCLUSIONS: FraudConclusion[] = Object.values(FRAUD_CONCLUSION);
export const FRAUD_CONCLUSION_LABEL: Record<FraudConclusion, string> = {
  pending: 'Pending',
  reported_central_government: 'Reported to the Central Government under Section 143(12)',
  reported_audit_committee_board: 'Reported to the Audit Committee / Board (below the threshold)',
  not_reportable: 'Not reportable under Section 143(12) (basis recorded)',
};

/** One statutory step of the Rule 13 deadline engine. */
export const FRAUD_DEADLINE_KEY = {
  initialNotice: 'initial_notice',
  replyDue: 'reply_due',
  cgForward: 'cg_forward',
  cgForwardNoReply: 'cg_forward_no_reply',
} as const;
export type FraudDeadlineKey = (typeof FRAUD_DEADLINE_KEY)[keyof typeof FRAUD_DEADLINE_KEY];

export interface FraudDeadline {
  key: FraudDeadlineKey;
  label: string;
  /** The event the period runs from, e.g. "date knowledge obtained". */
  fromEvent: string;
  fromDate: string;
  /** Statutory period in days (Rules Library) — 0 for "forward now". */
  days: number;
  dueDate: string;
  /** The date the step was done (null = not yet). */
  metOn: string | null;
  /** met / met_late / due / overdue. */
  status: 'met' | 'met_late' | 'due' | 'overdue';
  /** The route is assumed (amount not yet determined). */
  provisional: boolean;
  ruleCode: string;
}

/** The Rules Library values the fraud framework used for the audit period. */
export interface FraudRules {
  thresholdAmount: number | null;
  initialNoticeDays: number | null;
  responseDays: number | null;
  forwardDays: number | null;
  /** Per rule: the code, the version in force and its effective date. */
  used: Array<{
    code: string;
    label: string;
    value: number | null;
    unit: string;
    effectiveFrom: string | null;
    ruleVersionId: string | null;
  }>;
}

export interface FraudMatter {
  id: string;
  /** Display code, FM-001. */
  ref: string;
  nature: string;
  description: string | null;
  /** Amount involved or expected to be involved (₹). */
  amount: number | null;
  /** The amount is an estimate (spec §14 "amount / estimated amount"). */
  amountEstimated: boolean;
  perpetrator: FraudPerpetrator;
  partiesInvolved: string | null;
  /** The legally relevant date: when the auditor obtained knowledge (Rule 13). */
  knowledgeDate: string | null;
  source: FraudSource;
  sourceRef: string | null;
  /** Section 06 procedure the matter was raised from, when any. */
  procedureId: string | null;
  procedureRef: string | null;
  auditProcedures: string | null;
  tcwgCommunication: string | null;
  /** Reported to the Board / Audit Committee on. */
  boardReportedOn: string | null;
  /** Reply / observations of the Board / Audit Committee received on. */
  replyReceivedOn: string | null;
  /** Forwarded to the Central Government on (Form ADT-4). */
  cgForwardedOn: string | null;
  /** ADT-4 / SRN / acknowledgement reference. */
  adt4Reference: string | null;
  regulatoryNote: string | null;
  // derived
  route: FraudMatterRoute;
  routeBasis: string;
  regulatoryStatus: FraudRegulatoryStatus;
  deadlines: FraudDeadline[];
  overdue: boolean;
  nextDeadline: string | null;
  // partner consultation
  partnerConsultedByName: string | null;
  partnerConsultedAt: string | null;
  partnerNote: string | null;
  conclusion: FraudConclusion;
  conclusionNote: string | null;
  /** Moved from the earlier single-fraud 02.7 facts (confirm the dates). */
  fromLegacy: boolean;
  evidenceCount: number;
  withdrawn: boolean;
  createdByName: string | null;
  createdAt: string;
  version: number;
}

/** A possible matter already recorded elsewhere in the file (raise it here once). */
export interface FraudMatterCandidate {
  source: FraudSource;
  sourceRef: string;
  label: string;
  description: string;
}

export interface CreateFraudMatterInput {
  nature: string;
  description?: string | null;
  amount?: number | null;
  amountEstimated?: boolean;
  perpetrator?: FraudPerpetrator;
  partiesInvolved?: string | null;
  knowledgeDate?: string | null;
  source?: FraudSource;
  sourceRef?: string | null;
  procedureId?: string | null;
}

export interface UpdateFraudMatterInput {
  nature?: string;
  description?: string | null;
  amount?: number | null;
  amountEstimated?: boolean;
  perpetrator?: FraudPerpetrator;
  partiesInvolved?: string | null;
  knowledgeDate?: string | null;
  source?: FraudSource;
  sourceRef?: string | null;
  procedureId?: string | null;
  auditProcedures?: string | null;
  tcwgCommunication?: string | null;
  boardReportedOn?: string | null;
  replyReceivedOn?: string | null;
  cgForwardedOn?: string | null;
  adt4Reference?: string | null;
  regulatoryNote?: string | null;
  conclusion?: FraudConclusion;
  conclusionNote?: string | null;
  withdrawn?: boolean;
  version: number;
}

/** The Engagement Partner records the consultation (spec §14 "Partner consultation"). */
export interface RecordFraudConsultationInput {
  note: string;
  version: number;
}

// ── §12 Section 164(2) director workpaper ───────────────────────────────────

export const DIRECTOR_SOURCE = {
  contacts: 'contacts',
  team: 'team',
} as const;
export type DirectorSource = (typeof DIRECTOR_SOURCE)[keyof typeof DIRECTOR_SOURCE];

export interface DirectorCheck {
  id: string;
  name: string;
  din: string | null;
  designation: string | null;
  appointedOn: string | null;
  ceasedOn: string | null;
  /** Relevant directorship information (other companies, filing defaults…). */
  directorshipInfo: string | null;
  /** Management representation reference (and linked documents). */
  representationRef: string | null;
  /** MCA / statutory evidence (DIR-8, MCA master data) reference. */
  mcaSource: string | null;
  disqualified: Tri;
  /** Section 164(2) legal analysis — required for a Yes / No (no DIN-status shortcut). */
  legalAnalysis: string | null;
  auditorConclusion: string | null;
  source: DirectorSource;
  /** The contacts-master row it came from. */
  contactId: string | null;
  /** Evidence links by purpose. */
  evidenceCount: number;
  representationLinks: number;
  mcaLinks: number;
  withdrawn: boolean;
  version: number;
}

export interface AddDirectorCheckInput {
  name: string;
  din?: string | null;
  designation?: string | null;
}

export interface UpdateDirectorCheckInput {
  name?: string;
  din?: string | null;
  designation?: string | null;
  appointedOn?: string | null;
  ceasedOn?: string | null;
  directorshipInfo?: string | null;
  representationRef?: string | null;
  mcaSource?: string | null;
  disqualified?: Tri;
  legalAnalysis?: string | null;
  auditorConclusion?: string | null;
  withdrawn?: boolean;
  version: number;
}

// ── §15 / §17 cross-references (deep links into the source workspaces) ─────

export interface ReportingCrossRefLink {
  key: 'caro' | 'icfr' | 'group';
  label: string;
  /** Sub-section key of the source workspace (02.4 / 02.5 / 02.6). */
  subSectionKey: string;
  /** The §17 final conclusion stage. */
  finalStage: string;
  /** Plain status lines read from the source (never copied conclusions). */
  lines: string[];
  /** The source needs attention before reporting. */
  attention: boolean;
}

// ── §16 per-card evidence ───────────────────────────────────────────────────

/** Why a document is linked (the director workpaper links representations / MCA records). */
export const REPORTING_EVIDENCE_KIND = {
  evidence: 'evidence',
  managementRepresentation: 'management_representation',
  mcaRecord: 'mca_record',
} as const;
export type ReportingEvidenceKind =
  (typeof REPORTING_EVIDENCE_KIND)[keyof typeof REPORTING_EVIDENCE_KIND];
export const REPORTING_EVIDENCE_KINDS: ReportingEvidenceKind[] =
  Object.values(REPORTING_EVIDENCE_KIND);
export const REPORTING_EVIDENCE_KIND_LABEL: Record<ReportingEvidenceKind, string> = {
  evidence: 'Evidence',
  management_representation: 'Management representation',
  mca_record: 'MCA / statutory record',
};

export interface ReportingEvidenceLink {
  id: string;
  cardKey: ReportingCardKey;
  kind: ReportingEvidenceKind;
  fraudMatterId: string | null;
  directorId: string | null;
  documentId: string | null;
  auditEvidenceId: string | null;
  title: string;
  filename: string | null;
  inSharePoint: boolean;
  note: string | null;
  linkedByName: string | null;
  linkedAt: string;
}

export interface LinkReportingEvidenceInput {
  cardKey: ReportingCardKey;
  documentId?: string;
  auditEvidenceId?: string;
  fraudMatterId?: string | null;
  directorId?: string | null;
  kind?: ReportingEvidenceKind;
  note?: string | null;
}

// ── Read shape ──────────────────────────────────────────────────────────────

/** Track B's 02.7 records for one statutory-audit workflow instance. */
export interface StatutoryAuditReportingRecords {
  workflowInstanceId: string;
  engagementId: string;
  /** The audit period start the Rules Library resolved against. */
  periodStart: string;
  canManage: boolean;
  viewerIsPartner: boolean;
  fraud: {
    status: FraudFrameworkStatus;
    rules: FraudRules;
    matters: FraudMatter[];
    candidates: FraudMatterCandidate[];
  };
  directors: {
    status: DirectorDisqualificationStatus;
    rows: DirectorCheck[];
    /** Directors on the contacts master not yet on the workpaper. */
    contactsAvailable: number;
  };
  crossRefs: ReportingCrossRefs;
  crossRefLinks: ReportingCrossRefLink[];
  evidence: {
    counts: ReportingEvidenceCounts;
    links: ReportingEvidenceLink[];
  };
}

/** What Section 07 / 08 read from 02.7 (completion-automation `rule_11_143`). */
export interface OtherReportingCompletionSummary {
  decided: boolean;
  /** Cards with a reporting obligation (applicable / conditional). */
  cards: Array<{
    key: ReportingCardKey;
    requirement: string;
    clause: string;
    workStatus: string;
    reportingStatus: string;
  }>;
  fraud: FraudFrameworkStatus;
  directors: DirectorDisqualificationStatus;
  /** Rule 11(e) representations to carry into the Management Representation Letter. */
  mrlRepresentations: Array<{
    key: 'rule_11_e_i' | 'rule_11_e_ii';
    label: string;
    obtained: Tri;
  }>;
}
