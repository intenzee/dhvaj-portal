import type { PoolClient } from 'pg';
import {
  FRAMEWORK_MATTER_CATEGORIES,
  FRAMEWORK_SOURCE_SECTIONS,
  type FrameworkMatterCategory,
  type FrameworkSourceSection,
  type FrameworkSummaryMatter,
} from '@hsdg/contracts';
import { matterSourceOf } from './framework-summary-records';

/**
 * 02.8 §7 — the aggregated Framework Matters raised in 02.1–02.7 (Track B).
 * Never recreated here: each row is the source section's own matter, with the
 * 02.8 fields (impact, Partner Attention, resolution, evidence) layered on.
 * The originating section comes from the matter's `source` key, falling back
 * to the sub-assessment it references. DI-free.
 */
export async function readFrameworkMattersOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkSummaryMatter[]> {
  const { rows } = await client.query<{
    id: string;
    seq: number;
    source: string | null;
    ref_sub: string | null;
    category: string | null;
    title: string;
    description: string | null;
    impact: string | null;
    is_blocking: boolean;
    status: FrameworkSummaryMatter['status'];
    resolution: string | null;
    owner_employee_id: string | null;
    owner_name: string | null;
    due_date: string | null;
    partner_attention: boolean;
    document_id: string | null;
  }>(
    `SELECT m.id, m.seq, m.source, s.sub_section_key AS ref_sub, m.category, m.title,
            m.description, m.impact, m.is_blocking, m.status, m.resolution,
            m.owner_employee_id, o.full_name AS owner_name, m.due_date::text AS due_date,
            m.partner_attention, m.document_id
       FROM hsdg.audit_matter m
       LEFT JOIN hsdg.employees o ON o.id = m.owner_employee_id
       LEFT JOIN hsdg.audit_framework_subassessment s ON s.id = m.source_ref
      WHERE m.workflow_instance_id = $1 AND m.section = 'framework'
      ORDER BY m.seq ASC`,
    [workflowInstanceId],
  );
  return rows.map((r) => {
    const open = r.status !== 'resolved' && r.status !== 'accepted_with_approval';
    let source: FrameworkSourceSection = matterSourceOf(r.source);
    if (
      source === 'other_areas' &&
      r.ref_sub &&
      FRAMEWORK_SOURCE_SECTIONS.includes(r.ref_sub as FrameworkSourceSection)
    )
      source = r.ref_sub as FrameworkSourceSection;
    const category: FrameworkMatterCategory = FRAMEWORK_MATTER_CATEGORIES.includes(
      r.category as FrameworkMatterCategory,
    )
      ? (r.category as FrameworkMatterCategory)
      : r.is_blocking
        ? 'blocking'
        : 'technical_judgment';
    return {
      id: r.id,
      code: `M-${String(r.seq).padStart(3, '0')}`,
      source,
      category,
      title: r.title,
      description: r.description,
      impact: r.impact,
      ownerEmployeeId: r.owner_employee_id,
      ownerName: r.owner_name,
      dueDate: r.due_date,
      status: r.status,
      partnerAttention: r.partner_attention,
      resolution: r.resolution,
      evidenceDocumentId: r.document_id,
      blocking: open && (r.is_blocking || r.status === 'blocking'),
      open,
    };
  });
}
