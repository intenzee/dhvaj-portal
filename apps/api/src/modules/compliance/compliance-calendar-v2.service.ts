import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import * as XLSX from 'xlsx';
import {
  periodKeyLabel,
  type ComplianceCalendarResponse,
  type ComplianceCalendarRow,
  type ComplianceEventRecord,
  type ComplianceProfileRecord,
  type EntityComplianceProfiles,
  type EntityRegistrationOption,
  type FilingStatus,
  type GenerateCalendarResult,
  type GstScheme,
  type ProfileScope,
  type QrmpCategory,
  type RecordComplianceEventResult,
  type SaveComplianceProfileResult,
  type Stream,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { dueBand } from './compliance-periods';
import {
  ComplianceGeneratorService,
  eventFinancialYear,
  type GenerateSummary,
} from './compliance-generator.service';
import {
  compactAttributes,
  dayBefore,
  istToday,
  profileAttributeErrors,
} from './compliance-profile';
import type {
  ComplianceCalendarV2QueryDto,
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
  event_type: string;
  financial_year: string | null;
  event_date: string;
  notes: string | null;
  recorded_by_name: string | null;
  created_at: Date;
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

function mapEvent(r: EventSqlRow): ComplianceEventRecord {
  return {
    id: r.id,
    engagementId: r.engagement_id,
    registrationId: r.registration_id,
    eventType: r.event_type,
    financialYear: r.financial_year,
    eventDate: r.event_date,
    notes: r.notes,
    recordedByName: r.recorded_by_name,
    createdAt: r.created_at.toISOString(),
  };
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
        `SELECT ev.id, ev.engagement_id, ev.registration_id, ev.event_type, ev.financial_year,
                ev.event_date::text, ev.notes, emp.full_name AS recorded_by_name, ev.created_at
           FROM hsdg.compliance_events ev
           LEFT JOIN hsdg.employees emp ON emp.id = ev.recorded_by_employee_id
          WHERE ev.engagement_id = $1
          ORDER BY ev.event_date DESC, ev.created_at DESC`,
        [engagementId],
      );
      return rows.map(mapEvent);
    });
  }

  async recordEvent(
    ctx: RlsContext,
    engagementId: string,
    input: RecordComplianceEventDto,
  ): Promise<RecordComplianceEventResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await this.assertLead(client, engagementId);
      if (eng.kind !== 'compliance') {
        throw new BadRequestException('Events are recorded on a Compliance engagement.');
      }
      if (input.registrationId) {
        const reg = await client.query(
          `SELECT 1 FROM hsdg.entity_compliance_registrations($1) WHERE id = $2`,
          [eng.entity_id, input.registrationId],
        );
        if (reg.rowCount === 0) {
          throw new BadRequestException('That registration does not belong to this client.');
        }
      }
      const eventDate = input.eventDate.slice(0, 10);
      const financialYear = input.financialYear ?? eventFinancialYear(input.eventType, eventDate);
      const { rows } = await client.query<EventSqlRow>(
        `INSERT INTO hsdg.compliance_events
           (engagement_id, registration_id, event_type, financial_year, event_date, notes,
            recorded_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, engagement_id, registration_id, event_type, financial_year,
                   event_date::text, notes, NULL::text AS recorded_by_name, created_at`,
        [
          engagementId,
          input.registrationId ?? null,
          input.eventType,
          financialYear,
          eventDate,
          input.notes ?? null,
          ctx.employeeId ?? null,
        ],
      );
      const event = rows[0]!;
      const created = await this.generator.createEventInstances(client, engagementId, {
        id: event.id,
        registration_id: event.registration_id,
        event_type: event.event_type,
        financial_year: financialYear,
        event_date: eventDate,
      });
      // Annual items that run from this event (AOC-4 / MGT-7 / ADT-1 from the
      // AGM) move from their provisional date on a regeneration of that year.
      const regen = await this.generator.generateForEngagement(client, engagementId, {
        financialYears: [financialYear],
      });
      await this.audit.recordWith(client, ctx, {
        action: 'compliance.event_recorded',
        objectType: 'engagement',
        objectId: engagementId,
        after: {
          eventId: event.id,
          eventType: input.eventType,
          eventDate,
          financialYear,
          created: created.length + regen.created,
          moved: regen.moved,
        },
      });
      const recorder = ctx.employeeId
        ? await client.query<{ full_name: string }>(
            `SELECT full_name FROM hsdg.employees WHERE id = $1`,
            [ctx.employeeId],
          )
        : null;
      return {
        event: mapEvent({ ...event, recorded_by_name: recorder?.rows[0]?.full_name ?? null }),
        created: created.length + regen.created,
        moved: regen.moved,
      };
    });
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
                ci.financial_year, ci.period_key,
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
