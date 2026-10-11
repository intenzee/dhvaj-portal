import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  PLANNING_ATTENTIONS,
  PLANNING_CHANGE_CATEGORIES,
  type CreatePlanningConsiderationRuleVersionInput,
  type PlanningAttention,
  type PlanningConsiderationKind,
  type PlanningConsiderationRuleRecord,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import type { PlanningConsiderationRule } from './planning-considerations-generation';

interface RuleRow {
  id: string;
  rule_code: string;
  version: number;
  consideration_key: string;
  kind: PlanningConsiderationKind;
  label: string;
  basis: string;
  match_rule_keys: string[];
  match_change_categories: string[];
  match_attention: PlanningAttention[];
  effective_from: string;
  effective_to: string | null;
  active: boolean;
  methodology_version: string;
  change_note: string | null;
  created_by_name: string | null;
  created_at: Date;
}

const RULE_SELECT = `
  SELECT r.id, r.rule_code, r.version, r.consideration_key, r.kind, r.label, r.basis,
         r.match_rule_keys, r.match_change_categories, r.match_attention,
         r.effective_from::text, r.effective_to::text, r.active, r.methodology_version,
         r.change_note, e.full_name AS created_by_name, r.created_at
    FROM hsdg.planning_consideration_rule r
    LEFT JOIN hsdg.employees e ON e.id = r.created_by_employee_id`;
// The engine never shows the creator, so it skips the employees join — that
// table's per-row RLS (shares_engagement_with) grows with the firm's engagements.
const ENGINE_SELECT = `
  SELECT r.id, r.rule_code, r.version, r.consideration_key, r.kind, r.label, r.basis,
         r.match_rule_keys, r.match_change_categories, r.match_attention,
         r.effective_from::text, r.effective_to::text, r.active, r.methodology_version,
         r.change_note, NULL::text AS created_by_name, r.created_at
    FROM hsdg.planning_consideration_rule r`;

function toRule(r: RuleRow): PlanningConsiderationRule {
  return {
    ruleCode: r.rule_code,
    version: r.version,
    considerationKey: r.consideration_key,
    kind: r.kind,
    label: r.label,
    basis: r.basis,
    matchRuleKeys: r.match_rule_keys ?? [],
    matchChangeCategories: r.match_change_categories ?? [],
    matchAttention: r.match_attention ?? [],
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    active: r.active,
  };
}

/** Every version of every Strategic Consideration Library rule, as the engine reads them. */
export async function readConsiderationRulesOn(
  client: PoolClient,
): Promise<PlanningConsiderationRule[]> {
  const { rows } = await client.query<RuleRow>(`${ENGINE_SELECT} ORDER BY r.rule_code, r.version`);
  return rows.map(toRule);
}

function toRecord(r: RuleRow): PlanningConsiderationRuleRecord {
  return {
    id: r.id,
    ruleCode: r.rule_code,
    version: r.version,
    considerationKey: r.consideration_key,
    kind: r.kind,
    label: r.label,
    basis: r.basis,
    matchRuleKeys: r.match_rule_keys ?? [],
    matchChangeCategories: r.match_change_categories ?? [],
    matchAttention: r.match_attention ?? [],
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    active: r.active,
    methodologyVersion: r.methodology_version,
    changeNote: r.change_note,
    createdByName: r.created_by_name,
    createdAt: r.created_at.toISOString(),
  };
}

const uniq = (xs: readonly string[] | undefined) => [
  ...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean)),
];

/**
 * Strategic Consideration Library administration (DHVAJ 03.1 §13.2–13.3, §21):
 * which signals prompt a timing or resource consideration, and its wording,
 * are configuration maintained by the Managing Partner / administrator without
 * a deployment. Every change appends a version; a generated consideration
 * keeps the rule code + version it came from.
 */
