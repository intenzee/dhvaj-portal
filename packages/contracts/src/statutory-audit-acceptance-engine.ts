/**
 * Section 01 — the question engine (spec §4–§9, §13).
 *
 * Each segment is a short list of questions with the control the spec asks
 * for (Yes / No / Information Pending, a dropdown, a date, a From → To period,
 * a Clear / Issue / N/A checklist, a small form). Detail fields appear ONLY for
 * the answers that need an explanation; questions appear only when an earlier
 * answer makes them relevant (e.g. the previous-auditor questions disappear for
 * a continuing engagement).
 *
 * This file is pure data + pure functions so the API, the web screen and the
 * mobile app evaluate a segment identically: which questions show, what is
 * still pending, what needs Partner attention, and the segment's status.
 */

// ── Vocabulary ──────────────────────────────────────────────────────────────

/** Acceptance Matter categories (spec §11). */
export const ACCEPTANCE_MATTER_CATEGORY = {
  appointment: 'appointment',
  eligibility: 'eligibility',
  previousAuditor: 'previous_auditor',
  integrity: 'integrity',
  scope: 'scope',
  resources: 'resources',
  fee: 'fee',
  independence: 'independence',
  preconditions: 'preconditions',
  other: 'other',
} as const;
export type AcceptanceMatterCategory =
  (typeof ACCEPTANCE_MATTER_CATEGORY)[keyof typeof ACCEPTANCE_MATTER_CATEGORY];
export const ACCEPTANCE_MATTER_CATEGORIES: AcceptanceMatterCategory[] = Object.values(
  ACCEPTANCE_MATTER_CATEGORY,
);
export const ACCEPTANCE_MATTER_CATEGORY_LABEL: Record<AcceptanceMatterCategory, string> = {
  appointment: 'Appointment',
  eligibility: 'Eligibility',
  previous_auditor: 'Previous Auditor',
  integrity: 'Integrity',
  scope: 'Scope',
  resources: 'Resources',
  fee: 'Fee',
  independence: 'Independence',
  preconditions: 'Preconditions',
  other: 'Other',
};

export type MatterSeverityLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Firm methodology switches the spec leaves to "configured methodology". Kept
 * here, in one place, so the API and the screens agree.
 */
export const ACCEPTANCE_METHODOLOGY = {
  /** PRE-01 "Pending Framework Assessment" lets Section 01 proceed (assessed in Section 02). */
  allowPendingFramework: true,
  /** ACC-05 fee matters need Engagement Partner review before acceptance. */
  feeMattersNeedPartnerReview: true,
  /** PA-04 "No response yet" does not stop acceptance once communication is sent. */
  previousAuditorResponseRequired: false,
  /** Independence matters of this significance need Partner approval. */
  independencePartnerApprovalFrom: 'high' as MatterSeverityLevel,
} as const;

// ── Question model ──────────────────────────────────────────────────────────

/** How a question is answered. */
export type AcceptanceControl =
  /** Option buttons (Yes / No / Information Pending …). */
  | 'choice'
  /** A dropdown of options. */
  | 'select'
  /** A date (answer = ISO date). */
  | 'date'
  /** From → To financial year (details.from / details.to; answer = 'recorded'). */
  | 'period'
  /** A small form of detail fields (answer = 'recorded'). */
  | 'form'
  /** The client's other active services, each assessed (IND-03). */
  | 'services';

export interface AcceptanceChoice {
  value: string;
  label: string;
}

/** What one answer means for the segment. */
export interface AcceptanceOption extends AcceptanceChoice {
  /** UI tone: a clear answer, an exception, or information still awaited. */
  tone?: 'clear' | 'exception' | 'pending';
  /** The answer leaves the segment open; this text goes to Needs Attention. */
  pending?: string;
  /** The answer needs the Engagement Partner's attention. */
  attention?: string;
}

export type AcceptanceFieldType =
  'text' | 'textarea' | 'date' | 'email' | 'fy' | 'select' | 'multiselect' | 'yesno';

export interface AcceptanceDetailField {
  key: string;
  label: string;
  type: AcceptanceFieldType;
  options?: readonly AcceptanceChoice[];
  required?: boolean;
  hint?: string;
  /** Show only when another detail field of the same answer has one of these values. */
  showIf?: { field: string; in: readonly string[] };
}

/** A condition on earlier answers / the file's facts. */
export type AcceptanceCondition =
  | { q: string; in: readonly string[] }
  | { q: string; field: string; includes: string }
  | { ctx: 'firstYear' | 'continuing' }
  | { all: readonly AcceptanceCondition[] }
  | { any: readonly AcceptanceCondition[] }
  | { not: AcceptanceCondition };

export interface AcceptanceQuestionDefinition {
  segmentKey: string;
  questionKey: string;
  /** The spec's code, e.g. APP-01. */
  code: string;
  prompt: string;
  control: AcceptanceControl;
  options?: readonly AcceptanceOption[];
  /** Detail fields shown for these answers (any answer when `when` is omitted). */
  details?: readonly { when?: readonly string[]; fields: readonly AcceptanceDetailField[] }[];
  /** Add File / Link Existing File is offered for these answers (slot `evidence:<questionKey>`). */
  evidenceWhen?: readonly string[];
  /** Section 01 file cards shown with this question (all answers when `when` is omitted). */
  files?: readonly { slot: string; when?: readonly string[]; hint?: string }[];
  /** Shown only when this holds. */
  showIf?: AcceptanceCondition;
  /** Does not have to be answered for the segment to complete. */
  optional?: boolean;
  /** Questions sharing a group render together (e.g. the eligibility checklist table). */
  group?: string;
  hint?: string;
}

// ── Shared option sets ──────────────────────────────────────────────────────

const YES = { value: 'yes', label: 'Yes' } as const;
const NO = { value: 'no', label: 'No' } as const;
const YES_CLEAR: AcceptanceOption = { ...YES, tone: 'clear' };
const NO_CLEAR: AcceptanceOption = { ...NO, tone: 'clear' };
const YES_EXC: AcceptanceOption = { ...YES, tone: 'exception' };
const NO_EXC: AcceptanceOption = { ...NO, tone: 'exception' };

const EXPLAIN: AcceptanceDetailField = {
  key: 'explanation',
  label: 'Explain the exception',
  type: 'textarea',
  required: true,
};

// ── 01.2 vocabulary ─────────────────────────────────────────────────────────

