import { BadRequestException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CANDIDATE_BENCHMARKS,
  MATERIALITY_ATTENTION_CRITERIA,
  MATERIALITY_CIRCUMSTANCE_INITIAL_AUDIT,
  MATERIALITY_OVERRIDE_ATTENTIONS,
  MATERIALITY_RULE_KINDS,
  METRIC_BENCHMARK_PREFIX,
  SPECIAL_ENTITY_TYPES,
  isMetricBenchmark,
  type CreateMaterialityRuleVersionInput,
  type MaterialityMethodologyLibrary,
  type MaterialityMethodologyRuleDef,
  type MaterialityMethodologyRuleRecord,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { checkDates, uniq } from './planning-analytics-library';

/** The methodology version a new rule version gets when nothing else is given. */
const DEFAULT_METHODOLOGY_VERSION = 'dhvaj-materiality-2026.1';

interface RuleRow {
  id: string;
  rule_code: string;
  version: number;
  kind: MaterialityMethodologyRuleDef['kind'];
  name: string;
  benchmark_key: string | null;
  benchmark_label: string | null;
  attention_criterion: MaterialityMethodologyRuleDef['attentionCriterion'];
  low_pct: string | null;
  high_pct: string | null;
  parameter_value: string | null;
  industry_profiles: string[];
  circumstances: string[];
  considerations: string[];
  source_basis: string;
  provisional: boolean;
  override_attention: MaterialityMethodologyRuleDef['overrideAttention'];
  effective_from: string;
  effective_to: string | null;
  active: boolean;
  methodology_version: string;
  change_note: string | null;
  created_by_name: string | null;
  created_at: Date;
}

// Like the 03.2 library: only the admin listing joins hsdg.employees (its RLS
// is evaluated per row); resolving a file's methodology never needs names.
const ruleSelect = (creators = true) => `
  SELECT t.id, t.rule_code, t.version, t.kind, t.name, t.benchmark_key, t.benchmark_label,
         t.attention_criterion, t.low_pct::text, t.high_pct::text, t.parameter_value::text,
         t.industry_profiles, t.circumstances, t.considerations, t.source_basis, t.provisional,
         t.override_attention, t.effective_from::text, t.effective_to::text, t.active,
         t.methodology_version, t.change_note,
         ${creators ? 'e.full_name' : 'NULL::text'} AS created_by_name, t.created_at
    FROM hsdg.materiality_methodology_rule t
    ${creators ? 'LEFT JOIN hsdg.employees e ON e.id = t.created_by_employee_id' : ''}`;
const RULE_SELECT = ruleSelect();

const num = (v: string | null): number | null => (v === null ? null : Number(v));

function toRule(r: RuleRow): MaterialityMethodologyRuleRecord {
  return {
    id: r.id,
    ruleCode: r.rule_code,
    version: r.version,
    kind: r.kind,
    name: r.name,
    benchmarkKey: r.benchmark_key,
    benchmarkLabel: r.benchmark_label,
    attentionCriterion: r.attention_criterion,
    lowPct: num(r.low_pct),
    highPct: num(r.high_pct),
    parameterValue: num(r.parameter_value),
    industryProfiles: r.industry_profiles ?? [],
    circumstances: r.circumstances ?? [],
    considerations: r.considerations ?? [],
    sourceBasis: r.source_basis,
    provisional: r.provisional,
    overrideAttention: r.override_attention,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    active: r.active,
    methodologyVersion: r.methodology_version,
    changeNote: r.change_note,
    createdByName: r.created_by_name,
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * Every version of every materiality methodology rule (any authenticated role
 * may read it — no client data). `creators: false` skips the employees join.
 */
export async function readMaterialityLibrary(
  client: PoolClient,
  { creators = true }: { creators?: boolean } = {},
): Promise<MaterialityMethodologyRuleRecord[]> {
  const { rows } = await client.query<RuleRow>(
    `${ruleSelect(creators)} ORDER BY t.rule_code, t.version DESC`,
  );
  return rows.map(toRule);
}

const RULE_CODE = /^MMR-[0-9]{3}$/;
const CIRCUMSTANCES = new Set<string>([
  ...SPECIAL_ENTITY_TYPES,
  MATERIALITY_CIRCUMSTANCE_INITIAL_AUDIT,
]);

function checkPct(v: number | null | undefined, what: string): void {
  if (v === null || v === undefined) return;
  if (!Number.isFinite(v) || v <= 0 || v > 100) {
    throw new BadRequestException(`${what} must be a percentage above 0 and at most 100.`);
  }
}

/**
 * Materiality Methodology Library administration (DHVAJ 03.3 §8, §23).
 *
 * The Methodology Admin (holders of service.manage) maintains benchmark /
 * percentage guidance, applicability, considerations and attention rules
 * without a deployment. Insert-only: every change appends a version effective
 * from a date; a determination keeps the rule versions it used. This service
 * never reads client data and cannot conclude engagement materiality.
 */
@Injectable()
export class MaterialityMethodologyLibraryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RlsContext): Promise<MaterialityMethodologyLibrary> {
    return this.db.withRlsContext(ctx, async (client) => ({
      rules: await readMaterialityLibrary(client),
    }));
  }

  addRuleVersion(
    ctx: RlsContext,
    input: CreateMaterialityRuleVersionInput,
  ): Promise<MaterialityMethodologyRuleRecord> {
    if (!RULE_CODE.test(input.ruleCode ?? '')) {
      throw new BadRequestException('ruleCode must look like MMR-001.');
    }
    if (!MATERIALITY_RULE_KINDS.includes(input.kind)) {
      throw new BadRequestException('Unknown rule kind.');
    }
    if (!input.name?.trim()) throw new BadRequestException('A rule needs a name.');
    if (!input.sourceBasis?.trim()) {
      throw new BadRequestException('A rule needs its source / technical basis.');
    }
    if (!input.changeNote?.trim()) throw new BadRequestException('A change note is required.');
    checkDates(input);

    const kind = input.kind;
    const ranged = kind === 'om_benchmark' || kind === 'pm' || kind === 'ctt';
    const lowPct = ranged ? (input.lowPct ?? null) : null;
    const highPct = ranged ? (input.highPct ?? null) : null;
    checkPct(lowPct, 'The low percentage');
    checkPct(highPct, 'The high percentage');
    if (highPct !== null && (lowPct === null || highPct < lowPct)) {
      throw new BadRequestException(
        'The high percentage needs a low percentage no greater than it.',
      );
    }
    if (kind === 'pm' && highPct !== null && highPct >= 100) {
      throw new BadRequestException('Performance materiality guidance must stay below 100% of OM.');
    }
    const parameterValue =
      kind === 'attention' || kind === 'rounding' ? (input.parameterValue ?? null) : null;
    if ((kind === 'attention' || kind === 'rounding') && !(parameterValue && parameterValue > 0)) {
      throw new BadRequestException(
        kind === 'rounding'
          ? 'A rounding rule needs a positive step (₹).'
          : 'An attention rule needs a positive parameter (%).',
      );
    }
    const criterion = kind === 'attention' ? (input.attentionCriterion ?? null) : null;
    if (
      kind === 'attention' &&
      (!criterion || !MATERIALITY_ATTENTION_CRITERIA.includes(criterion))
    ) {
      throw new BadRequestException('An attention rule needs a criterion.');
    }
    const benchmarkKey = kind === 'om_benchmark' ? input.benchmarkKey?.trim() || null : null;
    if (kind === 'om_benchmark') {
      const builtin = (CANDIDATE_BENCHMARKS as string[]).includes(benchmarkKey ?? '');
      if (!benchmarkKey || (!builtin && !isMetricBenchmark(benchmarkKey))) {
        throw new BadRequestException(
          'benchmarkKey must be a built-in candidate or metric:<03.2 metric key>.',
        );
      }
    }
    const benchmarkLabel = kind === 'om_benchmark' ? input.benchmarkLabel?.trim() || null : null;
    if (isMetricBenchmark(benchmarkKey) && !benchmarkLabel) {
      throw new BadRequestException('A metric benchmark needs a label.');
    }
    const overrideAttention = input.overrideAttention ?? 'partner_attention';
    if (!MATERIALITY_OVERRIDE_ATTENTIONS.includes(overrideAttention)) {
      throw new BadRequestException('Unknown override attention.');
    }
    const circumstances = uniq(input.circumstances);
    const badCircumstance = circumstances.find((c) => !CIRCUMSTANCES.has(c));
    if (badCircumstance)
      throw new BadRequestException(`Unknown circumstance "${badCircumstance}".`);
    const industryProfiles = uniq(input.industryProfiles);

    return this.db.withRlsContext(ctx, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('materiality_methodology_rule'))`);
      const { rows: latestRows } = await client.query<RuleRow>(
        `${RULE_SELECT} WHERE t.rule_code = $1 ORDER BY t.version DESC LIMIT 1`,
        [input.ruleCode],
      );
      const latest = latestRows[0];
      // A rule code governs one target for life: kind, benchmark, criterion never change.
      if (latest && latest.kind !== kind) {
        throw new BadRequestException(
          `${input.ruleCode} is a ${latest.kind} rule; add a new rule for a ${kind} one.`,
        );
      }
      if (
        latest &&
        (latest.benchmark_key !== benchmarkKey || latest.attention_criterion !== criterion)
      ) {
        throw new BadRequestException(
          `${input.ruleCode} governs ${latest.benchmark_key ?? latest.attention_criterion ?? latest.kind}; add a new rule for another target.`,
        );
      }
      if (industryProfiles.length) {
        const { rows } = await client.query<{ k: string }>(
          `SELECT DISTINCT profile_key AS k FROM hsdg.analytics_industry_profile`,
        );
        const known = new Set(rows.map((r) => r.k));
        const bad = industryProfiles.find((p) => !known.has(p));
        if (bad) throw new BadRequestException(`Unknown industry profile "${bad}".`);
      }
      if (isMetricBenchmark(benchmarkKey)) {
        const metricKey = benchmarkKey.slice(METRIC_BENCHMARK_PREFIX.length);
        const { rows } = await client.query<{ value_type: string }>(
          `SELECT value_type FROM hsdg.analytics_metric_definition
            WHERE metric_key = $1 ORDER BY version DESC LIMIT 1`,
          [metricKey],
        );
        if (rows[0]?.value_type !== 'amount') {
          throw new BadRequestException(
            `"${metricKey}" is not an amount metric in the 03.2 analytics library.`,
          );
        }
      }

      const version = (latest?.version ?? 0) + 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.materiality_methodology_rule
           (rule_code, version, kind, name, benchmark_key, benchmark_label, attention_criterion,
            low_pct, high_pct, parameter_value, industry_profiles, circumstances, considerations,
            source_basis, provisional, override_attention, effective_from, effective_to, active,
            methodology_version, change_note, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 COALESCE($17::date, DATE '2000-01-01'), $18::date, $19, $20, $21, $22)
         RETURNING id`,
        [
          input.ruleCode,
          version,
          kind,
          input.name.trim(),
          benchmarkKey,
          benchmarkLabel,
          criterion,
          lowPct,
          highPct,
          parameterValue,
          industryProfiles,
          circumstances,
          uniq(input.considerations ?? latest?.considerations),
          input.sourceBasis.trim(),
          input.provisional ?? latest?.provisional ?? true,
          overrideAttention,
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
        action: 'materiality_methodology_rule.version_added',
        objectType: 'materiality_methodology_rule',
        objectId: id,
        after: { ruleCode: input.ruleCode, kind, version, active: input.active ?? true },
      });
      return toRule((await client.query<RuleRow>(`${RULE_SELECT} WHERE t.id = $1`, [id])).rows[0]!);
    });
  }
}
