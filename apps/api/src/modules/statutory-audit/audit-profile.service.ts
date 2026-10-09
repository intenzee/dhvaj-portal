import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ACCOUNTING_ENVIRONMENT_LABEL,
  ACCOUNTING_SOFTWARE_LABEL,
  COMPANY_TYPE_LABEL,
  MASTER_OWNED_SPECIAL_TYPES,
  PROFILE_CONFIRMATION_STATEMENT,
  PROFILE_FINANCIAL_LABEL,
  PROFILE_FINANCIAL_PARAMETERS,
  PROFILE_FINANCIAL_SOURCE_LABEL,
  PROFILE_STATE,
  REGULATOR_LABEL,
  REQUIRED_PROFILE_FINANCIALS,
  SECTION_02_NAV,
  SPECIAL_ENTITY_TYPES,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  isProfileFileSlot,
  type AccountingEnvironment,
  type AccountingSoftware,
  type AddProfileFileInput,
  type CaptureProfileFinancialInput,
  type ConfirmProfileCardInput,
  type ConfirmProfileInput,
  type JointAuditor,
  type LinkProfileFileInput,
  type ProfileClassification,
  type ProfileFileRecord,
  type ProfileFinancialParameter,
  type ProfileFinancialRecord,
  type ProfileFinancialRow,
  type ProfileFinancialSource,
  type ProfileFinancialValue,
  type ProfileSectionNavItem,
  type Regulator,
  type SaTrigger,
  type SectionNavStatus,
  type ServiceOrgAnswer,
  type SmallCompanyAssessment,
  type SmallCompanyDecisionInput,
  type SmallCompanyOutcome,
  type SpecialEntityType,
  type StatutoryAuditEntityProfile,
  type StatutoryAuditEntityProfileMasterFillResult,
  type UpdateEntityProfileInput,
  type YesNo,
  type YesNoPending,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { DocumentsService } from '../documents/documents.service';
import { assessSmallCompany, deriveSaTriggers, type SmallCompanyFacts } from './entity-profile';
import {
  auditPeriodOf,
  cardConfirmBlockers,
  cardFingerprint,
  changedTrackedFacts,
  companyTypeOf,
  downstreamSectionsFor,
  evaluateCompleteness,
  finalSmallCompanyOutcome,
  groupEntitiesOf,
  groupFlagsOf,
  priorYearChanges,
  trackedFactLabel,
  trackedFacts,
  usesServiceOrganisation,
  withCardConfirmations,
  type StoredCardConfirmations,
  type TrackedFacts,
  type WorkspaceFacts,
} from './entity-profile-workspace';
import { fillSpecialTypes, specialEntityTypesFromMaster } from './framework-facts-prefill';
import {
  fixFor,
  isEngagementLead,
  readEngagementMasterFacts,
  regulatoryProfileFacts,
  type EngagementMasterFacts,
} from './master-facts';

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

const PROFILE_COLUMNS = `
  p.id, p.workflow_instance_id, swi.engagement_service_id, p.engagement_id, p.state,
  p.special_entity_types, p.initial_audit, p.initial_audit_derived, p.joint_audit,
  p.accounting_environment, p.small_company_outcome, p.small_company_basis,
  p.small_company_rule_version_id, p.small_company_provision_id,
  p.small_company_system_outcome,
  p.sa510_flag, p.sa402_flag, p.sa299_flag, p.methodology_version, p.snapshot,
  p.confirmed_at, p.needs_reevaluation, p.version, e.financial_year,
  p.card_confirmations, p.listing_answer, p.listing_in_process, p.nbfc_category,
  p.regulator, p.regulator_name, p.regulator_details,
  p.small_company_override, p.small_company_override_reason,
  p.small_company_override_system_outcome, p.small_company_override_at,
  p.different_fy_approved, p.accounting_software, p.accounting_software_other,
  p.records_electronic, p.records_description, p.service_org, p.service_org_service,
  p.service_org_provider, p.joint_auditors, p.confirmation_note, p.confirmation_statement,
  p.reopened_reason, p.reopened_at, p.updated_at,
  cb.full_name AS confirmed_by_name, ob.full_name AS override_by_name,
  rb.full_name AS reopened_by_name, ub.full_name AS updated_by_name`;

const PROFILE_FROM = `
  FROM hsdg.audit_entity_profile p
  JOIN hsdg.service_workflow_instances swi ON swi.id = p.workflow_instance_id
  JOIN hsdg.engagements e ON e.id = p.engagement_id
  LEFT JOIN hsdg.employees cb ON cb.id = p.confirmed_by_employee_id
  LEFT JOIN hsdg.employees ob ON ob.id = p.small_company_override_by_employee_id
  LEFT JOIN hsdg.employees rb ON rb.id = p.reopened_by_employee_id
  LEFT JOIN hsdg.employees ub ON ub.id = p.updated_by_employee_id`;

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
  small_company_system_outcome: SmallCompanyOutcome | null;
  sa510_flag: boolean;
  sa402_flag: boolean;
  sa299_flag: boolean;
  methodology_version: string | null;
  snapshot: ProfileSnapshot | null;
  confirmed_at: Date | null;
  needs_reevaluation: boolean;
  version: number;
  financial_year: string | null;
  card_confirmations: StoredCardConfirmations | null;
  listing_answer: YesNoPending | null;
  listing_in_process: YesNoPending | null;
  nbfc_category: string | null;
  regulator: Regulator | null;
  regulator_name: string | null;
  regulator_details: string | null;
  small_company_override: SmallCompanyOutcome | null;
  small_company_override_reason: string | null;
  small_company_override_system_outcome: SmallCompanyOutcome | null;
  small_company_override_at: Date | null;
  different_fy_approved: YesNo | null;
  accounting_software: AccountingSoftware | null;
  accounting_software_other: string | null;
  records_electronic: YesNo | null;
  records_description: string | null;
  service_org: ServiceOrgAnswer | null;
  service_org_service: string | null;
  service_org_provider: string | null;
  joint_auditors: JointAuditor[] | null;
  confirmation_note: string | null;
  confirmation_statement: string | null;
  reopened_reason: string | null;
  reopened_at: Date | null;
  updated_at: Date;
  confirmed_by_name: string | null;
  override_by_name: string | null;
  reopened_by_name: string | null;
  updated_by_name: string | null;
}

interface FinancialRow {
  id: string;
  profile_id: string;
  parameter: ProfileFinancialParameter;
  current_value: string | null;
  prior_value: string | null;
  source: ProfileFinancialSource | null;
  preparer: string | null;
  document_id: string | null;
  master_current_at_capture: string | null;
  master_prior_at_capture: string | null;
  version: number;
  updated_at: Date;
}

/** What CONFIRM PROFILE freezes (jsonb). `tracked` drives change detection. */
interface ProfileSnapshot {
  tracked?: TrackedFacts;
  [key: string]: unknown;
}

/** The effective facts derived from masters + captured data for one profile. */
interface EffectiveFacts extends SmallCompanyFacts {
  classification: ProfileClassification;
  groupHasRelationships: boolean;
  initialAudit: boolean;
  auditPeriodStart: string;
}

/** One assembled profile: the view, plus what change detection needs. */
interface Assembled {
  view: StatutoryAuditEntityProfile;
  row: ProfileRow;
  facts: EffectiveFacts;
  workspace: WorkspaceFacts;
  liveSmallCompany: SmallCompanyAssessment;
  liveSaTriggers: SaTrigger[];
  tracked: TrackedFacts;
  financials: FinancialRow[];
  masterOwnedTypes: SpecialEntityType[];
}

/**
 * 02.1 Entity & Regulatory Profile service (Implementation Guide §9.1; DHVAJ
 * 02.1 web developer specification) — THE FACT FOUNDATION. One confirmable
 * profile per statutory-audit shell that:
 *   • shows the read-only master classification / listing / group / financial
 *     facts with their source and source date, and lets the Manager CONFIRM each
 *     card — corrections route to the source master, never a local copy;
 *   • COMPUTES the Small Company status from the §2(85) rule version, which the
 *     Manager confirms or overrides with a reason (both results kept);
 *   • captures what only the audit team knows (listing answers, regulator,
 *     accounting environment, service organisation, joint auditors);
 *   • carries the SA 510 / 402 / 299 triggers forward;
 *   • calculates Card J completeness (missing / pending / conflicting facts);
 *   • on CONFIRM PROFILE freezes a fact snapshot + methodology version for
 *     02.2–02.9; a later master change, or a reopen-and-correct, marks the
 *     affected downstream assessments "Needs Re-evaluation".
 *
 * Mirrors the acceptance service conventions (RLS ctx, optimistic version,
 * idempotent self-healing seed, immutable audit events with before/after).
 */