/** APP-01 — how DHVAJ was appointed. */
export const ACCEPTANCE_APPOINTMENT_BASIS = [
  { value: 'first_auditor', label: 'First Auditor' },
  { value: 'agm', label: 'Appointment at AGM' },
  { value: 'reappointment', label: 'Reappointment' },
  { value: 'casual_vacancy', label: 'Casual Vacancy' },
  { value: 'cag', label: 'C&AG Appointment' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly AcceptanceChoice[];
export type AcceptanceAppointmentBasis = (typeof ACCEPTANCE_APPOINTMENT_BASIS)[number]['value'];
export const ACCEPTANCE_APPOINTMENT_BASIS_LABEL = Object.fromEntries(
  ACCEPTANCE_APPOINTMENT_BASIS.map((o) => [o.value, o.label]),
) as Record<AcceptanceAppointmentBasis, string>;

/** The conclusion on an eligibility-checklist issue (spec §5). */
export const ELIGIBILITY_ISSUE_CONCLUSION = [
  { value: 'resolved', label: 'Resolved' },
  { value: 'partner_review', label: 'Partner Review Required' },
  { value: 'cannot_accept', label: 'Appointment Cannot Be Accepted' },
] as const satisfies readonly AcceptanceChoice[];
export type EligibilityIssueConclusion = (typeof ELIGIBILITY_ISSUE_CONCLUSION)[number]['value'];

/** The APP-05 eligibility checklist rows (question key → label). */
export const ELIGIBILITY_CHECKS = [
  ['el_firm', 'Firm / auditor eligibility'],
  ['el_disqualification', 'Relevant disqualifications'],
  ['el_tenure', 'Tenure / rotation, where applicable'],
  ['el_ceiling', 'Audit ceiling / number of audits consideration'],
  ['el_relationship', 'Relationship / interest restrictions'],
  ['el_other', 'Other appointment restriction identified'],
] as const;

const CHECK_OPTIONS: readonly AcceptanceOption[] = [
  { value: 'clear', label: 'Clear', tone: 'clear' },
  { value: 'issue', label: 'Issue', tone: 'exception' },
  { value: 'na', label: 'N/A', tone: 'clear' },
];

// ── 01.3 vocabulary ─────────────────────────────────────────────────────────

/** PA-05 — what the previous auditor's matter means for acceptance (spec §6). */
export const ACCEPTANCE_IMPACT = [
  { value: 'no_impact', label: 'No impact' },
  { value: 'further_info', label: 'Further information required' },
  { value: 'safeguard', label: 'Safeguard or action required' },
  { value: 'partner_review', label: 'Engagement Partner review required' },
  { value: 'should_not_accept', label: 'Engagement should not be accepted' },
] as const satisfies readonly AcceptanceChoice[];
export type AcceptanceImpact = (typeof ACCEPTANCE_IMPACT)[number]['value'];

export const PREVIOUS_AUDITOR_CHANGE_REASON = [
  { value: 'tenure_completed', label: 'Tenure / rotation completed' },
  { value: 'not_reappointed', label: 'Not reappointed' },
  { value: 'resignation', label: 'Resignation' },
  { value: 'removal', label: 'Removal' },
  { value: 'casual_vacancy', label: 'Casual vacancy' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly AcceptanceChoice[];

export const COMMUNICATION_MODE = [
  { value: 'email', label: 'Email' },
  { value: 'registered_post', label: 'Registered Post' },
  { value: 'speed_post', label: 'Speed Post' },
  { value: 'hand_delivery', label: 'Hand Delivery' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly AcceptanceChoice[];

/** 01.3 applies: a first-year audit, or a special circumstance recorded on PA-01. */
const PA_APPLIES: AcceptanceCondition = {
  any: [
    { q: 'pa_01', in: ['yes'] },
    { q: 'pa_01', field: 'special', includes: 'yes' },
  ],
};
/** …and another auditor / firm audited the company immediately before. */
const PA_HAD_AUDITOR: AcceptanceCondition = { all: [PA_APPLIES, { q: 'pa_02', in: ['yes'] }] };

// ── 01.4 vocabulary ─────────────────────────────────────────────────────────

/** CON-01 — the areas a continuing engagement says have changed (spec §7.1). */
export const CONTINUANCE_CHANGED_AREA = [
  { value: 'integrity', label: 'Integrity of management / TCWG' },
  { value: 'legal', label: 'Legal, regulatory, fraud or reputation' },
  { value: 'scope', label: 'Scope of the audit' },
  { value: 'resources', label: 'Competence, time and resources' },
  { value: 'fee', label: 'Fees / commercial' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly AcceptanceChoice[];

/** ACC-04 — specialist skills the engagement needs; carried to Planning. */
export const SPECIALIST_TYPE = [
  { value: 'it', label: 'IT' },
  { value: 'valuation', label: 'Valuation' },
  { value: 'tax', label: 'Tax' },
  { value: 'actuarial', label: 'Actuarial' },
  { value: 'legal', label: 'Legal' },
  { value: 'industry', label: 'Industry' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly AcceptanceChoice[];
export const SPECIALIST_TYPE_LABEL = Object.fromEntries(
  SPECIALIST_TYPE.map((o) => [o.value, o.label]),
) as Record<(typeof SPECIALIST_TYPE)[number]['value'], string>;

export const SCOPE_LIMITATION_EFFECT = [
  { value: 'minor', label: 'Minor' },
  { value: 'significant', label: 'Significant' },
  { value: 'may_prevent', label: 'May Prevent Acceptance' },
] as const satisfies readonly AcceptanceChoice[];

/**
 * An ACC question applies to a new engagement, and to a continuing one only
 * for the areas CON-01 says have changed (spec §7.1–§7.2).
 */
const accApplies = (area: string): AcceptanceCondition => ({
  any: [{ not: { ctx: 'continuing' } }, { q: 'con_01', field: 'changedAreas', includes: area }],
});
/** The full questionnaire / conclusion is needed unless continuance is confirmed. */
const ACC_ASSESSED: AcceptanceCondition = {
  any: [{ not: { ctx: 'continuing' } }, { q: 'con_01', in: ['yes'] }],
};

const PENDING_INFO = (text: string): AcceptanceOption => ({
  value: 'pending',
  label: 'Information Pending',
  tone: 'pending',
  pending: text,
});

// ── 01.5 vocabulary ─────────────────────────────────────────────────────────

/** Threat categories (Code of Ethics) for an Independence Matter (spec §8). */
export const INDEPENDENCE_THREAT = [
  { value: 'self_interest', label: 'Self-interest' },
  { value: 'self_review', label: 'Self-review' },
  { value: 'advocacy', label: 'Advocacy' },
  { value: 'familiarity', label: 'Familiarity' },
  { value: 'intimidation', label: 'Intimidation' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly AcceptanceChoice[];

export const MATTER_SIGNIFICANCE = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
] as const satisfies readonly AcceptanceChoice[];

export const INDEPENDENCE_MATTER_CONCLUSION = [
  { value: 'acceptable', label: 'Threat at an acceptable level' },
  { value: 'safeguards', label: 'Reduced to an acceptable level by safeguards' },
  { value: 'not_acceptable', label: 'Cannot be reduced to an acceptable level' },
] as const satisfies readonly AcceptanceChoice[];

/** The Independence Matter fields (spec §8) recorded on a "Yes" / threat answer. */
const independenceMatterFields = (person: boolean): AcceptanceDetailField[] => [
  {
    key: 'threat',
    label: 'Threat / category',
    type: 'select',
    options: INDEPENDENCE_THREAT,
    required: true,
  },
  ...(person ? [{ key: 'person', label: 'Person / service involved', type: 'text' } as const] : []),
  { key: 'description', label: 'Description', type: 'textarea', required: true },
  {
    key: 'significance',
    label: 'Significance',
    type: 'select',
    options: MATTER_SIGNIFICANCE,
    required: true,
  },
  { key: 'consultation', label: 'Consultation required', type: 'yesno', required: true },
  {
    key: 'conclusion',
    label: 'Conclusion',
    type: 'select',
    options: INDEPENDENCE_MATTER_CONCLUSION,
    required: true,
  },
  {
    key: 'safeguard',
    label: 'Safeguard',
    type: 'textarea',
    required: true,
    showIf: { field: 'conclusion', in: ['safeguards'] },
  },
];

const SIGNIFICANCE_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Significance at or above the configured level needs the Partner's approval. */
export function independenceNeedsPartnerApproval(significance: unknown): boolean {
  return (
    (SIGNIFICANCE_RANK[String(significance)] ?? 0) >=
    SIGNIFICANCE_RANK[ACCEPTANCE_METHODOLOGY.independencePartnerApprovalFrom]!
  );
}

// ── The catalogue ───────────────────────────────────────────────────────────

export const ACCEPTANCE_QUESTIONS: readonly AcceptanceQuestionDefinition[] = [
  // 01.1 Engagement Profile (spec §4).
  {
    segmentKey: 'engagement_profile',
    questionKey: 'ep_01',
    code: 'EP-01',
    prompt: 'Is the above information correct for purposes of engagement acceptance?',
    control: 'choice',
    options: [
      YES_CLEAR,
      {
        value: 'correction',
        label: 'Information requires correction',
        tone: 'pending',
        pending: 'Engagement profile needs correcting on the client / engagement master',
      },
    ],
  },

  // 01.2 Appointment & Auditor Eligibility (spec §5).
  {
    segmentKey: 'appointment_eligibility',
    questionKey: 'app_01',
    code: 'APP-01',
    prompt: 'How has DHVAJ been appointed as statutory auditor?',
    control: 'select',
    options: ACCEPTANCE_APPOINTMENT_BASIS.map((o) => ({ ...o, tone: 'clear' as const })),
    details: [
      {
        when: ['other'],
        fields: [
          { key: 'specify', label: 'Specify appointment basis', type: 'text', required: true },
        ],
      },
    ],
  },
  {
    segmentKey: 'appointment_eligibility',
    questionKey: 'app_02',
    code: 'APP-02',
    prompt: 'Date of appointment',
    control: 'date',
  },
  {
    segmentKey: 'appointment_eligibility',
    questionKey: 'app_03',
    code: 'APP-03',
    prompt: 'Period for which DHVAJ has been appointed',
    control: 'period',
    details: [
      {
        fields: [
          { key: 'from', label: 'From', type: 'fy', required: true },
          { key: 'to', label: 'To', type: 'fy', required: true },
        ],
      },
    ],
  },
  {
    segmentKey: 'appointment_eligibility',
    questionKey: 'app_04',
    code: 'APP-04',
    prompt: "Has the company's formal communication of appointment been received?",
    control: 'choice',
    options: [YES_CLEAR, { ...NO, tone: 'pending', pending: 'Appointment Communication Pending' }],
    files: [
      {
        slot: 'appointment_communication',
        when: ['yes'],
        hint: 'Board / AGM resolution, appointment letter or the ADT-1 filing.',
      },
      // 5.1 Auditor Consent / Eligibility Certificate.
      { slot: 'consent_certificate' },
    ],
  },
  {
    segmentKey: 'appointment_eligibility',
    questionKey: 'app_05',
    code: 'APP-05',
    prompt:
      "Has the firm's eligibility for this appointment been evaluated under the applicable provisions?",
    control: 'choice',
    options: [
      YES_CLEAR,
      { ...NO, tone: 'pending', pending: 'Eligibility evaluation not yet done' },
      {
        value: 'review_required',
        label: 'Review Required',
        tone: 'exception',
        attention: 'Firm eligibility needs Engagement Partner review',
      },
    ],
  },
  ...ELIGIBILITY_CHECKS.map(([questionKey, prompt]): AcceptanceQuestionDefinition => ({
    segmentKey: 'appointment_eligibility',
    questionKey,
    code: '',
    prompt,
    control: 'choice',
    group: 'eligibility_checklist',
    options: CHECK_OPTIONS,
    details: [
      {
        when: ['issue'],
        fields: [
          { key: 'description', label: 'Describe the matter', type: 'textarea', required: true },
          {
            key: 'conclusion',
            label: 'Conclusion',
            type: 'select',
            options: ELIGIBILITY_ISSUE_CONCLUSION,
            required: true,
          },
        ],
      },
    ],
    evidenceWhen: ['issue'],
  })),
  // 01.3 Previous Auditor Communication (spec §6). PA-01 is derived from the
  // file's first-year call; the rest appears only when there was a previous
  // auditor to communicate with.
  {
    segmentKey: 'previous_auditor',
    questionKey: 'pa_01',
    code: 'PA-01',
    prompt: 'Is this the first year DHVAJ is acting as statutory auditor of the company?',
    control: 'choice',
    options: [YES_CLEAR, NO_CLEAR],
    details: [
      {
        when: ['no'],
        fields: [
          {
            key: 'special',
            label: 'Special circumstance requiring previous-auditor communication?',
            type: 'yesno',
          },
          {
            key: 'specialReason',
            label: 'Describe the circumstance',
            type: 'textarea',
            required: true,
            showIf: { field: 'special', in: ['yes'] },
          },
        ],
      },
    ],
  },
  {
    segmentKey: 'previous_auditor',
    questionKey: 'pa_02',
    code: 'PA-02',
    prompt: 'Was another auditor / firm the statutory auditor immediately before DHVAJ?',
    control: 'choice',
    showIf: PA_APPLIES,
    options: [
      YES_CLEAR,
      NO_CLEAR,
      {
        value: 'pending',
        label: 'Information Pending',
        tone: 'pending',
        pending: 'Previous auditor information pending',
      },
    ],
    details: [
      {
        when: ['no'],
        fields: [
          {
            key: 'reason',
            label: 'Reason',
            type: 'select',
            options: [
              { value: 'newly_incorporated', label: 'Newly incorporated company' },
              { value: 'first_statutory_audit', label: 'First statutory audit' },
              { value: 'other', label: 'Other' },
            ],
            required: true,
          },
          {
            key: 'reasonOther',
            label: 'Specify',
            type: 'text',
            required: true,
            showIf: { field: 'reason', in: ['other'] },
          },
        ],
      },
    ],
  },
  {
    segmentKey: 'previous_auditor',
    questionKey: 'pa_details',
    code: '6.1',
    prompt: 'Previous auditor details',
    control: 'form',
    showIf: PA_HAD_AUDITOR,
    details: [
      {
        fields: [
          { key: 'firmName', label: 'Auditor / Firm Name', type: 'text', required: true },
          { key: 'frn', label: 'FRN', type: 'text' },
          { key: 'partnerName', label: 'Partner Name', type: 'text' },
          { key: 'membershipNo', label: 'Membership No.', type: 'text' },
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'address', label: 'Address', type: 'text' },
          { key: 'lastAuditPeriod', label: 'Last Audit Period', type: 'fy', required: true },
          {
            key: 'changeReason',
            label: 'Reason for Change',
            type: 'select',
            options: PREVIOUS_AUDITOR_CHANGE_REASON,
            required: true,
          },
          { key: 'changeRemarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
  },
  {
    segmentKey: 'previous_auditor',
    questionKey: 'pa_03',
    code: 'PA-03',
    prompt: 'Has DHVAJ communicated with the previous auditor before accepting the audit?',
    control: 'choice',
    showIf: PA_HAD_AUDITOR,
    options: [YES_CLEAR, NO_CLEAR],
    hint: 'If not, create the communication from the DHVAJ template below.',
    details: [
      {
        when: ['yes'],
        fields: [
          { key: 'dateCommunicated', label: 'Date communicated', type: 'date', required: true },
          {
            key: 'mode',
            label: 'Mode',
            type: 'select',
            options: COMMUNICATION_MODE,
            required: true,
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
    files: [
      { slot: 'previous_auditor_communication', when: ['no'] },
      {
        slot: 'previous_auditor_sent_evidence',
        when: ['yes', 'no'],
        hint: 'Email, postal receipt or acknowledgement of the communication.',
      },
    ],
  },
  {
    segmentKey: 'previous_auditor',
    questionKey: 'pa_04',
    code: 'PA-04',
    prompt: 'Has a response been received?',
    control: 'choice',
    showIf: PA_HAD_AUDITOR,
    options: [
      YES_CLEAR,
      ACCEPTANCE_METHODOLOGY.previousAuditorResponseRequired
        ? { ...NO, tone: 'pending', pending: "Awaiting the previous auditor's response" }
        : NO_CLEAR,
    ],
    details: [
      {
        when: ['yes'],
        fields: [{ key: 'responseDate', label: 'Response date', type: 'date', required: true }],
      },
      {
        when: ['no'],
        fields: [{ key: 'followUp', label: 'Follow-up', type: 'text' }],
      },
    ],
    files: [{ slot: 'previous_auditor_response', when: ['yes'] }],
  },
  {
    segmentKey: 'previous_auditor',
    questionKey: 'pa_05',
    code: 'PA-05',
    prompt:
      'Has the previous auditor communicated any matter requiring consideration before acceptance?',
    control: 'choice',
    showIf: { all: [PA_HAD_AUDITOR, { q: 'pa_04', in: ['yes'] }] },
    options: [YES_EXC, NO_CLEAR],
    details: [
      {
        when: ['yes'],
        fields: [
          {
            key: 'matterCommunicated',
            label: 'Matter Communicated',
            type: 'textarea',
            required: true,
          },
          {
            key: 'managerAssessment',
            label: 'Manager Assessment',
            type: 'textarea',
            required: true,
          },
          {
            key: 'impact',
            label: 'Impact on Acceptance',
            type: 'select',
            options: ACCEPTANCE_IMPACT,
            required: true,
          },
        ],
      },
    ],
  },
  // 01.4 Acceptance / Continuance (spec §7). A continuing engagement confirms
  // continuance on CON-01, or answers only the areas that changed.
  {
    segmentKey: 'acceptance_continuance',
    questionKey: 'con_01',
    code: 'CON-01',
    prompt:
      "Have there been any changes since the previous acceptance assessment that could affect DHVAJ's decision to continue the engagement?",
    control: 'choice',
    showIf: { ctx: 'continuing' },
    options: [
      { ...YES, tone: 'clear' },
      { value: 'no', label: 'No — Confirm Continuance', tone: 'clear' },
    ],
    details: [
      {
        when: ['yes'],
        fields: [
          {
            key: 'changedAreas',
            label: 'Changed areas',
            type: 'multiselect',
            options: CONTINUANCE_CHANGED_AREA,
            required: true,
          },
        ],
      },
    ],
  },
  {
    segmentKey: 'acceptance_continuance',
    questionKey: 'acc_01',
    code: 'ACC-01',
    prompt:
      'Are there any known matters that raise concerns regarding the integrity of management or those charged with governance?',
    control: 'choice',
    showIf: accApplies('integrity'),
    options: [
      { ...YES_EXC, attention: 'Concern over the integrity of management / TCWG' },
      NO_CLEAR,
      PENDING_INFO('Integrity of management — information pending'),
    ],
    details: [
      {
        when: ['yes', 'pending'],
        fields: [
          { key: 'matter', label: 'Matter', type: 'textarea', required: true },
          { key: 'source', label: 'Source of Information', type: 'text', required: true },
        ],
      },
      {
        when: ['yes'],
        fields: [
          { key: 'assessment', label: 'Assessment', type: 'textarea', required: true },
          { key: 'actionRequired', label: 'Action Required', type: 'textarea', required: true },
        ],
      },
    ],
    evidenceWhen: ['yes', 'pending'],
  },
  {
    segmentKey: 'acceptance_continuance',
    questionKey: 'acc_02',
    code: 'ACC-02',
    prompt:
      'Are there significant legal, regulatory, investigation, fraud or reputational matters that may affect acceptance or continuance?',
    control: 'choice',
    showIf: accApplies('legal'),
    options: [
      YES_EXC,
      NO_CLEAR,
      PENDING_INFO('Legal / regulatory / reputational matters — information pending'),
    ],
    details: [
      {
        when: ['yes', 'pending'],
        fields: [
          { key: 'description', label: 'Describe the matter', type: 'textarea', required: true },
          { key: 'assessment', label: 'Assessment', type: 'textarea', required: true },
        ],
      },
    ],
    evidenceWhen: ['yes', 'pending'],
  },
  {
    segmentKey: 'acceptance_continuance',
    questionKey: 'acc_03',
    code: 'ACC-03',
    prompt:
      'Has management imposed or indicated any limitation on the proposed scope of the audit?',
    control: 'choice',
    showIf: accApplies('scope'),
    options: [YES_EXC, NO_CLEAR],
    details: [
      {
        when: ['yes'],
        fields: [
          {
            key: 'description',
            label: 'Describe the limitation',
            type: 'textarea',
            required: true,
          },
          {
            key: 'effect',
            label: 'Potential effect',
            type: 'select',
            options: SCOPE_LIMITATION_EFFECT,
            required: true,
          },
        ],
      },
    ],
  },
  {
    segmentKey: 'acceptance_continuance',
    questionKey: 'acc_04',
    code: 'ACC-04',
    prompt:
      'Does DHVAJ have sufficient competence, capabilities, time and resources to perform the engagement?',
    control: 'choice',
    showIf: accApplies('resources'),
    options: [
      YES_CLEAR,
      { ...NO_EXC, attention: 'Insufficient competence, time or resources for the engagement' },
      { value: 'specialist', label: 'Specialist Required', tone: 'clear' },
    ],
    details: [
      { when: ['no'], fields: [EXPLAIN] },
      {
        when: ['specialist'],
        fields: [
          {
            key: 'specialistTypes',
            label: 'Specialist',
            type: 'multiselect',
            options: SPECIALIST_TYPE,
            required: true,
            hint: 'Carried forward to Planning (team and scope).',
          },
          {
            key: 'specialistOther',
            label: 'Specify the specialist',
            type: 'text',
            required: true,
            showIf: { field: 'specialistTypes', in: ['other'] },
          },
        ],
      },
    ],
  },
  {
    segmentKey: 'acceptance_continuance',
    questionKey: 'acc_05',
    code: 'ACC-05',
    prompt:
      'Are there fee, commercial or outstanding-fee matters that require consideration before accepting or continuing the engagement?',
    control: 'choice',
    showIf: accApplies('fee'),
    options: [
      ACCEPTANCE_METHODOLOGY.feeMattersNeedPartnerReview
        ? { ...YES_EXC, attention: 'Fee / commercial matter needs Engagement Partner review' }
        : YES_EXC,
      NO_CLEAR,
    ],
    details: [{ when: ['yes'], fields: [EXPLAIN] }],
  },
  {
    segmentKey: 'acceptance_continuance',
    questionKey: 'acc_06',
    code: 'ACC-06',
    prompt:
      "Is there any other matter that could affect DHVAJ's decision to accept or continue this engagement?",
    control: 'choice',
    showIf: accApplies('other'),
    options: [YES_EXC, NO_CLEAR],
    details: [
      {
        when: ['yes'],
        fields: [
          EXPLAIN,
          { key: 'assessment', label: 'Assessment', type: 'textarea', required: true },
        ],
      },
    ],
  },
  {
    segmentKey: 'acceptance_continuance',
    questionKey: 'acc_conclusion',
    code: '',
    prompt: 'Segment conclusion',
    control: 'select',
    showIf: ACC_ASSESSED,
    options: [
      { value: 'clear', label: 'Clear to Proceed', tone: 'clear' },
      {
        value: 'subject_to_resolution',
        label: 'Proceed Subject to Resolution',
        tone: 'clear',
      },
      {
        value: 'partner_attention',
        label: 'Partner Attention Required',
        tone: 'exception',
        attention: 'Acceptance / continuance needs Engagement Partner attention',
      },
      {
        value: 'do_not_accept',
        label: 'Do Not Accept',
        tone: 'exception',
        attention: 'Acceptance / continuance concluded: Do Not Accept',
      },
    ],
    details: [
      {
        when: ['subject_to_resolution', 'partner_attention', 'do_not_accept'],
        fields: [
          { key: 'basis', label: 'Basis for the conclusion', type: 'textarea', required: true },
        ],
      },
    ],
  },
  // 01.5 Independence & Ethics (spec §8). Team declarations are summarised
  // from the portal (see SEGMENT_RULES.independence_ethics); IND-03 lists the
  // client's other active services automatically.
  {
    segmentKey: 'independence_ethics',
    questionKey: 'ind_01',
    code: 'IND-01',
    prompt: 'Has any financial interest in the client or relevant related entity been identified?',
    control: 'choice',
    options: [YES_EXC, NO_CLEAR],
    details: [{ when: ['yes'], fields: independenceMatterFields(true) }],
  },
  {
    segmentKey: 'independence_ethics',
    questionKey: 'ind_02',
    code: 'IND-02',
    prompt:
      'Has any business, employment, family or other relationship been identified that may create an independence threat?',
    control: 'choice',
    options: [YES_EXC, NO_CLEAR],
    details: [{ when: ['yes'], fields: independenceMatterFields(true) }],
  },
  {
    segmentKey: 'independence_ethics',
    questionKey: 'ind_03',
    code: 'IND-03',
    prompt:
      'Is DHVAJ providing any other service to the client that requires evaluation from an independence perspective?',
    control: 'services',
    options: [
      { value: 'no_threat', label: 'No Threat', tone: 'clear' },
      { value: 'threat', label: 'Threat Identified', tone: 'exception' },
      {
        value: 'further_review',
        label: 'Further Review Required',
        tone: 'pending',
        pending: 'Another service needs further independence review',
      },
    ],
    details: [
      { when: ['threat'], fields: independenceMatterFields(false) },
      {
        when: ['further_review'],
        fields: [{ key: 'note', label: 'What needs review', type: 'text' }],
      },
    ],
  },
  {
    segmentKey: 'independence_ethics',
    questionKey: 'ind_04',
    code: 'IND-04',
    prompt: 'Has any other conflict of interest or ethical threat been identified?',
    control: 'choice',
    options: [YES_EXC, NO_CLEAR],
    details: [{ when: ['yes'], fields: independenceMatterFields(true) }],
  },
  {
    segmentKey: 'independence_ethics',
    questionKey: 'ind_conclusion',
    code: '',
    prompt: 'Final Independence Conclusion',
    control: 'select',
    options: [
      { value: 'satisfied', label: 'Independence requirements satisfied', tone: 'clear' },
      {
        value: 'satisfied_safeguards',
        label: 'Satisfied subject to documented safeguards',
        tone: 'clear',
      },
      {
        value: 'consultation',
        label: 'Further consultation required',
        tone: 'pending',
        pending: 'Independence — further consultation required',
      },
      {
        value: 'not_satisfied',
        label: 'Independence requirements not satisfied - blocks acceptance',
        tone: 'exception',
        attention: 'Independence requirements not satisfied — blocks acceptance',
      },
    ],
    details: [
      {
        when: ['satisfied_safeguards'],
        fields: [{ key: 'safeguard', label: 'Safeguards', type: 'textarea', required: true }],
      },
      {
        when: ['not_satisfied'],
        fields: [{ key: 'basis', label: 'Basis', type: 'textarea', required: true }],
      },
    ],
  },
  // 01.6 Audit Preconditions (spec §9) — the minimum preconditions only; the
  // detailed framework analysis is Section 02's.
  {
    segmentKey: 'audit_preconditions',
    questionKey: 'pre_01',
    code: 'PRE-01',
    prompt:
      'Has an acceptable financial reporting framework for preparation of the financial statements been identified?',
    control: 'choice',
    options: [
      YES_CLEAR,
      ACCEPTANCE_METHODOLOGY.allowPendingFramework
        ? { value: 'pending', label: 'Pending Framework Assessment', tone: 'clear' }
        : {
            value: 'pending',
            label: 'Pending Framework Assessment',
            tone: 'pending',
            pending: 'Financial reporting framework still to be assessed',
          },
      {
        ...NO_EXC,
        attention: 'No acceptable financial reporting framework identified',
      },
    ],
    details: [{ when: ['no'], fields: [EXPLAIN] }],
    hint: ACCEPTANCE_METHODOLOGY.allowPendingFramework
      ? 'Pending is allowed here; the framework is assessed in detail in Section 02.'
      : undefined,
  },
  ...preconditions([
    [
      'pre_02',
      'PRE-02',
      'Has management acknowledged responsibility for preparation of the financial statements in accordance with the applicable financial reporting framework?',
      'Management has not acknowledged responsibility for the financial statements',
    ],
    [
      'pre_03',
      'PRE-03',
      'Has management acknowledged responsibility for such internal control as management determines necessary for preparation of financial statements free from material misstatement?',
      'Management has not acknowledged responsibility for internal control',
    ],
    [
      'pre_04',
      'PRE-04',
      'Has management agreed to provide all relevant information and any additional information requested for purposes of the audit?',
      'Management has not agreed to provide all relevant information',
    ],
    [
      'pre_05',
      'PRE-05',
      'Has management agreed to provide unrestricted access to persons within the entity from whom the auditor considers it necessary to obtain audit evidence?',
      'Management has not agreed to unrestricted access to persons',
    ],
  ]),
  {
    segmentKey: 'audit_preconditions',
    questionKey: 'pre_06',
    code: 'PRE-06',
    prompt:
      'Is there any limitation or disagreement that prevents the preconditions for the audit from being satisfied?',
    control: 'choice',
    options: [YES_EXC, NO_CLEAR],
    details: [{ when: ['yes'], fields: [EXPLAIN] }],
  },
  // 01.7 has no questions: it follows the engagement letter's file lifecycle
  // (see SEGMENT_RULES.engagement_letter).
];

/** PRE-02 – PRE-05: Yes / No, where No needs the Engagement Partner's attention. */
function preconditions(
  rows: readonly [string, string, string, string][],
): AcceptanceQuestionDefinition[] {
  return rows.map(([questionKey, code, prompt, attention]) => ({
    segmentKey: 'audit_preconditions',
    questionKey,
    code,
    prompt,
    control: 'choice' as const,
    options: [YES_CLEAR, { ...NO_EXC, attention }],
    details: [{ when: ['no'], fields: [EXPLAIN] }],
  }));
}

export function questionsFor(segmentKey: string): AcceptanceQuestionDefinition[] {
  return ACCEPTANCE_QUESTIONS.filter((q) => q.segmentKey === segmentKey);
}

/** Questions whose answer is this year's to give, never last year's (§13). */
const NOT_ROLLED_FORWARD = new Set(['ep_01']);

/**
 * The questions of a segment that roll forward from last year (spec §13):
 * everything except dates, periods, the per-service IND-03 rows and the
 * EP-01 confirmation of this year's master facts.
 */
export function rollForwardQuestions(segmentKey: string): AcceptanceQuestionDefinition[] {
  return questionsFor(segmentKey).filter(
    (q) =>
      q.control !== 'date' &&
      q.control !== 'period' &&
      q.control !== 'services' &&
      !NOT_ROLLED_FORWARD.has(q.questionKey),
  );
}

export function questionByKey(questionKey: string): AcceptanceQuestionDefinition | undefined {
  return ACCEPTANCE_QUESTIONS.find((q) => q.questionKey === questionKey);
}

export function optionOf(
  q: AcceptanceQuestionDefinition,
  answer: string | null | undefined,
): AcceptanceOption | undefined {
  return answer == null ? undefined : q.options?.find((o) => o.value === answer);
}

/** Human label for an answer (option label, or the value for dates). */
export function answerLabel(q: AcceptanceQuestionDefinition, answer: string | null): string {
  if (answer == null) return 'Not answered';
  return optionOf(q, answer)?.label ?? answer;
}

// ── Evaluation ──────────────────────────────────────────────────────────────

export type AcceptanceDetails = Record<string, unknown>;

export interface AcceptanceAnswerState {
  answer: string | null;
  details: AcceptanceDetails;
}

/** Facts from the file a segment is evaluated against. */
export interface AcceptanceEvalContext {
  /** True for a first-year audit, false for continuing, null when unknown. */
  firstYear: boolean | null;
  /** The client's other active services (IND-03). */
  otherServiceIds: readonly string[];
  /** Team independence declarations still pending (01.5). */
  declarationsPending: number;
  /** Working status of Section 01 files by slot key (from the file cards). */
  fileStatuses: Readonly<Record<string, string>>;
  /** Matter sources (`acceptance:<segment>:<question>…`) open AND blocking. */
  openBlockingSources: readonly string[];
  /**
   * Matter sources a person has resolved or accepted with approval. The
   * Partner-attention line of the answer behind such a matter is settled.
   */
  settledSources?: readonly string[];
}

export const EMPTY_EVAL_CONTEXT: AcceptanceEvalContext = {
  firstYear: null,
  otherServiceIds: [],
  declarationsPending: 0,
  fileStatuses: {},
  openBlockingSources: [],
};

export type AnswersByKey = Readonly<Record<string, AcceptanceAnswerState | undefined>>;

export function conditionHolds(
  c: AcceptanceCondition | undefined,
  answers: AnswersByKey,
  ctx: AcceptanceEvalContext,
): boolean {
  if (!c) return true;
  if ('all' in c) return c.all.every((x) => conditionHolds(x, answers, ctx));
  if ('any' in c) return c.any.some((x) => conditionHolds(x, answers, ctx));
  if ('not' in c) return !conditionHolds(c.not, answers, ctx);
  if ('ctx' in c) return c.ctx === 'firstYear' ? ctx.firstYear === true : ctx.firstYear === false;
  const a = answers[c.q];
  if ('includes' in c) {
    const v = a?.details?.[c.field];
    return Array.isArray(v) ? v.includes(c.includes) : v === c.includes;
  }
  return a?.answer != null && c.in.includes(a.answer);
}

/** The detail fields shown for a question's current answer. */
export function detailFieldsFor(
  q: AcceptanceQuestionDefinition,
  state: AcceptanceAnswerState | undefined,
): AcceptanceDetailField[] {
  const answer = state?.answer ?? null;
  if (answer == null && q.control !== 'form' && q.control !== 'period') return [];
  const fields = (q.details ?? [])
    .filter((d) => !d.when || (answer != null && d.when.includes(answer)))
    .flatMap((d) => d.fields);
  return fields.filter((f) => {
    if (!f.showIf) return true;
    const v = state?.details?.[f.showIf.field];
    if (Array.isArray(v)) return v.some((x) => f.showIf!.in.includes(x as string));
    return typeof v === 'string' && f.showIf.in.includes(v);
  });
}

function filled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Required detail fields not yet filled for this answer. */
export function missingDetailFields(
  q: AcceptanceQuestionDefinition,
  state: AcceptanceAnswerState | undefined,
): AcceptanceDetailField[] {
  return detailFieldsFor(q, state).filter((f) => f.required && !filled(state?.details?.[f.key]));
}

export type DerivedSegmentState =
  'not_started' | 'in_progress' | 'attention_required' | 'complete' | 'not_applicable';

/** One Needs Attention line, linked to the question it comes from (spec §13). */
export interface AttentionItem {
  kind: 'pending' | 'attention';
  text: string;
  questionKey: string | null;
}

export interface SegmentEvaluation {
  state: DerivedSegmentState;
  /** Every Needs Attention line with its question, for click-through. */
  items: AttentionItem[];
  /** Questions to show, in order. */
  visible: AcceptanceQuestionDefinition[];
  /** Visible, required questions. */
  required: number;
  /** Of those, answered with every required detail filled. */
  answered: number;
  /** Needs Attention lines (information awaited, details missing). */
  pending: string[];
  /** Items needing the Engagement Partner's attention. */
  attention: string[];
  /** Why the segment is Not Applicable, when it is. */
  notApplicableReason: string | null;
  /** The answers evaluated, including system-derived ones (e.g. PA-01). */
  answers: AnswersByKey;
  /** Question keys whose answer is system-derived, not recorded by a user. */
  derived: string[];
}

/**
 * Evaluate one segment: which questions show, how far it has got, what is
 * awaited, and its status. Segment-specific rules (e.g. 01.3 Not Applicable for
 * a continuing engagement) are applied by {@link SEGMENT_RULES}.
 */
export function evaluateSegment(
  segmentKey: string,
  answers: AnswersByKey,
  ctx: AcceptanceEvalContext,
): SegmentEvaluation {
  const rule = SEGMENT_RULES[segmentKey];
  const effective = rule?.effectiveAnswers?.(answers, ctx) ?? answers;
  const derived = Object.keys(effective).filter((k) => effective[k] !== answers[k]);
  const na = rule?.notApplicable?.(effective, ctx) ?? null;
  const visible = questionsFor(segmentKey).filter((q) => conditionHolds(q.showIf, effective, ctx));
  if (na) {
    return {
      state: 'not_applicable',
      items: [],
      visible,
      required: 0,
      answered: 0,
      pending: [],
      attention: [],
      notApplicableReason: na,
      answers: effective,
      derived,
    };
  }

  const items: AttentionItem[] = [];
  const pend = (text: string, questionKey: string | null) =>
    items.push({ kind: 'pending', text, questionKey });
  const attn = (text: string, questionKey: string | null) =>
    items.push({ kind: 'attention', text, questionKey });
  let required = 0;
  let answered = 0;
  let touched = false;
  for (const q of visible) {
    // IND-03: one assessment per other active service; the question is done
    // when every service is assessed (nothing to assess is done too).
    if (q.control === 'services') {
      if (q.optional) continue;
      required += 1;
      let allDone = true;
      for (const id of ctx.otherServiceIds) {
        const key = `${q.questionKey}:${id}`;
        const sub = effective[key];
        if (sub?.answer != null) touched = true;
        const o = optionOf(q, sub?.answer);
        if (o?.pending) pend(o.pending, key);
        if (o?.attention) attn(o.attention, key);
        const missing = missingDetailFields(q, sub);
        if (sub?.answer != null && missing.length > 0) {
          pend(`${q.code}: ${missing.map((f) => f.label).join(', ')} still to record`, key);
        }
        if (sub?.answer == null || missing.length > 0 || o?.pending) allDone = false;
      }
      if (allDone) answered += 1;
      continue;
    }
    const s = effective[q.questionKey];
    const recorded = s && !derived.includes(q.questionKey);
    if (recorded && (s.answer != null || Object.keys(s.details ?? {}).length > 0)) touched = true;
    const opt = optionOf(q, s?.answer);
    if (opt?.pending) pend(opt.pending, q.questionKey);
    if (opt?.attention) attn(opt.attention, q.questionKey);
    if (q.optional) continue;
    required += 1;
    const missing = missingDetailFields(q, s);
    if (s?.answer == null) continue;
    if (missing.length > 0) {
      pend(
        `${q.code || 'Question'}: ${missing.map((f) => f.label).join(', ')} still to record`,
        q.questionKey,
      );
      continue;
    }
    if (!opt?.pending) answered += 1;
  }
  const extra = rule?.extra?.(effective, ctx);
  if (extra) {
    if (extra.touched) touched = true;
    items.push(...extra.items);
    required += extra.required ?? 0;
    answered += extra.answered ?? 0;
  }
  // An attention line whose matter the Engagement Partner has dealt with
  // (resolved / accepted with approval) no longer holds the segment.
  const settled = new Set(ctx.settledSources ?? []);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i]!;
    if (
      it.kind === 'attention' &&
      it.questionKey &&
      settled.has(acceptanceSource(segmentKey, it.questionKey))
    ) {
      items.splice(i, 1);
    }
  }
  const pending = items.filter((i) => i.kind === 'pending').map((i) => i.text);
  const attention = items.filter((i) => i.kind === 'attention').map((i) => i.text);
  const blockingHere = ctx.openBlockingSources.some((s) =>
    s.startsWith(`acceptance:${segmentKey}:`),
  );

  let state: DerivedSegmentState;
  // Nothing recorded by a user yet (system-derived answers alone do not start
  // a segment, unless they already complete it).
  if (!touched && !(answered >= required && pending.length === 0)) state = 'not_started';
  else if (attention.length > 0 || blockingHere) state = 'attention_required';
  else if (answered >= required && pending.length === 0) state = 'complete';
  else state = 'in_progress';
  // An unanswered segment with nothing to answer is complete (e.g. nothing to assess).
  if (required === 0 && pending.length === 0 && attention.length === 0 && !blockingHere) {
    state = touched || visible.length === 0 ? 'complete' : 'not_started';
  }
  return {
    state,
    items,
    visible,
    required,
    answered,
    pending,
    attention,
    notApplicableReason: null,
    answers: effective,
    derived,
  };
}

interface SegmentRule {
  /** System-derived answers the user has not overridden (e.g. PA-01 from history). */
  effectiveAnswers?: (answers: AnswersByKey, ctx: AcceptanceEvalContext) => AnswersByKey;
  /** A reason the segment is Not Applicable, or null. */
  notApplicable?: (answers: AnswersByKey, ctx: AcceptanceEvalContext) => string | null;
  /** Segment-level requirements beyond the questions. */
  extra?: (
    answers: AnswersByKey,
    ctx: AcceptanceEvalContext,
  ) => { items: AttentionItem[]; required?: number; answered?: number; touched?: boolean };
}

const SEGMENT_RULES: Record<string, SegmentRule> = {
  engagement_letter: {
    // 01.7 (spec §10): the letter's own lifecycle decides the segment. It is
    // done once the Engagement Partner has approved the letter; drafting and
    // partner review keep it in progress; no letter yet is Not Started.
    extra: (_answers, ctx) => {
      const status = ctx.fileStatuses.engagement_letter;
      if (!status) return { items: [], required: 1, answered: 0 };
      if (ENGAGEMENT_LETTER_DONE.includes(status)) {
        return { items: [], required: 1, answered: 1, touched: true };
      }
      return {
        items: [
          {
            kind: 'pending',
            text:
              status === 'partner_review'
                ? 'Engagement letter is with the Engagement Partner for review'
                : 'Engagement letter is in draft — submit it for Partner review',
            questionKey: null,
          },
        ],
        required: 1,
        answered: 0,
        touched: true,
      };
    },
  },
  appointment_eligibility: {
    // An eligibility issue still awaiting the Partner, or one that bars the
    // appointment, needs the Engagement Partner's attention (spec §5).
    extra: (answers) => ({
      items: ELIGIBILITY_CHECKS.flatMap(([key, label]): AttentionItem[] => {
        const a = answers[key];
        if (a?.answer !== 'issue') return [];
        const c = a.details?.conclusion;
        if (c === 'partner_review') {
          return [
            { kind: 'attention', text: `${label}: Partner review required`, questionKey: key },
          ];
        }
        if (c === 'cannot_accept') {
          return [
            {
              kind: 'attention',
              text: `${label}: appointment cannot be accepted`,
              questionKey: key,
            },
          ];
        }
        return [];
      }),
    }),
  },
  independence_ethics: {
    extra: (answers, ctx) => {
      const items: AttentionItem[] = [];
      if (ctx.declarationsPending > 0) {
        items.push({
          kind: 'pending',
          text: `${ctx.declarationsPending} team independence declaration${ctx.declarationsPending === 1 ? '' : 's'} pending`,
          questionKey: null,
        });
      }
      // A matter that cannot be safeguarded leaves independence not satisfied.
      const keys = Object.keys(answers).filter((k) =>
        ['ind_01', 'ind_02', 'ind_03', 'ind_04'].includes(k.split(':')[0]!),
      );
      const conclusion = answers.ind_conclusion?.answer;
      if (
        (conclusion === 'satisfied' || conclusion === 'satisfied_safeguards') &&
        keys.some((k) => answers[k]?.details?.conclusion === 'not_acceptable')
      ) {
        items.push({
          kind: 'attention',
          text: 'A threat that cannot be reduced is recorded — the conclusion cannot be "satisfied"',
          questionKey: 'ind_conclusion',
        });
      }
      // Significant matters need the Engagement Partner's approval (methodology).
      for (const k of keys) {
        const a = answers[k];
        const isThreat = a?.answer === 'yes' || a?.answer === 'threat';
        if (isThreat && independenceNeedsPartnerApproval(a.details?.significance)) {
          items.push({
            kind: 'attention',
            text: `${k.startsWith('ind_03') ? 'IND-03 service' : k.replace('ind_0', 'IND-0')}: significant independence matter needs Engagement Partner approval`,
            questionKey: k,
          });
        }
      }
      return { items };
    },
  },
  acceptance_continuance: {
    // "Proceed Subject to Resolution" holds while this segment's matters are open.
    extra: (answers, ctx) =>
      answers.acc_conclusion?.answer === 'subject_to_resolution' &&
      ctx.openBlockingSources.some((src) => src.startsWith('acceptance:acceptance_continuance:'))
        ? {
            items: [
              {
                kind: 'pending',
                text: 'Proceeding subject to resolution — resolve the open matters first',
                questionKey: 'acc_conclusion',
              },
            ],
          }
        : { items: [] },
  },
  previous_auditor: {
    // PA-01 follows the file's first-year call until someone answers it.
    effectiveAnswers: (answers, ctx) =>
      answers.pa_01?.answer != null || ctx.firstYear == null
        ? answers
        : { ...answers, pa_01: { answer: ctx.firstYear ? 'yes' : 'no', details: {} } },
    notApplicable: (answers) =>
      answers.pa_01?.answer === 'no' && answers.pa_01.details?.special !== 'yes'
        ? 'Continuing Engagement — DHVAJ was the auditor last year.'
        : null,
    extra: (answers, ctx) => {
      const items: AttentionItem[] = [];
      if (!conditionHolds(PA_HAD_AUDITOR, answers, ctx)) return { items };
      // PA-03 "No": the communication is created here and must go out (spec §6.2).
      if (answers.pa_03?.answer === 'no') {
        const status = ctx.fileStatuses.previous_auditor_communication;
        if (status !== 'sent') {
          items.push({
            kind: 'pending',
            text: !status
              ? 'Create the Communication to Previous Auditor'
              : status === 'ready_to_send'
                ? 'Communication to Previous Auditor is ready — mark it Sent once it goes out'
                : 'Communication to Previous Auditor is in draft',
            questionKey: 'pa_03',
          });
        }
      }
      const impact = answers.pa_05?.answer === 'yes' ? answers.pa_05.details?.impact : null;
      if (impact === 'further_info') {
        items.push({
          kind: 'pending',
          text: "Further information required on the previous auditor's matter",
          questionKey: 'pa_05',
        });
      }
      if (impact === 'partner_review' || impact === 'should_not_accept') {
        items.push({
          kind: 'attention',
          text:
            impact === 'partner_review'
              ? "Previous auditor's matter needs Engagement Partner review"
              : "Previous auditor's matter: engagement should not be accepted",
          questionKey: 'pa_05',
        });
      }
      return { items };
    },
  },
};

/** ACC-04 "Specialist Required" details → specialist labels for Planning. */
export function specialistLabels(details: AcceptanceDetails | undefined): string[] {
  const types = Array.isArray(details?.specialistTypes)
    ? (details.specialistTypes as string[])
    : [];
  const other = typeof details?.specialistOther === 'string' ? details.specialistOther.trim() : '';
  return types.map((t) =>
    t === 'other' && other
      ? other
      : (SPECIALIST_TYPE_LABEL[t as keyof typeof SPECIALIST_TYPE_LABEL] ?? t),
  );
}

/** The file cards (slot keys) shown with a question for its current answer. */
export function fileSlotsFor(
  q: AcceptanceQuestionDefinition,
  answer: string | null,
): { slot: string; hint?: string }[] {
  const out = (q.files ?? [])
    .filter((f) => !f.when || (answer != null && f.when.includes(answer)))
    .map((f) => ({ slot: f.slot, hint: f.hint }));
  if (answer != null && q.evidenceWhen?.includes(answer)) {
    out.push({ slot: `evidence:${q.questionKey}`, hint: undefined });
  }
  return out;
}

/** Engagement-letter statuses that complete 01.7. */
export const ENGAGEMENT_LETTER_DONE: readonly string[] = ['approved', 'issued', 'accepted'];

/** What Section 01 completion reads from a segment (spec §14). */
export interface CompletionSegment {
  segmentKey: string;
  state: string;
  answers: ReadonlyArray<{
    questionKey: string;
    answer: string | null;
    details?: AcceptanceDetails | null;
  }>;
}

/**
 * Section 01 completion rules beyond "every segment resolved" (spec §14):
 * independence must permit the engagement, the team's declarations must all
 * be in, and nothing recorded may rule out acceptance (an eligibility issue
 * that cannot be accepted, "Do Not Accept", absent preconditions). The
 * engagement letter's progress is the sign-off's own check (01.7 lifecycle).
 * Each failure is a sentence the Partner sees as a blocker.
 */
export function section01CompletionChecks(input: {
  segments: readonly CompletionSegment[];
  declarationsPending: number;
}): string[] {
  const failures: string[] = [];
  const answersOf = (segmentKey: string) => {
    const seg = input.segments.find((s) => s.segmentKey === segmentKey);
    if (!seg || seg.state === 'not_applicable') return null;
    return seg.answers.filter((a) => a.answer !== null);
  };
  const base = (key: string) => key.split(':')[0]!;

  const eligibility = answersOf('appointment_eligibility');
  if (eligibility?.some((a) => a.answer === 'issue' && a.details?.conclusion === 'cannot_accept')) {
    failures.push('An eligibility issue concludes the appointment cannot be accepted.');
  }

  const continuance = answersOf('acceptance_continuance');
  if (
    continuance?.some((a) => a.questionKey === 'acc_conclusion' && a.answer === 'do_not_accept')
  ) {
    failures.push('Acceptance / continuance is concluded "Do Not Accept".');
  }

  const independence = answersOf('independence_ethics');
  if (independence) {
    const conclusion = independence.find((a) => a.questionKey === 'ind_conclusion')?.answer;
    if (!conclusion) failures.push('The final independence conclusion has not been recorded.');
    else if (conclusion !== 'satisfied' && conclusion !== 'satisfied_safeguards') {
      failures.push('Independence conclusion does not permit the engagement.');
    }
    if (
      independence.some(
        (a) =>
          ['ind_01', 'ind_02', 'ind_03', 'ind_04'].includes(base(a.questionKey)) &&
          a.details?.conclusion === 'not_acceptable',
      )
    ) {
      failures.push(
        'An independence threat that cannot be reduced to an acceptable level is recorded.',
      );
    }
  }
  if (input.declarationsPending > 0) {
    failures.push(
      `${input.declarationsPending} team independence declaration${input.declarationsPending === 1 ? ' is' : 's are'} still pending.`,
    );
  }

  const preconditions = answersOf('audit_preconditions');
  if (preconditions) {
    const absent = preconditions
      .filter((a) =>
        a.questionKey === 'pre_06'
          ? a.answer === 'yes'
          : /^pre_0[1-5]$/.test(a.questionKey) && a.answer === 'no',
      )
      .map((a) => a.questionKey.toUpperCase().replace('_', '-'));
    if (absent.length > 0) {
      failures.push(`The preconditions for an audit are not present (${absent.join(', ')}).`);
    }
  }
  return failures;
}

/** True when the answer is one of the question's exception answers. */
export function isExceptionAnswer(
  q: AcceptanceQuestionDefinition,
  answer: string | null | undefined,
): boolean {
  return optionOf(q, answer)?.tone === 'exception';
}

/** Matter source key for a question (the back-link from a matter to its question). */
export const acceptanceSource = (segmentKey: string, questionKey: string, sub?: string): string =>
  `acceptance:${segmentKey}:${questionKey}${sub ? `:${sub}` : ''}`;
