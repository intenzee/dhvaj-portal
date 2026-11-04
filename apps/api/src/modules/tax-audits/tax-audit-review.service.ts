import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  TAX_AUDIT_REVIEW_LEVEL_LABEL,
  TAX_AUDIT_REVIEW_LEVELS,
  nextReviewLevel,
  reportObservations,
  reviewLevelRank,
  signingBlockers,
  startReviewBlockers,
  type DecideTaxAuditObservationInput,
  type EditTaxAuditObservationInput,
  type FlagTaxAuditObservationInput,
  type RaiseTaxAuditReviewPointInput,
  type RespondTaxAuditReviewPointInput,
  type SignOffTaxAuditReviewInput,
  type TaxAuditObservation,
  type TaxAuditObservationKind,
  type TaxAuditObservationStatus,
  type TaxAuditReview,
  type TaxAuditReviewLevel,
  type TaxAuditReviewPoint,
  type TaxAuditReviewPointStatus,
  type TaxAuditReviewSignoff,
  type TaxAuditStage,
  type TaxAuditVersionInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

/** Roles that review at Senior level or above (an Admin is not a grade). */
const SENIOR_UP = ['senior', 'manager', 'partner', 'managing_partner'];
const MANAGER_UP = ['manager', 'partner', 'managing_partner'];
const SIGNED: readonly TaxAuditStage[] = ['signed', 'uploaded', 'client_accepted', 'filed'];

interface AuditRow {
  id: string;
  engagement_id: string;
  financial_year: string;
  stage: TaxAuditStage;
  signing_partner_id: string | null;
  signing_partner_name: string | null;
  clause_work_opened_at: Date | null;
  version: number;
}

interface PointRow {
  id: string;
  working_paper_id: string | null;
  clause_no: string | null;
  level: TaxAuditReviewLevel;
  body: string;
  status: TaxAuditReviewPointStatus;
  raised_by_employee_id: string | null;
  raised_by_name: string | null;
  created_at: Date;
  response: string | null;
  responded_by_name: string | null;
  responded_at: Date | null;
  cleared_by_name: string | null;
  cleared_at: Date | null;
  version: number;
}

interface ObservationRow {
  id: string;
  working_paper_id: string | null;
  clause_no: string | null;
  wording: string;
  status: TaxAuditObservationStatus;
  kind: TaxAuditObservationKind | null;
  decision_note: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  raised_by_employee_id: string | null;
  raised_by_name: string | null;
  created_at: Date;
  version: number;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * The level someone reviews a tax audit at: the audit's signing Partner at
 * Partner level; the engagement's partner or manager at Manager level; any
 * other Senior or above at Senior level.
 */
export function reviewLevelOf(
  p: { employeeId: string | null | undefined; role: string; lead: boolean },
  signingPartnerId: string | null,
): TaxAuditReviewLevel | null {
  if (p.employeeId && p.employeeId === signingPartnerId) return 'partner';
  if (p.lead && MANAGER_UP.includes(p.role)) return 'manager';
  if (SENIOR_UP.includes(p.role)) return 'senior';
  return null;
}

/**
 * Take away the active sign-offs from a level up: a point raised there, a
 * clause reopened or a new flag means those levels look again.
 */
export async function supersedeSignoffs(
  client: PoolClient,
  auditId: string,
  from: TaxAuditReviewLevel,
  reason: string,
): Promise<void> {
  const levels = TAX_AUDIT_REVIEW_LEVELS.filter((l) => reviewLevelRank(l) >= reviewLevelRank(from));
  await client.query(
    `UPDATE hsdg.tax_audit_review_signoffs
        SET superseded_at = now(), superseded_reason = $3
      WHERE tax_audit_id = $1 AND level = ANY($2::text[]) AND superseded_at IS NULL`,
    [auditId, levels, reason],
  );
}

/**
 * Tax Audit review (Phase 5, F-7). Once every clause is done or Not
 * applicable the 3CD goes for review: Senior, then Manager, then the signing
 * Partner, each signing off once the points raised at their level are
 * cleared. Points follow the statutory audit's review notes (open →
 * responded → cleared). Matters that may need reporting are flagged into the
 * observations register and the signing Partner decides each: a
 * qualification, an observation, or dropped. The Partner's sign-off needs
 * nothing open anywhere; F-8's signing needs that sign-off.
 */
@Injectable()
export class TaxAuditReviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  get(ctx: RlsContext, engagementId: string, auditId: string): Promise<TaxAuditReview> {
    return this.db.withRlsContext(ctx, (client) => this.view(client, ctx, engagementId, auditId));
  }

