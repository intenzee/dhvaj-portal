import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPE,
  TASK_ACTION,
  type ChecklistAutoTick,
  type ChecklistItem,
  type CrossCheckWarning,
  type FilingCorrectionView,
  type FilingRecordView,
  type FilingReferenceKind,
  type FilingStatus,
  type InstanceWorkspace,
  type PeriodSection,
  type Stream,
  type WorkspaceSlot,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TaskWorkflowService } from '../tasks/task-workflow.service';
import { DocumentsService } from '../documents/documents.service';
import {
  ClientUploadService,
  type ClientUploadLinkCreated,
} from '../documents/client-upload/client-upload.service';
import { istToday } from '../engagements/time/auto-time';
import { seedChecklistForInstance, syncAutoTicks } from '../compliance/compliance-checklist';
import {
  figureForm,
  figureSchema,
  figuresRequiredToLodge,
  gstCrossChecks,
  daysBetween,
  validateFigures,
  type Figures,
} from '../compliance/filing-figures';
import {
  canFlags,
  checkFiledOn,
  checkReference,
  defaultReferenceKind,
  indicativeLateCharges,
  lockState,
  periodLabel,
  undoAllowed,
} from './filing-rules';
import type {
  CorrectionDto,
  LodgeDto,
  PatchChecklistItemDto,
  SaveFiguresDto,
  SlotRequestDto,
  SlotUploadDto,
} from './dto/filing-workspace.dto';

/** The prefix on compliance_instances.notes that records a waiver reason. */
const NA_NOTE_PREFIX = 'Not applicable: ';
const PARTNER_ROLES = new Set(['partner', 'managing_partner']);
/** The read-only group for documents filed against the filing but no slot. */
export const UNSORTED_SLOT = 'UNSORTED';

interface InstanceRow {
  id: string;
  engagement_id: string;
  registration_id: string | null;
  registration_number: string | null;
  compliance_rule_id: string;
  rule_code: string;
  rule_name: string;
  form_label: string | null;
  verification: string | null;
  late_fee_note: string | null;
  stream: Stream | null;
  section: PeriodSection | null;
  financial_year: string | null;
  period_key: string | null;
  period_start: string | null;
  period_end: string | null;
  due: string;
  internal_due: string;
  workflow_status: FilingStatus;
  is_provisional: boolean;
  notes: string | null;
  is_lead: boolean;
  is_member: boolean;
  engagement_partner_id: string | null;
  engagement_manager_id: string | null;
  engagement_status: string;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  assigned_to_employee_id: string | null;
  assignee_name: string | null;
  reviewer_employee_id: string | null;
  reviewer_name: string | null;
  version: number;
}

interface ItemRow {
  id: string;
  item_code: string;
  label: string;
  slot_code: string | null;
  required: boolean;
  sequence: number;
  auto_tick: ChecklistAutoTick | null;
  note: string | null;
  status: ChecklistItem['status'];
  done_by_name: string | null;
  done_at: Date | null;
  na_reason: string | null;
  document_id: string | null;
  client_dependency_id: string | null;
  version: number;
}

interface FilingRow {
  id: string;
  reference_kind: FilingReferenceKind;
  reference_no: string;
  filed_on: string;
  filed_by_employee_id: string | null;
  filed_by_name: string | null;
  is_nil: boolean;
  figures: Figures;
  late_fee_paid: string | null;
  interest_paid: string | null;
  ack_document_id: string;
  remarks: string | null;
  created_at: Date;
  undone_at: Date | null;
  undone_by_name: string | null;
  undo_reason: string | null;
}

const INSTANCE_SQL = `
  SELECT ci.id, ci.engagement_id, ci.registration_id, r.registration_number,
         ci.compliance_rule_id, cr.code AS rule_code, cr.name AS rule_name,
         rv.form_label, rv.verification, rv.late_fee_note,
         COALESCE(rv.stream, sv.stream) AS stream, ci.section, ci.financial_year, ci.period_key,
         ci.period_start::text, ci.period_end::text,
         COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)::text AS due,
         COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS internal_due,
         ci.workflow_status, ci.is_provisional, ci.notes,
         hsdg.is_engagement_lead(ci.engagement_id) AS is_lead,
         hsdg.is_engagement_member(ci.engagement_id) AS is_member,
         e.engagement_partner_id, e.engagement_manager_id, e.status AS engagement_status
    FROM hsdg.compliance_instances ci
    JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
    JOIN hsdg.engagements e ON e.id = ci.engagement_id
    LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
    LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
    LEFT JOIN hsdg.services sv ON sv.id = es.service_id
    LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
    LEFT JOIN hsdg.entity_registrations r ON r.id = ci.registration_id
   WHERE ci.id = $1`;

const CLOSED_ENGAGEMENT = ['completed', 'closed', 'cancelled', 'declined', 'withdrawn', 'merged'];

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/** Map a database error to the HTTP answer the caller can act on. */
function mapPgError(err: unknown): unknown {
  if (err instanceof HttpException) return err;
  const e = err as { code?: string; constraint?: string };
  if (e.code === '42501') return new ForbiddenException('You do not have access to change this filing.');
  if (e.code === '23505') {
    if (e.constraint === 'filing_records_one_live') {
      return new ConflictException('This filing is already lodged.');
    }
    return new ConflictException(
      'That reference number is already recorded for this registration and return.',
    );
  }
  if (e.code === '23514' || e.code === '22P02') return new BadRequestException('Invalid value.');
  if (e.code === 'P0001') return new ConflictException((err as Error).message);
  return err;
}

