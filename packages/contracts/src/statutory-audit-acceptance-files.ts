import { DOCUMENT_TEMPLATE_KEY, type DocumentTemplateKey } from './document-templates';

/**
 * Section 01 file cards (spec §2, §5.1, §6.2, §10).
 *
 * Every document Section 01 works with sits in a SLOT: the consent certificate,
 * the communication to the previous auditor, the engagement letter, evidence
 * for an answer, and so on. A slot points at an engagement document (never a
 * copy), remembers the template version it was created from, and carries the
 * slot's own working status (e.g. Draft → Ready to Send → Sent).
 *
 * Files are SharePoint-backed: they open from the portal in Microsoft 365, save
 * automatically, and the edits come back into the portal's version history.
 */

export const ACCEPTANCE_FILE_SLOT = {
  /** APP-04 — the company's formal communication of appointment. */
  appointmentCommunication: 'appointment_communication',
  /** §5.1 — Auditor Consent / Eligibility Certificate. */
  consentCertificate: 'consent_certificate',
  /** §6.2 — Communication to Previous Auditor. */
  previousAuditorCommunication: 'previous_auditor_communication',
  /** §6.2 — evidence that the communication was sent. */
  previousAuditorSentEvidence: 'previous_auditor_sent_evidence',
  /** PA-04 — the previous auditor's response. */
  previousAuditorResponse: 'previous_auditor_response',
  /** §10.1 — Statutory Audit Engagement Letter. */
  engagementLetter: 'engagement_letter',
  /** §10.1 — delivery evidence of the issued letter. */
  engagementLetterDelivery: 'engagement_letter_delivery',
  /** §10.1/§10.2 — client acknowledgement / acceptance, where used. */
  clientAcknowledgement: 'client_acknowledgement',
  /** §10.2 — appointment communication / resolution / statutory filing evidence. */
  appointmentFiling: 'appointment_filing',
  /** Evidence for one answer (`evidence:<questionKey>`), where relevant. */
  evidence: 'evidence',
} as const;
export type AcceptanceFileSlot = (typeof ACCEPTANCE_FILE_SLOT)[keyof typeof ACCEPTANCE_FILE_SLOT];

/** Working status of a file in its slot. Evidence slots stay `linked`. */
export const ACCEPTANCE_FILE_STATUS = {
  linked: 'linked',
  draft: 'draft',
  final: 'final',
  readyToSend: 'ready_to_send',
  sent: 'sent',
  partnerReview: 'partner_review',
  approved: 'approved',
  issued: 'issued',
  accepted: 'accepted',
} as const;
export type AcceptanceFileStatus =
  (typeof ACCEPTANCE_FILE_STATUS)[keyof typeof ACCEPTANCE_FILE_STATUS];
export const ACCEPTANCE_FILE_STATUSES: AcceptanceFileStatus[] = Object.values(ACCEPTANCE_FILE_STATUS);

export const ACCEPTANCE_FILE_STATUS_LABEL: Record<AcceptanceFileStatus, string> = {
  linked: 'Linked',
  draft: 'Draft',
  final: 'Final',
  ready_to_send: 'Ready to Send',
  sent: 'Sent',
  partner_review: 'Partner Review',
  approved: 'Approved',
  issued: 'Issued',
  accepted: 'Accepted',
};

/** One status step a user can take on a file card. */
export interface AcceptanceFileTransition {
  from: AcceptanceFileStatus;
  to: AcceptanceFileStatus;
  label: string;
  /** Only the Engagement Partner may take this step. */
  partnerOnly?: boolean;
  /** Fields that must be recorded with this step (stored on the slot). */
  requires?: string[];
}

export interface AcceptanceFileSlotDefinition {
  slot: AcceptanceFileSlot;
  title: string;
  segmentKey: string;
  /** Created from this firm template (Create from Template). */
  templateKey?: DocumentTemplateKey;
  /** The status a newly created / added file starts in. */
  initialStatus: AcceptanceFileStatus;
  /** The statuses this slot moves through, in order (empty = no lifecycle). */
  lifecycle: AcceptanceFileStatus[];
  transitions: AcceptanceFileTransition[];
  /** More than one file may sit in the slot (evidence); otherwise one. */
  multiple: boolean;
}

