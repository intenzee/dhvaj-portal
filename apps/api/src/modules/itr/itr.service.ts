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
  CLIENT_REMINDER_CHANNEL,
  ITR_DESK_CATEGORIES,
  ITR_INTIMATION_NOTICE_TYPE,
  ITR_RULE_CODES,
  ITR_STAGES,
  ITR_VERIFY_DAYS_DEFAULT,
  ITR_VERIFY_RULE_CODE,
  NOTIFICATION_TYPE,
  assessmentYearOf,
  canMoveRefund,
  canRemindBy,
  eVerifyReminderText,
  itrStage,
  itrYearLabel,
  matchIncomeLines,
  reminderChannelFor,
  whatsappUrl,
  type AddItrIncomeLineInput,
  type EVerifyItrInput,
  type ImportItrStatementInput,
  type ImportItrStatementResult,
  type ItrForm,
  type ItrIncome,
  type ItrIncomeLine,
  type ItrIncomeSource,
  type ItrIntimationResult,
  type ItrRefundStatus,
  type ItrRegime,
  type ItrReturn,
  type ItrReturnType,
  type ItrSeason,
  type ItrSeasonRow,
  type ItrStage,
  type ItrVerifyMode,
  type ItrVerifyReminder,
  type MoveItrRefundInput,
  type RecordItrIntimationInput,
  type RecordItrIntimationResult,
  type RemindItrVerifyInput,
  type UpdateItrIncomeLineInput,
  type UpdateItrReturnInput,
} from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { decodeUpload } from '../documents/documents.upload';
import { istToday } from '../engagements/time/auto-time';
import { clientPhoneSql } from '../filing-workspace/client-chase';
import { NoticesService } from '../notices/notices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { workflowPolicy } from '../workflow-settings/workflow-policy';
import { StatementRefused, parseStatement } from './parsers';

export type ItrSeasonScope = 'mine' | 'team';

/** Engagements that never carry live work (as the filing run's). */
const DEAD_ENGAGEMENT = ['cancelled', 'declined', 'withdrawn', 'merged'];
/** One import's ceiling — a 26AS has tens of lines, an AIS a few hundred. */
const MAX_LINES = 5000;

/**
 * An ITR filing with its return (when opened), its live filing record and the
 * e-verify days of the ITR_VERIFICATION_DUE version in force on the filing
 * date. `$1` onwards are the caller's; the e-verify rule is a literal.
 */
const RETURN_FROM = `
  FROM hsdg.compliance_instances ci
  JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
  JOIN hsdg.engagements e ON e.id = ci.engagement_id
  JOIN hsdg.entities ent ON ent.id = e.entity_id
  JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
  LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
  LEFT JOIN hsdg.filing_records fr ON fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL
  LEFT JOIN LATERAL (
    SELECT v.offset_days FROM hsdg.compliance_rule_versions v
      JOIN hsdg.compliance_rules vr ON vr.id = v.compliance_rule_id
     WHERE vr.code = '${ITR_VERIFY_RULE_CODE}' AND v.effective_from <= fr.filed_on
       AND (v.effective_to IS NULL OR v.effective_to >= fr.filed_on)
     ORDER BY v.effective_from DESC LIMIT 1) vd ON true
  LEFT JOIN hsdg.itr_returns ir ON ir.compliance_instance_id = ci.id`;

const RETURN_COLUMNS = `
  ci.id AS instance_id, ci.engagement_id, e.engagement_code, ent.id AS entity_id,
  ent.legal_name AS entity_name, et.slug AS entity_type, ent.pan, ci.financial_year,
  ci.workflow_status,
  COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)::text
    AS statutory_date,
  fr.filed_on::text AS filed_on, fr.reference_no AS ack_no,
  (fr.filed_on + COALESCE(vd.offset_days, ${ITR_VERIFY_DAYS_DEFAULT}))::text AS e_verify_due_on,
  ir.id AS return_id, ir.itr_form, ir.regime, ir.return_type, ir.e_verified_on::text AS e_verified_on,
  ir.e_verify_mode, ir.refund_claimed::text AS refund_claimed, ir.refund_status,
  ir.refund_amount::text AS refund_amount, ir.refund_on::text AS refund_on, ir.refund_note,
  ir.intimation_on::text AS intimation_on, ir.intimation_result,
  ir.intimation_amount::text AS intimation_amount, ir.notes, ir.version`;

