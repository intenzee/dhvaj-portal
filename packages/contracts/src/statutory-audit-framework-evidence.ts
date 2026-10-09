/**
 * Section 02 evidence, the 02.2 technical memo and the 02.2 downstream actions
 * (DHVAJ 02.2 spec §7, §18, §19).
 *
 * Evidence: the files behind one Section 02 sub-assessment — engagement
 * documents (SharePoint-backed when Microsoft 365 is on) added or linked, never
 * copied — keyed by the sub-assessment so 02.3–02.7 reuse the same table and
 * routes. The technical memo is created only for complex cases, overrides or
 * consultations, from the firm's Word template with the assessment facts
 * merged in.
 *
 * Downstream: what the approved 02.2 conclusion activates in 02.3 and the
 * audit work (Ind AS / AS review framework, Division routing, SMC
 * relaxations, Ind AS 101 transition work).
 */

// ── Evidence + technical memo (§7, §18) ──────────────────────────────────────

export const FRAMEWORK_FILE_KIND = {
  evidence: 'evidence',
  technicalMemo: 'technical_memo',
} as const;
export type FrameworkFileKind = (typeof FRAMEWORK_FILE_KIND)[keyof typeof FRAMEWORK_FILE_KIND];

export const FRAMEWORK_FILE_KIND_LABEL: Record<FrameworkFileKind, string> = {
  evidence: 'Evidence',
  technical_memo: 'Technical memo',
};

/**
 * Checklist questions that carry their own evidence (02.2 §6, §7): FRF-02 the
 * prior Ind AS financial statements, FRF-03 the voluntary-adoption evidence.
 */
export const FRAMEWORK_EVIDENCE_QUESTION = {
  frf02: 'frf_02',
  frf03: 'frf_03',
  /** 02.3 SCH-02 — the governing statute / regulator's format reference. */
  sch02: 'sch_02',
  /** 02.3 SCH-04 — the linked prior-year financial statements. */
  sch04: 'sch_04',
} as const;
export type FrameworkEvidenceQuestion =
  (typeof FRAMEWORK_EVIDENCE_QUESTION)[keyof typeof FRAMEWORK_EVIDENCE_QUESTION];
export const FRAMEWORK_EVIDENCE_QUESTIONS: FrameworkEvidenceQuestion[] = Object.values(
  FRAMEWORK_EVIDENCE_QUESTION,
);
export const FRAMEWORK_EVIDENCE_QUESTION_LABEL: Record<FrameworkEvidenceQuestion, string> = {
  frf_02: 'FRF-02',
  frf_03: 'FRF-03',
  sch_02: 'SCH-02',
  sch_04: 'SCH-04',
};

/** One file linked to a Section 02 sub-assessment. */
export interface FrameworkFileRecord {
  id: string;
  documentId: string;
  kind: FrameworkFileKind;
  /** The checklist question it supports; null when filed on the sub-assessment. */
  questionKey: FrameworkEvidenceQuestion | null;
  title: string;
  filename: string | null;
  currentVersionNo: number;
  lastEditedBy: string | null;
  lastSavedAt: string | null;
  linkedByName: string | null;
  linkedAt: string;
  /** Held in the engagement's SharePoint workspace (a live Microsoft 365 copy exists). */
  inSharePoint: boolean;
  /** Approved work opens read-only until reopened through its workflow. */
  editLocked: boolean;
  templateVariantKey: string | null;
  templateVersionNo: number | null;
}

/** Whether "Create Technical Memo" can run now, and why not. */
export interface FrameworkMemoAvailability {
  /** The firm has an approved Word template for the memo. */
  templateAvailable: boolean;
  /** Why the memo cannot be created right now (no template, already exists …). */
  reason: string | null;
  /** The live memo, when one has been created. */
  memoFileId: string | null;
}

/** The evidence panel of one Section 02 sub-assessment. */
export interface FrameworkEvidenceView {
  subAssessmentId: string;
  subSectionKey: string;
  workflowInstanceId: string;
  /** Section 02 is approved (or the caller cannot change the file) — read-only. */
  readOnly: boolean;
  m365Enabled: boolean;
  files: FrameworkFileRecord[];
  /** Only the 02.2 sub-assessment has a technical memo; null elsewhere. */
  memo: FrameworkMemoAvailability | null;
}

