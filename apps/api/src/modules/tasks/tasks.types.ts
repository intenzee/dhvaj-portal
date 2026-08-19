import type { ClientDependencyStatus, TaskPriority, TaskStatus } from '@hsdg/contracts';

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
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string;
  description?: string;
  assignedToEmployeeId?: string;
  priority?: TaskPriority;
  dueDate?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  assignedToEmployeeId?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  version?: number;
}

export interface UpdateTaskStatusInput {
  status: TaskStatus;
  version?: number;
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