/**
 * Change 5 — one filing's workspace (the month-section panel of the GST tab,
 * and the same panel on TDS / Income Tax / ROC): its checklist, document slots,
 * figures, task, lodge and corrections. Every row is a compliance_instance; its
 * workflow_status is derived in SQL from the task, open client requests and the
 * filing record, so this service only ever writes the facts.
 *
 * Access: members read and work; a lead (EP / manager) waives and may lodge
 * before Ready to file; undo is a lead within 24 h, then a partner. RLS
 * enforces the same floor underneath.
 */
@Injectable()
export class FilingWorkspaceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly workflow: TaskWorkflowService,
    private readonly documents: DocumentsService,
    private readonly uploads: ClientUploadService,
  ) {}

  /** GET /compliance-instances/:id — seeds the checklist on first open. */
  async get(ctx: RlsContext, id: string): Promise<InstanceWorkspace> {
    return this.db.withRlsContext(ctx, async (client) => {
      const inst = await this.loadInstance(client, id);
      if (inst.is_member && !CLOSED_ENGAGEMENT.includes(inst.engagement_status)) {
        await seedChecklistForInstance(client, id);
        await syncAutoTicks(client, id);
      }
      return this.build(client, ctx, id);
    });
  }

  /** PATCH /compliance-instances/:id/items/:itemId — tick, untick, not applicable. */
  async patchItem(
    ctx: RlsContext,
    id: string,
    itemId: string,
    dto: PatchChecklistItemDto,
  ): Promise<InstanceWorkspace> {
    return this.write(ctx, id, async (client, inst) => {
      const { rows } = await client.query<ItemRow>(
        `SELECT id, item_code, label, slot_code, required, auto_tick, status, version
           FROM hsdg.instance_checklist_items WHERE id = $1 AND compliance_instance_id = $2`,
        [itemId, id],
      );
      const item = rows[0];
      if (!item) throw new NotFoundException('Checklist item not found.');
      this.requireUnlocked(client, inst, await this.summaryFiledLabel(client, inst));
      if (item.status === dto.status) return;
      if (dto.status !== 'not_applicable' && (item.auto_tick === 'review' || item.auto_tick === 'lodge')) {
        throw new ConflictException(
          item.auto_tick === 'review'
            ? 'This step ticks itself when the reviewer approves the task.'
            : 'This step ticks itself when the filing is lodged.',
        );
      }
      if (dto.status === 'done' && item.auto_tick === 'document') {
        throw new ConflictException('Upload the document to its slot — this step then ticks itself.');
      }
      if (dto.status === 'not_applicable') {
        if (!dto.naReason?.trim()) throw new BadRequestException('Give a reason for Not applicable.');
        if (item.required && !inst.is_lead) {
          throw new ForbiddenException('Only the engagement manager or partner can waive a required step.');
        }
        if (item.auto_tick === 'lodge') {
          throw new ConflictException('Mark the whole filing Not applicable instead.');
        }
      }
      const res = await client.query(
        `UPDATE hsdg.instance_checklist_items
            SET status = $1,
                done_at = CASE WHEN $1 = 'done' THEN now() END,
                done_by_employee_id = CASE WHEN $1 = 'done' THEN $2::uuid END,
                na_reason = CASE WHEN $1 = 'not_applicable' THEN $3 END,
                version = version + 1
          WHERE id = $4 AND version = $5`,
        [dto.status, ctx.employeeId ?? null, dto.naReason?.trim() ?? null, itemId, dto.version],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ConflictException('Someone else changed this step — reload and try again.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'filing.item_updated',
        objectType: 'compliance_instance',
        objectId: id,
        before: { item: item.item_code, status: item.status },
        after: { item: item.item_code, status: dto.status, reason: dto.naReason ?? null },
      });
    });
  }

  /** PUT /compliance-instances/:id/figures. */
  async saveFigures(ctx: RlsContext, id: string, dto: SaveFiguresDto): Promise<InstanceWorkspace> {
    return this.write(ctx, id, async (client, inst) => {
      this.requireUnlocked(client, inst, await this.summaryFiledLabel(client, inst));
      const schema = figureSchema(this.formOf(inst));
      if (schema.length === 0) throw new BadRequestException('This filing records no figures.');
      const { figures, errors } = validateFigures(schema, dto.figures, { forLodge: false });
      if (errors.length) throw new BadRequestException(errors.join(' '));
      if (dto.version === undefined) {
        const ins = await client.query(
          `INSERT INTO hsdg.instance_figures (compliance_instance_id, engagement_id, figures, updated_by_employee_id)
           VALUES ($1,$2,$3,$4) ON CONFLICT (compliance_instance_id) DO NOTHING`,
          [id, inst.engagement_id, JSON.stringify(figures), ctx.employeeId ?? null],
        );
        if ((ins.rowCount ?? 0) === 0) {
          throw new ConflictException('Figures were already saved — reload and try again.');
        }
      } else {
        const res = await client.query(
          `UPDATE hsdg.instance_figures
              SET figures = $1, updated_by_employee_id = $2, version = version + 1
            WHERE compliance_instance_id = $3 AND version = $4`,
          [JSON.stringify(figures), ctx.employeeId ?? null, id, dto.version],
        );
        if ((res.rowCount ?? 0) === 0) {
          throw new ConflictException('Someone else changed these figures — reload and try again.');
        }
      }
      // Items that tick on figures follow whether any are entered.
      await client.query(
        `UPDATE hsdg.instance_checklist_items
            SET status = CASE WHEN $2 THEN 'done' ELSE 'open' END,
                done_at = CASE WHEN $2 THEN now() END,
                done_by_employee_id = CASE WHEN $2 THEN $3::uuid END,
                version = version + 1
          WHERE compliance_instance_id = $1 AND auto_tick = 'figure'
            AND status <> 'not_applicable' AND (status = 'done') IS DISTINCT FROM $2`,
        [id, Object.keys(figures).length > 0, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'filing.figures_saved',
        objectType: 'compliance_instance',
        objectId: id,
        after: { figures },
      });
    });
  }

  /**
   * POST /compliance-instances/:id/slots/:slot/request — a client dependency
   * for the slot plus a secure upload link; the client's upload lands in the
   * slot (documents_link_filing trigger) and ticks its step.
   */
  async requestSlot(
    ctx: RlsContext,
    id: string,
    slot: string,
    dto: SlotRequestDto,
  ): Promise<{ workspace: InstanceWorkspace; link: ClientUploadLinkCreated }> {
    let engagementId = '';
    let dependencyId = '';
    await this.write(ctx, id, async (client, inst) => {
      engagementId = inst.engagement_id;
      this.requireUnlocked(client, inst, await this.summaryFiledLabel(client, inst));
      const label = await this.slotLabel(client, id, slot);
      const open = await client.query(
        `SELECT 1 FROM hsdg.client_dependencies
          WHERE compliance_instance_id = $1 AND slot_code = $2
            AND status IN ('pending','partially_received')`,
        [id, slot],
      );
      if (open.rows[0]) throw new ConflictException('This document is already requested from the client.');
      const task = await this.loadTask(client, id);
      const requested =
        dto.requestedInfo?.trim() ||
        `${label} — ${inst.rule_name} ${periodLabel(inst.period_key)}`.trim();
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.client_dependencies
           (engagement_id, requested_info, responsible_employee_id, created_by_employee_id,
            escalation_date, engagement_service_id, compliance_instance_id, task_id,
            period_section, slot_code)
         SELECT $1, $2, $3, $4, $5, ci.engagement_service_id, ci.id, $6, ci.section, $7
           FROM hsdg.compliance_instances ci WHERE ci.id = $8
         RETURNING id`,
        [
          inst.engagement_id,
          requested,
          task?.assigned_to_employee_id ?? ctx.employeeId ?? null,
          ctx.employeeId ?? null,
          dto.escalationDate ?? null,
          task?.id ?? null,
          slot,
          id,
        ],
      );
      dependencyId = rows[0]!.id;
      await client.query(
        `UPDATE hsdg.instance_checklist_items
            SET client_dependency_id = $1, version = version + 1
          WHERE compliance_instance_id = $2 AND slot_code = $3 AND status = 'open'`,
        [dependencyId, id, slot],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'filing.slot_requested',
        objectType: 'compliance_instance',
        objectId: id,
        after: { slot, dependencyId },
      });
    });
    // The link is minted in its own transaction (ClientUploadService owns it).
    const link = await this.uploads.createLink(ctx, engagementId, dependencyId, {
      ...(dto.ttlHours ? { ttlHours: dto.ttlHours } : {}),
    });
    return { workspace: await this.get(ctx, id), link };
  }

  /** POST /compliance-instances/:id/slots/:slot/documents — a member uploads into a slot. */
  async uploadToSlot(
    ctx: RlsContext,
    id: string,
    slot: string,
    dto: SlotUploadDto,
  ): Promise<InstanceWorkspace> {
    const { inst, label } = await this.db.withRlsContext(ctx, async (client) => {
      const i = await this.loadInstance(client, id);
      if (!i.is_member) throw new ForbiddenException('Only the engagement team can upload here.');
      this.requireOpenEngagement(i);
      // The acknowledgement goes in after lodge only via undo; slots lock with the filing.
      this.requireUnlocked(client, i, await this.summaryFiledLabel(client, i));
      await seedChecklistForInstance(client, id);
      return { inst: i, label: await this.slotLabel(client, id, slot) };
    });
    await this.documents.create(ctx, inst.engagement_id, {
      title: dto.title?.trim() || `${label} — ${inst.rule_name} ${periodLabel(inst.period_key)}`.trim(),
      filename: dto.filename,
      contentBase64: dto.contentBase64,
      ...(dto.contentType ? { contentType: dto.contentType } : {}),
      documentType: slot.startsWith('ACK_') ? 'acknowledgement' : 'working_paper',
      classification: 'client_shared',
      complianceInstanceId: id,
      periodSection: inst.section,
      slotCode: slot,
    });
    return this.get(ctx, id);
  }

  /**
   * POST /compliance-instances/:id/documents/:docId/slot — file a received
   * document (e.g. from the monthly request) into a slot; ticks its step.
   */
  async fileDocument(
    ctx: RlsContext,
    id: string,
    documentId: string,
    slotCode: string,
  ): Promise<InstanceWorkspace> {
    return this.write(ctx, id, async (client, inst) => {
      this.requireUnlocked(client, inst, await this.summaryFiledLabel(client, inst));
      await this.slotLabel(client, id, slotCode);
      const res = await client.query(
        `UPDATE hsdg.documents SET slot_code = $1, version = version + 1
          WHERE id = $2 AND compliance_instance_id = $3 AND status = 'active' AND deleted_at IS NULL`,
        [slotCode, documentId, id],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new NotFoundException('Document not found on this filing, or you cannot re-file it.');
      }
      await syncAutoTicks(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'filing.document_filed',
        objectType: 'document',
        objectId: documentId,
        after: { complianceInstanceId: id, slotCode },
      });
    });
  }

  /** POST /compliance-instances/:id/lodge — record the filing. */
  async lodge(ctx: RlsContext, id: string, dto: LodgeDto): Promise<InstanceWorkspace> {
    return this.write(ctx, id, async (client, inst) => {
      const me = ctx.employeeId ?? null;
      if (!me) throw new BadRequestException('Your account is not linked to an employee record.');
      const task = await this.loadTask(client, id);
      const isAssignee = task?.assigned_to_employee_id === me;
      if (!inst.is_lead && !isAssignee) {
        throw new ForbiddenException('Only the preparer or the engagement manager can lodge this filing.');
      }
      if (inst.workflow_status === 'filed') throw new ConflictException('This filing is already lodged.');
      if (inst.workflow_status === 'not_applicable') {
        throw new ConflictException('This filing is marked Not applicable — lift that first.');
      }
      if (inst.workflow_status !== 'ready_to_file' && !inst.is_lead) {
        throw new ConflictException(
          'This filing is not Ready to file yet — it needs the reviewer’s approval first.',
        );
      }

      const kind = dto.referenceKind ?? defaultReferenceKind(inst.stream);
      const ref = checkReference(kind, dto.referenceNo, inst.stream);
      if ('error' in ref) throw new BadRequestException(ref.error);
      const filedOn = dto.filedOn.slice(0, 10);
      const dateErr = checkFiledOn(filedOn, istToday(new Date()), inst.period_end);
      if (dateErr) throw new BadRequestException(dateErr);

      const form = this.formOf(inst);
      const savedFigures = await this.loadFigures(client, id);
      const { figures, errors } = validateFigures(
        figureSchema(form),
        dto.figures ?? savedFigures.figures,
        { forLodge: figuresRequiredToLodge(form), isNil: dto.isNil ?? false },
      );
      if (errors.length) throw new BadRequestException(errors.join(' '));

      const ack = await client.query(
        `SELECT 1 FROM hsdg.documents
          WHERE id = $1 AND compliance_instance_id = $2 AND status = 'active' AND deleted_at IS NULL`,
        [dto.ackDocumentId, id],
      );
      if (!ack.rows[0]) {
        throw new BadRequestException('Upload the acknowledgement to this filing before lodging.');
      }
      const filedBy = dto.filedByEmployeeId ?? me;
      if (filedBy !== me) await this.requireMember(client, inst.engagement_id, filedBy);

      await client.query(
        `INSERT INTO hsdg.filing_records
           (compliance_instance_id, engagement_id, registration_id, compliance_rule_id, period_key,
            reference_kind, reference_no, filed_on, filed_by_employee_id, is_nil, figures,
            late_fee_paid, interest_paid, ack_document_id, remarks, recorded_by_employee_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id,
          inst.engagement_id,
          inst.registration_id,
          inst.compliance_rule_id,
          inst.period_key,
          kind,
          ref.value,
          filedOn,
          filedBy,
          dto.isNil ?? false,
          JSON.stringify(figures),
          dto.lateFeePaid ?? (typeof figures.late_fee_paid === 'number' ? figures.late_fee_paid : null),
          dto.interestPaid ?? (typeof figures.interest_paid === 'number' ? figures.interest_paid : null),
          dto.ackDocumentId,
          dto.remarks?.trim() || null,
          me,
        ],
      );
      // The lodged figures are the filing's figures from now on.
      if (Object.keys(figures).length > 0) {
        await client.query(
          `INSERT INTO hsdg.instance_figures (compliance_instance_id, engagement_id, figures, updated_by_employee_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (compliance_instance_id)
           DO UPDATE SET figures = EXCLUDED.figures, updated_by_employee_id = EXCLUDED.updated_by_employee_id,
                         version = hsdg.instance_figures.version + 1`,
          [id, inst.engagement_id, JSON.stringify(figures), me],
        );
      }

      // The linked task closes and its clock stops (same transaction).
      if (task && !['done', 'cancelled'].includes(task.status)) {
        await this.workflow.transitionWith(
          client,
          ctx,
          inst.engagement_id,
          task.id,
          task.status === 'in_review' ? TASK_ACTION.approve : TASK_ACTION.complete,
          { reason: `Lodged ${ref.value}` },
        );
      }
      await syncAutoTicks(client, id);

      const what = `${inst.form_label ?? inst.rule_name} ${periodLabel(inst.period_key)}`.trim();
      const recipients = [inst.engagement_manager_id ?? inst.engagement_partner_id].filter(
        (x): x is string => !!x && x !== me,
      );
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.filingLodged,
        recipientEmployeeIds: recipients,
        title: `${what} filed`,
        body: `${kind.toUpperCase()} ${ref.value}, filed on ${filedOn}${dto.isNil ? ' (Nil)' : ''}.`,
        engagementId: inst.engagement_id,
        objectType: 'compliance_instance',
        objectId: id,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'filing.lodged',
        objectType: 'compliance_instance',
        objectId: id,
        before: { workflowStatus: inst.workflow_status },
        after: { referenceKind: kind, referenceNo: ref.value, filedOn, isNil: dto.isNil ?? false },
      });
    });
  }

  /** POST /compliance-instances/:id/lodge/undo — lead within 24 h, then partner. */
  async undoLodge(ctx: RlsContext, id: string, reason: string): Promise<InstanceWorkspace> {
    return this.write(ctx, id, async (client, inst) => {
      const live = await client.query<{ id: string; created_at: Date; reference_no: string }>(
        `SELECT id, created_at, reference_no FROM hsdg.filing_records
          WHERE compliance_instance_id = $1 AND undone_at IS NULL`,
        [id],
      );
      const rec = live.rows[0];
      if (!rec) throw new ConflictException('This filing has no lodge to undo.');
      const ok = undoAllowed({
        isLead: inst.is_lead,
        isPartner: this.isPartner(ctx, inst),
        recordedAt: rec.created_at,
        now: new Date(),
      });
      if (!ok.ok) throw new ForbiddenException(ok.why);
      if (!reason.trim()) throw new BadRequestException('Give a reason for undoing the lodge.');
      await client.query(
        `UPDATE hsdg.filing_records
            SET undone_at = now(), undone_by_employee_id = $1, undo_reason = $2, version = version + 1
          WHERE id = $3`,
        [ctx.employeeId ?? null, reason.trim(), rec.id],
      );
      await syncAutoTicks(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'filing.lodge_undone',
        objectType: 'compliance_instance',
        objectId: id,
        before: { referenceNo: rec.reference_no },
        after: { reason: reason.trim() },
      });
    });
  }

  /** POST /compliance-instances/:id/not-applicable — lead only, with a reason. */
  async markNotApplicable(ctx: RlsContext, id: string, reason: string): Promise<InstanceWorkspace> {
    return this.write(ctx, id, async (client, inst) => {
      if (!inst.is_lead) {
        throw new ForbiddenException('Only the engagement manager or partner can mark a filing Not applicable.');
      }
      if (inst.workflow_status === 'filed') throw new ConflictException('A lodged filing cannot be waived.');
      if (inst.workflow_status === 'not_applicable') return;
      await client.query(
        `UPDATE hsdg.compliance_instances
            SET workflow_status = 'not_applicable', notes = $2, version = version + 1
          WHERE id = $1`,
        [id, NA_NOTE_PREFIX + reason.trim()],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'filing.not_applicable',
        objectType: 'compliance_instance',
        objectId: id,
        before: { workflowStatus: inst.workflow_status },
        after: { reason: reason.trim() },
      });
    });
  }

  /** POST /compliance-instances/:id/not-applicable/lift — back to its derived status. */
  async liftNotApplicable(ctx: RlsContext, id: string): Promise<InstanceWorkspace> {
    return this.write(ctx, id, async (client, inst) => {
      if (!inst.is_lead) throw new ForbiddenException('Only the engagement manager or partner can do this.');
      if (inst.workflow_status !== 'not_applicable') return;
      await client.query(
        `UPDATE hsdg.compliance_instances
            SET workflow_status = 'not_started', version = version + 1,
                notes = CASE WHEN notes LIKE $2 THEN NULL ELSE notes END
          WHERE id = $1`,
        [id, NA_NOTE_PREFIX + '%'],
      );
      await client.query(`SELECT hsdg.refresh_instance_workflow_status($1)`, [id]);
      await this.audit.recordWith(client, ctx, {
        action: 'filing.not_applicable_lifted',
        objectType: 'compliance_instance',
        objectId: id,
      });
    });
  }

  /** POST /compliance-instances/:id/corrections — point a lodged filing at the later one that fixed it. */
  async addCorrection(ctx: RlsContext, id: string, dto: CorrectionDto): Promise<InstanceWorkspace> {
    return this.write(ctx, id, async (client, inst) => {
      if (inst.workflow_status !== 'filed') {
        throw new ConflictException('Corrections are recorded on a lodged filing.');
      }
      if (dto.correctedInInstanceId) {
        const later = await client.query<{ ok: boolean }>(
          `SELECT (ci.engagement_id = $2
                   AND ci.registration_id IS NOT DISTINCT FROM $3
                   AND COALESCE(ci.period_start, ci.statutory_deadline) >= COALESCE($4::date, '-infinity'::date)
                   AND ci.id <> $5) AS ok
             FROM hsdg.compliance_instances ci WHERE ci.id = $1`,
          [dto.correctedInInstanceId, inst.engagement_id, inst.registration_id, inst.period_start, id],
        );
        if (!later.rows[0]?.ok) {
          throw new BadRequestException(
            'The correcting filing must be a later period of the same registration on this engagement.',
          );
        }
      }
      await client.query(
        `INSERT INTO hsdg.filing_corrections
           (compliance_instance_id, engagement_id, corrected_in_instance_id, note, created_by_employee_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, inst.engagement_id, dto.correctedInInstanceId ?? null, dto.note.trim(), ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'filing.correction_added',
        objectType: 'compliance_instance',
        objectId: id,
        after: { correctedInInstanceId: dto.correctedInInstanceId ?? null },
      });
    });
  }

  // ── read model ─────────────────────────────────────────────────────────

  private async build(client: PoolClient, ctx: RlsContext, id: string): Promise<InstanceWorkspace> {
    const inst = await this.loadInstance(client, id);
    const now = new Date();
    const today = istToday(now);
    const me = ctx.employeeId ?? null;
    // One client runs one query at a time; keep these sequential.
    const task = await this.loadTask(client, id);
    const items = await client.query<ItemRow>(
        `SELECT it.id, it.item_code, it.label, it.slot_code, it.required, it.sequence, it.auto_tick,
                it.note, it.status, e.full_name AS done_by_name, it.done_at, it.na_reason,
                it.document_id, it.client_dependency_id, it.version
           FROM hsdg.instance_checklist_items it
           LEFT JOIN hsdg.employees e ON e.id = it.done_by_employee_id
          WHERE it.compliance_instance_id = $1
          ORDER BY it.sequence, it.item_code`,
        [id],
      );
    const docs = await client.query<{
        id: string;
        title: string;
        slot_code: string | null;
        filename: string | null;
        created_at: Date;
        uploaded_by_name: string | null;
        from_client: boolean;
      }>(
        `SELECT d.id, d.title, d.slot_code, cv.filename, d.created_at,
                ce.full_name AS uploaded_by_name,
                (d.client_dependency_id IS NOT NULL AND d.created_by_employee_id IS NULL) AS from_client
           FROM hsdg.documents d
           LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
           LEFT JOIN hsdg.employees ce ON ce.id = d.created_by_employee_id
          WHERE d.compliance_instance_id = $1 AND d.status = 'active' AND d.deleted_at IS NULL
          ORDER BY d.created_at DESC`,
        [id],
      );
    const requests = await client.query<{ id: string; slot_code: string | null; created_at: Date; escalation_date: string | null }>(
        `SELECT id, slot_code, created_at, escalation_date::text
           FROM hsdg.client_dependencies
          WHERE compliance_instance_id = $1 AND status IN ('pending','partially_received')`,
        [id],
      );
    const figures = await this.loadFigures(client, id);
    const filings = await client.query<FilingRow>(
        `SELECT fr.id, fr.reference_kind, fr.reference_no, fr.filed_on::text, fr.filed_by_employee_id,
                fe.full_name AS filed_by_name, fr.is_nil, fr.figures, fr.late_fee_paid::text,
                fr.interest_paid::text, fr.ack_document_id, fr.remarks, fr.created_at, fr.undone_at,
                ue.full_name AS undone_by_name, fr.undo_reason
           FROM hsdg.filing_records fr
           LEFT JOIN hsdg.employees fe ON fe.id = fr.filed_by_employee_id
           LEFT JOIN hsdg.employees ue ON ue.id = fr.undone_by_employee_id
          WHERE fr.compliance_instance_id = $1
          ORDER BY fr.created_at DESC`,
        [id],
      );
    const corrections = await client.query<{
        id: string;
        corrected_in_instance_id: string | null;
        corrected_rule: string | null;
        corrected_period: string | null;
        note: string;
        created_by_name: string | null;
        created_at: Date;
      }>(
        `SELECT fc.id, fc.corrected_in_instance_id, COALESCE(rv.form_label, cr.name) AS corrected_rule,
                ci.period_key AS corrected_period, fc.note, e.full_name AS created_by_name, fc.created_at
           FROM hsdg.filing_corrections fc
           LEFT JOIN hsdg.compliance_instances ci ON ci.id = fc.corrected_in_instance_id
           LEFT JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
           LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
           LEFT JOIN hsdg.employees e ON e.id = fc.created_by_employee_id
          WHERE fc.compliance_instance_id = $1
          ORDER BY fc.created_at`,
        [id],
      );
    const summaryFiled = await this.summaryFiledLabel(client, inst);

    const checklist: ChecklistItem[] = items.rows.map((r) => ({
      id: r.id,
      itemCode: r.item_code,
      label: r.label,
      slotCode: r.slot_code,
      required: r.required,
      sequence: r.sequence,
      autoTick: r.auto_tick,
      note: r.note,
      status: r.status,
      doneByName: r.done_by_name,
      doneAt: r.done_at ? r.done_at.toISOString() : null,
      naReason: r.na_reason,
      documentId: r.document_id,
      clientDependencyId: r.client_dependency_id,
      version: r.version,
    }));

    // Slots: one per checklist slot, in checklist order, plus any slot a
    // document was filed under that the template no longer lists.
    const slots: WorkspaceSlot[] = [];
    const seen = new Set<string>();
    const addSlot = (code: string, label: string, required: boolean): void => {
      if (seen.has(code)) return;
      seen.add(code);
      const req = requests.rows.find((q) => q.slot_code === code);
      slots.push({
        slotCode: code,
        label,
        required,
        documents: docs.rows
          .filter((d) => d.slot_code === code)
          .map((d) => ({
            id: d.id,
            title: d.title,
            filename: d.filename,
            uploadedAt: d.created_at.toISOString(),
            uploadedByName: d.uploaded_by_name,
            fromClient: d.from_client,
          })),
        openRequest: req
          ? {
              dependencyId: req.id,
              requestedAt: req.created_at.toISOString(),
              escalationDate: req.escalation_date,
            }
          : null,
      });
    };
    for (const it of checklist) {
      if (it.slotCode && it.status !== 'not_applicable') {
        addSlot(it.slotCode, it.autoTick === 'lodge' ? 'Acknowledgement' : it.label, it.required);
      }
    }
    for (const d of docs.rows) if (d.slot_code) addSlot(d.slot_code, humanSlot(d.slot_code), false);
    // Uploads with no slot (the monthly data request covers several) wait here to be filed.
    const unsorted = docs.rows.filter((d) => !d.slot_code);
    if (unsorted.length > 0) {
      slots.push({
        slotCode: UNSORTED_SLOT,
        label: 'Received — not yet filed to a slot',
        required: false,
        documents: unsorted.map((d) => ({
          id: d.id,
          title: d.title,
          filename: d.filename,
          uploadedAt: d.created_at.toISOString(),
          uploadedByName: d.uploaded_by_name,
          fromClient: d.from_client,
        })),
        openRequest: null,
      });
    }

    const views = filings.rows.map((r) => this.filingView(r, inst.due));
    const live = views.find((v) => !v.undoneAt) ?? null;
    const liveRow = filings.rows.find((r) => !r.undone_at) ?? null;
    const lock = lockState({
      workflowStatus: inst.workflow_status,
      section: inst.section,
      summaryFiledLabel: summaryFiled,
    });
    const form = this.formOf(inst);
    const isAssignee = !!me && task?.assigned_to_employee_id === me;
    const can = canFlags({
      isLead: inst.is_lead,
      isPartner: this.isPartner(ctx, inst),
      isAssignee,
      isMember: inst.is_member,
      workflowStatus: inst.workflow_status,
      isLocked: lock.isLocked || CLOSED_ENGAGEMENT.includes(inst.engagement_status),
      hasLiveFiling: !!live,
      liveRecordedAt: liveRow?.created_at ?? null,
      now,
    });

    const warnings = await this.warnings(client, inst, figures.figures, live);
    const openRequired = checklist.filter(
      (c) => c.required && c.status === 'open' && c.autoTick !== 'lodge',
    ).length;
    if (openRequired > 0 && ['ready_to_file', 'in_review'].includes(inst.workflow_status)) {
      warnings.push({
        code: 'required_open',
        message: `${openRequired} required step${openRequired === 1 ? ' is' : 's are'} still open.`,
      });
    }

    const outputTax = sumPrefix(figures.figures, 'output_');
    const lateCharges =
      inst.stream === 'gst' && !live && inst.workflow_status !== 'not_applicable'
        ? indicativeLateCharges({ dueDate: inst.due, asOf: today, isNil: false, taxPayable: outputTax })
        : null;

    return {
      instance: {
        id: inst.id,
        engagementId: inst.engagement_id,
        ruleCode: inst.rule_code,
        ruleName: inst.rule_name,
        formLabel: inst.form_label,
        stream: inst.stream,
        section: inst.section,
        financialYear: inst.financial_year,
        periodKey: inst.period_key,
        periodStart: inst.period_start,
        periodEnd: inst.period_end,
        statutoryDueDate: inst.due,
        internalDate: inst.internal_due,
        daysLeft: daysBetween(today, inst.due),
        workflowStatus: inst.workflow_status,
        isProvisional: inst.is_provisional,
        verify: inst.verification === 'verify',
        registrationId: inst.registration_id,
        registrationNumber: inst.registration_number,
        isLocked: lock.isLocked,
        lockedReason: lock.reason,
        lateFeeNote: inst.late_fee_note,
        lateCharges,
        notApplicableReason:
          inst.workflow_status === 'not_applicable'
            ? (inst.notes?.startsWith(NA_NOTE_PREFIX) ? inst.notes.slice(NA_NOTE_PREFIX.length) : inst.notes)
            : null,
      },
      task: task
        ? {
            id: task.id,
            title: task.title,
            status: task.status,
            assigneeId: task.assigned_to_employee_id,
            assigneeName: task.assignee_name,
            reviewerId: task.reviewer_employee_id,
            reviewerName: task.reviewer_name,
            version: task.version,
          }
        : null,
      checklist,
      slots,
      figureSchema: figureSchema(form),
      figures: figures.figures,
      figuresVersion: figures.version,
      figuresRequiredToLodge: figuresRequiredToLodge(form),
      filing: live,
      filingHistory: views,
      corrections: corrections.rows.map(
        (c): FilingCorrectionView => ({
          id: c.id,
          correctedInInstanceId: c.corrected_in_instance_id,
          correctedInLabel: c.corrected_rule
            ? `${c.corrected_rule} ${periodLabel(c.corrected_period)}`.trim()
            : null,
          note: c.note,
          createdByName: c.created_by_name,
          createdAt: c.created_at.toISOString(),
        }),
      ),
      warnings,
      can,
    };
  }

  /** GST cross-checks across the period's three sections (warnings only). */
  private async warnings(
    client: PoolClient,
    inst: InstanceRow,
    ownFigures: Figures,
    live: FilingRecordView | null,
  ): Promise<CrossCheckWarning[]> {
    if (inst.stream !== 'gst' || !inst.registration_id || !inst.period_key) return [];
    if (!inst.section || inst.section === 'annual') return [];
    const { rows } = await client.query<{
      id: string;
      section: PeriodSection;
      filed_on: string | null;
      filed_figures: Figures | null;
      figures: Figures | null;
      exports_reported: boolean;
    }>(
      `SELECT ci.id, ci.section, fr.filed_on::text, fr.figures AS filed_figures, f.figures,
              EXISTS (SELECT 1 FROM hsdg.instance_checklist_items it
                       WHERE it.compliance_instance_id = ci.id AND it.item_code = 'EXPORT_DOCS'
                         AND it.status = 'done') AS exports_reported
         FROM hsdg.compliance_instances ci
         LEFT JOIN hsdg.filing_records fr ON fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL
         LEFT JOIN hsdg.instance_figures f ON f.compliance_instance_id = ci.id
        WHERE ci.engagement_id = $1 AND ci.registration_id = $2 AND ci.period_key = $3
          AND ci.section IN ('outward','inward','summary') AND ci.workflow_status <> 'not_applicable'`,
      [inst.engagement_id, inst.registration_id, inst.period_key],
    );
    const pick = (s: PeriodSection) => {
      const r = rows.find((x) => x.section === s);
      if (!r) return null;
      const figures = r.id === inst.id ? (live?.figures as Figures | undefined) ?? ownFigures : r.filed_figures ?? r.figures;
      return { filedOn: r.filed_on, figures: figures ?? null, exportsReported: r.exports_reported };
    };
    const lut = await client.query(
      `SELECT 1 FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
        WHERE ci.registration_id = $1 AND ci.financial_year = $2
          AND cr.code ILIKE '%LUT%' AND ci.workflow_status = 'filed'
        LIMIT 1`,
      [inst.registration_id, inst.financial_year],
    );
    const outward = pick('outward');
    const summary = pick('summary');
    const inward = pick('inward');
    return gstCrossChecks({
      outward,
      summary: summary ? { filedOn: summary.filedOn, figures: summary.figures } : null,
      inward: inward ? { figures: inward.figures } : null,
      lutFiled: !!lut.rows[0],
    });
  }

  private filingView(r: FilingRow, due: string): FilingRecordView {
    return {
      id: r.id,
      referenceKind: r.reference_kind,
      referenceNo: r.reference_no,
      filedOn: r.filed_on,
      filedById: r.filed_by_employee_id,
      filedByName: r.filed_by_name,
      isNil: r.is_nil,
      figures: r.figures ?? {},
      lateFeePaid: num(r.late_fee_paid),
      interestPaid: num(r.interest_paid),
      ackDocumentId: r.ack_document_id,
      remarks: r.remarks,
      recordedAt: r.created_at.toISOString(),
      isLate: r.filed_on > due,
      undoneAt: r.undone_at ? r.undone_at.toISOString() : null,
      undoneByName: r.undone_by_name,
      undoReason: r.undo_reason,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Run a change for a member, then return the fresh workspace — one transaction. */
  private async write(
    ctx: RlsContext,
    id: string,
    work: (client: PoolClient, inst: InstanceRow) => Promise<void>,
  ): Promise<InstanceWorkspace> {
    try {
      return await this.db.withRlsContext(ctx, async (client) => {
        const inst = await this.loadInstance(client, id);
        if (!inst.is_member) throw new ForbiddenException('Only the engagement team can change this filing.');
        this.requireOpenEngagement(inst);
        await seedChecklistForInstance(client, id);
        await work(client, inst);
        return this.build(client, ctx, id);
      });
    } catch (err) {
      throw mapPgError(err);
    }
  }

  private async loadInstance(client: PoolClient, id: string): Promise<InstanceRow> {
    const { rows } = await client.query<InstanceRow>(INSTANCE_SQL, [id]);
    const row = rows[0];
    if (!row) throw new NotFoundException('Filing not found.');
    return row;
  }

  private async loadTask(client: PoolClient, id: string): Promise<TaskRow | null> {
    const { rows } = await client.query<TaskRow>(
      `SELECT t.id, t.title, t.status, t.assigned_to_employee_id, ae.full_name AS assignee_name,
              t.reviewer_employee_id, re.full_name AS reviewer_name, t.version
         FROM hsdg.tasks t
         LEFT JOIN hsdg.employees ae ON ae.id = t.assigned_to_employee_id
         LEFT JOIN hsdg.employees re ON re.id = t.reviewer_employee_id
        WHERE t.source_compliance_instance_id = $1
        ORDER BY (t.status = 'cancelled'), t.created_at DESC
        LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async loadFigures(client: PoolClient, id: string): Promise<{ figures: Figures; version: number }> {
    const { rows } = await client.query<{ figures: Figures; version: number }>(
      `SELECT figures, version FROM hsdg.instance_figures WHERE compliance_instance_id = $1`,
      [id],
    );
    return rows[0] ?? { figures: {}, version: 0 };
  }

  /** "GSTR-3B Oct 2026" when this month's 3B is filed (locks Outward / Inward). */
  private async summaryFiledLabel(client: PoolClient, inst: InstanceRow): Promise<string | null> {
    if (inst.section !== 'outward' && inst.section !== 'inward') return null;
    if (!inst.registration_id || !inst.period_start || !inst.period_end) return null;
    const { rows } = await client.query<{ label: string; period_key: string | null }>(
      `SELECT COALESCE(rv.form_label, cr.name) AS label, ci.period_key
         FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
         LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
        WHERE ci.engagement_id = $1 AND ci.registration_id = $2 AND ci.section = 'summary'
          AND ci.workflow_status = 'filed'
          AND (upper(COALESCE(rv.form_label, '')) LIKE '%3B%' OR upper(cr.code) LIKE '%3B%')
          AND ci.period_start <= $3::date AND ci.period_end >= $4::date
        LIMIT 1`,
      [inst.engagement_id, inst.registration_id, inst.period_start, inst.period_end],
    );
    const r = rows[0];
    return r ? `${r.label} ${periodLabel(r.period_key)}`.trim() : null;
  }

  private requireUnlocked(_client: PoolClient, inst: InstanceRow, summaryFiled: string | null): void {
    const lock = lockState({
      workflowStatus: inst.workflow_status,
      section: inst.section,
      summaryFiledLabel: summaryFiled,
    });
    if (lock.isLocked) throw new ConflictException(lock.reason ?? 'This filing is read-only.');
  }

  private requireOpenEngagement(inst: InstanceRow): void {
    if (CLOSED_ENGAGEMENT.includes(inst.engagement_status)) {
      throw new ConflictException('This engagement is closed; its filings can no longer change.');
    }
  }

  private async requireMember(client: PoolClient, engagementId: string, employeeId: string): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.engagements e
        WHERE e.id = $1 AND (e.engagement_partner_id = $2 OR e.engagement_manager_id = $2)
       UNION
       SELECT 1 FROM hsdg.engagement_team t WHERE t.engagement_id = $1 AND t.employee_id = $2`,
      [engagementId, employeeId],
    );
    if (!rows[0]) throw new BadRequestException('"Filed by" must be on the engagement team.');
  }

  /** The slot's label from the checklist; 400 when the filing has no such slot. */
  private async slotLabel(client: PoolClient, id: string, slot: string): Promise<string> {
    if (!/^[A-Z0-9_]{2,40}$/.test(slot)) throw new BadRequestException('Unknown document slot.');
    const { rows } = await client.query<{ label: string; auto_tick: string | null }>(
      `SELECT label, auto_tick FROM hsdg.instance_checklist_items
        WHERE compliance_instance_id = $1 AND slot_code = $2
        ORDER BY sequence LIMIT 1`,
      [id, slot],
    );
    if (!rows[0]) throw new BadRequestException('This filing has no such document slot.');
    return rows[0].auto_tick === 'lodge' ? 'Acknowledgement' : rows[0].label;
  }

  private formOf(inst: InstanceRow) {
    return figureForm({
      ruleCode: inst.rule_code,
      formLabel: inst.form_label,
      stream: inst.stream,
      section: inst.section,
    });
  }

  private isPartner(ctx: RlsContext, inst: InstanceRow): boolean {
    return (
      (!!ctx.employeeId && ctx.employeeId === inst.engagement_partner_id) ||
      (PARTNER_ROLES.has(ctx.role) && inst.is_member)
    );
  }
}

function humanSlot(code: string): string {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sumPrefix(f: Figures, prefix: string): number | null {
  let any = false;
  let total = 0;
  for (const [k, v] of Object.entries(f)) {
    if (k.startsWith(prefix) && typeof v === 'number') {
      any = true;
      total += v;
    }
  }
  return any ? total : null;
}
