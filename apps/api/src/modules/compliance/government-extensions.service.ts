import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { translateComplianceError } from './compliance-rules.service';
import type { CreateGovernmentExtensionInput, GovernmentExtensionRecord } from './compliance.types';

interface ExtensionRow {
  id: string;
  compliance_rule_id: string;
  rule_code: string;
  rule_name: string;
  original_due_date: string;
  revised_due_date: string;
  notification_reference: string;
  applicable_population: string;
  effective_date: string;
  notes: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: Date;
}

const EXTENSION_BASE = `
  SELECT ge.id, ge.compliance_rule_id, cr.code AS rule_code, cr.name AS rule_name,
         ge.original_due_date::text, ge.revised_due_date::text, ge.notification_reference,
         ge.applicable_population, ge.effective_date::text, ge.notes,
         ge.created_by_user_id, u.display_name AS created_by_name, ge.created_at
  FROM hsdg.government_extensions ge
  JOIN hsdg.compliance_rules cr ON cr.id = ge.compliance_rule_id
  LEFT JOIN hsdg.users u ON u.id = ge.created_by_user_id`;

/**
 * Government extensions (§19) — firm-wide statutory CONFIG, like compliance
 * rules. A government-notified revised deadline is stored as an append-only
 * OVERLAY record (not an edit to the rule, not a manual override): it retains
 * the original date, the revised operative date, the notification reference, the
 * applicable population and the effective date. RLS floors writes to firm-wide
 * (`ctx_is_firmwide`); the migration revokes UPDATE/DELETE so an imported
 * extension is immutable evidence. Applying one to an engagement obligation is a
 * separate, engagement-scoped action on {@link ComplianceInstancesService}.
 */
@Injectable()
export class GovernmentExtensionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(
    ctx: RlsContext,
    input: CreateGovernmentExtensionInput,
  ): Promise<GovernmentExtensionRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const ruleRes = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.compliance_rules WHERE code = $1`,
        [input.complianceRuleCode],
      );
      if (!ruleRes.rows[0]) {
        throw new BadRequestException(`Unknown compliance rule "${input.complianceRuleCode}".`);
      }
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.government_extensions
             (compliance_rule_id, original_due_date, revised_due_date, notification_reference,
              applicable_population, effective_date, notes, created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::uuid) RETURNING id`,
          [
            ruleRes.rows[0].id,
            input.originalDueDate,
            input.revisedDueDate,
            input.notificationReference,
            input.applicablePopulation,
            input.effectiveDate,
            input.notes ?? null,
            ctx.userId,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateComplianceError(err);
      }
      const record = (await this.selectExtension(client, id))!;
      await this.audit.recordWith(client, ctx, {
        action: 'compliance.extension_created',
        objectType: 'government_extension',
        objectId: id,
        after: {
          rule: input.complianceRuleCode,
          originalDueDate: input.originalDueDate,
          revisedDueDate: input.revisedDueDate,
          notificationReference: input.notificationReference,
        },
      });
      return record;
    });
  }

  async list(
    ctx: RlsContext,
    page: PageParams,
    filter: { complianceRuleCode?: string } = {},
  ): Promise<PageResult<GovernmentExtensionRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter.complianceRuleCode) {
        params.push(filter.complianceRuleCode);
        conditions.push(`cr.code = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(page.limit, page.offset);
      const { rows } = await client.query<ExtensionRow & { total_count: string }>(
        `SELECT e.*, count(*) OVER() AS total_count
         FROM (${EXTENSION_BASE} ${where}) e
         ORDER BY e.effective_date DESC, e.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: rows.map(mapExtension),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  async getOne(ctx: RlsContext, id: string): Promise<GovernmentExtensionRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const record = await this.selectExtension(client, id);
      if (!record) throw new NotFoundException('Government extension not found.');
      return record;
    });
  }

  private async selectExtension(
    client: PoolClient,
    id: string,
  ): Promise<GovernmentExtensionRecord | null> {
    const { rows } = await client.query<ExtensionRow>(`${EXTENSION_BASE} WHERE ge.id = $1`, [id]);
    return rows[0] ? mapExtension(rows[0]) : null;
  }
}

function mapExtension(row: ExtensionRow): GovernmentExtensionRecord {
  return {
    id: row.id,
    complianceRuleId: row.compliance_rule_id,
    complianceRuleCode: row.rule_code,
    complianceRuleName: row.rule_name,
    originalDueDate: row.original_due_date,
    revisedDueDate: row.revised_due_date,
    notificationReference: row.notification_reference,
    applicablePopulation: row.applicable_population,
    effectiveDate: row.effective_date,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
  };
}
