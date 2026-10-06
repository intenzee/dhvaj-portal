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
  PBC_DUE_SOON_DAYS,
  PBC_OUTSTANDING_STATUSES,
  PBC_STATUS,
  type AuditPbcItem,
  type PbcStandardListResult,
  type PbcStatus,
  type PbcSuggestionResult,
  type StatutoryAuditPbc,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import {
  groupStructure,
  isEngagementLead,
  readEngagementMasterFacts,
  readInitialAudit,
  readPriorAuditFile,
} from './master-facts';
import { pickClientOwner, samePbcRequirement, type ClientContact } from './pbc-standard-list';
import {
  dueFor,
  linkArea,
  planChase,
  planPbcSuggestions,
  roleFor,
  type ChaseContact,
} from './pbc-automation';

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
  source_key: string | null;
  source_note: string | null;
  last_chased_on: string | null;
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
    return this.db.withRlsContext(ctx, async (client) => {
      // A lead opening the tracker brings it up to date with the file.
      if (await isEngagementLead(client, engagementId)) {
        const { rows } = await client.query<{ id: string }>(
          `SELECT wi.id FROM hsdg.service_workflow_instances wi
            WHERE wi.engagement_id = $1 AND wi.workflow_key = 'statutory_audit'
              AND wi.status NOT IN ('cancelled','archived','completed')
              AND wi.signed_off_at IS NULL
              AND EXISTS (SELECT 1 FROM hsdg.audit_planning_approvals pa
                           WHERE pa.workflow_instance_id = wi.id)`,
          [engagementId],
        );
        for (const r of rows) await this.suggestOn(client, ctx, engagementId, r.id);
      }
      return this.readTracker(client, engagementId);
    });
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
        WHERE engagement_id = $1 AND status <> 'cancelled'
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
              emp.full_name AS requested_by_name, p.source_key, p.source_note,
              p.last_chased_on::text AS last_chased_on,
              p.version, p.created_at, p.updated_at
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
    const soon = new Date(Date.now() + PBC_DUE_SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
    const chaseCtx = await this.readChaseContext(client, engagementId, today);

    return shells.map((shell) => {
      const shellItems = items
        .filter((i) => i.workflow_instance_id === shell.id)
        .map((i) => mapItem(i, today));
      const outstanding = shellItems.filter((i) => PBC_OUTSTANDING_STATUSES.includes(i.status));
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        planningApproved: planApprovedSet.has(shell.id),
        items: shellItems,
        overdueCount: shellItems.filter((i) => i.isOverdue).length,
        summary: {
          outstanding: outstanding.length,
          overdue: shellItems.filter((i) => i.isOverdue).length,
          dueSoon: outstanding.filter(
            (i) => i.dueDate != null && i.dueDate >= today && i.dueDate <= soon,
          ).length,
          toReview: shellItems.filter((i) => i.status === 'received' || i.status === 'under_review')
            .length,
          accepted: shellItems.filter((i) => i.status === 'accepted' || i.status === 'closed')
            .length,
        },
        chase: planChase(shellItems, chaseCtx.contacts, chaseCtx.ctx),
      };
    });
  }

  /** The client's contacts (with email) and the names a reminder is written with. */
  private async readChaseContext(
    client: PoolClient,
    engagementId: string,
    today: string,
  ): Promise<{ contacts: ChaseContact[]; ctx: Parameters<typeof planChase>[2] }> {
    const { rows: eng } = await client.query<{
      legal_name: string | null;
      financial_year: string | null;
      manager_name: string | null;
    }>(
      `SELECT en.legal_name, e.financial_year, m.full_name AS manager_name
         FROM hsdg.engagements e
         LEFT JOIN hsdg.entities en ON en.id = e.entity_id
         LEFT JOIN hsdg.employees m ON m.id = e.engagement_manager_id
        WHERE e.id = $1`,
      [engagementId],
    );
    const { rows: contacts } = await client.query<{
      full_name: string;
      designation: string | null;
      contact_type: string | null;
      is_primary: boolean;
      email: string | null;
    }>(
      `SELECT c.full_name, c.designation, c.contact_type, c.is_primary, c.email::text AS email
         FROM hsdg.entity_contacts c
         JOIN hsdg.engagements e ON e.entity_id = c.entity_id
        WHERE e.id = $1
        ORDER BY c.is_primary DESC, c.created_at`,
      [engagementId],
    );
    return {
      contacts: contacts.map((c) => ({
        fullName: c.full_name,
        designation: c.designation,
        contactType: c.contact_type,
        isPrimary: c.is_primary,
        email: c.email,
      })),
      ctx: {
        entityName: eng[0]?.legal_name ?? 'the client',
        financialYear: eng[0]?.financial_year ?? null,
        senderName: eng[0]?.manager_name ?? null,
        today,
      },
    };
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

  // ── Suggested requests (§16) ─────────────────────────────────────────────

  /**
   * "Refresh suggested requests": add what the file now calls for (standard
   * list, 03.5 areas, Section 04 risks, completion stage, last year's custom
   * requests) and fill blank owners, linked areas and due dates. A request the
   * team deleted is never suggested again. The tracker builds itself once
   * Planning is approved (§7); this refresh can be run any time, like adding a
   * request by hand.
   */
  async suggest(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PbcSuggestionResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      if (!(await isEngagementLead(client, engagementId))) {
        throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
      }
      const { added, filled } = await this.suggestOn(client, ctx, engagementId, workflowInstanceId);
      if (added > 0 || filled > 0) {
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.pbc_suggested',
          objectType: 'service_workflow_instance',
          objectId: workflowInstanceId,
          after: { added, filled },
        });
      }
      const [tracker] = await this.readTracker(client, engagementId);
      return { tracker: tracker!, added, filled };
    });
  }

  /** Older clients' "Add standard list" — now the full suggestion refresh. */
  async addStandardList(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PbcStandardListResult> {
    const { tracker, added } = await this.suggest(ctx, engagementId, workflowInstanceId);
    return { tracker, added };
  }

  /** Add the suggested requests and fill blanks. Runs in the caller's transaction. */
  private async suggestOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ added: number; filled: number }> {
    const master = await readEngagementMasterFacts(client, workflowInstanceId);
    if (!master) return { added: 0, filled: 0 };
    const initialAudit = (await readInitialAudit(client, workflowInstanceId)) ?? false;
    const { rows: areaRows } = await client.query<{
      id: string;
      work_area_key: string;
      title: string;
    }>(
      `SELECT id, work_area_key, title FROM hsdg.audit_work_areas
        WHERE workflow_instance_id = $1 AND is_active`,
      [workflowInstanceId],
    );
    const areas = areaRows.map((a) => ({ key: a.work_area_key, title: a.title }));
    const areaIdByKey = new Map(areaRows.map((a) => [a.work_area_key, a.id]));
    const { rows: risks } = await client.query<{
      id: string;
      risk_ref: string;
      description: string;
      fs_area: string | null;
      status: string;
    }>(
      `SELECT id, risk_ref, description, fs_area, status
         FROM hsdg.audit_risks WHERE workflow_instance_id = $1 ORDER BY created_at`,
      [workflowInstanceId],
    );
    const prior = await readPriorAuditFile(client, workflowInstanceId);
    const priorItems = prior
      ? (
          await client.query<{ id: string; pbc_ref: string; requirement: string }>(
            `SELECT id, pbc_ref, requirement FROM hsdg.audit_pbc_items
              WHERE workflow_instance_id = $1
                AND (source_key IS NULL OR source_key LIKE 'py:%')
              ORDER BY pbc_ref`,
            [prior.workflowInstanceId],
          )
        ).rows
      : [];
    const contacts = await this.readContacts(client, engagementId);

    const plan = planPbcSuggestions({
      standard: {
        isCompany: master.entityCategory === 'company',
        activityFlags: master.activityFlags,
        borrowings:
          master.cyFinancials?.totalBorrowings ?? master.pyFinancials?.totalBorrowings ?? null,
        hasGroupRelationships: master.relationships.length > 0,
        hasSubsidiaries: groupStructure(master.relationships).investees.length > 0,
        initialAudit,
        activeWorkAreas: new Set(areaIdByKey.keys()),
      },
      areas,
      risks: risks.map((r) => ({
        id: r.id,
        ref: r.risk_ref,
        description: r.description,
        fsArea: r.fs_area,
        status: r.status,
      })),
      prior: prior
        ? {
            financialYear: prior.financialYear,
            items: priorItems.map((p) => ({
              id: p.id,
              ref: p.pbc_ref,
              requirement: p.requirement,
            })),
          }
        : null,
    });

    const { rows: existing } = await client.query<{
      id: string;
      pbc_ref: string;
      requirement: string;
      workflow_instance_id: string;
      client_owner: string | null;
      work_area_id: string | null;
      due_date: string | null;
      status: PbcStatus;
    }>(
      `SELECT id, pbc_ref, requirement, workflow_instance_id, client_owner, work_area_id,
              due_date, status
         FROM hsdg.audit_pbc_items WHERE engagement_id = $1`,
      [engagementId],
    );
    const { rows: logged } = await client.query<{ source_key: string }>(
      `SELECT source_key FROM hsdg.audit_pbc_suggestion_log WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const loggedKeys = new Set(logged.map((l) => l.source_key));
    const log = async (key: string): Promise<void> => {
      if (loggedKeys.has(key)) return;
      loggedKeys.add(key);
      await client.query(
        `INSERT INTO hsdg.audit_pbc_suggestion_log (workflow_instance_id, engagement_id, source_key)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [workflowInstanceId, engagementId, key],
      );
    };

    const today = new Date().toISOString().slice(0, 10);
    const dates = {
      today,
      plannedStart: master.plannedStartDate,
      plannedEnd: master.plannedEndDate,
    };
    const refs = existing.map((r) => r.pbc_ref);
    let added = 0;
    for (const p of plan) {
      if (loggedKeys.has(p.sourceKey)) continue;
      // Already asked (typed, or added by the old standard-list button): remember
      // it, so deleting that request later doesn't bring the suggestion back.
      if (existing.some((e) => samePbcRequirement(e.requirement, p.requirement))) {
        await log(p.sourceKey);
        continue;
      }
      const pbcRef = nextPbcRef(refs);
      refs.push(pbcRef);
      try {
        await client.query(
          `INSERT INTO hsdg.audit_pbc_items
             (workflow_instance_id, engagement_id, pbc_ref, requirement, client_owner,
              work_area_id, status, requested_date, due_date, source_key, source_note,
              requested_by_employee_id)
           VALUES ($1,$2,$3,$4,$5,$6,'requested',$7,$8,$9,$10,$11)`,
          [
            workflowInstanceId,
            engagementId,
            pbcRef,
            p.requirement,
            pickClientOwner(p.ownerRole, contacts),
            p.workAreaKey ? (areaIdByKey.get(p.workAreaKey) ?? null) : null,
            today,
            dueFor(p.stage, dates),
            p.sourceKey,
            p.sourceNote,
            ctx.employeeId ?? null,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('The tracker changed while adding requests; retry.');
        }
        throw err;
      }
      await log(p.sourceKey);
      added += 1;
    }

    // Fill blanks on this file's open requests — never what the team typed.
    const areaIdOf = (requirement: string): string | null => {
      const key = linkArea(requirement, areas);
      return key ? (areaIdByKey.get(key) ?? null) : null;
    };
    let filled = 0;
    for (const e of existing) {
      if (e.workflow_instance_id !== workflowInstanceId || e.status === 'closed') continue;
      const owner = e.client_owner ? null : pickClientOwner(roleFor(e.requirement), contacts);
      const area = e.work_area_id ? null : areaIdOf(e.requirement);
      const due = e.due_date ? null : dueFor('fieldwork', dates);
      if (!owner && !area && !due) continue;
      await client.query(
        `UPDATE hsdg.audit_pbc_items
            SET client_owner = COALESCE(client_owner, $2),
                work_area_id = COALESCE(work_area_id, $3),
                due_date = COALESCE(due_date, $4::date),
                version = version + 1
          WHERE id = $1`,
        [e.id, owner, area, due],
      );
      filled += [owner, area, due].filter(Boolean).length;
    }
    return { added, filled };
  }

  private async readContacts(client: PoolClient, engagementId: string): Promise<ClientContact[]> {
    const { rows } = await client.query<{
      full_name: string;
      designation: string | null;
      contact_type: string | null;
      is_primary: boolean;
    }>(
      `SELECT c.full_name, c.designation, c.contact_type, c.is_primary
         FROM hsdg.entity_contacts c
         JOIN hsdg.engagements e ON e.entity_id = c.entity_id
        WHERE e.id = $1
        ORDER BY c.is_primary DESC, c.created_at`,
      [engagementId],
    );
    return rows.map((c) => ({
      fullName: c.full_name,
      designation: c.designation,
      contactType: c.contact_type,
      isPrimary: c.is_primary,
    }));
  }

  // ── Chasing the client ───────────────────────────────────────────────────

  /** Record that the client was reminded about these requests today. */
  async markChased(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    pbcIds: readonly string[],
  ): Promise<StatutoryAuditPbc> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const result = await client.query(
        `UPDATE hsdg.audit_pbc_items
            SET last_chased_on = CURRENT_DATE, version = version + 1
          WHERE workflow_instance_id = $1 AND id = ANY($2::uuid[])`,
        [workflowInstanceId, pbcIds],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('No such PBC requests.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.pbc_chased',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { count: result.rowCount },
      });
      const [tracker] = await this.readTracker(client, engagementId);
      return tracker!;
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
      const { rows } = await client.query<{
        status: PbcStatus;
        document_id: string | null;
        received_date: string | null;
      }>(
        `SELECT status, document_id, received_date FROM hsdg.audit_pbc_items
          WHERE id = $1 AND engagement_id = $2`,
        [pbcId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('PBC item not found.');
      // Linking the received document is the receipt: an outstanding request
      // moves to Received (and gets its received date) without a second click.
      if (
        input.documentId &&
        input.documentId !== current.document_id &&
        input.status === undefined &&
        PBC_OUTSTANDING_STATUSES.includes(current.status)
      ) {
        input = {
          ...input,
          status: PBC_STATUS.received,
          ...(input.receivedDate === undefined && !current.received_date
            ? { receivedDate: new Date().toISOString().slice(0, 10) }
            : {}),
        };
      }
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
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2 AND status <> 'cancelled'`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
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
    sourceKey: p.source_key,
    sourceNote: p.source_note,
    lastChasedOn: p.last_chased_on,
    isOverdue: isPbcOverdue({ status: p.status, dueDate: p.due_date }, today),
    version: p.version,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
  };
}