interface ReturnSqlRow {
  instance_id: string;
  engagement_id: string;
  engagement_code: string;
  entity_id: string;
  entity_name: string;
  entity_type: string;
  pan: string | null;
  financial_year: string;
  workflow_status: string;
  statutory_date: string | null;
  filed_on: string | null;
  ack_no: string | null;
  e_verify_due_on: string | null;
  return_id: string | null;
  itr_form: ItrForm | null;
  regime: ItrRegime | null;
  return_type: ItrReturnType | null;
  e_verified_on: string | null;
  e_verify_mode: ItrVerifyMode | null;
  refund_claimed: string | null;
  refund_status: ItrRefundStatus | null;
  refund_amount: string | null;
  refund_on: string | null;
  refund_note: string | null;
  intimation_on: string | null;
  intimation_result: ItrIntimationResult | null;
  intimation_amount: string | null;
  notes: string | null;
  version: number | null;
}

interface SeasonSqlRow extends ReturnSqlRow {
  preparer_name: string | null;
  reviewer_name: string | null;
  requests_open: number;
  can_assign: boolean;
}

interface LineSqlRow {
  id: string;
  source: ItrIncomeSource;
  head: ItrIncomeLine['head'];
  section: string | null;
  description: string | null;
  payer_name: string | null;
  payer_tan: string | null;
  amount: string;
  tax_deducted: string;
  transaction_on: string | null;
}

/** Not yet verified, and the window has closed (IST today). */
const overdue = (r: ReturnSqlRow, today: string) =>
  !!r.filed_on && !r.e_verified_on && !!r.e_verify_due_on && r.e_verify_due_on < today;

function scopeSql(scope: ItrSeasonScope | undefined): string {
  if (scope === 'mine')
    return `AND (t.assigned_to_employee_id = hsdg.ctx_employee_id()
                 OR t.reviewer_employee_id = hsdg.ctx_employee_id())`;
  if (scope === 'team')
    return `AND (e.engagement_manager_id = hsdg.ctx_employee_id()
                 OR e.engagement_partner_id = hsdg.ctx_employee_id()
                 OR ci.engagement_service_id = ANY(ARRAY(SELECT tes.id FROM hsdg.engagement_services tes
                                                          WHERE tes.lead_employee_id = hsdg.ctx_employee_id())))`;
  return '';
}

/**
 * Practice Services PS-403 — the ITR desk. The season grid is every ITR
 * filing of the year on an individual, HUF or proprietor the caller can see
 * (RLS); the filing run's assign and remind (WF-301) work on its rows. A
 * return is opened on a filing the first time someone works it, and carries
 * the form, regime, e-verification, refund, intimation and income lines. The
 * filing's acknowledgement and date are read from its filing record — the
 * return is lodged in the filing drawer like any other filing.
 */
