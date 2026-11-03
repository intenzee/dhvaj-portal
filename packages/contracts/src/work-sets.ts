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

/** One open task on the Assign work screen, and in a set's detail. */
export interface AssignableTask {
  id: string;
  title: string;
  status: string;
  /** ISO date. */
  dueDate: string | null;
  engagementId: string;
  engagementCode: string;
  entityId: string;
  entityName: string;
  officeId: string | null;
  officeCode: string | null;
  /** The filing behind the task, when there is one. */
  instanceId: string | null;
  stream: string | null;
  formLabel: string | null;
  periodKey: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  workSetId: string | null;
  workSetName: string | null;
  /** Not started, paused or waiting on client: it can be handed on. */
  movable: boolean;
}

/** Filters of GET /api/v1/work-sets/open-tasks. */
export interface AssignableTaskFilters {
  stream?: string;
  form?: string;
  /** A period key: '2026-10', '2026-27:Q3', '2026-27'. */
  period?: string;
  entityId?: string;
  officeId?: string;
  /** An employee id, or 'none' for tasks nobody holds. */
  ownerId?: string;
  /** Due within this many days from today, overdue included. */
  dueWithinDays?: number;
}

/** Someone the caller may give work to (GET /api/v1/work-sets/people). */
export interface WorkSetPerson {
  id: string;
  fullName: string;
  gradeName: string | null;
}

/** POST /api/v1/work-sets: give these tasks to one person, as a named set. */
export interface CreateWorkSetInput {
  taskIds: string[];
  assignedToId: string;
  /** Left out: "<form> <period> — <first name>" from the tasks, else "Work for <name>". */
  name?: string | null;
  /** ISO date; every task in the set becomes due then. */
  dueDate?: string | null;
  note?: string | null;
}

/** GET /api/v1/work-sets/:id. */
export interface WorkSetDetail extends WorkSetSummary {
  tasks: AssignableTask[];
  /** The caller may split this set among the people below them. */
  canSplit: boolean;
}

/** POST /api/v1/work-sets/:id/split: hand some of a set's tasks to one person below. */
export interface SplitWorkSetInput {
  taskIds: string[];
  toEmployeeId: string;
  note?: string | null;
}

export interface SplitWorkSetResult {
  moved: number;
}
