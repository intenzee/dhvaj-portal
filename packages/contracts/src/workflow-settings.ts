/**
 * Staff Workflow · Questions for the partners, answered as firm settings
 * (Admin → Workflow). GET /workflow-settings, PATCH by `workflow.manage`.
 */
import type { FirmChecks } from './firm-checks';

/** Who reviews a task sent for review without a reviewer named. */
export const DEFAULT_REVIEWER = {
  streamLead: 'stream_lead',
  engagementManager: 'engagement_manager',
  engagementPartner: 'engagement_partner',
} as const;
export type DefaultReviewer = (typeof DEFAULT_REVIEWER)[keyof typeof DEFAULT_REVIEWER];
export const DEFAULT_REVIEWERS: DefaultReviewer[] = Object.values(DEFAULT_REVIEWER);
export const DEFAULT_REVIEWER_LABEL: Record<DefaultReviewer, string> = {
  stream_lead: 'The stream lead',
  engagement_manager: 'The engagement manager',
  engagement_partner: 'The engagement partner',
};

/** Which clients an article sees. */
export const ARTICLE_CLIENT_SCOPE = { office: 'office', engagements: 'engagements' } as const;
export type ArticleClientScope = (typeof ARTICLE_CLIENT_SCOPE)[keyof typeof ARTICLE_CLIENT_SCOPE];
export const ARTICLE_CLIENT_SCOPES: ArticleClientScope[] = Object.values(ARTICLE_CLIENT_SCOPE);
export const ARTICLE_CLIENT_SCOPE_LABEL: Record<ArticleClientScope, string> = {
  office: 'Every client in their office',
  engagements: 'Only clients they work on',
};

/** How a client reminder goes out. */
export const REMINDER_CHANNEL_SETTING = {
  email: 'email',
  whatsapp: 'whatsapp',
  copy: 'copy',
} as const;
export type ReminderChannelSetting =
  (typeof REMINDER_CHANNEL_SETTING)[keyof typeof REMINDER_CHANNEL_SETTING];
export const REMINDER_CHANNEL_SETTINGS: ReminderChannelSetting[] =
  Object.values(REMINDER_CHANNEL_SETTING);
export const REMINDER_CHANNEL_SETTING_LABEL: Record<ReminderChannelSetting, string> = {
  email: 'Email from the portal',
  whatsapp: 'WhatsApp message',
  copy: 'Text to copy and paste',
};

/** Who may bulk-assign in a filing run. */
export const BULK_ASSIGN_SCOPE = {
  managers: 'managers',
  managersAndLeads: 'managers_and_leads',
} as const;
export type BulkAssignScope = (typeof BULK_ASSIGN_SCOPE)[keyof typeof BULK_ASSIGN_SCOPE];
export const BULK_ASSIGN_SCOPES: BulkAssignScope[] = Object.values(BULK_ASSIGN_SCOPE);
export const BULK_ASSIGN_SCOPE_LABEL: Record<BulkAssignScope, string> = {
  managers: 'Managers and partners only',
  managers_and_leads: 'Managers, partners and stream leads',
};

/** GET /workflow-settings */
export interface WorkflowSettings {
  defaultReviewer: DefaultReviewer;
  articleClientScope: ArticleClientScope;
  clientReminderChannel: ReminderChannelSetting;
  bulkAssignScope: BulkAssignScope;
  /** Remind the client this many days before the filing's internal due date. */
  clientReminderDays: number;
  /** Escalate to the stream lead this many days before it. */
  clientEscalationDays: number;
  /** The firm's checks, each on or off (Admin → Workflow → Checks). */
  checks: FirmChecks;
  /** Whether the viewer may switch checks: the managing partner or the administrator. */
  checksEditable: boolean;
  /** Optimistic lock: send it back on PATCH. */
  version: number;
  updatedAt: string;
  updatedByName: string | null;
}

/** PATCH /workflow-settings — any subset, with the version read. */
export interface UpdateWorkflowSettingsInput {
  version: number;
  defaultReviewer?: DefaultReviewer;
  articleClientScope?: ArticleClientScope;
  clientReminderChannel?: ReminderChannelSetting;
  bulkAssignScope?: BulkAssignScope;
  clientReminderDays?: number;
  clientEscalationDays?: number;
}

/** One form's internal due date: so many days before the statutory date. */
export interface FormInternalDue {
  ruleId: string;
  ruleCode: string;
  /** e.g. "GSTR-1", else the rule's name. */
  label: string;
  /** The work stream (gst, tds …) the form belongs to, when known. */
  stream: string | null;
  /** T-minus days in the version in force today. */
  internalSlaOffsetDays: number;
  /** The plan's suggestion for this form, when it has one (GSTR-1 T-2 …). */
  suggestedDays: number | null;
}

/** GET /workflow-settings/internal-due */
export interface FormInternalDueList {
  items: FormInternalDue[];
}

/** PATCH /workflow-settings/internal-due/:ruleId */
export interface UpdateFormInternalDueInput {
  internalSlaOffsetDays: number;
}

/** The plan's starting points (Questions for the partners, 1). */
export const SUGGESTED_INTERNAL_DUE_DAYS: Readonly<Record<string, number>> = {
  'GSTR-1': 2,
  'GSTR-3B': 3,
  TDS: 3,
};

/** PATCH /workflow-settings/internal-due/:ruleId */
export interface FormInternalDueUpdate {
  item: FormInternalDue;
  /** Open filings whose internal due date moved (those without a manual override). */
  filingsRedated: number;
}

/** The plan's suggestion for a form, if any: GSTR-1 T-2, GSTR-3B T-3, TDS T-3. */
export function suggestedInternalDueDays(label: string, stream: string | null): number | null {
  for (const [form, days] of Object.entries(SUGGESTED_INTERNAL_DUE_DAYS)) {
    if (form === 'TDS' ? stream === 'tds' : label === form || label.startsWith(`${form} `)) {
      return days;
    }
  }
  return null;
}
