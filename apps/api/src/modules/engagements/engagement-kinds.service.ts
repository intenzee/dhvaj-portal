import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FIRM_CHECK,
  STATUTORY_AUDIT_SERVICE_CODE,
  STREAMS,
  STREAM_LABEL,
  STREAM_REGISTRATION_TYPES,
  type AddComplianceYearInput,
  type ComplianceEngagementYear,
  type ComplianceYearInput,
  type EngagementKind,
  type IndependenceCheckInput,
  type IndependenceCheckResult,
  type IndependenceFinding,
  type Stream,
  type StreamCatalogueEntry,
  type UpdateComplianceYearInput,
  type UpdateYearStreamsInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { ComplianceGeneratorService } from '../compliance/compliance-generator.service';
import { firmChecks, isStrict } from '../workflow-settings/firm-checks';
import {
  evaluateIndependence,
  independenceBlock,
  unacknowledged,
  type IndependenceFact,
} from './independence';
import { translatePgError } from './engagement-pg-error';

const S144_PERMITTED: readonly Stream[] = ['gst', 'tds', 'income_tax', 'roc'];
const STATUTORY_AUDIT_CODE = STATUTORY_AUDIT_SERVICE_CODE;

const KIND_SERVICE_MISMATCH: Record<EngagementKind, string> = {
  statutory_audit: 'A Statutory Audit engagement carries the Statutory Audit service only.',
  compliance:
    'A Compliance engagement carries stream services (GST, TDS, Income Tax, ROC, Bookkeeping, MIS) only.',
  assignment:
    'An assignment cannot carry the Statutory Audit or a stream service — create a Statutory Audit or ' +
    'Compliance engagement instead.',
};

interface YearRow {
  id: string;
  engagement_id: string;
  financial_year: string;
  streams: Stream[];
  stream_registrations: Partial<Record<Stream, string[]>>;
  fee_amount: string | null;
  billing_model: string | null;
  budget_hours: Partial<Record<Stream, number>>;
  engagement_letter_ref: string | null;
  engagement_letter_date: string | null;
  s144_approval_ref: string | null;
  status: 'open' | 'closed';
  closed_at: Date | null;
  version: number;
}

const YEAR_COLUMNS = `id, engagement_id, financial_year, streams, stream_registrations, fee_amount,
  billing_model, budget_hours, engagement_letter_ref, engagement_letter_date::text, s144_approval_ref,
  status, closed_at, version`;

/** What the creation flow needs to know about the client before it inserts. */
export interface KindContext {
  isCompany: boolean;
  facts: IndependenceFact[];
}

/** What a create request resolves to before the engagement row is written. */
export interface CreatePlan {
  kind: EngagementKind;
  /** The caller named the kind (the wizard) — warnings then need acknowledging. */
  explicit: boolean;
  serviceId: string;
  serviceCode: string;
  /** The engagement's financial year: the audited year, or the year of commencement. */
  financialYear: string;
  /** Compliance only. */
  streams: Stream[];
  years: ComplianceYearInput[];
  registrations: Partial<Record<Stream, string[]>>;
  findings: IndependenceFinding[];
}

export interface CreateKindRequest {
  kind?: EngagementKind;
  entityId: string;
  serviceId?: string;
  financialYear: string;
  years?: ComplianceYearInput[];
  streams?: Stream[];
  streamRegistrations?: Partial<Record<Stream, string[]>>;
  acknowledgedIndependenceRules?: string[];
}

/**
 * Engagement kinds (spec Change 1): the independence rules, the standing
 * Compliance engagement's years in scope and the streams on each year. The
 * create flow itself stays in EngagementsService, which calls in here inside
 * its transaction.
 */
