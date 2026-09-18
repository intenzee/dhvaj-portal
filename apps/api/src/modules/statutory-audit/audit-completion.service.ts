import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  canApproveCompletion,
  canArchive,
  canSignOff,
  sectionResolved,
  type AuditCompletionItem,
  type AuditWorkflowStatus,
  type CompletionGate,
  type CompletionItemState,
  type CompletionSection,
  type StatutoryAuditCompletion,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

interface ShellRow {
  id: string;
  engagement_service_id: string;
  engagement_id: string;
  status: AuditWorkflowStatus;
  completion_approved_at: Date | null;
  completion_approved_by_name: string | null;
  completion_memo: string | null;
  signed_off_at: Date | null;
  signed_off_by_name: string | null;
  signoff_memo: string | null;
  archived_at: Date | null;
  archived_by_name: string | null;
  archive_note: string | null;
}

interface ItemRow {
  id: string;
  workflow_instance_id: string;
  section: CompletionSection;
  item_key: string;
  title: string;
  state: CompletionItemState;
  note: string | null;
  version: number;
  updated_at: Date;
}

/**
 * Statutory Audit — Completion / Reporting / Sign-off / Archive (Audit Spec
 * §27–§29). SA-8 closes the ten-phase file.
 *
 * Completion (§27.07) and Reporting (§27.08) are professional checklists carried
 * through not_started → in_progress → complete / not_applicable. Partner sign-off
 * (§27.09) is GATED server-side (§28 "the UI must not permit an action merely
 * because a button is visible"): no OPEN BLOCKING review note (§29), every active
 * audit area concluded, both checklists resolved. Archiving (§27.10) flips the
 * shell to `archived` and every further write is then rejected — professional
 * history is immutable (§37). All gate maths lives in the shared pure helpers so
 * it is unit-tested independent of the DB.
 */
