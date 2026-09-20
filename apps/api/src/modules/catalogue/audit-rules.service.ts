import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  AuditRuleBandRecord,
  AuthorityProvisionRecord,
  MeasurementBasis,
  ResolvedRule,
  RuleOperator,
  RuleResolver,
  RuleUnit,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import {
  buildResolver,
  selectRuleVersion,
  type ResolvableRuleVersion,
} from './audit-rule-resolution';

/**
 * Audit Rules Library + Authority/Provision Library service (Implementation
 * Guide §4, §5). Firm-wide methodology reference data owned by the catalogue.
 *
 * The single consumer contract is {@link buildResolverOn}: given an engagement's
 * audit-period start (and optional entity class), it returns a pure, synchronous
 * {@link RuleResolver} that the Section 02 framework engines call — so the
 * engines stay pure and testable and NO statutory number lives in engine code.
 */
@Injectable()
export class AuditRulesService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Build the {@link RuleResolver} for an audit period on an existing client
   * (called from inside a framework-service transaction). Loads every active
   * rule with its versions, freezes the version in force for the period per rule
   * (effective-date selection), and attaches any band rows.
   */
  async buildResolverOn(
    client: PoolClient,
    auditPeriodStart: string,
    _entityClass?: string | null,
  ): Promise<RuleResolver> {
    const { rows } = await client.query<{
      rule_id: string;
      code: string;
      area_key: string;
      entity_class: string | null;
      criterion: string;
      operator: RuleOperator;
      unit: RuleUnit;
      measurement_basis: MeasurementBasis | null;
      version_id: string;
      version: number;
      effective_from: string;
      effective_to: string | null;
      threshold: string | null;
      threshold_high: string | null;
      outcome: string | null;
      authority_provision_id: string | null;
      guidance_reference: string | null;
    }>(
      `SELECT r.id AS rule_id, r.code, r.area_key, r.entity_class, r.criterion,
              r.operator, r.unit, r.measurement_basis,
              v.id AS version_id, v.version, v.effective_from::text, v.effective_to::text,
              v.threshold::text, v.threshold_high::text, v.outcome,
              v.authority_provision_id, v.guidance_reference
         FROM hsdg.audit_rule r
         JOIN hsdg.audit_rule_version v ON v.audit_rule_id = r.id
        WHERE r.is_active = true`,
    );

    // Group versions per rule, then freeze the one in force for the period.
    const byRule = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byRule.get(row.rule_id) ?? [];
      list.push(row);
      byRule.set(row.rule_id, list);
    }

    const chosen: ResolvableRuleVersion[] = [];
    const chosenVersionIds: string[] = [];
    for (const list of byRule.values()) {
      const versions = list.map((row) => ({
        row,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
      }));
      const pick = selectRuleVersion(versions, auditPeriodStart);
      if (!pick) continue;
      const row = pick.row;
      chosenVersionIds.push(row.version_id);
      chosen.push({
        ruleId: row.rule_id,
        ruleCode: row.code,
        areaKey: row.area_key,
        entityClass: row.entity_class,
        criterion: row.criterion,
        operator: row.operator,
        unit: row.unit,
        measurementBasis: row.measurement_basis,
        ruleVersionId: row.version_id,
        version: row.version,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
        threshold: row.threshold == null ? null : Number(row.threshold),
        thresholdHigh: row.threshold_high == null ? null : Number(row.threshold_high),
        outcome: row.outcome,
        authorityProvisionId: row.authority_provision_id,
        guidanceReference: row.guidance_reference,
        bands: [],
      });
    }

    if (chosenVersionIds.length > 0) {
      const bands = await this.loadBands(client, chosenVersionIds);
      for (const c of chosen) c.bands = bands.get(c.ruleVersionId) ?? [];
    }

    return buildResolver(chosen);
  }

  /** Public wrapper opening its own RLS transaction (for controllers/tests). */
  async buildResolver(
    ctx: RlsContext,
    auditPeriodStart: string,
    entityClass?: string | null,
  ): Promise<RuleResolver> {
    return this.db.withRlsContext(ctx, (client) =>
      this.buildResolverOn(client, auditPeriodStart, entityClass),
    );
  }

  /** Resolve a single rule for a period (guide §4.3 signature). */
  async resolve(
    ctx: RlsContext,
    input: {
      areaKey: string;
      criterion: string;
      auditPeriodStart: string;
      entityClass?: string | null;
    },
  ): Promise<ResolvedRule | null> {
    const resolver = await this.buildResolver(ctx, input.auditPeriodStart, input.entityClass);
    return resolver(input.areaKey, input.criterion, input.entityClass ?? null);
  }

  /**
   * Resolve a provision by code and engagement period (guide §5): returns the
   * version in force on `effectiveOn`, never the current one for a historical
   * engagement.
   */
  async resolveProvisionOn(
    client: PoolClient,
    code: string,
    effectiveOn: string,
  ): Promise<AuthorityProvisionRecord | null> {
    const { rows } = await client.query<AuthorityProvisionRow>(
      `SELECT id, code, authority, title, provision_number,
              effective_from::text, effective_to::text, source_reference,
              superseded_by_id, methodology_version_scope,
              created_at::text, updated_at::text
         FROM hsdg.authority_provision
        WHERE code = $1
          AND effective_from <= $2::date
          AND (effective_to IS NULL OR effective_to > $2::date)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [code, effectiveOn],
    );
    const row = rows[0];
    return row ? mapProvision(row) : null;
  }

  private async loadBands(
    client: PoolClient,
    versionIds: string[],
  ): Promise<Map<string, AuditRuleBandRecord[]>> {
    const { rows } = await client.query<{
      id: string;
      audit_rule_version_id: string;
      lower: string | null;
      upper: string | null;
      ceiling_value: string | null;
      label: string | null;
      sort_order: number;
    }>(
      `SELECT id, audit_rule_version_id, lower::text, upper::text, ceiling_value::text,
              label, sort_order
         FROM hsdg.audit_rule_band
        WHERE audit_rule_version_id = ANY($1::uuid[])
        ORDER BY sort_order`,
      [versionIds],
    );
    const out = new Map<string, AuditRuleBandRecord[]>();
    for (const row of rows) {
      const list = out.get(row.audit_rule_version_id) ?? [];
      list.push({
        id: row.id,
        auditRuleVersionId: row.audit_rule_version_id,
        lower: row.lower == null ? null : Number(row.lower),
        upper: row.upper == null ? null : Number(row.upper),
        ceilingValue: row.ceiling_value == null ? null : Number(row.ceiling_value),
        label: row.label,
        sortOrder: row.sort_order,
      });
      out.set(row.audit_rule_version_id, list);
    }
    return out;
  }
}

interface AuthorityProvisionRow {
  id: string;
  code: string;
  authority: AuthorityProvisionRecord['authority'];
  title: string;
  provision_number: string;
  effective_from: string;
  effective_to: string | null;
  source_reference: string | null;
  superseded_by_id: string | null;
  methodology_version_scope: string | null;
  created_at: string;
  updated_at: string;
}

function mapProvision(row: AuthorityProvisionRow): AuthorityProvisionRecord {
  return {
    id: row.id,
    code: row.code,
    authority: row.authority,
    title: row.title,
    provisionNumber: row.provision_number,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    sourceReference: row.source_reference,
    supersededById: row.superseded_by_id,
    methodologyVersionScope: row.methodology_version_scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