export const ACCEPTANCE_FILE_SLOTS: readonly AcceptanceFileSlotDefinition[] = [
  {
    slot: ACCEPTANCE_FILE_SLOT.appointmentCommunication,
    title: 'Appointment communication from the company',
    segmentKey: 'appointment_eligibility',
    initialStatus: 'linked',
    lifecycle: [],
    transitions: [],
    multiple: true,
  },
  {
    slot: ACCEPTANCE_FILE_SLOT.consentCertificate,
    title: 'Auditor Consent / Eligibility Certificate',
    segmentKey: 'appointment_eligibility',
    templateKey: DOCUMENT_TEMPLATE_KEY.auditorConsentCertificate,
    initialStatus: 'draft',
    lifecycle: ['draft', 'final'],
    transitions: [
      { from: 'draft', to: 'final', label: 'Mark Final' },
      { from: 'final', to: 'draft', label: 'Reopen', requires: ['reopenReason'] },
    ],
    multiple: false,
  },
  {
    slot: ACCEPTANCE_FILE_SLOT.previousAuditorCommunication,
    title: 'Communication to Previous Auditor',
    segmentKey: 'previous_auditor',
    templateKey: DOCUMENT_TEMPLATE_KEY.previousAuditorCommunication,
    initialStatus: 'draft',
    lifecycle: ['draft', 'ready_to_send', 'sent'],
    transitions: [
      { from: 'draft', to: 'ready_to_send', label: 'Mark Ready' },
      { from: 'ready_to_send', to: 'draft', label: 'Back to Draft' },
      {
        from: 'ready_to_send',
        to: 'sent',
        label: 'Mark Sent',
        requires: ['sentDate', 'sentMode'],
      },
      { from: 'sent', to: 'draft', label: 'Reopen', requires: ['reopenReason'] },
    ],
    multiple: false,
  },
  {
    slot: ACCEPTANCE_FILE_SLOT.previousAuditorSentEvidence,
    title: 'Evidence of communication',
    segmentKey: 'previous_auditor',
    initialStatus: 'linked',
    lifecycle: [],
    transitions: [],
    multiple: true,
  },
  {
    slot: ACCEPTANCE_FILE_SLOT.previousAuditorResponse,
    title: "Previous auditor's response",
    segmentKey: 'previous_auditor',
    initialStatus: 'linked',
    lifecycle: [],
    transitions: [],
    multiple: true,
  },
  {
    slot: ACCEPTANCE_FILE_SLOT.engagementLetter,
    title: 'Statutory Audit Engagement Letter',
    segmentKey: 'engagement_letter',
    templateKey: DOCUMENT_TEMPLATE_KEY.engagementLetter,
    initialStatus: 'draft',
    lifecycle: ['draft', 'partner_review', 'approved', 'issued', 'accepted'],
    transitions: [
      { from: 'draft', to: 'partner_review', label: 'Submit for Partner Review' },
      { from: 'partner_review', to: 'approved', label: 'Approve letter', partnerOnly: true },
      { from: 'partner_review', to: 'draft', label: 'Return to Draft', partnerOnly: true },
      {
        from: 'approved',
        to: 'issued',
        label: 'Mark Issued',
        requires: ['issuedDate', 'deliveryMode'],
      },
      { from: 'issued', to: 'accepted', label: 'Mark Accepted by client', requires: ['acceptedDate'] },
      { from: 'approved', to: 'draft', label: 'Reopen', partnerOnly: true, requires: ['reopenReason'] },
    ],
    multiple: false,
  },
  {
    slot: ACCEPTANCE_FILE_SLOT.engagementLetterDelivery,
    title: 'Delivery evidence',
    segmentKey: 'engagement_letter',
    initialStatus: 'linked',
    lifecycle: [],
    transitions: [],
    multiple: true,
  },
  {
    slot: ACCEPTANCE_FILE_SLOT.clientAcknowledgement,
    title: 'Client Acknowledgement / Acceptance',
    segmentKey: 'engagement_letter',
    templateKey: DOCUMENT_TEMPLATE_KEY.clientAcknowledgement,
    initialStatus: 'draft',
    lifecycle: ['draft', 'final'],
    transitions: [
      { from: 'draft', to: 'final', label: 'Mark Signed / Final' },
      { from: 'final', to: 'draft', label: 'Reopen', requires: ['reopenReason'] },
    ],
    multiple: false,
  },
  {
    slot: ACCEPTANCE_FILE_SLOT.appointmentFiling,
    title: 'Appointment resolution / statutory filing evidence',
    segmentKey: 'engagement_letter',
    initialStatus: 'linked',
    lifecycle: [],
    transitions: [],
    multiple: true,
  },
] as const;

