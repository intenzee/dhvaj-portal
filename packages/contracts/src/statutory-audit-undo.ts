/**
 * Audit file — undo / redo.
 *
 * Every mutating request on the audit file is recorded as one change set (one
 * click = one step). The person who made a change can undo it, and redo it
 * again, as long as nobody has changed the same rows since.
 */

export type AuditChangeOp = 'INSERT' | 'UPDATE' | 'DELETE';

/** What a change set did to one table. */
export interface AuditChangeCount {
  table: string;
  op: AuditChangeOp;
  count: number;
}

/** One undoable / redoable step. */
export interface AuditUndoStep {
  id: string;
  /** The action as the person saw it, e.g. "Approve planning". */
  description: string;
  /** When the change was made. */
  at: string;
  changes: AuditChangeCount[];
}

/** The caller's next undo and redo on an engagement's audit file. */
export interface AuditUndoStatus {
  undo: AuditUndoStep | null;
  redo: AuditUndoStep | null;
}

/** Result of an undo / redo: what was replayed, and what is next. */
export interface AuditUndoResult extends AuditUndoStatus {
  applied: AuditUndoStep;
}

/** Plural-aware noun for an audit table: `audit_pbc_items` → "PBC item". */
export function auditTableNoun(table: string, count: number): string {
  const base = table
    .replace(/^audit_/, '')
    .replace(/_/g, ' ')
    .replace(/\bpbc\b/g, 'PBC')
    .replace(/s$/, '');
  return count === 1 ? base : `${base}s`;
}

/**
 * A readable name for a change: the endpoint's label when there is one,
 * otherwise what it touched ("Changed 2 risks"). Pure.
 */
export function describeAuditChange(label: string | null, changes: AuditChangeCount[]): string {
  if (label && label.trim().length > 0) return label.trim();
  const first = changes[0];
  if (!first) return 'Last change';
  const verb = first.op === 'INSERT' ? 'Added' : first.op === 'DELETE' ? 'Removed' : 'Changed';
  const more = changes.length > 1 ? ' and more' : '';
  return `${verb} ${first.count} ${auditTableNoun(first.table, first.count)}${more}`;
}
