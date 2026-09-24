import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { PlanningAttention, PlanningSignalSource } from '@hsdg/contracts';

/**
 * Helpers shared by the 03.1 services (Planning Intelligence + strategy
 * sub-sections). Everything here runs inside the caller's RLS transaction.
 */

/** Tables carrying a per-instance display sequence (PS-/FA-/PY-/PM-00n). */
export type PlanningSeqTable =
  | 'audit_planning_signal'
  | 'audit_area_of_focus'
  | 'audit_prior_year_matter'
  | 'audit_planning_matter';

export function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function cleanList(v: readonly string[] | undefined): string[] {
  return [...new Set((v ?? []).map((s) => s.trim()).filter(Boolean))];
}

export function displayCode(prefix: string, seq: number | null | undefined): string | null {
  return seq == null ? null : `${prefix}-${String(seq).padStart(3, '0')}`;
}

export async function maxSeq(
  client: PoolClient,
  table: PlanningSeqTable,
  workflowInstanceId: string,
): Promise<number> {
  const { rows } = await client.query<{ m: number }>(
    `SELECT COALESCE(MAX(seq), 0) AS m FROM hsdg.${table} WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  return Number(rows[0]?.m ?? 0);
}

export async function assertShell(
  client: PoolClient,
  engagementId: string,
  workflowInstanceId: string,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2`,
    [workflowInstanceId, engagementId],
  );
  if (!rows[0])
    throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
}

/** Reject ids that are not all Planning Signals of this audit file. */
export async function assertSignalsInShell(
  client: PoolClient,
  workflowInstanceId: string,
  signalIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(signalIds)];
  if (!unique.length) return;
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM hsdg.audit_planning_signal
      WHERE workflow_instance_id = $1 AND id = ANY($2::uuid[])`,
    [workflowInstanceId, unique],
  );
  if (Number(rows[0]?.n ?? 0) !== unique.length) {
    throw new BadRequestException('Every linked signal must belong to this audit file.');
  }
}

/** Insert a (non-auto) Planning Signal into the shared register; returns its id. */
export async function insertSignal(
  client: PoolClient,
  engagementId: string,
  workflowInstanceId: string,
  signal: {
    source: PlanningSignalSource;
    sourceRef?: string | null;
    sourceLink?: string | null;
    observation: string;
    whyMayMatter?: string | null;
    potentialImplications?: string | null;
    attention: PlanningAttention;
    documentId?: string | null;
  },
): Promise<string> {
  const seq = (await maxSeq(client, 'audit_planning_signal', workflowInstanceId)) + 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO hsdg.audit_planning_signal
       (workflow_instance_id, engagement_id, seq, source, source_ref, source_link, observation,
        why_may_matter, potential_implications, suggested_attention, attention,
        document_id, is_auto)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, false)
     RETURNING id`,
    [
      workflowInstanceId,
      engagementId,
      seq,
      signal.source,
      signal.sourceRef ?? null,
      signal.sourceLink ?? null,
      signal.observation,
      signal.whyMayMatter ?? null,
      signal.potentialImplications ?? null,
      signal.attention,
      signal.documentId ?? null,
    ],
  );
  return rows[0]!.id;
}