@Injectable()
export class ItrService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly notices: NoticesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** GET /itr/season — the year's ITRs on the desk's clients. */
  async season(ctx: RlsContext, financialYear: string, scope?: ItrSeasonScope): Promise<ItrSeason> {
    const today = istToday();
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<SeasonSqlRow>(
        `SELECT ${RETURN_COLUMNS},
                pe.full_name AS preparer_name, re.full_name AS reviewer_name,
                (SELECT count(*)::int FROM hsdg.client_dependencies d
                  WHERE d.compliance_instance_id = ci.id
                    AND d.status IN ('pending', 'partially_received')) AS requests_open,
                (hsdg.is_engagement_lead(ci.engagement_id)
                  OR hsdg.can_assign_as_stream_lead(ci.id)) AS can_assign
           ${RETURN_FROM}
           LEFT JOIN LATERAL (
             SELECT t.assigned_to_employee_id, t.reviewer_employee_id FROM hsdg.tasks t
              WHERE t.source_compliance_instance_id = ci.id
              ORDER BY (t.status = 'cancelled'), t.created_at DESC LIMIT 1) t ON true
           LEFT JOIN hsdg.employees pe ON pe.id = t.assigned_to_employee_id
           LEFT JOIN hsdg.employees re ON re.id = t.reviewer_employee_id
          WHERE cr.code = ANY($1::text[]) AND ci.financial_year = $2
            AND et.category = ANY($3::text[])
            AND ci.workflow_status <> 'not_applicable'
            AND e.status <> ALL($4::text[])
            ${scopeSql(scope)}
          ORDER BY ent.legal_name, ci.id`,
        [[...ITR_RULE_CODES], financialYear, [...ITR_DESK_CATEGORIES], DEAD_ENGAGEMENT],
      );
      const items: ItrSeasonRow[] = rows.map((r) => ({
        instanceId: r.instance_id,
        returnId: r.return_id,
        engagementId: r.engagement_id,
        engagementCode: r.engagement_code,
        entityId: r.entity_id,
        entityName: r.entity_name,
        entityType: r.entity_type,
        pan: r.pan,
        itrForm: r.itr_form,
        preparerName: r.preparer_name,
        reviewerName: r.reviewer_name,
        workflowStatus: r.workflow_status,
        statutoryDate: r.statutory_date,
        requestsOpen: r.requests_open,
        stage: this.stageOf(r),
        filedOn: r.filed_on,
        ackNo: r.ack_no,
        eVerifyDueOn: r.filed_on ? r.e_verify_due_on : null,
        eVerifyOverdue: overdue(r, today),
        refundStatus: r.refund_status ?? 'none',
        canAssign: r.can_assign,
      }));
      const stages = Object.fromEntries(ITR_STAGES.map((s) => [s, 0])) as Record<ItrStage, number>;
      for (const i of items) stages[i.stage] += 1;
      return {
        financialYear,
        yearLabel: itrYearLabel(financialYear),
        total: items.length,
        stages,
        eVerifyOverdue: items.filter((i) => i.eVerifyOverdue).length,
        refundsPending: items.filter(
          (i) => i.refundStatus === 'pending' || i.refundStatus === 'failed',
        ).length,
        items,
      };
    });
  }

  /** POST /itr/returns — open the return on an ITR filing (the existing one when there is one). */
  async open(ctx: RlsContext, complianceInstanceId: string): Promise<ItrReturn> {
    return this.write(ctx, async (client) => {
      const { rows } = await client.query<{
        engagement_id: string;
        financial_year: string | null;
        code: string;
        category: string;
      }>(
        `SELECT ci.engagement_id, ci.financial_year, cr.code, et.category
           FROM hsdg.compliance_instances ci
           JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
           JOIN hsdg.engagements e ON e.id = ci.engagement_id
           JOIN hsdg.entities ent ON ent.id = e.entity_id
           JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
          WHERE ci.id = $1`,
        [complianceInstanceId],
      );
      const inst = rows[0];
      if (!inst) throw new NotFoundException('Filing not found.');
      if (!(ITR_RULE_CODES as readonly string[]).includes(inst.code) || !inst.financial_year)
        throw new BadRequestException('This filing is not an income-tax return.');
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.itr_returns WHERE compliance_instance_id = $1`,
        [complianceInstanceId],
      );
      let id = existing.rows[0]?.id;
      if (!id) {
        // The new regime is the default for individuals and HUFs (s.115BAC(1A)).
        const regime = inst.category === 'individual' || inst.category === 'huf' ? 'new' : null;
        const created = await client.query<{ id: string }>(
          `INSERT INTO hsdg.itr_returns
             (compliance_instance_id, engagement_id, financial_year, regime,
              created_by_employee_id, updated_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING id`,
          [
            complianceInstanceId,
            inst.engagement_id,
            inst.financial_year,
            regime,
            ctx.employeeId ?? null,
          ],
        );
        id = created.rows[0]!.id;
        await this.audit.recordWith(client, ctx, {
          action: 'itr_return.opened',
          objectType: 'itr_return',
          objectId: id,
          after: { complianceInstanceId, financialYear: inst.financial_year, regime },
        });
      }
      return this.view(client, id);
    });
  }

  async get(ctx: RlsContext, id: string): Promise<ItrReturn> {
    return this.db.withRlsContext(ctx, (client) => this.view(client, id));
  }

  /** PATCH /itr/returns/:id — form, regime, type, the refund claimed, notes. */
  async update(ctx: RlsContext, id: string, input: UpdateItrReturnInput): Promise<ItrReturn> {
    return this.write(ctx, async (client) => {
      const r = await this.row(client, id, true);
      this.checkVersion(r.version, input.version);
      const next = {
        itrForm: input.itrForm === undefined ? r.itr_form : input.itrForm,
        regime: input.regime === undefined ? r.regime : input.regime,
        returnType: input.returnType ?? r.return_type,
        refundClaimed: input.refundClaimed === undefined ? r.refund_claimed : input.refundClaimed,
        notes: input.notes === undefined ? r.notes : input.notes?.trim() || null,
      };
      // A refund claimed is a refund to follow; none claimed, none to follow.
      const claimed = Number(next.refundClaimed ?? 0) > 0;
      let refundStatus = r.refund_status ?? 'none';
      if (claimed && refundStatus === 'none') refundStatus = 'pending';
      if (!claimed && refundStatus === 'pending') refundStatus = 'none';
      await client.query(
        `UPDATE hsdg.itr_returns
            SET itr_form = $2, regime = $3, return_type = $4, refund_claimed = $5, notes = $6,
                refund_status = $7, updated_by_employee_id = $8, version = version + 1
          WHERE id = $1`,
        [
          id,
          next.itrForm,
          next.regime,
          next.returnType,
          next.refundClaimed,
          next.notes,
          refundStatus,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'itr_return.updated',
        objectType: 'itr_return',
        objectId: id,
        before: {
          itrForm: r.itr_form,
          regime: r.regime,
          returnType: r.return_type,
          refundClaimed: r.refund_claimed,
          refundStatus: r.refund_status,
        },
        after: { ...next, refundStatus },
      });
      return this.view(client, id);
    });
  }

  /**
   * POST /itr/returns/:id/e-verify. On or after the filing and not in the
   * future; a late one is recorded (the return then counts as filed that day).
   */
  async eVerify(ctx: RlsContext, id: string, input: EVerifyItrInput): Promise<ItrReturn> {
    return this.write(ctx, async (client) => {
      const r = await this.row(client, id, true);
      this.checkVersion(r.version, input.version);
      if (!r.filed_on)
        throw new BadRequestException(
          'Lodge the return in the filing drawer before e-verifying it.',
        );
      if (input.eVerifiedOn < r.filed_on)
        throw new BadRequestException('A return is e-verified on or after the day it was filed.');
      if (input.eVerifiedOn > istToday())
        throw new BadRequestException('The e-verification date cannot be in the future.');
      await client.query(
        `UPDATE hsdg.itr_returns
            SET e_verified_on = $2, e_verify_mode = $3, updated_by_employee_id = $4,
                version = version + 1
          WHERE id = $1`,
        [id, input.eVerifiedOn, input.mode, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'itr_return.e_verified',
        objectType: 'itr_return',
        objectId: id,
        before: { eVerifiedOn: r.e_verified_on, eVerifyMode: r.e_verify_mode },
        after: {
          eVerifiedOn: input.eVerifiedOn,
          eVerifyMode: input.mode,
          dueOn: r.e_verify_due_on,
          late: !!r.e_verify_due_on && input.eVerifiedOn > r.e_verify_due_on,
        },
      });
      return this.view(client, id);
    });
  }

  /** POST /itr/returns/:id/refund — one move on the refund (ITR_REFUND_MOVES). */
  async moveRefund(ctx: RlsContext, id: string, input: MoveItrRefundInput): Promise<ItrReturn> {
    return this.write(ctx, async (client) => {
      const r = await this.row(client, id, true);
      this.checkVersion(r.version, input.version);
      const from = r.refund_status ?? 'none';
      if (!canMoveRefund(from, input.to))
        throw new BadRequestException(`A refund ${from} cannot move to ${input.to}.`);
      const settles = input.to === 'issued' || input.to === 'adjusted';
      if (settles && !input.amount)
        throw new BadRequestException(
          input.to === 'issued' ? 'Enter the refund credited.' : 'Enter the amount set off.',
        );
      if ((input.to === 'issued' || input.to === 'adjusted') && !r.filed_on)
        throw new BadRequestException('A refund follows a filed return.');
      const on = settles ? (input.on ?? istToday()) : null;
      if (on && on > istToday()) throw new BadRequestException('The date cannot be in the future.');
      await client.query(
        `UPDATE hsdg.itr_returns
            SET refund_status = $2, refund_amount = $3, refund_on = $4,
                refund_note = COALESCE($5, refund_note), updated_by_employee_id = $6,
                version = version + 1
          WHERE id = $1`,
        [
          id,
          input.to,
          settles ? input.amount : null,
          on,
          input.note?.trim() || null,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'itr_return.refund_moved',
        objectType: 'itr_return',
        objectId: id,
        before: { refundStatus: from, refundAmount: r.refund_amount },
        after: {
          refundStatus: input.to,
          refundAmount: settles ? input.amount : null,
          on,
          note: input.note ?? null,
        },
      });
      return this.view(client, id);
    });
  }

  /**
   * POST /itr/returns/:id/intimation. A 143(1) records the processing on the
   * return (a refund determined puts a refund to follow); a demand or a 245
   * set-off opens a notice on the register with its reply clock, linked to the
   * return. Opening a notice needs notice.manage (`canOpenNotice`).
   */
  async intimation(
    ctx: RlsContext,
    id: string,
    input: RecordItrIntimationInput,
    canOpenNotice: boolean,
  ): Promise<RecordItrIntimationResult> {
    return this.write(ctx, async (client) => {
      const r = await this.row(client, id, true);
      this.checkVersion(r.version, input.version);
      if (!r.filed_on) throw new BadRequestException('An intimation follows a filed return.');
      if (input.issuedOn < r.filed_on)
        throw new BadRequestException('The intimation cannot be before the return was filed.');
      if (input.receivedOn < input.issuedOn)
        throw new BadRequestException('The intimation is received on or after it is issued.');
      if (input.receivedOn > istToday())
        throw new BadRequestException('The dates cannot be in the future.');
      const is1431 = input.kind === '143_1';
      if (is1431 && !input.result)
        throw new BadRequestException('Choose what the intimation determined.');
      const needsAmount = !is1431 || input.result !== 'no_change';
      if (needsAmount && !(Number(input.amount ?? 0) > 0))
        throw new BadRequestException(
          is1431
            ? 'Enter the refund or demand determined.'
            : 'Enter the amount proposed for set-off.',
        );
      const openNotice = input.openNotice ?? (!is1431 || input.result === 'demand');
      if (openNotice && !canOpenNotice)
        throw new ForbiddenException('Recording a notice needs the notice permission.');

      if (is1431) {
        let refundStatus = r.refund_status ?? 'none';
        if (input.result === 'refund' && (refundStatus === 'none' || refundStatus === 'failed'))
          refundStatus = 'pending';
        await client.query(
          `UPDATE hsdg.itr_returns
              SET intimation_on = $2, intimation_result = $3, intimation_amount = $4,
                  refund_status = $5, updated_by_employee_id = $6, version = version + 1
            WHERE id = $1`,
          [
            id,
            input.issuedOn,
            input.result,
            needsAmount ? input.amount : null,
            refundStatus,
            ctx.employeeId ?? null,
          ],
        );
      } else {
        await client.query(
          `UPDATE hsdg.itr_returns SET updated_by_employee_id = $2, version = version + 1
            WHERE id = $1`,
          [id, ctx.employeeId ?? null],
        );
      }

      let noticeId: string | null = null;
      if (openNotice) {
        const notice = await this.notices.createWith(client, ctx, {
          engagementId: r.engagement_id,
          noticeTypeCode: ITR_INTIMATION_NOTICE_TYPE[input.kind],
          referenceNo: input.referenceNo,
          issuedOn: input.issuedOn,
          receivedOn: input.receivedOn,
          financialYear: r.financial_year,
          assessmentYear: assessmentYearOf(r.financial_year),
          amountDemanded: input.result === 'refund' ? null : (input.amount ?? null),
          summary:
            input.summary?.trim() ||
            `${is1431 ? 'Intimation u/s 143(1)' : 'Proposed set-off u/s 245'} on the return for ${itrYearLabel(
              r.financial_year,
            )}${r.ack_no ? ` (ack ${r.ack_no})` : ''}.`,
        });
        noticeId = notice.id;
        await client.query(`UPDATE hsdg.notices SET itr_return_id = $2 WHERE id = $1`, [
          noticeId,
          id,
        ]);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'itr_return.intimation_recorded',
        objectType: 'itr_return',
        objectId: id,
        before: { intimationOn: r.intimation_on, intimationResult: r.intimation_result },
        after: {
          kind: input.kind,
          referenceNo: input.referenceNo,
          issuedOn: input.issuedOn,
          result: input.result ?? null,
          amount: input.amount ?? null,
          noticeId,
        },
      });
      return { return: await this.view(client, id), noticeId };
    });
  }

  /** POST /itr/returns/:id/remind-verify — ask the client to e-verify a filed return. */
  async remindVerify(
    ctx: RlsContext,
    id: string,
    input: RemindItrVerifyInput,
  ): Promise<ItrVerifyReminder> {
    return this.write(ctx, async (client) => {
      const r = await this.row(client, id);
      if (!r.filed_on || !r.e_verify_due_on)
        throw new BadRequestException('The return is not filed yet.');
      if (r.e_verified_on) throw new BadRequestException('The return is already e-verified.');
      const { rows } = await client.query<{
        member: boolean;
        email: string | null;
        phone: string | null;
        firm_name: string | null;
      }>(
        `SELECT hsdg.is_engagement_member(e.id) AS member,
                (SELECT c.email::text FROM hsdg.entity_contacts c
                  WHERE c.entity_id = e.entity_id AND c.email IS NOT NULL
                  ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS email,
                ${clientPhoneSql('e.entity_id')} AS phone,
                (SELECT f.firm_name FROM hsdg.firm_settings f LIMIT 1) AS firm_name
           FROM hsdg.engagements e WHERE e.id = $1`,
        [r.engagement_id],
      );
      const c = rows[0]!;
      if (!c.member) throw new ForbiddenException('Only the engagement team reminds its clients.');
      const reach = {
        canEmail: !!c.email && this.notifications.hasExternalChannels,
        phone: c.phone,
      };
      if (input.channel && !canRemindBy(input.channel, reach))
        throw new BadRequestException(
          input.channel === CLIENT_REMINDER_CHANNEL.whatsapp
            ? 'The client has no phone number WhatsApp can use.'
            : 'The client cannot be e-mailed: no address, or e-mail is off.',
        );
      const { channel, fallback } = input.channel
        ? { channel: input.channel, fallback: null }
        : reminderChannelFor((await workflowPolicy(client)).clientReminderChannel, reach);
      const text = eVerifyReminderText({
        entityName: r.entity_name,
        yearLabel: itrYearLabel(r.financial_year),
        filedOn: r.filed_on,
        ackNo: r.ack_no,
        dueOn: r.e_verify_due_on,
        firmName: c.firm_name,
      });
      if (channel === CLIENT_REMINDER_CHANNEL.email) {
        await this.notifications.enqueueClientDeliveryWith(client, {
          recipientEmail: c.email,
          type: NOTIFICATION_TYPE.clientDependencyReminder,
          title: `E-verify your income-tax return — ${itrYearLabel(r.financial_year)}`,
          body: text,
          engagementId: r.engagement_id,
        });
      }
      await client.query(
        `INSERT INTO hsdg.client_reminders
           (compliance_instance_id, engagement_id, channel, sent_by_employee_id)
         VALUES ($1, $2, $3, $4)`,
        [r.instance_id, r.engagement_id, channel, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'itr_return.verify_reminded',
        objectType: 'itr_return',
        objectId: id,
        after: { channel, fallback, requested: input.channel ?? null, dueOn: r.e_verify_due_on },
      });
      if (channel === CLIENT_REMINDER_CHANNEL.email)
        return { returnId: id, channel, text, to: c.email as string };
      if (channel === CLIENT_REMINDER_CHANNEL.whatsapp)
        return { returnId: id, channel, text, waUrl: whatsappUrl(c.phone, text) as string };
      return { returnId: id, channel: CLIENT_REMINDER_CHANNEL.copy, text, fallback };
    });
  }

  // ── Income lines ───────────────────────────────────────────────────────

  /** GET /itr/returns/:id/income */
  async income(ctx: RlsContext, id: string): Promise<ItrIncome> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.row(client, id);
      const lines = await this.lines(client, id);
      return { lines, matching: matchIncomeLines(lines) };
    });
  }

  /** POST /itr/returns/:id/statements — read a statement and store its lines. */
  async importStatement(
    ctx: RlsContext,
    id: string,
    input: ImportItrStatementInput,
  ): Promise<ImportItrStatementResult> {
    const { buffer } = decodeUpload(input.contentBase64, this.config.get('DOCUMENT_MAX_BYTES'));
    let parsed;
    try {
      parsed = parseStatement(buffer, input.source);
    } catch (err) {
      if (err instanceof StatementRefused) throw new BadRequestException(err.message);
      throw err;
    }
    if (parsed.lines.length > MAX_LINES)
      throw new BadRequestException(`A statement is read up to ${MAX_LINES} lines.`);
    return this.write(ctx, async (client) => {
      const r = await this.row(client, id, true);
      const replace = input.replace ?? true;
      const removed = replace
        ? ((
            await client.query(
              `DELETE FROM hsdg.itr_income_lines WHERE itr_return_id = $1 AND source = $2`,
              [id, input.source],
            )
          ).rowCount ?? 0)
        : 0;
      if (parsed.lines.length > 0) {
        await client.query(
          `INSERT INTO hsdg.itr_income_lines
             (itr_return_id, engagement_id, source, head, section, description, payer_name,
              payer_tan, amount, tax_deducted, transaction_on, imported_from, created_by_employee_id)
           SELECT $1, $2, $3, l.head, l.section, l.description, l."payerName", l."payerTan",
                  l.amount, l."taxDeducted", l."transactionOn", $5, $6
             FROM jsonb_to_recordset($4::jsonb) AS l(head text, section text, description text,
                  "payerName" text, "payerTan" text, amount numeric, "taxDeducted" numeric,
                  "transactionOn" date)`,
          [
            id,
            r.engagement_id,
            input.source,
            JSON.stringify(parsed.lines),
            input.filename.slice(0, 255),
            ctx.employeeId ?? null,
          ],
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'itr_return.statement_imported',
        objectType: 'itr_return',
        objectId: id,
        after: {
          source: input.source,
          filename: input.filename,
          format: parsed.format,
          imported: parsed.lines.length,
          skipped: parsed.skipped,
          replaced: removed,
        },
      });
      return {
        source: input.source,
        format: parsed.format,
        imported: parsed.lines.length,
        skipped: parsed.skipped,
        warnings: parsed.warnings,
      };
    });
  }

  /** POST /itr/returns/:id/lines — one figure by hand. */
  async addLine(ctx: RlsContext, id: string, input: AddItrIncomeLineInput): Promise<ItrIncome> {
    return this.write(ctx, async (client) => {
      const r = await this.row(client, id);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.itr_income_lines
           (itr_return_id, engagement_id, source, head, section, description, payer_name,
            payer_tan, amount, tax_deducted, transaction_on, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 0), $11, $12)
         RETURNING id`,
        [
          id,
          r.engagement_id,
          input.source,
          input.head,
          input.section?.trim() || null,
          input.description?.trim() || null,
          input.payerName?.trim() || null,
          input.payerTan?.trim().toUpperCase() || null,
          input.amount,
          input.taxDeducted ?? null,
          input.transactionOn ?? null,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'itr_return.line_added',
        objectType: 'itr_return',
        objectId: id,
        after: { lineId: rows[0]!.id, ...input },
      });
      const lines = await this.lines(client, id);
      return { lines, matching: matchIncomeLines(lines) };
    });
  }

  /** PATCH /itr/returns/:id/lines/:lineId — the line's head. */
  async updateLine(
    ctx: RlsContext,
    id: string,
    lineId: string,
    input: UpdateItrIncomeLineInput,
  ): Promise<ItrIncome> {
    return this.write(ctx, async (client) => {
      await this.row(client, id);
      const { rows } = await client.query<{ before: string }>(
        `UPDATE hsdg.itr_income_lines l SET head = $3
           FROM (SELECT head AS before FROM hsdg.itr_income_lines WHERE id = $1) b
          WHERE l.id = $1 AND l.itr_return_id = $2
          RETURNING b.before`,
        [lineId, id, input.head],
      );
      if (!rows[0]) throw new NotFoundException('Line not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'itr_return.line_classified',
        objectType: 'itr_return',
        objectId: id,
        before: { lineId, head: rows[0].before },
        after: { lineId, head: input.head },
      });
      const lines = await this.lines(client, id);
      return { lines, matching: matchIncomeLines(lines) };
    });
  }

  /** DELETE /itr/returns/:id/lines/:lineId */
  async deleteLine(ctx: RlsContext, id: string, lineId: string): Promise<ItrIncome> {
    return this.write(ctx, async (client) => {
      await this.row(client, id);
      const { rowCount } = await client.query(
        `DELETE FROM hsdg.itr_income_lines WHERE id = $1 AND itr_return_id = $2`,
        [lineId, id],
      );
      if (!rowCount) throw new NotFoundException('Line not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'itr_return.line_removed',
        objectType: 'itr_return',
        objectId: id,
        before: { lineId },
      });
      const lines = await this.lines(client, id);
      return { lines, matching: matchIncomeLines(lines) };
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private stageOf(r: ReturnSqlRow): ItrStage {
    return itrStage({
      filedOn: r.filed_on,
      eVerifiedOn: r.e_verified_on,
      intimationOn: r.intimation_on,
    });
  }

  private async row(
    client: PoolClient,
    id: string,
    lock = false,
  ): Promise<ReturnSqlRow & { return_id: string; version: number; financial_year: string }> {
    const { rows } = await client.query<ReturnSqlRow>(
      `SELECT ${RETURN_COLUMNS} ${RETURN_FROM}
        WHERE ir.id = $1${lock ? ' FOR UPDATE OF ir' : ''}`,
      [id],
    );
    const r = rows[0];
    if (!r || !r.return_id) throw new NotFoundException('Return not found.');
    return r as ReturnSqlRow & { return_id: string; version: number; financial_year: string };
  }

  private async lines(client: PoolClient, id: string): Promise<ItrIncomeLine[]> {
    const { rows } = await client.query<LineSqlRow>(
      `SELECT id, source, head, section, description, payer_name, payer_tan,
              amount::text, tax_deducted::text, transaction_on::text
         FROM hsdg.itr_income_lines WHERE itr_return_id = $1
        ORDER BY source, head, payer_name NULLS LAST, transaction_on NULLS LAST, id`,
      [id],
    );
    return rows.map((l) => ({
      id: l.id,
      source: l.source,
      head: l.head,
      section: l.section,
      description: l.description,
      payerName: l.payer_name,
      payerTan: l.payer_tan,
      amount: l.amount,
      taxDeducted: l.tax_deducted,
      transactionOn: l.transaction_on,
    }));
  }

  private async view(client: PoolClient, id: string): Promise<ItrReturn> {
    const r = await this.row(client, id);
    const notices = await client.query<{
      id: string;
      reference_no: string;
      code: string;
      status: string;
    }>(
      `SELECT n.id, n.reference_no, nt.code, n.status
         FROM hsdg.notices n JOIN hsdg.notice_types nt ON nt.id = n.notice_type_id
        WHERE n.itr_return_id = $1 ORDER BY n.issued_on, n.id`,
      [id],
    );
    const counts = await client.query<{ source: ItrIncomeSource; n: number }>(
      `SELECT source, count(*)::int AS n FROM hsdg.itr_income_lines
        WHERE itr_return_id = $1 GROUP BY source`,
      [id],
    );
    const member = await client.query<{ ok: boolean }>(
      `SELECT hsdg.is_engagement_member($1) AS ok`,
      [r.engagement_id],
    );
    const today = istToday();
    return {
      id: r.return_id,
      complianceInstanceId: r.instance_id,
      engagementId: r.engagement_id,
      engagementCode: r.engagement_code,
      entityId: r.entity_id,
      entityName: r.entity_name,
      pan: r.pan,
      financialYear: r.financial_year,
      assessmentYear: assessmentYearOf(r.financial_year),
      yearLabel: itrYearLabel(r.financial_year),
      itrForm: r.itr_form,
      regime: r.regime,
      returnType: r.return_type ?? 'original',
      stage: this.stageOf(r),
      workflowStatus: r.workflow_status,
      statutoryDate: r.statutory_date,
      filedOn: r.filed_on,
      ackNo: r.ack_no,
      eVerifyDueOn: r.filed_on ? r.e_verify_due_on : null,
      eVerifyOverdue: overdue(r, today),
      eVerifiedOn: r.e_verified_on,
      eVerifyMode: r.e_verify_mode,
      verifiedLate: !!r.e_verified_on && !!r.e_verify_due_on && r.e_verified_on > r.e_verify_due_on,
      refundClaimed: r.refund_claimed,
      refundStatus: r.refund_status ?? 'none',
      refundAmount: r.refund_amount,
      refundOn: r.refund_on,
      refundNote: r.refund_note,
      intimationOn: r.intimation_on,
      intimationResult: r.intimation_result,
      intimationAmount: r.intimation_amount,
      notices: notices.rows.map((n) => ({
        id: n.id,
        referenceNo: n.reference_no,
        typeCode: n.code,
        status: n.status,
      })),
      lineCounts: Object.fromEntries(counts.rows.map((c) => [c.source, c.n])),
      notes: r.notes,
      version: r.version,
      can: { edit: member.rows[0]?.ok === true },
    };
  }

  private checkVersion(actual: number, sent: number): void {
    if (actual !== sent)
      throw new ConflictException('Someone else changed this meanwhile. Reload and try again.');
  }

  private async write<T>(ctx: RlsContext, work: (client: PoolClient) => Promise<T>): Promise<T> {
    try {
      return await this.db.withRlsContext(ctx, work);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const e = err as { code?: string; constraint?: string };
      if (e.code === '42501')
        throw new ForbiddenException('Only the engagement’s team works its returns.');
      if (e.code === '23514')
        throw new BadRequestException(
          `The return could not be saved (${e.constraint ?? 'check'}).`,
        );
      throw err;
    }
  }
}
