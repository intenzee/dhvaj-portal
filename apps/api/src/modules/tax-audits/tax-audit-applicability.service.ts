import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  rupeesShort,
  taxAuditApplicability,
  type SaveTaxAuditApplicabilityInput,
  type Stream,
  type TaxAuditApplicability,
  type TaxAuditApplicabilityInput,
  type TaxAuditClause,
  type TaxAuditRadarBasis,
  type TaxAuditRadarRow,
  type TaxAuditStage,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { ComplianceGeneratorService } from '../compliance/compliance-generator.service';
import { istToday } from '../engagements/time/auto-time';

interface DecisionRow {
  id: string;
  engagement_id: string;
  financial_year: string;
  inputs: TaxAuditApplicabilityInput;
  computed_applicable: boolean;
  computed_clause: TaxAuditClause | null;
  computed_reason: string;
  override_applicable: boolean | null;
  override_reason: string | null;
  decided_by_employee_id: string | null;
  decided_by_name: string | null;
  decided_at: Date;
  version: number;
}

const DECISION_COLUMNS = `d.id, d.engagement_id, d.financial_year, d.inputs, d.computed_applicable,
  d.computed_clause, d.computed_reason, d.override_applicable, d.override_reason,
  d.decided_by_employee_id, emp.full_name AS decided_by_name, d.decided_at, d.version`;

export function toDecision(r: DecisionRow): TaxAuditApplicability {
  const override =
    r.override_applicable === null
      ? null
      : { applicable: r.override_applicable, reason: r.override_reason ?? '' };
  return {
    id: r.id,
    engagementId: r.engagement_id,
    financialYear: r.financial_year,
    inputs: r.inputs,
    computed: {
      applicable: r.computed_applicable,
      clause: r.computed_clause,
      reason: r.computed_reason,
    },
    override,
    applicable: override?.applicable ?? r.computed_applicable,
    reason: override ? `Decided: ${override.reason}` : r.computed_reason,
    decidedById: r.decided_by_employee_id,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at.toISOString(),
    version: r.version,
  };
}

interface RadarSqlRow {
  engagement_id: string;
  engagement_code: string;
  entity_id: string;
  entity_name: string;
  financial_year: string;
  year_version: number;
  streams: Stream[];
  decided: boolean | null;
  decided_reason: string | null;
  pan_tax_audit: boolean | null;
  annual_turnover: string | null;
  stage: TaxAuditStage | null;
  due_date: string;
  days_to_due: number;
}

/** The radar's answer for one year: the decision, else the PAN profile, else turnover. */
export function radarAnswer(r: {
  decided: boolean | null;
  decided_reason: string | null;
  pan_tax_audit: boolean | null;
  annual_turnover: string | null;
}): { likely: boolean; basis: TaxAuditRadarBasis; reason: string } {
  if (r.decided !== null) {
    return { likely: r.decided, basis: 'decided', reason: r.decided_reason ?? '' };
  }
  if (r.pan_tax_audit !== null) {
    return {
      likely: r.pan_tax_audit,
      basis: 'pan_profile',
      reason: r.pan_tax_audit
        ? 'The PAN profile says the accounts are under tax audit. Not yet worked out for the year.'
        : 'The PAN profile says no tax audit. Not yet worked out for the year.',
    };
  }
  const turnover = r.annual_turnover === null ? null : Number(r.annual_turnover);
  if (turnover === null) {
    return {
      likely: false,
      basis: 'turnover',
      reason: 'No turnover on the client record. Not yet worked out for the year.',
    };
  }
  return {
    likely: turnover > 1_00_00_000,
    basis: 'turnover',
    reason:
      `Turnover of ${rupeesShort(turnover)} on the client record is ` +
      `${turnover > 1_00_00_000 ? 'over' : 'within'} ₹1 crore. Not yet worked out for the year.`,
  };
}

/**
 * Tax audit applicability (Phase 3, F-2): the calculator's answer for a year
 * with its reason, a partner's or manager's override, and the firm's radar of
 * clients likely to need an audit. Saving a decision rebuilds the year's
 * calendar, which reads it before the PAN profile and the turnover default.
 */
