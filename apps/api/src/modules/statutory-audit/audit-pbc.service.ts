import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  isPbcOverdue,
  nextPbcRef,
  PBC_STATUS,
  type AuditPbcItem,
  type PbcStatus,
  type StatutoryAuditPbc,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

interface PbcRow {
  id: string;
  workflow_instance_id: string;
  pbc_ref: string;
  requirement: string;
  client_owner: string | null;
  work_area_id: string | null;
  work_area_title: string | null;
  status: PbcStatus;
  rejection_reason: string | null;
  // DATE columns come back as raw 'YYYY-MM-DD' strings (see database/pg-types.ts).
  requested_date: string | null;
  due_date: string | null;
  received_date: string | null;
  document_id: string | null;
  document_title: string | null;
  note: string | null;
  requested_by_name: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface PbcInput {
  requirement: string;
  clientOwner?: string | null;
  workAreaId?: string | null;
  status?: PbcStatus;
  rejectionReason?: string | null;
  requestedDate?: string | null;
  dueDate?: string | null;
  receivedDate?: string | null;
  documentId?: string | null;
  note?: string | null;
}

/** A status transition never records a raw string; it may set received_date. */
export interface PbcStatusInput {
  status: PbcStatus;
  rejectionReason?: string | null;
  version: number;
}

/**
 * Statutory Audit — PBC Master Client Information Tracker service (Audit Spec §16).
 *
 * PBC is the client information-request layer, one master tracker per audit file.
 * The tracker is populated once Planning is approved (§7, workflow step 13). Each
 * item carries its requirement, client owner, agreed due date, professional
 * status, an optional linked work area (§16 LINKED WORK) and the received DHVAJ
 * document — linked by reference so a received file is surfaced in the linked
 * area without being re-uploaded (§16). A `rejected` item requires a reason.
 */
@Injectable()
export class AuditPbcService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listForEngagement(ctx: RlsContext, engagementId: string): Promise<StatutoryAuditPbc[]> {
    return this.db.withRlsContext(ctx, (client) => this.readTracker(client, engagementId));
  }