export interface AddFrameworkFileInput {
  title?: string;
  filename: string;
  contentType?: string;
  contentBase64: string;
  /** File it under a checklist question instead of the sub-assessment. */
  questionKey?: FrameworkEvidenceQuestion;
}

export interface LinkFrameworkFileInput {
  documentId: string;
  questionKey?: FrameworkEvidenceQuestion;
}

export interface CreateFrameworkMemoInput {
  /** A specific template variant; else the applicable one. */
  variantKey?: string;
}

/** The memo was created: the refreshed panel and where to open it. */
export interface FrameworkMemoCreated {
  evidence: FrameworkEvidenceView;
  fileId: string;
  documentId: string;
  /** Office for the web link when Microsoft 365 is on; null otherwise (open in the portal). */
  editorUrl: string | null;
  /** Merge fields the facts could not fill — shown as `[label]` in the memo. */
  missingFields: string[];
}

// ── Downstream actions (§19) ─────────────────────────────────────────────────

export const FRAMEWORK_DOWNSTREAM_ACTION = {
  indAsReview: 'ind_as_review',
  nbfcDivisionIii: 'nbfc_division_iii',
  asReview: 'as_review',
  smcRelaxations: 'smc_relaxations',
  indAs101Transition: 'ind_as_101_transition',
  frameworkReview: 'framework_review',
} as const;
export type FrameworkDownstreamActionKey =
  (typeof FRAMEWORK_DOWNSTREAM_ACTION)[keyof typeof FRAMEWORK_DOWNSTREAM_ACTION];
export const FRAMEWORK_DOWNSTREAM_ACTIONS: FrameworkDownstreamActionKey[] = Object.values(
  FRAMEWORK_DOWNSTREAM_ACTION,
);

/** The 02.2 facts the downstream plan reads (from the 02.2 result helper). */
export interface FrameworkDownstreamFacts {
  /** `ind_as` | `accounting_standards` | `specialised_framework` | … (02.2 outcome). */
  framework: string | null;
  isNbfc: boolean;
  /** `smc` | `non_smc` | … — only meaningful when the framework is AS. */
  smcStatus: string | null;
  firstTimeAdoption: boolean | null;
}

export type ScheduleIiiDivision = 'I' | 'II' | 'III';

/** One downstream action the conclusion calls for (pure plan, no state). */
export interface PlannedDownstreamAction {
  key: FrameworkDownstreamActionKey;
  title: string;
  detail: string;
  /** Where it lands: '02.3', 'Audit work', 'AS review methodology', '02.2'. */
  target: string;
  /** The library provision the action cites, when any. */
  provisionCode: string | null;
  /** The work area the action generates in Audit Areas, when any. */
  workAreaKey: string | null;
  /** True when 02.2 itself handles it (the blocking Framework Review matter). */
  managedBy02_2: boolean;
}

export const IND_AS_FIRST_TIME_WORK_AREA = {
  workAreaKey: 'ind_as_first_time_adoption',
  title: 'First-time Ind AS Adoption (Ind AS 101)',
  scope:
    'Ind AS 101 transition: opening Ind AS balance sheet, exceptions and exemptions applied, and the previous-GAAP reconciliations.',
  sortOrder: 2,
} as const;

/** The Schedule III Division 02.3 routes to for a framework. */
export function scheduleIiiDivisionFor(f: FrameworkDownstreamFacts): ScheduleIiiDivision | null {
  if (f.framework === 'ind_as') return f.isNbfc ? 'III' : 'II';
  if (f.framework === 'accounting_standards') return 'I';
  return null;
}

/**
 * What a 02.2 conclusion activates downstream (spec §19). Pure and
 * deterministic: the same conclusion always yields the same actions.
 */
