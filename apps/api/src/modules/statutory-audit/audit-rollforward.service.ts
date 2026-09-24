import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CARO_OUTCOME,
  CONSOLIDATION_OUTCOME,
  FRAMEWORK_AREA_KEY,
  ICFR_OUTCOME,
  SUB_SECTION_KEY,
  changedSections,
  compareProfile,
  rollForwardSections,
  type CurrentSection,
  type FrameworkState,
  type PriorSection,
  type RollForwardComparison,
  type RollForwardProfileSnapshot,
  type SubSectionKey,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

/** The six Section-02 sub-sections, in dashboard order (for the current-year view). */
const SECTIONS: Array<{ sub: SubSectionKey; area: string; title: string }> = [
  {
    sub: SUB_SECTION_KEY.financialReporting,
    area: FRAMEWORK_AREA_KEY.financialReportingFramework,
    title: 'Applicable Financial Reporting Framework',
  },
  {
    sub: SUB_SECTION_KEY.scheduleIii,
    area: FRAMEWORK_AREA_KEY.scheduleIii,
    title: 'Schedule III & Presentation Framework',
  },
  { sub: SUB_SECTION_KEY.caro, area: FRAMEWORK_AREA_KEY.caro, title: 'CARO 2020 Applicability' },
  {
    sub: SUB_SECTION_KEY.icfr,
    area: FRAMEWORK_AREA_KEY.ifc,
    title: 'Internal Financial Controls / ICFR Reporting',
  },
  {
    sub: SUB_SECTION_KEY.consolidation,
    area: FRAMEWORK_AREA_KEY.cfs,
    title: 'Consolidation / Group Audit Framework',
  },
  {
    sub: SUB_SECTION_KEY.otherReporting,
    area: FRAMEWORK_AREA_KEY.otherRegulatory,
    title: 'Other Companies Act & Statutory Reporting',
  },
];

/** Carried conclusions that mean "does not apply" — suggested as Not Applicable, not Applicable. */
const NOT_APPLICABLE_OUTCOMES = new Set<string>([
  CARO_OUTCOME.notApplicableExempt,
  ICFR_OUTCOME.exempt,
  CONSOLIDATION_OUTCOME.notApplicable,
  CONSOLIDATION_OUTCOME.cfsExempt,
]);

/**
 * Prior-year roll-forward for continuing audits (Implementation Guide §12).
 * Reads the prior-year statutory-audit file for the entity, compares the tracked
 * 02.1 facts + the 02.2–02.7 conclusions with the current year, and applies the
 * carry-forward (prior conclusion → current System Suggested) + re-evaluation
 * flags (reusing the reassessment `needs_reevaluation` mechanism, §13). It never
 * makes a carried conclusion silently final and never deletes downstream work.
 */
