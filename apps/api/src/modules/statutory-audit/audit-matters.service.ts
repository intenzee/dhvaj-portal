import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  MATTER_STATUS,
  type AuditMatterRecord,
  type MatterSection,
  type MatterStatus,
  type UpdateMatterInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { deriveFrameworkMatters, type DerivedMatter } from './matters-generation';

/** Marker written by the generator when it auto-closes a cleared matter (§10). */
const AUTO_RESOLVED = 'Auto-resolved: source condition cleared.';

interface MatterRow {
  id: string;
  workflow_instance_id: string;
  engagement_id: string;
  seq: number;
  section: MatterSection;
  source: string;
  source_ref: string | null;
  title: string;
  category: string;
  severity: string | null;
  is_blocking: boolean;
  is_auto: boolean;
  owner_name: string | null;
  due_date: string | null;
  status: MatterStatus;
  resolution: string | null;
  approver_name: string | null;
  approved_at: Date | null;
  document_id: string | null;
  note: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Matters / Exceptions engine (Implementation Guide §10). The one reusable
 * mechanism for Section 01 and Section 02 matters: it GENERATES matters from
 * assessment state (never re-entered), lets professionals resolve them in place,
 * and gates section approval on any open blocking matter.
 */
@Injectable()
export class AuditMattersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ───────────────────────────────────────────────────────────────────

