import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  AddAuditRuleVersionInput,
  AuditRuleBandRecord,
  AuditRuleRecord,
  AuditRuleVersionRecord,
  MeasurementBasis,
  RuleOperator,
  RuleUnit,
} from '@hsdg/contracts';

/**
 * Rules Library administration (DHVAJ 02.2 spec §2, acceptance test 10).
 *
 * An authorised methodology administrator (Managing Partner / admin — the same
 * firm-wide authority RLS grants INSERT on `audit_rule_version`) changes a
 * threshold, effective date, exemption condition or authoritative link by
 * APPENDING a dated version. Nothing is edited in place (UPDATE/DELETE on
 * versions is revoked from the app role): resolution picks the latest version
 * whose window covers the audit-period start, so periods before the new
 * `effectiveFrom` keep resolving to the earlier version and historical
 * engagements never change. Deactivating a rule is deliberately not offered —
 * it would also remove the rule from historical periods.
 */
@Injectable()
export class AuditRulesAdminService {
  /** Every rule with its full version history (newest version first). */
  async listOn(client: PoolClient): Promise<AuditRuleRecord[]> {
    const rules = await client.query<RuleRow>(
      `SELECT id, code, area_key, entity_class, criterion, operator, unit,
              measurement_basis, is_active, version, created_at::text, updated_at::text
         FROM hsdg.audit_rule
        ORDER BY area_key, code`,
    );
    const versions = await this.versionsOn(client, null);
    return rules.rows.map((r) => toRule(r, versions.get(r.id) ?? []));
  }

  async getOn(client: PoolClient, ruleId: string): Promise<AuditRuleRecord | null> {
    const { rows } = await client.query<RuleRow>(
      `SELECT id, code, area_key, entity_class, criterion, operator, unit,
              measurement_basis, is_active, version, created_at::text, updated_at::text
         FROM hsdg.audit_rule WHERE id = $1`,
      [ruleId],
    );
    if (!rows[0]) return null;
    const versions = await this.versionsOn(client, ruleId);
    return toRule(rows[0], versions.get(ruleId) ?? []);
  }

