import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  PROFILE_STATE,
  SMALL_COMPANY_OUTCOME,
  auditPeriodStartFromFinancialYear,
  type AccountingEnvironment,
  type CaptureProfileFinancialInput,
  type ProfileClassification,
  type ProfileFinancialRecord,
  type ProfileFinancialSource,
  type SaTrigger,
  type SmallCompanyAssessment,
  type SmallCompanyOutcome,
  type SpecialEntityType,
  type StatutoryAuditEntityProfile,
  type UpdateEntityProfileInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { assessSmallCompany, deriveSaTriggers, type SmallCompanyFacts } from './entity-profile';

/** Relationship types that make an entity a holding OR subsidiary (§2(85)). */
const HOLDING_SUBSIDIARY_TYPES = [
  'holding',
  'subsidiary',
  'wholly_owned_subsidiary',
  'step_down_subsidiary',
  'fellow_subsidiary',
  'ultimate_holding',
  'intermediate_holding',
];

interface ProfileRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: 'draft' | 'confirmed';
  special_entity_types: string[];
  initial_audit: boolean;
  initial_audit_derived: boolean;
  joint_audit: boolean;
  accounting_environment: AccountingEnvironment | null;
  small_company_outcome: SmallCompanyOutcome | null;
  small_company_basis: string | null;
  small_company_rule_version_id: string | null;
  small_company_provision_id: string | null;
  sa510_flag: boolean;
  sa402_flag: boolean;
  sa299_flag: boolean;
  methodology_version: string | null;
  confirmed_by_name: string | null;
  confirmed_at: Date | null;
  needs_reevaluation: boolean;
  version: number;
  financial_year: string | null;
}

interface FinancialRow {
  id: string;
  profile_id: string;
  parameter: ProfileFinancialRecord['parameter'];
  current_value: string | null;
  prior_value: string | null;
  source: ProfileFinancialSource | null;
  preparer: string | null;
  document_id: string | null;
  version: number;
  updated_at: Date;
}

/** The effective facts derived from masters + captured data for one profile. */
interface EffectiveFacts extends SmallCompanyFacts {
  classification: ProfileClassification;
  groupHasRelationships: boolean;
  initialAudit: boolean;
  auditPeriodStart: string;
}

/**
 * 02.1 Entity & Regulatory Profile service (Implementation Guide §9.1) — THE FACT
 * FOUNDATION. One confirmable profile per statutory-audit shell that:
 *   • confirms the read-only master classification / group / financial facts,
 *   • COMPUTES the Small Company status from the §2(85) rule version (never a
 *     checkbox), rendering the actual limits + provision,
 *   • carries the SA 510 / 402 / 299 triggers forward, and
 *   • on CONFIRM PROFILE freezes a fact snapshot + methodology version for
 *     02.2–02.9, so no fact is re-asked downstream.
 *
 * Mirrors the acceptance service conventions (RLS ctx, optimistic version,
 * idempotent self-healing seed, immutable audit events).
 */
