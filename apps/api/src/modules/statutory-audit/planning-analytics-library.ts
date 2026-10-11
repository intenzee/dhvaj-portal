import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import {
  FINANCE_COST_BASES,
  INDUSTRY_PROFILE_KEY_PATTERN,
  METRIC_VALUE_TYPES,
  PLANNING_ATTENTIONS,
  type AnalyticsLibrary,
  type AnalyticsMetricDef,
  type AnalyticsMetricRecord,
  type AnalyticsProfileDef,
  type AnalyticsProfileRecord,
  type AnalyticsRuleDef,
  type AnalyticsRuleRecord,
  type CreateAnalyticsMetricVersionInput,
  type CreateAnalyticsProfileVersionInput,
  type CreateAnalyticsRuleVersionInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { analyticsRuleProblem, resolveMethodology } from './planning-analytics-engine';

/** The methodology version a new library row gets when nothing else is given. */
const DEFAULT_METHODOLOGY_VERSION = 'dhvaj-analytics-2026.1';

// ── rows ─────────────────────────────────────────────────────────────────────

interface Versioning {
  id: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
  methodology_version: string;
  change_note: string | null;
  created_by_name: string | null;
  created_at: Date;
}
interface MetricRow extends Versioning {
  metric_key: string;
  label: string;
  value_type: AnalyticsMetricDef['valueType'];
  core: boolean;
  note: string;
  applies_to: string[];
  sort_order: number;
}
interface ProfileRow extends Versioning {
  profile_key: string;
  label: string;
  description: string;
  sub_industries: string[];
  considerations: string[];
  average_balances: boolean;
  debt_metrics: string[];
  finance_cost_basis: AnalyticsProfileDef['financeCostBasis'];
  inventory_cost_bases: string[];
  payable_cost_bases: string[];
  inventory_trend_fallback: string | null;
}
interface RuleRow extends Versioning {
  rule_code: string;
  rule_key: string;
  name: string;
  kind: AnalyticsRuleDef['kind'];
  applies_to: string[];
  excluded_for: string[];
  required_metrics: string[];
  formula: string;
  definition: AnalyticsRuleDef['definition'];
  parameter_type: AnalyticsRuleDef['parameterType'];
  parameter_value: string | null;
  enhanced_at: string | null;
  immediate_at: string | null;
  min_data_status: AnalyticsRuleDef['minDataStatus'];
  min_source_types: AnalyticsRuleDef['minSourceTypes'];
  signal_wording: string;
  why_may_matter: string;
  affected_areas: string[];
  suggested_attention: AnalyticsRuleDef['suggestedAttention'];
}

// The creator's name joins hsdg.employees, whose RLS (shares_engagement_with) is
// evaluated per row and grows with the firm's engagements — so only the admin
// listing pays for it; resolving a file's methodology never needs names.
const versioning = (
  creators: boolean,
) => `t.id, t.version, t.effective_from::text, t.effective_to::text, t.active,
         t.methodology_version, t.change_note, ${creators ? 'e.full_name' : 'NULL::text'} AS created_by_name, t.created_at`;
const joinCreator = (creators: boolean) =>
  creators ? `LEFT JOIN hsdg.employees e ON e.id = t.created_by_employee_id` : '';
const metricSelect = (creators = true) => `
  SELECT ${versioning(creators)}, t.metric_key, t.label, t.value_type, t.core, t.note, t.applies_to, t.sort_order
    FROM hsdg.analytics_metric_definition t ${joinCreator(creators)}`;
const profileSelect = (creators = true) => `
  SELECT ${versioning(creators)}, t.profile_key, t.label, t.description, t.sub_industries, t.considerations,
         t.average_balances, t.debt_metrics, t.finance_cost_basis, t.inventory_cost_bases,
         t.payable_cost_bases, t.inventory_trend_fallback
    FROM hsdg.analytics_industry_profile t ${joinCreator(creators)}`;
const ruleSelect = (creators = true) => `
  SELECT ${versioning(creators)}, t.rule_code, t.rule_key, t.name, t.kind, t.applies_to, t.excluded_for,
         t.required_metrics, t.formula, t.definition, t.parameter_type, t.parameter_value::text,
         t.enhanced_at::text, t.immediate_at::text, t.min_data_status, t.min_source_types,
         t.signal_wording, t.why_may_matter, t.affected_areas, t.suggested_attention
    FROM hsdg.analytics_rule t ${joinCreator(creators)}`;
const METRIC_SELECT = metricSelect();
const PROFILE_SELECT = profileSelect();
const RULE_SELECT = ruleSelect();

const num = (v: string | null): number | null => (v === null ? null : Number(v));

const versioningOf = (r: Versioning) => ({
  version: r.version,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  active: r.active,
  methodologyVersion: r.methodology_version,
});
const auditOf = (r: Versioning) => ({
  id: r.id,
  changeNote: r.change_note,
  createdByName: r.created_by_name,
  createdAt: r.created_at.toISOString(),
});

function toMetric(r: MetricRow): AnalyticsMetricRecord {
  return {
    ...versioningOf(r),
    ...auditOf(r),
    metricKey: r.metric_key,
    label: r.label,
    valueType: r.value_type,
    core: r.core,
    note: r.note,
    appliesTo: r.applies_to ?? [],
    sortOrder: r.sort_order,
  };
}
function toProfile(r: ProfileRow): AnalyticsProfileRecord {
  return {
    ...versioningOf(r),
    ...auditOf(r),
    profileKey: r.profile_key,
    label: r.label,
    description: r.description,
    subIndustries: r.sub_industries ?? [],
    considerations: r.considerations ?? [],
    averageBalances: r.average_balances,
    debtMetrics: r.debt_metrics ?? [],
    financeCostBasis: r.finance_cost_basis,
    inventoryCostBases: r.inventory_cost_bases ?? [],
    payableCostBases: r.payable_cost_bases ?? [],
    inventoryTrendFallback: r.inventory_trend_fallback,
  };
}
function toRule(r: RuleRow): AnalyticsRuleRecord {
  return {
    ...versioningOf(r),
    ...auditOf(r),
    ruleCode: r.rule_code,
    ruleKey: r.rule_key,
    name: r.name,
    kind: r.kind,
    appliesTo: r.applies_to ?? [],
    excludedFor: r.excluded_for ?? [],
    requiredMetrics: r.required_metrics ?? [],
    formula: r.formula,
    definition: r.definition,
    parameterType: r.parameter_type,
    parameterValue: num(r.parameter_value),
    enhancedAt: num(r.enhanced_at),
    immediateAt: num(r.immediate_at),
    minDataStatus: r.min_data_status ?? [],
    minSourceTypes: r.min_source_types ?? [],
    signalWording: r.signal_wording,
    whyMayMatter: r.why_may_matter,
    affectedAreas: r.affected_areas ?? [],
    suggestedAttention: r.suggested_attention,
  };
}

/**
 * Every version of every library row (any authenticated role may read it — no
 * client data). `creators: false` leaves createdByName null and skips the
 * employees join (see `versioning`). One client runs one query at a time.
 */
export async function readAnalyticsLibrary(
  client: PoolClient,
  { creators = true }: { creators?: boolean } = {},
): Promise<AnalyticsLibrary> {
  const m = await client.query<MetricRow>(
    `${metricSelect(creators)} ORDER BY t.sort_order, t.metric_key, t.version DESC`,
  );
  const p = await client.query<ProfileRow>(
    `${profileSelect(creators)} ORDER BY t.profile_key, t.version DESC`,
  );
  const r = await client.query<RuleRow>(
    `${ruleSelect(creators)} ORDER BY t.rule_code, t.version DESC`,
  );
  return {
    metrics: m.rows.map(toMetric),
    profiles: p.rows.map(toProfile),
    rules: r.rows.map(toRule),
  };
}

/**
 * The methodology a 03.2 file runs on: the library versions in force on `on`
 * (the audit period end, else today) for the file's profile — falling back to
 * the generic profile when that profile is not in force.
 */
export async function loadAnalyticsMethodology(client: PoolClient, profileKey: string, on: string) {
  const library = await readAnalyticsLibrary(client, { creators: false });
  return resolveMethodology(library, profileKey, on);
}

// ── validation helpers ───────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const METRIC_KEY = /^[a-z][a-z0-9_]{1,59}$/;
const RULE_KEY = /^[a-z0-9_]{2,80}$/;

const uniq = (xs: readonly string[] | undefined) => [
  ...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean)),
];

