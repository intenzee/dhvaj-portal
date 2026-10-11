import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  PLANNING_DESTINATIONS,
  type CreatePlanningSignalRuleVersionInput,
  type PlanningAttention,
  type PlanningDestination,
  type PlanningRuleTriggerSource,
  type PlanningSignalRuleRecord,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import {
  canonicalJson,
  conditionFacts,
  conditionProblem,
  isUsableRule,
  type PlanningSignalRule,
  type RuleCondition,
} from './planning-signal-library';

interface RuleRow {
  id: string;
  rule_code: string;
  version: number;
  rule_key: string;
  name: string;
  trigger_source: PlanningRuleTriggerSource;
  trigger_section: string;
  trigger_condition: Record<string, unknown>;
  condition_version: number;
  observation_template: string;
  why_may_matter: string;
  potential_implications: string;
  guidance_anchors: string[];
  destinations: PlanningDestination[];
  suggested_attention: PlanningAttention;
  source_link: string | null;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
  methodology_version: string;
  change_note: string | null;
  created_by_name: string | null;
  created_at: Date;
}

const RULE_SELECT = `
  SELECT r.id, r.rule_code, r.version, r.rule_key, r.name, r.trigger_source,
         r.trigger_section, r.trigger_condition, r.condition_version,
         r.observation_template, r.why_may_matter, r.potential_implications,
         r.guidance_anchors, r.destinations, r.suggested_attention, r.source_link,
         r.effective_from::text, r.effective_to::text, r.active, r.methodology_version,
         r.change_note, e.full_name AS created_by_name, r.created_at
    FROM hsdg.planning_signal_rule r
    LEFT JOIN hsdg.employees e ON e.id = r.created_by_employee_id`;

function toRule(r: RuleRow): PlanningSignalRule {
  return {
    ruleCode: r.rule_code,
    version: r.version,
    ruleKey: r.rule_key,
    name: r.name,
    triggerSource: r.trigger_source,
    triggerSection: r.trigger_section,
    condition: r.trigger_condition as unknown as RuleCondition,
    conditionVersion: r.condition_version,
    observationTemplate: r.observation_template,
    whyMayMatter: r.why_may_matter,
    potentialImplications: r.potential_implications,
    guidanceAnchors: r.guidance_anchors ?? [],
    destinations: r.destinations ?? [],
    suggestedAttention: r.suggested_attention,
    sourceLink: r.source_link,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    active: r.active,
  };
}

/**
 * Every version of every Planning Signal Library rule, as the engine reads
 * them. DI-free; a malformed row is skipped rather than allowed to misfire.
 */
export async function readSignalRulesOn(client: PoolClient): Promise<PlanningSignalRule[]> {
  const { rows } = await client.query<RuleRow>(`${RULE_SELECT} ORDER BY r.rule_code, r.version`);
  return rows.map(toRule).filter(isUsableRule);
}

