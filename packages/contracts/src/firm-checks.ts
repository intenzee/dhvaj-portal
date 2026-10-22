/**
 * The firm's checks (Admin → Workflow → Checks). Each is a rule the portal
 * used to enforce; while a check is off the work goes ahead and the portal
 * warns instead. All are off until the managing partner or the administrator
 * switches one on (firm_settings.strict_checks; a missing key is off).
 */
export const FIRM_CHECK = {
  // Lodging a filing
  lodgeAssigneeOnly: 'lodge_assignee_only',
  lodgeReadyToFile: 'lodge_ready_to_file',
  lodgeAckRequired: 'lodge_ack_required',
  lodgeReferenceRequired: 'lodge_reference_required',
  lodgeDateRules: 'lodge_date_rules',
  lodgeFiguresRequired: 'lodge_figures_required',
  lodgeFiledByTeam: 'lodge_filed_by_team',
  lockAfterSummary: 'lock_after_summary',
  waiveLeadOnly: 'waive_lead_only',
  undoLeadOnly: 'undo_lead_only',
  // Checklist
  checklistAutoSteps: 'checklist_auto_steps',
  checklistNaLeadOnly: 'checklist_na_lead_only',
  clientApprovalBlocks: 'client_approval_blocks',
  // Tasks and review
  reviewRequired: 'review_required',
  taskAssigneeOnly: 'task_assignee_only',
  taskAssignTeamOnly: 'task_assign_team_only',
  taskReasonsRequired: 'task_reasons_required',
  taskReopenLeadOnly: 'task_reopen_lead_only',
  taskBlockers: 'task_blockers',
  // Engagements and access
  engagementPartnerRequired: 'engagement_partner_required',
  independenceAckRequired: 'independence_ack_required',
  oneComplianceEngagement: 'one_compliance_engagement',
  teamOnlyAccess: 'team_only_access',
} as const;
export type FirmCheckKey = (typeof FIRM_CHECK)[keyof typeof FIRM_CHECK];
export const FIRM_CHECK_KEYS: FirmCheckKey[] = Object.values(FIRM_CHECK);

/** Each check on (true) or off; every key is present. */
export type FirmChecks = Record<FirmCheckKey, boolean>;

/** All off: the firm's starting point, and what a missing key means. */
export const RELAXED_FIRM_CHECKS: FirmChecks = Object.fromEntries(
  FIRM_CHECK_KEYS.map((k) => [k, false]),
) as FirmChecks;

/** Every check on: the portal as it was before the checks could be switched off. */
export const STRICT_FIRM_CHECKS: FirmChecks = Object.fromEntries(
  FIRM_CHECK_KEYS.map((k) => [k, true]),
) as FirmChecks;

/** A stored map (strict_checks) read as the full set; unknown keys are ignored. */
export function toFirmChecks(stored: Record<string, unknown> | null | undefined): FirmChecks {
  return Object.fromEntries(FIRM_CHECK_KEYS.map((k) => [k, stored?.[k] === true])) as FirmChecks;
}

export interface FirmCheckInfo {
  key: FirmCheckKey;
  /** What the check enforces when it is on. */
  label: string;
  /** What happens while it is off. */
  whenOff: string;
}

export interface FirmCheckGroup {
  title: string;
  checks: FirmCheckInfo[];
}

