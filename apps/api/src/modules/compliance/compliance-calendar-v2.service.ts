import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import * as XLSX from 'xlsx';
import {
  periodKeyLabel,
  ROC_EVENT_TYPES,
  type CinProfileAttributes,
  type CompanyDirector,
  type ComplianceCalendarResponse,
  type ComplianceEventChanges,
  type ComplianceEventItem,
  type ComplianceCalendarRow,
  type ComplianceEventRecord,
  type ComplianceProfileRecord,
  type EntityComplianceProfiles,
  type EntityRegistrationOption,
  type FilingStatus,
  type GenerateCalendarResult,
  type GstScheme,
  type PeriodSection,
  type ProfileScope,
  type QrmpCategory,
  type RecordComplianceEventResult,
  type RocOverview,
  type SaveComplianceProfileResult,
  type Stream,
} from '@hsdg/contracts';
import { workLinkOf } from '../../common/work-links';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { dueBand } from './compliance-periods';
import {
  ComplianceGeneratorService,
  eventFinancialYear,
  mergeSummaries,
  type EventRow,
  type GenerateSummary,
} from './compliance-generator.service';
import { syncAutoTicks } from './compliance-checklist';
import { boardMeetingCadence, rocEmptyMessage, validateEventDetails } from './compliance-events';
import {
  compactAttributes,
  dayBefore,
  istToday,
  profileAttributeErrors,
} from './compliance-profile';
import type {
  ComplianceCalendarV2QueryDto,
  CorrectComplianceEventDto,
  RecordComplianceEventDto,
  SaveComplianceProfileDto,
} from './dto/calendar-v2.dto';

/** Engagement statuses whose calendar is no longer maintained. */
export const CLOSED_ENGAGEMENT_STATUSES = [
  'closed',
  'merged',
  'cancelled',
  'declined',
  'withdrawn',
];

/** The firm calendar never returns more than this many rows in one call. */
export const CALENDAR_ROW_CAP = 5000;

const EFFECTIVE_DUE = `COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)`;

/**
 * A filing's stream. Rules written before the restructure carry none, so a
 * legacy instance moved into a Compliance engagement takes the stream of its
 * service line, or of the stream that service was folded into.
 */
const FILING_STREAM = `COALESCE(v.stream, rs.stream, rf.stream)`;

interface CalendarSqlRow {
  id: string;
  engagement_id: string;
  engagement_code: string;
  entity_id: string;
  entity_name: string;
  office_code: string;
  stream: Stream | null;
  rule_code: string;
  rule_name: string;
  form_label: string | null;
  registration_id: string | null;
  financial_year: string | null;
  period_key: string | null;
  reference_month: string;
  due_date: string;
  computed_due: string;
  extension_reference: string | null;
  internal_date: string;
  workflow_status: FilingStatus;
  is_provisional: boolean;
  is_optional: boolean;
  needs_verification: boolean;
  profile_changed: boolean;
  assignee_id: string | null;
  assignee_name: string | null;
  partner_name: string | null;
  manager_name: string | null;
  section: PeriodSection | null;
  total: string;
}

interface ProfileSqlRow {
  id: string;
  entity_id: string;
  registration_id: string | null;
  scope: ProfileScope;
  effective_from: string;
  effective_to: string | null;
  gst_scheme: GstScheme | null;
  qrmp_category: QrmpCategory | null;
  attributes: Record<string, unknown>;
  version: number;
  updated_at: Date;
}

interface EventSqlRow {
  id: string;
  engagement_id: string;
  registration_id: string | null;
  registration_number: string | null;
  event_type: string;
  financial_year: string | null;
  event_date: string;
  notes: string | null;
  details: Record<string, unknown> | null;
  recorded_by_name: string | null;
  created_at: Date;
  updated_at: Date | null;
  voided_at: Date | null;
  void_reason: string | null;
  source_instance_id: string | null;
}

/** compliance_events columns, aliased `ev` (recorded_by_name / registration_number joined). */
const EVENT_SELECT = `SELECT ev.id, ev.engagement_id, ev.registration_id, er.registration_number,
       ev.event_type, ev.financial_year, ev.event_date::text, ev.notes, ev.details,
       emp.full_name AS recorded_by_name, ev.created_at, ev.updated_at, ev.voided_at,
       ev.void_reason, ev.source_instance_id
  FROM hsdg.compliance_events ev
  LEFT JOIN hsdg.employees emp ON emp.id = ev.recorded_by_employee_id
  LEFT JOIN hsdg.entity_registrations er ON er.id = ev.registration_id`;

/** Event types the recurring (AGM-linked) rules run from: recording one regenerates the year. */
const RECURRING_EVENT_TYPES: ReadonlySet<string> = new Set(['agm', 'agm_extension']);
/** One live event of these per year and registration: the AGM is never recorded twice. */
const ONCE_A_YEAR_EVENT_TYPES: ReadonlySet<string> = new Set(['agm', 'agm_extension']);

/** What recording an event takes, besides the engagement. */
export interface EventInput {
  eventType: string;
  eventDate: string;
  registrationId?: string | null;
  financialYear?: string | null;
  notes?: string | null;
  details?: Record<string, unknown> | null;
}

const PROFILE_COLUMNS = `id, entity_id, registration_id, scope, effective_from::text, effective_to::text,
  gst_scheme, qrmp_category, attributes, version, updated_at`;

function mapProfile(r: ProfileSqlRow): ComplianceProfileRecord {
  return {
    id: r.id,
    entityId: r.entity_id,
    registrationId: r.registration_id,
    scope: r.scope,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    gstScheme: r.gst_scheme,
    qrmpCategory: r.qrmp_category,
    attributes: r.attributes,
    version: r.version,
    updatedAt: r.updated_at.toISOString(),
  };
}

function mapEvent(r: EventSqlRow, items?: ComplianceEventItem[]): ComplianceEventRecord {
  return {
    id: r.id,
    engagementId: r.engagement_id,
    registrationId: r.registration_id,
    registrationNumber: r.registration_number,
    eventType: r.event_type,
    financialYear: r.financial_year,
    eventDate: r.event_date,
    notes: r.notes,
    details: r.details ?? {},
    recordedByName: r.recorded_by_name,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at?.toISOString() ?? null,
    voidedAt: r.voided_at?.toISOString() ?? null,
    voidReason: r.void_reason,
    sourceInstanceId: r.source_instance_id,
    ...(items ? { items } : {}),
  };
}

const toEventRow = (r: EventSqlRow): EventRow => ({
  id: r.id,
  registration_id: r.registration_id,
  event_type: r.event_type,
  financial_year: r.financial_year ?? '',
  event_date: r.event_date,
  details: r.details,
});