@Injectable()
export class TaxAuditApplicabilityService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly generator: ComplianceGeneratorService,
  ) {}

  async list(ctx: RlsContext, engagementId: string): Promise<TaxAuditApplicability[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertEngagement(client, engagementId);
      const { rows } = await client.query<DecisionRow>(
        `SELECT ${DECISION_COLUMNS}
           FROM hsdg.tax_audit_applicability d
           LEFT JOIN hsdg.employees emp ON emp.id = d.decided_by_employee_id
          WHERE d.engagement_id = $1
          ORDER BY d.financial_year DESC`,
        [engagementId],
      );
      return rows.map(toDecision);
    });
  }

  async save(
    ctx: RlsContext,
    engagementId: string,
    financialYear: string,
    input: SaveTaxAuditApplicabilityInput,
  ): Promise<TaxAuditApplicability> {
    const computed = taxAuditApplicability(input.inputs);
    const override = input.override
      ? { applicable: input.override.applicable, reason: input.override.reason.trim() }
      : null;
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertEngagement(client, engagementId);
      const year = await client.query<{ streams: Stream[] }>(
        `SELECT streams FROM hsdg.compliance_engagement_years
          WHERE engagement_id = $1 AND financial_year = $2`,
        [engagementId, financialYear],
      );
      if (!year.rows[0]) {
        throw new NotFoundException(`FY ${financialYear} is not a year on this engagement.`);
      }
      const lead = await client.query<{ ok: boolean }>(`SELECT hsdg.is_engagement_lead($1) AS ok`, [
        engagementId,
      ]);
      if (!lead.rows[0]?.ok) {
        throw new ForbiddenException(
          'Only the engagement’s partner or manager decides whether a tax audit applies.',
        );
      }

      const existing = await client.query<DecisionRow>(
        `SELECT ${DECISION_COLUMNS}
           FROM hsdg.tax_audit_applicability d
           LEFT JOIN hsdg.employees emp ON emp.id = d.decided_by_employee_id
          WHERE d.engagement_id = $1 AND d.financial_year = $2
          FOR UPDATE OF d`,
        [engagementId, financialYear],
      );
      const before = existing.rows[0];
      if (before && input.version !== before.version) {
        throw new ConflictException(
          'Someone changed this year’s decision since you opened it. Reload and try again.',
        );
      }
      const values = [
        JSON.stringify(input.inputs),
        computed.applicable,
        computed.clause,
        computed.reason,
        override?.applicable ?? null,
        override?.reason ?? null,
        ctx.employeeId ?? null,
      ];
      const saved = before
        ? await client.query<{ id: string }>(
            `UPDATE hsdg.tax_audit_applicability
                SET inputs = $2::jsonb, computed_applicable = $3, computed_clause = $4,
                    computed_reason = $5, override_applicable = $6, override_reason = $7,
                    decided_by_employee_id = $8, decided_at = now(), version = version + 1
              WHERE id = $1
              RETURNING id`,
            [before.id, ...values],
          )
        : await client.query<{ id: string }>(
            `INSERT INTO hsdg.tax_audit_applicability
               (engagement_id, financial_year, inputs, computed_applicable, computed_clause,
                computed_reason, override_applicable, override_reason, decided_by_employee_id)
             VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [engagementId, financialYear, ...values],
          );
      const { rows } = await client.query<DecisionRow>(
        `SELECT ${DECISION_COLUMNS}
           FROM hsdg.tax_audit_applicability d
           LEFT JOIN hsdg.employees emp ON emp.id = d.decided_by_employee_id
          WHERE d.id = $1`,
        [saved.rows[0]!.id],
      );
      const decision = toDecision(rows[0]!);

      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.applicability_decided',
        objectType: 'tax_audit_applicability',
        objectId: decision.id,
        before: before ? { ...toDecision(before) } : undefined,
        after: {
          engagementId,
          financialYear,
          inputs: input.inputs,
          computed,
          override,
        },
      });

      // The decision is the calendar's answer for the year's tax audit report.
      if (year.rows[0].streams.includes('tax_audit')) {
        await this.generator.generateForEngagement(client, engagementId, {
          financialYears: [financialYear],
        });
      }
      return decision;
    });
  }

  /**
   * Every Compliance year the caller can see whose client is likely to need a
   * tax audit, or that has Tax Audit in scope — likely ones not yet in scope
   * first, then by due date. With `all`, every Compliance year, to work one out.
   */
  async radar(ctx: RlsContext, financialYear: string, all = false): Promise<TaxAuditRadarRow[]> {
    const today = istToday(new Date());
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<RadarSqlRow>(
        `SELECT e.id AS engagement_id, e.engagement_code, ent.id AS entity_id,
                ent.legal_name AS entity_name, y.financial_year, y.version AS year_version,
                y.streams,
                COALESCE(d.override_applicable, d.computed_applicable) AS decided,
                CASE WHEN d.override_applicable IS NOT NULL THEN 'Decided: ' || d.override_reason
                     ELSE d.computed_reason END AS decided_reason,
                (pan.attributes ->> 'taxAudit')::boolean AS pan_tax_audit,
                ent.annual_turnover::text AS annual_turnover,
                a.stage,
                x.due::text AS due_date, (x.due - $2::date) AS days_to_due
           FROM hsdg.compliance_engagement_years y
           JOIN hsdg.engagements e ON e.id = y.engagement_id
           JOIN hsdg.entities ent ON ent.id = e.entity_id
           LEFT JOIN hsdg.tax_audit_applicability d
                  ON d.engagement_id = y.engagement_id AND d.financial_year = y.financial_year
           LEFT JOIN LATERAL (
             SELECT p.attributes FROM hsdg.registration_compliance_profiles p
              WHERE p.entity_id = ent.id AND p.scope = 'pan' AND p.registration_id IS NULL
                AND p.attributes ? 'taxAudit'
                AND p.effective_from <= make_date(left(y.financial_year, 4)::int, 4, 1)
                AND (p.effective_to IS NULL
                     OR p.effective_to >= make_date(left(y.financial_year, 4)::int, 4, 1))
              ORDER BY p.effective_from DESC LIMIT 1) pan ON true
           LEFT JOIN LATERAL (
             SELECT ta.stage, ta.compliance_instance_id FROM hsdg.tax_audits ta
              WHERE ta.engagement_id = y.engagement_id AND ta.financial_year = y.financial_year
              ORDER BY ta.revision DESC LIMIT 1) a ON true
           LEFT JOIN hsdg.compliance_instances ci ON ci.id = a.compliance_instance_id
           LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
           CROSS JOIN LATERAL (SELECT COALESCE(ci.statutory_deadline_override, ge.revised_due_date,
                                               ci.statutory_deadline,
                                               make_date(left(y.financial_year, 4)::int + 1, 9, 30)) AS due) x
          WHERE y.financial_year = $1 AND e.kind = 'compliance'
            AND e.status NOT IN ('closed', 'merged', 'cancelled', 'declined', 'withdrawn')
          ORDER BY ent.legal_name, e.engagement_code`,
        [financialYear, today],
      );
      return rows
        .map((r): TaxAuditRadarRow => {
          const answer = radarAnswer(r);
          const inScope = r.streams.includes('tax_audit');
          return {
            engagementId: r.engagement_id,
            engagementCode: r.engagement_code,
            entityId: r.entity_id,
            entityName: r.entity_name,
            financialYear: r.financial_year,
            yearVersion: r.year_version,
            ...answer,
            inScope,
            booksKept: r.streams.includes('bookkeeping'),
            stage: r.stage,
            dueDate: r.due_date,
            daysToDue: r.days_to_due,
            alert: answer.likely && !inScope && r.days_to_due <= 90,
          };
        })
        .filter((r) => all || r.likely || r.inScope)
        .sort(
          (a, b) =>
            Number(b.likely && !b.inScope) - Number(a.likely && !a.inScope) ||
            a.daysToDue - b.daysToDue ||
            a.entityName.localeCompare(b.entityName),
        );
    });
  }

  private async assertEngagement(client: PoolClient, engagementId: string): Promise<void> {
    const eng = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [engagementId]);
    if (!eng.rowCount) throw new NotFoundException('Engagement not found.');
  }
}