@Injectable()
export class EngagementKindsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly generator: ComplianceGeneratorService,
  ) {}

  // ── client facts ────────────────────────────────────────────────────────

  /** Whether the client is a company, and every engagement fact the rules
   *  need (through hsdg.entity_independence_facts, past the caller's RLS). */
  async kindContext(client: PoolClient, entityId: string): Promise<KindContext> {
    const entity = await client.query<{ category: string | null }>(
      `SELECT et.category
         FROM hsdg.entities e
         LEFT JOIN hsdg.entity_types et ON et.id = e.entity_type_id
        WHERE e.id = $1`,
      [entityId],
    );
    if (!entity.rows[0]) throw new BadRequestException('Entity not found or not accessible.');
    const facts = await client.query<{
      engagement_id: string;
      engagement_code: string;
      financial_year: string;
      fact: IndependenceFact['fact'];
    }>(
      `SELECT engagement_id, engagement_code, financial_year, fact
         FROM hsdg.entity_independence_facts($1)`,
      [entityId],
    );
    return {
      isCompany: entity.rows[0].category === 'company',
      facts: facts.rows.map((f) => ({
        engagementId: f.engagement_id,
        engagementCode: f.engagement_code,
        financialYear: f.financial_year,
        fact: f.fact,
      })),
    };
  }

  /** The client's open Compliance engagement, if any. */
  openCompliance(facts: readonly IndependenceFact[], except?: string) {
    const f = facts.find((x) => x.fact === 'compliance' && x.engagementId !== except);
    return f ? { id: f.engagementId, engagementCode: f.engagementCode } : null;
  }

  /** 409 when a hard rule blocks; 409 when a warning needs an acknowledgement
   *  the caller did not give (only when `requireAcknowledgement`). Hard ICAI
   *  blocks apply whatever the firm's checks say. */
  enforce(
    findings: IndependenceFinding[],
    acknowledged: readonly string[] | undefined,
    requireAcknowledgement: boolean,
  ): void {
    const block = independenceBlock(findings);
    if (block) {
      throw new ConflictException({
        statusCode: 409,
        message: block.message,
        rule: block.rule,
        findings,
      });
    }
    const pending = requireAcknowledgement ? unacknowledged(findings, acknowledged) : [];
    if (pending.length) {
      throw new ConflictException({
        statusCode: 409,
        message: `${pending[0]!.message} Tick the acknowledgement to continue.`,
        rule: 'ACKNOWLEDGEMENT_REQUIRED',
        findings,
      });
    }
  }

  /** Whether warnings need a partner's tick before the work goes ahead — off,
   *  they are shown and recorded for information only. */
  async acknowledgementRequired(client: PoolClient): Promise<boolean> {
    return isStrict(await firmChecks(client), FIRM_CHECK.independenceAckRequired);
  }

  /** Store the outcomes on the engagement; an acknowledged warning carries who
   *  ticked it (shown in Activity). Only a partner may acknowledge: while the
   *  independence_ack_required check is off, anyone else's tick is not taken
   *  and the warning is recorded unacknowledged. */
  async recordChecks(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    findings: readonly IndependenceFinding[],
    acknowledged: readonly string[] = [],
  ): Promise<void> {
    let acks = findings.filter((f) => f.requiresAcknowledgement && acknowledged.includes(f.rule));
    if (acks.length && !(await this.callerIsPartner(client, ctx))) {
      if (await this.acknowledgementRequired(client)) {
        throw new ForbiddenException('Only a partner can give this acknowledgement.');
      }
      acks = [];
    }
    for (const f of findings) {
      const acked = acks.includes(f);
      await client.query(
        `INSERT INTO hsdg.engagement_independence_checks
           (engagement_id, rule_code, outcome, message, financial_year,
            acknowledged_by_employee_id, acknowledged_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          engagementId,
          f.rule,
          f.outcome,
          f.message,
          f.financialYear ?? null,
          acked ? ctx.employeeId : null,
          acked ? new Date() : null,
        ],
      );
    }
    if (acks.length) {
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.independence_acknowledged',
        objectType: 'engagement',
        objectId: engagementId,
        after: { rules: acks.map((f) => f.rule) },
      });
    }
  }

  private async callerIsPartner(client: PoolClient, ctx: RlsContext): Promise<boolean> {
    if (!ctx.employeeId) return false;
    const { rows } = await client.query<{ is_partner: boolean }>(
      `SELECT g.is_partner_grade AS is_partner
         FROM hsdg.employees e JOIN hsdg.grades g ON g.id = e.grade_id
        WHERE e.id = $1`,
      [ctx.employeeId],
    );
    return rows[0]?.is_partner === true;
  }

  // ── catalogue ───────────────────────────────────────────────────────────

  /** The six live stream services, in tab order. */
  async streamServices(client: PoolClient): Promise<StreamCatalogueEntry[]> {
    const { rows } = await client.query<{ id: string; code: string; name: string; stream: Stream }>(
      `SELECT id, code, name, stream FROM hsdg.services
        WHERE stream IS NOT NULL AND folded_into_service_id IS NULL AND is_active`,
    );
    const byStream = new Map(rows.map((r) => [r.stream, r]));
    return STREAMS.filter((s) => byStream.has(s)).map((s) => {
      const r = byStream.get(s)!;
      return {
        stream: s,
        label: STREAM_LABEL[s],
        serviceId: r.id,
        serviceCode: r.code,
        serviceName: r.name,
        registrationTypes: STREAM_REGISTRATION_TYPES[s],
      };
    });
  }

  async listStreams(ctx: RlsContext): Promise<StreamCatalogueEntry[]> {
    return this.db.withRlsContext(ctx, (client) => this.streamServices(client));
  }

  /** What a catalogue service makes an engagement (mirrors the kind trigger). */
  async serviceKind(
    client: PoolClient,
    serviceId: string,
  ): Promise<{ id: string; kind: EngagementKind; code: string; stream: Stream | null }> {
    const { rows } = await client.query<{ code: string; stream: Stream | null }>(
      `SELECT code, stream FROM hsdg.services WHERE id = $1`,
      [serviceId],
    );
    const s = rows[0];
    if (!s) throw new BadRequestException('Service not found.');
    const kind: EngagementKind =
      s.code === STATUTORY_AUDIT_CODE ? 'statutory_audit' : s.stream ? 'compliance' : 'assignment';
    return { id: serviceId, kind, code: s.code, stream: s.stream };
  }

  // ── preview ─────────────────────────────────────────────────────────────

  async checkIndependence(
    ctx: RlsContext,
    input: IndependenceCheckInput,
  ): Promise<IndependenceCheckResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const kc = await this.kindContext(client, input.entityId);
      const serviceCodes = input.serviceId
        ? [(await this.serviceKind(client, input.serviceId)).code]
        : [];
      const findings = evaluateIndependence(
        {
          isCompany: kc.isCompany,
          kind: input.kind,
          financialYears: input.financialYears,
          streams: input.streams,
          serviceCodes,
          s144ApprovalRef: input.s144ApprovalRef,
          engagementId: input.engagementId,
        },
        kc.facts,
      );
      return {
        isCompany: kc.isCompany,
        findings,
        block: independenceBlock(findings),
        openComplianceEngagement:
          input.kind === 'compliance' ? this.openCompliance(kc.facts, input.engagementId) : null,
      };
    });
  }

  // ── create flow, called by createEngagement inside its transaction ──────

  /**
   * Resolve a create request: the kind (stated, or derived from the service as
   * before), the service the engagement carries, and — for Compliance — the
   * streams and years in scope. Runs the independence rules and refuses a
   * second open Compliance engagement for the client.
   */
  async planCreate(client: PoolClient, input: CreateKindRequest): Promise<CreatePlan> {
    const explicit = input.kind !== undefined;
    let service = input.serviceId ? await this.serviceKind(client, input.serviceId) : null;
    const kind: EngagementKind = input.kind ?? service?.kind ?? 'assignment';
    if (!service && kind !== 'compliance') {
      if (kind === 'assignment')
        throw new BadRequestException('Pick the service for the assignment.');
      service = await this.serviceByCode(client, STATUTORY_AUDIT_CODE);
    }
    if (service && service.kind !== kind) {
      throw new BadRequestException(KIND_SERVICE_MISMATCH[kind]);
    }

    let streams: Stream[] = [];
    let years: ComplianceYearInput[] = [];
    if (kind === 'compliance') {
      const wanted = new Set<Stream>([
        ...(input.streams ?? []),
        ...(service?.stream ? [service.stream] : []),
      ]);
      streams = STREAMS.filter((s) => wanted.has(s));
      if (streams.length === 0) throw new BadRequestException('Pick at least one stream.');
      if (!service) {
        const first = (await this.streamServices(client)).find((s) => s.stream === streams[0]);
        if (!first)
          throw new BadRequestException(`The ${STREAM_LABEL[streams[0]!]} stream is not set up.`);
        service = { kind, code: first.serviceCode, stream: first.stream, id: first.serviceId };
      }
      years = [...(input.years ?? [{ financialYear: input.financialYear }])].sort((a, b) =>
        a.financialYear.localeCompare(b.financialYear),
      );
      if (new Set(years.map((y) => y.financialYear)).size !== years.length) {
        throw new BadRequestException('A financial year is listed twice.');
      }
    } else if (input.years?.length || input.streams?.length) {
      throw new BadRequestException(
        'Years and streams in scope belong to Compliance engagements only.',
      );
    }

    const kc = await this.kindContext(client, input.entityId);
    if (kind === 'compliance') {
      const open = this.openCompliance(kc.facts);
      if (open) {
        throw new ConflictException({
          statusCode: 409,
          message:
            `This client already has an open Compliance engagement (${open.engagementCode}) — ` +
            'add a year or stream to it instead.',
          rule: 'COMPLIANCE_ENGAGEMENT_EXISTS',
          engagementId: open.id,
          engagementCode: open.engagementCode,
        });
      }
    }
    const base = { isCompany: kc.isCompany, kind, streams, serviceCodes: [service!.code] };
    const findings =
      kind === 'compliance'
        ? years.flatMap((y) =>
            evaluateIndependence(
              { ...base, financialYears: [y.financialYear], s144ApprovalRef: y.s144ApprovalRef },
              kc.facts,
            ),
          )
        : evaluateIndependence({ ...base, financialYears: [input.financialYear] }, kc.facts);
    this.enforce(
      findings,
      input.acknowledgedIndependenceRules,
      explicit && (await this.acknowledgementRequired(client)),
    );

    return {
      kind,
      explicit,
      serviceId: service!.id,
      serviceCode: service!.code,
      financialYear: kind === 'compliance' ? years[0]!.financialYear : input.financialYear,
      streams,
      years,
      registrations:
        kind === 'compliance'
          ? await this.validateRegistrations(
              client,
              input.entityId,
              streams,
              input.streamRegistrations,
            )
          : {},
      findings,
    };
  }

  /** After the engagement row exists: stream lines, years in scope, the
   *  calendar (explicit-kind creates only), and the stored independence
   *  outcomes. */
  async completeCreate(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    officeId: string,
    lineStatus: string,
    plan: CreatePlan,
    streamLeads: Partial<Record<string, string>> | undefined,
    acknowledged: readonly string[] | undefined,
  ): Promise<void> {
    if (plan.kind === 'compliance') {
      await this.ensureStreamLines(
        client,
        engagementId,
        officeId,
        lineStatus,
        plan.streams,
        streamLeads,
      );
      for (const year of plan.years) {
        try {
          await this.insertYear(client, engagementId, year, plan.streams, plan.registrations);
        } catch (err) {
          throw yearPgError(err);
        }
      }
      // A create that names its kind is the new flow and builds the calendar
      // now; a legacy create (service only) keeps its old contract — the
      // calendar is generated when asked for.
      if (plan.explicit) {
        await this.generate(
          client,
          engagementId,
          plan.years.map((y) => y.financialYear),
        );
      }
    }
    await this.recordChecks(client, ctx, engagementId, plan.findings, acknowledged);
  }

  private async serviceByCode(client: PoolClient, code: string) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.services WHERE code = $1`,
      [code],
    );
    if (!rows[0]) throw new BadRequestException(`Service ${code} is not set up.`);
    return this.serviceKind(client, rows[0].id);
  }

  // ── Compliance scope ──────────────────────────────────────────────────

  /** Validate {stream: registration ids} against the client's registrations
   *  and the stream's registration types. Missing streams are left absent (the
   *  generator then runs on every matching registration). */
  async validateRegistrations(
    client: PoolClient,
    entityId: string,
    streams: readonly Stream[],
    given: Partial<Record<string, string[]>> | undefined,
  ): Promise<Partial<Record<Stream, string[]>>> {
    if (!given) return {};
    const unknown = Object.keys(given).filter((k) => !STREAMS.includes(k as Stream));
    if (unknown.length) throw new BadRequestException(`Unknown stream ${unknown.join(', ')}.`);
    const regs = await client.query<{ id: string; registration_type: string }>(
      `SELECT id, registration_type FROM hsdg.entity_compliance_registrations($1)`,
      [entityId],
    );
    const typeOf = new Map(regs.rows.map((r) => [r.id, r.registration_type]));
    const out: Partial<Record<Stream, string[]>> = {};
    for (const [key, ids] of Object.entries(given)) {
      const stream = key as Stream;
      if (!streams.includes(stream)) {
        throw new BadRequestException(
          `Registrations given for ${STREAM_LABEL[stream]}, which is not selected.`,
        );
      }
      if (!Array.isArray(ids))
        throw new BadRequestException(`${stream} registrations must be a list.`);
      for (const id of ids) {
        const type = typeOf.get(id);
        if (!type || !STREAM_REGISTRATION_TYPES[stream].includes(type)) {
          throw new BadRequestException(
            `Registration ${id} is not one of this client's ${STREAM_REGISTRATION_TYPES[stream].join(' / ').toUpperCase()} registrations.`,
          );
        }
      }
      out[stream] = [...new Set(ids)];
    }
    return out;
  }

  /** Make sure the engagement has a live line for each stream (adding the
   *  stream service where missing), setting the given leads. */
  async ensureStreamLines(
    client: PoolClient,
    engagementId: string,
    officeId: string,
    lineStatus: string,
    streams: readonly Stream[],
    leads: Partial<Record<string, string>> = {},
  ): Promise<void> {
    const catalogue = new Map((await this.streamServices(client)).map((s) => [s.stream, s]));
    const lines = await client.query<{
      id: string;
      stream: Stream;
      lead_employee_id: string | null;
    }>(
      `SELECT DISTINCT ON (COALESCE(s.stream, live.stream))
              es.id, COALESCE(s.stream, live.stream) AS stream, es.lead_employee_id
         FROM hsdg.engagement_services es
         JOIN hsdg.services s ON s.id = es.service_id
         LEFT JOIN hsdg.services live ON live.id = s.folded_into_service_id
        WHERE es.engagement_id = $1 AND es.status <> 'cancelled'
          AND COALESCE(s.stream, live.stream) IS NOT NULL
        ORDER BY COALESCE(s.stream, live.stream), es.is_primary DESC, es.created_at`,
      [engagementId],
    );
    const byStream = new Map(lines.rows.map((l) => [l.stream, l]));
    for (const stream of streams) {
      const lead = leads[stream] ?? null;
      const line = byStream.get(stream);
      if (line) {
        if (lead && lead !== line.lead_employee_id) {
          await client.query(
            `UPDATE hsdg.engagement_services SET lead_employee_id = $2 WHERE id = $1`,
            [line.id, lead],
          );
        }
        continue;
      }
      const svc = catalogue.get(stream);
      if (!svc) throw new BadRequestException(`The ${STREAM_LABEL[stream]} stream is not set up.`);
      await client.query(
        `INSERT INTO hsdg.engagement_services
           (engagement_id, service_id, office_id, lead_employee_id, is_primary, status)
         VALUES ($1, $2, $3, $4, false, $5)`,
        [engagementId, svc.serviceId, officeId, lead, lineStatus],
      );
    }
  }

  async insertYear(
    client: PoolClient,
    engagementId: string,
    year: ComplianceYearInput,
    streams: readonly Stream[],
    registrations: Partial<Record<Stream, string[]>>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.compliance_engagement_years
         (engagement_id, financial_year, streams, stream_registrations, fee_amount, billing_model,
          budget_hours, engagement_letter_ref, engagement_letter_date, s144_approval_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        engagementId,
        year.financialYear,
        streams,
        JSON.stringify(registrations),
        year.feeAmount ?? null,
        year.billingModel ?? null,
        JSON.stringify(validBudget(year.budgetHours, streams)),
        blank(year.engagementLetterRef),
        year.engagementLetterDate ?? null,
        blank(year.s144ApprovalRef),
      ],
    );
  }

  /** Build the calendar for the new years (Change 4 generator). */
  async generate(client: PoolClient, engagementId: string, years: string[]): Promise<void> {
    await this.generator.generateForEngagement(client, engagementId, { financialYears: years });
  }

  // ── years in scope ──────────────────────────────────────────────────────

  async listYears(ctx: RlsContext, engagementId: string): Promise<ComplianceEngagementYear[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await this.loadCompliance(client, engagementId);
      const kc = await this.kindContext(client, eng.entity_id);
      const { rows } = await client.query<YearRow>(
        `SELECT ${YEAR_COLUMNS} FROM hsdg.compliance_engagement_years
          WHERE engagement_id = $1 ORDER BY financial_year`,
        [engagementId],
      );
      return rows.map((r) => this.mapYear(r, kc));
    });
  }

  async addYear(
    ctx: RlsContext,
    engagementId: string,
    input: AddComplianceYearInput,
  ): Promise<ComplianceEngagementYear> {
    return this.db.withRlsContext(ctx, (client) =>
      this.addYearWith(client, ctx, engagementId, input),
    );
  }

  /** addYear on the caller's transaction (the client import adds a GST year). */
  async addYearWith(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    input: AddComplianceYearInput,
  ): Promise<ComplianceEngagementYear> {
    const eng = await this.loadCompliance(client, engagementId);
    const latest = await client.query<YearRow>(
      `SELECT ${YEAR_COLUMNS} FROM hsdg.compliance_engagement_years
        WHERE engagement_id = $1 ORDER BY financial_year DESC LIMIT 1`,
      [engagementId],
    );
    const streams = input.streams ?? latest.rows[0]?.streams ?? [];
    if (streams.length === 0)
      throw new BadRequestException('Pick at least one stream for the year.');
    const registrations = input.streamRegistrations
      ? await this.validateRegistrations(client, eng.entity_id, streams, input.streamRegistrations)
      : pick(latest.rows[0]?.stream_registrations ?? {}, streams);

    const kc = await this.kindContext(client, eng.entity_id);
    const findings = evaluateIndependence(
      {
        isCompany: kc.isCompany,
        kind: 'compliance',
        financialYears: [input.financialYear],
        streams,
        s144ApprovalRef: input.s144ApprovalRef,
        engagementId,
      },
      kc.facts,
    );
    this.enforce(
      findings,
      input.acknowledgedIndependenceRules,
      await this.acknowledgementRequired(client),
    );

    await this.ensureStreamLines(client, engagementId, eng.office_id, 'active', streams);
    try {
      await this.insertYear(client, engagementId, input, streams, registrations);
    } catch (err) {
      throw yearPgError(err);
    }
    await this.recordChecks(
      client,
      ctx,
      engagementId,
      findings,
      input.acknowledgedIndependenceRules,
    );
    await this.generate(client, engagementId, [input.financialYear]);
    await this.audit.recordWith(client, ctx, {
      action: 'engagement.year_added',
      objectType: 'engagement',
      objectId: engagementId,
      after: { financialYear: input.financialYear, streams },
    });
    return this.yearOrThrow(client, engagementId, input.financialYear, kc);
  }

  async updateYear(
    ctx: RlsContext,
    engagementId: string,
    fy: string,
    input: UpdateComplianceYearInput,
  ): Promise<ComplianceEngagementYear> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await this.loadCompliance(client, engagementId);
      const kc = await this.kindContext(client, eng.entity_id);
      const before = await this.yearOrThrow(client, engagementId, fy, kc);

      const sets: string[] = [];
      const params: unknown[] = [engagementId, fy, input.version];
      const set = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.feeAmount !== undefined) set('fee_amount', input.feeAmount);
      if (input.billingModel !== undefined) set('billing_model', input.billingModel);
      if (input.budgetHours !== undefined) {
        set('budget_hours', JSON.stringify(validBudget(input.budgetHours, before.streams)));
      }
      if (input.engagementLetterRef !== undefined)
        set('engagement_letter_ref', blank(input.engagementLetterRef));
      if (input.engagementLetterDate !== undefined)
        set('engagement_letter_date', input.engagementLetterDate);
      if (input.s144ApprovalRef !== undefined)
        set('s144_approval_ref', blank(input.s144ApprovalRef));
      if (input.status !== undefined && input.status !== before.status) {
        set('status', input.status);
        if (input.status === 'closed') {
          sets.push('closed_at = now()');
          set('closed_by_employee_id', ctx.employeeId ?? null);
        } else {
          sets.push('closed_at = NULL', 'closed_by_employee_id = NULL');
        }
      }
      if (sets.length === 0) return before;

      let updated: number;
      try {
        const r = await client.query(
          `UPDATE hsdg.compliance_engagement_years
              SET ${sets.join(', ')}, version = version + 1
            WHERE engagement_id = $1 AND financial_year = $2 AND version = $3`,
          params,
        );
        updated = r.rowCount ?? 0;
      } catch (err) {
        throw yearPgError(err);
      }
      if (updated === 0) await this.staleOrForbidden(client, engagementId, fy, input.version);
      // A reopened year gets its calendar back.
      if (input.status === 'open' && before.status === 'closed') {
        await this.generate(client, engagementId, [fy]);
      }
      const after = await this.yearOrThrow(client, engagementId, fy, kc);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.year_updated',
        objectType: 'engagement',
        objectId: engagementId,
        before,
        after,
      });
      return after;
    });
  }

  async updateYearStreams(
    ctx: RlsContext,
    engagementId: string,
    fy: string,
    input: UpdateYearStreamsInput,
  ): Promise<ComplianceEngagementYear> {
    return this.db.withRlsContext(ctx, (client) =>
      this.updateYearStreamsWith(client, ctx, engagementId, fy, input),
    );
  }

  /** updateYearStreams on the caller's transaction (the client import adds GST). */
  async updateYearStreamsWith(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    fy: string,
    input: UpdateYearStreamsInput,
  ): Promise<ComplianceEngagementYear> {
    const eng = await this.loadCompliance(client, engagementId);
    const kc = await this.kindContext(client, eng.entity_id);
    const before = await this.yearOrThrow(client, engagementId, fy, kc);
    const add = (input.add ?? []).filter((s) => !before.streams.includes(s));
    const end = new Set(input.end ?? []);
    if ((input.add ?? []).some((s) => end.has(s))) {
      throw new BadRequestException('A stream cannot be added and ended at once.');
    }
    const streams = STREAMS.filter(
      (s) => (before.streams.includes(s) || add.includes(s)) && !end.has(s),
    );
    if (streams.length === 0) {
      throw new BadRequestException('A year keeps at least one stream — close the year instead.');
    }

    const findings = add.length
      ? evaluateIndependence(
          {
            isCompany: kc.isCompany,
            kind: 'compliance',
            financialYears: [fy],
            streams: add,
            s144ApprovalRef: before.s144ApprovalRef,
            engagementId,
          },
          kc.facts,
        )
      : [];
    this.enforce(
      findings,
      input.acknowledgedIndependenceRules,
      await this.acknowledgementRequired(client),
    );

    const given = input.streamRegistrations
      ? await this.validateRegistrations(client, eng.entity_id, streams, input.streamRegistrations)
      : {};
    const registrations = { ...pick(before.streamRegistrations, streams), ...given };

    await this.ensureStreamLines(
      client,
      engagementId,
      eng.office_id,
      'active',
      add,
      input.streamLeads,
    );
    const r = await client.query(
      `UPDATE hsdg.compliance_engagement_years
          SET streams = $4, stream_registrations = $5, version = version + 1
        WHERE engagement_id = $1 AND financial_year = $2 AND version = $3`,
      [engagementId, fy, input.version, streams, JSON.stringify(registrations)],
    );
    if ((r.rowCount ?? 0) === 0)
      await this.staleOrForbidden(client, engagementId, fy, input.version);
    await this.recordChecks(
      client,
      ctx,
      engagementId,
      findings,
      input.acknowledgedIndependenceRules,
    );
    const ended = before.streams.filter((s) => end.has(s));
    await this.generator.endStreams(client, engagementId, fy, ended);
    if (before.status === 'open') await this.generate(client, engagementId, [fy]);
    const after = await this.yearOrThrow(client, engagementId, fy, kc);
    await this.audit.recordWith(client, ctx, {
      action: 'engagement.year_streams_changed',
      objectType: 'engagement',
      objectId: engagementId,
      before: { streams: before.streams },
      after: { streams: after.streams, added: add, ended },
    });
    return after;
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async loadCompliance(
    client: PoolClient,
    engagementId: string,
  ): Promise<{ entity_id: string; office_id: string }> {
    const { rows } = await client.query<{ kind: string; entity_id: string; office_id: string }>(
      `SELECT kind, entity_id, office_id FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Engagement not found.');
    if (rows[0].kind !== 'compliance') {
      throw new BadRequestException('Years in scope belong to Compliance engagements only.');
    }
    return rows[0];
  }

  private async yearOrThrow(
    client: PoolClient,
    engagementId: string,
    fy: string,
    kc: KindContext,
  ): Promise<ComplianceEngagementYear> {
    const { rows } = await client.query<YearRow>(
      `SELECT ${YEAR_COLUMNS} FROM hsdg.compliance_engagement_years
        WHERE engagement_id = $1 AND financial_year = $2`,
      [engagementId, fy],
    );
    if (!rows[0]) throw new NotFoundException(`FY ${fy} is not in scope on this engagement.`);
    return this.mapYear(rows[0], kc);
  }

  private async staleOrForbidden(
    client: PoolClient,
    engagementId: string,
    fy: string,
    version: number,
  ): Promise<never> {
    const { rows } = await client.query<{ version: number }>(
      `SELECT version FROM hsdg.compliance_engagement_years
        WHERE engagement_id = $1 AND financial_year = $2`,
      [engagementId, fy],
    );
    if (rows[0] && rows[0].version !== version) {
      throw new ConflictException('The year was changed by someone else. Refresh and retry.');
    }
    throw new ForbiddenException('Only the engagement partner or manager can change the scope.');
  }

  private mapYear(r: YearRow, kc: KindContext): ComplianceEngagementYear {
    const audited = kc.facts.some(
      (f) => f.fact === 'statutory_audit' && f.financialYear === r.financial_year,
    );
    return {
      id: r.id,
      engagementId: r.engagement_id,
      financialYear: r.financial_year,
      streams: STREAMS.filter((s) => r.streams.includes(s)),
      streamRegistrations: r.stream_registrations,
      feeAmount: r.fee_amount === null ? null : Number(r.fee_amount),
      billingModel: r.billing_model,
      budgetHours: r.budget_hours,
      engagementLetterRef: r.engagement_letter_ref,
      engagementLetterDate: r.engagement_letter_date,
      s144ApprovalRef: r.s144_approval_ref,
      status: r.status,
      closedAt: r.closed_at ? r.closed_at.toISOString() : null,
      version: r.version,
      s144ApprovalMissing:
        kc.isCompany &&
        audited &&
        !r.s144_approval_ref &&
        r.streams.some((s) => S144_PERMITTED.includes(s)),
    };
  }
}

function blank(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function pick<T>(
  m: Partial<Record<Stream, T>>,
  streams: readonly Stream[],
): Partial<Record<Stream, T>> {
  return Object.fromEntries(
    Object.entries(m).filter(([k]) => streams.includes(k as Stream)),
  ) as Partial<Record<Stream, T>>;
}

/** {stream: hours} for selected streams, non-negative numbers only. */
export function validBudget(
  budget: Partial<Record<string, number>> | undefined,
  streams: readonly Stream[],
): Partial<Record<Stream, number>> {
  const out: Partial<Record<Stream, number>> = {};
  for (const [k, v] of Object.entries(budget ?? {})) {
    if (!streams.includes(k as Stream)) {
      throw new BadRequestException(`Budget hours given for ${k}, which is not in scope.`);
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new BadRequestException(`Budget hours for ${k} must be a non-negative number.`);
    }
    out[k as Stream] = v;
  }
  return out;
}

function yearPgError(err: unknown): Error {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23505' && e.constraint === 'compliance_engagement_years_unique') {
    return new ConflictException('That financial year is already in scope.');
  }
  return translatePgError(err);
}
