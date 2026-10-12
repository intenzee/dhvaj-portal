import { planRisk } from './section-packs';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ASSERTION_IDS,
  RISK_RATING,
  type AssertionId,
  type AuditRisk,
  type RiskAssertion,
  type RiskRating,
  type RiskSource,
  type RiskStatus,
  type StatutoryAuditRiskRegister,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { isEngagementLead, readEngagementMasterFacts, readInitialAudit } from './master-facts';
import { nextRiskRef } from './plan-risk';
import { displayCode } from './planning-shared';
import { suggestRisks, type RiskSuggestionFacts } from './risk-suggestions';
import { procedureAssertions } from './work-automation';

interface RiskRow {
  id: string;
  workflow_instance_id: string;
  risk_ref: string;
  description: string;
  source: RiskSource;
  fs_area: string | null;
  assertion: RiskAssertion | null;
  audit_area_id: string | null;
  assertion_ids: AssertionId[] | null;
  rating: RiskRating;
  is_significant: boolean;
  is_fraud_risk: boolean;
  response: string | null;
  owner_employee_id: string | null;
  owner_name: string | null;
  reviewer_employee_id: string | null;
  reviewer_name: string | null;
  status: RiskStatus;
  conclusion: string | null;
  source_key: string | null;
  source_note: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface RiskInput {
  description: string;
  source: RiskSource;
  fsArea?: string | null;
  assertion?: RiskAssertion | null;
  /** §24 — the retained 03.5 Audit Area (structural lineage). */
  auditAreaId?: string | null;
  /** Canonical SA 315 assertion ids; must be active on the area when one is set. */
  assertionIds?: AssertionId[] | null;
  rating: RiskRating;
  isSignificant?: boolean;
  isFraudRisk?: boolean;
  response?: string | null;
  ownerEmployeeId?: string | null;
  reviewerEmployeeId?: string | null;
  status?: RiskStatus;
  conclusion?: string | null;
}

/**
 * Statutory Audit — Risk Assessment (Phase 04) service (Audit Spec §22).
 *
 * The risk register is available once Planning is approved (§7 unlock). Each risk
 * carries its source, FS area, assertion, rating, significant / fraud flags,
 * planned response, owner, reviewer, status and conclusion. Risk ↔ procedure
 * two-way navigation (§22) is wired in SA-5 once procedures exist.
 */
@Injectable()
export class AuditRiskService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditRiskRegister[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      // First open by a lead seeds the register with the suggested risks.
      const { rows: shells } = await client.query<{ id: string }>(
        `SELECT swi.id FROM hsdg.service_workflow_instances swi
          WHERE swi.engagement_id = $1 AND swi.status <> 'cancelled'
            AND NOT EXISTS (SELECT 1 FROM hsdg.audit_risk_suggestion_log l
                             WHERE l.workflow_instance_id = swi.id)`,
        [engagementId],
      );
      if (shells.length && (await isEngagementLead(client, engagementId))) {
        for (const sh of shells) await this.suggestOn(client, ctx, engagementId, sh.id, true);
      }
      return this.readRegister(client, engagementId);
    });
  }

  // ── Suggested risks (Section 04, capture once) ─────────────────────────────

  /**
   * "Refresh suggested risks": adds any risk Sections 02–03 now point to that
   * was never suggested on this file before (a deleted suggestion stays
   * deleted). Lead-only. Returns the register and how many were added.
   */
  async suggestRisks(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ register: StatutoryAuditRiskRegister; added: number }> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const added = await this.suggestOn(client, ctx, engagementId, workflowInstanceId, false);
      const [register] = await this.readRegister(client, engagementId);
      return { register: register!, added };
    });
  }

  /**
   * Seed the register once if no lead has opened it yet — the audit work
   * (Section 05 / 06) calls this so its risk responses exist. Caller is a lead.
   */
  async ensureSeeded(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_risk_suggestion_log WHERE workflow_instance_id = $1 LIMIT 1`,
      [workflowInstanceId],
    );
    if (!rows[0]) await this.suggestOn(client, ctx, engagementId, workflowInstanceId, true);
  }

  private async suggestOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    automatic: boolean,
  ): Promise<number> {
    const facts = await this.readSuggestionFacts(client, workflowInstanceId);
    const planned = suggestRisks(facts);
    const { rows: logged } = await client.query<{ source_key: string }>(
      `SELECT source_key FROM hsdg.audit_risk_suggestion_log WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const seen = new Set(logged.map((l) => l.source_key));
    const fresh = planned.filter((p) => !seen.has(p.sourceKey));
    if (fresh.length === 0) {
      // Mark the file as seeded even when there is nothing to add.
      if (automatic && logged.length === 0) {
        await client.query(
          `INSERT INTO hsdg.audit_risk_suggestion_log (workflow_instance_id, engagement_id, source_key)
           VALUES ($1, $2, 'seeded') ON CONFLICT DO NOTHING`,
          [workflowInstanceId, engagementId],
        );
      }
      return 0;
    }
    // Owner = engagement manager, reviewer = engagement partner.
    const { rows: leads } = await client.query<{
      engagement_partner_id: string | null;
      engagement_manager_id: string | null;
    }>(`SELECT engagement_partner_id, engagement_manager_id FROM hsdg.engagements WHERE id = $1`, [
      engagementId,
    ]);
    const owner = leads[0]?.engagement_manager_id ?? leads[0]?.engagement_partner_id ?? null;
    const reviewer = leads[0]?.engagement_partner_id ?? null;
    const { rows: existing } = await client.query<{ risk_ref: string }>(
      `SELECT risk_ref FROM hsdg.audit_risks WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const refs = existing.map((r) => r.risk_ref);
    for (const r of fresh) {
      const riskRef = nextRiskRef(refs);
      refs.push(riskRef);
      await client.query(
        `INSERT INTO hsdg.audit_risks
           (workflow_instance_id, engagement_id, risk_ref, description, source, fs_area,
            assertion, rating, is_significant, is_fraud_risk, response, owner_employee_id,
            reviewer_employee_id, status, source_key, source_note, audit_area_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 (SELECT a.id FROM hsdg.audit_engagement_area a
                    JOIN hsdg.audit_area_review rv ON rv.id = a.review_id
                   WHERE $15 LIKE 'area:%' AND a.id::text = substring($15 FROM 6)
                     AND rv.workflow_instance_id = $1))
         ON CONFLICT DO NOTHING`,
        [
          workflowInstanceId,
          engagementId,
          riskRef,
          r.description,
          r.source,
          r.fsArea,
          r.assertion,
          r.rating,
          r.isSignificant,
          r.isFraudRisk,
          r.response,
          owner,
          reviewer,
          r.response ? 'response_planned' : 'identified',
          r.sourceKey,
          r.sourceNote,
        ],
      );
      await client.query(
        `INSERT INTO hsdg.audit_risk_suggestion_log (workflow_instance_id, engagement_id, source_key)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [workflowInstanceId, engagementId, r.sourceKey],
      );
    }
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.risks_suggested',
      objectType: 'service_workflow_instance',
      objectId: workflowInstanceId,
      after: { added: fresh.map((r) => r.sourceKey), automatic },
    });
    return fresh.length;
  }

  private async readSuggestionFacts(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<RiskSuggestionFacts> {
    const master = await readEngagementMasterFacts(client, workflowInstanceId);
    const signals = await client.query<{
      id: string;
      seq: number;
      source: string;
      observation: string;
      why_may_matter: string | null;
      attention: RiskSuggestionFacts['signals'][number]['attention'];
      manager_assessment: string | null;
      status: string;
    }>(
      `SELECT id, seq, source, observation, why_may_matter, attention, manager_assessment, status
         FROM hsdg.audit_planning_signal WHERE workflow_instance_id = $1 ORDER BY seq`,
      [workflowInstanceId],
    );
    const py = await client.query<{
      id: string;
      seq: number;
      matter_type: string;
      description: string;
      assessment: string | null;
    }>(
      `SELECT id, seq, matter_type, description, assessment
         FROM hsdg.audit_prior_year_matter WHERE workflow_instance_id = $1 ORDER BY seq`,
      [workflowInstanceId],
    );
    const areas = await client.query<{
      id: string;
      area_name: string;
      attention_reason: string | null;
    }>(
      `SELECT a.id, a.area_name, a.attention_reason
         FROM hsdg.audit_engagement_area a
         JOIN hsdg.audit_area_review r ON r.id = a.review_id
        WHERE r.workflow_instance_id = $1 AND a.disposition = 'retained' AND a.attention = 'enhanced'
        ORDER BY a.seq`,
      [workflowInstanceId],
    );
    return {
      isInitialAudit: (await readInitialAudit(client, workflowInstanceId)) === true,
      hasGroupRelationships: (master?.relationships.length ?? 0) > 0,
      signals: signals.rows.map((x) => ({
        id: x.id,
        code: displayCode('PS', x.seq) ?? 'PS',
        source: x.source,
        observation: x.observation,
        whyMayMatter: x.why_may_matter,
        attention: x.attention,
        managerAssessment: x.manager_assessment,
        status: x.status,
      })),
      priorYearMatters: py.rows.map((x) => ({
        id: x.id,
        code: displayCode('PY', x.seq) ?? 'PY',
        matterType: x.matter_type,
        description: x.description,
        assessment: x.assessment,
      })),
      enhancedAreas: areas.rows.map((x) => ({
        id: x.id,
        name: x.area_name,
        reason: x.attention_reason,
      })),
    };
  }

  private async readRegister(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditRiskRegister[]> {
    const { rows: shells } = await client.query<{
      id: string;
      engagement_service_id: string;
      engagement_id: string;
    }>(
      `SELECT id, engagement_service_id, engagement_id
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1 AND status <> 'cancelled'
        ORDER BY created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];
    const shellIds = shells.map((s) => s.id);

    const { rows: risks } = await client.query<RiskRow>(
      `SELECT r.id, r.workflow_instance_id, r.risk_ref, r.description, r.source, r.fs_area,
              r.assertion, r.audit_area_id, r.assertion_ids, r.rating, r.is_significant, r.is_fraud_risk, r.response,
              r.owner_employee_id, owner.full_name AS owner_name,
              r.reviewer_employee_id, reviewer.full_name AS reviewer_name,
              r.status, r.conclusion, r.source_key, r.source_note, r.version, r.created_at,
              r.updated_at
         FROM hsdg.audit_risks r
         LEFT JOIN hsdg.employees owner ON owner.id = r.owner_employee_id
         LEFT JOIN hsdg.employees reviewer ON reviewer.id = r.reviewer_employee_id
        WHERE r.workflow_instance_id = ANY($1::uuid[])
        ORDER BY r.created_at ASC`,
      [shellIds],
    );

    const { rows: planApproved } = await client.query<{ workflow_instance_id: string }>(
      `SELECT DISTINCT workflow_instance_id
         FROM hsdg.audit_planning_approvals
        WHERE workflow_instance_id = ANY($1::uuid[])`,
      [shellIds],
    );
    const planApprovedSet = new Set(planApproved.map((r) => r.workflow_instance_id));

    const { rows: procedures } = await client.query<{
      workflow_instance_id: string;
      risk_id: string | null;
    }>(
      `SELECT workflow_instance_id, risk_id
         FROM hsdg.audit_procedures
        WHERE workflow_instance_id = ANY($1::uuid[]) AND risk_id IS NOT NULL`,
      [shellIds],
    );

    // §24 — the retained 03.5 areas (with their active assertions) a risk may sit in.
    const { rows: areaRows } = await client.query<{
      workflow_instance_id: string;
      id: string;
      area_name: string;
      assertions: { id: AssertionId; label: string }[];
    }>(
      `SELECT rv.workflow_instance_id, a.id, a.area_name,
              COALESCE((SELECT json_agg(json_build_object('id', m.id, 'label', m.label) ORDER BY m.sort_order)
                          FROM hsdg.audit_area_assertion x
                          JOIN hsdg.audit_assertion m ON m.id = x.assertion_id
                         WHERE x.area_id = a.id AND x.active), '[]'::json) AS assertions
         FROM hsdg.audit_area_review rv
         JOIN hsdg.audit_engagement_area a ON a.review_id = rv.id AND a.disposition = 'retained'
        WHERE rv.workflow_instance_id = ANY($1::uuid[])
        ORDER BY a.seq`,
      [shellIds],
    );

    return shells.map((shell) => {
      const shellRisks = risks.filter((r) => r.workflow_instance_id === shell.id);
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        planningApproved: planApprovedSet.has(shell.id),
        risks: shellRisks.map(mapRisk),
        pack: planRisk({
          planningApproved: planApprovedSet.has(shell.id),
          risks: shellRisks.map(mapRisk),
          procedures: procedures
            .filter((p) => p.workflow_instance_id === shell.id)
            .map((p) => ({ riskId: p.risk_id })),
        }),
        // A significant risk requires an explicit response (§29).
        areaOptions: areaRows
          .filter((a) => a.workflow_instance_id === shell.id)
          .map((a) => ({ id: a.id, name: a.area_name, assertions: a.assertions })),
        significantRisksWithoutResponse: shellRisks.filter(
          (r) =>
            (r.is_significant || r.rating === RISK_RATING.significant) &&
            !(r.response && r.response.trim().length > 0),
        ).length,
      };
    });
  }

  // ── Create (§22) ────────────────────────────────────────────────────────────

  async createRisk(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RiskInput,
  ): Promise<StatutoryAuditRiskRegister> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);

      const { rows: existing } = await client.query<{ risk_ref: string }>(
        `SELECT risk_ref FROM hsdg.audit_risks WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const isSignificant = input.isSignificant ?? input.rating === RISK_RATING.significant;
      const link = await resolveAreaLink(
        client,
        workflowInstanceId,
        input.auditAreaId ?? null,
        input.assertionIds ?? [],
      );

      // Assign the next ref, retrying on the rare concurrent-insert collision.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const refs =
          attempt === 0
            ? existing.map((r) => r.risk_ref)
            : (
                await client.query<{ risk_ref: string }>(
                  `SELECT risk_ref FROM hsdg.audit_risks WHERE workflow_instance_id = $1`,
                  [workflowInstanceId],
                )
              ).rows.map((r) => r.risk_ref);
        const riskRef = nextRiskRef(refs);
        try {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO hsdg.audit_risks
               (workflow_instance_id, engagement_id, risk_ref, description, source, fs_area,
                assertion, rating, is_significant, is_fraud_risk, response, owner_employee_id,
                reviewer_employee_id, status, conclusion, audit_area_id, assertion_ids)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING id`,
            [
              workflowInstanceId,
              engagementId,
              riskRef,
              input.description.trim(),
              input.source,
              input.fsArea?.trim() || link.areaName,
              input.assertion ?? link.legacyAssertion,
              input.rating,
              isSignificant,
              input.isFraudRisk ?? false,
              input.response?.trim() || null,
              input.ownerEmployeeId ?? null,
              input.reviewerEmployeeId ?? null,
              input.status ?? 'identified',
              input.conclusion?.trim() || null,
              link.areaId,
              link.assertionIds,
            ],
          );
          await this.audit.recordWith(client, ctx, {
            action: 'statutory_audit.risk_created',
            objectType: 'audit_risk',
            objectId: rows[0]!.id,
            after: {
              riskRef,
              rating: input.rating,
              isSignificant,
              auditAreaId: link.areaId,
              assertionIds: link.assertionIds,
            },
          });
          const [register] = await this.readRegister(client, engagementId);
          return register!;
        } catch (err) {
          if ((err as { code?: string }).code === '23505' && attempt < 2) continue; // ref race
          throw err;
        }
      }
      throw new ConflictException('Could not assign a risk reference; retry.');
    });
  }

  // ── Update (§22) ──────────────────────────────────────────────────────────

  async updateRisk(
    ctx: RlsContext,
    engagementId: string,
    riskId: string,
    input: Partial<RiskInput> & { version: number },
  ): Promise<StatutoryAuditRiskRegister> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        rating: RiskRating;
        workflow_instance_id: string;
        audit_area_id: string | null;
        assertion_ids: AssertionId[];
      }>(
        `SELECT id, rating, workflow_instance_id, audit_area_id, assertion_ids
           FROM hsdg.audit_risks WHERE id = $1 AND engagement_id = $2`,
        [riskId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Risk not found.');

      // PATCH semantics: an omitted field (undefined) is left unchanged; an
      // explicit null clears a nullable field. This keeps a partial update
      // (e.g. status-only from the mobile client) from wiping FS area,
      // assertion, response, owner, reviewer or conclusion.
      const params: unknown[] = [riskId, input.version];
      const sets: string[] = [];
      const set = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };

      if (input.description !== undefined) set('description', input.description.trim());
      if (input.source !== undefined) set('source', input.source);
      if (input.fsArea !== undefined) set('fs_area', input.fsArea?.trim() || null);
      if (input.assertion !== undefined) set('assertion', input.assertion ?? null);
      if (input.auditAreaId !== undefined || input.assertionIds !== undefined) {
        const areaId =
          input.auditAreaId !== undefined ? (input.auditAreaId ?? null) : current.audit_area_id;
        const link = await resolveAreaLink(
          client,
          current.workflow_instance_id,
          areaId,
          input.assertionIds !== undefined ? (input.assertionIds ?? []) : current.assertion_ids,
          // An area change keeps only the assertions still active on the new area.
          input.assertionIds === undefined,
        );
        set('audit_area_id', link.areaId);
        set('assertion_ids', link.assertionIds);
        if (input.fsArea === undefined && link.areaName) set('fs_area', link.areaName);
        if (input.assertion === undefined && link.legacyAssertion)
          set('assertion', link.legacyAssertion);
      }
      if (input.rating !== undefined) set('rating', input.rating);
      // A risk rated "significant" is significant unless the caller says otherwise.
      if (input.isSignificant !== undefined) set('is_significant', input.isSignificant);
      else if (input.rating === RISK_RATING.significant) set('is_significant', true);
      if (input.isFraudRisk !== undefined) set('is_fraud_risk', input.isFraudRisk);
      if (input.response !== undefined) set('response', input.response?.trim() || null);
      if (input.ownerEmployeeId !== undefined)
        set('owner_employee_id', input.ownerEmployeeId ?? null);
      if (input.reviewerEmployeeId !== undefined)
        set('reviewer_employee_id', input.reviewerEmployeeId ?? null);
      if (input.status !== undefined) set('status', input.status);
      if (input.conclusion !== undefined) set('conclusion', input.conclusion?.trim() || null);

      const result = await client.query(
        `UPDATE hsdg.audit_risks
            SET ${sets.length ? `${sets.join(', ')}, ` : ''}version = version + 1
          WHERE id = $1 AND version = $2`,
        params,
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('This risk changed since you loaded it; refresh and retry.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.risk_updated',
        objectType: 'audit_risk',
        objectId: riskId,
        after: {
          status: input.status,
          rating: input.rating,
          auditAreaId: input.auditAreaId,
          assertionIds: input.assertionIds,
        },
      });
      const [register] = await this.readRegister(client, engagementId);
      return register!;
    });
  }

  // ── Delete (§22) ────────────────────────────────────────────────────────────

  async deleteRisk(
    ctx: RlsContext,
    engagementId: string,
    riskId: string,
  ): Promise<StatutoryAuditRiskRegister> {
    return this.db.withRlsContext(ctx, async (client) => {
      const result = await client.query(
        `DELETE FROM hsdg.audit_risks WHERE id = $1 AND engagement_id = $2`,
        [riskId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Risk not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.risk_deleted',
        objectType: 'audit_risk',
        objectId: riskId,
      });
      const [register] = await this.readRegister(client, engagementId);
      return register!;
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2 AND status <> 'cancelled'`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
  }
}

function mapRisk(r: RiskRow): AuditRisk {
  return {
    id: r.id,
    riskRef: r.risk_ref,
    description: r.description,
    source: r.source,
    fsArea: r.fs_area,
    assertion: r.assertion,
    auditAreaId: r.audit_area_id,
    assertionIds: r.assertion_ids ?? [],
    rating: r.rating,
    isSignificant: r.is_significant,
    isFraudRisk: r.is_fraud_risk,
    response: r.response,
    ownerEmployeeId: r.owner_employee_id,
    ownerName: r.owner_name,
    reviewerEmployeeId: r.reviewer_employee_id,
    reviewerName: r.reviewer_name,
    status: r.status,
    conclusion: r.conclusion,
    sourceKey: r.source_key,
    sourceNote: r.source_note,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/**
 * §24 lineage (03.5 → Section 04) — a risk sits in a RETAINED Audit Area of
 * this file's 03.5 and bears on assertions ACTIVE on that area (AT-20: only
 * retained areas and active assertions are the current planning population).
 * Without an area the canonical ids are still validated against the master.
 */
async function resolveAreaLink(
  client: PoolClient,
  workflowInstanceId: string,
  areaId: string | null,
  assertionIds: readonly string[],
  dropInactive = false,
): Promise<{
  areaId: string | null;
  areaName: string | null;
  assertionIds: AssertionId[];
  legacyAssertion: RiskAssertion | null;
}> {
  const ids = [...new Set(assertionIds)];
  const unknown = ids.filter((i) => !(ASSERTION_IDS as readonly string[]).includes(i));
  if (unknown.length) {
    throw new BadRequestException(`Unknown assertion id(s): ${unknown.join(', ')}.`);
  }
  let areaName: string | null = null;
  let kept = ids as AssertionId[];
  if (areaId) {
    const { rows } = await client.query<{ area_name: string; active: AssertionId[] }>(
      `SELECT a.area_name,
              ARRAY(SELECT x.assertion_id FROM hsdg.audit_area_assertion x
                     WHERE x.area_id = a.id AND x.active) AS active
         FROM hsdg.audit_engagement_area a
         JOIN hsdg.audit_area_review rv ON rv.id = a.review_id
        WHERE a.id = $1 AND rv.workflow_instance_id = $2 AND a.disposition = 'retained'`,
      [areaId, workflowInstanceId],
    );
    const area = rows[0];
    if (!area) {
      throw new BadRequestException(
        'Choose a retained 03.5 Audit Area of this audit file — or ask 03.5 to add the area.',
      );
    }
    areaName = area.area_name;
    const inactive = kept.filter((i) => !area.active.includes(i));
    if (inactive.length && !dropInactive) {
      throw new BadRequestException(
        `Not an active assertion of ${area.area_name} in 03.5: ${inactive.join(', ')}.`,
      );
    }
    kept = kept.filter((i) => area.active.includes(i));
  }
  const legacy = procedureAssertions(kept);
  return {
    areaId,
    areaName,
    assertionIds: kept,
    legacyAssertion: legacy.length === 1 ? (legacy[0] as RiskAssertion) : null,
  };
}