export function planFinancialReportingDownstream(
  f: FrameworkDownstreamFacts,
): PlannedDownstreamAction[] {
  const out: PlannedDownstreamAction[] = [];
  if (f.framework === 'ind_as') {
    out.push({
      key: 'ind_as_review',
      title: 'Ind AS financial-statement review framework',
      detail: f.isNbfc
        ? '02.3 assesses Schedule III Division III; the Ind AS review framework is activated in Audit Areas.'
        : '02.3 assesses Schedule III Division II; the Ind AS review framework is activated in Audit Areas.',
      target: '02.3',
      provisionCode: f.isNbfc ? 'SCH_III_DIV_III' : 'SCH_III_DIV_II',
      workAreaKey: 'ind_as_review',
      managedBy02_2: false,
    });
    if (f.isNbfc) {
      out.push({
        key: 'nbfc_division_iii',
        title: 'NBFC presentation and reporting',
        detail:
          '02.3 considers Division III and the NBFC-specific presentation and reporting logic.',
        target: '02.3',
        provisionCode: 'SCH_III_DIV_III',
        workAreaKey: null,
        managedBy02_2: false,
      });
    }
    if (f.firstTimeAdoption === true) {
      out.push({
        key: 'ind_as_101_transition',
        title: 'First-time Ind AS adoption — Ind AS 101 transition work',
        detail:
          'Audit Areas gains the Ind AS 101 transition work (opening balance sheet, exemptions, reconciliations). No transition testing happens in 02.2.',
        target: 'Audit work',
        provisionCode: 'INDAS_101',
        workAreaKey: IND_AS_FIRST_TIME_WORK_AREA.workAreaKey,
        managedBy02_2: false,
      });
    }
  } else if (f.framework === 'accounting_standards') {
    out.push({
      key: 'as_review',
      title: 'Accounting Standards review framework',
      detail:
        '02.3 assesses Schedule III Division I (or the other applicable presentation framework); the AS review framework is activated in Audit Areas.',
      target: '02.3',
      provisionCode: 'SCH_III_DIV_I',
      workAreaKey: 'schedule_iii_work',
      managedBy02_2: false,
    });
    if (f.smcStatus === 'smc') {
      out.push({
        key: 'smc_relaxations',
        title: 'SMC exemptions and relaxations',
        detail:
          'The AS review applies the exemptions and relaxations available to a Small and Medium Sized Company; the exempt items are marked on the AS compliance procedure.',
        target: 'AS review methodology',
        provisionCode: 'AS_RULES_2021_SMC',
        workAreaKey: 'schedule_iii_work',
        managedBy02_2: false,
      });
    }
  } else if (f.framework != null) {
    out.push({
      key: 'framework_review',
      title: 'Framework Review (blocking)',
      detail:
        '02.2 raises a blocking Framework Review matter; Section 02 cannot be approved until it is resolved.',
      target: '02.2',
      provisionCode: null,
      workAreaKey: null,
      managedBy02_2: true,
    });
  }
  return out;
}

export const DOWNSTREAM_STATUS = {
  /** Will activate when Section 02 is approved. */
  pending: 'pending',
  activated: 'activated',
  /** Activated by an earlier approval; the current conclusion no longer calls for it. */
  withdrawn: 'withdrawn',
} as const;
export type DownstreamStatus = (typeof DOWNSTREAM_STATUS)[keyof typeof DOWNSTREAM_STATUS];

export const DOWNSTREAM_STATUS_LABEL: Record<DownstreamStatus, string> = {
  pending: 'Activates on approval',
  activated: 'Activated',
  withdrawn: 'Withdrawn',
};

/** One SMC exemption / relaxation, from the methodology library. */
export interface SmcRelaxation {
  key: string;
  standardCode: string;
  standardLabel: string;
  kind: 'not_applicable' | 'relaxation' | 'disclosure_exemption';
  paragraphs: string | null;
  relaxation: string;
  provisionCode: string;
}

export interface FrameworkDownstreamItem extends PlannedDownstreamAction {
  status: DownstreamStatus;
  activatedAt: string | null;
  activatedByName: string | null;
  /** The SMC relaxations the AS review applies (smc_relaxations only). */
  relaxations: SmcRelaxation[];
}

/** The 02.2 "Downstream impact" panel (spec §5, §19). */
export interface FinancialReportingDownstreamView {
  workflowInstanceId: string;
  /** Section 02 is approved — the actions are live, not just previewed. */
  approved: boolean;
  /** The 02.2 framework the plan reflects (null while 02.2 has no result). */
  framework: string | null;
  scheduleIiiDivision: ScheduleIiiDivision | null;
  items: FrameworkDownstreamItem[];
}
