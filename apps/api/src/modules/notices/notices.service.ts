import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPE,
  type EngagementKind,
  NOTICE_EVENT_KIND_LABEL,
  isNoticeOpen,
  noticeClock,
  noticeEventEffect,
  type AddNoticeEventRequest,
  type AppealNoticeRequest,
  type AppealNoticeResponse,
  type CloseNoticeRequest,
  type CreateNoticeRequest,
  type Notice,
  type NoticeDocument,
  type NoticeEvent,
  type NoticeEventKind,
  type NoticeListItem,
  type NoticeListQuery,
  type NoticeListResponse,
  type UpdateNoticeRequest,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { translatePgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { istToday } from '../engagements/time/auto-time';
import { NotificationsService } from '../notifications/notifications.service';
import { NoticeAppealService } from './notice-appeal.service';
import {
  CLOCK_DUE_SQL,
  decodeNoticeCursor,
  defaultReplyDue,
  encodeNoticeCursor,
  replayNoticeEvents,
} from './notice-rules';
import type { NoticeRow } from './notices.types';
import type { NoticeDocumentUploadDto } from './dto/notices.dto';

const DEFAULT_LIMIT = 50;

export const NOTICE_SELECT = `
  SELECT n.id, n.entity_id, ent.legal_name AS entity_name, n.engagement_id,
         eng.engagement_code, eng.kind AS engagement_kind,
         n.registration_id, reg.registration_number,
         nt.id AS type_id, nt.code AS type_code, nt.stream AS type_stream, nt.form AS type_form,
         nt.section AS type_section, nt.title AS type_title, nt.appealable AS type_appealable,
         nt.appeal_rule_code AS type_appeal_rule_code,
         n.reference_no, n.issued_on::text, n.received_on::text, n.served_via,
         n.financial_year, n.assessment_year, n.period_from::text, n.period_to::text,
         n.amount_demanded::text, n.reply_due_on::text, n.internal_due_override::text,
         n.internal_due_on::text, n.next_hearing_on::text,
         n.owner_employee_id, owner.full_name AS owner_name,
         n.reviewer_employee_id, rev.full_name AS reviewer_name,
         n.status, n.outcome, n.outcome_amount::text, n.closed_on::text, n.summary,
         n.appeal_instance_id, n.appeal_due_on::text,
         n.appeal_engagement_id, ae.engagement_code AS appeal_engagement_code,
         n.version, n.created_at, n.updated_at,
         (${CLOCK_DUE_SQL}) AS clock_due_d, (${CLOCK_DUE_SQL})::text AS clock_due,
         hsdg.is_engagement_member(n.engagement_id) AS is_member,
         hsdg.is_engagement_lead(n.engagement_id) AS is_lead
    FROM hsdg.notices n
    JOIN hsdg.notice_types nt ON nt.id = n.notice_type_id
    LEFT JOIN hsdg.entities ent ON ent.id = n.entity_id
    LEFT JOIN hsdg.engagements eng ON eng.id = n.engagement_id
    LEFT JOIN hsdg.engagements ae ON ae.id = n.appeal_engagement_id
    LEFT JOIN hsdg.entity_registrations reg ON reg.id = n.registration_id
    LEFT JOIN hsdg.employees owner ON owner.id = n.owner_employee_id
    LEFT JOIN hsdg.employees rev ON rev.id = n.reviewer_employee_id`;

const STALE = 'This notice was changed by someone else — reload it and try again.';
const CLOSED = 'This notice is closed — it can no longer change.';

/** PostgreSQL errors on hsdg.notices → clean HTTP errors. */
function noticePgError(err: unknown, referenceNo?: string): Error {
  return translatePgError(err, {
    unique: [
      {
        match: 'notices_reference_unique',
        message: `This client already has a notice of this type with reference ${
          referenceNo ? `"${referenceNo}"` : 'number'
        } — open that one instead.`,
      },
    ],
    check: (raw) =>
      raw?.includes('notices_received_after_issue')
        ? 'A notice cannot be received before it was issued.'
        : raw?.includes('notices_period')
          ? 'The period ends before it starts.'
          : 'A value on the notice is not allowed.',
    foreignKey: 'A person, registration or document on the notice does not exist.',
    forbidden: 'Only the engagement team can record notices on this engagement.',
  });
}

function toListItem(r: NoticeRow, today: string): NoticeListItem {
  const clockInput = {
    status: r.status,
    internalDueOn: r.internal_due_on,
    replyDueOn: r.reply_due_on,
    nextHearingOn: r.next_hearing_on,
    appealDueOn: r.appeal_due_on,
  };
  return {
    id: r.id,
    entityId: r.entity_id,
    entityName: r.entity_name ?? '',
    engagementId: r.engagement_id,
    engagementCode: r.engagement_code ?? '',
    registrationNumber: r.registration_number,
    noticeType: {
      id: r.type_id,
      code: r.type_code,
      stream: r.type_stream,
      form: r.type_form,
      section: r.type_section,
      title: r.type_title,
      appealable: r.type_appealable,
    },
    referenceNo: r.reference_no,
    issuedOn: r.issued_on,
    receivedOn: r.received_on,
    financialYear: r.financial_year,
    assessmentYear: r.assessment_year,
    amountDemanded: r.amount_demanded,
    ownerId: r.owner_employee_id,
    ownerName: r.owner_name ?? '',
    reviewerId: r.reviewer_employee_id,
    reviewerName: r.reviewer_name,
    outcome: r.outcome,
    version: r.version,
    ...clockInput,
    clock: noticeClock(clockInput, today),
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Practice Services PS-101 — the notice register. Every query runs under the
 * caller's RLS context: the engagement team (and the firm-wide roles) see a
 * notice, nobody else — a hidden notice is a 404. Writes need notice.manage
 * (checked by the controller) and are versioned (409 when stale); each one
 * writes audit_events.
 */
@Injectable()
export class NoticesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly appeal: NoticeAppealService,
    private readonly notifications: NotificationsService,
  ) {}

  /** GET /notices — sorted by the clock's date (undated last), then id; keyset-paged. */
  async list(ctx: RlsContext, q: NoticeListQuery): Promise<NoticeListResponse> {
    const today = istToday(new Date());
    const limit = q.limit ?? DEFAULT_LIMIT;
    const after = q.cursor ? decodeNoticeCursor(q.cursor) : null;
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const inner: string[] = [];
    if (q.status === 'open') inner.push(`n.status NOT IN ('closed', 'withdrawn')`);
    else if (q.status) inner.push(`n.status = ${p(q.status)}`);
    if (q.stream) inner.push(`nt.stream = ${p(q.stream)}`);
    if (q.ownerId === 'me') {
      // No employee behind the caller → nothing is theirs.
      inner.push(ctx.employeeId ? `n.owner_employee_id = ${p(ctx.employeeId)}` : 'false');
    } else if (q.ownerId) inner.push(`n.owner_employee_id = ${p(q.ownerId)}`);
    if (q.entityId) inner.push(`n.entity_id = ${p(q.entityId)}`);
    if (q.engagementId) inner.push(`n.engagement_id = ${p(q.engagementId)}`);
    if (q.search?.trim()) {
      const like = p(`%${escapeLike(q.search.trim())}%`);
      inner.push(
        `(n.reference_no ILIKE ${like} OR ent.legal_name ILIKE ${like} OR ent.display_name ILIKE ${like})`,
      );
    }
    const outer: string[] = [];
    if (q.dueBefore) outer.push(`x.clock_due_d <= ${p(q.dueBefore)}::date`);
    if (after) {
      const id = p(after.id);
      if (after.due === null) outer.push(`(x.clock_due_d IS NULL AND x.id > ${id}::uuid)`);
      else {
        const due = p(after.due);
        outer.push(
          `(x.clock_due_d > ${due}::date OR (x.clock_due_d = ${due}::date AND x.id > ${id}::uuid)` +
            ` OR x.clock_due_d IS NULL)`,
        );
      }
    }
    const sql = `
      SELECT x.* FROM (${NOTICE_SELECT}
        ${inner.length ? `WHERE ${inner.join(' AND ')}` : ''}) x
      ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''}
      ORDER BY x.clock_due_d ASC NULLS LAST, x.id ASC
      LIMIT ${limit + 1}`;
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<NoticeRow>(sql, params);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => toListItem(r, today)),
        nextCursor:
          rows.length > limit && last ? encodeNoticeCursor(last.clock_due, last.id) : null,
      };
    });
  }

  /** GET /notices/:id — with its events (newest first, voided ones flagged) and papers. */
  async get(ctx: RlsContext, id: string, opts: { canManage: boolean }): Promise<Notice> {
    return this.db.withRlsContext(ctx, (client) => this.getWith(client, id, opts));
  }

  async getWith(client: PoolClient, id: string, opts: { canManage: boolean }): Promise<Notice> {
    const today = istToday(new Date());
    const row = await this.load(client, id);
    const { rows: events } = await client.query<{
      id: string;
      kind: NoticeEventKind;
      occurred_on: string;
      next_date: string | null;
      ack_reference: string | null;
      document_id: string | null;
      body: string | null;
      created_by_employee_id: string | null;
      created_by_name: string | null;
      created_at: Date;
      voided_at: Date | null;
      void_reason: string | null;
    }>(
      `SELECT ev.id, ev.kind, ev.occurred_on::text, ev.next_date::text, ev.ack_reference,
              ev.document_id, ev.body, ev.created_by_employee_id, e.full_name AS created_by_name,
              ev.created_at, ev.voided_at, ev.void_reason
         FROM hsdg.notice_events ev
         LEFT JOIN hsdg.employees e ON e.id = ev.created_by_employee_id
        WHERE ev.notice_id = $1
        ORDER BY ev.occurred_on DESC, ev.created_at DESC`,
      [id],
    );
    const { rows: docs } = await client.query<{
      id: string;
      title: string;
      filename: string | null;
      document_type: string;
      uploaded_at: Date;
      uploaded_by_name: string | null;
    }>(
      `SELECT d.id, d.title, v.filename, d.document_type,
              COALESCE(v.uploaded_at, d.created_at) AS uploaded_at, ue.full_name AS uploaded_by_name
         FROM hsdg.documents d
         LEFT JOIN hsdg.document_versions v ON v.id = d.current_version_id
         LEFT JOIN hsdg.employees ue ON ue.id = d.created_by_employee_id
        WHERE d.notice_id = $1 AND d.deleted_at IS NULL
        ORDER BY d.created_at DESC`,
      [id],
    );
    const mappedEvents: NoticeEvent[] = events.map((e) => ({
      id: e.id,
      kind: e.kind,
      occurredOn: e.occurred_on,
      nextDate: e.next_date,
      ackReference: e.ack_reference,
      documentId: e.document_id,
      body: e.body,
      createdById: e.created_by_employee_id,
      createdByName: e.created_by_name,
      createdAt: e.created_at.toISOString(),
      voidedAt: e.voided_at ? e.voided_at.toISOString() : null,
      voidReason: e.void_reason,
    }));
    const documents: NoticeDocument[] = docs.map((d) => ({
      id: d.id,
      title: d.title,
      filename: d.filename,
      documentType: (['notice', 'reply', 'order'].includes(d.document_type)
        ? d.document_type
        : 'notice') as NoticeDocument['documentType'],
      uploadedAt: d.uploaded_at.toISOString(),
      uploadedByName: d.uploaded_by_name,
    }));
    const edit = opts.canManage && row.is_member;
    const hasOrder = mappedEvents.some((e) => e.kind === 'order' && !e.voidedAt);
    return {
      ...toListItem(row, today),
      servedVia: row.served_via,
      periodFrom: row.period_from,
      periodTo: row.period_to,
      internalDueOverride: row.internal_due_override,
      outcomeAmount: row.outcome_amount,
      closedOn: row.closed_on,
      summary: row.summary,
      appealInstanceId: row.appeal_instance_id,
      appealEngagementId: row.appeal_engagement_id,
      appealEngagementCode: row.appeal_engagement_code,
      events: mappedEvents,
      documents,
      can: {
        edit,
        appeal:
          edit &&
          row.is_lead &&
          row.status === 'order_received' &&
          row.type_appealable &&
          hasOrder &&
          !row.appeal_engagement_id,
        startAppealClock:
          edit &&
          row.is_lead &&
          row.status === 'order_received' &&
          row.type_appealable &&
          !!row.type_appeal_rule_code &&
          hasOrder &&
          !row.appeal_instance_id &&
          !row.appeal_engagement_id,
      },
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  /** POST /notices — record a notice on an engagement the caller works on. */
  async create(ctx: RlsContext, input: CreateNoticeRequest): Promise<Notice> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: engs } = await client.query<{
        id: string;
        entity_id: string;
        kind: string | null;
        is_member: boolean;
      }>(
        `SELECT id, entity_id, kind, hsdg.is_engagement_member(id) AS is_member
           FROM hsdg.engagements WHERE id = $1`,
        [input.engagementId],
      );
      const eng = engs[0];
      if (!eng) throw new NotFoundException('Engagement not found.');
      if (!eng.is_member)
        throw new ForbiddenException('Only the engagement team can record a notice here.');
      if (eng.kind !== 'compliance' && eng.kind !== 'assignment')
        throw new BadRequestException(
          'A notice is worked under a Compliance or Assignment engagement.',
        );
      const { rows: types } = await client.query<{
        id: string;
        default_reply_days: number | null;
      }>(`SELECT id, default_reply_days FROM hsdg.notice_types WHERE code = $1 AND is_active`, [
        input.noticeTypeCode,
      ]);
      const type = types[0];
      if (!type) throw new BadRequestException(`Unknown notice type ${input.noticeTypeCode}.`);
      if (input.registrationId)
        await this.requireRegistration(client, eng.entity_id, input.registrationId);
      const ownerId = input.ownerId ?? ctx.employeeId;
      if (!ownerId) throw new BadRequestException('Choose who owns the notice.');
      await this.requireOnTeam(client, ctx, eng.id, ownerId, 'owner');
      if (input.reviewerId)
        await this.requireOnTeam(client, ctx, eng.id, input.reviewerId, 'reviewer');
      const replyDueOn =
        input.replyDueOn === undefined
          ? defaultReplyDue(input.issuedOn, type.default_reply_days)
          : input.replyDueOn;

      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.notices
             (entity_id, engagement_id, registration_id, notice_type_id, reference_no, issued_on,
              received_on, served_via, financial_year, assessment_year, period_from, period_to,
              amount_demanded, reply_due_on, internal_due_override, owner_employee_id,
              reviewer_employee_id, summary, created_by_employee_id, updated_by_employee_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'portal'),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
           RETURNING id`,
          [
            eng.entity_id,
            eng.id,
            input.registrationId ?? null,
            type.id,
            input.referenceNo.trim(),
            input.issuedOn,
            input.receivedOn,
            input.servedVia ?? null,
            input.financialYear ?? null,
            input.assessmentYear ?? null,
            input.periodFrom ?? null,
            input.periodTo ?? null,
            input.amountDemanded ?? null,
            replyDueOn,
            input.internalDueOverride ?? null,
            ownerId,
            input.reviewerId ?? null,
            input.summary?.trim() || null,
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw noticePgError(err, input.referenceNo.trim());
      }
      if (input.documentId) await this.linkDocument(client, id, eng.id, input.documentId, 'notice');
      await this.audit.recordWith(client, ctx, {
        action: 'notice.created',
        objectType: 'notice',
        objectId: id,
        after: {
          engagementId: eng.id,
          noticeTypeCode: input.noticeTypeCode,
          referenceNo: input.referenceNo.trim(),
          issuedOn: input.issuedOn,
          receivedOn: input.receivedOn,
          replyDueOn,
          ownerId,
          documentId: input.documentId ?? null,
        },
      });
      const notice = await this.getWith(client, id, { canManage: true });
      // PS-102 — the owner and reviewer hear of it (never the person who recorded it,
      // as task_assigned skips self-assignment). Cleared by the notice's own trigger.
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.noticeReceived,
        recipientEmployeeIds: [ownerId, input.reviewerId ?? null].filter(
          (e): e is string => Boolean(e) && e !== ctx.employeeId,
        ),
        title: `Notice received — ${notice.noticeType.form ?? notice.noticeType.title} ${
          notice.referenceNo
        } · ${notice.entityName}`,
        engagementId: eng.id,
        objectType: 'notice',
        objectId: id,
        dedupKey: `notice_received:${id}`,
        link: { engagementId: eng.id, engagementKind: eng.kind as EngagementKind, noticeId: id },
      });
      return notice;
    });
  }

  /** PATCH /notices/:id — any subset of the fields, with the version read. */
  async update(ctx: RlsContext, id: string, input: UpdateNoticeRequest): Promise<Notice> {
    return this.write(ctx, id, input.version, async (client, n) => {
      if (!isNoticeOpen(n.status)) throw new BadRequestException(CLOSED);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const set = (col: keyof NoticeRow & string, field: string, value: unknown) => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
        before[field] = n[col];
        after[field] = value;
      };
      if (input.registrationId !== undefined) {
        if (input.registrationId)
          await this.requireRegistration(client, n.entity_id, input.registrationId);
        set('registration_id', 'registrationId', input.registrationId);
      }
      if (input.referenceNo !== undefined)
        set('reference_no', 'referenceNo', input.referenceNo.trim());
      if (input.issuedOn !== undefined) set('issued_on', 'issuedOn', input.issuedOn);
      if (input.receivedOn !== undefined) set('received_on', 'receivedOn', input.receivedOn);
      if (input.servedVia !== undefined) set('served_via', 'servedVia', input.servedVia);
      if (input.financialYear !== undefined)
        set('financial_year', 'financialYear', input.financialYear);
      if (input.assessmentYear !== undefined)
        set('assessment_year', 'assessmentYear', input.assessmentYear);
      if (input.periodFrom !== undefined) set('period_from', 'periodFrom', input.periodFrom);
      if (input.periodTo !== undefined) set('period_to', 'periodTo', input.periodTo);
      if (input.amountDemanded !== undefined)
        set('amount_demanded', 'amountDemanded', input.amountDemanded);
      if (input.replyDueOn !== undefined) set('reply_due_on', 'replyDueOn', input.replyDueOn);
      if (input.internalDueOverride !== undefined)
        set('internal_due_override', 'internalDueOverride', input.internalDueOverride);
      if (input.ownerId !== undefined) {
        await this.requireOnTeam(client, ctx, n.engagement_id, input.ownerId, 'owner');
        set('owner_employee_id', 'ownerId', input.ownerId);
      }
      if (input.reviewerId !== undefined) {
        if (input.reviewerId)
          await this.requireOnTeam(client, ctx, n.engagement_id, input.reviewerId, 'reviewer');
        set('reviewer_employee_id', 'reviewerId', input.reviewerId);
      }
      if (input.summary !== undefined) set('summary', 'summary', input.summary?.trim() || null);
      if (input.status !== undefined && input.status !== n.status) {
        if (input.status !== 'withdrawn' && !['received', 'in_progress'].includes(n.status))
          throw new BadRequestException(
            'Only a notice not yet replied to moves between received and in progress; ' +
              'the rest follows its events.',
          );
        set('status', 'status', input.status);
      }
      if (sets.length === 0) return;
      try {
        await client.query(
          `UPDATE hsdg.notices
              SET ${sets.join(', ')}, version = version + 1,
                  updated_by_employee_id = $${params.length + 1}
            WHERE id = $1`,
          [...params, ctx.employeeId ?? null],
        );
      } catch (err) {
        throw noticePgError(err, input.referenceNo?.trim() ?? n.reference_no);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'notice.updated',
        objectType: 'notice',
        objectId: id,
        before,
        after,
      });
    });
  }

  /** POST /notices/:id/events — record what happened; the status and hearing follow. */
  async addEvent(ctx: RlsContext, id: string, input: AddNoticeEventRequest): Promise<Notice> {
    return this.write(ctx, id, input.version, async (client, n) => {
      if (!isNoticeOpen(n.status)) throw new BadRequestException(CLOSED);
      const effect = noticeEventEffect(input.kind, n.status);
      if (effect.setsHearing && !input.nextDate)
        throw new BadRequestException(
          `${NOTICE_EVENT_KIND_LABEL[input.kind]} needs the hearing date (nextDate).`,
        );
      if (input.kind === 'order' && input.occurredOn > istToday(new Date()))
        throw new BadRequestException('An order cannot be dated in the future.');
      if (input.kind === 'order' && (await this.appeal.orderDate(client, id)))
        throw new BadRequestException(
          'An order is already on file — void it first if it was recorded wrongly.',
        );
      if (input.documentId)
        await this.linkDocument(
          client,
          id,
          n.engagement_id,
          input.documentId,
          input.kind === 'order' ? 'order' : input.kind === 'reply_filed' ? 'reply' : 'notice',
        );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.notice_events
           (notice_id, engagement_id, kind, occurred_on, next_date, ack_reference, document_id,
            body, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          id,
          n.engagement_id,
          input.kind,
          input.occurredOn,
          input.nextDate ?? null,
          input.ackReference?.trim() || null,
          input.documentId ?? null,
          input.body?.trim() || null,
          ctx.employeeId ?? null,
        ],
      );
      const eventId = rows[0]!.id;
      const status = effect.status ?? n.status;
      const nextHearingOn =
        effect.setsHearing && input.nextDate ? input.nextDate : n.next_hearing_on;
      await client.query(
        `UPDATE hsdg.notices
            SET status = $2, next_hearing_on = $3, version = version + 1,
                updated_by_employee_id = $4
          WHERE id = $1`,
        [id, status, nextHearingOn, ctx.employeeId ?? null],
      );
      if (input.kind === 'order') {
        await this.appeal.onOrderRecorded(
          client,
          ctx,
          { ...n, status, next_hearing_on: nextHearingOn },
          { id: eventId, occurredOn: input.occurredOn },
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'notice.event_added',
        objectType: 'notice',
        objectId: id,
        before: { status: n.status, nextHearingOn: n.next_hearing_on },
        after: {
          eventId,
          kind: input.kind,
          occurredOn: input.occurredOn,
          nextDate: input.nextDate ?? null,
          status,
          nextHearingOn,
        },
      });
    });
  }

  /** POST /notices/:id/events/:eventId/void — the status and hearing re-follow the rest. */
  async voidEvent(
    ctx: RlsContext,
    id: string,
    eventId: string,
    input: { version: number; reason: string },
  ): Promise<Notice> {
    const reason = input.reason.trim();
    return this.write(ctx, id, input.version, async (client, n) => {
      if (!isNoticeOpen(n.status)) throw new BadRequestException(CLOSED);
      const { rows: evs } = await client.query<{
        id: string;
        kind: NoticeEventKind;
        voided_at: Date | null;
        compliance_event_id: string | null;
      }>(
        `SELECT id, kind, voided_at, compliance_event_id FROM hsdg.notice_events
          WHERE id = $1 AND notice_id = $2 FOR UPDATE`,
        [eventId, id],
      );
      const ev = evs[0];
      if (!ev) throw new NotFoundException('Event not found on this notice.');
      if (ev.voided_at) throw new BadRequestException('This event is already voided.');
      if (ev.kind === 'order' && n.appeal_engagement_id)
        throw new BadRequestException(
          `The appeal against this order is open (${n.appeal_engagement_code ?? 'its engagement'}) — ` +
            'the order cannot be voided.',
        );
      await client.query(
        `UPDATE hsdg.notice_events
            SET voided_at = now(), voided_by_employee_id = $2, void_reason = $3
          WHERE id = $1`,
        [eventId, ctx.employeeId ?? null, reason],
      );
      const { rows: rest } = await client.query<{
        kind: NoticeEventKind;
        next_date: string | null;
      }>(
        `SELECT kind, next_date::text FROM hsdg.notice_events
          WHERE notice_id = $1 AND voided_at IS NULL
          ORDER BY occurred_on, created_at`,
        [id],
      );
      const replay = replayNoticeEvents(
        rest.map((r) => ({ kind: r.kind, nextDate: r.next_date })),
        n.status,
      );
      await client.query(
        `UPDATE hsdg.notices
            SET status = $2, next_hearing_on = $3, version = version + 1,
                updated_by_employee_id = $4
          WHERE id = $1`,
        [id, replay.status, replay.nextHearingOn, ctx.employeeId ?? null],
      );
      if (ev.kind === 'order') {
        await this.appeal.onOrderVoided(
          client,
          ctx,
          { ...n, status: replay.status, next_hearing_on: replay.nextHearingOn },
          { id: eventId, complianceEventId: ev.compliance_event_id },
          reason,
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'notice.event_voided',
        objectType: 'notice',
        objectId: id,
        before: { status: n.status, nextHearingOn: n.next_hearing_on },
        after: {
          eventId,
          kind: ev.kind,
          reason,
          status: replay.status,
          nextHearingOn: replay.nextHearingOn,
        },
      });
    });
  }

  /** POST /notices/:id/close — the outcome (and amount) is required. */
  async close(ctx: RlsContext, id: string, input: CloseNoticeRequest): Promise<Notice> {
    return this.write(ctx, id, input.version, async (client, n) => {
      if (!isNoticeOpen(n.status)) throw new BadRequestException('This notice is already closed.');
      if (input.closedOn < n.received_on)
        throw new BadRequestException('A notice cannot close before it was received.');
      await client.query(
        `UPDATE hsdg.notices
            SET status = 'closed', outcome = $2, outcome_amount = $3, closed_on = $4,
                version = version + 1, updated_by_employee_id = $5
          WHERE id = $1`,
        [id, input.outcome, input.outcomeAmount ?? null, input.closedOn, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'notice.closed',
        objectType: 'notice',
        objectId: id,
        before: { status: n.status },
        after: {
          status: 'closed',
          outcome: input.outcome,
          outcomeAmount: input.outcomeAmount ?? null,
          closedOn: input.closedOn,
        },
      });
    });
  }

  /** POST /notices/:id/appeal-clock — a lead starts the clock a non-lead's order left waiting. */
  async startAppealClock(ctx: RlsContext, id: string, version: number): Promise<Notice> {
    return this.write(ctx, id, version, async (client, n) => {
      if (n.status !== 'order_received')
        throw new BadRequestException('The appeal clock runs from an order on file.');
      await this.appeal.startClock(client, ctx, n);
      await client.query(
        `UPDATE hsdg.notices SET version = version + 1, updated_by_employee_id = $2 WHERE id = $1`,
        [id, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'notice.appeal_clock_started',
        objectType: 'notice',
        objectId: id,
        after: { status: n.status },
      });
    });
  }

  /** POST /notices/:id/appeal — the partner chose to appeal: open its Assignment engagement. */
  async appealNotice(
    ctx: RlsContext,
    id: string,
    input: AppealNoticeRequest,
  ): Promise<AppealNoticeResponse> {
    let opened: { id: string; code: string } | null = null;
    const notice = await this.write(ctx, id, input.version, async (client, n) => {
      if (n.appeal_engagement_id)
        throw new ConflictException(
          `The appeal is already open (${n.appeal_engagement_code ?? 'its engagement'}).`,
        );
      if (n.status !== 'order_received' || !n.type_appealable)
        throw new BadRequestException('Only an order of an appealable type can be appealed.');
      if (!(await this.appeal.orderDate(client, id)))
        throw new BadRequestException('Record the order before appealing it.');
      opened = await this.appeal.openAppeal(client, ctx, n, input);
      await client.query(
        `UPDATE hsdg.notices
            SET appeal_engagement_id = $2, status = 'appealed', version = version + 1,
                updated_by_employee_id = $3
          WHERE id = $1`,
        [id, opened.id, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'notice.appealed',
        objectType: 'notice',
        objectId: id,
        before: { status: n.status },
        after: {
          status: 'appealed',
          appealEngagementId: opened.id,
          appealEngagementCode: opened.code,
          appealDueOn: n.appeal_due_on,
          note: input.note?.trim() || null,
        },
      });
    });
    const o = opened as { id: string; code: string } | null;
    if (!o) throw new Error('The appeal engagement was not opened.');
    return { notice, engagementId: o.id, engagementCode: o.code };
  }

  /** POST /notices/:id/documents — upload the notice, the reply or the order under it. */
  async upload(ctx: RlsContext, id: string, dto: NoticeDocumentUploadDto): Promise<Notice> {
    const n = await this.db.withRlsContext(ctx, async (client) => {
      const row = await this.load(client, id);
      if (!row.is_member)
        throw new ForbiddenException('Only the engagement team can file papers here.');
      return row;
    });
    const label = { notice: 'Notice', reply: 'Reply', order: 'Order' }[dto.documentType];
    const doc = await this.documents.create(ctx, n.engagement_id, {
      title: dto.title?.trim() || `${label} — ${n.type_form ?? n.type_title} ${n.reference_no}`,
      filename: dto.filename,
      contentBase64: dto.contentBase64,
      ...(dto.contentType ? { contentType: dto.contentType } : {}),
      documentType: dto.documentType,
      classification: 'confidential',
      noticeId: id,
    });
    return this.db.withRlsContext(ctx, async (client) => {
      await this.audit.recordWith(client, ctx, {
        action: 'notice.document_added',
        objectType: 'notice',
        objectId: id,
        after: { documentId: doc.id, documentType: dto.documentType, filename: dto.filename },
      });
      return this.getWith(client, id, { canManage: true });
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** The notice as the caller sees it; 404 when RLS hides it. */
  async load(client: PoolClient, id: string, lock = false): Promise<NoticeRow> {
    if (lock) await client.query(`SELECT 1 FROM hsdg.notices WHERE id = $1 FOR UPDATE`, [id]);
    const { rows } = await client.query<NoticeRow>(`${NOTICE_SELECT} WHERE n.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('Notice not found.');
    return rows[0];
  }

  /** A versioned change: lock, check the version, apply, then read the notice back. */
  private async write(
    ctx: RlsContext,
    id: string,
    version: number,
    apply: (client: PoolClient, n: NoticeRow) => Promise<void>,
  ): Promise<Notice> {
    return this.db.withRlsContext(ctx, async (client) => {
      const n = await this.load(client, id, true);
      if (!n.is_member)
        throw new ForbiddenException('Only the engagement team can change a notice.');
      if (n.version !== version) throw new ConflictException(STALE);
      await apply(client, n);
      return this.getWith(client, id, { canManage: true });
    });
  }

  private async requireRegistration(
    client: PoolClient,
    entityId: string,
    registrationId: string,
  ): Promise<void> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM hsdg.entity_registrations WHERE id = $1 AND entity_id = $2`,
      [registrationId, entityId],
    );
    if (!rowCount)
      throw new BadRequestException('That registration does not belong to this client.');
  }

  /** The owner / reviewer must be able to see the notice: on the engagement (or the caller). */
  private async requireOnTeam(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    employeeId: string,
    role: 'owner' | 'reviewer',
  ): Promise<void> {
    if (employeeId === ctx.employeeId) return;
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM hsdg.engagements e
                       WHERE e.id = $1 AND $2 IN (e.engagement_partner_id, e.engagement_manager_id))
           OR EXISTS (SELECT 1 FROM hsdg.engagement_team t
                       WHERE t.engagement_id = $1 AND t.employee_id = $2) AS ok`,
      [engagementId, employeeId],
    );
    if (!rows[0]?.ok) throw new BadRequestException(`The ${role} must be on the engagement team.`);
  }

  /**
   * File an uploaded document under the notice: same engagement, not deleted,
   * not under another notice. A document of another type becomes `fallbackType`.
   */
  private async linkDocument(
    client: PoolClient,
    noticeId: string,
    engagementId: string,
    documentId: string,
    fallbackType: 'notice' | 'reply' | 'order',
  ): Promise<void> {
    const res = await client.query(
      `UPDATE hsdg.documents
          SET notice_id = $1,
              document_type = CASE WHEN document_type IN ('notice', 'reply', 'order')
                                   THEN document_type ELSE $4 END,
              version = version + 1
        WHERE id = $2 AND engagement_id = $3 AND deleted_at IS NULL
          AND (notice_id IS NULL OR notice_id = $1)`,
      [noticeId, documentId, engagementId, fallbackType],
    );
    if (!res.rowCount)
      throw new BadRequestException(
        'That document is not on this engagement, is filed under another notice, or you cannot re-file it.',
      );
  }
}
