import type {
  ClientDependencyStatus,
  EngagementKind,
  PeriodSection,
  TaskPriority,
  TaskStatus,
  WorkFilingContext,
  WorkItemRef,
  WorkType,
} from '@hsdg/contracts';

/** A blocker link shown on a task's detail. */
export interface TaskDependencyRef {
  id: string;
  dependsOnTaskId: string;
  dependsOnTitle: string;
  dependsOnStatus: TaskStatus;
}

export interface TaskRecord {
  id: string;
  engagementId: string;
  title: string;
  description: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  createdById: string | null;
  createdByName: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  /** Derived: open and past its due date (an internal delay). */
  isOverdue: boolean;
  /** Count of this task's blockers that are not yet done. */
  blockedByOpenCount: number;
  completedAt: string | null;
  completedById: string | null;
  completedByName: string | null;
  /** §31 — captured as out-of-scope of the mandate (needs approval before billing). */
  isOutOfScope: boolean;
  /** §31 — this task's effort is billable to the client. */
  isBillable: boolean;
  /** §31 — when the out-of-scope work was approved by a lead (null = pending). */
  outOfScopeApprovedAt: string | null;
  outOfScopeApprovedById: string | null;
  outOfScopeApprovedByName: string | null;
  /** Change 3 — the stream (engagement service) the task belongs to. */
  engagementServiceId: string | null;
  /** The stream key of that service (gst, tds, …) when it is a stream service. */
  stream: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  workType: WorkType | null;
  /** The filing this task produces (generated from a compliance instance). */
  complianceInstanceId: string | null;
  sentForReviewAt: string | null;
  /** When the reviewer opened the current review (their clock is running). */
  reviewStartedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail extends TaskRecord {
  dependsOn: TaskDependencyRef[];
}

/** A task with its engagement context — for the firm-wide "My Work" view. */
export interface MyTaskRecord extends TaskRecord {
  engagementCode: string;
  entityName: string;
  engagementKind: EngagementKind;
  /** WF-102 — the filing's part, year, period and registration (null with no filing). */
  section: PeriodSection | null;
  financialYear: string | null;
  periodKey: string | null;
  registrationNumber: string | null;
  /** The filing the task produces: form, period label and both dates. */
  filing: WorkFilingContext | null;
  /** Where the row opens: the filing (with `taskId`), else the engagement's work tab. */
  link: WorkItemRef;
}

export interface ClientDependencyRecord {
  id: string;
  engagementId: string;
  requestedInfo: string;
  outstandingItems: string | null;
  responsibleId: string | null;
  responsibleName: string | null;
  createdById: string | null;
  createdByName: string | null;
  requestDate: string;
  reminderDate: string | null;
  escalationDate: string | null;
  receivedDate: string | null;
  status: ClientDependencyStatus;
  /** Derived: still waiting on the client (pending / partially received). */
  isOpen: boolean;
  /** Derived: open and past the escalation date (a client delay). */
  isOverdue: boolean;
  /** Derived: open and past the reminder date. */
  reminderDue: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A client dependency with its engagement context — for the firm-wide view. */
export interface ClientDependencyWithContext extends ClientDependencyRecord {
  engagementCode: string;
  entityName: string;
  engagementKind: EngagementKind;
  /** WF-102 — the filing (and upload slot) the request is for, when it is for one. */
  complianceInstanceId: string | null;
  periodSection: PeriodSection | null;
  slotCode: string | null;
  /** Where the row opens: the filing with `requestId`, else the engagement. */
  link: WorkItemRef;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string;
  description?: string;
  assignedToEmployeeId?: string;
  priority?: TaskPriority;
  dueDate?: string;
  /** §31 — flag ad-hoc work as out-of-scope of the current mandate. */
  isOutOfScope?: boolean;
  /** §31 — mark the work billable to the client. */
  isBillable?: boolean;
  engagementServiceId?: string;
  reviewerEmployeeId?: string;
  workType?: WorkType;
  complianceInstanceId?: string;
}

/** §31 — a lead's decision on an out-of-scope request. */
export interface ApproveOutOfScopeInput {
  /** Whether the approved work is billable to the client. */
  isBillable?: boolean;
  version?: number;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  assignedToEmployeeId?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  engagementServiceId?: string | null;
  reviewerEmployeeId?: string | null;
  workType?: WorkType | null;
  version?: number;
}

export interface UpdateTaskStatusInput {
  status: TaskStatus;
  version?: number;
}

/** Filters for the engagement task list (Services → All work, stream "Other work"). */
export interface TaskListFilter {
  status?: TaskStatus;
  assignedToEmployeeId?: string;
  engagementServiceId?: string;
  stream?: string;
  workType?: WorkType;
  complianceInstanceId?: string;
  /** Only live tasks (not done / cancelled). */
  openOnly?: boolean;
}

export interface CreateClientDependencyInput {
  requestedInfo: string;
  outstandingItems?: string;
  responsibleEmployeeId?: string;
  requestDate?: string;
  reminderDate?: string;
  escalationDate?: string;
}

export interface UpdateClientDependencyInput {
  outstandingItems?: string | null;
  responsibleEmployeeId?: string | null;
  reminderDate?: string | null;
  escalationDate?: string | null;
  version?: number;
}

export interface ReceiveClientDependencyInput {
  /** true ⇒ fully received (status=received); false ⇒ partially received. */
  fully: boolean;
  receivedDate?: string;
  outstandingItems?: string;
  version?: number;
}

export interface CloseClientDependencyInput {
  /** 'waived' or 'cancelled'. */
  status: 'waived' | 'cancelled';
  reason: string;
  version?: number;
}