  /**
   * Append a version. Fields left `undefined` carry forward from the latest
   * version (so a threshold change keeps the Rule 4 timing condition and the
   * cited provision); `null` clears them explicitly.
   */
  async addVersionOn(
    client: PoolClient,
    ruleId: string,
    input: AddAuditRuleVersionInput,
  ): Promise<{ before: AuditRuleVersionRecord | null; rule: AuditRuleRecord }> {
    const { rows } = await client.query<RuleRow>(
      `SELECT id, code, area_key, entity_class, criterion, operator, unit,
              measurement_basis, is_active, version, created_at::text, updated_at::text
         FROM hsdg.audit_rule WHERE id = $1 FOR UPDATE`,
      [ruleId],
    );
    const rule = rows[0];
    if (!rule) throw new NotFoundException('Rule not found.');
    if (rule.version !== input.version) {
      throw new ConflictException('This rule was changed by someone else — reload and try again.');
    }

    const history = (await this.versionsOn(client, ruleId)).get(ruleId) ?? [];
    const latest = history[0] ?? null; // newest effective_from first
    if (latest && input.effectiveFrom <= latest.effectiveFrom) {
      throw new BadRequestException(
        `The new version must start after ${latest.effectiveFrom}, the start of the latest ` +
          'version. Earlier periods keep their rule — history is never rewritten.',
      );
    }

    const pick = <K extends keyof AuditRuleVersionRecord>(
      given: AuditRuleVersionRecord[K] | undefined,
      key: K,
    ): AuditRuleVersionRecord[K] | null =>
      given !== undefined ? given : latest ? latest[key] : null;

    const threshold = input.threshold;
    const thresholdHigh = pick(input.thresholdHigh, 'thresholdHigh');
    const condition = pick(input.condition, 'condition') as Record<string, unknown> | null;
    const outcome = pick(input.outcome, 'outcome');
    const provisionId = pick(input.authorityProvisionId, 'authorityProvisionId');
    const guidance = pick(input.guidanceReference, 'guidanceReference');

    if (threshold == null && latest?.threshold != null) {
      throw new BadRequestException('This rule compares against a threshold — enter one.');
    }
    if (rule.operator === 'between') {
      if (threshold == null || thresholdHigh == null || thresholdHigh < threshold) {
        throw new BadRequestException(
          'A range rule needs a lower and an upper limit (upper ≥ lower).',
        );
      }
    }
    if (rule.unit === 'percent' && threshold != null && threshold > 100) {
      throw new BadRequestException('A percentage threshold cannot exceed 100.');
    }
    if (provisionId) {
      const p = await client.query(`SELECT 1 FROM hsdg.authority_provision WHERE id = $1`, [
        provisionId,
      ]);
      if (p.rowCount === 0) throw new BadRequestException('Unknown provision.');
    }

    const nextNo = history.reduce((m, v) => Math.max(m, v.version), 0) + 1;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_rule_version
         (audit_rule_id, version, effective_from, effective_to, threshold, threshold_high,
          condition, outcome, authority_provision_id, guidance_reference, notes)
       VALUES ($1, $2, $3::date, NULL, $4, $5, $6::jsonb, $7, $8, $9, $10)
       RETURNING id`,
      [
        ruleId,
        nextNo,
        input.effectiveFrom,
        threshold,
        rule.operator === 'between' ? thresholdHigh : null,
        condition == null ? null : JSON.stringify(condition),
        outcome,
        provisionId,
        guidance?.trim() || null,
        input.notes.trim(),
      ],
    );
    // Band tables (e.g. Schedule V ceilings) carry forward unchanged.
    if (latest && latest.bands.length > 0) {
      await client.query(
        `INSERT INTO hsdg.audit_rule_band
           (audit_rule_version_id, lower, upper, ceiling_value, label, sort_order)
         SELECT $1, lower, upper, ceiling_value, label, sort_order
           FROM hsdg.audit_rule_band WHERE audit_rule_version_id = $2`,
        [inserted.rows[0]!.id, latest.id],
      );
    }
    await client.query(
      `UPDATE hsdg.audit_rule SET version = version + 1, updated_at = now() WHERE id = $1`,
      [ruleId],
    );
    const updated = await this.getOn(client, ruleId);
    return { before: latest, rule: updated! };
  }

  /** Versions grouped by rule, newest `effective_from` first, with supersession dates. */
  private async versionsOn(
    client: PoolClient,
    ruleId: string | null,
  ): Promise<Map<string, AuditRuleVersionRecord[]>> {
    const { rows } = await client.query<VersionRow>(
      `SELECT v.id, v.audit_rule_id, v.version, v.effective_from::text, v.effective_to::text,
              v.threshold::text, v.threshold_high::text, v.condition, v.outcome,
              v.authority_provision_id, p.code AS provision_code,
              v.guidance_reference, v.notes, v.created_at::text
         FROM hsdg.audit_rule_version v
         LEFT JOIN hsdg.authority_provision p ON p.id = v.authority_provision_id
        WHERE ($1::uuid IS NULL OR v.audit_rule_id = $1)
        ORDER BY v.audit_rule_id, v.effective_from DESC, v.version DESC`,
      [ruleId],
    );
    const bands = await client.query<BandRow>(
      `SELECT b.id, b.audit_rule_version_id, b.lower::text, b.upper::text,
              b.ceiling_value::text, b.label, b.sort_order
         FROM hsdg.audit_rule_band b
         JOIN hsdg.audit_rule_version v ON v.id = b.audit_rule_version_id
        WHERE ($1::uuid IS NULL OR v.audit_rule_id = $1)
        ORDER BY b.sort_order`,
      [ruleId],
    );
    const bandsByVersion = new Map<string, AuditRuleBandRecord[]>();
    for (const b of bands.rows) {
      const list = bandsByVersion.get(b.audit_rule_version_id) ?? [];
      list.push({
        id: b.id,
        auditRuleVersionId: b.audit_rule_version_id,
        lower: num(b.lower),
        upper: num(b.upper),
        ceilingValue: num(b.ceiling_value),
        label: b.label,
        sortOrder: b.sort_order,
      });
      bandsByVersion.set(b.audit_rule_version_id, list);
    }
    const out = new Map<string, AuditRuleVersionRecord[]>();
    for (const v of rows) {
      const list = out.get(v.audit_rule_id) ?? [];
      list.push({
        id: v.id,
        auditRuleId: v.audit_rule_id,
        version: v.version,
        effectiveFrom: v.effective_from,
        effectiveTo: v.effective_to,
        threshold: num(v.threshold),
        thresholdHigh: num(v.threshold_high),
        condition: v.condition,
        outcome: v.outcome,
        authorityProvisionId: v.authority_provision_id,
        authorityProvisionCode: v.provision_code,
        guidanceReference: v.guidance_reference,
        notes: v.notes,
        createdAt: v.created_at,
        bands: bandsByVersion.get(v.id) ?? [],
        // Rows arrive newest first: the previous entry is the next version in time.
        supersededFrom: list.length > 0 ? list[list.length - 1]!.effectiveFrom : null,
      });
      out.set(v.audit_rule_id, list);
    }
    return out;
  }
}

const num = (v: string | null): number | null => (v == null ? null : Number(v));

interface RuleRow {
  id: string;
  code: string;
  area_key: string;
  entity_class: string | null;
  criterion: string;
  operator: RuleOperator;
  unit: RuleUnit;
  measurement_basis: MeasurementBasis | null;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  audit_rule_id: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  threshold: string | null;
  threshold_high: string | null;
  condition: Record<string, unknown> | null;
  outcome: string | null;
  authority_provision_id: string | null;
  provision_code: string | null;
  guidance_reference: string | null;
  notes: string | null;
  created_at: string;
}

interface BandRow {
  id: string;
  audit_rule_version_id: string;
  lower: string | null;
  upper: string | null;
  ceiling_value: string | null;
  label: string | null;
  sort_order: number;
}

function toRule(r: RuleRow, versions: AuditRuleVersionRecord[]): AuditRuleRecord {
  return {
    id: r.id,
    code: r.code,
    areaKey: r.area_key,
    entityClass: r.entity_class,
    criterion: r.criterion,
    operator: r.operator,
    unit: r.unit,
    measurementBasis: r.measurement_basis,
    isActive: r.is_active,
    version: r.version,
    versions,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