/** The Checks panel, in order. */
export const FIRM_CHECK_GROUPS: FirmCheckGroup[] = [
  {
    title: 'Lodging a filing',
    checks: [
      {
        key: FIRM_CHECK.lodgeAssigneeOnly,
        label: 'Only the assignee, or the engagement partner or manager, can lodge',
        whenOff: 'Anyone who can work on the engagement can lodge.',
      },
      {
        key: FIRM_CHECK.lodgeReadyToFile,
        label: 'A filing must be Ready to file (reviewer approved) before staff lodge it',
        whenOff: 'A filing can be lodged at any stage.',
      },
      {
        key: FIRM_CHECK.lodgeAckRequired,
        label: 'The acknowledgement must be uploaded to lodge',
        whenOff: 'Optional; the filing shows "Ack missing" until one is added.',
      },
      {
        key: FIRM_CHECK.lodgeReferenceRequired,
        label: 'The reference number (ARN / SRN …) is required and checked',
        whenOff: 'Optional; a wrong format is a warning.',
      },
      {
        key: FIRM_CHECK.lodgeDateRules,
        label: 'The filing date cannot be in the future or before the period ends',
        whenOff: 'Such a date is a warning.',
      },
      {
        key: FIRM_CHECK.lodgeFiguresRequired,
        label: 'GSTR-3B, PMT-06 and CMP-08 figures are required to lodge',
        whenOff: 'Figures are optional.',
      },
      {
        key: FIRM_CHECK.lodgeFiledByTeam,
        label: '"Filed by" must be on the engagement team',
        whenOff: 'Anyone in the firm.',
      },
      {
        key: FIRM_CHECK.lockAfterSummary,
        label: 'GSTR-1 and Inward lock once the month’s GSTR-3B is filed',
        whenOff: 'They stay editable.',
      },
      {
        key: FIRM_CHECK.waiveLeadOnly,
        label: 'Only the engagement partner or manager can mark a filing Not applicable',
        whenOff: 'Anyone who can work on the engagement, with a reason.',
      },
      {
        key: FIRM_CHECK.undoLeadOnly,
        label: 'Only the partner or manager can undo a lodge (a partner after 24 hours)',
        whenOff: 'Anyone who can work on the engagement, within 7 days.',
      },
    ],
  },
  {
    title: 'Checklist',
    checks: [
      {
        key: FIRM_CHECK.checklistAutoSteps,
        label: 'Steps that tick themselves (upload, review, AGM) cannot be ticked by hand',
        whenOff: 'They can be ticked by hand too.',
      },
      {
        key: FIRM_CHECK.checklistNaLeadOnly,
        label: 'Only the partner or manager can mark a required step Not applicable, with a reason',
        whenOff: 'Anyone who can work on the engagement; the reason is optional.',
      },
      {
        key: FIRM_CHECK.clientApprovalBlocks,
        label: 'An open client-approval step holds the filing in review',
        whenOff: 'It does not hold the filing back.',
      },
    ],
  },
  {
    title: 'Tasks and review',
    checks: [
      {
        key: FIRM_CHECK.reviewRequired,
        label: 'Tasks get a reviewer and go through review before Done',
        whenOff: 'Review only when someone asks for it; the person doing the work marks it Done.',
      },
      {
        key: FIRM_CHECK.taskAssigneeOnly,
        label: 'Only the assignee can start or complete a task',
        whenOff: 'Anyone who can work on the engagement.',
      },
      {
        key: FIRM_CHECK.taskAssignTeamOnly,
        label: 'Tasks can be assigned only to the engagement team',
        whenOff: 'Anyone in the office; they join the team.',
      },
      {
        key: FIRM_CHECK.taskReasonsRequired,
        label: 'Review points and client needs must be written down',
        whenOff: 'Optional.',
      },
      {
        key: FIRM_CHECK.taskReopenLeadOnly,
        label: 'Only the partner or manager can reopen a finished task',
        whenOff: 'Anyone who can work on the engagement.',
      },
      {
        key: FIRM_CHECK.taskBlockers,
        label: 'A task waiting on another task cannot be completed',
        whenOff: 'A warning instead.',
      },
    ],
  },
  {
    title: 'Engagements and access',
    checks: [
      {
        key: FIRM_CHECK.engagementPartnerRequired,
        label: 'An accepted engagement needs an Engagement Partner picked',
        whenOff: 'It defaults to the creating partner, or is filled in later.',
      },
      {
        key: FIRM_CHECK.independenceAckRequired,
        label: 'Independence warnings need a partner’s acknowledgement',
        whenOff: 'They are shown for information. ICAI blocks always apply.',
      },
      {
        key: FIRM_CHECK.oneComplianceEngagement,
        label: 'A client with an open Compliance engagement cannot get another',
        whenOff: 'The portal offers to add the year or stream to the open one.',
      },
      {
        key: FIRM_CHECK.teamOnlyAccess,
        label: 'Only the engagement team can open and work on an engagement',
        whenOff: 'Anyone in the engagement’s office can work on it.',
      },
    ],
  },
];

/** PATCH /workflow-settings/checks — the full or partial map, with the version read. */
export interface UpdateFirmChecksInput {
  version: number;
  checks: Partial<FirmChecks>;
}
