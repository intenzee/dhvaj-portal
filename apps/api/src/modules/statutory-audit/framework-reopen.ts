import type { PoolClient } from 'pg';
import type { FrameworkSourceSection, SubSectionKey } from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';
import { LEGACY_AREA_KEYS_BY_SECTION, bumpMinor } from './framework-summary-engine';
import { onFrameworkReopenedOn } from './framework-summary-impact';

/**
 * 02.8 §15 controlled reopen — DI-free, so both the 02.8 summary (a lead's
 * reopen) and Section 08 Reassessment (a framework-impact change) open the
 * next baseline version the same way. The caller holds the per-file baseline
 * lock and has checked the role; this supersedes the approved baseline (kept
 * forever), opens the next draft with the §15 fields, flags only the affected
 * sections for re-evaluation, re-opens Phase 02 and hands over to Track B.
 */
export interface FrameworkReopenInput {
  reason: string;
  affectedSections: FrameworkSourceSection[];
  identifiedAt: string;
  identifiedByEmployeeId?: string | null;
  evidenceNote?: string | null;
  evidenceDocumentId?: string | null;
  reapprovalRequired: boolean;
}

export interface FrameworkReopenResult {
  fromVersion: string;
  toVersion: string;
  baselineId: string;
  affectedSections: FrameworkSourceSection[];
}

export async function reopenFrameworkBaselineOn(
  client: PoolClient,
  ctx: RlsContext,
  engagementId: string,
  workflowInstanceId: string,
  approved: { id: string; version: string },
  input: FrameworkReopenInput,
): Promise<FrameworkReopenResult> {
  await client.query(
    `UPDATE hsdg.audit_framework_baseline
        SET status = 'superseded', superseded_at = now(), record_version = record_version + 1
      WHERE id = $1`,
    [approved.id],
  );
  const toVersion = bumpMinor(approved.version);
  const affected = [...new Set(input.affectedSections)];
  const reason = input.reason.trim();
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO hsdg.audit_framework_baseline
       (workflow_instance_id, engagement_id, version, status, reopen_reason,
        reopen_affected_sections, reopen_identified_at, reopen_identified_by_employee_id,
        reopen_evidence_note, reopen_evidence_document_id, reopen_reapproval_required,
        reopened_by_employee_id, reopened_at, reopened_from_version)
     VALUES ($1, $2, $3, 'draft', $4, $5::text[], $6::timestamptz, $7, $8, $9, $10, $11, now(), $12)
     RETURNING id`,
    [
      workflowInstanceId,
      engagementId,
      toVersion,
      reason,
      affected,
      input.identifiedAt,
      input.identifiedByEmployeeId ?? ctx.employeeId ?? null,
      input.evidenceNote?.trim() || null,
      input.evidenceDocumentId ?? null,
      input.reapprovalRequired,
      ctx.employeeId ?? null,
      approved.version,
    ],
  );
  // Reopen only the affected sections: the user edits the originating section,
  // never a duplicate value here. Unaffected conclusions stay approved.
  const subs = affected.filter((s): s is SubSectionKey => s !== '02.1' && s !== 'other_areas');
  if (subs.length)
    await client.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET needs_reevaluation = true,
              state = CASE WHEN state = 'approved' THEN 'reassessment_required' ELSE state END
        WHERE workflow_instance_id = $1 AND sub_section_key = ANY($2::text[])`,
      [workflowInstanceId, subs],
    );
  if (affected.includes('02.1'))
    await client.query(
      `UPDATE hsdg.audit_entity_profile SET needs_reevaluation = true
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
  await client.query(
    `UPDATE hsdg.audit_framework_assessments SET state = 'reassessment_required'
      WHERE workflow_instance_id = $1 AND state = 'approved' AND area_key = ANY($2::text[])`,
    [workflowInstanceId, affected.flatMap((s) => [...LEGACY_AREA_KEYS_BY_SECTION[s]])],
  );
  await client.query(
    `UPDATE hsdg.audit_workflow_phases SET state = 'needs_attention'
      WHERE workflow_instance_id = $1 AND phase_key = 'framework'`,
    [workflowInstanceId],
  );
  // Track B: impact first pass, notifications, Section 07/08 surfacing.
  await onFrameworkReopenedOn(client, ctx, {
    workflowInstanceId,
    engagementId,
    fromBaselineId: approved.id,
    toBaselineId: rows[0]!.id,
    fromVersion: approved.version,
    toVersion,
    reason,
    affectedSections: affected,
  });
  return {
    fromVersion: approved.version,
    toVersion,
    baselineId: rows[0]!.id,
    affectedSections: affected,
  };
}

/** The approved, live baseline of a file (null when none / already reopened). */
export async function readLiveApprovedBaselineOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<{ id: string; version: string } | null> {
  const { rows } = await client.query<{ id: string; version: string }>(
    `SELECT id, version FROM hsdg.audit_framework_baseline
      WHERE workflow_instance_id = $1 AND status = 'approved'
      ORDER BY created_at DESC LIMIT 1`,
    [workflowInstanceId],
  );
  return rows[0] ?? null;
}

/** Per-file transaction lock around a baseline read-check-write. */
export async function lockFrameworkBaselineOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('audit_framework_baseline:' || $1))`, [
    workflowInstanceId,
  ]);
}