/** Slot keys are `<slot>` or, for per-answer evidence, `evidence:<questionKey>`. */
export function slotOf(slotKey: string): AcceptanceFileSlotDefinition | null {
  const base = slotKey.split(':')[0];
  if (base === ACCEPTANCE_FILE_SLOT.evidence) {
    const sub = slotKey.slice(base.length + 1);
    if (!/^[a-z0-9_]{2,60}$/.test(sub)) return null;
    return {
      slot: ACCEPTANCE_FILE_SLOT.evidence,
      title: 'Supporting evidence',
      segmentKey: '',
      initialStatus: 'linked',
      lifecycle: [],
      transitions: [],
      multiple: true,
    };
  }
  return ACCEPTANCE_FILE_SLOTS.find((s) => s.slot === slotKey) ?? null;
}

export const evidenceSlot = (questionKey: string): string =>
  `${ACCEPTANCE_FILE_SLOT.evidence}:${questionKey}`;

/** The SharePoint side of a file, when Microsoft 365 holds a live copy. */
export interface AcceptanceFileLive {
  lastEditedBy: string | null;
  lastSavedAt: string | null;
}

/** A file in a Section 01 slot, as the file card shows it. */
export interface AcceptanceFileRecord {
  id: string;
  slotKey: string;
  documentId: string;
  title: string;
  filename: string | null;
  status: AcceptanceFileStatus;
  /** Details recorded with status steps (sent date, mode, remarks …). */
  meta: Record<string, string | null>;
  /** The template + version the file was created from (kept for history). */
  templateKey: string | null;
  templateVariantKey: string | null;
  templateVersionNo: number | null;
  /** Portal version of the document. */
  currentVersionNo: number;
  lastEditedBy: string | null;
  lastSavedAt: string | null;
  /** True when a live SharePoint copy exists (opens in Microsoft 365). */
  inSharePoint: boolean;
  /** Approved work: the file opens read-only until the card is reopened. */
  editLocked: boolean;
  version: number;
}

/** One entry of a file's version history (SharePoint's when it holds the file). */
export interface FileVersionEntry {
  id: string;
  label: string;
  editedBy: string | null;
  savedAt: string;
  sizeBytes: number | null;
}

export interface FileVersionHistory {
  /** Where the history comes from. */
  source: 'sharepoint' | 'portal';
  entries: FileVersionEntry[];
}

export interface CreateAcceptanceFileFromTemplateInput {
  slotKey: string;
  /** Pick a variant explicitly; otherwise the applicable one is chosen. */
  variantKey?: string;
}

export interface AddAcceptanceFileInput {
  slotKey: string;
  title?: string;
  filename: string;
  contentType?: string;
  contentBase64: string;
}

export interface LinkAcceptanceFileInput {
  slotKey: string;
  documentId: string;
}

export interface SetAcceptanceFileStatusInput {
  status: AcceptanceFileStatus;
  meta?: Record<string, string | null>;
  version: number;
}

/** Modes for sending the communication to the previous auditor (spec §6.2). */
export const PREVIOUS_AUDITOR_SENT_MODES = [
  { value: 'email', label: 'Email' },
  { value: 'registered_post', label: 'Registered Post' },
  { value: 'speed_post', label: 'Speed Post' },
  { value: 'hand_delivery', label: 'Hand Delivery' },
  { value: 'other', label: 'Other' },
] as const;