@Injectable()
export class PlanningConsiderationLibraryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RlsContext): Promise<PlanningConsiderationRuleRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<RuleRow>(
        `${RULE_SELECT} ORDER BY r.rule_code, r.version DESC`,
      );
      return rows.map(toRecord);
    });
  }

  addVersion(
    ctx: RlsContext,
    input: CreatePlanningConsiderationRuleVersionInput,
  ): Promise<PlanningConsiderationRuleRecord> {
    const ruleKeys = uniq(input.matchRuleKeys);
    const categories = uniq(input.matchChangeCategories);
    const attention = uniq(input.matchAttention) as PlanningAttention[];
    if (!ruleKeys.length && !categories.length && !attention.length) {
      throw new BadRequestException(
        'A consideration rule needs at least one signal rule key, change category or attention.',
      );
    }
    // "No significant change" never raises a signal, so it can't prompt anything.
    const badCategory = categories.find(
      (c) =>
        c === 'no_significant_change' ||
        !(PLANNING_CHANGE_CATEGORIES as readonly string[]).includes(c),
    );
    if (badCategory) throw new BadRequestException(`Unknown change category "${badCategory}".`);
    if (attention.some((a) => !PLANNING_ATTENTIONS.includes(a))) {
      throw new BadRequestException('Unknown attention level.');
    }
    if (input.effectiveTo && input.effectiveFrom && input.effectiveTo < input.effectiveFrom) {
      throw new BadRequestException('The effective-to date is before the effective-from date.');
    }

    return this.db.withRlsContext(ctx, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('planning_consideration_rule'))`);
      const { rows: existing } = await client.query<{
        consideration_key: string;
        kind: PlanningConsiderationKind;
        version: number;
      }>(
        `SELECT consideration_key, kind, version
           FROM hsdg.planning_consideration_rule WHERE rule_code = $1
          ORDER BY version DESC LIMIT 1`,
        [input.ruleCode],
      );
      const latest = existing[0];
      // The key is the generated consideration's idempotency key — it never changes.
      const key = latest?.consideration_key ?? input.considerationKey?.trim();
      if (!key) throw new BadRequestException('A new consideration rule needs a key.');
      if (latest && input.considerationKey && input.considerationKey !== key) {
        throw new BadRequestException(
          `The consideration key of ${input.ruleCode} is "${key}" and cannot change.`,
        );
      }
      // Timing vs resource routes the consideration (03.11 vs 03.8); a kind change is a new rule.
      if (latest && input.kind !== latest.kind) {
        throw new BadRequestException(
          `${input.ruleCode} is a ${latest.kind} consideration; add a new rule for a ${input.kind} one.`,
        );
      }
      if (!latest) {
        const { rows: clash } = await client.query(
          `SELECT 1 FROM hsdg.planning_consideration_rule WHERE consideration_key = $1 LIMIT 1`,
          [key],
        );
        if (clash[0]) throw new ConflictException(`Consideration key "${key}" is already in use.`);
      }
      if (ruleKeys.length) {
        const { rows: known } = await client.query<{ rule_key: string }>(
          `SELECT DISTINCT rule_key FROM hsdg.planning_signal_rule WHERE rule_key = ANY($1::text[])`,
          [ruleKeys],
        );
        const missing = ruleKeys.filter((k) => !known.some((r) => r.rule_key === k));
        if (missing.length) {
          throw new BadRequestException(
            `Unknown Planning Signal Library rule key(s): ${missing.join(', ')}.`,
          );
        }
      }

      const version = (latest?.version ?? 0) + 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.planning_consideration_rule
           (rule_code, version, consideration_key, kind, label, basis, match_rule_keys,
            match_change_categories, match_attention, effective_from, effective_to, active,
            methodology_version, change_note, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 COALESCE($10::date, DATE '2000-01-01'), $11::date, $12,
                 COALESCE($13, 'DHVAJ-M1'), $14, $15)
         RETURNING id`,
        [
          input.ruleCode,
          version,
          key,
          input.kind,
          input.label.trim(),
          input.basis.trim(),
          ruleKeys,
          categories,
          attention,
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
        action: 'planning_consideration_rule.version_added',
        objectType: 'planning_consideration_rule',
        objectId: id,
        after: { ruleCode: input.ruleCode, version, active: input.active ?? true },
      });
      const { rows: out } = await client.query<RuleRow>(`${RULE_SELECT} WHERE r.id = $1`, [id]);
      return toRecord(out[0]!);
    });
  }
}