  /** The 3CD goes for review once every clause is done or Not applicable. */
  async start(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: TaxAuditVersionInput,
  ): Promise<TaxAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.row(client, engagementId, auditId, true);
      this.checkVersion(a.version, input.version);
      if (a.stage !== 'clause_work' || !a.clause_work_opened_at) {
        throw new BadRequestException(
          a.stage === 'review' ? 'The 3CD is already in review.' : 'Open the 3CD work first.',
        );
      }
      const lead = await this.isLead(client, engagementId);
      if (!lead && !this.levelOf(ctx, lead, a)) {
        throw new ForbiddenException(
          'A Senior or above on the engagement sends the 3CD for review.',
        );
      }
      const blockers = startReviewBlockers(await this.unsettled(client, auditId));
      if (blockers.length) throw new BadRequestException(blockers.join(' '));
      await client.query(
        `UPDATE hsdg.tax_audits SET stage = 'review', version = version + 1 WHERE id = $1`,
        [auditId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.review_started',
        objectType: 'tax_audit',
        objectId: auditId,
        before: { stage: a.stage },
        after: { stage: 'review' },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  async signOff(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: SignOffTaxAuditReviewInput,
  ): Promise<TaxAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.row(client, engagementId, auditId, true);
      this.checkVersion(a.version, input.version);
      if (a.stage !== 'review') throw new BadRequestException('The 3CD is not in review.');
      const lead = await this.isLead(client, engagementId);
      const signoffs = await this.signoffs(client, auditId);
      const allowed = this.signOffLevel(ctx, lead, a, signoffs);
      if (allowed !== input.level) {
        const next = nextReviewLevel(signoffs.map((s) => s.level));
        throw new ForbiddenException(
          next && next !== input.level
            ? `${TAX_AUDIT_REVIEW_LEVEL_LABEL[next]} comes first.`
            : input.level === 'partner'
              ? 'Only the audit’s signing Partner signs off the Partner review.'
              : 'You do not review at this level, or you signed off another level already.',
        );
      }
      const points = await this.points(client, auditId);
      const open = points.filter((p) => p.status !== 'cleared');
      if (input.level === 'partner') {
        const blockers = await this.blockers(client, auditId, open.length, true);
        if (blockers.length) throw new BadRequestException(blockers.join(' '));
      } else {
        const mine = open.filter((p) => p.level === input.level).length;
        if (mine) {
          throw new BadRequestException(
            `Clear the ${mine} open point(s) raised at ${TAX_AUDIT_REVIEW_LEVEL_LABEL[input.level]} first.`,
          );
        }
      }
      await client.query(
        `INSERT INTO hsdg.tax_audit_review_signoffs (tax_audit_id, engagement_id, level, employee_id)
         VALUES ($1, $2, $3, $4)`,
        [auditId, engagementId, input.level, ctx.employeeId],
      );
      await client.query(`UPDATE hsdg.tax_audits SET version = version + 1 WHERE id = $1`, [
        auditId,
      ]);
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.review_signed_off',
        objectType: 'tax_audit',
        objectId: auditId,
        after: { level: input.level },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  async raisePoint(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: RaiseTaxAuditReviewPointInput,
  ): Promise<TaxAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.row(client, engagementId, auditId, true);
      this.requireOpen(a);
      const level = this.levelOf(ctx, await this.isLead(client, engagementId), a);
      if (!level) throw new ForbiddenException('A Senior or above raises review points.');
      await this.requirePaper(client, auditId, input.workingPaperId);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.tax_audit_review_points
           (tax_audit_id, engagement_id, working_paper_id, level, body, raised_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          auditId,
          engagementId,
          input.workingPaperId ?? null,
          level,
          input.body.trim(),
          ctx.employeeId,
        ],
      );
      await supersedeSignoffs(client, auditId, level, 'A review point was raised.');
      await client.query(`UPDATE hsdg.tax_audits SET version = version + 1 WHERE id = $1`, [
        auditId,
      ]);
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.review_point_raised',
        objectType: 'tax_audit_review_point',
        objectId: rows[0]!.id,
        after: { auditId, level, workingPaperId: input.workingPaperId ?? null },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  async respond(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    pointId: string,
    input: RespondTaxAuditReviewPointInput,
  ): Promise<TaxAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.row(client, engagementId, auditId);
      this.requireOpen(a);
      const p = await this.point(client, auditId, pointId, input.version);
      if (p.status === 'cleared') throw new BadRequestException('The point is cleared.');
      if (p.raised_by_employee_id === ctx.employeeId) {
        throw new ForbiddenException('Someone other than the reviewer who raised it responds.');
      }
      await client.query(
        `UPDATE hsdg.tax_audit_review_points
            SET status = 'responded', response = $2, responded_by_employee_id = $3,
                responded_at = now(), version = version + 1
          WHERE id = $1`,
        [pointId, input.response.trim(), ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.review_point_responded',
        objectType: 'tax_audit_review_point',
        objectId: pointId,
        before: { status: p.status },
        after: { status: 'responded' },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  async clear(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    pointId: string,
    input: TaxAuditVersionInput,
  ): Promise<TaxAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.row(client, engagementId, auditId);
      this.requireOpen(a);
      const p = await this.point(client, auditId, pointId, input.version);
      if (p.status === 'cleared') throw new BadRequestException('The point is already cleared.');
      const lead = await this.isLead(client, engagementId);
      if (!this.canClear(ctx, lead, a, p)) {
        throw new ForbiddenException(
          'The reviewer who raised the point, someone reviewing above them, or the engagement’s partner or manager clears it.',
        );
      }
      await client.query(
        `UPDATE hsdg.tax_audit_review_points
            SET status = 'cleared', cleared_by_employee_id = $2, cleared_at = now(),
                response = coalesce(response, 'Withdrawn by the reviewer.'),
                responded_at = coalesce(responded_at, now()), version = version + 1
          WHERE id = $1`,
        [pointId, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.review_point_cleared',
        objectType: 'tax_audit_review_point',
        objectId: pointId,
        before: { status: p.status },
        after: { status: 'cleared' },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  /** Flag a matter that may need reporting; the signing Partner decides it. */
  async flag(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: FlagTaxAuditObservationInput,
  ): Promise<TaxAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.row(client, engagementId, auditId, true);
      this.requireOpen(a);
      const clauseNo = await this.requirePaper(client, auditId, input.workingPaperId);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.tax_audit_observations
           (tax_audit_id, engagement_id, working_paper_id, clause_no, wording, raised_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          auditId,
          engagementId,
          input.workingPaperId ?? null,
          clauseNo,
          input.wording.trim(),
          ctx.employeeId ?? null,
        ],
      );
      await supersedeSignoffs(
        client,
        auditId,
        'partner',
        'A new matter was flagged for the report.',
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.observation_flagged',
        objectType: 'tax_audit_observation',
        objectId: rows[0]!.id,
        after: { auditId, clauseNo },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  async editObservation(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    observationId: string,
    input: EditTaxAuditObservationInput,
  ): Promise<TaxAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.row(client, engagementId, auditId);
      this.requireOpen(a);
      const o = await this.observation(client, auditId, observationId, input.version);
      const lead = await this.isLead(client, engagementId);
      if (!this.canEdit(ctx, lead, a, o)) {
        throw new ForbiddenException(
          'Whoever flagged it, the engagement’s partner or manager, or the signing Partner rewords it, while it is undecided.',
        );
      }
      await client.query(
        `UPDATE hsdg.tax_audit_observations SET wording = $2, version = version + 1 WHERE id = $1`,
        [observationId, input.wording.trim()],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.observation_reworded',
        objectType: 'tax_audit_observation',
        objectId: observationId,
        before: { wording: o.wording },
        after: { wording: input.wording.trim() },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  /** The signing Partner: a qualification, an observation, or not for the report. */
  async decide(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    observationId: string,
    input: DecideTaxAuditObservationInput,
  ): Promise<TaxAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.row(client, engagementId, auditId, true);
      this.requireOpen(a);
      if (!a.signing_partner_id) throw new BadRequestException('Choose the signing Partner first.');
      if (a.signing_partner_id !== ctx.employeeId) {
        throw new ForbiddenException('The signing Partner decides what goes into the report.');
      }
      const o = await this.observation(client, auditId, observationId, input.version);
      const note = input.note?.trim() || null;
      if (input.outcome === 'dropped' && !note) {
        throw new BadRequestException('Say why it stays out of the report.');
      }
      const accepted = input.outcome !== 'dropped';
      await client.query(
        `UPDATE hsdg.tax_audit_observations
            SET status = $2, kind = $3, decision_note = $4, decided_by_employee_id = $5,
                decided_at = now(), version = version + 1
          WHERE id = $1`,
        [
          observationId,
          accepted ? 'accepted' : 'dropped',
          accepted ? input.outcome : null,
          note,
          ctx.employeeId,
        ],
      );
      if (o.status !== 'proposed') {
        await supersedeSignoffs(client, auditId, 'partner', 'A reporting decision changed.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.observation_decided',
        objectType: 'tax_audit_observation',
        objectId: observationId,
        before: { status: o.status, kind: o.kind },
        after: { status: accepted ? 'accepted' : 'dropped', kind: accepted ? input.outcome : null },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  /**
   * What stops the report being signed, for F-8: every clause settled, every
   * draft confirmed, nothing open, every flag decided, the Partner signed off.
   */
  async signingBlockersFor(client: PoolClient, auditId: string): Promise<string[]> {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.tax_audit_review_points
        WHERE tax_audit_id = $1 AND status <> 'cleared'`,
      [auditId],
    );
    return this.blockers(client, auditId, rows[0]!.n, false);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async blockers(
    client: PoolClient,
    auditId: string,
    openPoints: number,
    forPartnerSignoff: boolean,
  ): Promise<string[]> {
    const [unsettled, drafts, undecided, signoffs] = await Promise.all([
      this.unsettled(client, auditId),
      this.unconfirmedDrafts(client, auditId),
      client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM hsdg.tax_audit_observations
          WHERE tax_audit_id = $1 AND status = 'proposed'`,
        [auditId],
      ),
      this.signoffs(client, auditId),
    ]);
    return signingBlockers({
      unsettled,
      unconfirmedDrafts: drafts,
      openPoints,
      undecided: undecided.rows[0]!.n,
      partnerSignedOff: forPartnerSignoff || signoffs.some((s) => s.level === 'partner'),
    });
  }

  private async row(
    client: PoolClient,
    engagementId: string,
    auditId: string,
    lock = false,
  ): Promise<AuditRow> {
    const { rows } = await client.query<AuditRow>(
      `SELECT a.id, a.engagement_id, a.financial_year, a.stage, a.signing_partner_id,
              sp.full_name AS signing_partner_name, a.clause_work_opened_at, a.version
         FROM hsdg.tax_audits a
         LEFT JOIN hsdg.employees sp ON sp.id = a.signing_partner_id
        WHERE a.id = $1 AND a.engagement_id = $2${lock ? ' FOR UPDATE OF a' : ''}`,
      [auditId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Tax audit not found.');
    return rows[0];
  }

  /** Points and flags change while the 3CD is worked or reviewed, not once it is signed. */
  private requireOpen(a: AuditRow): void {
    if (!a.clause_work_opened_at) throw new BadRequestException('The 3CD work is not open yet.');
    if (a.stage !== 'clause_work' && a.stage !== 'review') {
      throw new BadRequestException('The report is signed; the review is closed.');
    }
  }

  private checkVersion(actual: number, sent: number): void {
    if (actual !== sent) {
      throw new ConflictException('Someone else changed this meanwhile. Reload and try again.');
    }
  }

  private async isLead(client: PoolClient, engagementId: string): Promise<boolean> {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT hsdg.is_engagement_lead($1) AS ok`,
      [engagementId],
    );
    return rows[0]?.ok === true;
  }

  private levelOf(ctx: RlsContext, lead: boolean, a: AuditRow): TaxAuditReviewLevel | null {
    return reviewLevelOf(
      { employeeId: ctx.employeeId, role: ctx.role, lead },
      a.signing_partner_id,
    );
  }

  /**
   * The level the viewer may sign off now: the next in the chain, at or
   * below their own (the Partner level only for the signing Partner), and
   * not after signing off another level themselves.
   */
  private signOffLevel(
    ctx: RlsContext,
    lead: boolean,
    a: AuditRow,
    signoffs: TaxAuditReviewSignoff[],
  ): TaxAuditReviewLevel | null {
    const mine = this.levelOf(ctx, lead, a);
    const next = nextReviewLevel(signoffs.map((s) => s.level));
    if (a.stage !== 'review' || !mine || !next) return null;
    if (signoffs.some((s) => s.employeeId === ctx.employeeId)) return null;
    if (next === 'partner' && mine !== 'partner') return null;
    return reviewLevelRank(mine) >= reviewLevelRank(next) ? next : null;
  }

  private canClear(ctx: RlsContext, lead: boolean, a: AuditRow, p: PointRow): boolean {
    if (p.raised_by_employee_id && p.raised_by_employee_id === ctx.employeeId) return true;
    if (lead) return true;
    const mine = this.levelOf(ctx, lead, a);
    return !!mine && reviewLevelRank(mine) > reviewLevelRank(p.level);
  }

  private canEdit(ctx: RlsContext, lead: boolean, a: AuditRow, o: ObservationRow): boolean {
    if (o.status !== 'proposed') return false;
    const me = ctx.employeeId;
    return lead || (!!me && (o.raised_by_employee_id === me || a.signing_partner_id === me));
  }

  /** The clause number of a paper on this audit (null for the report as a whole). */
  private async requirePaper(
    client: PoolClient,
    auditId: string,
    paperId: string | undefined,
  ): Promise<string | null> {
    if (!paperId) return null;
    const { rows } = await client.query<{ clause_no: string }>(
      `SELECT clause_no FROM hsdg.tax_audit_working_papers WHERE id = $1 AND tax_audit_id = $2`,
      [paperId, auditId],
    );
    if (!rows[0]) throw new NotFoundException('Working paper not found.');
    return rows[0].clause_no;
  }

  private async unsettled(client: PoolClient, auditId: string): Promise<string[]> {
    const { rows } = await client.query<{ clause_no: string }>(
      `SELECT clause_no FROM hsdg.tax_audit_working_papers
        WHERE tax_audit_id = $1 AND status NOT IN ('done', 'not_applicable')`,
      [auditId],
    );
    return rows.map((r) => r.clause_no);
  }

  private async unconfirmedDrafts(client: PoolClient, auditId: string): Promise<string[]> {
    const { rows } = await client.query<{ clause_no: string }>(
      `SELECT clause_no FROM hsdg.tax_audit_working_papers
        WHERE tax_audit_id = $1 AND draft_source IS NOT NULL AND draft_confirmed_at IS NULL
          AND status <> 'not_applicable'`,
      [auditId],
    );
    return rows.map((r) => r.clause_no);
  }

  private async signoffs(client: PoolClient, auditId: string): Promise<TaxAuditReviewSignoff[]> {
    const { rows } = await client.query<{
      level: TaxAuditReviewLevel;
      employee_id: string;
      full_name: string | null;
      signed_off_at: Date;
    }>(
      `SELECT s.level, s.employee_id, e.full_name, s.signed_off_at
         FROM hsdg.tax_audit_review_signoffs s
         LEFT JOIN hsdg.employees e ON e.id = s.employee_id
        WHERE s.tax_audit_id = $1 AND s.superseded_at IS NULL`,
      [auditId],
    );
    return rows.map((r) => ({
      level: r.level,
      employeeId: r.employee_id,
      employeeName: r.full_name,
      signedOffAt: r.signed_off_at.toISOString(),
    }));
  }

  private async points(client: PoolClient, auditId: string, pointId?: string): Promise<PointRow[]> {
    const { rows } = await client.query<PointRow>(
      `SELECT p.id, p.working_paper_id, w.clause_no, p.level, p.body, p.status,
              p.raised_by_employee_id, er.full_name AS raised_by_name, p.created_at, p.response,
              ep.full_name AS responded_by_name, p.responded_at,
              ec.full_name AS cleared_by_name, p.cleared_at, p.version
         FROM hsdg.tax_audit_review_points p
         LEFT JOIN hsdg.tax_audit_working_papers w ON w.id = p.working_paper_id
         LEFT JOIN hsdg.employees er ON er.id = p.raised_by_employee_id
         LEFT JOIN hsdg.employees ep ON ep.id = p.responded_by_employee_id
         LEFT JOIN hsdg.employees ec ON ec.id = p.cleared_by_employee_id
        WHERE p.tax_audit_id = $1 AND ($2::uuid IS NULL OR p.id = $2)
        ORDER BY p.created_at, p.id`,
      [auditId, pointId ?? null],
    );
    return rows;
  }

  private async point(
    client: PoolClient,
    auditId: string,
    pointId: string,
    version: number,
  ): Promise<PointRow> {
    const [p] = await this.points(client, auditId, pointId);
    if (!p) throw new NotFoundException('Review point not found.');
    this.checkVersion(p.version, version);
    return p;
  }

  private async observations(
    client: PoolClient,
    auditId: string,
    observationId?: string,
  ): Promise<ObservationRow[]> {
    const { rows } = await client.query<ObservationRow>(
      `SELECT o.id, o.working_paper_id, o.clause_no, o.wording, o.status, o.kind, o.decision_note,
              ed.full_name AS decided_by_name, o.decided_at, o.raised_by_employee_id,
              er.full_name AS raised_by_name, o.created_at, o.version
         FROM hsdg.tax_audit_observations o
         LEFT JOIN hsdg.employees ed ON ed.id = o.decided_by_employee_id
         LEFT JOIN hsdg.employees er ON er.id = o.raised_by_employee_id
        WHERE o.tax_audit_id = $1 AND ($2::uuid IS NULL OR o.id = $2)
        ORDER BY o.created_at, o.id`,
      [auditId, observationId ?? null],
    );
    return rows;
  }

  private async observation(
    client: PoolClient,
    auditId: string,
    observationId: string,
    version: number,
  ): Promise<ObservationRow> {
    const [o] = await this.observations(client, auditId, observationId);
    if (!o) throw new NotFoundException('Flagged matter not found.');
    this.checkVersion(o.version, version);
    return o;
  }

  private async view(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
  ): Promise<TaxAuditReview> {
    const a = await this.row(client, engagementId, auditId);
    const lead = await this.isLead(client, engagementId);
    const [signoffs, points, obs, unsettled, drafts] = await Promise.all([
      this.signoffs(client, auditId),
      this.points(client, auditId),
      this.observations(client, auditId),
      this.unsettled(client, auditId),
      this.unconfirmedDrafts(client, auditId),
    ]);
    const open = a.stage === 'clause_work' || a.stage === 'review';
    const editable = open && !!a.clause_work_opened_at;
    const myLevel = this.levelOf(ctx, lead, a);
    const observations: TaxAuditObservation[] = obs.map((o) => ({
      id: o.id,
      workingPaperId: o.working_paper_id,
      clauseNo: o.clause_no,
      wording: o.wording,
      status: o.status,
      kind: o.kind,
      decisionNote: o.decision_note,
      decidedByName: o.decided_by_name,
      decidedAt: iso(o.decided_at),
      raisedByName: o.raised_by_name,
      createdAt: o.created_at.toISOString(),
      canEdit: editable && this.canEdit(ctx, lead, a, o),
      version: o.version,
    }));
    const reviewPoints: TaxAuditReviewPoint[] = points.map((p) => ({
      id: p.id,
      workingPaperId: p.working_paper_id,
      clauseNo: p.clause_no,
      level: p.level,
      body: p.body,
      status: p.status,
      raisedByName: p.raised_by_name,
      raisedAt: p.created_at.toISOString(),
      response: p.response,
      respondedByName: p.responded_by_name,
      respondedAt: iso(p.responded_at),
      clearedByName: p.cleared_by_name,
      clearedAt: iso(p.cleared_at),
      canRespond: editable && p.status !== 'cleared' && p.raised_by_employee_id !== ctx.employeeId,
      canClear: editable && p.status !== 'cleared' && this.canClear(ctx, lead, a, p),
      version: p.version,
    }));
    const openPoints = points.filter((p) => p.status !== 'cleared').length;
    const undecided = obs.filter((o) => o.status === 'proposed').length;
    return {
      auditId,
      engagementId,
      financialYear: a.financial_year,
      stage: a.stage,
      signingPartnerId: a.signing_partner_id,
      signingPartnerName: a.signing_partner_name,
      chain: TAX_AUDIT_REVIEW_LEVELS.map((level) => ({
        level,
        signoff: signoffs.find((s) => s.level === level) ?? null,
      })),
      points: reviewPoints,
      observations,
      report: reportObservations(observations),
      unsettledClauses: unsettled,
      unconfirmedDrafts: drafts,
      startBlockers: startReviewBlockers(unsettled),
      signingBlockers: SIGNED.includes(a.stage)
        ? []
        : signingBlockers({
            unsettled,
            unconfirmedDrafts: drafts,
            openPoints,
            undecided,
            partnerSignedOff: signoffs.some((s) => s.level === 'partner'),
          }),
      myLevel,
      canStart:
        a.stage === 'clause_work' && !!a.clause_work_opened_at && (lead || myLevel !== null),
      canSignOff: this.signOffLevel(ctx, lead, a, signoffs),
      canDecide: editable && !!ctx.employeeId && ctx.employeeId === a.signing_partner_id,
      editable,
      version: a.version,
    };
  }
}
