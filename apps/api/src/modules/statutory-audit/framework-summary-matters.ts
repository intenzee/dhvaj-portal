import type { PoolClient } from 'pg';
import type { FrameworkSummaryMatter } from '@hsdg/contracts';

/**
 * 02.8 §7 — the aggregated Framework Matters from 02.1–02.7 (Track B). DI-free.
 * PLACEHOLDER — Track B replaces it (categories, impact, Partner Attention,
 * source mapping).
 */
export async function readFrameworkMattersOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkSummaryMatter[]> {
  const { rows } = await client.query<{
    id: string;
    seq: number;
    title: string;
    is_blocking: boolean;
    status: FrameworkSummaryMatter['status'];
    resolution: string | null;
    owner_employee_id: string | null;
    due_date: string | null;
  }>(
    `SELECT id, seq, title, is_blocking, status, resolution, owner_employee_id,
            due_date::text AS due_date
       FROM hsdg.audit_matter
      WHERE workflow_instance_id = $1 AND section = 'framework'
      ORDER BY seq ASC`,
    [workflowInstanceId],
  );
  return rows.map((r) => {
    const open = r.status !== 'resolved' && r.status !== 'accepted_with_approval';
    return {
      id: r.id,
      code: `M-${String(r.seq).padStart(3, '0')}`,
      source: 'other_areas',
      category: r.is_blocking ? 'blocking' : 'technical_judgment',
      title: r.title,
      description: null,
      impact: null,
      ownerEmployeeId: r.owner_employee_id,
      ownerName: null,
      dueDate: r.due_date,
      status: r.status,
      partnerAttention: false,
      resolution: r.resolution,
      evidenceDocumentId: null,
      blocking: open && r.is_blocking,
      open,
    };
  });
}
