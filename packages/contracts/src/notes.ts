/**
 * Engagement Notes vocabulary (Service Configuration spec §26 "Notes"),
 * shared by the API and web.
 *
 * A shared engagement notebook. Any team member may read and add; a note is
 * editable/removable only by its author or an engagement lead. A note can be
 * scoped to the engagement, a service line, or a component (§27/§28).
 */

/** A single engagement note. */
export interface EngagementNote {
  id: string;
  engagementId: string;
  engagementServiceId: string | null;
  engagementComponentId: string | null;
  authorEmployeeId: string | null;
  authorName: string | null;
  body: string;
  isPinned: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