  private async readTracker(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditPbc[]> {
    const { rows: shells } = await client.query<{
      id: string;
      engagement_service_id: string;
      engagement_id: string;
    }>(
      `SELECT id, engagement_service_id, engagement_id
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1
        ORDER BY created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];
    const shellIds = shells.map((s) => s.id);

    const { rows: items } = await client.query<PbcRow>(
      `SELECT p.id, p.workflow_instance_id, p.pbc_ref, p.requirement, p.client_owner,
              p.work_area_id, wa.title AS work_area_title, p.status, p.rejection_reason,
              p.requested_date, p.due_date, p.received_date,
              p.document_id, d.title AS document_title, p.note,
              emp.full_name AS requested_by_name, p.version, p.created_at, p.updated_at
         FROM hsdg.audit_pbc_items p
         LEFT JOIN hsdg.audit_work_areas wa ON wa.id = p.work_area_id
         LEFT JOIN hsdg.documents d ON d.id = p.document_id
         LEFT JOIN hsdg.employees emp ON emp.id = p.requested_by_employee_id
        WHERE p.workflow_instance_id = ANY($1::uuid[])
        ORDER BY p.pbc_ref ASC`,
      [shellIds],
    );

    const { rows: planApproved } = await client.query<{ workflow_instance_id: string }>(
      `SELECT DISTINCT workflow_instance_id
         FROM hsdg.audit_planning_approvals
        WHERE workflow_instance_id = ANY($1::uuid[])`,
      [shellIds],
    );
    const planApprovedSet = new Set(planApproved.map((r) => r.workflow_instance_id));

    const today = new Date().toISOString().slice(0, 10);

    return shells.map((shell) => {
      const shellItems = items
        .filter((i) => i.workflow_instance_id === shell.id)
        .map((i) => mapItem(i, today));
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        planningApproved: planApprovedSet.has(shell.id),
        items: shellItems,
        overdueCount: shellItems.filter((i) => i.isOverdue).length,
      };
    });
  }

  // ── Create (§16) ────────────────────────────────────────────────────────────

  async createItem(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: PbcInput,
  ): Promise<StatutoryAuditPbc> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertPlanningApproved(client, workflowInstanceId);
      if (input.workAreaId) await this.assertArea(client, engagementId, input.workAreaId);
      if (input.documentId) await this.assertDocument(client, engagementId, input.documentId);
      const status = input.status ?? PBC_STATUS.requested;
      if (status === PBC_STATUS.rejected && !input.rejectionReason?.trim()) {
        throw new BadRequestException('A rejected request requires a reason (§16).');
      }

      // Ref is unique per engagement (§16); retry the rare concurrent-insert race.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { rows: existing } = await client.query<{ pbc_ref: string }>(
          `SELECT pbc_ref FROM hsdg.audit_pbc_items WHERE engagement_id = $1`,
          [engagementId],
        );
        const pbcRef = nextPbcRef(existing.map((r) => r.pbc_ref));
        try {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO hsdg.audit_pbc_items
               (workflow_instance_id, engagement_id, pbc_ref, requirement, client_owner,
                work_area_id, status, rejection_reason, requested_date, due_date, received_date,
                document_id, note, requested_by_employee_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING id`,
            [
              workflowInstanceId,
              engagementId,
              pbcRef,
              input.requirement.trim(),
              input.clientOwner?.trim() || null,
              input.workAreaId ?? null,
              status,
              status === PBC_STATUS.rejected ? input.rejectionReason!.trim() : null,
              input.requestedDate ?? null,
              input.dueDate ?? null,
              input.receivedDate ?? null,
              input.documentId ?? null,
              input.note?.trim() || null,
              ctx.employeeId ?? null,
            ],
          );
          await this.audit.recordWith(client, ctx, {
            action: 'statutory_audit.pbc_created',
            objectType: 'audit_pbc_item',
            objectId: rows[0]!.id,
            after: { pbcRef, workAreaId: input.workAreaId ?? null },
          });
          const [tracker] = await this.readTracker(client, engagementId);
          return tracker!;
        } catch (err) {
          if ((err as { code?: string }).code === '23505' && attempt < 2) continue; // ref race
          throw err;
        }
      }
      throw new ConflictException('Could not assign a PBC reference; retry.');
    });
  }

  // ── Update (§16) ──────────────────────────────────────────────────────────

  async updateItem(
    ctx: RlsContext,
    engagementId: string,
    pbcId: string,
    input: Partial<PbcInput> & { version: number },
  ): Promise<StatutoryAuditPbc> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ status: PbcStatus }>(
        `SELECT status FROM hsdg.audit_pbc_items WHERE id = $1 AND engagement_id = $2`,
        [pbcId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('PBC item not found.');
      if (input.workAreaId) await this.assertArea(client, engagementId, input.workAreaId);
      if (input.documentId) await this.assertDocument(client, engagementId, input.documentId);

      // "Rejected requires a reason" (§16) is enforced by the row CHECK constraint
      // below (audit_pbc_rejected_has_reason) — it holds whether the reason is
      // being set now or was already stored — and surfaced as a 400 in the catch.

      // PATCH semantics: an omitted field is unchanged; explicit null clears.
      const params: unknown[] = [pbcId, input.version];
      const sets: string[] = [];
      const set = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.requirement !== undefined) set('requirement', input.requirement.trim());
      if (input.clientOwner !== undefined) set('client_owner', input.clientOwner?.trim() || null);
      if (input.workAreaId !== undefined) set('work_area_id', input.workAreaId ?? null);
      if (input.status !== undefined) set('status', input.status);
      if (input.rejectionReason !== undefined)
        set('rejection_reason', input.rejectionReason?.trim() || null);
      if (input.requestedDate !== undefined) set('requested_date', input.requestedDate ?? null);
      if (input.dueDate !== undefined) set('due_date', input.dueDate ?? null);
      if (input.receivedDate !== undefined) set('received_date', input.receivedDate ?? null);
      if (input.documentId !== undefined) set('document_id', input.documentId ?? null);
      if (input.note !== undefined) set('note', input.note?.trim() || null);

      try {
        const result = await client.query(
          `UPDATE hsdg.audit_pbc_items
              SET ${sets.length ? `${sets.join(', ')}, ` : ''}version = version + 1
            WHERE id = $1 AND version = $2`,
          params,
        );
        if ((result.rowCount ?? 0) === 0) {
          throw new ConflictException(
            'This PBC item changed since you loaded it; refresh and retry.',
          );
        }
      } catch (err) {
        // The DB enforces "rejected requires a reason" (§16) — surface it cleanly.
        if ((err as { constraint?: string }).constraint === 'audit_pbc_rejected_has_reason') {
          throw new BadRequestException('A rejected request requires a reason (§16).');
        }
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.pbc_updated',
        objectType: 'audit_pbc_item',
        objectId: pbcId,
        after: { status: input.status },
      });
      const [tracker] = await this.readTracker(client, engagementId);
      return tracker!;
    });
  }

  /**
   * Transition a PBC item's status (§16). Moving to `received` stamps the
   * received date when one is not already set; `rejected` requires a reason.
   */
  async setStatus(
    ctx: RlsContext,
    engagementId: string,
    pbcId: string,
    input: PbcStatusInput,
  ): Promise<StatutoryAuditPbc> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ received_date: string | null }>(
        `SELECT received_date FROM hsdg.audit_pbc_items WHERE id = $1 AND engagement_id = $2`,
        [pbcId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('PBC item not found.');
      if (input.status === PBC_STATUS.rejected && !input.rejectionReason?.trim()) {
        throw new BadRequestException('A rejected request requires a reason (§16).');
      }

      // Stamp the received date on first receipt so overdue clears (§29).
      const stampReceived = input.status === PBC_STATUS.received && !current.received_date;

      const result = await client.query(
        `UPDATE hsdg.audit_pbc_items
            SET status = $3,
                rejection_reason = CASE WHEN $3 = 'rejected' THEN $4 ELSE rejection_reason END,
                received_date = CASE WHEN $5 THEN CURRENT_DATE ELSE received_date END,
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [pbcId, input.version, input.status, input.rejectionReason?.trim() || null, stampReceived],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This PBC item changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.pbc_status_changed',
        objectType: 'audit_pbc_item',
        objectId: pbcId,
        after: { status: input.status },
      });
      const [tracker] = await this.readTracker(client, engagementId);
      return tracker!;
    });
  }

  async deleteItem(
    ctx: RlsContext,
    engagementId: string,
    pbcId: string,
  ): Promise<StatutoryAuditPbc> {
    return this.db.withRlsContext(ctx, async (client) => {
      const result = await client.query(
        `DELETE FROM hsdg.audit_pbc_items WHERE id = $1 AND engagement_id = $2`,
        [pbcId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('PBC item not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.pbc_deleted',
        objectType: 'audit_pbc_item',
        objectId: pbcId,
      });
      const [tracker] = await this.readTracker(client, engagementId);
      return tracker!;
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

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

  /** The PBC master is populated once Planning is approved (§7, workflow step 13). */
  private async assertPlanningApproved(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_planning_approvals WHERE workflow_instance_id = $1 LIMIT 1`,
      [workflowInstanceId],
    );
    if (!rows[0]) {
      throw new ConflictException('Approve Planning before populating the PBC tracker (§7).');
    }
  }

  private async assertArea(
    client: PoolClient,
    engagementId: string,
    workAreaId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_work_areas WHERE id = $1 AND engagement_id = $2`,
      [workAreaId, engagementId],
    );
    if (!rows[0]) throw new BadRequestException('Audit area not found on this engagement.');
  }

  private async assertDocument(
    client: PoolClient,
    engagementId: string,
    documentId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2`,
      [documentId, engagementId],
    );
    if (!rows[0]) throw new BadRequestException('Document not found on this engagement.');
  }
}

function mapItem(p: PbcRow, today: string): AuditPbcItem {
  return {
    id: p.id,
    pbcRef: p.pbc_ref,
    requirement: p.requirement,
    clientOwner: p.client_owner,
    workAreaId: p.work_area_id,
    workAreaTitle: p.work_area_title,
    status: p.status,
    rejectionReason: p.rejection_reason,
    requestedDate: p.requested_date,
    dueDate: p.due_date,
    receivedDate: p.received_date,
    documentId: p.document_id,
    documentTitle: p.document_title,
    note: p.note,
    requestedByName: p.requested_by_name,
    isOverdue: isPbcOverdue({ status: p.status, dueDate: p.due_date }, today),
    version: p.version,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
  };
}