@Injectable()
export class AuditProfileService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
  ) {}

  // ── Seed (called by provisioning; idempotent, self-healing) ─────────────────

  /** Seed the profile row for a shell. Safe to repeat (ON CONFLICT). */
  async seedProfileOn(
    client: PoolClient,
    workflowInstanceId: string,
    engagementId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.audit_entity_profile (workflow_instance_id, engagement_id)
       SELECT $1::uuid, $2::uuid
        WHERE hsdg.is_engagement_lead($2::uuid) -- lead-only insert (RLS); others read or 404
       ON CONFLICT (workflow_instance_id) DO NOTHING`,
      [workflowInstanceId, engagementId],
    );
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditEntityProfile[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      // Self-heal: seed a profile for any shell provisioned before this phase.
      const { rows: shells } = await client.query<{ id: string }>(
        `SELECT swi.id
           FROM hsdg.service_workflow_instances swi
          WHERE swi.engagement_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM hsdg.audit_entity_profile p
               WHERE p.workflow_instance_id = swi.id)`,
        [engagementId],
      );
      for (const s of shells) await this.seedProfileOn(client, s.id, engagementId);
      return this.readProfiles(client, engagementId);
    });
  }

  private async readProfiles(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditEntityProfile[]> {
    const { rows: profiles } = await client.query<ProfileRow>(
      `SELECT p.id, p.workflow_instance_id, swi.engagement_service_id, p.engagement_id, p.state,
              p.special_entity_types, p.initial_audit, p.initial_audit_derived, p.joint_audit,
              p.accounting_environment, p.small_company_outcome, p.small_company_basis,
              p.small_company_rule_version_id, p.small_company_provision_id,
              p.sa510_flag, p.sa402_flag, p.sa299_flag, p.methodology_version,
              emp.full_name AS confirmed_by_name, p.confirmed_at, p.needs_reevaluation,
              p.version, e.financial_year
         FROM hsdg.audit_entity_profile p
         JOIN hsdg.service_workflow_instances swi ON swi.id = p.workflow_instance_id
         JOIN hsdg.engagements e ON e.id = p.engagement_id
         LEFT JOIN hsdg.employees emp ON emp.id = p.confirmed_by_employee_id
        WHERE p.engagement_id = $1
        ORDER BY swi.created_at ASC`,
      [engagementId],
    );
    if (profiles.length === 0) return [];

    const profileIds = profiles.map((p) => p.id);
    const { rows: financials } = await client.query<FinancialRow>(
      `SELECT id, profile_id, parameter, current_value::text, prior_value::text, source,
              preparer, document_id, version, updated_at
         FROM hsdg.audit_profile_financials
        WHERE profile_id = ANY($1::uuid[])
        ORDER BY parameter ASC`,
      [profileIds],
    );

    const out: StatutoryAuditEntityProfile[] = [];
    for (const p of profiles) {
      const fins = financials.filter((f) => f.profile_id === p.id);
      const facts = await this.deriveFacts(client, engagementId, p, fins);

      // A confirmed profile shows its FROZEN assessment; a draft computes live.
      let smallCompany: SmallCompanyAssessment;
      let saTriggers: SaTrigger[];
      if (p.state === PROFILE_STATE.confirmed && p.small_company_outcome) {
        smallCompany = {
          outcome: p.small_company_outcome,
          basis: p.small_company_basis ?? '',
          ruleVersionId: p.small_company_rule_version_id,
          authorityProvisionId: p.small_company_provision_id,
        };
        saTriggers = [
          { code: 'SA 510', triggered: p.sa510_flag, basis: saBasis510(p.sa510_flag) },
          { code: 'SA 402', triggered: p.sa402_flag, basis: saBasis402(p.sa402_flag) },
          { code: 'SA 299', triggered: p.sa299_flag, basis: saBasis299(p.sa299_flag) },
        ];
      } else {
        const resolve = await this.rules.buildResolverOn(client, facts.auditPeriodStart);
        smallCompany = assessSmallCompany(facts, resolve);
        saTriggers = deriveSaTriggers({
          initialAudit: facts.initialAudit,
          accountingEnvironment: p.accounting_environment,
          jointAudit: p.joint_audit,
        });
      }

      const missingFacts = this.missingFacts(facts, smallCompany);
      out.push({
        workflowInstanceId: p.workflow_instance_id,
        engagementServiceId: p.engagement_service_id,
        engagementId: p.engagement_id,
        state: p.state,
        financialYear: p.financial_year,
        classification: facts.classification,
        specialEntityTypes: (p.special_entity_types ?? []) as SpecialEntityType[],
        groupHasRelationships: facts.groupHasRelationships,
        initialAudit: facts.initialAudit,
        initialAuditSystemDerived: p.initial_audit_derived,
        jointAudit: p.joint_audit,
        accountingEnvironment: p.accounting_environment,
        financials: fins.map(mapFinancial),
        smallCompany,
        saTriggers,
        confirmation:
          p.state === PROFILE_STATE.confirmed && p.confirmed_at
            ? {
                methodologyVersion: p.methodology_version,
                confirmedByName: p.confirmed_by_name,
                confirmedAt: p.confirmed_at.toISOString(),
              }
            : null,
        needsReevaluation: p.needs_reevaluation,
        missingFacts,
        readyToConfirm: missingFacts.length === 0,
        version: p.version,
      });
    }
    return out;
  }

  /** Derive the effective facts from masters + captured financials for a profile. */
  private async deriveFacts(
    client: PoolClient,
    engagementId: string,
    p: ProfileRow,
    financials: FinancialRow[],
  ): Promise<EffectiveFacts> {
    const classification: ProfileClassification = {
      entityTypeName: null,
      category: null,
      isCompany: null,
      isPrivateCompany: null,
      isListed: false,
    };

    const type = await client.query<{ name: string; slug: string; category: string }>(
      `SELECT et.name, et.slug, et.category
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
        WHERE e.id = $1`,
      [engagementId],
    );
    if (type.rows[0]) {
      classification.entityTypeName = type.rows[0].name;
      classification.category = type.rows[0].category;
      classification.isCompany = type.rows[0].category === 'company';
      classification.isPrivateCompany = ['private_limited', 'opc'].includes(type.rows[0].slug);
    }

    const listed = await client.query(
      `SELECT 1 FROM hsdg.entity_listings l
         JOIN hsdg.engagements e ON e.entity_id = l.entity_id
        WHERE e.id = $1 AND l.status = 'listed' LIMIT 1`,
      [engagementId],
    );
    classification.isListed = (listed.rowCount ?? 0) > 0;

    const anyRel = await client.query(
      `SELECT 1 FROM hsdg.entity_relationships r
         JOIN hsdg.engagements e ON e.entity_id IN (r.from_entity_id, r.to_entity_id)
        WHERE e.id = $1 AND r.status = 'active' LIMIT 1`,
      [engagementId],
    );
    const groupHasRelationships = (anyRel.rowCount ?? 0) > 0;

    const holdSub = await client.query(
      `SELECT 1 FROM hsdg.entity_relationships r
         JOIN hsdg.engagements e ON e.entity_id IN (r.from_entity_id, r.to_entity_id)
        WHERE e.id = $1 AND r.status = 'active'
          AND r.relationship_type = ANY($2::text[]) LIMIT 1`,
      [engagementId, HOLDING_SUBSIDIARY_TYPES],
    );
    const isHoldingOrSubsidiary = (holdSub.rowCount ?? 0) > 0;

    // Deciding financials: prefer the profile's captured figure, fall back to the
    // entity master's current figure so a value entered elsewhere is not re-asked.
    const captured = new Map(financials.map((f) => [f.parameter, num(f.current_value)]));
    let paidUpCapital = captured.get('paid_up_capital') ?? null;
    let turnover = captured.get('turnover') ?? null;
    if (paidUpCapital == null || turnover == null) {
      const fin = await client.query<{ paid_up_capital: string | null; turnover: string | null }>(
        `SELECT fp.paid_up_capital, fp.turnover
           FROM hsdg.entity_financial_profiles fp
           JOIN hsdg.engagements e ON e.entity_id = fp.entity_id
          WHERE e.id = $1 AND fp.is_current
          LIMIT 1`,
        [engagementId],
      );
      if (fin.rows[0]) {
        paidUpCapital = paidUpCapital ?? num(fin.rows[0].paid_up_capital);
        turnover = turnover ?? num(fin.rows[0].turnover);
      }
    }

    // Initial vs continuing: system-derived from engagement history until a lead
    // overrides it (initial_audit_derived flips false on override).
    let initialAudit = p.initial_audit;
    if (p.initial_audit_derived) {
      const prior = await client.query(
        `SELECT 1
           FROM hsdg.service_workflow_instances swi
           JOIN hsdg.engagements e2 ON e2.id = swi.engagement_id
          WHERE swi.workflow_key = 'statutory_audit'
            AND swi.id <> $1
            AND e2.entity_id = (SELECT entity_id FROM hsdg.engagements WHERE id = $2)
            AND e2.financial_year < COALESCE($3, e2.financial_year)
          LIMIT 1`,
        [p.workflow_instance_id, engagementId, p.financial_year],
      );
      initialAudit = (prior.rowCount ?? 0) === 0;
    }

    const auditPeriodStart = p.financial_year
      ? auditPeriodStartFromFinancialYear(p.financial_year)
      : new Date().toISOString().slice(0, 10);

    return {
      classification,
      groupHasRelationships,
      isCompany: classification.isCompany,
      isPrivateCompany: classification.isCompany ? classification.isPrivateCompany : false,
      isHoldingOrSubsidiary,
      specialEntityTypes: (p.special_entity_types ?? []) as SpecialEntityType[],
      paidUpCapital,
      turnover,
      initialAudit,
      auditPeriodStart,
    };
  }

  private missingFacts(facts: EffectiveFacts, sc: SmallCompanyAssessment): string[] {
    const missing: string[] = [];
    if (facts.classification.isCompany == null)
      missing.push('Entity classification not confirmed.');
    if (sc.outcome === SMALL_COMPANY_OUTCOME.pending)
      missing.push('Small Company status cannot be computed yet (paid-up capital / turnover).');
    return missing;
  }

  // ── Update captured facts (Cards B / G / H / I) ─────────────────────────────

  async updateProfile(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: UpdateEntityProfileInput,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      this.assertEditable(current);

      const specialEntityTypes = input.specialEntityTypes ?? current.special_entity_types;
      const jointAudit = input.jointAudit ?? current.joint_audit;
      const accountingEnvironment =
        input.accountingEnvironment !== undefined
          ? input.accountingEnvironment
          : current.accounting_environment;
      // Overriding initialAudit turns off the system-derived flag; leaving it
      // unset keeps the derived value live.
      const overrideInitial = input.initialAudit !== undefined;
      const initialAudit = overrideInitial ? input.initialAudit! : current.initial_audit;
      const initialAuditDerived = overrideInitial ? false : current.initial_audit_derived;

      const result = await client.query(
        `UPDATE hsdg.audit_entity_profile
            SET special_entity_types = $3,
                joint_audit = $4,
                accounting_environment = $5,
                initial_audit = $6,
                initial_audit_derived = $7,
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          current.id,
          input.version,
          specialEntityTypes,
          jointAudit,
          accountingEnvironment,
          initialAudit,
          initialAuditDerived,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('This profile changed since you loaded it; refresh and retry.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_updated',
        objectType: 'audit_entity_profile',
        objectId: current.id,
        after: { specialEntityTypes, initialAudit, jointAudit, accountingEnvironment },
      });
      const [profile] = await this.readForShell(client, engagementId, workflowInstanceId);
      return profile!;
    });
  }

  // ── Capture a financial parameter (Card D) ──────────────────────────────────

  async captureFinancial(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CaptureProfileFinancialInput,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      this.assertEditable(current);

      if (input.documentId) {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2`,
          [input.documentId, engagementId],
        );
        if (!rows[0]) {
          throw new BadRequestException('The linked document does not belong to this engagement.');
        }
      }

      await client.query(
        `INSERT INTO hsdg.audit_profile_financials
           (profile_id, engagement_id, parameter, current_value, prior_value, source, preparer, document_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (profile_id, parameter) DO UPDATE
           SET current_value = EXCLUDED.current_value,
               prior_value = EXCLUDED.prior_value,
               source = EXCLUDED.source,
               preparer = EXCLUDED.preparer,
               document_id = EXCLUDED.document_id,
               version = hsdg.audit_profile_financials.version + 1`,
        [
          current.id,
          engagementId,
          input.parameter,
          input.currentValue ?? null,
          input.priorValue ?? null,
          input.source ?? null,
          input.preparer?.trim() || null,
          input.documentId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_financial_captured',
        objectType: 'audit_entity_profile',
        objectId: current.id,
        after: { parameter: input.parameter },
      });
      const [profile] = await this.readForShell(client, engagementId, workflowInstanceId);
      return profile!;
    });
  }

  // ── Confirm the profile — freezes the fact set for 02.2–02.9 (Completion) ────

  async confirm(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    _input: { note?: string | null },
  ): Promise<StatutoryAuditEntityProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      if (current.state === PROFILE_STATE.confirmed && !current.needs_reevaluation) {
        throw new ConflictException('The profile is already confirmed.');
      }

      const fins = await this.loadFinancials(client, current.id);
      const facts = await this.deriveFacts(client, engagementId, current, fins);
      const resolve = await this.rules.buildResolverOn(client, facts.auditPeriodStart);
      const smallCompany = assessSmallCompany(facts, resolve);
      const saTriggers = deriveSaTriggers({
        initialAudit: facts.initialAudit,
        accountingEnvironment: current.accounting_environment,
        jointAudit: current.joint_audit,
      });

      const missing = this.missingFacts(facts, smallCompany);
      if (missing.length > 0) {
        throw new BadRequestException(
          `Cannot confirm the profile — resolve first: ${missing.join(' ')}`,
        );
      }

      const methodologyVersion = await this.resolveMethodologyVersion(
        client,
        facts.auditPeriodStart,
      );
      const flag = (code: string) => saTriggers.find((t) => t.code === code)?.triggered ?? false;
      const snapshot = {
        classification: facts.classification,
        specialEntityTypes: facts.specialEntityTypes,
        groupHasRelationships: facts.groupHasRelationships,
        initialAudit: facts.initialAudit,
        jointAudit: current.joint_audit,
        accountingEnvironment: current.accounting_environment,
        paidUpCapital: facts.paidUpCapital,
        turnover: facts.turnover,
        smallCompany,
        saTriggers,
        financials: fins.map(mapFinancial),
      };

      await client.query(
        `UPDATE hsdg.audit_entity_profile
            SET state = 'confirmed',
                initial_audit = $2,
                small_company_outcome = $3,
                small_company_basis = $4,
                small_company_rule_version_id = $5,
                small_company_provision_id = $6,
                sa510_flag = $7, sa402_flag = $8, sa299_flag = $9,
                methodology_version = $10,
                snapshot = $11::jsonb,
                confirmed_by_employee_id = $12,
                confirmed_at = now(),
                needs_reevaluation = false,
                version = version + 1
          WHERE id = $1`,
        [
          current.id,
          facts.initialAudit,
          smallCompany.outcome,
          smallCompany.basis,
          smallCompany.ruleVersionId,
          smallCompany.authorityProvisionId,
          flag('SA 510'),
          flag('SA 402'),
          flag('SA 299'),
          methodologyVersion,
          JSON.stringify(snapshot),
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_confirmed',
        objectType: 'audit_entity_profile',
        objectId: current.id,
        after: {
          smallCompany: smallCompany.outcome,
          methodologyVersion,
          sa510: flag('SA 510'),
          sa402: flag('SA 402'),
          sa299: flag('SA 299'),
        },
      });
      const [profile] = await this.readForShell(client, engagementId, workflowInstanceId);
      return profile!;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async readForShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditEntityProfile[]> {
    const all = await this.readProfiles(client, engagementId);
    return all.filter((p) => p.workflowInstanceId === workflowInstanceId);
  }

  private async loadProfile(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<ProfileRow> {
    await this.seedProfileOn(client, workflowInstanceId, engagementId);
    // Every caller mutates: lock first so confirm cannot interleave with an edit
    // (the confirmed snapshot must match the stored financials).
    await client.query(
      `SELECT 1 FROM hsdg.audit_entity_profile
        WHERE workflow_instance_id = $1 AND engagement_id = $2 FOR UPDATE`,
      [workflowInstanceId, engagementId],
    );
    const { rows } = await client.query<ProfileRow>(
      `SELECT p.id, p.workflow_instance_id, swi.engagement_service_id, p.engagement_id, p.state,
              p.special_entity_types, p.initial_audit, p.initial_audit_derived, p.joint_audit,
              p.accounting_environment, p.small_company_outcome, p.small_company_basis,
              p.small_company_rule_version_id, p.small_company_provision_id,
              p.sa510_flag, p.sa402_flag, p.sa299_flag, p.methodology_version,
              NULL::text AS confirmed_by_name, p.confirmed_at, p.needs_reevaluation,
              p.version, e.financial_year
         FROM hsdg.audit_entity_profile p
         JOIN hsdg.service_workflow_instances swi ON swi.id = p.workflow_instance_id
         JOIN hsdg.engagements e ON e.id = p.engagement_id
        WHERE p.workflow_instance_id = $1 AND p.engagement_id = $2`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    }
    return rows[0];
  }

  private async loadFinancials(client: PoolClient, profileId: string): Promise<FinancialRow[]> {
    const { rows } = await client.query<FinancialRow>(
      `SELECT id, profile_id, parameter, current_value::text, prior_value::text, source,
              preparer, document_id, version, updated_at
         FROM hsdg.audit_profile_financials
        WHERE profile_id = $1`,
      [profileId],
    );
    return rows;
  }

  private async resolveMethodologyVersion(
    client: PoolClient,
    auditPeriodStart: string,
  ): Promise<string | null> {
    const { rows } = await client.query<{ methodology_version: string }>(
      `SELECT methodology_version
         FROM hsdg.audit_ruleset_version
        WHERE effective_from <= $1::date
          AND (effective_to IS NULL OR effective_to > $1::date)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [auditPeriodStart],
    );
    return rows[0]?.methodology_version ?? null;
  }

  private assertEditable(p: ProfileRow): void {
    if (p.state === PROFILE_STATE.confirmed && !p.needs_reevaluation) {
      throw new ConflictException(
        'The profile is confirmed; a controlled reassessment must reopen it before editing.',
      );
    }
  }
}

function mapFinancial(f: FinancialRow): ProfileFinancialRecord {
  return {
    id: f.id,
    parameter: f.parameter,
    currentValue: num(f.current_value),
    priorValue: num(f.prior_value),
    source: f.source,
    preparer: f.preparer,
    documentId: f.document_id,
    version: f.version,
    updatedAt: f.updated_at.toISOString(),
  };
}

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function saBasis510(t: boolean): string {
  return t
    ? 'Initial (first-year) audit — opening balances require SA 510 consideration.'
    : 'Continuing audit — SA 510 opening-balance procedures not triggered by first-year status.';
}
function saBasis402(t: boolean): string {
  return t
    ? 'A service organisation is involved in the accounting environment — SA 402 applies.'
    : 'Accounting is maintained in-house — SA 402 (service organisation) not triggered.';
}
function saBasis299(t: boolean): string {
  return t
    ? 'Joint audit — SA 299 (responsibility of joint auditors) applies.'
    : 'Sole audit — SA 299 not triggered.';
}