@Injectable()
export class AuditProfileService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
    private readonly documents: DocumentsService,
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
          WHERE swi.engagement_id = $1 AND swi.status <> 'cancelled'
            AND NOT EXISTS (
              SELECT 1 FROM hsdg.audit_entity_profile p
               WHERE p.workflow_instance_id = swi.id)`,
        [engagementId],
      );
      for (const s of shells) await this.seedProfileOn(client, s.id, engagementId);
      await this.prefillOn(client, ctx, engagementId);
      let assembled = await this.assemble(client, engagementId);
      if (await isEngagementLead(client, engagementId)) {
        const changed = await this.syncMasterOwnedTypes(client, ctx, assembled);
        const drifted = await this.detectDrift(client, ctx, assembled);
        if (changed || drifted) assembled = await this.assemble(client, engagementId);
      }
      return assembled.map((a) => a.view);
    });
  }

  /** Read every non-cancelled profile of the engagement, fully assembled. */
  private async assemble(client: PoolClient, engagementId: string): Promise<Assembled[]> {
    const { rows: profiles } = await client.query<ProfileRow>(
      `SELECT ${PROFILE_COLUMNS} ${PROFILE_FROM}
        WHERE p.engagement_id = $1 AND swi.status <> 'cancelled'
        ORDER BY swi.created_at ASC`,
      [engagementId],
    );
    if (profiles.length === 0) return [];

    const { rows: financials } = await client.query<FinancialRow>(
      `SELECT f.id, f.profile_id, f.parameter, f.current_value::text, f.prior_value::text,
              f.source, COALESCE(pe.full_name, f.preparer) AS preparer, f.document_id,
              f.master_current_at_capture::text, f.master_prior_at_capture::text,
              f.version, f.updated_at
         FROM hsdg.audit_profile_financials f
         LEFT JOIN hsdg.employees pe ON pe.id = f.prepared_by_employee_id
        WHERE f.profile_id = ANY($1::uuid[])
        ORDER BY f.parameter ASC`,
      [profiles.map((p) => p.id)],
    );

    const out: Assembled[] = [];
    for (const p of profiles) {
      const fins = financials.filter((f) => f.profile_id === p.id);
      out.push(await this.assembleOne(client, engagementId, p, fins));
    }
    return out;
  }

  private async assembleOne(
    client: PoolClient,
    engagementId: string,
    p: ProfileRow,
    fins: FinancialRow[],
  ): Promise<Assembled> {
    const facts = await this.deriveFacts(client, engagementId, p, fins);
    const master = await readEngagementMasterFacts(client, p.workflow_instance_id);
    const specialTypes = (p.special_entity_types ?? []) as SpecialEntityType[];
    const masterSpecial = master ? specialEntityTypesFromMaster(master) : { types: [], facts: [] };
    const masterOwnedTypes = masterSpecial.types.filter((t) =>
      MASTER_OWNED_SPECIAL_TYPES.includes(t),
    );

    // Small Company: the live system result always; a confirmed profile SHOWS its
    // frozen result (history is never silently rewritten by a rule change).
    const resolve = await this.rules.buildResolverOn(client, facts.auditPeriodStart);
    const liveSmallCompany = assessSmallCompany(facts, resolve);
    const confirmed = p.state === PROFILE_STATE.confirmed && p.small_company_outcome != null;
    const smallCompany: SmallCompanyAssessment = confirmed
      ? {
          outcome: p.small_company_system_outcome ?? p.small_company_outcome!,
          basis: p.small_company_basis ?? '',
          ruleVersionId: p.small_company_rule_version_id,
          authorityProvisionId: p.small_company_provision_id,
        }
      : liveSmallCompany;
    const override = p.small_company_override;
    const liveFinal = finalSmallCompanyOutcome(liveSmallCompany.outcome, override);

    const liveSaTriggers = deriveSaTriggers({
      initialAudit: facts.initialAudit,
      accountingEnvironment: p.accounting_environment,
      serviceOrg: p.service_org,
      jointAudit: p.joint_audit,
    });
    const saTriggers: SaTrigger[] = confirmed
      ? [
          { code: 'SA 510', triggered: p.sa510_flag, basis: saBasis510(p.sa510_flag) },
          { code: 'SA 402', triggered: p.sa402_flag, basis: saBasis402(p.sa402_flag) },
          { code: 'SA 299', triggered: p.sa299_flag, basis: saBasis299(p.sa299_flag) },
        ]
      : liveSaTriggers;

    const financialRows = buildFinancialRows(master, fins);
    const companyType = companyTypeOf(
      master?.entityTypeSlug ?? null,
      facts.classification.category,
      masterOwnedTypes,
    );
    const listing = {
      masterListed: facts.classification.isListed,
      masterInProcess: master?.listingInProcess ?? false,
      answer: p.listing_answer,
      inProcess: p.listing_in_process,
      lines: master?.listingLines ?? [],
    };
    const rels = master?.relationships ?? [];
    const groupFlags = groupFlagsOf(rels);
    const groupEntities = groupEntitiesOf(rels);
    const period = auditPeriodOf(
      // engagements.financial_year is NOT NULL ('YYYY-YY').
      p.financial_year!,
      master?.incorporationDate ?? null,
      p.different_fy_approved,
    );
    const accounting = {
      software: p.accounting_software,
      softwareOther: p.accounting_software_other,
      recordsElectronic: p.records_electronic,
      recordsDescription: p.records_description,
      serviceOrg: p.service_org,
      serviceOrgService: p.service_org_service,
      serviceOrgProvider: p.service_org_provider,
    };
    const jointAuditors = p.joint_auditors ?? [];

    const workspace: WorkspaceFacts = {
      isCompany: facts.classification.isCompany,
      entityCategory: facts.classification.category,
      companyType,
      listing,
      specialEntityTypes: specialTypes,
      masterOwnedSpecialTypes: masterOwnedTypes,
      nbfcCategory: p.nbfc_category,
      regulator: p.regulator,
      regulatorName: p.regulator_name,
      regulatorDetails: p.regulator_details,
      groupFlags,
      groupEntities,
      financialRows,
      smallCompanySystem: liveSmallCompany.outcome,
      smallCompanyFinal: liveFinal,
      smallCompanyOverridden: override != null,
      period,
      initialAudit: facts.initialAudit,
      accountingEnvironment: p.accounting_environment,
      accounting,
      jointAudit: p.joint_audit,
      jointAuditors,
    };

    const confirmations = p.card_confirmations ?? {};
    const fixes = {
      details: master ? (fixFor(master, 'details') ?? null) : null,
      financials: master ? (fixFor(master, 'financials') ?? null) : null,
      listings: master ? (fixFor(master, 'listings') ?? null) : null,
      regulatory: master ? (fixFor(master, 'regulatory') ?? null) : null,
    };
    const evaluated = evaluateCompleteness({
      facts: workspace,
      confirmations,
      profileConfirmed: p.state === PROFILE_STATE.confirmed && !p.needs_reevaluation,
      fixes,
    });
    const blocking = evaluated.completeness.items.filter((i) => i.blocking);

    const tracked = trackedFacts(workspace, {
      companyType: companyType
        ? COMPANY_TYPE_LABEL[companyType]
        : facts.classification.entityTypeName,
      regulator: regulatorLabel(p),
      accounting: accountingLabel(p),
    });

    const masterFacts = master
      ? [
          ...regulatoryProfileFacts(
            master,
            new Map(fins.map((f) => [f.parameter, num(f.current_value)])),
          ),
          ...masterSpecial.facts,
        ]
      : [];

    const view: StatutoryAuditEntityProfile = {
      workflowInstanceId: p.workflow_instance_id,
      engagementServiceId: p.engagement_service_id,
      engagementId: p.engagement_id,
      state: p.state,
      financialYear: p.financial_year,
      classification: facts.classification,
      specialEntityTypes: specialTypes,
      groupHasRelationships: facts.groupHasRelationships,
      initialAudit: facts.initialAudit,
      initialAuditSystemDerived: p.initial_audit_derived,
      jointAudit: p.joint_audit,
      accountingEnvironment: p.accounting_environment,
      financials: fins.map(mapFinancial),
      masterFacts,
      smallCompany,
      saTriggers,
      confirmation:
        p.state === PROFILE_STATE.confirmed && p.confirmed_at
          ? {
              methodologyVersion: p.methodology_version,
              confirmedByName: p.confirmed_by_name,
              confirmedAt: p.confirmed_at.toISOString(),
              statement: p.confirmation_statement,
              note: p.confirmation_note,
            }
          : null,
      needsReevaluation: p.needs_reevaluation,
      missingFacts: blocking.map((i) => i.label),
      missingFactFixes: blocking.map((i) => i.fix),
      readyToConfirm: blocking.length === 0,
      header: {
        managerName: master?.managerName ?? null,
        partnerName: master?.partnerName ?? null,
        lastUpdatedByName: p.updated_by_name,
        lastUpdatedAt: p.updated_at.toISOString(),
      },
      companyType,
      listing,
      specialEntitySuggested: masterSpecial.types,
      nbfcCategory: p.nbfc_category,
      regulator: p.regulator,
      regulatorName: p.regulator_name,
      regulatorDetails: p.regulator_details,
      groupFlags,
      groupEntities,
      financialRows,
      smallCompanyConclusion: {
        systemOutcome: smallCompany.outcome,
        finalOutcome: confirmed ? p.small_company_outcome! : liveFinal,
        override:
          override && p.small_company_override_at
            ? {
                outcome: override,
                reason: p.small_company_override_reason ?? '',
                systemOutcomeAtOverride: p.small_company_override_system_outcome,
                byName: p.override_by_name,
                at: p.small_company_override_at.toISOString(),
              }
            : null,
        factsConsidered: [
          {
            label: 'Company type',
            value: companyType
              ? COMPANY_TYPE_LABEL[companyType]
              : (facts.classification.entityTypeName ?? 'Not on master'),
          },
          {
            label: 'Paid-up capital',
            value: facts.paidUpCapital == null ? 'Not available' : inr(facts.paidUpCapital),
          },
          {
            label: 'Turnover',
            value: facts.turnover == null ? 'Not available' : inr(facts.turnover),
          },
          {
            label: 'Holding / subsidiary',
            value: facts.isHoldingOrSubsidiary ? 'Yes' : 'No',
          },
          { label: 'Section 8', value: specialTypes.includes('section_8') ? 'Yes' : 'No' },
          {
            label: 'Special-Act / regulated exclusion',
            value:
              specialTypes.filter(
                (t) => !['section_8', 'government', 'producer', 'dormant'].includes(t),
              ).length > 0
                ? 'Yes'
                : 'No',
          },
        ],
      },
      period,
      accounting,
      jointAuditors,
      cards: withCardConfirmations(evaluated.cards, confirmations),
      completeness: evaluated.completeness,
      references: await this.rules.resolveReferencesOn(client, '02.1', facts.auditPeriodStart),
      files: await this.readFiles(client, p.id),
      priorYear: facts.initialAudit
        ? null
        : await this.priorYearView(client, p.workflow_instance_id, tracked),
      sectionNav: await this.sectionNav(client, p),
      reopen:
        p.reopened_reason && p.reopened_at
          ? {
              reason: p.reopened_reason,
              at: p.reopened_at.toISOString(),
              byName: p.reopened_by_name,
            }
          : null,
      version: p.version,
    };

    return {
      view,
      row: p,
      facts,
      workspace,
      liveSmallCompany,
      liveSaTriggers,
      tracked,
      financials: fins,
      masterOwnedTypes,
    };
  }

  /** Derive the effective facts from masters + captured financials for a profile. */
  private async deriveFacts(
    client: PoolClient,
    engagementId: string,
    p: Pick<
      ProfileRow,
      | 'workflow_instance_id'
      | 'special_entity_types'
      | 'initial_audit'
      | 'initial_audit_derived'
      | 'financial_year'
    >,
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
      // The audit year's financial profile first, then the current one, then the
      // headline figures on the entity itself — whichever the master has.
      const fin = await client.query<{ paid_up_capital: string | null; turnover: string | null }>(
        `SELECT fp.paid_up_capital, COALESCE(fp.turnover, fp.revenue) AS turnover
           FROM hsdg.entity_financial_profiles fp
           JOIN hsdg.engagements e ON e.entity_id = fp.entity_id
          WHERE e.id = $1 AND (fp.financial_year = e.financial_year OR fp.is_current)
          ORDER BY (fp.financial_year = e.financial_year) DESC, fp.created_at DESC
          LIMIT 1`,
        [engagementId],
      );
      if (fin.rows[0]) {
        paidUpCapital = paidUpCapital ?? num(fin.rows[0].paid_up_capital);
        turnover = turnover ?? num(fin.rows[0].turnover);
      }
      if (paidUpCapital == null || turnover == null) {
        const ent = await client.query<{
          paid_up_capital: string | null;
          annual_turnover: string | null;
        }>(
          `SELECT ent.paid_up_capital, ent.annual_turnover
             FROM hsdg.engagements e JOIN hsdg.entities ent ON ent.id = e.entity_id
            WHERE e.id = $1`,
          [engagementId],
        );
        paidUpCapital = paidUpCapital ?? num(ent.rows[0]?.paid_up_capital ?? null);
        turnover = turnover ?? num(ent.rows[0]?.annual_turnover ?? null);
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
          WHERE swi.workflow_key = 'statutory_audit' AND swi.status <> 'cancelled'
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

  private async readFiles(client: PoolClient, profileId: string): Promise<ProfileFileRecord[]> {
    const { rows } = await client.query<{
      id: string;
      slot: string;
      document_id: string;
      title: string;
      filename: string | null;
      linked_at: Date;
      linked_by_name: string | null;
    }>(
      `SELECT f.id, f.slot, f.document_id, d.title, cv.filename, f.linked_at,
              emp.full_name AS linked_by_name
         FROM hsdg.audit_profile_files f
         JOIN hsdg.documents d ON d.id = f.document_id AND d.deleted_at IS NULL
         LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
         LEFT JOIN hsdg.employees emp ON emp.id = f.linked_by_employee_id
        WHERE f.profile_id = $1 AND f.removed_at IS NULL
        ORDER BY f.linked_at`,
      [profileId],
    );
    return rows.map((r) => ({
      id: r.id,
      slot: r.slot,
      documentId: r.document_id,
      title: r.title,
      filename: r.filename,
      linkedAt: r.linked_at.toISOString(),
      linkedByName: r.linked_by_name,
    }));
  }

  /** Last year's 02.1 beside this year's (spec §14) — from its confirmed snapshot. */
  private async priorYearView(
    client: PoolClient,
    workflowInstanceId: string,
    current: TrackedFacts,
  ): Promise<StatutoryAuditEntityProfile['priorYear']> {
    const prior = await this.priorProfile(client, workflowInstanceId);
    const tracked = prior?.snapshot?.tracked;
    if (!prior || !tracked) return null;
    return { financialYear: prior.financial_year, changes: priorYearChanges(tracked, current) };
  }

  /** Left navigation 02.1–02.10 with a status per sub-section (spec §2). */
  private async sectionNav(client: PoolClient, p: ProfileRow): Promise<ProfileSectionNavItem[]> {
    const { rows: subs } = await client.query<{
      sub_section_key: string;
      state: string;
      needs_reevaluation: boolean;
    }>(
      `SELECT sub_section_key, state, needs_reevaluation
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1`,
      [p.workflow_instance_id],
    );
    const { rows: base } = await client.query<{ status: string; reopen_reason: string | null }>(
      `SELECT status, reopen_reason FROM hsdg.audit_framework_baseline
        WHERE workflow_instance_id = $1 AND status <> 'superseded'
        ORDER BY created_at DESC LIMIT 1`,
      [p.workflow_instance_id],
    );
    const DONE = ['applicable', 'not_applicable', 'overridden', 'approved'];
    const subStatus = (key: string): SectionNavStatus => {
      const r = subs.find((s) => s.sub_section_key === key);
      if (!r) return 'not_started';
      if (r.needs_reevaluation || r.state === 'reassessment_required') return 'needs_attention';
      if (DONE.includes(r.state)) return 'complete';
      return r.state === 'not_assessed' ? 'not_started' : 'in_progress';
    };
    const profileStatus: SectionNavStatus =
      p.state === PROFILE_STATE.confirmed
        ? p.needs_reevaluation
          ? 'needs_attention'
          : 'complete'
        : p.version > 1
          ? 'in_progress'
          : 'not_started';
    const combine = (a: SectionNavStatus, b: SectionNavStatus): SectionNavStatus => {
      if (a === 'needs_attention' || b === 'needs_attention') return 'needs_attention';
      if (a === 'complete' && b === 'complete') return 'complete';
      if (a === 'not_started' && b === 'not_started') return 'not_started';
      return 'in_progress';
    };
    const baseline = base[0];
    const status: Record<string, SectionNavStatus> = {
      '02.1': profileStatus,
      [SUB_SECTION_KEY.financialReporting]: subStatus(SUB_SECTION_KEY.financialReporting),
      [SUB_SECTION_KEY.scheduleIii]: subStatus(SUB_SECTION_KEY.scheduleIii),
      [SUB_SECTION_KEY.caro]: subStatus(SUB_SECTION_KEY.caro),
      [SUB_SECTION_KEY.icfr]: subStatus(SUB_SECTION_KEY.icfr),
      [SUB_SECTION_KEY.consolidation]: subStatus(SUB_SECTION_KEY.consolidation),
      [SUB_SECTION_KEY.otherReporting]: subStatus(SUB_SECTION_KEY.otherReporting),
      // 02.8 SA framework reads the SA 510/402/299 flags 02.1 freezes.
      '02.8': profileStatus,
      // 02.9 auditor reporting rests on the 02.2 framework and 02.7 matrix.
      '02.9': combine(
        subStatus(SUB_SECTION_KEY.financialReporting),
        subStatus(SUB_SECTION_KEY.otherReporting),
      ),
      '02.10': !baseline
        ? 'not_started'
        : baseline.status === 'approved'
          ? 'complete'
          : baseline.reopen_reason
            ? 'needs_attention'
            : 'in_progress',
    };
    return SECTION_02_NAV.map((s) => ({ ...s, status: status[s.key] ?? 'not_started' }));
  }

  // ── Self-maintenance on read (lead only) ───────────────────────────────────

  /**
   * Section 8 / Government are system values from the Entity Master (spec Card
   * B): keep an editable profile in line with the master so downstream engines
   * reading `special_entity_types` see the corrected value.
   */
  private async syncMasterOwnedTypes(
    client: PoolClient,
    ctx: RlsContext,
    assembled: Assembled[],
  ): Promise<boolean> {
    let changed = false;
    for (const a of assembled) {
      const editable = a.row.state === PROFILE_STATE.draft || a.row.needs_reevaluation;
      if (!editable) continue;
      const current = (a.row.special_entity_types ?? []) as SpecialEntityType[];
      const next = withMasterOwned(current, a.masterOwnedTypes);
      if (sameSet(current, next)) continue;
      await client.query(
        `UPDATE hsdg.audit_entity_profile SET special_entity_types = $2, version = version + 1
          WHERE id = $1`,
        [a.row.id, next],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_master_types_synced',
        objectType: 'audit_entity_profile',
        objectId: a.row.id,
        before: { specialEntityTypes: current },
        after: { specialEntityTypes: next, automatic: true },
      });
      changed = true;
    }
    return changed;
  }

  /**
   * A confirmed profile whose live facts no longer match the confirmed snapshot
   * (a master correction after 02.1 confirmation) is marked Needs Re-evaluation,
   * and so is every downstream assessment the changed facts feed (spec §16, §17).
   * The snapshot itself is never rewritten.
   */
  private async detectDrift(
    client: PoolClient,
    ctx: RlsContext,
    assembled: Assembled[],
  ): Promise<boolean> {
    let any = false;
    for (const a of assembled) {
      if (a.row.state !== PROFILE_STATE.confirmed || a.row.needs_reevaluation) continue;
      const before = a.row.snapshot?.tracked;
      if (!before) continue;
      const changed = changedTrackedFacts(before, a.tracked);
      if (changed.length === 0) continue;
      const sections = downstreamSectionsFor(changed);
      await client.query(
        `UPDATE hsdg.audit_entity_profile SET needs_reevaluation = true WHERE id = $1`,
        [a.row.id],
      );
      await this.flagDownstream(client, a.row.workflow_instance_id, sections);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_change_detected',
        objectType: 'audit_entity_profile',
        objectId: a.row.id,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: {
          ...Object.fromEntries(changed.map((k) => [k, a.tracked[k]])),
          changed: changed.map(trackedFactLabel),
          downstreamNeedsReevaluation: sections,
          automatic: true,
        },
      });
      any = true;
    }
    return any;
  }

  /** Mark downstream 02.x assessments Needs Re-evaluation; an approved one reopens. */
  private async flagDownstream(
    client: PoolClient,
    workflowInstanceId: string,
    sections: readonly string[],
  ): Promise<void> {
    if (sections.length === 0) return;
    await client.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET needs_reevaluation = true,
              state = CASE WHEN state = 'approved' THEN 'reassessment_required' ELSE state END
        WHERE workflow_instance_id = $1 AND sub_section_key = ANY($2::text[])`,
      [workflowInstanceId, sections],
    );
  }

  // ── Prefill (Card B from master; Cards B/H/I carried from last year) ─────────

  /**
   * First open by a lead fills the special-entity matrix from the client
   * master (industries, regulatory facts, mandated name suffixes) and carries
   * last year's stable answers (regulator, accounting environment, service
   * organisation, joint audit) as SYSTEM SUGGESTIONS — card confirmations are
   * never carried, so nothing becomes final silently (spec §14). Only an
   * untouched draft profile (version 1) is filled, so a team's later choice —
   * including clearing the list — is never refilled. Public so the 02.9 summary
   * can trigger it before the downstream sections read it.
   */
  async prefillOn(client: PoolClient, ctx: RlsContext, engagementId: string): Promise<void> {
    const { rows } = await client.query<{ id: string; workflow_instance_id: string }>(
      `SELECT p.id, p.workflow_instance_id
         FROM hsdg.audit_entity_profile p
         JOIN hsdg.service_workflow_instances swi ON swi.id = p.workflow_instance_id
        WHERE p.engagement_id = $1 AND swi.status <> 'cancelled'
          AND p.state = 'draft' AND p.version = 1 AND cardinality(p.special_entity_types) = 0
          AND p.accounting_environment IS NULL AND NOT p.joint_audit
          AND p.accounting_software IS NULL AND p.service_org IS NULL`,
      [engagementId],
    );
    if (rows.length === 0 || !(await isEngagementLead(client, engagementId))) return;
    for (const r of rows) {
      const master = await readEngagementMasterFacts(client, r.workflow_instance_id);
      if (!master) continue;
      const { next, filled } = fillSpecialTypes([], specialEntityTypesFromMaster(master));
      const prior = await this.priorProfile(client, r.workflow_instance_id);
      const carry = prior
        ? {
            accounting_environment: prior.accounting_environment,
            joint_audit: prior.joint_audit === true,
            joint_auditors: prior.joint_auditors ?? [],
            accounting_software: prior.accounting_software,
            accounting_software_other: prior.accounting_software_other,
            records_electronic: prior.records_electronic,
            records_description: prior.records_description,
            service_org: prior.service_org,
            service_org_service: prior.service_org_service,
            service_org_provider: prior.service_org_provider,
            regulator: prior.regulator,
            regulator_name: prior.regulator_name,
            regulator_details: prior.regulator_details,
            nbfc_category: prior.nbfc_category,
          }
        : null;
      const carriesSomething =
        !!carry &&
        (carry.accounting_environment != null ||
          carry.joint_audit ||
          carry.accounting_software != null ||
          carry.service_org != null ||
          carry.records_electronic != null ||
          carry.regulator != null);
      if (filled.length === 0 && !carriesSomething) continue; // stays eligible for later
      await client.query(
        `UPDATE hsdg.audit_entity_profile
            SET special_entity_types = $2, accounting_environment = $3, joint_audit = $4,
                joint_auditors = $5::jsonb, accounting_software = $6, accounting_software_other = $7,
                records_electronic = $8, records_description = $9, service_org = $10,
                service_org_service = $11, service_org_provider = $12, regulator = $13,
                regulator_name = $14, regulator_details = $15, nbfc_category = $16,
                version = version + 1
          WHERE id = $1 AND version = 1`,
        [
          r.id,
          next,
          carry?.accounting_environment ?? null,
          carry?.joint_audit ?? false,
          JSON.stringify(carry?.joint_auditors ?? []),
          carry?.accounting_software ?? null,
          carry?.accounting_software_other ?? null,
          carry?.records_electronic ?? null,
          carry?.records_description ?? null,
          carry?.service_org ?? null,
          carry?.service_org_service ?? null,
          carry?.service_org_provider ?? null,
          carry?.regulator ?? null,
          carry?.regulator_name ?? null,
          carry?.regulator_details ?? null,
          carry?.nbfc_category ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_special_types_prefilled',
        objectType: 'audit_entity_profile',
        objectId: r.id,
        after: {
          specialEntityTypes: next,
          accountingEnvironment: carry?.accounting_environment ?? null,
          jointAudit: carry?.joint_audit ?? false,
          carriedFrom: prior?.financial_year ?? null,
          carried: carry
            ? Object.keys(carry).filter((k) => {
                const v = (carry as Record<string, unknown>)[k];
                return v != null && v !== false && !(Array.isArray(v) && v.length === 0);
              })
            : [],
          automatic: true,
        },
      });
    }
  }

  /** Last year's 02.1 profile for the same client (confirmed first), if any. */
  private async priorProfile(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<
    | (Pick<
        ProfileRow,
        | 'accounting_environment'
        | 'joint_audit'
        | 'joint_auditors'
        | 'accounting_software'
        | 'accounting_software_other'
        | 'records_electronic'
        | 'records_description'
        | 'service_org'
        | 'service_org_service'
        | 'service_org_provider'
        | 'regulator'
        | 'regulator_name'
        | 'regulator_details'
        | 'nbfc_category'
        | 'snapshot'
      > & { financial_year: string })
    | null
  > {
    const { rows } = await client.query(
      `SELECT e2.financial_year, p2.accounting_environment, p2.joint_audit, p2.joint_auditors,
              p2.accounting_software, p2.accounting_software_other, p2.records_electronic,
              p2.records_description, p2.service_org, p2.service_org_service,
              p2.service_org_provider, p2.regulator, p2.regulator_name, p2.regulator_details,
              p2.nbfc_category, p2.snapshot
         FROM hsdg.service_workflow_instances wi
         JOIN hsdg.engagements e ON e.id = wi.engagement_id
         JOIN hsdg.engagements e2 ON e2.entity_id = e.entity_id AND e2.financial_year < e.financial_year
         JOIN hsdg.service_workflow_instances wi2 ON wi2.engagement_id = e2.id
                                                AND wi2.status <> 'cancelled'
         JOIN hsdg.audit_entity_profile p2 ON p2.workflow_instance_id = wi2.id
        WHERE wi.id = $1
        ORDER BY e2.financial_year DESC, (p2.state = 'confirmed') DESC
        LIMIT 1`,
      [workflowInstanceId],
    );
    return rows[0] ?? null;
  }

  /** "Fill from client master": adds the master's special types; never removes one. */
  async fillFromMaster(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditEntityProfileMasterFillResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      this.assertEditable(current);
      const master = await readEngagementMasterFacts(client, workflowInstanceId);
      if (!master) throw new NotFoundException('Statutory-audit workflow not found.');
      const { next, filled } = fillSpecialTypes(
        (current.special_entity_types ?? []) as SpecialEntityType[],
        specialEntityTypesFromMaster(master),
      );
      if (filled.length > 0) {
        await client.query(
          `UPDATE hsdg.audit_entity_profile
              SET special_entity_types = $2, version = version + 1,
                  updated_by_employee_id = $3
            WHERE id = $1`,
          [current.id, next, ctx.employeeId ?? null],
        );
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.profile_special_types_prefilled',
          objectType: 'audit_entity_profile',
          objectId: current.id,
          before: { specialEntityTypes: current.special_entity_types },
          after: { specialEntityTypes: next },
        });
      }
      return { profile: await this.readForShell(client, engagementId, workflowInstanceId), filled };
    });
  }

  // ── Save Draft: the facts only the audit team holds (Cards A/B/F/G/H/I) ─────

  async updateProfile(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: UpdateEntityProfileInput,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      this.assertEditable(current);
      const master = await readEngagementMasterFacts(client, workflowInstanceId);
      const masterOwned = master
        ? specialEntityTypesFromMaster(master).types.filter((t) =>
            MASTER_OWNED_SPECIAL_TYPES.includes(t),
          )
        : [];

      const pick = <K extends keyof UpdateEntityProfileInput, V>(key: K, fallback: V) =>
        (input[key] !== undefined ? input[key] : fallback) as V;

      // Section 8 / Government stay the master's value — corrected on the master.
      const requestedTypes = (input.specialEntityTypes ??
        current.special_entity_types ??
        []) as SpecialEntityType[];
      const specialEntityTypes = withMasterOwned(
        requestedTypes.filter((t) => SPECIAL_ENTITY_TYPES.includes(t)),
        masterOwned,
      );
      const jointAudit = pick('jointAudit', current.joint_audit);
      const accountingEnvironment = pick('accountingEnvironment', current.accounting_environment);
      const overrideInitial = input.initialAudit !== undefined;
      const initialAudit = overrideInitial ? input.initialAudit! : current.initial_audit;
      const initialAuditDerived = overrideInitial ? false : current.initial_audit_derived;

      const regulator = specialEntityTypes.includes('other_regulator')
        ? pick('regulator', current.regulator)
        : null;
      const software = pick('accountingSoftware', current.accounting_software);
      const recordsElectronic = pick('recordsElectronic', current.records_electronic);
      const serviceOrg = pick('serviceOrg', current.service_org);
      const next = {
        special_entity_types: specialEntityTypes,
        joint_audit: jointAudit,
        accounting_environment: accountingEnvironment,
        initial_audit: initialAudit,
        initial_audit_derived: initialAuditDerived,
        listing_answer: pick('listingAnswer', current.listing_answer),
        listing_in_process: pick('listingInProcess', current.listing_in_process),
        nbfc_category: specialEntityTypes.includes('nbfc')
          ? clean(pick('nbfcCategory', current.nbfc_category))
          : null,
        regulator,
        regulator_name:
          regulator === 'other' ? clean(pick('regulatorName', current.regulator_name)) : null,
        regulator_details: regulator
          ? clean(pick('regulatorDetails', current.regulator_details))
          : null,
        different_fy_approved: pick('differentFyApproved', current.different_fy_approved),
        accounting_software: software,
        accounting_software_other:
          software === 'other'
            ? clean(pick('accountingSoftwareOther', current.accounting_software_other))
            : null,
        records_electronic: recordsElectronic,
        records_description:
          recordsElectronic === 'no'
            ? clean(pick('recordsDescription', current.records_description))
            : null,
        service_org: serviceOrg,
        service_org_service:
          serviceOrg === 'yes'
            ? clean(pick('serviceOrgService', current.service_org_service))
            : null,
        service_org_provider:
          serviceOrg === 'yes'
            ? clean(pick('serviceOrgProvider', current.service_org_provider))
            : null,
        joint_auditors: jointAudit
          ? (input.jointAuditors ?? current.joint_auditors ?? []).map((a) => ({
              firmName: a.firmName.trim(),
              frn: a.frn?.trim() || null,
              contact: a.contact?.trim() || null,
            }))
          : [],
      };

      const result = await client.query(
        `UPDATE hsdg.audit_entity_profile
            SET special_entity_types = $3, joint_audit = $4, accounting_environment = $5,
                initial_audit = $6, initial_audit_derived = $7, listing_answer = $8,
                listing_in_process = $9, nbfc_category = $10, regulator = $11,
                regulator_name = $12, regulator_details = $13, different_fy_approved = $14,
                accounting_software = $15, accounting_software_other = $16,
                records_electronic = $17, records_description = $18, service_org = $19,
                service_org_service = $20, service_org_provider = $21,
                joint_auditors = $22::jsonb, updated_by_employee_id = $23,
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          current.id,
          input.version,
          next.special_entity_types,
          next.joint_audit,
          next.accounting_environment,
          next.initial_audit,
          next.initial_audit_derived,
          next.listing_answer,
          next.listing_in_process,
          next.nbfc_category,
          next.regulator,
          next.regulator_name,
          next.regulator_details,
          next.different_fy_approved,
          next.accounting_software,
          next.accounting_software_other,
          next.records_electronic,
          next.records_description,
          next.service_org,
          next.service_org_service,
          next.service_org_provider,
          JSON.stringify(next.joint_auditors),
          ctx.employeeId ?? null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('This profile changed since you loaded it; refresh and retry.');
      }
      const { before, after } = diffFields(current as unknown as Record<string, unknown>, next);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_updated',
        objectType: 'audit_entity_profile',
        objectId: current.id,
        before,
        after,
      });
      return this.readForShell(client, engagementId, workflowInstanceId);
    });
  }

  // ── Card confirmations (A/B/C/E/F/H/I) ───────────────────────────────────────

  async confirmCard(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ConfirmProfileCardInput,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      this.assertEditable(current);
      if (current.version !== input.version) {
        throw new ConflictException('This profile changed since you loaded it; refresh and retry.');
      }
      const a = await this.assembleShell(client, engagementId, current);
      const blockers = cardConfirmBlockers(input.card, a.workspace);
      if (blockers.length > 0) {
        throw new BadRequestException(`Cannot confirm yet — ${blockers.join(' ')}`);
      }
      await this.storeCardConfirmation(
        client,
        ctx,
        current,
        input.card,
        cardFingerprint(input.card, a.workspace),
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_card_confirmed',
        objectType: 'audit_entity_profile',
        objectId: current.id,
        after: { card: input.card, facts: JSON.parse(cardFingerprint(input.card, a.workspace)) },
      });
      return this.readForShell(client, engagementId, workflowInstanceId);
    });
  }

  private async storeCardConfirmation(
    client: PoolClient,
    ctx: RlsContext,
    current: ProfileRow,
    card: string,
    fingerprint: string,
  ): Promise<void> {
    const byName = await this.employeeName(client, ctx);
    await client.query(
      `UPDATE hsdg.audit_entity_profile
          SET card_confirmations = card_confirmations || jsonb_build_object($2::text, $3::jsonb),
              updated_by_employee_id = $4, version = version + 1
        WHERE id = $1`,
      [
        current.id,
        card,
        JSON.stringify({
          at: new Date().toISOString(),
          byId: ctx.employeeId ?? null,
          byName,
          fingerprint,
        }),
        ctx.employeeId ?? null,
      ],
    );
  }

  // ── Card E: Confirm Assessment / Override (spec §8) ──────────────────────────

  async decideSmallCompany(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SmallCompanyDecisionInput,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      this.assertEditable(current);
      if (current.version !== input.version) {
        throw new ConflictException('This profile changed since you loaded it; refresh and retry.');
      }
      const a = await this.assembleShell(client, engagementId, current);
      const system = a.liveSmallCompany.outcome;

      if (input.action === 'confirm') {
        if (current.small_company_override) {
          throw new BadRequestException(
            'An override is recorded — clear it before confirming the system assessment.',
          );
        }
        const blockers = cardConfirmBlockers('E', a.workspace);
        if (blockers.length > 0)
          throw new BadRequestException(`Cannot confirm yet — ${blockers.join(' ')}`);
        await this.storeCardConfirmation(
          client,
          ctx,
          current,
          'E',
          cardFingerprint('E', a.workspace),
        );
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.profile_small_company_confirmed',
          objectType: 'audit_entity_profile',
          objectId: current.id,
          after: { systemOutcome: system, basis: a.liveSmallCompany.basis },
        });
      } else if (input.action === 'override') {
        const reason = input.reason?.trim() ?? '';
        if (!input.outcome || !['small', 'not_small'].includes(input.outcome)) {
          throw new BadRequestException(
            'Choose the professional conclusion: Small Company or Not a Small Company.',
          );
        }
        if (reason.length < 3)
          throw new BadRequestException('A reason is required to override the system assessment.');
        await client.query(
          `UPDATE hsdg.audit_entity_profile
              SET small_company_override = $2, small_company_override_reason = $3,
                  small_company_override_system_outcome = $4,
                  small_company_override_by_employee_id = $5, small_company_override_at = now()
            WHERE id = $1`,
          [current.id, input.outcome, reason, system, ctx.employeeId ?? null],
        );
        const overridden: WorkspaceFacts = {
          ...a.workspace,
          smallCompanyFinal: input.outcome,
          smallCompanyOverridden: true,
        };
        await this.storeCardConfirmation(
          client,
          ctx,
          current,
          'E',
          cardFingerprint('E', overridden),
        );
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.profile_small_company_overridden',
          objectType: 'audit_entity_profile',
          objectId: current.id,
          before: { systemOutcome: system, override: current.small_company_override },
          after: { systemOutcome: system, finalOutcome: input.outcome },
          reason,
        });
      } else {
        if (!current.small_company_override)
          throw new BadRequestException('There is no override to clear.');
        await client.query(
          `UPDATE hsdg.audit_entity_profile
              SET small_company_override = NULL, small_company_override_reason = NULL,
                  small_company_override_system_outcome = NULL,
                  small_company_override_by_employee_id = NULL, small_company_override_at = NULL,
                  card_confirmations = card_confirmations - 'E',
                  updated_by_employee_id = $2, version = version + 1
            WHERE id = $1`,
          [current.id, ctx.employeeId ?? null],
        );
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.profile_small_company_override_cleared',
          objectType: 'audit_entity_profile',
          objectId: current.id,
          before: {
            override: current.small_company_override,
            reason: current.small_company_override_reason,
          },
          after: { systemOutcome: system },
        });
      }
      return this.readForShell(client, engagementId, workflowInstanceId);
    });
  }

  // ── Card D: capture a financial parameter ────────────────────────────────────

  async captureFinancial(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CaptureProfileFinancialInput,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      this.assertEditable(current);

      if (input.documentId)
        await this.assertEngagementDocument(client, engagementId, input.documentId);

      // Remember the linked figure the value was keyed over: if the master later
      // changes, the row shows conflicting source data instead of a silent drift.
      const master = await readEngagementMasterFacts(client, workflowInstanceId);
      const masterCurrent = masterFigure(
        master?.cyFinancials ?? null,
        master,
        input.parameter,
        true,
      );
      const masterPrior = masterFigure(
        master?.pyFinancials ?? null,
        master,
        input.parameter,
        false,
      );
      const preparer = input.preparer?.trim() || (await this.employeeName(client, ctx));

      const { rows: prev } = await client.query<{
        current_value: string | null;
        prior_value: string | null;
        source: string | null;
      }>(
        `SELECT current_value::text, prior_value::text, source FROM hsdg.audit_profile_financials
          WHERE profile_id = $1 AND parameter = $2`,
        [current.id, input.parameter],
      );

      await client.query(
        `INSERT INTO hsdg.audit_profile_financials
           (profile_id, engagement_id, parameter, current_value, prior_value, source, preparer,
            document_id, prepared_by_employee_id, master_current_at_capture, master_prior_at_capture)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (profile_id, parameter) DO UPDATE
           SET current_value = EXCLUDED.current_value,
               prior_value = EXCLUDED.prior_value,
               source = EXCLUDED.source,
               preparer = EXCLUDED.preparer,
               document_id = COALESCE(EXCLUDED.document_id, hsdg.audit_profile_financials.document_id),
               prepared_by_employee_id = EXCLUDED.prepared_by_employee_id,
               master_current_at_capture = EXCLUDED.master_current_at_capture,
               master_prior_at_capture = EXCLUDED.master_prior_at_capture,
               version = hsdg.audit_profile_financials.version + 1`,
        [
          current.id,
          engagementId,
          input.parameter,
          input.currentValue ?? null,
          input.priorValue ?? null,
          input.source ?? null,
          preparer,
          input.documentId ?? null,
          ctx.employeeId ?? null,
          masterCurrent,
          masterPrior,
        ],
      );
      await client.query(
        `UPDATE hsdg.audit_entity_profile SET updated_by_employee_id = $2 WHERE id = $1`,
        [current.id, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_financial_captured',
        objectType: 'audit_entity_profile',
        objectId: current.id,
        before: prev[0]
          ? {
              parameter: input.parameter,
              currentValue: num(prev[0].current_value),
              priorValue: num(prev[0].prior_value),
              source: prev[0].source,
            }
          : null,
        after: {
          parameter: input.parameter,
          currentValue: input.currentValue ?? null,
          priorValue: input.priorValue ?? null,
          source: input.source ?? null,
          preparer,
          linkedValueAtCapture: masterCurrent,
        },
      });
      return this.readForShell(client, engagementId, workflowInstanceId);
    });
  }

  // ── Supporting files (spec §15: Add File / Link Existing File / Open) ──────

  async addFile(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: AddProfileFileInput,
  ): Promise<StatutoryAuditEntityProfile> {
    if (!isProfileFileSlot(input.slot)) throw new BadRequestException('Unknown 02.1 file slot.');
    await this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      this.assertEditable(current);
    });
    // Stored in the engagement workspace (SharePoint when Microsoft 365 is on).
    const doc = await this.documents.create(ctx, engagementId, {
      title: input.title?.trim() || input.filename.replace(/\.[^.]+$/, ''),
      filename: input.filename,
      contentType: input.contentType,
      contentBase64: input.contentBase64,
      documentType: 'evidence',
    });
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      await this.insertFile(client, ctx, current, input.slot, doc.id, 'added');
      return this.readForShell(client, engagementId, workflowInstanceId);
    });
  }

  async linkFile(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: LinkProfileFileInput,
  ): Promise<StatutoryAuditEntityProfile> {
    if (!isProfileFileSlot(input.slot)) throw new BadRequestException('Unknown 02.1 file slot.');
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      this.assertEditable(current);
      await this.assertEngagementDocument(client, engagementId, input.documentId);
      await this.insertFile(client, ctx, current, input.slot, input.documentId, 'linked');
      return this.readForShell(client, engagementId, workflowInstanceId);
    });
  }

  async unlinkFile(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    fileId: string,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      this.assertEditable(current);
      const { rows } = await client.query<{ slot: string; document_id: string }>(
        `UPDATE hsdg.audit_profile_files
            SET removed_at = now(), removed_by_employee_id = $3
          WHERE id = $1 AND profile_id = $2 AND removed_at IS NULL
          RETURNING slot, document_id`,
        [fileId, current.id, ctx.employeeId ?? null],
      );
      if (!rows[0]) throw new NotFoundException('That file is not linked to this profile.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_file_unlinked',
        objectType: 'audit_entity_profile',
        objectId: current.id,
        before: { slot: rows[0].slot, documentId: rows[0].document_id },
      });
      return this.readForShell(client, engagementId, workflowInstanceId);
    });
  }

  private async insertFile(
    client: PoolClient,
    ctx: RlsContext,
    current: ProfileRow,
    slot: string,
    documentId: string,
    how: 'added' | 'linked',
  ): Promise<void> {
    const { rowCount } = await client.query(
      `INSERT INTO hsdg.audit_profile_files (profile_id, engagement_id, slot, document_id, linked_by_employee_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [current.id, current.engagement_id, slot, documentId, ctx.employeeId ?? null],
    );
    if (!rowCount) throw new ConflictException('That file is already linked here.');
    await this.audit.recordWith(client, ctx, {
      action: `statutory_audit.profile_file_${how}`,
      objectType: 'audit_entity_profile',
      objectId: current.id,
      after: { slot, documentId },
    });
  }

  private async assertEngagementDocument(
    client: PoolClient,
    engagementId: string,
    documentId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
      [documentId, engagementId],
    );
    if (!rows[0]) {
      throw new BadRequestException('The linked document does not belong to this engagement.');
    }
  }

  // ── Controlled reopen ─────────────────────────────────────────────────────────

  async reopen(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    reason: string,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      if (current.state !== PROFILE_STATE.confirmed) {
        throw new BadRequestException('Only a confirmed profile can be reopened.');
      }
      if (current.needs_reevaluation) {
        throw new ConflictException('The profile is already open for re-evaluation.');
      }
      const why = reason.trim();
      if (why.length < 3)
        throw new BadRequestException('A reason is required to reopen the profile.');
      await client.query(
        `UPDATE hsdg.audit_entity_profile
            SET needs_reevaluation = true, reopened_reason = $2, reopened_at = now(),
                reopened_by_employee_id = $3, updated_by_employee_id = $3, version = version + 1
          WHERE id = $1`,
        [current.id, why, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_reopened',
        objectType: 'audit_entity_profile',
        objectId: current.id,
        reason: why,
      });
      return this.readForShell(client, engagementId, workflowInstanceId);
    });
  }

  // ── CONFIRM PROFILE — freezes the fact set for 02.2–02.9 (Completion) ────────

  async confirm(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ConfirmProfileInput,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadProfile(client, engagementId, workflowInstanceId);
      if (current.state === PROFILE_STATE.confirmed && !current.needs_reevaluation) {
        throw new ConflictException('The profile is already confirmed.');
      }
      if (input.acknowledged !== true) {
        throw new BadRequestException(
          `Accept the confirmation statement: "${PROFILE_CONFIRMATION_STATEMENT}"`,
        );
      }

      const a = await this.assembleShell(client, engagementId, current);
      const blocking = a.view.completeness.items.filter((i) => i.blocking);
      if (blocking.length > 0) {
        throw new BadRequestException(
          `Cannot confirm the profile — resolve first: ${blocking.map((i) => i.label).join(' ')}`,
        );
      }

      const methodologyVersion = await this.resolveMethodologyVersion(
        client,
        a.facts.auditPeriodStart,
      );
      const flag = (code: string) =>
        a.liveSaTriggers.find((t) => t.code === code)?.triggered ?? false;
      const finalOutcome = a.workspace.smallCompanyFinal;
      const snapshot: ProfileSnapshot = {
        classification: a.facts.classification,
        companyType: a.view.companyType,
        listing: a.view.listing,
        specialEntityTypes: a.facts.specialEntityTypes,
        regulator: {
          regulator: current.regulator,
          name: current.regulator_name,
          nbfcCategory: current.nbfc_category,
        },
        groupHasRelationships: a.facts.groupHasRelationships,
        groupFlags: a.view.groupFlags,
        groupEntities: a.view.groupEntities,
        initialAudit: a.facts.initialAudit,
        jointAudit: current.joint_audit,
        jointAuditors: current.joint_auditors ?? [],
        accountingEnvironment: current.accounting_environment,
        accounting: a.view.accounting,
        period: a.view.period,
        paidUpCapital: a.facts.paidUpCapital,
        turnover: a.facts.turnover,
        smallCompany: a.liveSmallCompany,
        smallCompanyFinal: finalOutcome,
        smallCompanyOverride: a.view.smallCompanyConclusion.override,
        saTriggers: a.liveSaTriggers,
        financials: a.financials.map(mapFinancial),
        financialRows: a.view.financialRows,
        cardConfirmations: current.card_confirmations ?? {},
        tracked: a.tracked,
      };

      // A correction made while reopened sends the affected downstream
      // assessments back for re-evaluation (spec §17).
      const previous = current.snapshot?.tracked;
      const changed = previous ? changedTrackedFacts(previous, a.tracked) : [];
      const sections = downstreamSectionsFor(changed);
      await this.flagDownstream(client, workflowInstanceId, sections);

      await client.query(
        `UPDATE hsdg.audit_entity_profile
            SET state = 'confirmed',
                initial_audit = $2,
                small_company_outcome = $3,
                small_company_system_outcome = $4,
                small_company_basis = $5,
                small_company_rule_version_id = $6,
                small_company_provision_id = $7,
                sa510_flag = $8, sa402_flag = $9, sa299_flag = $10,
                methodology_version = $11,
                snapshot = $12::jsonb,
                confirmed_by_employee_id = $13,
                confirmed_at = now(),
                confirmation_statement = $14,
                confirmation_note = $15,
                needs_reevaluation = false,
                updated_by_employee_id = $13,
                version = version + 1
          WHERE id = $1`,
        [
          current.id,
          a.facts.initialAudit,
          finalOutcome,
          a.liveSmallCompany.outcome,
          a.liveSmallCompany.basis,
          a.liveSmallCompany.ruleVersionId,
          a.liveSmallCompany.authorityProvisionId,
          flag('SA 510'),
          flag('SA 402'),
          flag('SA 299'),
          methodologyVersion,
          JSON.stringify(snapshot),
          ctx.employeeId ?? null,
          PROFILE_CONFIRMATION_STATEMENT,
          input.note?.trim() || null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.profile_confirmed',
        objectType: 'audit_entity_profile',
        objectId: current.id,
        before: previous ? { tracked: previous } : null,
        after: {
          smallCompanySystem: a.liveSmallCompany.outcome,
          smallCompanyFinal: finalOutcome,
          methodologyVersion,
          sa510: flag('SA 510'),
          sa402: flag('SA 402'),
          sa299: flag('SA 299'),
          statement: PROFILE_CONFIRMATION_STATEMENT,
          changedSincePreviousConfirmation: changed.map(trackedFactLabel),
          downstreamNeedsReevaluation: sections,
        },
        reason: input.note?.trim() || null,
      });
      return this.readForShell(client, engagementId, workflowInstanceId);
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async assembleShell(
    client: PoolClient,
    engagementId: string,
    p: ProfileRow,
  ): Promise<Assembled> {
    const { rows } = await client.query<ProfileRow>(
      `SELECT ${PROFILE_COLUMNS} ${PROFILE_FROM} WHERE p.id = $1`,
      [p.id],
    );
    return this.assembleOne(
      client,
      engagementId,
      rows[0]!,
      await this.loadFinancials(client, p.id),
    );
  }

  private async readForShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditEntityProfile> {
    const all = await this.assemble(client, engagementId);
    const one = all.find((a) => a.view.workflowInstanceId === workflowInstanceId);
    if (!one) throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    return one.view;
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
      `SELECT ${PROFILE_COLUMNS} ${PROFILE_FROM}
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
      `SELECT f.id, f.profile_id, f.parameter, f.current_value::text, f.prior_value::text,
              f.source, COALESCE(pe.full_name, f.preparer) AS preparer, f.document_id,
              f.master_current_at_capture::text, f.master_prior_at_capture::text,
              f.version, f.updated_at
         FROM hsdg.audit_profile_financials f
         LEFT JOIN hsdg.employees pe ON pe.id = f.prepared_by_employee_id
        WHERE f.profile_id = $1`,
      [profileId],
    );
    return rows;
  }

  private async employeeName(client: PoolClient, ctx: RlsContext): Promise<string | null> {
    if (!ctx.employeeId) return null;
    const { rows } = await client.query<{ full_name: string }>(
      `SELECT full_name FROM hsdg.employees WHERE id = $1`,
      [ctx.employeeId],
    );
    return rows[0]?.full_name ?? null;
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

// ── Pure helpers ───────────────────────────────────────────────────────────────

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

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const clean = (v: string | null | undefined): string | null => v?.trim() || null;

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Section 8 / Government follow the master; every other type is the team's. */
function withMasterOwned(
  types: readonly SpecialEntityType[],
  masterOwned: readonly SpecialEntityType[],
): SpecialEntityType[] {
  const rest = types.filter((t) => !MASTER_OWNED_SPECIAL_TYPES.includes(t));
  return [...new Set([...rest, ...masterOwned])];
}

/** Only the fields that changed, for the audit trail's before/after. */
function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)) {
      b[k] = before[k] ?? null;
      a[k] = v ?? null;
    }
  }
  return { before: b, after: a };
}

/** The linked financial-data figure for a parameter (null when the master has none). */
function masterFigure(
  fp: EngagementMasterFacts['cyFinancials'],
  master: EngagementMasterFacts | null,
  parameter: ProfileFinancialParameter,
  current: boolean,
): number | null {
  const fromProfile = (() => {
    if (!fp) return null;
    switch (parameter) {
      case 'paid_up_capital':
        return fp.paidUpCapital;
      case 'turnover':
        return fp.turnover ?? fp.revenue;
      case 'net_worth':
        return fp.netWorth;
      case 'total_assets':
        return fp.totalAssets;
      case 'borrowings':
        return fp.totalBorrowings;
      default:
        return null; // bank/FI borrowings and deposits are not on the master.
    }
  })();
  if (fromProfile != null || !current || !master) return fromProfile;
  if (parameter === 'paid_up_capital') return master.paidUpCapital;
  if (parameter === 'turnover') return master.annualTurnover;
  return null;
}

/** Card D: all seven parameters, CY and PY, each with where it came from. */
function buildFinancialRows(
  master: EngagementMasterFacts | null,
  fins: FinancialRow[],
): ProfileFinancialRow[] {
  return PROFILE_FINANCIAL_PARAMETERS.map((parameter) => {
    const cap = fins.find((f) => f.parameter === parameter) ?? null;
    const capturedLabel = (fy: string | null | undefined) =>
      cap
        ? `02.1 — ${cap.source ? PROFILE_FINANCIAL_SOURCE_LABEL[cap.source] : 'entered'}${cap.preparer ? `, ${cap.preparer}` : ''}${fy ? ` (FY ${fy})` : ''}`
        : null;
    const value = (
      capValue: string | null | undefined,
      masterValue: number | null,
      fp: EngagementMasterFacts['cyFinancials'],
      fallbackLabel: string,
    ): ProfileFinancialValue => {
      const own = num(capValue ?? null);
      if (own != null)
        return {
          value: own,
          origin: 'captured',
          sourceLabel: capturedLabel(fp?.financialYear),
          asOf: cap!.updated_at.toISOString(),
        };
      if (masterValue != null)
        return {
          value: masterValue,
          origin: 'master',
          sourceLabel: fp ? `Financial profile FY ${fp.financialYear}` : fallbackLabel,
          asOf: fp?.updatedAt ?? master?.entityUpdatedAt ?? null,
        };
      return { value: null, origin: null, sourceLabel: null, asOf: null };
    };
    const masterCurrent = masterFigure(master?.cyFinancials ?? null, master, parameter, true);
    const masterPrior = masterFigure(master?.pyFinancials ?? null, master, parameter, false);
    const current = value(
      cap?.current_value,
      masterCurrent,
      master?.cyFinancials ?? null,
      'Entity master',
    );
    const prior = value(
      cap?.prior_value,
      masterPrior,
      master?.pyFinancials ?? null,
      'Entity master',
    );

    // Conflicting source data: the linked figure moved after a value was keyed over it.
    let conflict: string | null = null;
    if (cap && num(cap.current_value) != null) {
      const atCapture = num(cap.master_current_at_capture);
      if (
        masterCurrent != null &&
        atCapture !== masterCurrent &&
        masterCurrent !== num(cap.current_value)
      ) {
        conflict = `${PROFILE_FINANCIAL_LABEL[parameter]}: the linked financial data changed to ${inr(masterCurrent)} after ${inr(num(cap.current_value)!)} was entered on 02.1 — re-enter the figure to confirm which is right, or correct the financial data.`;
      }
    }
    return {
      parameter,
      label: PROFILE_FINANCIAL_LABEL[parameter],
      current,
      prior,
      captured: cap ? mapFinancial(cap) : null,
      conflict,
      required: REQUIRED_PROFILE_FINANCIALS.includes(parameter),
    };
  });
}

function regulatorLabel(p: Pick<ProfileRow, 'regulator' | 'regulator_name'>): string | null {
  if (!p.regulator) return null;
  return p.regulator === 'other' ? (p.regulator_name ?? 'Other') : REGULATOR_LABEL[p.regulator];
}

function accountingLabel(
  p: Pick<
    ProfileRow,
    'accounting_software' | 'accounting_software_other' | 'accounting_environment' | 'service_org'
  >,
): string | null {
  const parts = [
    p.accounting_software
      ? p.accounting_software === 'other'
        ? (p.accounting_software_other ?? 'Other')
        : ACCOUNTING_SOFTWARE_LABEL[p.accounting_software]
      : null,
    p.accounting_environment ? ACCOUNTING_ENVIRONMENT_LABEL[p.accounting_environment] : null,
    usesServiceOrganisation(p.service_org, p.accounting_environment)
      ? 'service organisation'
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
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