/** Modes of delivering the engagement letter (spec §10.1). */
export const ENGAGEMENT_LETTER_DELIVERY_MODES = [
  { value: 'email', label: 'Email' },
  { value: 'portal', label: 'Portal' },
  { value: 'physical', label: 'Physical' },
  { value: 'other', label: 'Other' },
] as const;

/** Labels for the details recorded with a status step. */
export const ACCEPTANCE_FILE_META_LABEL: Record<string, string> = {
  sentDate: 'Date communicated',
  sentMode: 'Mode',
  remarks: 'Remarks',
  issuedDate: 'Issued date',
  deliveryMode: 'Mode of delivery',
  acceptedDate: 'Accepted on',
  reopenReason: 'Reason for reopening',
};

/** Meta keys holding a date (YYYY-MM-DD). */
export const ACCEPTANCE_FILE_DATE_META = ['sentDate', 'issuedDate', 'acceptedDate'] as const;

/**
 * Statuses in which a file is approved / issued work: its document takes no new
 * versions until the card is reopened with a reason (spec §2 "Approved Work").
 */
export const ACCEPTANCE_FILE_LOCKED_STATUSES: AcceptanceFileStatus[] = [
  'final',
  'partner_review',
  'sent',
  'approved',
  'issued',
  'accepted',
];

export function isLockedFileStatus(status: AcceptanceFileStatus): boolean {
  return ACCEPTANCE_FILE_LOCKED_STATUSES.includes(status);
}

/**
 * Check a status step on a file card. Returns why it is refused, or null.
 * Pure — the API enforces it and the web uses it to offer only valid steps.
 */
export function fileTransitionError(
  def: AcceptanceFileSlotDefinition,
  from: AcceptanceFileStatus,
  to: AcceptanceFileStatus,
  meta: Record<string, string | null | undefined>,
  isEngagementPartner: boolean,
): string | null {
  const step = def.transitions.find((t) => t.from === from && t.to === to);
  if (!step) {
    return `${ACCEPTANCE_FILE_STATUS_LABEL[from]} → ${ACCEPTANCE_FILE_STATUS_LABEL[to]} is not a step for ${def.title}.`;
  }
  if (step.partnerOnly && !isEngagementPartner) {
    return `Only the Engagement Partner can ${step.label.toLowerCase()}.`;
  }
  for (const key of step.requires ?? []) {
    const v = meta[key];
    if (v == null || String(v).trim() === '') {
      return `${ACCEPTANCE_FILE_META_LABEL[key] ?? key} is required to ${step.label.toLowerCase()}.`;
    }
    if ((ACCEPTANCE_FILE_DATE_META as readonly string[]).includes(key) && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      return `${ACCEPTANCE_FILE_META_LABEL[key]} must be a date.`;
    }
  }
  return null;
}

/** The steps offered from a status (partner-only steps only to the partner). */
export function availableFileTransitions(
  def: AcceptanceFileSlotDefinition,
  from: AcceptanceFileStatus,
  isEngagementPartner: boolean,
): AcceptanceFileTransition[] {
  return def.transitions.filter((t) => t.from === from && (!t.partnerOnly || isEngagementPartner));
}

/** Whether an approved firm template can be used for a format right now. */
export interface AcceptanceTemplateAvailability {
  templateKey: DocumentTemplateKey;
  title: string;
  /** The variant that applies to this engagement, when one has an approved file. */
  variantKey: string | null;
  versionNo: number | null;
  available: boolean;
  /** Why Create from Template is unavailable (shown on the button). */
  reason: string | null;
}

/** GET …/acceptance/files */
export interface AcceptanceFilesView {
  workflowInstanceId: string;
  /** True once Section 01 is approved — every card is read-only until reopened. */
  sectionLocked: boolean;
  /** True when the caller is the engagement's Engagement Partner. */
  callerIsEngagementPartner: boolean;
  /** True when files open in Microsoft 365 (SharePoint) rather than the built-in editor. */
  m365Enabled: boolean;
  files: AcceptanceFileRecord[];
  templates: AcceptanceTemplateAvailability[];
}