@Injectable()
export class AuditCompletionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditCompletion[]> {
    return this.db.withRlsContext(ctx, (client) => this.readCompletion(client, engagementId));
  }

  private async readCompletion(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditCompletion[]> {
    const { rows: shells } = await client.query<ShellRow>(
      `SELECT wi.id, wi.engagement_service_id, wi.engagement_id, wi.status,
              wi.completion_approved_at, ca.full_name AS completion_approved_by_name,
              wi.completion_memo,
              wi.signed_off_at, sa.full_name AS signed_off_by_name, wi.signoff_memo,
              wi.archived_at, aa.full_name AS archived_by_name, wi.archive_note
         FROM hsdg.service_workflow_instances wi
         LEFT JOIN hsdg.employees ca ON ca.id = wi.completion_approved_by_employee_id
         LEFT JOIN hsdg.employees sa ON sa.id = wi.signed_off_by_employee_id
         LEFT JOIN hsdg.employees aa ON aa.id = wi.archived_by_employee_id
        WHERE wi.engagement_id = $1
        ORDER BY wi.created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];
    const shellIds = shells.map((s) => s.id);

    const { rows: items } = await client.query<ItemRow>(
      `SELECT id, workflow_instance_id, section, item_key, title, state, note, version, updated_at
         FROM hsdg.audit_completion_items
        WHERE workflow_instance_id = ANY($1::uuid[])
        ORDER BY section ASC, sort_order ASC`,
      [shellIds],
    );

    // Blocking-note and open-area counts per shell — the derived §29 gate inputs.
    const { rows: blocking } = await client.query<{ workflow_instance_id: string; n: string }>(
      `SELECT workflow_instance_id, COUNT(*)::text AS n
         FROM hsdg.audit_review_notes
        WHERE workflow_instance_id = ANY($1::uuid[])
          AND is_blocking = true AND status IN ('open','responded')
        GROUP BY workflow_instance_id`,
      [shellIds],
    );
    const { rows: openAreas } = await client.query<{ workflow_instance_id: string; n: string }>(
      `SELECT workflow_instance_id, COUNT(*)::text AS n
         FROM hsdg.audit_work_areas
        WHERE workflow_instance_id = ANY($1::uuid[])
          AND is_active = true AND conclusion_state <> 'submitted'
        GROUP BY workflow_instance_id`,
      [shellIds],
    );
    const blockingByShell = new Map(blocking.map((b) => [b.workflow_instance_id, Number(b.n)]));
    const openAreasByShell = new Map(openAreas.map((a) => [a.workflow_instance_id, Number(a.n)]));

    return shells.map((shell) => {
      const shellItems = items.filter((i) => i.workflow_instance_id === shell.id).map(mapItem);
      const gate: CompletionGate = {
        completionItemsResolved: sectionResolved(shellItems, 'completion'),
        reportingItemsResolved: sectionResolved(shellItems, 'reporting'),
        openBlockingNotes: blockingByShell.get(shell.id) ?? 0,
        areasOpen: openAreasByShell.get(shell.id) ?? 0,
        completionApproved: shell.completion_approved_at != null,
        signedOff: shell.signed_off_at != null,
        archived: shell.archived_at != null || shell.status === 'archived',
      };
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        status: shell.status,
        items: shellItems,
        gate,
        completionApprovedAt: iso(shell.completion_approved_at),
        completionApprovedByName: shell.completion_approved_by_name,
        completionMemo: shell.completion_memo,
        signedOffAt: iso(shell.signed_off_at),
        signedOffByName: shell.signed_off_by_name,
        signoffMemo: shell.signoff_memo,
        archivedAt: iso(shell.archived_at),
        archivedByName: shell.archived_by_name,
        archiveNote: shell.archive_note,
      };
    });
  }

  // ── Update a checklist item (§27.07/§27.08) ─────────────────────────────────

  async updateItem(
    ctx: RlsContext,
    engagementId: string,
    itemId: string,
    input: { state?: CompletionItemState; note?: string | null; version: number },
  ): Promise<StatutoryAuditCompletion> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ workflow_instance_id: string; archived: boolean }>(
        `SELECT ci.workflow_instance_id,
                (wi.archived_at IS NOT NULL OR wi.status = 'archived') AS archived
           FROM hsdg.audit_completion_items ci
           JOIN hsdg.service_workflow_instances wi ON wi.id = ci.workflow_instance_id
          WHERE ci.id = $1 AND ci.engagement_id = $2`,
        [itemId, engagementId],
      );
      if (!rows[0]) throw new NotFoundException('Completion item not found on this engagement.');
      if (rows[0].archived) throw new ConflictException('This audit file is archived and locked.');

      const params: unknown[] = [itemId, input.version];
      const sets: string[] = [];
      const set = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.state !== undefined) set('state', input.state);
      if (input.note !== undefined) set('note', input.note?.trim() || null);
      if (sets.length === 0) {
        const [completion] = await this.readCompletion(client, engagementId);
        return completion!;
      }
      params.push(ctx.employeeId ?? null);
      sets.push(`updated_by_employee_id = $${params.length}`);
      const result = await client.query(
        `UPDATE hsdg.audit_completion_items
            SET ${sets.join(', ')}, content_updated_at = now(), version = version + 1
          WHERE id = $1 AND version = $2`,
        params,
      );
      this.assertRowChanged(result.rowCount, 'completion item');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.completion_item_updated',
        objectType: 'audit_completion_item',
        objectId: itemId,
        after: { state: input.state ?? null },
      });
      const [completion] = await this.readCompletion(client, engagementId);
      return completion!;
    });
  }

  // ── Approve Completion (§28) ────────────────────────────────────────────────

  /** Approve the Completion phase: gate satisfied, freeze it, unlock Reporting. */
  async approveCompletion(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { memo?: string | null },
  ): Promise<StatutoryAuditCompletion> {
    return this.db.withRlsContext(ctx, async (client) => {
      const gate = await this.loadGate(client, engagementId, workflowInstanceId);
      if (!canApproveCompletion(gate)) {
        throw new BadRequestException(
          'Completion cannot be approved yet: resolve every completion item and clear all blocking review notes (§28).',
        );
      }
      // Guarded write — concurrent approval loses the race (approved_at set once).
      const result = await client.query(
        `UPDATE hsdg.service_workflow_instances
            SET completion_approved_at = now(),
                completion_approved_by_employee_id = $2,
                completion_memo = $3
          WHERE id = $1 AND completion_approved_at IS NULL`,
        [workflowInstanceId, ctx.employeeId ?? null, input.memo?.trim() || null],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('Completion was approved concurrently; refresh and retry.');
      }
      // Phase 07 complete; unlock Phase 08 (Reporting) — §7 progressive unlock.
      await this.setPhase(client, workflowInstanceId, 'completion', 'complete');
      await this.unlockPhase(client, workflowInstanceId, 'reporting');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.completion_approved',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
      });
      return this.readOne(client, engagementId, workflowInstanceId);
    });
  }

  // ── Partner sign-off (§27.09, §29) ──────────────────────────────────────────

  async signOff(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { memo?: string | null },
  ): Promise<StatutoryAuditCompletion> {
    return this.db.withRlsContext(ctx, async (client) => {
      const gate = await this.loadGate(client, engagementId, workflowInstanceId);
      if (!canSignOff(gate)) {
        throw new BadRequestException(
          'Sign-off prerequisites are not met: completion must be approved, every reporting item resolved, all audit areas concluded, and no blocking review note open (§28, §29).',
        );
      }
      const result = await client.query(
        `UPDATE hsdg.service_workflow_instances
            SET signed_off_at = now(),
                signed_off_by_employee_id = $2,
                signoff_memo = $3,
                status = 'completed'
          WHERE id = $1 AND signed_off_at IS NULL`,
        [workflowInstanceId, ctx.employeeId ?? null, input.memo?.trim() || null],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('The file was signed off concurrently; refresh and retry.');
      }
      // Phases 08/09 complete; unlock Phase 10 (Archiving).
      await this.setPhase(client, workflowInstanceId, 'reporting', 'complete');
      await this.setPhase(client, workflowInstanceId, 'sign_off', 'complete');
      await this.unlockPhase(client, workflowInstanceId, 'archiving');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.signed_off',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
      });
      return this.readOne(client, engagementId, workflowInstanceId);
    });
  }

  // ── Archive + lock (§27.10, §37) ────────────────────────────────────────────

  async archive(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { note?: string | null },
  ): Promise<StatutoryAuditCompletion> {
    return this.db.withRlsContext(ctx, async (client) => {
      const gate = await this.loadGate(client, engagementId, workflowInstanceId);
      if (!canArchive(gate)) {
        throw new BadRequestException('Archive requires the file to be signed off first (§27.10).');
      }
      const result = await client.query(
        `UPDATE hsdg.service_workflow_instances
            SET archived_at = now(),
                archived_by_employee_id = $2,
                archive_note = $3,
                status = 'archived'
          WHERE id = $1 AND archived_at IS NULL`,
        [workflowInstanceId, ctx.employeeId ?? null, input.note?.trim() || null],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('The file was archived concurrently; refresh and retry.');
      }
      // Phase 10 complete — the file is now locked (§37).
      await this.setPhase(client, workflowInstanceId, 'archiving', 'complete');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.archived',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
      });
      return this.readOne(client, engagementId, workflowInstanceId);
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Load the §29 gate for one shell, asserting it exists on this engagement. */
  private async loadGate(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<CompletionGate> {
    const all = await this.readCompletion(client, engagementId);
    const shell = all.find((c) => c.workflowInstanceId === workflowInstanceId);
    if (!shell) {
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    }
    return shell.gate;
  }

  /** Re-read the engagement and return the mutated shell (post-mutation view). */
  private async readOne(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditCompletion> {
    const all = await this.readCompletion(client, engagementId);
    const shell = all.find((c) => c.workflowInstanceId === workflowInstanceId);
    return shell ?? all[0]!;
  }

  private async setPhase(
    client: PoolClient,
    workflowInstanceId: string,
    phaseKey: string,
    state: string,
  ): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_workflow_phases
          SET state = $3
        WHERE workflow_instance_id = $1 AND phase_key = $2`,
      [workflowInstanceId, phaseKey, state],
    );
  }

  /** Lift a phase's lock only (locked → in_progress); never downgrade progress. */
  private async unlockPhase(
    client: PoolClient,
    workflowInstanceId: string,
    phaseKey: string,
  ): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_workflow_phases
          SET state = 'in_progress'
        WHERE workflow_instance_id = $1 AND phase_key = $2 AND state = 'locked'`,
      [workflowInstanceId, phaseKey],
    );
  }

  private assertRowChanged(rowCount: number | null, what: string): void {
    if ((rowCount ?? 0) === 0) {
      throw new ConflictException(`This ${what} changed since you loaded it; refresh and retry.`);
    }
  }
}

function mapItem(r: ItemRow): AuditCompletionItem {
  return {
    id: r.id,
    section: r.section,
    itemKey: r.item_key,
    title: r.title,
    state: r.state,
    note: r.note,
    version: r.version,
    updatedAt: r.updated_at.toISOString(),
  };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
