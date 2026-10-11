import type { PoolClient } from 'pg';
import type { FrameworkMemoCard, FrameworkMemoHistoryItem } from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';

/**
 * 02.8 §10–§11 — the Audit Framework Memorandum of each baseline version (Track
 * B). One memo per baseline: draft → submitted → approved (controlled on AF-02,
 * the SharePoint file locked) → superseded when the framework is reopened.
 * A revision gets a NEW memo; an approved one is never silently replaced.
 * DI-free — creation (template merge, SharePoint, Microsoft 365) lives in
 * AuditFrameworkRecordsService.
 */

export const FRAMEWORK_MEMO_WORK_ITEM = '02.8 Audit Framework Summary & Approval';

interface MemoRow {
  id: string;
  document_id: string;
  baseline_version: string;
  status: FrameworkMemoCard['status'];
  submitted_at: Date | null;
  controlled_version_no: number | null;
  created_at: Date;
  filename: string | null;
  title: string;
  current_version_no: number | null;
  prepared_by_name: string | null;
  last_editor_name: string | null;
  last_saved_at: Date | null;
}

const MEMO_SELECT = `
  SELECT m.id, m.document_id, m.baseline_version, m.status, m.submitted_at,
         m.controlled_version_no, m.created_at, cv.filename, d.title, d.current_version_no,
         pb.full_name AS prepared_by_name, ue.full_name AS last_editor_name,
         cv.uploaded_at AS last_saved_at
    FROM hsdg.audit_framework_memo m
    JOIN hsdg.documents d ON d.id = m.document_id
    LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
    LEFT JOIN hsdg.employees ue ON ue.id = cv.uploaded_by_employee_id
    LEFT JOIN hsdg.employees pb ON pb.id = m.prepared_by_employee_id`;

function toCard(r: MemoRow): FrameworkMemoCard {
  const versionNo =
    r.status === 'approved'
      ? (r.controlled_version_no ?? r.current_version_no)
      : r.current_version_no;
  return {
    documentId: r.document_id,
    fileName: r.filename ?? `${r.title}.docx`,
    workItem: FRAMEWORK_MEMO_WORK_ITEM,
    version: versionNo != null ? `v${versionNo}` : null,
    status: r.status,
    preparedByName: r.prepared_by_name,
    lastEditorName: r.last_editor_name,
    lastSavedAt: r.last_saved_at ? r.last_saved_at.toISOString() : null,
    // The Microsoft 365 editor URL is a per-user session — the card opens it on demand.
    webUrl: null,
    baselineVersion: r.baseline_version,
    submittedAt: r.submitted_at ? r.submitted_at.toISOString() : null,
  };
}

export async function readFrameworkMemoOn(
  client: PoolClient,
  _workflowInstanceId: string,
  baselineId: string | null,
): Promise<FrameworkMemoCard | null> {
  if (!baselineId) return null;
  const { rows } = await client.query<MemoRow>(`${MEMO_SELECT} WHERE m.baseline_id = $1`, [
    baselineId,
  ]);
  return rows[0] ? toCard(rows[0]) : null;
}

/** The memo row id of a baseline (the controller addresses memos by id). */
export async function readFrameworkMemoIdOn(
  client: PoolClient,
  baselineId: string | null,
): Promise<string | null> {
  if (!baselineId) return null;
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM hsdg.audit_framework_memo WHERE baseline_id = $1`,
    [baselineId],
  );
  return rows[0]?.id ?? null;
}

/** Every memorandum of the audit file, newest first (approved ones preserved, §14). */
export async function readFrameworkMemoHistoryOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkMemoHistoryItem[]> {
  const { rows } = await client.query<MemoRow>(
    `${MEMO_SELECT} WHERE m.workflow_instance_id = $1 ORDER BY m.created_at DESC`,
    [workflowInstanceId],
  );
  return rows.map((r) => ({
    memoId: r.id,
    documentId: r.document_id,
    fileName: r.filename ?? `${r.title}.docx`,
    baselineVersion: r.baseline_version,
    status: r.status,
    preparedByName: r.prepared_by_name,
    createdAt: r.created_at.toISOString(),
    submittedAt: r.submitted_at ? r.submitted_at.toISOString() : null,
    controlledVersionNo: r.controlled_version_no,
  }));
}

/**
 * Called by AF-02 approval inside its transaction: the submitted memorandum
 * becomes the controlled approved version (§11) and its SharePoint file is
 * locked against edits. Returns the version/reference for the approval record.
 */
export async function controlFrameworkMemoOn(
  client: PoolClient,
  ctx: RlsContext,
  baselineId: string,
): Promise<{ documentId: string; version: string | null; reference: string | null } | null> {
  const { rows } = await client.query<{
    id: string;
    document_id: string;
    current_version_no: number | null;
    filename: string | null;
    title: string;
  }>(
    `UPDATE hsdg.audit_framework_memo m
        SET status = 'approved', controlled_at = now(), controlled_by_employee_id = $2,
            controlled_version_no = d.current_version_no, version = m.version + 1
       FROM hsdg.documents d
       LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
      WHERE m.baseline_id = $1 AND m.status = 'submitted' AND d.id = m.document_id
      RETURNING m.id, m.document_id, d.current_version_no, cv.filename, d.title`,
    [baselineId, ctx.employeeId ?? null],
  );
  const r = rows[0];
  if (!r) return null;
  await client.query(
    `UPDATE hsdg.documents
        SET edit_locked = true,
            edit_locked_reason = 'Approved Audit Framework Memorandum — controlled; reopen the framework to revise.'
      WHERE id = $1`,
    [r.document_id],
  );
  return {
    documentId: r.document_id,
    version: r.current_version_no != null ? `v${r.current_version_no}` : null,
    reference: r.filename ?? r.title,
  };
}

/** Called by AF-02 "Return for Further Work": a submitted memo goes back to draft. */
export async function returnFrameworkMemoOn(
  client: PoolClient,
  _ctx: RlsContext,
  baselineId: string,
): Promise<void> {
  await client.query(
    `UPDATE hsdg.audit_framework_memo
        SET status = 'draft', returned_at = now(), version = version + 1
      WHERE baseline_id = $1 AND status = 'submitted'`,
    [baselineId],
  );
}

/** On reopen (§14–§15): the approved memo of the superseded baseline is preserved as superseded. */
export async function supersedeFrameworkMemoOn(
  client: PoolClient,
  baselineId: string,
): Promise<void> {
  await client.query(
    `UPDATE hsdg.audit_framework_memo
        SET status = 'superseded', superseded_at = now(), version = version + 1
      WHERE baseline_id = $1 AND status = 'approved'`,
    [baselineId],
  );
}