  async listForInstance(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    section?: MatterSection,
  ): Promise<AuditMatterRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      return this.readMatters(client, workflowInstanceId, section);
    });
  }

  private async readMatters(
    client: PoolClient,
    workflowInstanceId: string,
    section?: MatterSection,
  ): Promise<AuditMatterRecord[]> {
    const { rows } = await client.query<MatterRow>(
      `SELECT m.id, m.workflow_instance_id, m.engagement_id, m.seq, m.section, m.source,
              m.source_ref, m.title, m.category, m.severity, m.is_blocking, m.is_auto,
              owner.full_name AS owner_name, m.due_date::text, m.status, m.resolution,
              appr.full_name AS approver_name, m.approved_at, m.document_id, m.note,
              m.version, m.created_at, m.updated_at
         FROM hsdg.audit_matter m
         LEFT JOIN hsdg.employees owner ON owner.id = m.owner_employee_id
         LEFT JOIN hsdg.employees appr ON appr.id = m.approver_employee_id
        WHERE m.workflow_instance_id = $1
          AND ($2::text IS NULL OR m.section = $2)
        ORDER BY m.seq ASC`,
      [workflowInstanceId, section ?? null],
    );
    return rows.map(mapMatter);
  }

  // ── Generation (§10 — generated, not re-entered) ────────────────────────────

  /** Public wrapper: re-derive the framework matters and return the current set. */
  async syncFramework(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<AuditMatterRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
      return this.readMatters(client, workflowInstanceId, 'framework');
    });
  }

  /**
   * Reconcile the framework matters against the current assessment states, on an
   * existing client (called from within the framework-service transaction after
   * suggestions/decisions).
   */
  async syncFrameworkOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows: areas } = await client.query<{
      area_key: string;
      title: string;
      state: string;
      is_overridden: boolean;
    }>(
      `SELECT area_key, title, state, is_overridden
         FROM hsdg.audit_framework_assessments
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const derived = deriveFrameworkMatters(
      areas.map((a) => ({
        areaKey: a.area_key,
        title: a.title,
        state: a.state,
        isOverridden: a.is_overridden,
      })),
    );
    await this.reconcileOn(client, ctx, engagementId, workflowInstanceId, 'framework', derived);
  }

  /**
   * The one reconcile path for both sections (§10). Idempotent: upserts by
   * `source`, reopens an auto-resolved matter whose condition returns, and
   * auto-closes matters whose source condition has cleared. Never touches a
   * manually-resolved or accepted matter, nor a professionally-raised one.
   */
  async reconcileOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    section: MatterSection,
    derived: readonly DerivedMatter[],
  ): Promise<void> {
    const derivedSources = derived.map((d) => d.source);

    const { rows: seqRows } = await client.query<{ m: number }>(
      `SELECT COALESCE(MAX(seq), 0) AS m FROM hsdg.audit_matter WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    let nextSeq = Number(seqRows[0]?.m ?? 0);
    let created = 0;

    for (const d of derived) {
      const upd = await client.query(
        `UPDATE hsdg.audit_matter
            SET category = $3,
                is_blocking = $4,
                severity = $5,
                title = $6,
                status = CASE WHEN is_auto AND status = 'resolved' AND resolution = $7
                              THEN 'open' ELSE status END,
                resolution = CASE WHEN is_auto AND status = 'resolved' AND resolution = $7
                                  THEN NULL ELSE resolution END,
                version = version + 1
          WHERE workflow_instance_id = $1 AND source = $2`,
        [
          workflowInstanceId,
          d.source,
          d.category,
          d.isBlocking,
          d.severity ?? null,
          d.title,
          AUTO_RESOLVED,
        ],
      );
      if ((upd.rowCount ?? 0) === 0) {
        nextSeq += 1;
        const ins = await client.query(
          `INSERT INTO hsdg.audit_matter
             (workflow_instance_id, engagement_id, seq, section, source, title,
              category, severity, is_blocking, is_auto, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, 'open')
           ON CONFLICT (workflow_instance_id, source) DO NOTHING`,
          [
            workflowInstanceId,
            engagementId,
            nextSeq,
            section,
            d.source,
            d.title,
            d.category,
            d.severity ?? null,
            d.isBlocking,
          ],
        );
        created += ins.rowCount ?? 0;
      }
    }

    // Auto-close auto-matters in this section whose source condition no longer holds.
    const closed = await client.query(
      `UPDATE hsdg.audit_matter
          SET status = 'resolved', resolution = $3, version = version + 1
        WHERE workflow_instance_id = $1
          AND section = $4 AND is_auto = true
          AND status IN ('open','under_review','blocking')
          AND ($2::text[] IS NULL OR source <> ALL($2::text[]))`,
      [workflowInstanceId, derivedSources.length ? derivedSources : null, AUTO_RESOLVED, section],
    );

    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.matters_synced',
      objectType: 'service_workflow_instance',
      objectId: workflowInstanceId,
      after: {
        section,
        created,
        autoClosed: closed.rowCount ?? 0,
        active: derivedSources.length,
      },
    });
  }

  // ── Update / resolve (§10 — resolved in place) ──────────────────────────────

  async updateMatter(
    ctx: RlsContext,
    engagementId: string,
    matterId: string,
    input: UpdateMatterInput,
  ): Promise<AuditMatterRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ workflow_instance_id: string; status: MatterStatus }>(
        `SELECT workflow_instance_id, status
           FROM hsdg.audit_matter
          WHERE id = $1 AND engagement_id = $2`,
        [matterId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Matter not found.');

      const nextStatus = input.status ?? current.status;
      const resolution = input.resolution?.trim() || null;
      if (nextStatus === MATTER_STATUS.acceptedWithApproval && !resolution) {
        throw new BadRequestException(
          'Accepting a matter with approval requires a resolution/basis.',
        );
      }
      const setsApprover = nextStatus === MATTER_STATUS.acceptedWithApproval;

      const result = await client.query(
        `UPDATE hsdg.audit_matter
            SET status = $3,
                resolution = COALESCE($4, resolution),
                owner_employee_id = COALESCE($5, owner_employee_id),
                due_date = COALESCE($6::date, due_date),
                document_id = COALESCE($7, document_id),
                note = COALESCE($8, note),
                approver_employee_id = CASE WHEN $9 THEN $10 ELSE approver_employee_id END,
                approved_at = CASE WHEN $9 THEN now() ELSE approved_at END,
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          matterId,
          input.version,
          nextStatus,
          resolution,
          input.ownerEmployeeId ?? null,
          input.dueDate ?? null,
          input.documentId ?? null,
          input.note?.trim() || null,
          setsApprover,
          setsApprover ? (ctx.employeeId ?? null) : null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('This matter changed since you loaded it; refresh and retry.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.matter_updated',
        objectType: 'audit_matter',
        objectId: matterId,
        after: { status: nextStatus },
      });
      const [matter] = await this.readMattersById(client, matterId);
      return matter!;
    });
  }

  // ── Gate (§10 — a blocking matter prevents completion/approval) ──────────────

  /** Count open blocking matters for a section (drives the readiness summary). */
  async countOpenBlockingMatters(
    client: PoolClient,
    workflowInstanceId: string,
    section: MatterSection,
  ): Promise<number> {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n
         FROM hsdg.audit_matter
        WHERE workflow_instance_id = $1 AND section = $2
          AND is_blocking = true
          AND status IN ('open','under_review','blocking')`,
      [workflowInstanceId, section],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Throw when an open blocking matter exists for the section. */
  async assertNoOpenBlockingMatters(
    client: PoolClient,
    workflowInstanceId: string,
    section: MatterSection,
  ): Promise<void> {
    if ((await this.countOpenBlockingMatters(client, workflowInstanceId, section)) > 0) {
      throw new ConflictException(
        'Open blocking matter(s) must be resolved or accepted with approval before approval.',
      );
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async readMattersById(
    client: PoolClient,
    matterId: string,
  ): Promise<AuditMatterRecord[]> {
    const { rows } = await client.query<MatterRow>(
      `SELECT m.id, m.workflow_instance_id, m.engagement_id, m.seq, m.section, m.source,
              m.source_ref, m.title, m.category, m.severity, m.is_blocking, m.is_auto,
              owner.full_name AS owner_name, m.due_date::text, m.status, m.resolution,
              appr.full_name AS approver_name, m.approved_at, m.document_id, m.note,
              m.version, m.created_at, m.updated_at
         FROM hsdg.audit_matter m
         LEFT JOIN hsdg.employees owner ON owner.id = m.owner_employee_id
         LEFT JOIN hsdg.employees appr ON appr.id = m.approver_employee_id
        WHERE m.id = $1`,
      [matterId],
    );
    return rows.map(mapMatter);
  }

  private async assertShell(
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
}

function mapMatter(m: MatterRow): AuditMatterRecord {
  return {
    id: m.id,
    workflowInstanceId: m.workflow_instance_id,
    engagementId: m.engagement_id,
    matterCode: `M-${String(m.seq).padStart(3, '0')}`,
    section: m.section,
    source: m.source,
    sourceRef: m.source_ref,
    title: m.title,
    category: m.category,
    severity: m.severity,
    isBlocking: m.is_blocking,
    isAuto: m.is_auto,
    ownerName: m.owner_name,
    dueDate: m.due_date,
    status: m.status,
    resolution: m.resolution,
    approverName: m.approver_name,
    approvedAt: m.approved_at ? m.approved_at.toISOString() : null,
    documentId: m.document_id,
    note: m.note,
    version: m.version,
    createdAt: m.created_at.toISOString(),
    updatedAt: m.updated_at.toISOString(),
  };
}
