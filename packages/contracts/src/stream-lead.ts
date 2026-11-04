/**
 * Changing a stream's lead (an engagement service line's lead) after set-up.
 * Administrator and Managing Partner only.
 */

/** PUT /engagements/:id/service-lines/:lineId/lead */
export interface SetServiceLineLeadInput {
  /** The new lead, or null for none. */
  employeeId: string | null;
}

export interface ServiceLineLeadResult {
  engagementServiceId: string;
  leadEmployeeId: string | null;
  leadName: string | null;
  previousLeadEmployeeId: string | null;
}

/** Who may change a stream lead (role slugs). */
export const STREAM_LEAD_ROLES = ['admin', 'managing_partner'] as const;
