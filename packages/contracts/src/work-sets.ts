/**
 * Work sets (Phase 2, C-3/C-4): a named batch of tasks a Manager gives to a
 * Senior ("GSTR-1 Oct 2026 — arjun"), which the Senior may split among their
 * Articles. A set may span several engagements.
 */

/** Which side of a set the caller is on (GET /api/v1/work-sets?mine=…). */
export const WORK_SET_SIDES = ['assigned_to', 'assigned_by'] as const;
export type WorkSetSide = (typeof WORK_SET_SIDES)[number];

/** One row of GET /api/v1/work-sets. */
export interface WorkSetSummary {
  id: string;
  name: string;
  assignedToId: string;
  assignedToName: string;
  assignedById: string | null;
  assignedByName: string | null;
  /** ISO date. */
  dueDate: string | null;
  note: string | null;
  taskCount: number;
  /** Tasks not yet done or cancelled. */
  openCount: number;
  doneCount: number;
  createdAt: string;
  closedAt: string | null;
}