function toRecord(r: RuleRow): PlanningSignalRuleRecord {
  return {
    id: r.id,
    ruleCode: r.rule_code,
    version: r.version,
    ruleKey: r.rule_key,
    name: r.name,
    triggerSource: r.trigger_source,
    triggerSection: r.trigger_section,
    triggerCondition: r.trigger_condition,
    conditionVersion: r.condition_version,
    observationTemplate: r.observation_template,
    whyMayMatter: r.why_may_matter,
    potentialImplications: r.potential_implications,
    guidanceAnchors: r.guidance_anchors ?? [],
    destinations: r.destinations ?? [],
    suggestedAttention: r.suggested_attention,
    sourceLink: r.source_link,
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
 * Planning Signal Library administration (DHVAJ 03.1 §21): rules, conditions,
 * wording, guidance and effective periods are configuration, maintained by the
 * Managing Partner / administrator without a deployment. Every change appends a
 * version; a fired signal keeps the rule code + version it fired under.
 */
@Injectable()
export class PlanningSignalLibraryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RlsContext): Promise<PlanningSignalRuleRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<RuleRow>(
        `${RULE_SELECT} ORDER BY r.rule_code, r.version DESC`,
      );
      return rows.map(toRecord);
    });
  }

  addVersion(
    ctx: RlsContext,
    input: CreatePlanningSignalRuleVersionInput,
  ): Promise<PlanningSignalRuleRecord> {
    const problem = conditionProblem(input.triggerCondition);
    if (problem) throw new BadRequestException(`Trigger condition: ${problem}`);
    const condition = input.triggerCondition as unknown as RuleCondition;
    const isChange = input.triggerSource === 'current_year_change';
    if (isChange !== conditionFacts(condition).includes('change_category')) {
      throw new BadRequestException(
        isChange
          ? 'A current-year change rule must test the "change_category" fact.'
          : 'Only a current-year change rule may test "change_category".',
      );
    }
    const destinations = input.destinations ?? [];
    if (destinations.some((d) => !PLANNING_DESTINATIONS.includes(d))) {
      throw new BadRequestException('Unknown carry-forward destination.');
    }
    if (input.effectiveTo && input.effectiveFrom && input.effectiveTo < input.effectiveFrom) {
      throw new BadRequestException('The effective-to date is before the effective-from date.');
    }

    return this.db.withRlsContext(ctx, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('planning_signal_rule'))`);
      const { rows: existing } = await client.query<{
        rule_key: string;
        version: number;
        condition: Record<string, unknown>;
        condition_version: number;
      }>(
        `SELECT rule_key, version, trigger_condition AS condition, condition_version
           FROM hsdg.planning_signal_rule WHERE rule_code = $1
          ORDER BY version DESC LIMIT 1`,
        [input.ruleCode],
      );
      const latest = existing[0];
      // The rule key is the signal's idempotency key and 03.5's link — it never changes.
      const ruleKey = latest?.rule_key ?? input.ruleKey?.trim();
      if (!ruleKey) throw new BadRequestException('A new rule needs a rule key.');
      if (latest && input.ruleKey && input.ruleKey !== latest.rule_key) {
        throw new BadRequestException(
          `The rule key of ${input.ruleCode} is "${latest.rule_key}" and cannot change.`,
        );
      }
      if (!latest) {
        const { rows: clash } = await client.query(
          `SELECT 1 FROM hsdg.planning_signal_rule WHERE rule_key = $1 LIMIT 1`,
          [ruleKey],
        );
        if (clash[0]) throw new ConflictException(`Rule key "${ruleKey}" is already in use.`);
      }

      const anchors = [...new Set(input.guidanceAnchors ?? [])];
      if (anchors.length) {
        const { rows: known } = await client.query<{ anchor: string }>(
          `SELECT anchor FROM hsdg.authority_reference_link
            WHERE context_key = '03.1' AND anchor = ANY($1::text[])`,
          [anchors],
        );
        const missing = anchors.filter((a) => !known.some((k) => k.anchor === a));
        if (missing.length) {
          throw new BadRequestException(`Unknown 03.1 guidance anchor(s): ${missing.join(', ')}.`);
        }
      }

      const conditionChanged =
        !latest || canonicalJson(latest.condition) !== canonicalJson(input.triggerCondition);
      const conditionVersion = latest ? latest.condition_version + (conditionChanged ? 1 : 0) : 1;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.planning_signal_rule
           (rule_code, version, rule_key, name, trigger_source, trigger_section,
            trigger_condition, condition_version, observation_template, why_may_matter,
            potential_implications, guidance_anchors, destinations, suggested_attention,
            source_link, effective_from, effective_to, active, methodology_version,
            change_note, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 COALESCE($16::date, DATE '2000-01-01'), $17::date, $18,
                 COALESCE($19, 'DHVAJ-M1'), $20, $21)
         RETURNING id`,
        [
          input.ruleCode,
          (latest?.version ?? 0) + 1,
          ruleKey,
          input.name.trim(),
          input.triggerSource,
          input.triggerSection,
          JSON.stringify(input.triggerCondition),
          conditionVersion,
          input.observationTemplate.trim(),
          input.whyMayMatter.trim(),
          input.potentialImplications.trim(),
          anchors,
          destinations,
          input.suggestedAttention,
          input.sourceLink?.trim() || null,
          input.effectiveFrom ?? null,
          input.effectiveTo ?? null,
          input.active ?? true,
          input.methodologyVersion?.trim() || null,
          input.changeNote.trim(),
          ctx.employeeId ?? null,
        ],
      );
      const id = rows[0]!.id;
      await this.audit.recordWith(client, ctx, {
        action: 'planning_signal_rule.version_added',
        objectType: 'planning_signal_rule',
        objectId: id,
        after: {
          ruleCode: input.ruleCode,
          version: (latest?.version ?? 0) + 1,
          active: input.active ?? true,
          conditionChanged,
        },
      });
      const { rows: out } = await client.query<RuleRow>(`${RULE_SELECT} WHERE r.id = $1`, [id]);
      return toRecord(out[0]!);
    });
  }
}