function checkDates(input: { effectiveFrom?: string; effectiveTo?: string | null }): void {
  if (input.effectiveFrom !== undefined && !DATE.test(input.effectiveFrom)) {
    throw new BadRequestException('effectiveFrom must be YYYY-MM-DD.');
  }
  if (input.effectiveTo && !DATE.test(input.effectiveTo)) {
    throw new BadRequestException('effectiveTo must be YYYY-MM-DD.');
  }
  if (input.effectiveTo && input.effectiveFrom && input.effectiveTo < input.effectiveFrom) {
    throw new BadRequestException('The effective-to date is before the effective-from date.');
  }
  if (input.effectiveTo && !input.effectiveFrom && input.effectiveTo < '2000-01-01') {
    throw new BadRequestException('The effective-to date is before the effective-from date.');
  }
}

async function knownKeys(client: PoolClient, table: string, column: string): Promise<Set<string>> {
  const { rows } = await client.query<{ k: string }>(
    `SELECT DISTINCT ${column} AS k FROM hsdg.${table}`,
  );
  return new Set(rows.map((r) => r.k));
}

/** Latest version of `code` in `table` (any state), or undefined for a new item. */
async function latestOf<T extends QueryResultRow>(
  client: PoolClient,
  select: string,
  column: string,
  code: string,
) {
  const { rows } = await client.query<T>(
    `${select} WHERE t.${column} = $1 ORDER BY t.version DESC LIMIT 1`,
    [code],
  );
  return rows[0];
}

