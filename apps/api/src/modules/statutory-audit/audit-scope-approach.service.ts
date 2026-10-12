import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CUSTOM_DECISION_OPTIONS,
  FINANCIAL_UNIT_FACTOR,
  IMPLICATION_RESPONSES,
  NOTIFICATION_TYPE,
  PARTNER_ACTION_LABEL,
  PLANNING_ACTOR_ROLE_LABEL,
  PLANNING_CHANGE_CATEGORY_LABEL,
  SCOPE_HANDOFF_ITEMS,
  SCOPE_METHODOLOGY_KINDS,
  SCOPE_METHODOLOGY_VERSION,
  SCOPE_REVISION_TRIGGER_LABEL,
  SCOPE_TEAM_MAP_FIELDS,
  SCOPE_TEAM_RECORD_FIELDS,
  SCOPE_TEAM_SERVICE_ORG_FIELDS,
  SCOPE_TEAM_UNIT_FIELDS,
  SPECIALIST_AREA_LABEL,
  SPECIALIST_DECISIONS,
  materialityVersionLabel,
  scopeVersionLabel,
  type ConvertScopeMapAreaInput,
  type FlagScopeReassessmentInput,
  type LinkScopeMapAreaInput,
  type NewSpecialistInput,
  type PartnerScopeActionInput,
  type PlanningAttention,
  type PlanningChangeCategory,
  type RespondPartnerActionInput,
  type SaveScopeConsiderationInput,
  type SaveScopeDecisionInput,
  type ScopeAccess,
  type ScopeApproachRecord,
  type ScopeApproachSummary,
  type ScopeAuthorityRef,
  type ScopeConsideration,
  type ScopeDecision,
  type ScopeDecisionKind,
  type ScopeDependency,
  type ScopeDependencyInput,
  type ScopeHandoff,
  type ScopeIntelligenceItem,
  type ScopeLimitation,
  type ScopeLimitationInput,
  type ScopeMapItem,
  type ScopeMapItemInput,
  type ScopeMaterialityRef,
  type ScopeObFact,
  type ScopePartnerAction,
  type ScopeRevision,
  type ScopeServiceOrg,
  type ScopeUnit,
  type ScopeUnitInput,
  type ServiceOrgInput,
  type StartScopeRevisionInput,
  type UpdateScopeApproachInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditAreaReviewService } from './audit-area-review.service';
import { AuditBusinessUnderstandingService } from './audit-business-understanding.service';
import { readFrameworkRecordInputsOn } from './framework-summary-inputs';
import { s197Applies } from './framework-summary-records';
import { readPriorAuditFile } from './master-facts';
import { flagPlanningItems, itemsForModules } from './planning-downstream';
import {
  assertPlanningCapability,
  notifyPlanning,
  resolvePlanningActor,
  syncScopeAttention,
  type PlanningActor,
} from './planning-governance';
import {
  assertShell,
  assertSignalsInShell,
  clean,
  cleanList,
  displayCode,
  insertSignal,
  maxSeq,
} from './planning-shared';
import {
  approachConsiderations,
  composeScopeConclusion,
  consistencyChecks,
  decisionPrompt,
  deriveTriggers,
  generateImplications,
  generateMapAreas,
  generatePopulation,
  generateSpecialists,
  isSignificantDependency,
  materialityContext,
  partnerAttention,
  scopeCompletion,
  specificFor,
  suggestedConfirmationAreas,
  suggestUnitSignals,
  unitFinPrompt,
  type ScopeFacts,
  type ScopeState,
} from './scope-approach-engine';
import { SCOPE_ITEM_KEYS, flagScopeReassessment } from './scope-hooks';
import { linkScopeMap, readLinkedAreas } from './scope-map-link';
import { readScopeDecisionDefs, type ScopeDecisionDefs } from './scope-methodology-library';