@Injectable()
export class AuditRollForwardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async getComparison(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<RollForwardComparison> {
    return this.db.withRlsContext(ctx, (client) =>
      this.build(client, engagementId, workflowInstanceId),
    );
  }

  async apply(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<RollForwardComparison> {
    return this.db.withRlsContext(ctx, async (client) => {
      const cmp = await this.build(client, engagementId, workflowInstanceId);
      if (!cmp.hasPriorYear) {
        throw new BadRequestException('No prior-year statutory-audit file to roll forward from.');
      }
      if (!cmp.isContinuingAudit) {
        throw new BadRequestException(
          'Roll-forward applies to a continuing audit; 02.1 marks this a first-year (initial) audit.',
        );
      }

      // Carry a decided prior conclusion into an undecided current section, as a
      // System Suggestion (never silently final).
      for (const s of cmp.sections) {
        if (!s.carriedForward || s.priorConclusion == null) continue;
        await client.query(
          `UPDATE hsdg.audit_framework_subassessment
              SET system_outcome = $4, system_basis = $5, state = $6
            WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3
              AND state NOT IN ('applicable','not_applicable','overridden','approved')`,
          [
            workflowInstanceId,
            s.subSectionKey,
            areaFor(s.subSectionKey),
            s.priorConclusion,
            `Carried forward from FY ${cmp.priorFinancialYear} as a system suggestion — confirm for this year.`,
            NOT_APPLICABLE_OUTCOMES.has(s.priorConclusion)
              ? 'system_suggested_not_applicable'
              : 'system_suggested_applicable',
          ],
        );
      }

      // Any change affecting an already-decided section flags it for re-evaluation.
      if (cmp.changedSections.length > 0) {
        await client.query(
          `UPDATE hsdg.audit_framework_subassessment
              SET needs_reevaluation = true
            WHERE workflow_instance_id = $1 AND sub_section_key = ANY($2::text[])`,
          [workflowInstanceId, cmp.changedSections],
        );
      }
      // A tracked profile fact change re-opens the 02.1 profile for reconsideration.
      if (cmp.profileChanges.some((c) => c.changed)) {
        await client.query(
          `UPDATE hsdg.audit_entity_profile SET needs_reevaluation = true WHERE workflow_instance_id = $1`,
          [workflowInstanceId],
        );
      }

      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.rollforward_applied',
        objectType: 'service_workflow_instances',
        objectId: workflowInstanceId,
        after: {
          priorFinancialYear: cmp.priorFinancialYear,
          carried: cmp.sections.filter((s) => s.carriedForward).map((s) => s.subSectionKey),
          reevaluated: cmp.changedSections,
        },
      });
      return this.build(client, engagementId, workflowInstanceId);
    });
  }

  // ── build the comparison ───────────────────────────────────────────────────

  private async build(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<RollForwardComparison> {
    const ctx = await this.currentContext(client, engagementId, workflowInstanceId);
    const currentSnapshot = await this.snapshot(client, workflowInstanceId, ctx);
    const currentSections = await this.currentSections(client, workflowInstanceId);

    const prior = await this.priorShell(
      client,
      ctx.entityId,
      ctx.financialYear,
      workflowInstanceId,
    );
    if (!prior) {
      return {
        isContinuingAudit: ctx.initialAudit === false,
        hasPriorYear: false,
        priorEngagementId: null,
        priorFinancialYear: null,
        currentFinancialYear: ctx.financialYear,
        profileChanges: [],
        sections: currentSections.map((c) => ({
          subSectionKey: c.subSectionKey,
          title: c.title,
          priorConclusion: null,
          priorState: null,
          currentConclusion: c.conclusion,
          currentState: c.state,
          changed: false,
          carriedForward: false,
        })),
        changedSections: [],
      };
    }

    const priorSnapshot = await this.snapshot(client, prior.workflowInstanceId, {
      entityId: ctx.entityId,
      financialYear: prior.financialYear,
    });
    const priorSections = await this.priorSections(client, prior.workflowInstanceId);

    const profileChanges = compareProfile(priorSnapshot, currentSnapshot);
    const sections = rollForwardSections(priorSections, currentSections);
    return {
      isContinuingAudit: ctx.initialAudit === false,
      hasPriorYear: true,
      priorEngagementId: prior.engagementId,
      priorFinancialYear: prior.financialYear,
      currentFinancialYear: ctx.financialYear,
      profileChanges,
      sections,
      changedSections: changedSections(profileChanges, sections),
    };
  }

  private async currentContext(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ entityId: string; financialYear: string | null; initialAudit: boolean | null }> {
    const { rows } = await client.query<{ entity_id: string; financial_year: string | null }>(
      `SELECT e.entity_id, e.financial_year
         FROM hsdg.service_workflow_instances swi
         JOIN hsdg.engagements e ON e.id = swi.engagement_id
        WHERE swi.id = $1 AND swi.engagement_id = $2`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    const prof = await client.query<{ initial_audit: boolean }>(
      `SELECT initial_audit FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return {
      entityId: rows[0].entity_id,
      financialYear: rows[0].financial_year,
      initialAudit: prof.rows[0]?.initial_audit ?? null,
    };
  }

  private async priorShell(
    client: PoolClient,
    entityId: string,
    currentFy: string | null,
    currentWorkflowInstanceId: string,
  ): Promise<{ workflowInstanceId: string; engagementId: string; financialYear: string } | null> {
    if (currentFy == null) return null;
    const { rows } = await client.query<{
      id: string;
      engagement_id: string;
      financial_year: string;
    }>(
      `SELECT swi.id, swi.engagement_id, e.financial_year
         FROM hsdg.service_workflow_instances swi
         JOIN hsdg.engagements e ON e.id = swi.engagement_id
        WHERE e.entity_id = $1 AND e.financial_year < $2 AND swi.id <> $3
          AND EXISTS (SELECT 1 FROM hsdg.audit_entity_profile p WHERE p.workflow_instance_id = swi.id)
        ORDER BY e.financial_year DESC
        LIMIT 1`,
      [entityId, currentFy, currentWorkflowInstanceId],
    );
    return rows[0]
      ? {
          workflowInstanceId: rows[0].id,
          engagementId: rows[0].engagement_id,
          financialYear: rows[0].financial_year,
        }
      : null;
  }

  private async snapshot(
    client: PoolClient,
    workflowInstanceId: string,
    ctx: { entityId: string; financialYear: string | null },
  ): Promise<RollForwardProfileSnapshot> {
    const type = await client.query<{ category: string }>(
      `SELECT et.category FROM hsdg.entities ent
         JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
        WHERE ent.id = $1`,
      [ctx.entityId],
    );
    const listed = await client.query(
      `SELECT 1 FROM hsdg.entity_listings WHERE entity_id = $1 AND status = 'listed' LIMIT 1`,
      [ctx.entityId],
    );
    const prof = await client.query<{
      special_entity_types: string[];
      accounting_environment: string | null;
    }>(
      `SELECT special_entity_types, accounting_environment FROM hsdg.audit_entity_profile
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    // Group relationships proxied by the 02.6 captured investee perimeter.
    const cfs = await client.query<{ facts: { investees?: unknown[] } | null }>(
      `SELECT facts FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, SUB_SECTION_KEY.consolidation, FRAMEWORK_AREA_KEY.cfs],
    );
    const investees = cfs.rows[0]?.facts?.investees;
    return {
      isListed: (listed.rowCount ?? 0) > 0,
      groupHasRelationships: Array.isArray(investees) && investees.length > 0,
      entityCategory: type.rows[0]?.category ?? null,
      specialEntityTypes: prof.rows[0]?.special_entity_types ?? [],
      financialYear: ctx.financialYear,
      accountingEnvironment: prof.rows[0]?.accounting_environment ?? null,
    };
  }

  private async currentSections(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<CurrentSection[]> {
    const rows = await this.subassessmentRows(client, workflowInstanceId);
    const byKey = new Map(rows.map((r) => [`${r.sub_section_key}|${r.area_key}`, r]));
    return SECTIONS.map(({ sub, area, title }) => {
      const r = byKey.get(`${sub}|${area}`);
      return {
        subSectionKey: sub,
        title,
        conclusion: r?.conclusion ?? null,
        state: (r?.state ?? 'not_assessed') as FrameworkState,
      };
    });
  }

  private async priorSections(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<PriorSection[]> {
    const rows = await this.subassessmentRows(client, workflowInstanceId);
    const byKey = new Map(rows.map((r) => [`${r.sub_section_key}|${r.area_key}`, r]));
    return SECTIONS.map(({ sub, area }) => {
      const r = byKey.get(`${sub}|${area}`);
      return {
        subSectionKey: sub,
        conclusion: r?.conclusion ?? r?.system_outcome ?? null,
        state: (r?.state ?? 'not_assessed') as FrameworkState,
      };
    });
  }

  private async subassessmentRows(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<
    Array<{
      sub_section_key: string;
      area_key: string;
      conclusion: string | null;
      system_outcome: string | null;
      state: FrameworkState;
    }>
  > {
    const { rows } = await client.query<{
      sub_section_key: string;
      area_key: string;
      conclusion: string | null;
      system_outcome: string | null;
      state: FrameworkState;
    }>(
      `SELECT sub_section_key, area_key, conclusion, system_outcome, state
         FROM hsdg.audit_framework_subassessment WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows;
  }
}

function areaFor(sub: SubSectionKey): string {
  return SECTIONS.find((s) => s.sub === sub)?.area ?? '';
}
