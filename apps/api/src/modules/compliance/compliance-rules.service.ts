import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { CalculationBasis, WorkingDayAdjustment } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import type {
  AddRuleVersionInput,
  ComplianceRuleRecord,
  ComplianceRuleVersionRecord,
  CreateComplianceRuleInput,
} from './compliance.types';

interface RuleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  service_id: string | null;
  service_code: string | null;
  category: ComplianceRuleRecord['category'];
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  calculation_basis: CalculationBasis;
  offset_months: number;
  offset_days: number;
  fixed_month: number | null;
  fixed_day: number | null;
  working_day_adjustment: WorkingDayAdjustment;
  internal_sla_offset_days: number;
  condition: unknown | null;
  notes: string | null;
  created_at: Date;
}

/**
 * Firm-wide compliance CONFIG: rules, their effective-dated versions, and the
 * holiday calendar. Writes are gated by RLS (`ctx_is_firmwide`) — no source
 * changes needed to add or amend a statutory rule. Rule versions are append-
 * only (the migration revokes UPDATE/DELETE), so a calculation an instance
 * already snapshotted can never be silently rewritten.
 */
@Injectable()
export class ComplianceRulesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async createRule(
    ctx: RlsContext,
    input: CreateComplianceRuleInput,
  ): Promise<ComplianceRuleRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      let serviceId: string | null = null;
      if (input.serviceCode) {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM hsdg.services WHERE code = $1`,
          [input.serviceCode],
        );
        if (!rows[0]) throw new BadRequestException(`Unknown service "${input.serviceCode}".`);
        serviceId = rows[0].id;
      }
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.compliance_rules (code, name, description, service_id, category)
           VALUES ($1,$2,$3,$4,COALESCE($5,'other')) RETURNING id`,
          [input.code, input.name, input.description ?? null, serviceId, input.category ?? null],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateComplianceError(err);
      }
      const rule = await this.selectRule(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'compliance.rule_created',
        objectType: 'compliance_rule',
        objectId: id,
        after: { code: input.code },
      });
      return rule!;
    });
  }

  async addRuleVersion(
    ctx: RlsContext,
    ruleId: string,
    input: AddRuleVersionInput,
  ): Promise<ComplianceRuleRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const exists = await client.query(`SELECT 1 FROM hsdg.compliance_rules WHERE id = $1`, [
        ruleId,
      ]);
      if (!exists.rows[0]) throw new NotFoundException('Compliance rule not found.');

      const { rows: next } = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM hsdg.compliance_rule_versions WHERE compliance_rule_id = $1`,
        [ruleId],
      );
      const version = next[0]!.next_version;

      let versionId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.compliance_rule_versions
             (compliance_rule_id, version, effective_from, effective_to, calculation_basis,
              offset_months, offset_days, fixed_month, fixed_day, working_day_adjustment,
              internal_sla_offset_days, condition, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'next'),$11,$12::jsonb,$13)
           RETURNING id`,
          [
            ruleId,
            version,
            input.effectiveFrom,
            input.effectiveTo ?? null,
            input.calculationBasis,
            input.offsetMonths ?? 0,
            input.offsetDays ?? 0,
            input.fixedMonth ?? null,
            input.fixedDay ?? null,
            input.workingDayAdjustment ?? null,
            input.internalSlaOffsetDays ?? 0,
            input.condition === undefined ? null : JSON.stringify(input.condition),
            input.notes ?? null,
          ],
        );
        versionId = rows[0]!.id;
      } catch (err) {
        throw translateComplianceError(err);
      }

      const rule = await this.selectRule(client, ruleId);
      await this.audit.recordWith(client, ctx, {
        action: 'compliance.rule_version_added',
        objectType: 'compliance_rule',
        objectId: ruleId,
        after: { versionId, version, effectiveFrom: input.effectiveFrom },
      });
      return rule!;
    });
  }

  async setRuleActive(
    ctx: RlsContext,
    ruleId: string,
    isActive: boolean,
  ): Promise<ComplianceRuleRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      let updated: number;
      try {
        const result = await client.query(
          `UPDATE hsdg.compliance_rules SET is_active = $1, version = version + 1 WHERE id = $2`,
          [isActive, ruleId],
        );
        updated = result.rowCount ?? 0;
      } catch (err) {
        throw translateComplianceError(err);
      }
      if (updated === 0) throw new NotFoundException('Compliance rule not found.');
      const rule = await this.selectRule(client, ruleId);
      await this.audit.recordWith(client, ctx, {
        action: 'compliance.rule_updated',
        objectType: 'compliance_rule',
        objectId: ruleId,
        after: { isActive },
      });
      return rule!;
    });
  }

  async listRules(
    ctx: RlsContext,
    page: PageParams,
    filter: { category?: string; serviceCode?: string; activeOnly?: boolean },
  ): Promise<PageResult<ComplianceRuleRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter.category) {
        params.push(filter.category);
        conditions.push(`r.category = $${params.length}`);
      }
      if (filter.serviceCode) {
        params.push(filter.serviceCode);
        conditions.push(`s.code = $${params.length}`);
      }
      if (filter.activeOnly) conditions.push(`r.is_active = true`);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      params.push(page.limit, page.offset);
      const { rows } = await client.query<RuleRow & { total_count: string }>(
        `SELECT r.id, r.code, r.name, r.description, r.service_id, s.code AS service_code,
                r.category, r.is_active, r.version, r.created_at, r.updated_at,
                count(*) OVER() AS total_count
         FROM hsdg.compliance_rules r
         LEFT JOIN hsdg.services s ON s.id = r.service_id
         ${where}
         ORDER BY r.code
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const ids = rows.map((r) => r.id);
      const versionsByRule = await this.selectVersionsFor(client, ids);
      return {
        items: rows.map((r) => mapRule(r, versionsByRule.get(r.id) ?? [])),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  async getRule(ctx: RlsContext, idOrCode: string): Promise<ComplianceRuleRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const rule = await this.selectRule(client, idOrCode);
      if (!rule) throw new NotFoundException('Compliance rule not found.');
      return rule;
    });
  }

  // ── Holidays ─────────────────────────────────────────────────────────────

  async addHoliday(
    ctx: RlsContext,
    date: string,
    name: string,
  ): Promise<{ id: string; holidayDate: string; name: string }> {
    return this.db.withRlsContext(ctx, async (client) => {
      let row: { id: string; holiday_date: string; name: string };
      try {
        const { rows } = await client.query<{ id: string; holiday_date: string; name: string }>(
          `INSERT INTO hsdg.compliance_holidays (holiday_date, name) VALUES ($1,$2)
           RETURNING id, holiday_date::text, name`,
          [date, name],
        );
        row = rows[0]!;
      } catch (err) {
        throw translateComplianceError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'compliance.holiday_added',
        objectType: 'compliance_holiday',
        objectId: row.id,
        after: { date, name },
      });
      return { id: row.id, holidayDate: row.holiday_date, name: row.name };
    });
  }

  async listHolidays(
    ctx: RlsContext,
  ): Promise<Array<{ id: string; holidayDate: string; name: string }>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ id: string; holiday_date: string; name: string }>(
        `SELECT id, holiday_date::text, name FROM hsdg.compliance_holidays ORDER BY holiday_date`,
      );
      return rows.map((r) => ({ id: r.id, holidayDate: r.holiday_date, name: r.name }));
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async selectRule(
    client: PoolClient,
    idOrCode: string,
  ): Promise<ComplianceRuleRecord | null> {
    const byId = /^[0-9a-f-]{36}$/i.test(idOrCode);
    const { rows } = await client.query<RuleRow>(
      `SELECT r.id, r.code, r.name, r.description, r.service_id, s.code AS service_code,
              r.category, r.is_active, r.version, r.created_at, r.updated_at
       FROM hsdg.compliance_rules r
       LEFT JOIN hsdg.services s ON s.id = r.service_id
       WHERE ${byId ? 'r.id' : 'r.code'} = $1`,
      [idOrCode],
    );
    if (!rows[0]) return null;
    const versions = (await this.selectVersionsFor(client, [rows[0].id])).get(rows[0].id) ?? [];
    return mapRule(rows[0], versions);
  }

  private async selectVersionsFor(
    client: PoolClient,
    ruleIds: string[],
  ): Promise<Map<string, ComplianceRuleVersionRecord[]>> {
    const byRule = new Map<string, ComplianceRuleVersionRecord[]>();
    if (ruleIds.length === 0) return byRule;
    const { rows } = await client.query<VersionRow & { compliance_rule_id: string }>(
      `SELECT compliance_rule_id, id, version, effective_from::text, effective_to::text,
              calculation_basis, offset_months, offset_days, fixed_month, fixed_day,
              working_day_adjustment, internal_sla_offset_days, condition, notes, created_at
       FROM hsdg.compliance_rule_versions
       WHERE compliance_rule_id = ANY($1::uuid[])
       ORDER BY version`,
      [ruleIds],
    );
    for (const row of rows) {
      const record = mapVersion(row);
      const list = byRule.get(row.compliance_rule_id);
      if (list) list.push(record);
      else byRule.set(row.compliance_rule_id, [record]);
    }
    return byRule;
  }
}

function mapVersion(row: VersionRow): ComplianceRuleVersionRecord {
  return {
    id: row.id,
    version: row.version,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    calculationBasis: row.calculation_basis,
    offsetMonths: row.offset_months,
    offsetDays: row.offset_days,
    fixedMonth: row.fixed_month,
    fixedDay: row.fixed_day,
    workingDayAdjustment: row.working_day_adjustment,
    internalSlaOffsetDays: row.internal_sla_offset_days,
    condition: row.condition,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

function mapRule(row: RuleRow, versions: ComplianceRuleVersionRecord[]): ComplianceRuleRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    serviceId: row.service_id,
    serviceCode: row.service_code,
    category: row.category,
    isActive: row.is_active,
    version: row.version,
    versions,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Map PostgreSQL constraint/RLS violations to clean HTTP errors. */
export function translateComplianceError(err: unknown): Error {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code === '23505') {
    if (e.constraint?.includes('rules_code')) {
      return new ConflictException('A compliance rule with that code already exists.');
    }
    if (e.constraint?.includes('effective')) {
      return new ConflictException('A rule version with that effective-from date already exists.');
    }
    if (e.constraint?.includes('instances_unique')) {
      return new ConflictException(
        'A compliance instance already exists for this engagement, rule and period.',
      );
    }
    return new ConflictException('A duplicate value violates a unique constraint.');
  }
  if (e.code === '23503') return new BadRequestException('A referenced record does not exist.');
  if (e.code === '23514') {
    return new BadRequestException(
      e.message && e.message.length <= 200 ? e.message : 'A value violates a check constraint.',
    );
  }
  if (e.code === '42501') {
    return new ForbiddenException('Not permitted to write this compliance record.');
  }
  return err as Error;
}