/**
 * Analytics Methodology Library administration (DHVAJ 03.2 §12, §15, §17, §23).
 *
 * Canonical metrics, industry profiles and analytics rules are methodology
 * configuration the Methodology Admin (holders of service.manage) maintains
 * without a deployment. Insert-only: every change appends a version effective
 * from a date, so a file keeps running on the version in force on its period
 * end and an Investigation Card keeps the rule code + version it came from.
 *
 * This service only touches the library tables — it never reads client data,
 * and the library carries no conclusion authority (attention parameters only
 * surface matters to investigate).
 */
@Injectable()
export class PlanningAnalyticsLibraryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RlsContext): Promise<AnalyticsLibrary> {
    return this.db.withRlsContext(ctx, (client) => readAnalyticsLibrary(client));
  }

  addMetricVersion(
    ctx: RlsContext,
    input: CreateAnalyticsMetricVersionInput,
  ): Promise<AnalyticsMetricRecord> {
    const key = input.metricKey?.trim();
    if (!key || !METRIC_KEY.test(key) || key.startsWith('custom_')) {
      throw new BadRequestException('metricKey must be lower_snake_case (and not custom_…).');
    }
    if (!METRIC_VALUE_TYPES.includes(input.valueType))
      throw new BadRequestException('Unknown value type.');
    if (!input.label?.trim()) throw new BadRequestException('A metric needs a label.');
    checkDates(input);
    const appliesTo = uniq(input.appliesTo);

    return this.db.withRlsContext(ctx, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('analytics_metric_definition'))`);
      const latest = await latestOf<MetricRow>(client, METRIC_SELECT, 'metric_key', key);
      // Units are converted only for amounts — a metric never changes what it measures.
      if (latest && latest.value_type !== input.valueType) {
        throw new BadRequestException(
          `${key} measures a ${latest.value_type}; add a new metric for a ${input.valueType}.`,
        );
      }
      const profiles = await knownKeys(client, 'analytics_industry_profile', 'profile_key');
      const badProfile = appliesTo.find((p) => !profiles.has(p));
      if (badProfile) throw new BadRequestException(`Unknown industry profile "${badProfile}".`);
      if (latest && input.active === false) await this.assertMetricUnused(client, key);

      const version = (latest?.version ?? 0) + 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.analytics_metric_definition
           (metric_key, version, label, value_type, core, note, applies_to, sort_order,
            effective_from, effective_to, active, methodology_version, change_note, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::date, DATE '2000-01-01'), $10::date, $11,
                 $12, $13, $14)
         RETURNING id`,
        [
          key,
          version,
          input.label.trim(),
          input.valueType,
          input.core ?? latest?.core ?? false,
          (input.note ?? latest?.note ?? '').trim(),
          appliesTo,
          input.sortOrder ?? latest?.sort_order ?? 1000,
          input.effectiveFrom ?? null,
          input.effectiveTo ?? null,
          input.active ?? true,
          input.methodologyVersion?.trim() ||
            latest?.methodology_version ||
            DEFAULT_METHODOLOGY_VERSION,
          input.changeNote.trim(),
          ctx.employeeId ?? null,
        ],
      );
      const id = rows[0]!.id;
      await this.audit.recordWith(client, ctx, {
        action: 'analytics_metric_definition.version_added',
        objectType: 'analytics_metric_definition',
        objectId: id,
        after: { metricKey: key, version, active: input.active ?? true },
      });
      return toMetric(
        (await client.query<MetricRow>(`${METRIC_SELECT} WHERE t.id = $1`, [id])).rows[0]!,
      );
    });
  }

  addProfileVersion(
    ctx: RlsContext,
    input: CreateAnalyticsProfileVersionInput,
  ): Promise<AnalyticsProfileRecord> {
    const key = input.profileKey?.trim();
    if (!key || !INDUSTRY_PROFILE_KEY_PATTERN.test(key)) {
      throw new BadRequestException('profileKey must be lower_snake_case (2–40 characters).');
    }
    if (!input.label?.trim()) throw new BadRequestException('A profile needs a label.');
    if (!FINANCE_COST_BASES.includes(input.financeCostBasis)) {
      throw new BadRequestException('financeCostBasis must be average or closing.');
    }
    if (key === 'generic' && (input.active === false || input.effectiveTo)) {
      throw new BadRequestException(
        'The generic profile is every file’s fallback and cannot be retired.',
      );
    }
    checkDates(input);
    const debt = uniq(input.debtMetrics);
    const invBases = uniq(input.inventoryCostBases);
    const payBases = uniq(input.payableCostBases);
    const fallback = input.inventoryTrendFallback?.trim() || null;
    if (!debt.length)
      throw new BadRequestException('The debt definition needs at least one metric.');
    if (!invBases.length || !payBases.length) {
      throw new BadRequestException('Inventory and payable days each need at least one cost base.');
    }
    // §12 / §24: inventory and payable days never silently use revenue.
    if (invBases.includes('revenue') || payBases.includes('revenue')) {
      throw new BadRequestException(
        'Inventory / payable days must use a cost base, never Revenue.',
      );
    }

    return this.db.withRlsContext(ctx, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('analytics_industry_profile'))`);
      const { rows: metricRows } = await client.query<{ metric_key: string; value_type: string }>(
        `SELECT DISTINCT ON (metric_key) metric_key, value_type
           FROM hsdg.analytics_metric_definition ORDER BY metric_key, version DESC`,
      );
      const amounts = new Set(
        metricRows.filter((m) => m.value_type === 'amount').map((m) => m.metric_key),
      );
      const notAmount = [...debt, ...invBases, ...payBases, ...(fallback ? [fallback] : [])].find(
        (k) => !amounts.has(k),
      );
      if (notAmount)
        throw new BadRequestException(`"${notAmount}" is not an amount metric in the library.`);

      const latest = await latestOf<ProfileRow>(client, PROFILE_SELECT, 'profile_key', key);
      const version = (latest?.version ?? 0) + 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.analytics_industry_profile
           (profile_key, version, label, description, sub_industries, considerations, average_balances,
            debt_metrics, finance_cost_basis, inventory_cost_bases, payable_cost_bases,
            inventory_trend_fallback, effective_from, effective_to, active, methodology_version,
            change_note, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 COALESCE($13::date, DATE '2000-01-01'), $14::date, $15, $16, $17, $18)
         RETURNING id`,
        [
          key,
          version,
          input.label.trim(),
          (input.description ?? latest?.description ?? '').trim(),
          uniq(input.subIndustries ?? latest?.sub_industries),
          uniq(input.considerations ?? latest?.considerations),
          input.averageBalances ?? latest?.average_balances ?? false,
          debt,
          input.financeCostBasis,
          invBases,
          payBases,
          fallback,
          input.effectiveFrom ?? null,
          input.effectiveTo ?? null,
          input.active ?? true,
          input.methodologyVersion?.trim() ||
            latest?.methodology_version ||
            DEFAULT_METHODOLOGY_VERSION,
          input.changeNote.trim(),
          ctx.employeeId ?? null,
        ],
      );
      const id = rows[0]!.id;
      await this.audit.recordWith(client, ctx, {
        action: 'analytics_industry_profile.version_added',
        objectType: 'analytics_industry_profile',
        objectId: id,
        after: { profileKey: key, version, active: input.active ?? true },
      });
      return toProfile(
        (await client.query<ProfileRow>(`${PROFILE_SELECT} WHERE t.id = $1`, [id])).rows[0]!,
      );
    });
  }

  addRuleVersion(
    ctx: RlsContext,
    input: CreateAnalyticsRuleVersionInput,
  ): Promise<AnalyticsRuleRecord> {
    if (!/^PAR-[0-9]{3}$/.test(input.ruleCode ?? '')) {
      throw new BadRequestException('ruleCode must look like PAR-001.');
    }
    if (!input.name?.trim() || !input.formula?.trim()) {
      throw new BadRequestException('A rule needs a name and a transparent formula.');
    }
    checkDates(input);

    return this.db.withRlsContext(ctx, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('analytics_rule'))`);
      const latest = await latestOf<RuleRow>(client, RULE_SELECT, 'rule_code', input.ruleCode);
      // The rule key is the card's idempotency key and the 03.5 tag — it never changes.
      const ruleKey = latest?.rule_key ?? input.ruleKey?.trim();
      if (!ruleKey || !RULE_KEY.test(ruleKey)) {
        throw new BadRequestException('A new rule needs a lower_snake_case rule key.');
      }
      if (latest && input.ruleKey && input.ruleKey !== ruleKey) {
        throw new BadRequestException(
          `The rule key of ${input.ruleCode} is "${ruleKey}" and cannot change.`,
        );
      }
      if (latest && input.kind !== latest.kind) {
        throw new BadRequestException(
          `${input.ruleCode} is a ${latest.kind} rule; add a new rule for a ${input.kind} one.`,
        );
      }
      if (!latest) {
        const { rows: clash } = await client.query(
          `SELECT 1 FROM hsdg.analytics_rule WHERE rule_key = $1 LIMIT 1`,
          [ruleKey],
        );
        if (clash[0]) throw new ConflictException(`Rule key "${ruleKey}" is already in use.`);
      }

      const metrics = await knownKeys(client, 'analytics_metric_definition', 'metric_key');
      const profiles = await knownKeys(client, 'analytics_industry_profile', 'profile_key');
      const { rows: ratioRows } = await client.query<{ rule_key: string }>(
        `SELECT DISTINCT rule_key FROM hsdg.analytics_rule WHERE kind = 'ratio'`,
      );
      const ratioKeys = new Set(ratioRows.map((r) => r.rule_key));
      if (input.kind === 'ratio') ratioKeys.add(ruleKey);

      const isRatio = input.kind === 'ratio';
      const rule: Omit<
        AnalyticsRuleDef,
        'ruleCode' | 'version' | 'effectiveFrom' | 'effectiveTo' | 'methodologyVersion'
      > = {
        ruleKey,
        name: input.name.trim(),
        kind: input.kind,
        appliesTo: uniq(input.appliesTo),
        excludedFor: uniq(input.excludedFor),
        requiredMetrics: uniq(input.requiredMetrics),
        formula: input.formula.trim(),
        definition: input.definition,
        parameterType: isRatio ? null : (input.parameterType ?? null),
        parameterValue: isRatio ? null : (input.parameterValue ?? null),
        enhancedAt: isRatio ? null : (input.enhancedAt ?? null),
        immediateAt: isRatio ? null : (input.immediateAt ?? null),
        minDataStatus: [...new Set(input.minDataStatus ?? [])],
        minSourceTypes: [...new Set(input.minSourceTypes ?? [])],
        signalWording: (input.signalWording ?? '').trim(),
        whyMayMatter: (input.whyMayMatter ?? '').trim(),
        affectedAreas: uniq(input.affectedAreas),
        suggestedAttention: input.suggestedAttention ?? 'standard',
        active: input.active ?? true,
      };
      if (!PLANNING_ATTENTIONS.includes(rule.suggestedAttention)) {
        throw new BadRequestException('Unknown suggested attention.');
      }
      const badProfile = [...rule.appliesTo, ...rule.excludedFor].find((p) => !profiles.has(p));
      if (badProfile) throw new BadRequestException(`Unknown industry profile "${badProfile}".`);
      const problem = analyticsRuleProblem(rule, metrics, ratioKeys);
      if (problem) throw new BadRequestException(problem);

      const version = (latest?.version ?? 0) + 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.analytics_rule
           (rule_code, version, rule_key, name, kind, applies_to, excluded_for, required_metrics,
            formula, definition, parameter_type, parameter_value, enhanced_at, immediate_at,
            min_data_status, min_source_types, signal_wording, why_may_matter, affected_areas,
            suggested_attention, effective_from, effective_to, active, methodology_version,
            change_note, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17,
                 $18, $19, $20, COALESCE($21::date, DATE '2000-01-01'), $22::date, $23, $24, $25, $26)
         RETURNING id`,
        [
          input.ruleCode,
          version,
          ruleKey,
          rule.name,
          rule.kind,
          rule.appliesTo,
          rule.excludedFor,
          rule.requiredMetrics,
          rule.formula,
          JSON.stringify(rule.definition),
          rule.parameterType,
          rule.parameterValue,
          rule.enhancedAt,
          rule.immediateAt,
          rule.minDataStatus,
          rule.minSourceTypes,
          rule.signalWording,
          rule.whyMayMatter,
          rule.affectedAreas,
          rule.suggestedAttention,
          input.effectiveFrom ?? null,
          input.effectiveTo ?? null,
          rule.active,
          input.methodologyVersion?.trim() ||
            latest?.methodology_version ||
            DEFAULT_METHODOLOGY_VERSION,
          input.changeNote.trim(),
          ctx.employeeId ?? null,
        ],
      );
      const id = rows[0]!.id;
      await this.audit.recordWith(client, ctx, {
        action: 'analytics_rule.version_added',
        objectType: 'analytics_rule',
        objectId: id,
        after: { ruleCode: input.ruleCode, ruleKey, version, active: rule.active },
      });
      return toRule((await client.query<RuleRow>(`${RULE_SELECT} WHERE t.id = $1`, [id])).rows[0]!);
    });
  }

  /** A metric a rule or profile in the library still reads cannot be retired. */
  private async assertMetricUnused(client: PoolClient, key: string): Promise<void> {
    const library = await readAnalyticsLibrary(client, { creators: false });
    const latestRules = new Map<string, AnalyticsRuleDef>();
    for (const r of library.rules) if (!latestRules.has(r.ruleCode)) latestRules.set(r.ruleCode, r);
    const latestProfiles = new Map<string, AnalyticsProfileDef>();
    for (const p of library.profiles)
      if (!latestProfiles.has(p.profileKey)) latestProfiles.set(p.profileKey, p);
    const user =
      [...latestRules.values()].find(
        (r) =>
          r.active &&
          (r.requiredMetrics.includes(key) || JSON.stringify(r.definition).includes(`"${key}"`)),
      )?.ruleCode ??
      [...latestProfiles.values()].find(
        (p) =>
          p.active &&
          [
            ...p.debtMetrics,
            ...p.inventoryCostBases,
            ...p.payableCostBases,
            p.inventoryTrendFallback,
          ].includes(key),
      )?.profileKey;
    if (user) {
      throw new BadRequestException(
        `${key} is still used by ${user}; retire or change that first.`,
      );
    }
  }
}