/**
 * A director appointed or ceased (DIR-12), applied to a directors list. Pure;
 * `undo` reverses it (voiding the event). `known` is the director as last
 * recorded (restored when a cessation is undone); a new director's KYC cycle
 * starts in `kycFy`, the year of appointment.
 */
export function applyDirectorChange(
  directors: readonly CompanyDirector[],
  details: Record<string, unknown>,
  undo: boolean,
  fallback: { kycFy: string; known?: CompanyDirector },
): CompanyDirector[] {
  const din = String(details.din ?? '');
  const appointed = (details.change === 'appointed') !== undo;
  const others = directors.filter((d) => d.din !== din);
  if (!appointed) return others;
  const prior = directors.find((d) => d.din === din) ?? fallback.known;
  const name =
    typeof details.name === 'string' && details.name ? details.name : (prior?.name ?? din);
  return [...others, { din, name, kycCycleStartFy: prior?.kycCycleStartFy ?? fallback.kycFy }];
}

function summaryOf(s: GenerateSummary): GenerateCalendarResult {
  return { created: s.created, moved: s.moved, flagged: s.flagged, notApplicable: s.notApplicable };
}

/** First day of the month of `iso`, and the last day 11 months on (a 12-month window). */
export function defaultCalendarWindow(today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const from = `${today.slice(0, 7)}-01`;
  const end = new Date(Date.UTC(y, m - 1 + 12, 0));
  return { from, to: end.toISOString().slice(0, 10) };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_LABEL: Record<FilingStatus, string> = {
  not_started: 'Not started',
  awaiting_data: 'Awaiting data',
  in_preparation: 'In preparation',
  in_review: 'In review',
  ready_to_file: 'Ready to file',
  filed: 'Filed',
  not_applicable: 'Not applicable',
};

/** The sheet columns of the firm calendar export (pure; exported for tests). */
export function calendarSheetRows(items: readonly ComplianceCalendarRow[]): (string | number)[][] {
  const header = [
    'Due date',
    'Day',
    'Client',
    'Registration',
    'Form',
    'Period',
    'Status',
    'Days left',
    'Assignee',
    'Stream',
    'Flag',
  ];
  const rows = items.map((r) => {
    const flags = [
      r.band === 'red' && r.daysLeft < 0 ? `Overdue ${-r.daysLeft} days` : null,
      r.isProvisional ? 'Provisional date' : null,
      r.extensionReference ? `Extended (${r.extensionReference})` : null,
      r.needsVerification ? 'Verify' : null,
      r.profileChanged ? 'Profile changed — check' : null,
      r.isOptional ? 'Optional' : null,
    ].filter(Boolean);
    return [
      r.dueDate,
      WEEKDAYS[new Date(`${r.dueDate}T00:00:00Z`).getUTCDay()]!,
      r.entityName,
      r.registrationNumber ?? '',
      r.formLabel ?? r.ruleName,
      r.periodLabel,
      STATUS_LABEL[r.workflowStatus] ?? r.workflowStatus,
      r.daysLeft,
      r.assigneeName ?? '',
      r.stream ?? '',
      flags.join('; '),
    ];
  });
  return [header, ...rows];
}

/**
 * Calendar v2 (spec Change 4): the firm calendar, compliance profiles, recorded
 * events, on-demand generation and "Verify" confirmations. The generation
 * itself lives in ComplianceGeneratorService; this is the request layer.
 */
@Injectable()
export class ComplianceCalendarV2Service {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly generator: ComplianceGeneratorService,
  ) {}

  // ── Generation ──────────────────────────────────────────────────────────

  async generate(
    ctx: RlsContext,
    engagementId: string,
    financialYear?: string,
  ): Promise<GenerateCalendarResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertLead(client, engagementId);
      const summary = await this.generator.generateForEngagement(client, engagementId, {
        ...(financialYear ? { financialYears: [financialYear] } : {}),
      });
      await this.audit.recordWith(client, ctx, {
        action: 'compliance.calendar_generated',
        objectType: 'engagement',
        objectId: engagementId,
        after: { financialYear: financialYear ?? null, ...summaryOf(summary) },
      });
      return summaryOf(summary);
    });
  }

  // ── Events ──────────────────────────────────────────────────────────────

  async listEvents(ctx: RlsContext, engagementId: string): Promise<ComplianceEventRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<EventSqlRow>(
        `${EVENT_SELECT}
          WHERE ev.engagement_id = $1
          ORDER BY ev.event_date DESC, ev.created_at DESC`,
        [engagementId],
      );
      if (rows.length === 0) return [];
      // The items each event created (DIR-12 …) or dates (AOC-4 / MGT-7 / ADT-1).
      const items = await client.query<ComplianceEventItem & { eventId: string }>(
        `SELECT ci.compliance_event_id AS "eventId", ci.id AS "instanceId",
                COALESCE(ci.form_label, rv.form_label, cr.name) AS label,
                ci.statutory_deadline::text AS "dueDate", ci.workflow_status AS "workflowStatus"
           FROM hsdg.compliance_instances ci
           JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
           LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
          WHERE ci.compliance_event_id = ANY($1::uuid[])
          ORDER BY ci.statutory_deadline, label`,
        [rows.map((r) => r.id)],
      );
      const byEvent = new Map<string, ComplianceEventItem[]>();
      for (const { eventId, ...it } of items.rows) {
        byEvent.set(eventId, [...(byEvent.get(eventId) ?? []), it]);
      }
      return rows.map((r) => mapEvent(r, byEvent.get(r.id) ?? []));
    });
  }

  async recordEvent(
    ctx: RlsContext,
    engagementId: string,
    input: RecordComplianceEventDto,
  ): Promise<RecordComplianceEventResult> {
    return this.db.withRlsContext(ctx, (client) =>
      this.recordEventWith(client, ctx, engagementId, input),
    );
  }

  /**
   * Record an event on the caller's transaction (the AGM's "Record meeting"
   * calls this too): create the items it triggers, move the AGM-linked dates,
   * tick the lines it satisfies, and log what changed.
   */
  async recordEventWith(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    input: EventInput,
    opts: { sourceInstanceId?: string } = {},
  ): Promise<RecordComplianceEventResult> {
    const eng = await this.assertLead(client, engagementId);
    if (eng.kind !== 'compliance') {
      throw new BadRequestException('Events are recorded on a Compliance engagement.');
    }
    const eventDate = input.eventDate.slice(0, 10);
    if (eventDate > istToday()) throw new BadRequestException('An event cannot be in the future.');
    const checked = validateEventDetails(input.eventType, input.details);
    if ('error' in checked) throw new BadRequestException(checked.error);
    const registrationId = await this.eventRegistration(
      client,
      eng.entity_id,
      input.eventType,
      input.registrationId ?? null,
    );
    const financialYear = input.financialYear ?? eventFinancialYear(input.eventType, eventDate);
    await this.assertNotRecordedTwice(
      client,
      engagementId,
      input.eventType,
      financialYear,
      registrationId,
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.compliance_events
         (engagement_id, registration_id, event_type, financial_year, event_date, notes, details,
          recorded_by_employee_id, source_instance_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       RETURNING id`,
      [
        engagementId,
        registrationId,
        input.eventType,
        financialYear,
        eventDate,
        input.notes ?? null,
        JSON.stringify(checked.details),
        ctx.employeeId ?? null,
        opts.sourceInstanceId ?? null,
      ],
    );
    const event = await this.loadEvent(client, engagementId, rows[0]!.id);
    if (input.eventType === 'director_change' && registrationId) {
      await this.applyDirectorEvent(client, ctx, eng.entity_id, registrationId, event, false);
    }
    const summary = await this.applyEvent(client, engagementId, toEventRow(event), {});
    const changes = await this.describeChanges(client, summary);
    await this.logEvent(client, ctx, event, 'recorded', null, changes, null);
    await this.audit.recordWith(client, ctx, {
      action: 'compliance.event_recorded',
      objectType: 'engagement',
      objectId: engagementId,
      after: {
        eventId: event.id,
        eventType: input.eventType,
        eventDate,
        financialYear,
        details: checked.details,
        created: summary.created,
        moved: summary.moved,
      },
    });
    return {
      event: mapEvent(event),
      created: summary.created,
      moved: summary.moved,
      changes,
    };
  }

  /** PATCH — correct an event's date, year, details or notes; the calendar follows. */
  async correctEvent(
    ctx: RlsContext,
    engagementId: string,
    eventId: string,
    input: CorrectComplianceEventDto,
  ): Promise<RecordComplianceEventResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await this.assertLead(client, engagementId);
      const before = await this.loadEvent(client, engagementId, eventId, true);
      if (before.voided_at) throw new BadRequestException('A voided event cannot be corrected.');
      const eventDate = input.eventDate?.slice(0, 10) ?? before.event_date;
      if (before.source_instance_id && eventDate !== before.event_date) {
        throw new BadRequestException(
          'The date comes from the AGM meeting record — undo it and record the meeting again.',
        );
      }
      if (eventDate > istToday()) {
        throw new BadRequestException('An event cannot be in the future.');
      }
      const checked = validateEventDetails(before.event_type, input.details ?? before.details);
      if ('error' in checked) throw new BadRequestException(checked.error);
      const financialYear =
        input.financialYear ??
        (input.eventDate
          ? eventFinancialYear(before.event_type, eventDate)
          : (before.financial_year ?? eventFinancialYear(before.event_type, eventDate)));
      if (financialYear !== before.financial_year) {
        await this.assertNotRecordedTwice(
          client,
          engagementId,
          before.event_type,
          financialYear,
          before.registration_id,
          before.id,
        );
      }
      await client.query(
        `UPDATE hsdg.compliance_events
            SET event_date = $2, financial_year = $3, details = $4::jsonb,
                notes = $5, updated_at = now()
          WHERE id = $1`,
        [
          eventId,
          eventDate,
          financialYear,
          JSON.stringify(checked.details),
          input.notes === undefined ? before.notes : input.notes,
        ],
      );
      const after = await this.loadEvent(client, engagementId, eventId);
      if (before.event_type === 'director_change' && before.registration_id) {
        // Re-apply from the corrected date: undo the old change, apply the new one.
        await this.applyDirectorEvent(
          client,
          ctx,
          eng.entity_id,
          before.registration_id,
          before,
          true,
        );
        await this.applyDirectorEvent(
          client,
          ctx,
          eng.entity_id,
          before.registration_id,
          after,
          false,
        );
      }
      const summary = await this.applyEvent(client, engagementId, toEventRow(after), {
        alsoYears: before.financial_year ? [before.financial_year] : [],
      });
      const changes = await this.describeChanges(client, summary);
      await this.logEvent(client, ctx, after, 'corrected', before, changes, input.reason);
      await this.audit.recordWith(client, ctx, {
        action: 'compliance.event_corrected',
        objectType: 'engagement',
        objectId: engagementId,
        before: { eventId, eventDate: before.event_date, details: before.details },
        after: {
          eventId,
          eventDate,
          financialYear,
          details: checked.details,
          reason: input.reason,
        },
      });
      return { event: mapEvent(after), created: summary.created, moved: summary.moved, changes };
    });
  }

  /** DELETE — void an event (with a reason). Its items fall away or are flagged. */
  async voidEvent(
    ctx: RlsContext,
    engagementId: string,
    eventId: string,
    reason: string,
  ): Promise<RecordComplianceEventResult> {
    return this.db.withRlsContext(ctx, (client) =>
      this.voidEventWith(client, ctx, engagementId, eventId, reason),
    );
  }

  async voidEventWith(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    eventId: string,
    reason: string,
    opts: { fromMeeting?: boolean } = {},
  ): Promise<RecordComplianceEventResult> {
    const eng = await this.assertLead(client, engagementId);
    const before = await this.loadEvent(client, engagementId, eventId, true);
    if (before.voided_at) throw new BadRequestException('This event is already voided.');
    if (before.source_instance_id && !opts.fromMeeting) {
      // The meeting stays "Held" otherwise: the two go together.
      throw new BadRequestException(
        'This AGM was recorded from the AGM meeting — undo the meeting record instead.',
      );
    }
    if (!reason.trim()) throw new BadRequestException('Say why the event is being voided.');
    await client.query(
      `UPDATE hsdg.compliance_events
          SET voided_at = now(), voided_by_employee_id = $2, void_reason = $3, updated_at = now()
        WHERE id = $1`,
      [eventId, ctx.employeeId ?? null, reason.trim()],
    );
    const after = await this.loadEvent(client, engagementId, eventId);
    if (before.event_type === 'director_change' && before.registration_id) {
      await this.applyDirectorEvent(
        client,
        ctx,
        eng.entity_id,
        before.registration_id,
        before,
        true,
      );
    }
    const summary = await this.applyEvent(client, engagementId, toEventRow(after), {
      voided: true,
    });
    const changes = await this.describeChanges(client, summary);
    await this.logEvent(client, ctx, after, 'voided', before, changes, reason.trim());
    await this.audit.recordWith(client, ctx, {
      action: 'compliance.event_voided',
      objectType: 'engagement',
      objectId: engagementId,
      after: { eventId, eventType: before.event_type, reason: reason.trim() },
    });
    return { event: mapEvent(after), created: summary.created, moved: summary.moved, changes };
  }

  /** The ROC tab header: CIN / LLPINs, why it is empty, board-meeting cadence (P2-6). */
  async rocOverview(ctx: RlsContext, engagementId: string): Promise<RocOverview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await client.query<{ entity_id: string; category: string | null }>(
        `SELECT e.entity_id, et.category
           FROM hsdg.engagements e
           JOIN hsdg.entities ent ON ent.id = e.entity_id
           LEFT JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
          WHERE e.id = $1`,
        [engagementId],
      );
      const e = eng.rows[0];
      if (!e) throw new NotFoundException('Engagement not found.');
      const regs = (await this.registrations(client, e.entity_id)).filter(
        (r) =>
          (r.registrationType === 'cin' || r.registrationType === 'llpin') && r.status === 'active',
      );
      const held = await client.query<{ registration_id: string; filed_on: string }>(
        `SELECT ci.registration_id, fr.filed_on::text
           FROM hsdg.filing_records fr
           JOIN hsdg.compliance_instances ci ON ci.id = fr.compliance_instance_id
           JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
          WHERE ci.engagement_id = $1 AND fr.undone_at IS NULL
            AND cr.code IN ('ROC_BOARD_MEETING', 'ROC_FIRST_BOARD')`,
        [engagementId],
      );
      const subtypes = await client.query<{ registration_id: string; subtype: string | null }>(
        `SELECT DISTINCT ON (p.registration_id) p.registration_id,
                p.attributes ->> 'companySubtype' AS subtype
           FROM hsdg.registration_compliance_profiles p
          WHERE p.entity_id = $1 AND p.scope = 'cin' AND p.effective_from <= CURRENT_DATE
          ORDER BY p.registration_id, p.effective_from DESC`,
        [e.entity_id],
      );
      const subtypeOf = new Map(subtypes.rows.map((r) => [r.registration_id, r.subtype]));
      return {
        registrations: regs.map((r) => ({
          id: r.id,
          type: r.registrationType as 'cin' | 'llpin',
          number: r.registrationNumber,
        })),
        message: rocEmptyMessage(e.category, regs.length),
        boardMeetings: regs
          .filter((r) => r.registrationType === 'cin')
          .map((r) =>
            boardMeetingCadence(
              { id: r.id, number: r.registrationNumber },
              held.rows.filter((h) => h.registration_id === r.id).map((h) => h.filed_on),
              subtypeOf.get(r.id) ?? null,
            ),
          ),
      };
    });
  }

  // ── event helpers ──────────────────────────────────────────────────────

  private async loadEvent(
    client: PoolClient,
    engagementId: string,
    eventId: string,
    lock = false,
  ): Promise<EventSqlRow> {
    if (lock) {
      await client.query(`SELECT 1 FROM hsdg.compliance_events WHERE id = $1 FOR UPDATE`, [
        eventId,
      ]);
    }
    const { rows } = await client.query<EventSqlRow>(
      `${EVENT_SELECT} WHERE ev.id = $1 AND ev.engagement_id = $2`,
      [eventId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Event not found.');
    return rows[0];
  }

  /**
   * The registration an event is on. A ROC event needs the company's CIN (or
   * LLPIN): the only one by default; with several, the caller must choose.
   */
  private async eventRegistration(
    client: PoolClient,
    entityId: string,
    eventType: string,
    registrationId: string | null,
  ): Promise<string | null> {
    const regs = await this.registrations(client, entityId);
    if (registrationId) {
      if (!regs.some((r) => r.id === registrationId)) {
        throw new BadRequestException('That registration does not belong to this client.');
      }
      return registrationId;
    }
    if (!(ROC_EVENT_TYPES as string[]).includes(eventType)) return null;
    const mca = regs.filter(
      (r) =>
        (r.registrationType === 'cin' || r.registrationType === 'llpin') && r.status === 'active',
    );
    if (mca.length === 1) return mca[0]!.id;
    if (mca.length === 0) {
      throw new BadRequestException('Add the CIN (or LLPIN) to the client to record ROC events.');
    }
    throw new BadRequestException('Choose the CIN (or LLPIN) the event is on.');
  }

  /** The AGM (and its extension) is recorded once a year per company — correct it instead. */
  private async assertNotRecordedTwice(
    client: PoolClient,
    engagementId: string,
    eventType: string,
    financialYear: string,
    registrationId: string | null,
    exceptId?: string,
  ): Promise<void> {
    if (!ONCE_A_YEAR_EVENT_TYPES.has(eventType)) return;
    const dup = await client.query(
      `SELECT 1 FROM hsdg.compliance_events
        WHERE engagement_id = $1 AND event_type = $2 AND financial_year = $3
          AND registration_id IS NOT DISTINCT FROM $4 AND voided_at IS NULL
          AND ($5::uuid IS NULL OR id <> $5)`,
      [engagementId, eventType, financialYear, registrationId, exceptId ?? null],
    );
    if (dup.rowCount) {
      throw new ConflictException(
        eventType === 'agm'
          ? `The AGM for FY ${financialYear} is already recorded — correct it instead.`
          : `An AGM extension for FY ${financialYear} is already recorded — correct it instead.`,
      );
    }
  }

  /**
   * Bring the calendar in line with an event: its own items (DIR-12 …), the
   * AGM-linked years (AOC-4 / MGT-7 / ADT-1, the AGM's extended date), and the
   * checklist lines that tick from the AGM.
   */
  private async applyEvent(
    client: PoolClient,
    engagementId: string,
    event: EventRow,
    opts: { voided?: boolean; alsoYears?: string[] },
  ): Promise<GenerateSummary> {
    let summary = await this.generator.syncEventInstances(client, engagementId, event, {
      voided: opts.voided,
    });
    if (RECURRING_EVENT_TYPES.has(event.event_type)) {
      const years = [...new Set([event.financial_year, ...(opts.alsoYears ?? [])])];
      summary = mergeSummaries(
        summary,
        await this.generator.generateForEngagement(client, engagementId, {
          financialYears: years,
        }),
      );
      const lines = await client.query<{ id: string }>(
        `SELECT DISTINCT compliance_instance_id AS id FROM hsdg.instance_checklist_items
          WHERE engagement_id = $1 AND auto_tick = 'event'`,
        [engagementId],
      );
      for (const { id } of lines.rows) await syncAutoTicks(client, id);
    }
    return summary;
  }

  /** A generator summary in words: which items were created, moved, flagged, retired. */
  private async describeChanges(
    client: PoolClient,
    s: GenerateSummary,
  ): Promise<ComplianceEventChanges> {
    const ids = [
      ...s.createdIds,
      ...s.movedItems.map((m) => m.id),
      ...s.flaggedIds,
      ...s.notApplicableIds,
    ];
    if (ids.length === 0) return { created: [], moved: [], flagged: [], notApplicable: [] };
    const { rows } = await client.query<{ id: string; label: string; due: string }>(
      `SELECT ci.id, COALESCE(ci.form_label, rv.form_label, cr.name) AS label,
              ci.statutory_deadline::text AS due
         FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
         LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
        WHERE ci.id = ANY($1::uuid[])`,
      [ids],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const label = (id: string) => byId.get(id)?.label ?? 'Item';
    return {
      created: s.createdIds.map((id) => ({
        instanceId: id,
        label: label(id),
        dueDate: byId.get(id)?.due ?? '',
      })),
      moved: s.movedItems.map((m) => ({
        instanceId: m.id,
        label: label(m.id),
        from: m.from,
        to: m.to,
      })),
      flagged: s.flaggedIds.map((id) => ({ instanceId: id, label: label(id) })),
      notApplicable: s.notApplicableIds.map((id) => ({ instanceId: id, label: label(id) })),
    };
  }

  private async logEvent(
    client: PoolClient,
    ctx: RlsContext,
    event: EventSqlRow,
    action: 'recorded' | 'corrected' | 'voided',
    before: EventSqlRow | null,
    changes: ComplianceEventChanges,
    reason: string | null,
  ): Promise<void> {
    const snap = (e: EventSqlRow) => ({
      eventDate: e.event_date,
      financialYear: e.financial_year,
      details: e.details ?? {},
      notes: e.notes,
    });
    await client.query(
      `INSERT INTO hsdg.compliance_event_log
         (event_id, engagement_id, action, before, after, changes, reason, actor_employee_id)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)`,
      [
        event.id,
        event.engagement_id,
        action,
        before ? JSON.stringify(snap(before)) : null,
        JSON.stringify(snap(event)),
        JSON.stringify(changes),
        reason,
        ctx.employeeId ?? null,
      ],
    );
  }

  /**
   * DIR-12 keeps the CIN profile's directors current (spec §6.2): the change
   * applies to every profile row in force on or after the event date, splitting
   * the row in force at that date. `undo` reverses it (a voided event).
   */
  private async applyDirectorEvent(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    registrationId: string,
    event: EventSqlRow,
    undo: boolean,
  ): Promise<void> {
    const details = event.details ?? {};
    if (!details.din) return;
    const from = event.event_date;
    const all = await client.query<ProfileSqlRow>(
      `SELECT ${PROFILE_COLUMNS} FROM hsdg.registration_compliance_profiles
        WHERE entity_id = $1 AND scope = 'cin' AND registration_id = $2
        ORDER BY effective_from
        FOR UPDATE`,
      [entityId, registrationId],
    );
    const rows = { rows: all.rows.filter((p) => !p.effective_to || p.effective_to >= from) };
    const directorsOf = (p: ProfileSqlRow | undefined) =>
      ((p?.attributes ?? {}) as CinProfileAttributes).directors ?? [];
    // The director as last recorded anywhere (undoing a cessation restores them).
    const known = all.rows
      .flatMap((p) => directorsOf(p))
      .reverse()
      .find((d) => d.din === details.din);
    const fallback = { kycFy: eventFinancialYear('director_change', from), known };
    const update = (p: ProfileSqlRow) =>
      client.query(
        `UPDATE hsdg.registration_compliance_profiles
            SET attributes = $2::jsonb, version = version + 1 WHERE id = $1`,
        [
          p.id,
          JSON.stringify({
            ...p.attributes,
            directors: applyDirectorChange(directorsOf(p), details, undo, fallback),
          }),
        ],
      );
    const inForce = rows.rows.find((p) => p.effective_from <= from);
    if (inForce && inForce.effective_from < from) {
      // Split: the old list up to the day before, the changed list from the event.
      await client.query(
        `UPDATE hsdg.registration_compliance_profiles
            SET effective_to = $2, version = version + 1 WHERE id = $1`,
        [inForce.id, dayBefore(from)],
      );
      await client.query(
        `INSERT INTO hsdg.registration_compliance_profiles
           (entity_id, registration_id, scope, effective_from, effective_to, gst_scheme,
            qrmp_category, attributes, created_by_employee_id)
         VALUES ($1, $2, 'cin', $3, $4, NULL, NULL, $5::jsonb, $6)`,
        [
          entityId,
          registrationId,
          from,
          inForce.effective_to,
          JSON.stringify({
            ...inForce.attributes,
            directors: applyDirectorChange(directorsOf(inForce), details, undo, fallback),
          }),
          ctx.employeeId ?? null,
        ],
      );
    } else if (inForce) {
      await update(inForce);
    } else if (!undo) {
      // No profile in force at the event date: start one there, up to the next.
      const next = rows.rows[0];
      await client.query(
        `INSERT INTO hsdg.registration_compliance_profiles
           (entity_id, registration_id, scope, effective_from, effective_to, attributes,
            created_by_employee_id)
         VALUES ($1, $2, 'cin', $3, $4, $5::jsonb, $6)`,
        [
          entityId,
          registrationId,
          from,
          next ? dayBefore(next.effective_from) : null,
          JSON.stringify({ directors: applyDirectorChange([], details, false, fallback) }),
          ctx.employeeId ?? null,
        ],
      );
    }
    for (const p of rows.rows) if (p.effective_from > from) await update(p);
  }

  // ── Profiles ────────────────────────────────────────────────────────────

  async getProfiles(ctx: RlsContext, entityId: string): Promise<EntityComplianceProfiles> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertEntityReadable(client, entityId);
      const registrations = await this.registrations(client, entityId);
      const profiles = await client.query<ProfileSqlRow>(
        `SELECT ${PROFILE_COLUMNS} FROM hsdg.registration_compliance_profiles
            WHERE entity_id = $1
            ORDER BY scope, registration_id NULLS FIRST, effective_from DESC`,
        [entityId],
      );
      const ent = await client.query<{ slug: string | null; annual_turnover: string | null }>(
        `SELECT et.slug, e.annual_turnover::text
           FROM hsdg.entities e LEFT JOIN hsdg.entity_types et ON et.id = e.entity_type_id
          WHERE e.id = $1`,
        [entityId],
      );
      const turnover = ent.rows[0]?.annual_turnover ?? null;
      return {
        entityId,
        entityTypeSlug: ent.rows[0]?.slug ?? null,
        annualTurnover: turnover === null ? null : Number(turnover),
        registrations,
        profiles: profiles.rows.map(mapProfile),
      };
    });
  }

  /**
   * Save the profile effective from a date: the same date updates that row;
   * a new date closes the row in force (effective_to = the day before) and,
   * if a later row exists, ends the new one the day before it. Then every open
   * Compliance engagement of the client is regenerated — each in a savepoint,
   * so one the caller does not lead is skipped (the nightly run picks it up).
   */
  async saveProfile(
    ctx: RlsContext,
    entityId: string,
    input: SaveComplianceProfileDto,
  ): Promise<SaveComplianceProfileResult> {
    const scope = input.scope;
    const registrationId = scope === 'pan' ? null : (input.registrationId ?? null);
    if (scope === 'pan' && input.registrationId) {
      throw new BadRequestException('A PAN profile is on the client itself — omit registrationId.');
    }
    if (scope !== 'pan' && !registrationId) {
      throw new BadRequestException(`A ${scope.toUpperCase()} profile needs its registration.`);
    }
    if (scope !== 'gstin' && (input.gstScheme || input.qrmpCategory)) {
      throw new BadRequestException('GST scheme and QRMP category apply to a GSTIN profile only.');
    }
    if (input.qrmpCategory && input.gstScheme && input.gstScheme !== 'qrmp') {
      throw new BadRequestException('A QRMP category applies to the QRMP scheme only.');
    }
    const attributes = input.attributes ?? {};
    const errors = profileAttributeErrors(scope, attributes);
    if (errors.length) throw new BadRequestException(errors);
    const effectiveFrom = input.effectiveFrom.slice(0, 10);

    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertEntityReadable(client, entityId);
      const canManage = await client.query<{ ok: boolean }>(
        `SELECT hsdg.can_manage_entity_compliance($1) AS ok`,
        [entityId],
      );
      if (!canManage.rows[0]?.ok) {
        throw new ForbiddenException(
          'Only a partner or manager on one of the client’s open engagements can change its profile.',
        );
      }
      if (registrationId) {
        const regs = await this.registrations(client, entityId);
        const reg = regs.find((r) => r.id === registrationId);
        if (!reg)
          throw new BadRequestException('That registration does not belong to this client.');
        if (reg.registrationType !== scope) {
          throw new BadRequestException(
            `That registration is a ${reg.registrationType.toUpperCase()}, not a ${scope.toUpperCase()}.`,
          );
        }
      }

      const existing = await client.query<ProfileSqlRow>(
        `SELECT ${PROFILE_COLUMNS} FROM hsdg.registration_compliance_profiles
          WHERE entity_id = $1 AND scope = $2 AND registration_id IS NOT DISTINCT FROM $3
          ORDER BY effective_from
          FOR UPDATE`,
        [entityId, scope, registrationId],
      );
      const same = existing.rows.find((p) => p.effective_from === effectiveFrom);
      const values = {
        gstScheme: input.gstScheme ?? null,
        qrmpCategory: input.qrmpCategory ?? null,
        attributes: compactAttributes(attributes),
      };
      let saved: ProfileSqlRow;
      if (same) {
        const { rows } = await client.query<ProfileSqlRow>(
          `UPDATE hsdg.registration_compliance_profiles
              SET gst_scheme = $2, qrmp_category = $3, attributes = $4::jsonb, version = version + 1
            WHERE id = $1
            RETURNING ${PROFILE_COLUMNS}`,
          [same.id, values.gstScheme, values.qrmpCategory, JSON.stringify(values.attributes)],
        );
        saved = rows[0]!;
      } else {
        const inForce = existing.rows.find(
          (p) =>
            p.effective_from < effectiveFrom &&
            (p.effective_to === null || p.effective_to >= effectiveFrom),
        );
        const next = existing.rows.find((p) => p.effective_from > effectiveFrom);
        if (inForce) {
          await client.query(
            `UPDATE hsdg.registration_compliance_profiles
                SET effective_to = $2, version = version + 1 WHERE id = $1`,
            [inForce.id, dayBefore(effectiveFrom)],
          );
        }
        const { rows } = await client.query<ProfileSqlRow>(
          `INSERT INTO hsdg.registration_compliance_profiles
             (entity_id, registration_id, scope, effective_from, effective_to, gst_scheme,
              qrmp_category, attributes, created_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
           RETURNING ${PROFILE_COLUMNS}`,
          [
            entityId,
            registrationId,
            scope,
            effectiveFrom,
            next ? dayBefore(next.effective_from) : null,
            values.gstScheme,
            values.qrmpCategory,
            JSON.stringify(values.attributes),
            ctx.employeeId ?? null,
          ],
        );
        saved = rows[0]!;
      }

      await this.audit.recordWith(client, ctx, {
        action: 'compliance.profile_saved',
        objectType: 'registration_compliance_profile',
        objectId: saved.id,
        before: same
          ? {
              gstScheme: same.gst_scheme,
              qrmpCategory: same.qrmp_category,
              attributes: same.attributes,
            }
          : undefined,
        after: { scope, registrationId, effectiveFrom, ...values },
      });

      const regenerated = await this.regenerateEntity(client, entityId);
      return { profile: mapProfile(saved), regenerated };
    });
  }

  /** Regenerate every open Compliance engagement of a client (savepoint each). */
  private async regenerateEntity(
    client: PoolClient,
    entityId: string,
  ): Promise<SaveComplianceProfileResult['regenerated']> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.engagements
        WHERE entity_id = $1 AND kind = 'compliance' AND status <> ALL($2::text[])
        ORDER BY created_at`,
      [entityId, CLOSED_ENGAGEMENT_STATUSES],
    );
    const out: SaveComplianceProfileResult['regenerated'] = [];
    for (const { id } of rows) {
      await client.query('SAVEPOINT profile_regen');
      try {
        const s = await this.generator.generateForEngagement(client, id);
        await client.query('RELEASE SAVEPOINT profile_regen');
        out.push({ engagementId: id, ...summaryOf(s) });
      } catch {
        // Not a lead there (RLS) — the nightly calendar run regenerates it.
        await client.query('ROLLBACK TO SAVEPOINT profile_regen');
      }
    }
    return out;
  }

  // ── Firm calendar ───────────────────────────────────────────────────────

  async calendar(
    ctx: RlsContext,
    query: ComplianceCalendarV2QueryDto,
  ): Promise<ComplianceCalendarResponse> {
    const today = istToday();
    const window = defaultCalendarWindow(today);
    const from = query.from?.slice(0, 10) ?? window.from;
    const to = query.to?.slice(0, 10) ?? window.to;
    if (from > to) throw new BadRequestException('from must be on or before to.');
    const includeOverdue = query.includeOverdue ?? true;

    return this.db.withRlsContext(ctx, async (client) => {
      const params: unknown[] = [from, to];
      const where: string[] = [
        `${FILING_STREAM} IS NOT NULL`,
        `eng.kind = 'compliance'`,
        `eng.status <> 'merged'`,
      ];
      const inWindow = `(${EFFECTIVE_DUE} BETWEEN $1::date AND $2::date)`;
      where.push(
        includeOverdue
          ? `(${inWindow} OR (${EFFECTIVE_DUE} < $1::date
                AND ci.workflow_status NOT IN ('filed','not_applicable')))`
          : inWindow,
      );
      const add = (sql: (p: string) => string, value: unknown): void => {
        params.push(value);
        where.push(sql(`$${params.length}`));
      };
      if (query.status?.length) add((p) => `ci.workflow_status = ANY(${p}::text[])`, query.status);
      // Not-applicable rows are noise on the calendar unless asked for.
      else where.push(`ci.workflow_status <> 'not_applicable'`);
      if (query.stream?.length) add((p) => `${FILING_STREAM} = ANY(${p}::text[])`, query.stream);
      if (query.partnerId) add((p) => `eng.engagement_partner_id = ${p}`, query.partnerId);
      if (query.managerId) add((p) => `eng.engagement_manager_id = ${p}`, query.managerId);
      if (query.officeCode) add((p) => `o.code = ${p}`, query.officeCode);
      if (query.entityId) add((p) => `eng.entity_id = ${p}`, query.entityId);
      if (query.engagementId) add((p) => `ci.engagement_id = ${p}`, query.engagementId);
      if (query.mine) {
        if (!ctx.employeeId) return { items: [], total: 0, from, to };
        add(
          (p) => `COALESCE(es.lead_employee_id, eng.engagement_manager_id) = ${p}`,
          ctx.employeeId,
        );
      }
      params.push(CALENDAR_ROW_CAP);

      const { rows } = await client.query<CalendarSqlRow>(
        `SELECT ci.id, ci.engagement_id, eng.engagement_code, eng.entity_id,
                ent.legal_name AS entity_name, o.code AS office_code, ${FILING_STREAM} AS stream,
                cr.code AS rule_code, cr.name AS rule_name, COALESCE(ci.form_label, v.form_label) AS form_label, ci.registration_id,
                ci.financial_year, ci.period_key, ci.section,
                to_char(ci.reference_date, 'YYYY-MM') AS reference_month,
                ${EFFECTIVE_DUE}::text AS due_date, ci.statutory_deadline::text AS computed_due,
                ge.notification_reference AS extension_reference,
                COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS internal_date,
                ci.workflow_status, ci.is_provisional, ci.is_optional,
                (v.verification = 'verify' AND NOT EXISTS (
                   SELECT 1 FROM hsdg.compliance_rule_verifications crv
                    WHERE crv.compliance_rule_version_id = v.id)) AS needs_verification,
                (ci.profile_changed_at IS NOT NULL) AS profile_changed,
                COALESCE(es.lead_employee_id, eng.engagement_manager_id) AS assignee_id,
                asg.full_name AS assignee_name, ep.full_name AS partner_name,
                mgr.full_name AS manager_name,
                count(*) OVER () AS total
           FROM hsdg.compliance_instances ci
           JOIN hsdg.compliance_rule_versions v ON v.id = ci.compliance_rule_version_id
           JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
           LEFT JOIN hsdg.services rs ON rs.id = cr.service_id
           LEFT JOIN hsdg.services rf ON rf.id = rs.folded_into_service_id
           JOIN hsdg.engagements eng ON eng.id = ci.engagement_id
           JOIN hsdg.entities ent ON ent.id = eng.entity_id
           JOIN hsdg.offices o ON o.id = eng.office_id
           LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
           LEFT JOIN hsdg.employees asg
             ON asg.id = COALESCE(es.lead_employee_id, eng.engagement_manager_id)
           LEFT JOIN hsdg.employees ep ON ep.id = eng.engagement_partner_id
           LEFT JOIN hsdg.employees mgr ON mgr.id = eng.engagement_manager_id
           LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
          WHERE ${where.join(' AND ')}
          ORDER BY ${EFFECTIVE_DUE}, ent.legal_name, cr.code, ci.period_key
          LIMIT $${params.length}`,
        params,
      );

      const regIds = [
        ...new Set(rows.map((r) => r.registration_id).filter((x): x is string => !!x)),
      ];
      const regs = new Map<string, { registration_type: string; registration_number: string }>();
      if (regIds.length) {
        const res = await client.query<{
          id: string;
          registration_type: string;
          registration_number: string;
        }>(`SELECT * FROM hsdg.compliance_registrations($1::uuid[])`, [regIds]);
        for (const r of res.rows) regs.set(r.id, r);
      }

      const items = rows.map((r): ComplianceCalendarRow => {
        const reg = r.registration_id ? regs.get(r.registration_id) : undefined;
        const { band, daysLeft } = dueBand(r.due_date, today, r.workflow_status);
        return {
          id: r.id,
          engagementId: r.engagement_id,
          engagementCode: r.engagement_code,
          entityId: r.entity_id,
          entityName: r.entity_name,
          officeCode: r.office_code,
          stream: r.stream,
          ruleCode: r.rule_code,
          ruleName: r.rule_name,
          formLabel: r.form_label,
          registrationId: r.registration_id,
          registrationType: reg?.registration_type ?? null,
          registrationNumber: reg?.registration_number ?? null,
          financialYear: r.financial_year,
          periodKey: r.period_key,
          // A legacy filing has no period key; its reference month stands in.
          periodLabel: periodKeyLabel(r.period_key ?? r.reference_month),
          dueDate: r.due_date,
          originalDueDate: r.computed_due !== r.due_date ? r.computed_due : null,
          extensionReference: r.extension_reference,
          internalDate: r.internal_date,
          workflowStatus: r.workflow_status,
          daysLeft,
          band,
          isProvisional: r.is_provisional,
          isOptional: r.is_optional,
          needsVerification: r.needs_verification,
          profileChanged: r.profile_changed,
          assigneeId: r.assignee_id,
          assigneeName: r.assignee_name,
          partnerName: r.partner_name,
          managerName: r.manager_name,
          section: r.section,
          // Same fields the shared work-link fragment selects; the calendar already has them.
          link: workLinkOf(
            { engagementId: r.engagement_id, engagementKind: 'compliance' },
            {
              instanceId: r.id,
              stream: r.stream,
              financialYear: r.financial_year,
              periodKey: r.period_key,
              section: r.section,
              registrationNumber: reg?.registration_number ?? null,
            },
          ),
        };
      });
      return { items, total: Number(rows[0]?.total ?? 0), from, to };
    });
  }

  /** The firm calendar as an .xlsx workbook (same filters, same rows). */
  async calendarWorkbook(
    ctx: RlsContext,
    query: ComplianceCalendarV2QueryDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const result = await this.calendar(ctx, query);
    const sheet = XLSX.utils.aoa_to_sheet(calendarSheetRows(result.items));
    sheet['!cols'] = [12, 6, 36, 18, 22, 16, 15, 10, 22, 12, 40].map((wch) => ({ wch }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Compliance calendar');
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return { buffer, filename: `compliance-calendar_${result.from}_${result.to}.xlsx` };
  }

  // ── Nightly maintenance ─────────────────────────────────────────────────

  /**
   * The nightly calendar run (scheduler, operator context): attach government
   * extensions notified since an item was created, then regenerate every open
   * Compliance engagement — picking up profile changes a non-lead saved, new
   * rule versions, and AGM dates. One transaction per engagement so one
   * failure never holds back the rest.
   */
  async maintain(ctx: RlsContext): Promise<{
    extended: number;
    engagements: number;
    failed: number;
    totals: GenerateCalendarResult;
  }> {
    const extended = await this.db.withRlsContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE hsdg.compliance_instances ci
            SET government_extension_id = ge.id, version = ci.version + 1, updated_at = now()
           FROM hsdg.government_extensions ge
          WHERE ge.compliance_rule_id = ci.compliance_rule_id
            AND ge.original_due_date = ci.statutory_deadline
            AND ci.government_extension_id IS NULL
            AND ci.statutory_deadline_override IS NULL
            AND ci.workflow_status NOT IN ('filed', 'not_applicable')
            AND ge.revised_due_date = (
              SELECT max(g2.revised_due_date) FROM hsdg.government_extensions g2
               WHERE g2.compliance_rule_id = ci.compliance_rule_id
                 AND g2.original_due_date = ci.statutory_deadline)`,
      );
      return res.rowCount ?? 0;
    });

    const ids = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT e.id FROM hsdg.engagements e
          WHERE e.kind = 'compliance' AND e.status <> ALL($1::text[])
            AND EXISTS (SELECT 1 FROM hsdg.compliance_engagement_years y
                         WHERE y.engagement_id = e.id AND y.status = 'open')
          ORDER BY e.created_at`,
        [CLOSED_ENGAGEMENT_STATUSES],
      );
      return rows.map((r) => r.id);
    });

    const totals: GenerateCalendarResult = { created: 0, moved: 0, flagged: 0, notApplicable: 0 };
    let failed = 0;
    for (const id of ids) {
      try {
        const s = await this.db.withRlsContext(ctx, (client) =>
          this.generator.generateForEngagement(client, id),
        );
        totals.created += s.created;
        totals.moved += s.moved;
        totals.flagged += s.flagged;
        totals.notApplicable += s.notApplicable;
      } catch {
        failed += 1;
      }
    }
    return { extended, engagements: ids.length, failed, totals };
  }

  // ── Verify ──────────────────────────────────────────────────────────────

  /**
   * A partner confirms a rule the sheet marked "Verify" — the version in force
   * today (else the latest). Firm-wide roles only (RLS insert policy).
   */
  async verifyRule(
    ctx: RlsContext,
    ruleId: string,
    note?: string,
  ): Promise<{ versionId: string; verifiedAt: string }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const firmwide = await client.query<{ ok: boolean }>(`SELECT hsdg.ctx_is_firmwide() AS ok`);
      if (!firmwide.rows[0]?.ok) {
        throw new ForbiddenException('Only a firm-wide partner can verify a compliance rule.');
      }
      const today = istToday();
      const { rows } = await client.query<{ id: string; verification: string }>(
        `SELECT v.id, v.verification
           FROM hsdg.compliance_rule_versions v
          WHERE v.compliance_rule_id = $1
          ORDER BY (v.effective_from <= $2::date
                    AND (v.effective_to IS NULL OR v.effective_to >= $2::date)) DESC,
                   v.effective_from DESC
          LIMIT 1`,
        [ruleId, today],
      );
      const version = rows[0];
      if (!version) throw new NotFoundException('Compliance rule not found.');
      if (version.verification !== 'verify') {
        throw new BadRequestException('This rule is not marked for verification.');
      }
      const inserted = await client.query<{ created_at: Date }>(
        `INSERT INTO hsdg.compliance_rule_verifications
           (compliance_rule_version_id, verified_by_employee_id, verified_by_user_id, note)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (compliance_rule_version_id) DO NOTHING
         RETURNING created_at`,
        [version.id, ctx.employeeId ?? null, ctx.userId, note ?? null],
      );
      let verifiedAt = inserted.rows[0]?.created_at;
      if (!verifiedAt) {
        const prior = await client.query<{ created_at: Date }>(
          `SELECT created_at FROM hsdg.compliance_rule_verifications
            WHERE compliance_rule_version_id = $1`,
          [version.id],
        );
        verifiedAt = prior.rows[0]!.created_at;
      } else {
        await this.audit.recordWith(client, ctx, {
          action: 'compliance.rule_verified',
          objectType: 'compliance_rule',
          objectId: ruleId,
          after: { versionId: version.id, note: note ?? null },
        });
      }
      return { versionId: version.id, verifiedAt: verifiedAt.toISOString() };
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async registrations(
    client: PoolClient,
    entityId: string,
  ): Promise<EntityRegistrationOption[]> {
    const { rows } = await client.query<{
      id: string;
      registration_type: string;
      registration_number: string;
      state_code: string | null;
      status: string;
      is_principal: boolean;
    }>(`SELECT * FROM hsdg.entity_compliance_registrations($1)`, [entityId]);
    return rows.map((r) => ({
      id: r.id,
      registrationType: r.registration_type,
      registrationNumber: r.registration_number,
      stateCode: r.state_code,
      status: r.status,
      isPrincipal: r.is_principal,
    }));
  }

  private async assertEntityReadable(client: PoolClient, entityId: string): Promise<void> {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT hsdg.can_read_entity_compliance($1) AS ok`,
      [entityId],
    );
    if (!rows[0]?.ok) throw new NotFoundException('Client not found.');
  }

  /** The engagement, visible and led by the caller (or firm-wide). */
  private async assertLead(
    client: PoolClient,
    engagementId: string,
  ): Promise<{ kind: string | null; entity_id: string }> {
    const { rows } = await client.query<{ kind: string | null; entity_id: string; lead: boolean }>(
      `SELECT kind, entity_id, hsdg.is_engagement_lead(id) AS lead
         FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    const eng = rows[0];
    if (!eng) throw new NotFoundException('Engagement not found.');
    if (!eng.lead) {
      throw new ForbiddenException('Only the engagement partner or manager can do this.');
    }
    return eng;
  }
}
