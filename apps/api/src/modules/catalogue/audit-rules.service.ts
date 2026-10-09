import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  AuditRuleBandRecord,
  AuthorityProvisionRecord,
  AuthorityReference,
  AuthorityReferenceKind,
  SupersedeAuthorityProvisionInput,
  UpdateAuthorityProvisionInput,
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
      condition: Record<string, unknown> | null;
    }>(
      `SELECT r.id AS rule_id, r.code, r.area_key, r.entity_class, r.criterion,
              r.operator, r.unit, r.measurement_basis,
              v.id AS version_id, v.version, v.effective_from::text, v.effective_to::text,
              v.threshold::text, v.threshold_high::text, v.outcome,
              -- The rule cites a provision by its stable code: the version in
              -- force for the period, else the exact version recorded.
              COALESCE(
                (SELECT p2.id
                   FROM hsdg.authority_provision p1
                   JOIN hsdg.authority_provision p2 ON p2.code = p1.code
                  WHERE p1.id = v.authority_provision_id
                    AND p2.effective_from <= $1::date
                    AND (p2.effective_to IS NULL OR p2.effective_to >= $1::date)
                  ORDER BY p2.effective_from DESC
                  LIMIT 1),
                v.authority_provision_id) AS authority_provision_id,
              v.guidance_reference, v.condition
         FROM hsdg.audit_rule r
         JOIN hsdg.audit_rule_version v ON v.audit_rule_id = r.id
        WHERE r.is_active = true`,
      [auditPeriodStart],
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
        condition: row.condition,
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
      `SELECT ${PROVISION_COLUMNS}
         FROM hsdg.authority_provision
        WHERE code = $1
          AND effective_from <= $2::date
          AND (effective_to IS NULL OR effective_to >= $2::date)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [code, effectiveOn],
    );
    const row = rows[0];
    return row ? mapProvision(row) : null;
  }

  /**
   * The references a workflow context cites (spec 02.1 §3, §19), each resolved
   * to the provision version in force on `effectiveOn` through the central
   * reference map — UI components never name a provision themselves.
   */
  async resolveReferencesOn(
    client: PoolClient,
    contextKey: string,
    effectiveOn: string,
  ): Promise<AuthorityReference[]> {
    const { rows } = await client.query<{ anchor: string; label: string; provision_code: string }>(
      `SELECT anchor, label, provision_code
         FROM hsdg.authority_reference_link
        WHERE context_key = $1
        ORDER BY sort_order, anchor`,
      [contextKey],
    );
    const out: AuthorityReference[] = [];
    for (const r of rows) {
      out.push({
        anchor: r.anchor,
        label: r.label,
        code: r.provision_code,
        provision: await this.resolveProvisionOn(client, r.provision_code, effectiveOn),
      });
    }
    return out;
  }

  /**
   * A context's references (see {@link resolveReferencesOn}) plus the exact
   * provision versions a conclusion cited by id (e.g. the rule a 02.2 result
   * triggered) — each cited one once, after the configured links, skipping any
   * the configured links already show.
   */
  async resolveReferencesWithCitedOn(
    client: PoolClient,
    contextKey: string,
    effectiveOn: string,
    citedProvisionIds: readonly string[],
  ): Promise<AuthorityReference[]> {
    const refs = await this.resolveReferencesOn(client, contextKey, effectiveOn);
    const shown = new Set(refs.map((r) => r.provision?.id).filter(Boolean));
    const ids = [...new Set(citedProvisionIds)].filter((id) => !shown.has(id));
    if (ids.length === 0) return refs;
    const { rows } = await client.query<AuthorityProvisionRow>(
      `SELECT ${PROVISION_COLUMNS} FROM hsdg.authority_provision
        WHERE id = ANY($1::uuid[])
        ORDER BY code`,
      [ids],
    );
    for (const row of rows) {
      const provision = mapProvision(row);
      refs.push({
        anchor: `cited_${provision.code.toLowerCase()}`,
        label: `${provision.provisionNumber} - ${provision.title}`,
        code: provision.code,
        provision,
      });
    }
    return refs;
  }

  /** Public wrapper: one provision by code for a date (the in-portal viewer). */
  async resolveProvision(
    ctx: RlsContext,
    code: string,
    effectiveOn: string,
  ): Promise<AuthorityProvisionRecord | null> {
    return this.db.withRlsContext(ctx, (client) =>
      this.resolveProvisionOn(client, code, effectiveOn),
    );
  }

  /**
   * Methodology administration: maintain the viewer content (summary, source
   * URL) of one provision row. Citation identity (code, number, dates) is never
   * edited in place — supersession appends a row (guide §5).
   */
  async updateProvisionContent(
    client: PoolClient,
    id: string,
    input: UpdateAuthorityProvisionInput,
  ): Promise<AuthorityProvisionRecord | null> {
    const { rows } = await client.query<AuthorityProvisionRow>(
      `UPDATE hsdg.authority_provision
          SET summary = CASE WHEN $2::boolean THEN $3 ELSE summary END,
              source_url = CASE WHEN $4::boolean THEN $5 ELSE source_url END
        WHERE id = $1
        RETURNING ${PROVISION_COLUMNS}`,
      [
        id,
        input.summary !== undefined,
        input.summary?.trim() || null,
        input.sourceUrl !== undefined,
        input.sourceUrl?.trim() || null,
      ],
    );
    return rows[0] ? mapProvision(rows[0]) : null;
  }

  /** Every version of a provision code, newest first (the viewer's version history). */
  async listProvisionVersionsOn(
    client: PoolClient,
    code: string,
  ): Promise<AuthorityProvisionRecord[]> {
    const { rows } = await client.query<AuthorityProvisionRow>(
      `SELECT ${PROVISION_COLUMNS} FROM hsdg.authority_provision
        WHERE code = $1
        ORDER BY effective_from DESC`,
      [code],
    );
    return rows.map(mapProvision);
  }

  /**
   * Methodology administration (02.2 §20): supersede the CURRENT version of a
   * provision. The current one closes the day before `effectiveFrom` and gains
   * `superseded_by_id`; the new version (same code, version_no + 1) carries the
   * new citation, with blank fields copied over. Nothing already in force for an
   * earlier period changes. Returns null when the id is unknown.
   */
  async supersedeProvisionOn(
    client: PoolClient,
    id: string,
    input: SupersedeAuthorityProvisionInput,
    employeeId: string | null,
  ): Promise<{ previous: AuthorityProvisionRecord; current: AuthorityProvisionRecord } | null> {
    const { rows } = await client.query<AuthorityProvisionRow>(
      `SELECT ${PROVISION_COLUMNS} FROM hsdg.authority_provision WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const old = rows[0];
    if (!old) return null;
    if (old.superseded_by_id) {
      throw new ConflictException(
        'This version is already superseded — supersede the current version instead.',
      );
    }
    const from = input.effectiveFrom;
    if (!isIsoDate(from)) throw new BadRequestException('effectiveFrom must be a real date.');
    if (from <= old.effective_from) {
      throw new BadRequestException(
        `The new version must start after ${old.effective_from}, when the current one took effect.`,
      );
    }
    const note = input.changeNote?.trim();
    if (!note) throw new BadRequestException('Say what changed in the change note.');
    const keep = (v: string | null | undefined, cur: string | null) => v?.trim() || cur;

    // Close first, so the one-open-version-per-code index never sees two.
    await client.query(
      `UPDATE hsdg.authority_provision
          SET effective_to = CASE
                WHEN effective_to IS NULL OR effective_to >= $2::date
                THEN ($2::date - 1) ELSE effective_to END
        WHERE id = $1`,
      [id, from],
    );
    const inserted = await client.query<AuthorityProvisionRow>(
      `INSERT INTO hsdg.authority_provision
         (code, authority, title, provision_number, effective_from, source_reference,
          methodology_version_scope, reference_kind, summary, source_url,
          version_no, change_note, created_by_employee_id)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10,
               (SELECT max(version_no) + 1 FROM hsdg.authority_provision WHERE code = $1),
               $11, $12)
       RETURNING ${PROVISION_COLUMNS}`,
      [
        old.code,
        old.authority,
        keep(input.title, old.title),
        keep(input.provisionNumber, old.provision_number),
        from,
        keep(input.sourceReference, old.source_reference),
        old.methodology_version_scope,
        old.reference_kind,
        keep(input.summary, old.summary),
        keep(input.sourceUrl, old.source_url),
        note,
        employeeId,
      ],
    );
    const current = inserted.rows[0]!;
    const closed = await client.query<AuthorityProvisionRow>(
      `UPDATE hsdg.authority_provision SET superseded_by_id = $2 WHERE id = $1
       RETURNING ${PROVISION_COLUMNS}`,
      [id, current.id],
    );
    return { previous: mapProvision(closed.rows[0]!), current: mapProvision(current) };
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
  reference_kind: AuthorityReferenceKind;
  summary: string | null;
  source_url: string | null;
  version_no: number;
  change_note: string | null;
  created_at: string;
  updated_at: string;
}

const PROVISION_COLUMNS = `id, code, authority, title, provision_number,
              effective_from::text, effective_to::text, source_reference,
              superseded_by_id, methodology_version_scope,
              reference_kind, summary, source_url, version_no, change_note,
              created_at::text, updated_at::text`;

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
    referenceKind: row.reference_kind,
    summary: row.summary,
    sourceUrl: row.source_url,
    versionNo: row.version_no,
    changeNote: row.change_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Build a period {@link RuleResolver} on an open client without Nest DI — for
 * pure read helpers (e.g. the 02.2 downstream result) that run inside another
 * service's transaction. `buildResolverOn` only reads through the given client.
 */
export function buildRuleResolverOn(
  client: PoolClient,
  auditPeriodStart: string,
): Promise<RuleResolver> {
  return new AuditRulesService(undefined as never).buildResolverOn(client, auditPeriodStart);
}

function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