/** §32 — anchors into authority_reference_link context '03.4' (labels / provisions live there). */
const SCOPE_AUTHORITY_CONTEXT = '03.4';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : s(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

/** Everything 03.4 derives for one request. */
interface Workspace {
  facts: ScopeFacts;
  materiality: ScopeMaterialityRef | null;
  state: ScopeState;
  signalCodes: Map<string, string>;
  defs: ScopeDecisionDefs;
}

/**
 * §30 — fields outside the team's list are the Manager's. Throws when a
 * preparer (Article / Senior, or the EP not acting as Manager) sends one.
 */
function assertTeamFields(actor: PlanningActor, input: object, allowed: readonly string[]): void {
  if (actor.capabilities.assess) return;
  assertPlanningCapability(actor, 'addFacts', '03.4');
  const extra = Object.entries(input)
    .filter(([k, v]) => k !== 'version' && v !== undefined && !allowed.includes(k))
    .map(([k]) => k);
  if (extra.length) {
    throw new ForbiddenException(
      `Only the Engagement Manager concludes ${extra.join(', ')} in 03.4 — the engagement team prepares facts and drafts. (You are: ${PLANNING_ACTOR_ROLE_LABEL[actor.role]}.)`,
    );
  }
}

/**
 * 03.4 Audit Scope & Approach (DHVAJ 03.4). The portal presents the population,
 * the engagement characteristics that affect scope and the evidence channels
 * and special considerations suggested by what is already known; the
 * Engagement Manager decides the strategic approach and explains exceptions.
 */
@Injectable()
export class AuditScopeApproachService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly understanding: AuditBusinessUnderstandingService,
    private readonly areaReview: AuditAreaReviewService,
  ) {}

  // ── Summary / conclusion ──────────────────────────────────────────────────

  async getSummary(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      // First open by anyone who prepares 03.4 builds the population and approach
      // map from Section 02 / 03.1–03.3 straight away (as 03.5 populates on first entry).
      if (!(await this.readRecord(client, wi))) {
        const actor = await resolvePlanningActor(client, engagementId);
        if (actor.capabilities.addFacts || actor.capabilities.assess) {
          await this.ensure(client, ctx, engagementId, wi);
        }
      }
      return this.buildSummary(client, wi, false);
    });
  }

  async draftConclusion(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
  ): Promise<{ draft: string }> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      const ws = await this.workspace(client, wi);
      return { draft: composeScopeConclusion(ws.state, partnerAttention(ws.state)) };
    });
  }

  // ── Record (SC / AP / EC / OB / IA / DT / SL / AP-02) ─────────────────────

  async update(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: UpdateScopeApproachInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      assertTeamFields(
        await resolvePlanningActor(client, engagementId),
        input,
        SCOPE_TEAM_RECORD_FIELDS,
      );
      const { id, created } = await this.ensure(client, ctx, engagementId, wi);
      const cur = (await this.readRecord(client, wi))!;
      if (!(created && input.version === 0) && input.version !== cur.version) {
        throw new ConflictException(
          'Scope & approach changed since you loaded it; refresh and retry.',
        );
      }
      this.assertDraft(cur);
      const pick = <T>(v: T | undefined, c: T): T => (v !== undefined ? v : c);
      const txt = (v: string | null | undefined, c: string | null) =>
        v !== undefined ? clean(v) : c;
      const next: ScopeApproachRecord = {
        ...cur,
        sc01: pick(input.sc01, cur.sc01),
        sc01Other: txt(input.sc01Other, cur.sc01Other),
        sc02: pick(input.sc02, cur.sc02),
        sc02Note: txt(input.sc02Note, cur.sc02Note),
        ap01: pick(input.ap01, cur.ap01),
        ap01Rationale: txt(input.ap01Rationale, cur.ap01Rationale),
        icfrNote: txt(input.icfrNote, cur.icfrNote),
        ec01: pick(input.ec01, cur.ec01),
        ec01Areas: input.ec01Areas
          ? (cleanList(input.ec01Areas) as ScopeApproachRecord['ec01Areas'])
          : cur.ec01Areas,
        ec01Note: txt(input.ec01Note, cur.ec01Note),
        inventoryDecision: pick(input.inventoryDecision, cur.inventoryDecision),
        inventoryLocations: txt(input.inventoryLocations, cur.inventoryLocations),
        inventoryNote: txt(input.inventoryNote, cur.inventoryNote),
        physicalOther: pick(input.physicalOther, cur.physicalOther),
        physicalOtherNote: txt(input.physicalOtherNote, cur.physicalOtherNote),
        obInputs: input.obInputs ? sanitizeObInputs(input.obInputs) : cur.obInputs,
        ob01: pick(input.ob01, cur.ob01),
        ob01Note: txt(input.ob01Note, cur.ob01Note),
        ia01: pick(input.ia01, cur.ia01),
        ia01Note: txt(input.ia01Note, cur.ia01Note),
        jointAuditNote: txt(input.jointAuditNote, cur.jointAuditNote),
        dt01: pick(input.dt01, cur.dt01),
        dt01Note: txt(input.dt01Note, cur.dt01Note),
        sl01: pick(input.sl01, cur.sl01),
        conclusionSummary: txt(input.conclusionSummary, cur.conclusionSummary),
        ap02: pick(input.ap02, cur.ap02),
      };
      if (next.sc01 === 'other' && !next.sc01Other) {
        throw new BadRequestException(
          'SC-01 "Other statutory financial statements" needs a description.',
        );
      }
      if (next.sc02 === 'requires_correction' && !next.sc02Note) {
        throw new BadRequestException(
          'SC-02 "Requires correction" needs a note of what must be corrected in Section 02.',
        );
      }
      if (next.sl01 === 'no') {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.audit_scope_limitation WHERE scope_id = $1 AND status = 'open'`,
          [id],
        );
        if (rows.length) {
          throw new BadRequestException(
            'SL-01 cannot be "No" while a potential scope limitation is open.',
          );
        }
      }

      const completing = input.ap02 === 'yes_complete';
      const { methodology } = await readScopeDecisionDefs(client);
      let materialityVersionNo = cur.materialityVersionNo;
      if (completing) {
        const ws = await this.workspace(client, wi, next);
        const checks = scopeCompletion(ws.state, consistencyChecks(ws.state)).filter(
          (c) => c.key !== 'ap02',
        );
        const problems = checks.filter((c) => !c.met).map((c) => c.detail ?? c.label);
        if (!next.conclusionSummary) problems.push('Review the generated conclusion (AP-02).');
        if (problems.length) {
          throw new ConflictException(`03.4 cannot be completed yet: ${problems.join(' ')}`);
        }
        materialityVersionNo = ws.materiality?.versionNo ?? null;
      }

      await client.query(
        `UPDATE hsdg.audit_scope_approach SET
           sc01 = $2, sc01_other = $3, sc02 = $4, sc02_note = $5, ap01 = $6, ap01_rationale = $7,
           icfr_note = $8, ec01 = $9, ec01_areas = $10, ec01_note = $11, inventory_decision = $12,
           inventory_locations = $13, inventory_note = $14, physical_other = $15,
           physical_other_note = $16, ob_inputs = $17::jsonb, ob01 = $18, ob01_note = $19,
           ia01 = $20, ia01_note = $21, joint_audit_note = $22, dt01 = $23, dt01_note = $24,
           sl01 = $25, conclusion_summary = $26, ap02 = $27,
           status = $28, materiality_version_no = $29,
           completed_by_employee_id = CASE WHEN $28 = 'complete' THEN $30::uuid ELSE NULL END,
           completed_at = CASE WHEN $28 = 'complete' THEN now() ELSE NULL END,
           reassessment_reason = CASE WHEN $28 = 'complete' THEN NULL ELSE reassessment_reason END,
           reassessment_source = CASE WHEN $28 = 'complete' THEN NULL ELSE reassessment_source END,
           methodology_version = $31,
           version = version + 1
         WHERE id = $1`,
        [
          id,
          next.sc01,
          next.sc01Other,
          next.sc02,
          next.sc02Note,
          next.ap01,
          next.ap01Rationale,
          next.icfrNote,
          next.ec01,
          next.ec01Areas,
          next.ec01Note,
          next.inventoryDecision,
          next.inventoryLocations,
          next.inventoryNote,
          next.physicalOther,
          next.physicalOtherNote,
          JSON.stringify(next.obInputs),
          next.ob01,
          next.ob01Note,
          next.ia01,
          next.ia01Note,
          next.jointAuditNote,
          next.dt01,
          next.dt01Note,
          next.sl01,
          next.conclusionSummary,
          completing ? 'yes_complete' : next.ap02 === 'yes_complete' ? null : next.ap02,
          completing ? 'complete' : 'draft',
          materialityVersionNo,
          ctx.employeeId ?? null,
          methodology.version,
        ],
      );
      await this.rollUp(client, ctx, wi, completing ? 'complete' : 'in_progress');
      // §6 — a completed strategy is what 03.8 / 03.9 / 03.11 plan from: their
      // completed checklist rows need a look when the hand-off carries anything.
      if (completing) {
        const ws = await this.workspace(client, wi);
        await flagPlanningItems(client, wi, handoffItems(buildHandoff(ws.state)));
      }
      await this.audit.recordWith(client, ctx, {
        action: completing
          ? 'statutory_audit.scope_approach_completed'
          : 'statutory_audit.scope_approach_updated',
        objectType: 'audit_scope_approach',
        objectId: id,
        before: diffOf(cur, next, input).before,
        after: diffOf(cur, next, input).after,
      });
      return this.buildSummary(client, wi);
    });
  }

  /** Re-derive population, map areas, service-org cards and prompts from sources. */
  async generate(ctx: RlsContext, engagementId: string, wi: string): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      const { id, created } = await this.ensure(client, ctx, engagementId, wi);
      if (!created) {
        this.assertDraft((await this.readRecord(client, wi))!);
        await this.sync(client, engagementId, wi, id);
        await this.touched(client, ctx, wi, id);
      }
      await linkScopeMap(client, wi);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_approach_generated',
        objectType: 'audit_scope_approach',
        objectId: id,
      });
      return this.buildSummary(client, wi);
    });
  }

  // ── Audit Population (SC-03) ─────────────────────────────────────────────

  async saveUnit(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    unitId: string | null,
    input: ScopeUnitInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      assertTeamFields(
        await resolvePlanningActor(client, engagementId),
        input,
        SCOPE_TEAM_UNIT_FIELDS,
      );
      const scopeId = await this.editable(client, ctx, engagementId, wi);
      await assertSignalsInShell(client, wi, input.signalIds ?? []);
      await this.assertFocusInShell(client, wi, input.focusIds ?? []);
      let id = unitId;
      if (!id) {
        const name = clean(input.name);
        if (!name) throw new BadRequestException('A unit needs a name.');
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_scope_unit (scope_id, engagement_id, seq, name, unit_type, source_label)
           VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_scope_unit WHERE scope_id = $1),
                   $3, $4, 'Manager')
           RETURNING id`,
          [scopeId, engagementId, name, input.unitType ?? 'other'],
        );
        id = rows[0]!.id;
      }
      const { rows: cur } = await client.query<Row>(
        `SELECT * FROM hsdg.audit_scope_unit WHERE id = $1 AND scope_id = $2`,
        [id, scopeId],
      );
      const c = cur[0];
      if (!c) throw new NotFoundException('Scope unit not found.');
      if (unitId && input.version !== undefined && input.version !== c.version) {
        throw new ConflictException('This unit changed; refresh and retry.');
      }
      const v = <T>(
        k: keyof ScopeUnitInput,
        col: string,
        map: (x: unknown) => T = (x) => x as T,
      ): T => (input[k] !== undefined ? (map(input[k]) as T) : (c[col] as T));
      const txt = (x: unknown) => clean(x as string | null);
      const next = {
        name: v('name', 'name', txt) ?? (c.name as string),
        unitType: v('unitType', 'unit_type'),
        location: v('location', 'location', txt),
        finMetric: v('finMetric', 'fin_metric', txt),
        finAmount: v('finAmount', 'fin_amount'),
        finSource: v('finSource', 'fin_source', txt),
        finNotAvailable: v('finNotAvailable', 'fin_not_available'),
        employees: v<number | null>('employees', 'employees', (x) =>
          x === null ? null : Number(x),
        ),
        transactionVolume: v<number | null>('transactionVolume', 'transaction_volume', (x) =>
          x === null ? null : Number(x),
        ),
        volumeNote: v('volumeNote', 'volume_note', txt),
        relevance: v('relevance', 'relevance', (x) => cleanList(x as string[])),
        relevanceOther: v('relevanceOther', 'relevance_other', txt),
        qualitativeNote: v('qualitativeNote', 'qualitative_note', txt),
        signalIds: v('signalIds', 'signal_ids', (x) => cleanList(x as string[])),
        focusIds: v('focusIds', 'focus_ids', (x) => cleanList(x as string[])),
        specificMateriality: v('specificMateriality', 'specific_materiality'),
        auditor: v('auditor', 'auditor'),
        auditorStrategy: v('auditorStrategy', 'auditor_strategy'),
        scopeConclusion: v('scopeConclusion', 'scope_conclusion'),
        rationale: v('rationale', 'rationale', txt),
      };
      if (next.finAmount !== null && !next.finSource) {
        throw new BadRequestException('A unit-level financial indicator needs its source.');
      }
      await client.query(
        `UPDATE hsdg.audit_scope_unit SET name = $2, unit_type = $3, location = $4, fin_metric = $5,
           fin_amount = $6, fin_source = $7, fin_not_available = $8, relevance = $9,
           relevance_other = $10, qualitative_note = $11, signal_ids = $12, focus_ids = $13,
           specific_materiality = $14, auditor = $15,
           auditor_strategy = CASE WHEN $15 = 'dhvaj' THEN NULL ELSE $16 END,
           scope_conclusion = $17, rationale = $18, employees = $19, transaction_volume = $20,
           volume_note = $21, version = version + 1
         WHERE id = $1`,
        [
          id,
          next.name,
          next.unitType,
          next.location,
          next.finMetric,
          next.finAmount,
          next.finSource,
          next.finNotAvailable,
          next.relevance,
          next.relevanceOther,
          next.qualitativeNote,
          next.signalIds,
          next.focusIds,
          next.specificMateriality,
          next.auditor,
          next.auditorStrategy,
          next.scopeConclusion,
          next.rationale,
          next.employees,
          next.transactionVolume,
          next.volumeNote,
        ],
      );
      // §7: significance not yet available → information requirement / dependency.
      if (next.finNotAvailable && !c.fin_not_available) {
        await client.query(
          `INSERT INTO hsdg.audit_scope_dependency
             (scope_id, engagement_id, seq, description, affected, unit_id, owner_party, needed_by, impact)
           SELECT $1, $2, COALESCE(MAX(seq),0)+1, $3, $4, $5, 'client', 'planning', 'information'
             FROM hsdg.audit_scope_dependency WHERE scope_id = $1`,
          [
            scopeId,
            engagementId,
            `Financial significance not yet available — ${next.name}`,
            next.name,
            id,
          ],
        );
      }
      await this.touched(client, ctx, wi, scopeId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_unit_saved',
        objectType: 'audit_scope_unit',
        objectId: id,
        before: unitId ? { scopeConclusion: c.scope_conclusion, auditor: c.auditor } : null,
        after: {
          scopeConclusion: next.scopeConclusion,
          auditor: next.auditor,
          rationale: next.rationale,
        },
      });
      return this.buildSummary(client, wi);
    });
  }

  // ── Keyed decisions (controls / timing / evidence / technology) ──────────

  async saveDecision(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    kind: string,
    itemKey: string | null,
    input: SaveScopeDecisionInput,
  ): Promise<ScopeApproachSummary> {
    if (!SCOPE_METHODOLOGY_KINDS.includes(kind as ScopeDecisionKind)) {
      throw new BadRequestException('Unknown decision kind.');
    }
    const k = kind as ScopeDecisionKind;
    return this.db.withRlsContext(ctx, async (client) => {
      const scopeId = await this.editable(client, ctx, engagementId, wi);
      const { defs, retired } = await readScopeDecisionDefs(client);
      let key = itemKey;
      let label: string | null = null;
      if (!key) {
        const custom = CUSTOM_DECISION_OPTIONS[k];
        label = clean(input.label);
        if (!custom || !label)
          throw new BadRequestException(
            'A custom item needs a label (not available for evidence channels).',
          );
        const { rows } = await client.query<{ n: string }>(
          `SELECT count(*) AS n FROM hsdg.audit_scope_decision WHERE scope_id = $1 AND kind = $2 AND is_custom`,
          [scopeId, k],
        );
        key = `custom_${Number(rows[0]!.n) + 1}`;
      }
      const { rows: existing } = await client.query<Row>(
        `SELECT * FROM hsdg.audit_scope_decision WHERE scope_id = $1 AND kind = $2 AND item_key = $3`,
        [scopeId, k, key],
      );
      const e = existing[0];
      // A retired library item stays answerable only where a decision was already saved on it.
      const std =
        defs[k].find((d) => d.key === key) ??
        (e && !e.is_custom ? retired.get(`${k}:${key}`) : undefined);
      if (!std && !(e?.is_custom === true) && itemKey) {
        throw new NotFoundException('Decision item not found.');
      }
      if ((e ? Number(e.version) : 0) !== input.version) {
        throw new ConflictException('This decision changed; refresh and retry.');
      }
      const options = std?.options ?? CUSTOM_DECISION_OPTIONS[k] ?? [];
      const status =
        input.status !== undefined ? input.status : ((e?.status as string | null) ?? null);
      if (status !== null && !options.includes(status)) {
        throw new BadRequestException(`"${status}" is not a valid status for this item.`);
      }
      const rollForward =
        input.rollForward !== undefined ? input.rollForward : (e?.roll_forward ?? null);
      const note =
        input.note !== undefined ? clean(input.note) : ((e?.note as string | null) ?? null);
      await client.query(
        `INSERT INTO hsdg.audit_scope_decision
           (scope_id, engagement_id, kind, item_key, label, is_custom, status, roll_forward, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (scope_id, kind, item_key) DO UPDATE
           SET status = EXCLUDED.status, roll_forward = EXCLUDED.roll_forward, note = EXCLUDED.note,
               version = hsdg.audit_scope_decision.version + 1`,
        [scopeId, engagementId, k, key, label, !itemKey, status, rollForward, note],
      );
      await this.touched(client, ctx, wi, scopeId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_decision_saved',
        objectType: 'audit_scope_approach',
        objectId: scopeId,
        before: e ? { kind: k, item: key, status: e.status } : null,
        after: { kind: k, item: key, status, rollForward },
      });
      return this.buildSummary(client, wi);
    });
  }

  // ── Service organisation cards (SO-01) ───────────────────────────────────

  async saveServiceOrg(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    orgId: string | null,
    input: ServiceOrgInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      assertTeamFields(
        await resolvePlanningActor(client, engagementId),
        input,
        SCOPE_TEAM_SERVICE_ORG_FIELDS,
      );
      const scopeId = await this.editable(client, ctx, engagementId, wi);
      let id = orgId;
      if (!id) {
        const provider = clean(input.provider);
        if (!provider)
          throw new BadRequestException('A service organisation card needs the provider.');
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_scope_service_org (scope_id, engagement_id, seq, provider)
           VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_scope_service_org WHERE scope_id = $1), $3)
           RETURNING id`,
          [scopeId, engagementId, provider],
        );
        id = rows[0]!.id;
      }
      const { rows: cur } = await client.query<Row>(
        `SELECT * FROM hsdg.audit_scope_service_org WHERE id = $1 AND scope_id = $2`,
        [id, scopeId],
      );
      const c = cur[0];
      if (!c) throw new NotFoundException('Service organisation card not found.');
      if (orgId && input.version !== undefined && input.version !== c.version) {
        throw new ConflictException('This card changed; refresh and retry.');
      }
      const pick = (k: keyof ServiceOrgInput, col: string) =>
        input[k] !== undefined ? input[k] : c[col];
      const t = (k: keyof ServiceOrgInput, col: string) =>
        input[k] !== undefined ? clean(input[k] as string | null) : (c[col] as string | null);
      await client.query(
        `UPDATE hsdg.audit_scope_service_org SET provider = $2, process = $3, affected_areas = $4,
           assurance_report = $5, report_detail = $6, cuec = $7, so01 = $8, note = $9, version = version + 1
         WHERE id = $1`,
        [
          id,
          t('provider', 'provider') ?? c.provider,
          t('process', 'process'),
          input.affectedAreas ? cleanList(input.affectedAreas) : c.affected_areas,
          pick('assuranceReport', 'assurance_report'),
          t('reportDetail', 'report_detail'),
          pick('cuec', 'cuec'),
          pick('so01', 'so01'),
          t('note', 'note'),
        ],
      );
      await this.touched(client, ctx, wi, scopeId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_service_org_saved',
        objectType: 'audit_scope_service_org',
        objectId: id,
        before: orgId ? { so01: c.so01 } : null,
        after: { so01: pick('so01', 'so01') },
      });
      return this.buildSummary(client, wi);
    });
  }

  // ── §17 specialists / §20 implications ───────────────────────────────────

  async saveConsideration(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    considerationId: string,
    input: SaveScopeConsiderationInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const scopeId = await this.editable(client, ctx, engagementId, wi);
      const { rows } = await client.query<Row>(
        `SELECT * FROM hsdg.audit_scope_consideration WHERE id = $1 AND scope_id = $2`,
        [considerationId, scopeId],
      );
      const c = rows[0];
      if (!c) throw new NotFoundException('Consideration not found.');
      if (input.version !== c.version)
        throw new ConflictException('This consideration changed; refresh and retry.');
      const kind = c.kind as 'implication' | 'specialist';
      const allowed: readonly string[] =
        kind === 'specialist' ? SPECIALIST_DECISIONS : IMPLICATION_RESPONSES;
      if (input.response !== null && !allowed.includes(input.response)) {
        throw new BadRequestException(`"${input.response}" is not a valid response.`);
      }
      const note = input.note !== undefined ? clean(input.note) : (c.note as string | null);
      if (
        kind === 'implication' &&
        (input.response === 'rejected' || input.response === 'modified') &&
        !note
      ) {
        throw new BadRequestException(
          'Rejecting or modifying a suggested implication needs a rationale.',
        );
      }
      if (
        kind === 'specialist' &&
        input.response === 'not_required' &&
        c.attention !== 'standard' &&
        !note
      ) {
        throw new BadRequestException(
          'The underlying signal is Enhanced / Immediate Partner Attention — "Not Required" needs a rationale.',
        );
      }
      let matterId = c.planning_matter_id as string | null;
      if (kind === 'specialist' && input.response === 'evaluate_further' && !matterId) {
        matterId = await this.insertMatter(client, engagementId, wi, {
          title: `Evaluate specialist need — ${String(c.observation).slice(0, 160)}`,
          category: 'specialist',
          signalId: c.signal_id as string | null,
          ownerEmployeeId: ctx.employeeId ?? null,
          partnerAttention: c.attention === 'immediate_partner',
        });
      }
      await client.query(
        `UPDATE hsdg.audit_scope_consideration SET response = $2, note = $3, planning_matter_id = $4,
           version = version + 1 WHERE id = $1`,
        [considerationId, input.response, note, matterId],
      );
      await this.touched(client, ctx, wi, scopeId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_consideration_saved',
        objectType: 'audit_scope_consideration',
        objectId: considerationId,
        before: { response: c.response },
        after: { response: input.response, note },
      });
      return this.buildSummary(client, wi);
    });
  }

  async addSpecialist(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: NewSpecialistInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const scopeId = await this.editable(client, ctx, engagementId, wi);
      const observation = clean(input.observation);
      if (!observation) throw new BadRequestException('Describe the specialist need.');
      let attention: PlanningAttention = 'standard';
      if (input.signalId) {
        await assertSignalsInShell(client, wi, [input.signalId]);
        const { rows } = await client.query<{ attention: PlanningAttention }>(
          `SELECT attention FROM hsdg.audit_planning_signal WHERE id = $1`,
          [input.signalId],
        );
        attention = rows[0]!.attention;
      }
      const { rows: cnt } = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM hsdg.audit_scope_consideration WHERE scope_id = $1 AND NOT is_auto`,
        [scopeId],
      );
      await client.query(
        `INSERT INTO hsdg.audit_scope_consideration
           (scope_id, engagement_id, kind, consideration_key, is_auto, signal_id, source_label,
            observation, attention)
         VALUES ($1, $2, 'specialist', $3, false, $4, $5, $6, $7)`,
        [
          scopeId,
          engagementId,
          `manual:${Number(cnt[0]!.n) + 1}`,
          input.signalId ?? null,
          `Manager — ${SPECIALIST_AREA_LABEL[input.area]}`,
          observation,
          attention,
        ],
      );
      await this.touched(client, ctx, wi, scopeId);
      return this.buildSummary(client, wi);
    });
  }

  // ── §21 Scope Dependency Register ───────────────────────────────────────

  async saveDependency(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    depId: string | null,
    input: ScopeDependencyInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const scopeId = await this.editable(client, ctx, engagementId, wi);
      let id = depId;
      if (!id) {
        const description = clean(input.description);
        if (!description || !input.impact) {
          throw new BadRequestException(
            'A dependency needs a description and its impact if unresolved.',
          );
        }
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_scope_dependency (scope_id, engagement_id, seq, description, impact)
           VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_scope_dependency WHERE scope_id = $1), $3, $4)
           RETURNING id`,
          [scopeId, engagementId, description, input.impact],
        );
        id = rows[0]!.id;
      }
      const { rows: cur } = await client.query<Row>(
        `SELECT * FROM hsdg.audit_scope_dependency WHERE id = $1 AND scope_id = $2`,
        [id, scopeId],
      );
      const c = cur[0];
      if (!c) throw new NotFoundException('Dependency not found.');
      if (depId && input.version !== undefined && input.version !== c.version) {
        throw new ConflictException('This dependency changed; refresh and retry.');
      }
      if (input.unitId) {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.audit_scope_unit WHERE id = $1 AND scope_id = $2`,
          [input.unitId, scopeId],
        );
        if (!rows.length)
          throw new BadRequestException('The linked unit must be in this Audit Population.');
      }
      const pick = (k: keyof ScopeDependencyInput, col: string) =>
        input[k] !== undefined ? input[k] : c[col];
      const t = (k: keyof ScopeDependencyInput, col: string) =>
        input[k] !== undefined ? clean(input[k] as string | null) : (c[col] as string | null);
      const status = pick('status', 'status') as string;
      const resolution = t('resolution', 'resolution');
      if (status === 'resolved' && !resolution)
        throw new BadRequestException('Resolving a dependency needs a resolution note.');
      await client.query(
        `UPDATE hsdg.audit_scope_dependency SET description = $2, affected = $3, unit_id = $4,
           owner_employee_id = $5, owner_party = $6, needed_by = $7, impact = $8, status = $9,
           resolution = $10, version = version + 1 WHERE id = $1`,
        [
          id,
          t('description', 'description') ?? c.description,
          t('affected', 'affected'),
          pick('unitId', 'unit_id'),
          pick('ownerEmployeeId', 'owner_employee_id'),
          pick('ownerParty', 'owner_party'),
          pick('neededBy', 'needed_by'),
          pick('impact', 'impact'),
          status,
          resolution,
        ],
      );
      await this.touched(client, ctx, wi, scopeId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_dependency_saved',
        objectType: 'audit_scope_dependency',
        objectId: id,
        before: depId ? { status: c.status, impact: c.impact } : null,
        after: { status, impact: pick('impact', 'impact') },
      });
      return this.buildSummary(client, wi);
    });
  }

  // ── §22 SL-01 potential scope limitations ───────────────────────────────

  async saveLimitation(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    limId: string | null,
    input: ScopeLimitationInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const scopeId = await this.editable(client, ctx, engagementId, wi);
      let id = limId;
      if (!id) {
        const matter = clean(input.matter);
        if (!matter)
          throw new BadRequestException('Describe the potential limitation (facts only).');
        // Always Immediate Partner Attention + an open Planning Matter (§22).
        const matterId = await this.insertMatter(client, engagementId, wi, {
          title: `Potential scope limitation — ${matter.slice(0, 180)}`,
          category: 'scope',
          signalId: null,
          ownerEmployeeId: input.ownerEmployeeId ?? ctx.employeeId ?? null,
          partnerAttention: true,
        });
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_scope_limitation (scope_id, engagement_id, seq, matter, planning_matter_id)
           VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_scope_limitation WHERE scope_id = $1), $3, $4)
           RETURNING id`,
          [scopeId, engagementId, matter, matterId],
        );
        id = rows[0]!.id;
        await client.query(
          `UPDATE hsdg.audit_scope_approach SET sl01 = COALESCE(NULLIF(sl01, 'no'), 'yes') WHERE id = $1`,
          [scopeId],
        );
      }
      const { rows: cur } = await client.query<Row>(
        `SELECT * FROM hsdg.audit_scope_limitation WHERE id = $1 AND scope_id = $2`,
        [id, scopeId],
      );
      const c = cur[0];
      if (!c) throw new NotFoundException('Limitation not found.');
      if (limId && input.version !== undefined && input.version !== c.version) {
        throw new ConflictException('This limitation changed; refresh and retry.');
      }
      const t = (k: keyof ScopeLimitationInput, col: string) =>
        input[k] !== undefined ? clean(input[k] as string | null) : (c[col] as string | null);
      const status = input.status ?? (c.status as 'open' | 'resolved');
      const resolution = t('resolution', 'resolution');
      if (status === 'resolved' && !resolution)
        throw new BadRequestException('Resolving a limitation needs a resolution note.');
      const owner =
        input.ownerEmployeeId !== undefined ? input.ownerEmployeeId : c.owner_employee_id;
      await client.query(
        `UPDATE hsdg.audit_scope_limitation SET matter = $2, affected = $3, management_position = $4,
           alternative_evidence = $5, owner_employee_id = $6, status = $7, resolution = $8,
           version = version + 1 WHERE id = $1`,
        [
          id,
          t('matter', 'matter') ?? c.matter,
          t('affected', 'affected'),
          t('managementPosition', 'management_position'),
          t('alternativeEvidence', 'alternative_evidence'),
          owner,
          status,
          resolution,
        ],
      );
      if (c.planning_matter_id) {
        await client.query(
          `UPDATE hsdg.audit_planning_matter SET owner_employee_id = COALESCE($2, owner_employee_id),
             status = $3, resolution = $4, version = version + 1 WHERE id = $1`,
          [
            c.planning_matter_id,
            owner,
            status === 'resolved' ? 'resolved' : 'open',
            status === 'resolved' ? resolution : null,
          ],
        );
      }
      await this.touched(client, ctx, wi, scopeId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_limitation_saved',
        objectType: 'audit_scope_limitation',
        objectId: id,
        before: limId ? { status: c.status } : null,
        after: { status, matter: t('matter', 'matter') ?? c.matter },
      });
      return this.buildSummary(client, wi);
    });
  }

  // ── §23 Preliminary Audit Approach Map ─────────────────────────────────

  async saveMapItem(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    itemId: string | null,
    input: ScopeMapItemInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      assertTeamFields(
        await resolvePlanningActor(client, engagementId),
        input,
        SCOPE_TEAM_MAP_FIELDS,
      );
      const scopeId = await this.editable(client, ctx, engagementId, wi);
      await assertSignalsInShell(client, wi, input.signalIds ?? []);
      await this.assertFocusInShell(client, wi, input.focusIds ?? []);
      let id = itemId;
      if (!id) {
        const name = clean(input.name);
        if (!name) throw new BadRequestException('A preliminary area needs a name.');
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_scope_map_item (scope_id, engagement_id, seq, name, source_label)
           VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_scope_map_item WHERE scope_id = $1), $3, 'Manager')
           RETURNING id`,
          [scopeId, engagementId, name],
        );
        id = rows[0]!.id;
      }
      const { rows: cur } = await client.query<Row>(
        `SELECT * FROM hsdg.audit_scope_map_item WHERE id = $1 AND scope_id = $2`,
        [id, scopeId],
      );
      const c = cur[0];
      if (!c) throw new NotFoundException('Map item not found.');
      if (itemId && input.version !== undefined && input.version !== c.version) {
        throw new ConflictException('This map item changed; refresh and retry.');
      }
      const pick = (k: keyof ScopeMapItemInput, col: string) =>
        input[k] !== undefined ? input[k] : c[col];
      const t = (k: keyof ScopeMapItemInput, col: string) =>
        input[k] !== undefined ? clean(input[k] as string | null) : (c[col] as string | null);
      const included = pick('included', 'included') as boolean;
      const exclusionReason = t('exclusionReason', 'exclusion_reason');
      if (!included && !exclusionReason) {
        throw new BadRequestException(
          'Removing a preliminary area needs a reason — nothing is excluded mechanically.',
        );
      }
      const note = t('note', 'note');
      if (input.reassessed && !note) {
        throw new BadRequestException(
          'Record what was reconsidered before clearing Reassessment Required.',
        );
      }
      if (input.manualAmount !== undefined && c.metric_key) {
        throw new BadRequestException(
          'This area reads its amount live from 03.2 — correct the figure there.',
        );
      }
      await client.query(
        `UPDATE hsdg.audit_scope_map_item SET name = $2, manual_amount = $3, materiality_note = $4,
           signal_ids = $5, focus_ids = $6, controls_strategy = $7, timing = $8,
           evidence_channels = $9, special_considerations = $10, note = $11, included = $12,
           exclusion_reason = CASE WHEN $12 THEN NULL ELSE $13 END,
           reassessment_required = CASE WHEN $14 THEN false ELSE reassessment_required END,
           reassessment_reason = CASE WHEN $14 THEN NULL ELSE reassessment_reason END,
           version = version + 1 WHERE id = $1`,
        [
          id,
          t('name', 'name') ?? c.name,
          pick('manualAmount', 'manual_amount'),
          t('materialityNote', 'materiality_note'),
          input.signalIds ? cleanList(input.signalIds) : c.signal_ids,
          input.focusIds ? cleanList(input.focusIds) : c.focus_ids,
          pick('controlsStrategy', 'controls_strategy'),
          pick('timing', 'timing'),
          input.evidenceChannels ? cleanList(input.evidenceChannels) : c.evidence_channels,
          input.specialConsiderations
            ? cleanList(input.specialConsiderations)
            : c.special_considerations,
          note,
          included,
          exclusionReason,
          input.reassessed === true,
        ],
      );
      await this.touched(client, ctx, wi, scopeId);
      if (!itemId || input.name !== undefined || input.included !== undefined) {
        await linkScopeMap(client, wi);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_map_item_saved',
        objectType: 'audit_scope_map_item',
        objectId: id,
        before: itemId
          ? { controls: c.controls_strategy, timing: c.timing, included: c.included }
          : null,
        after: {
          controls: pick('controlsStrategy', 'controls_strategy'),
          timing: pick('timing', 'timing'),
          included,
          reassessed: input.reassessed === true,
        },
      });
      return this.buildSummary(client, wi);
    });
  }

  // ── §26 Partner Planning View ───────────────────────────────────────────

  async partnerAction(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: PartnerScopeActionInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      const { id: scopeId } = await this.ensure(client, ctx, engagementId, wi);
      const note = clean(input.note);
      if (input.action !== 'agree' && !note)
        throw new BadRequestException('Describe the challenge / request / signal.');
      let signalId: string | null = null;
      if (input.action === 'add_signal') {
        signalId = await insertSignal(client, engagementId, wi, {
          source: 'partner',
          observation: note!,
          whyMayMatter: 'Raised by the Engagement Partner in the 03.4 Partner Planning View.',
          attention: 'immediate_partner',
        });
        await client.query(
          `UPDATE hsdg.audit_planning_signal SET destinations = '{03.4}' WHERE id = $1`,
          [signalId],
        );
      }
      const rec = (await this.readRecord(client, wi))!;
      const agree = input.action === 'agree';
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_scope_partner_action
           (scope_id, engagement_id, action, note, signal_id, status, response,
            created_by_employee_id, scope_version_no)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          scopeId,
          engagementId,
          input.action,
          note,
          signalId,
          agree ? 'addressed' : 'open',
          agree ? 'Agreed' : null,
          ctx.employeeId ?? null,
          rec.versionNo,
        ],
      );
      if (signalId) await this.sync(client, engagementId, wi, scopeId);
      // §26 — the Manager answers a challenge / request; an Agree is for the record only.
      if (!agree) {
        const actor = await resolvePlanningActor(client, engagementId);
        await notifyPlanning(client, [actor.managerId ?? actor.partnerId], {
          type: NOTIFICATION_TYPE.planningScopePartnerAction,
          title: `Engagement Partner — ${PARTNER_ACTION_LABEL[input.action]} on 03.4 Scope & Approach ${rec.versionLabel}`,
          body: note ?? '',
          engagementId,
          objectType: 'audit_scope_partner_action',
          objectId: rows[0]!.id,
          dedup: `scope_partner_action:${rows[0]!.id}`,
          except: ctx.employeeId ?? null,
        });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_partner_action',
        objectType: 'audit_scope_partner_action',
        objectId: rows[0]!.id,
        after: { action: input.action, note },
      });
      return this.buildSummary(client, wi);
    });
  }

  async respondPartnerAction(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    actionId: string,
    input: RespondPartnerActionInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      const response = clean(input.response);
      if (!response) throw new BadRequestException('A response is required.');
      const { rows: done } = await client.query<{
        created_by_employee_id: string | null;
        action: ScopePartnerAction['action'];
      }>(
        `UPDATE hsdg.audit_scope_partner_action a
            SET status = 'addressed', response = $3, responded_by_employee_id = $5,
                responded_at = now(), version = a.version + 1
           FROM hsdg.audit_scope_approach r
          WHERE a.id = $1 AND a.scope_id = r.id AND r.workflow_instance_id = $2 AND a.version = $4
            AND a.status = 'open'
          RETURNING a.created_by_employee_id, a.action`,
        [actionId, wi, response, input.version, ctx.employeeId ?? null],
      );
      if (!done[0]) {
        throw new ConflictException('Partner action not found or changed; refresh and retry.');
      }
      await notifyPlanning(client, [done[0].created_by_employee_id], {
        type: NOTIFICATION_TYPE.planningScopePartnerAction,
        title: `Engagement Manager answered your 03.4 ${PARTNER_ACTION_LABEL[done[0].action]}`,
        body: response,
        engagementId,
        objectType: 'audit_scope_partner_action',
        objectId: actionId,
        dedup: `scope_partner_response:${actionId}`,
        except: ctx.employeeId ?? null,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_partner_action_addressed',
        objectType: 'audit_scope_partner_action',
        objectId: actionId,
        after: { response },
      });
      return this.buildSummary(client, wi);
    });
  }

  // ── §27 revision / reassessment ─────────────────────────────────────────

  async startRevision(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: StartScopeRevisionInput,
  ): Promise<ScopeApproachSummary> {
    const reason = clean(input.reason);
    if (!reason) throw new BadRequestException('A revision needs a reason.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      // A double-submit must not snapshot the same baseline into two revisions.
      await this.lockRecord(client, wi);
      const summary = await this.buildSummary(client, wi, false);
      const r = summary.record;
      if (!r.id || r.status === 'draft') {
        throw new ConflictException(
          'Only a completed (or reassessment-required) strategy is revised; edit the draft instead.',
        );
      }
      const baseline = {
        record: r,
        units: summary.units,
        decisions: summary.decisions.filter((d) => d.status !== null),
        serviceOrgs: summary.serviceOrgs,
        considerations: summary.considerations,
        dependencies: summary.dependencies,
        limitations: summary.limitations,
        mapItems: summary.mapItems,
      };
      const nextNo = r.versionNo + 1;
      const affected = cleanList(input.affectedModules);
      await client.query(
        `INSERT INTO hsdg.audit_scope_revision
           (scope_id, engagement_id, from_version_no, to_version_no, trigger, reason,
            affected_modules, baseline, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        [
          r.id,
          engagementId,
          r.versionNo,
          nextNo,
          input.trigger,
          reason,
          affected,
          JSON.stringify(baseline),
          ctx.employeeId ?? null,
        ],
      );
      await client.query(
        `UPDATE hsdg.audit_scope_approach SET version_no = $2, status = 'draft', revision_trigger = $3,
           revision_reason = $4, ap02 = NULL, completed_by_employee_id = NULL, completed_at = NULL,
           version = version + 1 WHERE id = $1`,
        [r.id, nextNo, input.trigger, reason],
      );
      await this.rollUp(client, ctx, wi, 'in_progress');
      // §27 — the modules the revision affects need attention on the Phase 03 checklist.
      const flagged = await flagPlanningItems(
        client,
        wi,
        itemsForModules(affected.filter((m) => m !== '03.4')),
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_revision_started',
        objectType: 'audit_scope_approach',
        objectId: r.id,
        before: { version: r.versionLabel, status: r.status },
        after: {
          version: scopeVersionLabel(nextNo),
          trigger: input.trigger,
          reason,
          affectedModules: affected,
          flaggedItems: flagged,
        },
      });
      return this.buildSummary(client, wi);
    });
  }

  async flagReassessment(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: FlagScopeReassessmentInput,
  ): Promise<ScopeApproachSummary> {
    const reason = clean(input.reason);
    if (!reason) throw new BadRequestException('A reassessment needs a reason.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      const done = await flagScopeReassessment(client, wi, input.source, reason, {
        cycleKey: input.cycleKey ?? null,
      });
      if (!done) throw new ConflictException('03.4 has not been started on this audit file.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_reassessment_flagged',
        objectType: 'audit_scope_approach',
        objectId: wi,
        after: { source: input.source, reason, cycleKey: input.cycleKey ?? null },
      });
      return this.buildSummary(client, wi);
    });
  }

  // ── §23 Approach Map → 03.5 ─────────────────────────────────────────────

  /** Link a map area to an existing 03.5 area by hand (null unlinks; automatic matching then leaves it alone). */
  async linkMapArea(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    itemId: string,
    input: LinkScopeMapAreaInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const item = await this.mapItemForLink(client, ctx, engagementId, wi, itemId, input.version);
      let areaName: string | null = null;
      if (input.areaId) {
        const { rows } = await client.query<{
          area_name: string;
          scope_map_item_id: string | null;
        }>(
          `SELECT a.area_name, a.scope_map_item_id FROM hsdg.audit_engagement_area a
             JOIN hsdg.audit_area_review r ON r.id = a.review_id
            WHERE a.id = $1 AND r.workflow_instance_id = $2`,
          [input.areaId, wi],
        );
        const area = rows[0];
        if (!area) throw new BadRequestException('The 03.5 area must belong to this audit file.');
        if (area.scope_map_item_id && area.scope_map_item_id !== itemId) {
          throw new ConflictException(
            `${area.area_name} already carries another Approach Map area — unlink it there first.`,
          );
        }
        areaName = area.area_name;
      }
      await client.query(
        `UPDATE hsdg.audit_engagement_area SET scope_map_item_id = NULL
          WHERE scope_map_item_id = $1 AND id IS DISTINCT FROM $2::uuid`,
        [itemId, input.areaId],
      );
      if (input.areaId) {
        await client.query(
          `UPDATE hsdg.audit_engagement_area SET scope_map_item_id = $2 WHERE id = $1`,
          [input.areaId, itemId],
        );
      }
      await client.query(
        `UPDATE hsdg.audit_scope_map_item SET area_link_manual = true, version = version + 1 WHERE id = $1`,
        [itemId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_map_area_linked',
        objectType: 'audit_scope_map_item',
        objectId: itemId,
        before: { area: item.linkedAreaId },
        after: { area: input.areaId, areaName },
      });
      return this.buildSummary(client, wi);
    });
  }

  /** Create a 03.5 custom area from a map area nothing in the library matches. */
  async convertMapArea(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    itemId: string,
    input: ConvertScopeMapAreaInput,
  ): Promise<ScopeApproachSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const item = await this.mapItemForLink(client, ctx, engagementId, wi, itemId, input.version);
      if (!item.included) {
        throw new BadRequestException('Only an included map area is carried into 03.5.');
      }
      if (item.linkedAreaId) {
        throw new ConflictException(`${item.code} is already carried by a 03.5 area.`);
      }
      const areaId = await this.areaReview.addFromScopeMap(client, ctx, engagementId, wi, {
        id: item.id,
        code: item.code,
        name: item.name,
        signalIds: item.signalIds,
      });
      await client.query(
        `UPDATE hsdg.audit_scope_map_item SET area_link_manual = true, version = version + 1 WHERE id = $1`,
        [itemId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.scope_map_area_converted',
        objectType: 'audit_scope_map_item',
        objectId: itemId,
        after: { area: areaId, name: item.name },
      });
      return this.buildSummary(client, wi);
    });
  }

  // ── §6 / §17 / §19 hand-off to 03.8 / 03.9 / 03.11 ───────────────────────

  async getHandoff(ctx: RlsContext, engagementId: string, wi: string): Promise<ScopeHandoff> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      if (!(await this.readRecord(client, wi))) return emptyHandoff();
      return buildHandoff((await this.workspace(client, wi)).state);
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private assertDraft(r: ScopeApproachRecord): void {
    if (r.status === 'complete') {
      throw new ConflictException(
        `03.4 ${r.versionLabel} is complete. Start a revision to change it — the approved strategy is never overwritten.`,
      );
    }
    if (r.status === 'reassessment_required') {
      throw new ConflictException(
        '03.4 is flagged Reassessment Required — start a revision to record the changed decision.',
      );
    }
  }

  /** The record id, creating v1.0 (and generating from sources) on first use. */
  private async ensure(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    wi: string,
  ): Promise<{ id: string; created: boolean }> {
    // Row lock serialises every mutation of this strategy, so the read-then-compare
    // version checks in the callers cannot interleave (no lost updates).
    const existing = await this.lockRecord(client, wi);
    if (existing) return { id: existing, created: false };
    const { rows: ins } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_scope_approach (workflow_instance_id, engagement_id, methodology_version)
       VALUES ($1, $2, $3) ON CONFLICT (workflow_instance_id) DO NOTHING RETURNING id`,
      [wi, engagementId, SCOPE_METHODOLOGY_VERSION],
    );
    if (!ins[0]) return { id: (await this.lockRecord(client, wi))!, created: false };
    const id = ins[0].id;
    await this.sync(client, engagementId, wi, id);
    await this.rollUp(client, ctx, wi, 'in_progress');
    return { id, created: true };
  }

  private async lockRecord(client: PoolClient, wi: string): Promise<string | null> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.audit_scope_approach WHERE workflow_instance_id = $1 FOR UPDATE`,
      [wi],
    );
    if (rows[0]) return rows[0].id;
    // RLS applies the UPDATE policy to FOR UPDATE, hiding the row from non-leads;
    // they still get a plain read (their writes are refused by RLS as before).
    const { rows: seen } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.audit_scope_approach WHERE workflow_instance_id = $1`,
      [wi],
    );
    return seen[0]?.id ?? null;
  }

  /**
   * A map item for a 03.5 link / convert. Carrying the map into 03.5 is allowed
   * on a completed strategy too — it changes 03.5, never the approved 03.4 decisions.
   */
  private async mapItemForLink(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    itemId: string,
    version: number,
  ): Promise<{
    id: string;
    code: string;
    name: string;
    included: boolean;
    signalIds: string[];
    linkedAreaId: string | null;
  }> {
    await assertShell(client, engagementId, wi);
    const { id: scopeId } = await this.ensure(client, ctx, engagementId, wi);
    const { rows } = await client.query<Row>(
      `SELECT m.id, m.seq, m.name, m.included, m.signal_ids, m.version,
              (SELECT a.id FROM hsdg.audit_engagement_area a WHERE a.scope_map_item_id = m.id) AS area_id
         FROM hsdg.audit_scope_map_item m WHERE m.id = $1 AND m.scope_id = $2`,
      [itemId, scopeId],
    );
    const m = rows[0];
    if (!m) throw new NotFoundException('Map item not found.');
    if (Number(m.version) !== version) {
      throw new ConflictException('This map item changed; refresh and retry.');
    }
    return {
      id: String(m.id),
      code: displayCode('AM', Number(m.seq))!,
      name: String(m.name),
      included: m.included === true,
      signalIds: arr(m.signal_ids),
      linkedAreaId: s(m.area_id),
    };
  }

  /** ensure + draft check for child mutations. */
  private async editable(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    wi: string,
  ): Promise<string> {
    await assertShell(client, engagementId, wi);
    const { id } = await this.ensure(client, ctx, engagementId, wi);
    this.assertDraft((await this.readRecord(client, wi))!);
    return id;
  }

  private async touched(
    client: PoolClient,
    ctx: RlsContext,
    wi: string,
    scopeId: string,
  ): Promise<void> {
    await client.query(`UPDATE hsdg.audit_scope_approach SET version = version + 1 WHERE id = $1`, [
      scopeId,
    ]);
    await this.rollUp(client, ctx, wi, 'in_progress');
  }

  private async rollUp(
    client: PoolClient,
    ctx: RlsContext,
    wi: string,
    state: 'in_progress' | 'complete',
  ): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_planning_items
          SET state = $3, updated_by_employee_id = $4, content_updated_at = now(), version = version + 1
        WHERE workflow_instance_id = $1 AND item_key = ANY($2::text[]) AND state <> $3`,
      [wi, SCOPE_ITEM_KEYS, state, ctx.employeeId ?? null],
    );
  }

  private async insertMatter(
    client: PoolClient,
    engagementId: string,
    wi: string,
    m: {
      title: string;
      category: string;
      signalId: string | null;
      ownerEmployeeId: string | null;
      partnerAttention: boolean;
    },
  ): Promise<string> {
    const seq = (await maxSeq(client, 'audit_planning_matter', wi)) + 1;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_planning_matter
         (workflow_instance_id, engagement_id, seq, origin, signal_id, title, category,
          owner_employee_id, partner_attention, affected_module)
       VALUES ($1, $2, $3, 'scope_approach', $4, $5, $6, $7, $8, '03.4') RETURNING id`,
      [
        wi,
        engagementId,
        seq,
        m.signalId,
        m.title,
        m.category,
        m.ownerEmployeeId,
        m.partnerAttention,
      ],
    );
    return rows[0]!.id;
  }

  private async assertFocusInShell(client: PoolClient, wi: string, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM hsdg.audit_area_of_focus WHERE workflow_instance_id = $1 AND id = ANY($2::uuid[])`,
      [wi, unique],
    );
    if (Number(rows[0]?.n ?? 0) !== unique.length) {
      throw new BadRequestException('Every linked Area of Focus must belong to this audit file.');
    }
  }

  /**
   * Idempotent generation from sources (§4, §6, §15, §17, §20, §23): inserts new
   * auto records keyed by source, refreshes source labels, and marks — never
   * deletes — auto records whose source disappeared. Manager judgments are kept.
   */
  private async sync(
    client: PoolClient,
    engagementId: string,
    wi: string,
    scopeId: string,
  ): Promise<void> {
    const { facts } = await this.readFacts(client, wi);
    // Population
    const units = generatePopulation(facts);
    for (const u of units) {
      await client.query(
        `INSERT INTO hsdg.audit_scope_unit
           (scope_id, engagement_id, seq, unit_key, is_auto, source_label, name, unit_type, auditor,
            relevance, fin_metric, fin_amount, fin_source, location)
         VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_scope_unit WHERE scope_id = $1),
                 $3, true, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (scope_id, unit_key) DO UPDATE
           SET source_label = EXCLUDED.source_label, no_longer_generated = false,
               location = COALESCE(hsdg.audit_scope_unit.location, EXCLUDED.location),
               fin_amount = CASE WHEN hsdg.audit_scope_unit.fin_source = '03.2 financial dataset'
                                 THEN EXCLUDED.fin_amount ELSE hsdg.audit_scope_unit.fin_amount END`,
        [
          scopeId,
          engagementId,
          u.unitKey,
          u.sourceLabel,
          u.name,
          u.unitType,
          u.auditor,
          u.relevance,
          u.finMetric,
          u.finAmount,
          u.finSource,
          u.location ?? null,
        ],
      );
    }
    await client.query(
      `UPDATE hsdg.audit_scope_unit SET no_longer_generated = true
        WHERE scope_id = $1 AND is_auto AND NOT (unit_key = ANY($2::text[])) AND NOT no_longer_generated`,
      [scopeId, units.map((u) => u.unitKey)],
    );
    const { rows: unitRows } = await client.query<{ unit_type: string; auditor: string }>(
      `SELECT unit_type, auditor FROM hsdg.audit_scope_unit WHERE scope_id = $1`,
      [scopeId],
    );
    const triggers = deriveTriggers(
      facts,
      unitRows.map((u) => ({
        unitType: u.unit_type as ScopeUnit['unitType'],
        auditor: u.auditor as ScopeUnit['auditor'],
      })),
    );
    // Service organisation card
    if (triggers.serviceOrganisation) {
      await client.query(
        `INSERT INTO hsdg.audit_scope_service_org (scope_id, engagement_id, seq, source_key, provider, process)
         VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_scope_service_org WHERE scope_id = $1),
                 'accounting', 'Outsourced accounting / processing service provider', $3)
         ON CONFLICT (scope_id, source_key) DO NOTHING`,
        [scopeId, engagementId, facts.serviceOrgContext],
      );
    }
    // Map areas
    for (const a of generateMapAreas(facts, triggers)) {
      await client.query(
        `INSERT INTO hsdg.audit_scope_map_item
           (scope_id, engagement_id, seq, area_key, is_auto, source_label, name, metric_key, special_considerations)
         VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_scope_map_item WHERE scope_id = $1),
                 $3, true, $4, $5, $6, $7)
         ON CONFLICT (scope_id, area_key) DO UPDATE SET source_label = EXCLUDED.source_label`,
        [scopeId, engagementId, a.areaKey, a.sourceLabel, a.name, a.metricKey, a.suggestedSpecial],
      );
    }
    // Implications + specialists
    const warehouses = unitRows.filter(
      (u) => u.unit_type === 'warehouse' || u.unit_type === 'plant',
    ).length;
    const gen = [
      ...generateImplications(facts, triggers, warehouses),
      ...generateSpecialists(facts),
    ];
    const keyOf = (g: (typeof gen)[number]) =>
      g.kind === 'specialist' ? `specialist:${g.key}` : g.key;
    for (const g of gen) {
      await client.query(
        `INSERT INTO hsdg.audit_scope_consideration
           (scope_id, engagement_id, kind, consideration_key, is_auto, signal_id, source_label,
            observation, suggestion, attention)
         VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, $9)
         ON CONFLICT (scope_id, consideration_key) DO UPDATE
           SET observation = EXCLUDED.observation, suggestion = EXCLUDED.suggestion,
               attention = EXCLUDED.attention, source_label = EXCLUDED.source_label,
               no_longer_triggered = false`,
        [
          scopeId,
          engagementId,
          g.kind,
          keyOf(g),
          g.signalId,
          g.sourceLabel,
          g.observation,
          g.suggestion,
          g.attention,
        ],
      );
    }
    await client.query(
      `UPDATE hsdg.audit_scope_consideration SET no_longer_triggered = true
        WHERE scope_id = $1 AND is_auto AND NOT (consideration_key = ANY($2::text[])) AND NOT no_longer_triggered`,
      [scopeId, gen.map(keyOf)],
    );
  }

  private async readRecord(client: PoolClient, wi: string): Promise<ScopeApproachRecord | null> {
    const { rows } = await client.query<Row>(
      `SELECT r.*, cb.full_name AS completed_by_name
         FROM hsdg.audit_scope_approach r
         LEFT JOIN hsdg.employees cb ON cb.id = r.completed_by_employee_id
        WHERE r.workflow_instance_id = $1`,
      [wi],
    );
    return rows[0] ? mapRecord(rows[0]) : null;
  }

  private async readFacts(
    client: PoolClient,
    wi: string,
  ): Promise<{
    facts: ScopeFacts;
    materiality: ScopeMaterialityRef | null;
    periodEnd: string | null;
    currency: string | null;
  }> {
    const one = async <T extends Row>(sql: string): Promise<T | undefined> =>
      (await client.query<T>(sql, [wi])).rows[0];
    const eng = await one<Row>(
      `SELECT en.legal_name FROM hsdg.service_workflow_instances w
         JOIN hsdg.engagements e ON e.id = w.engagement_id
         LEFT JOIN hsdg.entities en ON en.id = e.entity_id WHERE w.id = $1`,
    );
    const profile = await one<Row>(
      `SELECT initial_audit, joint_audit, accounting_environment, sa402_flag
         FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
    );
    const { rows: areas } = await client.query<{ area_key: string; conclusion: string }>(
      `SELECT area_key, conclusion FROM hsdg.audit_framework_assessments
        WHERE workflow_instance_id = $1 AND conclusion IS NOT NULL`,
      [wi],
    );
    const cons = await one<Row>(
      `SELECT facts, system_detail FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = '02.6'`,
    );
    const consFacts = (cons?.facts ?? {}) as {
      investees?: { name: string; auditedByOtherAuditor?: boolean }[];
      hasBranches?: boolean;
    };
    const perimeter = (
      (
        cons?.system_detail as {
          perimeter?: { name: string; relationship: string; auditedByOtherAuditor: boolean }[];
        } | null
      )?.perimeter ?? []
    ).filter((p) => p.relationship !== 'none');
    const investees = perimeter.length
      ? perimeter.map((p) => ({
          name: p.name,
          relationship: p.relationship,
          auditedByOtherAuditor: !!p.auditedByOtherAuditor,
        }))
      : (consFacts.investees ?? []).map((i) => ({
          name: i.name,
          relationship: null,
          auditedByOtherAuditor: !!i.auditedByOtherAuditor,
        }));

    const { header, analytics } = await this.understanding.readFinancialBasis(client, wi);
    const metrics: ScopeFacts['metrics'] = {};
    for (const m of analytics.movements) metrics[m.metricKey] = { cy: m.cy, py: m.py };
    const unitFactor = header.units ? FINANCIAL_UNIT_FACTOR[header.units] : null;

    // Materiality in force (latest completed 03.3 version).
    const det = await one<Row>(
      `SELECT id, version_no, status, selected_om, selected_pm FROM hsdg.audit_materiality_determination
        WHERE workflow_instance_id = $1 AND status = 'complete' ORDER BY version_no DESC LIMIT 1`,
    );
    let materiality: ScopeMaterialityRef | null = null;
    let specific: ScopeFacts['specific'] = [];
    if (det) {
      const { rows: sp } = await client.query<Row>(
        `SELECT scope, amount, affected_areas FROM hsdg.audit_materiality_specific WHERE determination_id = $1 ORDER BY seq`,
        [det.id],
      );
      specific = sp.map((x) => ({
        scope: String(x.scope),
        amount: n(x.amount),
        affectedAreas: arr(x.affected_areas),
      }));
      materiality = {
        versionNo: Number(det.version_no),
        versionLabel: materialityVersionLabel(Number(det.version_no)),
        status: String(det.status),
        overallMateriality: n(det.selected_om),
        performanceMateriality: n(det.selected_pm),
        specific: specific.map((x) => ({ scope: x.scope, amount: x.amount })),
      };
    }
    const { rows: signals } = await client.query<Row>(
      `SELECT id, seq, observation, potential_implications, rule_key, attention, destinations
         FROM hsdg.audit_planning_signal
        WHERE workflow_instance_id = $1 AND status <> 'closed'
          AND manager_assessment IS DISTINCT FROM 'not_relevant' ORDER BY seq`,
      [wi],
    );
    const { rows: focus } = await client.query<{ name: string }>(
      `SELECT name FROM hsdg.audit_area_of_focus WHERE workflow_instance_id = $1 AND status <> 'superseded' ORDER BY seq`,
      [wi],
    );
    const { rows: changes } = await client.query<{ category: string }>(
      `SELECT DISTINCT category FROM hsdg.audit_planning_change
        WHERE workflow_instance_id = $1 AND category <> 'no_significant_change'`,
      [wi],
    );
    const { rows: sections } = await client.query<{
      section_key: string;
      answers: Record<string, unknown>;
    }>(
      `SELECT section_key, answers FROM hsdg.audit_understanding_section
        WHERE workflow_instance_id = $1 AND section_key IN ('systems','business_model')`,
      [wi],
    );
    const ans = (sec: string, key: string) =>
      sections.find((x) => x.section_key === sec)?.answers?.[key];
    // 02.6 group-audit records: branches (own units) and the component matrix.
    const { rows: branches } = await client.query<Row>(
      `SELECT id, branch_name, location, country, firm_name FROM hsdg.audit_group_branch
        WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL ORDER BY sort_order, branch_name`,
      [wi],
    );
    const { rows: components } = await client.query<Row>(
      `SELECT component_name AS name, auditor_type, significance FROM hsdg.audit_group_component
        WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL AND included <> 'no'
        ORDER BY sort_order, component_name`,
      [wi],
    );
    const s197 = s197Applies(await readFrameworkRecordInputsOn(client, wi));
    const { rows: rev } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM hsdg.audit_analytics_exception
        WHERE workflow_instance_id = $1 AND NOT no_longer_flagged AND suggested_attention <> 'standard'
          AND rule_key ILIKE '%revenue%'`,
      [wi],
    );
    const facts: ScopeFacts = {
      entityName: s(eng?.legal_name),
      initialAudit: profile?.initial_audit === true,
      jointAudit: profile?.joint_audit === true,
      accountingEnvironment: s(profile?.accounting_environment),
      sa402: profile?.sa402_flag === true,
      frameworkConclusions: Object.fromEntries(areas.map((a) => [a.area_key, a.conclusion])),
      investees,
      hasBranches: consFacts.hasBranches === true || branches.length > 0,
      branches: branches.map((b) => ({
        id: String(b.id),
        name: String(b.branch_name),
        location: s(b.location),
        country: s(b.country),
        firmName: s(b.firm_name),
      })),
      components: components.map((c) => ({
        name: String(c.name),
        auditorType: s(c.auditor_type),
        significance: s(c.significance),
      })),
      s197,
      metrics,
      unitFactor,
      overallMateriality: materiality?.overallMateriality ?? null,
      performanceMateriality: materiality?.performanceMateriality ?? null,
      specific,
      signals: signals.map((x) => ({
        id: String(x.id),
        code: displayCode('PS', Number(x.seq))!,
        observation: String(x.observation),
        potentialImplications: s(x.potential_implications),
        ruleKey: s(x.rule_key),
        attention: x.attention as PlanningAttention,
        destinations: arr(x.destinations),
      })),
      focusNames: focus.map((f) => f.name),
      changeCategories: changes.map((c) => c.category),
      erpChange: ans('systems', 'erp_change') === 'Yes',
      cycles: arr(ans('systems', 'cycles')),
      otherSystems: arr(ans('systems', 'other_systems')),
      customerTypes: arr(ans('business_model', 'customer_types')),
      serviceOrgContext:
        typeof ans('systems', 'service_org_context') === 'string'
          ? clean(ans('systems', 'service_org_context') as string)
          : null,
      revenueAnalyticsFlag: Number(rev[0]?.n ?? 0) > 0,
    };
    return { facts, materiality, periodEnd: header.periodEnd, currency: header.currency };
  }

  private async workspace(
    client: PoolClient,
    wi: string,
    override?: ScopeApproachRecord,
  ): Promise<Workspace> {
    const { facts, materiality } = await this.readFacts(client, wi);
    const defs = await readScopeDecisionDefs(client);
    const record = override ?? (await this.readRecord(client, wi)) ?? emptyRecord();
    const scopeId = record.id;
    const signalCodes = new Map(facts.signals.map((x) => [x.id, x.code]));
    const om = materiality?.overallMateriality ?? null;
    const q = async (sql: string) =>
      scopeId ? (await client.query<Row>(sql, [scopeId])).rows : [];

    const units: ScopeUnit[] = (
      await q(`SELECT * FROM hsdg.audit_scope_unit WHERE scope_id = $1 ORDER BY seq`)
    ).map((u) => ({
      id: String(u.id),
      code: displayCode('SU', Number(u.seq))!,
      unitKey: s(u.unit_key),
      isAuto: u.is_auto === true,
      sourceLabel: s(u.source_label),
      name: String(u.name),
      unitType: u.unit_type as ScopeUnit['unitType'],
      location: s(u.location),
      finMetric: s(u.fin_metric),
      finAmount: n(u.fin_amount),
      finSource: s(u.fin_source),
      finNotAvailable: u.fin_not_available === true,
      employees: n(u.employees),
      transactionVolume: n(u.transaction_volume),
      volumeNote: s(u.volume_note),
      finPrompt: unitFinPrompt({
        unitType: u.unit_type as ScopeUnit['unitType'],
        finAmount: n(u.fin_amount),
        finNotAvailable: u.fin_not_available === true,
      }),
      materialityContext: materialityContext(n(u.fin_amount), om),
      relevance: arr(u.relevance) as ScopeUnit['relevance'],
      relevanceOther: s(u.relevance_other),
      qualitativeNote: s(u.qualitative_note),
      signalIds: arr(u.signal_ids),
      focusIds: arr(u.focus_ids),
      specificMateriality: u.specific_materiality === true,
      auditor: u.auditor as ScopeUnit['auditor'],
      auditorStrategy: (u.auditor_strategy ?? null) as ScopeUnit['auditorStrategy'],
      scopeConclusion: (u.scope_conclusion ?? null) as ScopeUnit['scopeConclusion'],
      rationale: s(u.rationale),
      noLongerGenerated: u.no_longer_generated === true,
      suggestedSignals: suggestUnitSignals(
        {
          name: String(u.name),
          unitType: u.unit_type as ScopeUnit['unitType'],
          signalIds: arr(u.signal_ids),
          location: s(u.location),
        },
        facts.signals,
      ),
      version: Number(u.version),
    }));

    const saved = await q(
      `SELECT * FROM hsdg.audit_scope_decision WHERE scope_id = $1 ORDER BY created_at`,
    );
    const decisions: ScopeDecision[] = [];
    for (const kind of SCOPE_METHODOLOGY_KINDS) {
      const rowsOfKind = saved.filter((x) => x.kind === kind);
      const mk = (
        itemKey: string,
        label: string,
        isCustom: boolean,
        options: string[],
        def: { hint?: string; itemCode?: string; guidance?: string | null } | null,
        retired = false,
      ): ScopeDecision => {
        const r = rowsOfKind.find((x) => x.item_key === itemKey);
        return {
          kind,
          itemKey,
          label,
          isCustom,
          options,
          hint: def?.hint ?? null,
          status: s(r?.status),
          rollForward: (r?.roll_forward ?? null) as ScopeDecision['rollForward'],
          prompt: null,
          note: s(r?.note),
          itemCode: def?.itemCode ?? null,
          guidance: def?.guidance ?? null,
          retired,
          version: r ? Number(r.version) : 0,
        };
      };
      const live = defs.defs[kind];
      for (const d of live) decisions.push(mk(d.key, d.label, false, d.options, d));
      // A retired library item stays visible where a decision was saved on it.
      for (const r of rowsOfKind.filter(
        (x) => x.is_custom !== true && !live.some((d) => d.key === x.item_key),
      )) {
        const d = defs.retired.get(`${kind}:${String(r.item_key)}`);
        if (d && r.status !== null) decisions.push(mk(d.key, d.label, false, d.options, d, true));
      }
      for (const r of rowsOfKind.filter((x) => x.is_custom === true)) {
        decisions.push(
          mk(
            String(r.item_key),
            String(r.label ?? r.item_key),
            true,
            CUSTOM_DECISION_OPTIONS[kind] ?? [],
            null,
          ),
        );
      }
    }
    for (const d of decisions) d.prompt = decisionPrompt(d, decisions);

    const serviceOrgs: ScopeServiceOrg[] = (
      await q(`SELECT * FROM hsdg.audit_scope_service_org WHERE scope_id = $1 ORDER BY seq`)
    ).map((o) => ({
      id: String(o.id),
      code: displayCode('SO', Number(o.seq))!,
      sourceKey: s(o.source_key),
      provider: String(o.provider),
      process: s(o.process),
      affectedAreas: arr(o.affected_areas),
      assuranceReport: (o.assurance_report ?? null) as ScopeServiceOrg['assuranceReport'],
      reportDetail: s(o.report_detail),
      cuec: (o.cuec ?? null) as ScopeServiceOrg['cuec'],
      so01: (o.so01 ?? null) as ScopeServiceOrg['so01'],
      note: s(o.note),
      version: Number(o.version),
    }));

    const considerations: ScopeConsideration[] = (
      await q(
        `SELECT c.*, pm.seq AS pm_seq FROM hsdg.audit_scope_consideration c
           LEFT JOIN hsdg.audit_planning_matter pm ON pm.id = c.planning_matter_id
          WHERE c.scope_id = $1 ORDER BY c.kind, c.created_at`,
      )
    ).map((c) => ({
      id: String(c.id),
      kind: c.kind as ScopeConsideration['kind'],
      considerationKey: String(c.consideration_key),
      isAuto: c.is_auto === true,
      signalId: s(c.signal_id),
      signalCode: c.signal_id ? (signalCodes.get(String(c.signal_id)) ?? null) : null,
      sourceLabel: s(c.source_label),
      observation: String(c.observation),
      suggestion: s(c.suggestion),
      attention: c.attention as PlanningAttention,
      response: s(c.response),
      note: s(c.note),
      planningMatterId: s(c.planning_matter_id),
      planningMatterCode: c.pm_seq != null ? displayCode('PM', Number(c.pm_seq)) : null,
      noLongerTriggered: c.no_longer_triggered === true,
      version: Number(c.version),
    }));

    const dependencies: ScopeDependency[] = (
      await q(
        `SELECT d.*, e.full_name AS owner_name FROM hsdg.audit_scope_dependency d
           LEFT JOIN hsdg.employees e ON e.id = d.owner_employee_id WHERE d.scope_id = $1 ORDER BY d.seq`,
      )
    ).map((d) => ({
      id: String(d.id),
      code: displayCode('SD', Number(d.seq))!,
      description: String(d.description),
      affected: s(d.affected),
      unitId: s(d.unit_id),
      ownerEmployeeId: s(d.owner_employee_id),
      ownerName: s(d.owner_name),
      ownerParty: d.owner_party as ScopeDependency['ownerParty'],
      neededBy: (d.needed_by ?? null) as ScopeDependency['neededBy'],
      impact: d.impact as ScopeDependency['impact'],
      status: d.status as ScopeDependency['status'],
      resolution: s(d.resolution),
      partnerAttention: isSignificantDependency(String(d.impact), String(d.status)),
      version: Number(d.version),
    }));

    const limitations: ScopeLimitation[] = (
      await q(
        `SELECT l.*, e.full_name AS owner_name, pm.seq AS pm_seq FROM hsdg.audit_scope_limitation l
           LEFT JOIN hsdg.employees e ON e.id = l.owner_employee_id
           LEFT JOIN hsdg.audit_planning_matter pm ON pm.id = l.planning_matter_id
          WHERE l.scope_id = $1 ORDER BY l.seq`,
      )
    ).map((l) => ({
      id: String(l.id),
      code: displayCode('SL', Number(l.seq))!,
      matter: String(l.matter),
      affected: s(l.affected),
      managementPosition: s(l.management_position),
      alternativeEvidence: s(l.alternative_evidence),
      ownerEmployeeId: s(l.owner_employee_id),
      ownerName: s(l.owner_name),
      status: l.status as 'open' | 'resolved',
      resolution: s(l.resolution),
      planningMatterId: s(l.planning_matter_id),
      planningMatterCode: l.pm_seq != null ? displayCode('PM', Number(l.pm_seq)) : null,
      version: Number(l.version),
    }));

    const linked = scopeId ? await readLinkedAreas(client, wi) : new Map();
    const mapItems: ScopeMapItem[] = (
      await q(`SELECT * FROM hsdg.audit_scope_map_item WHERE scope_id = $1 ORDER BY seq`)
    ).map((m) => {
      const metricKey = s(m.metric_key);
      const cy = metricKey ? (facts.metrics[metricKey]?.cy ?? null) : null;
      const amount = metricKey
        ? cy !== null && facts.unitFactor
          ? cy * facts.unitFactor
          : null
        : n(m.manual_amount);
      return {
        id: String(m.id),
        code: displayCode('AM', Number(m.seq))!,
        areaKey: s(m.area_key),
        isAuto: m.is_auto === true,
        sourceLabel: s(m.source_label),
        name: String(m.name),
        metricKey,
        amount,
        manualAmount: n(m.manual_amount),
        materialityContext: materialityContext(amount, om),
        materialityNote: s(m.materiality_note),
        specificMateriality: specificFor(String(m.name), facts),
        signalIds: arr(m.signal_ids),
        focusIds: arr(m.focus_ids),
        controlsStrategy: (m.controls_strategy ?? null) as ScopeMapItem['controlsStrategy'],
        timing: (m.timing ?? null) as ScopeMapItem['timing'],
        evidenceChannels: arr(m.evidence_channels) as ScopeMapItem['evidenceChannels'],
        specialConsiderations: arr(
          m.special_considerations,
        ) as ScopeMapItem['specialConsiderations'],
        suggestedSpecial: [],
        note: s(m.note),
        included: m.included === true,
        exclusionReason: s(m.exclusion_reason),
        reassessmentRequired: m.reassessment_required === true,
        reassessmentReason: s(m.reassessment_reason),
        linkedArea: linked.get(String(m.id)) ?? null,
        version: Number(m.version),
      };
    });

    const partnerActions: ScopePartnerAction[] = (
      await q(
        `SELECT a.*, e.full_name AS created_by_name, rb.full_name AS responded_by_name
           FROM hsdg.audit_scope_partner_action a
           LEFT JOIN hsdg.employees e ON e.id = a.created_by_employee_id
           LEFT JOIN hsdg.employees rb ON rb.id = a.responded_by_employee_id
          WHERE a.scope_id = $1 ORDER BY a.created_at DESC`,
      )
    ).map((a) => ({
      id: String(a.id),
      action: a.action as ScopePartnerAction['action'],
      note: s(a.note),
      signalId: s(a.signal_id),
      signalCode: a.signal_id ? (signalCodes.get(String(a.signal_id)) ?? null) : null,
      status: a.status as 'open' | 'addressed',
      response: s(a.response),
      createdByName: s(a.created_by_name),
      createdAt: iso(a.created_at)!,
      respondedByName: s(a.responded_by_name),
      respondedAt: iso(a.responded_at),
      scopeVersionLabel:
        a.scope_version_no == null ? null : scopeVersionLabel(Number(a.scope_version_no)),
      version: Number(a.version),
    }));

    const triggers = deriveTriggers(facts, units);
    return {
      facts,
      materiality,
      signalCodes,
      defs,
      state: {
        record,
        triggers,
        units,
        decisions,
        serviceOrgs,
        considerations,
        dependencies,
        limitations,
        mapItems,
        partnerActions,
      },
    };
  }

  /**
   * The 03.4 summary. After a write (`synced`), the Partner Attention triggers
   * are mirrored into the Partner Planning View queue (§26) first.
   */
  private async buildSummary(
    client: PoolClient,
    wi: string,
    synced = true,
  ): Promise<ScopeApproachSummary> {
    const ws = await this.workspace(client, wi);
    const { state, facts, materiality } = ws;
    const consistency = consistencyChecks(state);
    const pa = partnerAttention(state);
    const { rows: wf } = await client.query<{ engagement_id: string }>(
      `SELECT engagement_id FROM hsdg.service_workflow_instances WHERE id = $1`,
      [wi],
    );
    const engagementId = wf[0]!.engagement_id;
    if (synced && state.record.id) {
      await syncScopeAttention(
        client,
        engagementId,
        wi,
        { id: state.record.id, versionNo: state.record.versionNo },
        pa,
      );
    }
    const actor = await resolvePlanningActor(client, engagementId);
    const liveConsiderations = state.considerations.filter((c) => !c.noLongerTriggered);
    const { rows: review } = await client.query(
      `SELECT 1 FROM hsdg.audit_area_review WHERE workflow_instance_id = $1`,
      [wi],
    );
    return {
      record: state.record,
      intelligence: await this.intelligence(client, wi, ws),
      triggers: state.triggers,
      materiality,
      cards: {
        scopeUnits: state.units.filter((u) => !u.noLongerGenerated).length,
        relevantUnits: state.units.filter(
          (u) =>
            u.scopeConclusion === 'in_scope' ||
            u.scopeConclusion === 'limited' ||
            u.relevance.length > 0,
        ).length,
        otherAuditors: state.units.filter((u) => u.auditor !== 'dhvaj').length,
        specialConsiderations:
          liveConsiderations.length +
          state.serviceOrgs.length +
          (state.triggers.initialAudit ? 1 : 0) +
          (state.triggers.inventoryRelevant ? 1 : 0),
        openDependencies: state.dependencies.filter((d) => d.status !== 'resolved').length,
        potentialLimitations: state.limitations.filter((l) => l.status === 'open').length,
        partnerAttention: pa.length,
      },
      units: state.units,
      approachConsiderations: approachConsiderations(facts, state.triggers),
      decisions: state.decisions,
      suggestedConfirmationAreas: suggestedConfirmationAreas(facts),
      serviceOrgs: state.serviceOrgs,
      considerations: state.considerations,
      dependencies: state.dependencies,
      limitations: state.limitations,
      mapItems: state.mapItems,
      consistency,
      partnerAttention: pa,
      partnerActions: state.partnerActions,
      revisions: state.record.id ? await this.readRevisions(client, state.record.id) : [],
      authorities: await this.readAuthorities(client),
      completion: scopeCompletion(state, consistency),
      access: scopeAccess(actor),
      evidenceCounts: await this.readEvidenceCounts(client, wi),
      obFacts: await this.readObFacts(client, wi, facts),
      methodology: ws.defs.methodology,
      areaLink: {
        available: review.length > 0,
        unconverted: state.mapItems.filter((m) => m.included && !m.linkedArea).length,
      },
    };
  }

  /** §28 — evidence links per 03.4 record id. */
  private async readEvidenceCounts(
    client: PoolClient,
    wi: string,
  ): Promise<Record<string, number>> {
    const { rows } = await client.query<{ target_id: string; n: string }>(
      `SELECT target_id, count(*) AS n FROM hsdg.audit_planning_evidence
        WHERE workflow_instance_id = $1 AND removed_at IS NULL
          AND target_type IN ('scope_approach','scope_unit','scope_service_org','scope_dependency',
                              'scope_limitation','scope_map_item')
        GROUP BY target_id`,
      [wi],
    );
    return Object.fromEntries(rows.map((r) => [r.target_id, Number(r.n)]));
  }

  /**
   * §15 — opening-balance facts already recorded elsewhere on the file. Read
   * only: a correction is made at the source; each fact may suggest an OB input.
   */
  private async readObFacts(
    client: PoolClient,
    wi: string,
    facts: ScopeFacts,
  ): Promise<ScopeObFact[]> {
    // Only OB-01 (initial audits) shows them — skip the reads on a continuing audit.
    if (!facts.initialAudit) return [];
    const out: ScopeObFact[] = [];
    out.push({
      key: 'initial_audit',
      label: 'Initial audit',
      value: 'Yes — SA 510 opening-balance procedures apply',
      source: '02.1 Entity profile',
    });
    const prior = await readPriorAuditFile(client, wi);
    if (prior) {
      out.push({
        key: 'prior_file',
        label: 'Prior-year audit file',
        value: `On the portal — FY ${prior.financialYear}`,
        source: 'Engagement history',
        impliesInput: { key: 'prior_fs', value: 'available' },
      });
    }
    const { rows: matters } = await client.query<{ seq: number; description: string }>(
      `SELECT seq, description FROM hsdg.audit_prior_year_matter
        WHERE workflow_instance_id = $1 AND matter_type = 'modified_opinion' ORDER BY seq`,
      [wi],
    );
    if (matters.length) {
      out.push({
        key: 'prior_report_modified',
        label: 'Prior-year report modified',
        value: matters.map((m) => m.description).join('; '),
        source: '03.1 Prior-year matters',
        impliesInput: { key: 'prior_report_modified', value: 'yes' },
      });
    }
    if (facts.changeCategories.includes('accounting_policies')) {
      out.push({
        key: 'accounting_policy_change',
        label: 'Accounting-policy change',
        value: 'Recorded as a significant current-year change',
        source: '03.1 PI-01',
        impliesInput: null,
      });
    }
    return out;
  }

  /** 03.4.1 — read-only Scope Intelligence (corrections route to the source). */
  private async intelligence(
    client: PoolClient,
    wi: string,
    ws: Workspace,
  ): Promise<ScopeIntelligenceItem[]> {
    const { facts: f, materiality: m, state } = ws;
    const t = state.triggers;
    const { rows: eng } = await client.query<Row>(
      `SELECT e.period_label, e.engagement_code FROM hsdg.service_workflow_instances w
         JOIN hsdg.engagements e ON e.id = w.engagement_id WHERE w.id = $1`,
      [wi],
    );
    const out: ScopeIntelligenceItem[] = [];
    const add = (label: string, value: string | null, source: string) => {
      if (value) out.push({ label, value, source });
    };
    const fw = (k: string) => f.frameworkConclusions[k];
    const yn = (v: string | undefined) =>
      v === 'applicable'
        ? 'Applicable'
        : v === 'not_applicable'
          ? 'Not applicable'
          : 'Not concluded';
    add(
      'Entity / period',
      [f.entityName, s(eng[0]?.engagement_code), s(eng[0]?.period_label)]
        .filter(Boolean)
        .join(' · ') || null,
      'Engagement',
    );
    add(
      'Standalone / CFS',
      t.cfsApplicable
        ? `CFS applicable — ${f.investees.length} investee(s) in the perimeter`
        : fw('cfs') === 'applicable'
          ? 'CFS applicable — no investees captured on 02.6'
          : 'Standalone only',
      '02.6',
    );
    add(
      'Parent / subsidiary / associate / JV',
      f.investees.length
        ? f.investees
            .map(
              (i) => `${i.name}${i.relationship ? ` (${i.relationship.replace(/_/g, ' ')})` : ''}`,
            )
            .join('; ')
        : 'None recorded',
      '02.6',
    );
    add(
      'Branches / components / locations',
      [
        f.branches.length
          ? `${f.branches.length} branch(es) — ${f.branches
              .map((b) => [b.name, b.location ?? b.country].filter(Boolean).join(', '))
              .join('; ')}`
          : f.hasBranches
            ? 'Branches audited by branch auditor (not yet captured individually on 02.6)'
            : null,
        f.investees.length ? `${f.investees.length} component(s)` : null,
      ]
        .filter(Boolean)
        .join('; ') || 'None recorded (add operating sites to the population)',
      '02.6 / 03.2',
    );
    add(
      'Other / component / branch auditors',
      [
        f.investees
          .filter((i) => i.auditedByOtherAuditor)
          .map((i) => i.name)
          .join(', '),
        f.branches.some((b) => b.firmName)
          ? `branch auditor(s): ${[...new Set(f.branches.map((b) => b.firmName).filter(Boolean))].join(', ')}`
          : f.hasBranches
            ? 'branch auditor(s)'
            : '',
      ]
        .filter(Boolean)
        .join('; ') || 'None recorded',
      '02.6',
    );
    add('Joint audit', f.jointAudit ? 'Yes' : 'No', 'Section 02');
    add(
      'Initial audit',
      f.initialAudit ? 'Yes — SA 510 opening balances' : 'No (continuing audit)',
      '02.1',
    );
    add(
      'Service organisation',
      t.serviceOrganisation
        ? `Yes${f.accountingEnvironment ? ` — ${f.accountingEnvironment.replace(/_/g, ' ')}` : ''}${f.serviceOrgContext ? `; ${f.serviceOrgContext}` : ''}`
        : 'None recorded',
      '02.1 / 03.2',
    );
    add('ICFR reporting', yn(fw('ifc') ?? fw('icfr')), '02.5');
    add('CARO', yn(fw('caro')), '02.4');
    add(
      'Audit trail / s197 / other statutory',
      [
        fw('rule_11') ? `Rule 11 (audit trail): ${yn(fw('rule_11'))}` : null,
        f.s197 === null
          ? null
          : `Section 197(16) remuneration reporting: ${f.s197 ? 'Applicable' : 'Not applicable'}`,
        fw('other_regulatory') ? `Other regulatory: ${yn(fw('other_regulatory'))}` : null,
      ]
        .filter(Boolean)
        .join('; ') || 'Not concluded',
      '02.7',
    );
    add(
      'FRF / Schedule III',
      [
        fw('ind_as_as') ? `Ind AS / AS: ${yn(fw('ind_as_as'))}` : null,
        fw('schedule_iii') ? `Schedule III: ${yn(fw('schedule_iii'))}` : null,
      ]
        .filter(Boolean)
        .join('; ') || 'Not concluded',
      '02.2 / 02.3',
    );
    add(
      'Materiality',
      m
        ? `${m.versionLabel}: OM ₹${(m.overallMateriality ?? 0).toLocaleString('en-IN')} · PM ₹${(m.performanceMateriality ?? 0).toLocaleString('en-IN')}${m.specific.length ? ` · ${m.specific.length} specific` : ''}`
        : 'Not yet completed in 03.3 — scope is not finalised against materiality',
      '03.3',
    );
    add(
      'Planning Signals / Areas of Focus',
      `${f.signals.length} open signal(s); ${f.focusNames.length} Area(s) of Focus${f.focusNames.length ? ` — ${f.focusNames.join(', ')}` : ''}`,
      '03.1 / 03.2',
    );
    add(
      'Significant current-year changes',
      f.changeCategories
        .map((c) => PLANNING_CHANGE_CATEGORY_LABEL[c as PlanningChangeCategory] ?? c)
        .join(', ') || 'None recorded',
      '03.1 PI-01',
    );
    return out;
  }

  private async readRevisions(client: PoolClient, scopeId: string): Promise<ScopeRevision[]> {
    const { rows } = await client.query<Row>(
      `SELECT v.*, e.full_name AS created_by_name FROM hsdg.audit_scope_revision v
         LEFT JOIN hsdg.employees e ON e.id = v.created_by_employee_id
        WHERE v.scope_id = $1 ORDER BY v.to_version_no`,
      [scopeId],
    );
    return rows.map((v) => {
      const b = v.baseline as {
        record?: ScopeApproachRecord;
        units?: unknown[];
        mapItems?: unknown[];
      };
      return {
        fromVersionLabel: scopeVersionLabel(Number(v.from_version_no)),
        toVersionLabel: scopeVersionLabel(Number(v.to_version_no)),
        trigger: v.trigger as ScopeRevision['trigger'],
        reason: String(v.reason),
        affectedModules: arr(v.affected_modules),
        createdByName: s(v.created_by_name),
        createdAt: iso(v.created_at)!,
        baselineSummary: `${SCOPE_REVISION_TRIGGER_LABEL[v.trigger as ScopeRevision['trigger']] ?? v.trigger}. Baseline: AP-01 ${b.record?.ap01?.replace(/_/g, ' ') ?? '—'}; ${b.units?.length ?? 0} unit(s); ${b.mapItems?.length ?? 0} map area(s); completed by ${b.record?.completedByName ?? '—'}.`,
      };
    });
  }

  /** §32 — the 03.4 authority links (labels / provisions are maintained centrally). */
  private async readAuthorities(client: PoolClient): Promise<ScopeAuthorityRef[]> {
    const { rows } = await client.query<{
      anchor: string;
      label: string;
      provision_code: string;
      title: string | null;
      provision_number: string | null;
    }>(
      `SELECT l.anchor, l.label, l.provision_code, p.title, p.provision_number
         FROM hsdg.authority_reference_link l
         LEFT JOIN LATERAL (
           SELECT title, provision_number FROM hsdg.authority_provision
            WHERE code = l.provision_code ORDER BY effective_from DESC LIMIT 1
         ) p ON true
        WHERE l.context_key = $1
        ORDER BY l.sort_order, l.anchor`,
      [SCOPE_AUTHORITY_CONTEXT],
    );
    return rows.map((r) => ({
      anchor: r.anchor,
      code: r.provision_code,
      label: r.label,
      title: r.title,
      provisionNumber: r.provision_number,
    }));
  }
}

/** §30 — what the acting user may do in 03.4. */
function scopeAccess(actor: PlanningActor): ScopeAccess {
  const c = actor.capabilities;
  return {
    role: actor.role,
    roleLabel: PLANNING_ACTOR_ROLE_LABEL[actor.role],
    actingAsManager: actor.actingAsManager,
    prepare: c.addFacts || c.assess,
    conclude: c.assess,
    partnerReview: c.partnerReview,
    respond: c.respondToChallenge,
  };
}

function emptyHandoff(): ScopeHandoff {
  return {
    available: false,
    versionLabel: null,
    status: null,
    specialists: [],
    components: [],
    timing: [],
    dependencies: [],
  };
}

/** Pure — what 03.8 / 03.9 / 03.11 read from 03.4 (§6, §12, §17, §19, §21). */
export function buildHandoff(st: ScopeState): ScopeHandoff {
  return {
    available: st.record.id !== null,
    versionLabel: st.record.versionLabel,
    status: st.record.status,
    specialists: st.considerations
      .filter(
        (c) =>
          c.kind === 'specialist' &&
          !c.noLongerTriggered &&
          (c.response === 'likely_required' || c.response === 'evaluate_further'),
      )
      .map((c) => ({
        observation: c.observation,
        decision: c.response!,
        note: c.note,
        signalCode: c.signalCode,
      })),
    components: st.units
      .filter((u) => u.auditor !== 'dhvaj' && !u.noLongerGenerated)
      .map((u) => ({
        code: u.code,
        name: u.name,
        auditor: u.auditor,
        auditorStrategy: u.auditorStrategy,
        scopeConclusion: u.scopeConclusion,
      })),
    timing: st.decisions
      .filter((d) => d.kind === 'timing' && d.status !== null)
      .map((d) => ({
        label: d.label,
        status: d.status,
        rollForward: d.rollForward,
        prompt: d.prompt,
      })),
    dependencies: st.dependencies
      .filter((d) => d.status !== 'resolved')
      .map((d) => ({
        code: d.code,
        description: d.description,
        neededBy: d.neededBy,
        status: d.status,
        ownerName: d.ownerName,
        ownerParty: d.ownerParty,
      })),
  };
}

/** The Phase 03 checklist rows a hand-off carries something into. */
export function handoffItems(h: ScopeHandoff): string[] {
  const out: string[] = [];
  if (h.specialists.length) out.push(SCOPE_HANDOFF_ITEMS[0]);
  if (h.components.length) out.push(SCOPE_HANDOFF_ITEMS[1]);
  if (h.timing.length || h.dependencies.length) out.push(SCOPE_HANDOFF_ITEMS[2]);
  return out;
}

function sanitizeObInputs(v: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (/^[a-z_]{2,40}$/.test(k) && typeof val === 'string' && val.length <= 500) out[k] = val;
  }
  return out;
}

function diffOf(
  cur: ScopeApproachRecord,
  next: ScopeApproachRecord,
  input: UpdateScopeApproachInput,
) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of Object.keys(input) as (keyof UpdateScopeApproachInput)[]) {
    if (k === 'version' || k === 'conclusionSummary') continue;
    const key = k as keyof ScopeApproachRecord;
    if (JSON.stringify(cur[key]) !== JSON.stringify(next[key])) {
      before[k] = cur[key];
      after[k] = next[key];
    }
  }
  return { before, after };
}

function emptyRecord(): ScopeApproachRecord {
  return mapRecord({ version_no: 1, status: 'draft', version: 0, ob_inputs: {}, ec01_areas: [] });
}

function mapRecord(r: Row): ScopeApproachRecord {
  const versionNo = Number(r.version_no ?? 1);
  return {
    id: s(r.id),
    versionNo,
    versionLabel: scopeVersionLabel(versionNo),
    status: (r.status ?? 'draft') as ScopeApproachRecord['status'],
    methodologyVersion: s(r.methodology_version),
    sc01: (r.sc01 ?? null) as ScopeApproachRecord['sc01'],
    sc01Other: s(r.sc01_other),
    sc02: (r.sc02 ?? null) as ScopeApproachRecord['sc02'],
    sc02Note: s(r.sc02_note),
    ap01: (r.ap01 ?? null) as ScopeApproachRecord['ap01'],
    ap01Rationale: s(r.ap01_rationale),
    icfrNote: s(r.icfr_note),
    ec01: (r.ec01 ?? null) as ScopeApproachRecord['ec01'],
    ec01Areas: arr(r.ec01_areas) as ScopeApproachRecord['ec01Areas'],
    ec01Note: s(r.ec01_note),
    inventoryDecision: (r.inventory_decision ?? null) as ScopeApproachRecord['inventoryDecision'],
    inventoryLocations: s(r.inventory_locations),
    inventoryNote: s(r.inventory_note),
    physicalOther: (r.physical_other ?? null) as ScopeApproachRecord['physicalOther'],
    physicalOtherNote: s(r.physical_other_note),
    obInputs: (r.ob_inputs ?? {}) as Record<string, string>,
    ob01: (r.ob01 ?? null) as ScopeApproachRecord['ob01'],
    ob01Note: s(r.ob01_note),
    ia01: (r.ia01 ?? null) as ScopeApproachRecord['ia01'],
    ia01Note: s(r.ia01_note),
    jointAuditNote: s(r.joint_audit_note),
    dt01: (r.dt01 ?? null) as ScopeApproachRecord['dt01'],
    dt01Note: s(r.dt01_note),
    sl01: (r.sl01 ?? null) as ScopeApproachRecord['sl01'],
    materialityVersionNo: n(r.materiality_version_no),
    reassessmentReason: s(r.reassessment_reason),
    reassessmentSource: (r.reassessment_source ??
      null) as ScopeApproachRecord['reassessmentSource'],
    revisionTrigger: (r.revision_trigger ?? null) as ScopeApproachRecord['revisionTrigger'],
    revisionReason: s(r.revision_reason),
    conclusionSummary: s(r.conclusion_summary),
    ap02: (r.ap02 ?? null) as ScopeApproachRecord['ap02'],
    completedByName: s(r.completed_by_name),
    completedAt: iso(r.completed_at),
    version: Number(r.version ?? 0),
  };
}
