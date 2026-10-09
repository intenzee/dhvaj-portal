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
const NA: AcceptanceOption = { value: 'na', label: 'N/A', tone: 'clear' };

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

  // 01.2 – 01.7: the methodology's earlier Yes / No / N/A checks, until each
  // segment's full question set lands.
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
  ...legacy('previous_auditor', [
    [
      'communication_sent',
      'Communication with the previous auditor has been made (Clause 8, First Schedule).',
      'no',
    ],
    [
      'no_professional_objection',
      'No professional reason from the previous auditor prevents acceptance.',
      'no',
    ],
  ]),
  ...legacy('acceptance_continuance', [
    ['management_integrity_concern', 'There are concerns over management integrity.', 'yes'],
    [
      'resources_competence',
      'The firm has the competence, resources and time to perform the audit.',
      'no',
    ],
  ]),
  ...legacy('independence_ethics', [
    [
      'independence_threats',
      'Threats to independence have been identified that need safeguards.',
      'yes',
    ],
    [
      'prohibited_services',
      'The firm provides services prohibited under Sec 144 to this client.',
      'yes',
    ],
  ]),
  ...legacy('audit_preconditions', [
    [
      'acceptable_framework',
      'The financial reporting framework to be applied is acceptable (SA 210).',
      'no',
    ],
    [
      'management_responsibilities',
      'Management acknowledges its responsibilities (premise of the audit).',
      'no',
    ],
    ['no_scope_limitation', 'Management imposes a scope limitation precluding an opinion.', 'yes'],
  ]),
  // 01.7 has no questions: it follows the engagement letter's file lifecycle
  // (see SEGMENT_RULES.engagement_letter).
];

function legacy(
  segmentKey: string,
  rows: readonly [string, string, 'yes' | 'no'][],
): AcceptanceQuestionDefinition[] {
  return rows.map(([questionKey, prompt, adverse]) => ({
    segmentKey,
    questionKey,
    code: '',
    prompt,
    control: 'choice' as const,
    options: [adverse === 'yes' ? YES_EXC : YES_CLEAR, adverse === 'no' ? NO_EXC : NO_CLEAR, NA],
    details: [{ when: [adverse], fields: [EXPLAIN] }],
  }));
}

export function questionsFor(segmentKey: string): AcceptanceQuestionDefinition[] {
  return ACCEPTANCE_QUESTIONS.filter((q) => q.segmentKey === segmentKey);
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
    const s = effective[q.questionKey];
    if (s?.answer != null || (s && Object.keys(s.details ?? {}).length > 0)) touched = true;
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
  const pending = items.filter((i) => i.kind === 'pending').map((i) => i.text);
  const attention = items.filter((i) => i.kind === 'attention').map((i) => i.text);
  const blockingHere = ctx.openBlockingSources.some((s) =>
    s.startsWith(`acceptance:${segmentKey}:`),
  );

  let state: DerivedSegmentState;
  if (!touched && answered === 0) state = 'not_started';
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
  previous_auditor: {
    notApplicable: (_answers, ctx) =>
      ctx.firstYear === false ? 'continuing engagement — DHVAJ was the auditor last year.' : null,
  },
};

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
