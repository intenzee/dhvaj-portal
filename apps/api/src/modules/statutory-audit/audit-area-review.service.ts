import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  AREA_PERMISSION_LEVEL_LABEL,
  ASSERTION_IDS,
  BLOCKING_AREA_COMMENT_KINDS,
  GENERAL_CORPORATE_INDUSTRY,
  NOTIFICATION_TYPE,
  REMOVAL_REASON_LABEL,
  REMOVAL_REASON_NEEDS_TEXT,
  areaReviewVersionLabel,
  materialityVersionLabel,
  type AddCustomAreaInput,
  type AddLibraryAreasInput,
  type AreaAuthorityRef,
  type AreaCommentInput,
  type AreaCommentKind,
  type AreaGrantCandidate,
  type AreaImpact,
  type AreaLibraryProfile,
  type AreaLinkInput,
  type AreaMatrixVersion,
  type AreaPriorYear,
  type AreaPriorYearMatter,
  type AreaReviewAccess,
  type AreaReviewCapabilities,
  type AreaReviewComment,
  type AreaReviewGrant,
  type AreaReviewRecord,
  type AssertionActionInput,
  type AssertionGroup,
  type AssertionId,
  type AssertionMasterItem,
  type AuditAreaLibraryItem,
  type AuditAreaReviewSummary,
  type AuthorityCategory,
  type CompleteAreaReviewInput,
  type DownstreamAreaRequestInput,
  type EngagementAuditArea,
  type FinancialUnit,
  type GrantAreaPermissionInput,
  type PlanningAttention,
  type RemoveAuditAreaInput,
  type ReopenAreaReviewInput,
  type RespondAreaCommentInput,
  type RestoreAuditAreaInput,
  type SignalResolutionInput,
  type StoredAreaReviewStatus,
  type UpdateAuditAreaInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditBusinessUnderstandingService } from './audit-business-understanding.service';
import {
  applicableLibrary,
  assertionSuggestions,
  assessImpacts,
  buildMatrix,
  completenessSummary,
  completionBasis,
  deriveArea,
  sectionStatus,
  signalRefs,
  specificKeyOf,
  specificMatchesArea,
  specificMatters,
  suggestSignals,
  textMentionsArea,
  tiles,
  validations,
  type AreaFacts,
  type AttentionRule,
  type CompletionBasis,
  type LibraryRow,
  type OpenReviewItem,
  type StoredArea,
  type StoredAssertion,
} from './area-review-engine';
import {
  assertShell,
  assertSignalsInShell,
  clean,
  cleanList,
  displayCode,
} from './planning-shared';
import { readPriorAuditFile } from './master-facts';
import { assertAreaCapability, resolveAreaAccess } from './area-review-access';
import { notifyPlanning } from './planning-governance';
import { linkScopeMap, readScopeStrategies, readUnconvertedMapAreas } from './scope-map-link';

/** Phase 03 checklist row 03.5 rolls its state up into. */
const AREA_ITEM_KEY = 'areas_and_assertions';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : s(v));
const arr = <T = string>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

interface Workspace {
  record: (AreaReviewRecord & { basis: CompletionBasis | null }) | null;
  facts: AreaFacts;
  library: LibraryRow[];
  areas: EngagementAuditArea[];
  stored: StoredArea[];
  resolutions: Map<string, string>;
  impacts: AreaImpact[];
  materialityLabel: string | null;
  periodEnd: string | null;
  master: AssertionMasterItem[];
  /** Open EP challenges / reassessment requests / downstream requests (VAL-09, §25). */
  openItems: OpenReviewItem[];
  /** §28 evidence counts keyed by audit_area_assertion id. */
  assertionEvidence: Record<string, number>;
}

const BLOCKING = BLOCKING_AREA_COMMENT_KINDS as string[];

/**
 * 03.5 Audit Areas & Assertions (DHVAJ 03.5 — FROZEN). The engagement receives
 * the complete applicable Audit Area Library (default Retained); the Manager
 * removes, restores, adds and reviews assertions; AA-01 completes the section
 * and generates an immutable, versioned Audit Area & Assertion Matrix.
 */
@Injectable()
export class AuditAreaReviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly understanding: AuditBusinessUnderstandingService,
  ) {
    // §25 — a 03.2 figure change (new financial area / dataset) can affect a completed 03.5.
    understanding.onFiguresChanged((client, _ctx, _engagementId, wi) =>
      this.markImpacted(client, wi),
    );
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async getSummary(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      return this.buildSummary(client, engagementId, wi);
    });
  }

  /** §3 — first entry creates the population once; re-entry never regenerates. */
  async populate(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      const access = await resolveAreaAccess(client, engagementId);
      const { rowCount } = await client.query(
        `SELECT 1 FROM hsdg.audit_area_review WHERE workflow_instance_id = $1`,
        [wi],
      );
      // Idempotent once 03.5 exists; creating the population is a preparer's step (§3, §27).
      if (!rowCount) {
        assertAreaCapability(access, 'prepare');
        await this.ensure(client, ctx, engagementId, wi);
      }
      return this.buildSummary(client, engagementId, wi, undefined, access);
    });
  }

  // ── §9 Remove / restore ──────────────────────────────────────────────────

  async removeArea(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    areaId: string,
    input: RemoveAuditAreaInput,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(client, ctx, engagementId, wi);
      const ws = await this.workspace(client, wi);
      const area = this.area(ws, areaId);
      this.checkVersion(area.version, input.version);
      if (area.disposition === 'removed')
        throw new ConflictException('The Audit Area is already removed.');
      if (area.downstreamWork > 0) {
        const d = area.downstreamDetail;
        const parts = [
          d.risks ? `${d.risks} risk(s)` : '',
          d.procedures ? `${d.procedures} procedure(s) in progress` : '',
          d.workAreas ? `${d.workAreas} work area(s) started` : '',
        ].filter(Boolean);
        throw new ConflictException(
          `Downstream work already references ${area.areaName} (${parts.join(', ')}) — resolve or reassign it before removing the area.`,
        );
      }
      const text = clean(input.reasonText);
      if (REMOVAL_REASON_NEEDS_TEXT.includes(input.reasonCode) && !text) {
        throw new BadRequestException(
          `"${REMOVAL_REASON_LABEL[input.reasonCode]}" needs a short rationale.`,
        );
      }
      if (area.warnings.length && !text) {
        throw new BadRequestException(
          'Existing engagement information indicates that this Audit Area may be relevant — confirm the removal with a short rationale.',
        );
      }
      let covered: string | null = null;
      if (input.reasonCode === 'COVERED_ELSEWHERE') {
        covered = input.coveredUnderAreaId ?? null;
        if (!covered) throw new BadRequestException('Select the Audit Area this is covered under.');
        if (covered === areaId)
          throw new BadRequestException('An Audit Area cannot be covered under itself.');
        const target = ws.areas.find((a) => a.id === covered);
        if (!target || target.disposition !== 'retained') {
          throw new BadRequestException('"Covered under" must be another retained Audit Area.');
        }
      }
      await client.query(
        `UPDATE hsdg.audit_engagement_area
            SET disposition = 'removed', removal_reason_code = $2, removal_reason_text = $3,
                covered_under_area_id = $4, removed_by_employee_id = $5, removed_at = now(),
                updated_by_employee_id = $5, version = version + 1
          WHERE id = $1`,
        [areaId, input.reasonCode, text, covered, ctx.employeeId ?? null],
      );
      await this.touched(client, ctx, wi, reviewId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_removed',
        objectType: 'audit_engagement_area',
        objectId: areaId,
        before: { disposition: 'retained' },
        after: {
          disposition: 'removed',
          area: area.areaName,
          reasonCode: input.reasonCode,
          reasonText: text,
          coveredUnderAreaId: covered,
          warnings: area.warnings.map((w) => w.text),
        },
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  async restoreArea(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    areaId: string,
    input: RestoreAuditAreaInput,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(client, ctx, engagementId, wi);
      const ws = await this.workspace(client, wi);
      const area = this.area(ws, areaId);
      this.checkVersion(area.version, input.version);
      if (area.disposition === 'retained')
        throw new ConflictException('The Audit Area is already retained.');
      await client.query(
        `UPDATE hsdg.audit_engagement_area
            SET disposition = 'retained', removal_reason_code = NULL, removal_reason_text = NULL,
                covered_under_area_id = NULL, removed_by_employee_id = NULL, removed_at = NULL,
                updated_by_employee_id = $2, version = version + 1
          WHERE id = $1`,
        [areaId, ctx.employeeId ?? null],
      );
      // §9.2 — reinstate default / current assertions if none remain active.
      if (!area.assertions.some((a) => a.active)) {
        const { rowCount } = await client.query(
          `UPDATE hsdg.audit_area_assertion SET active = true, version = version + 1
            WHERE area_id = $1 AND origin = 'suggested'`,
          [areaId],
        );
        const lib = ws.library.find((l) => l.id === area.sourceAuditAreaId);
        if (!rowCount && lib) await this.insertDefaultAssertions(client, areaId, engagementId, lib);
      }
      await this.applySuggestions(client, ws, areaId);
      await this.touched(client, ctx, wi, reviewId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_restored',
        objectType: 'audit_engagement_area',
        objectId: areaId,
        before: {
          disposition: 'removed',
          reasonCode: area.removalReasonCode,
          reasonText: area.removalReasonText,
          coveredUnderAreaId: area.coveredUnderAreaId,
        },
        after: { disposition: 'retained', area: area.areaName },
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  // ── §11 Add ─────────────────────────────────────────────────────────────

  async addFromLibrary(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: AddLibraryAreasInput,
  ): Promise<AuditAreaReviewSummary> {
    const ids = cleanList(input.libraryAreaIds);
    if (!ids.length) throw new BadRequestException('Select at least one library Audit Area.');
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(client, ctx, engagementId, wi);
      const ws = await this.workspace(client, wi);
      const libs: LibraryRow[] = [];
      for (const id of ids) {
        const lib = ws.library.find((l) => l.id === id && l.active);
        if (!lib)
          throw new BadRequestException(
            "Only active areas of this engagement's library version can be added.",
          );
        const existing = ws.stored.find((a) => a.areaCode === lib.areaCode);
        if (existing) {
          throw new ConflictException(
            existing.disposition === 'removed'
              ? `${lib.areaName} is already in the population (Removed) — use Restore instead.`
              : `${lib.areaName} is already in the population.`,
          );
        }
        libs.push(lib);
      }
      const inserted = await this.insertLibraryAreas(
        client,
        ctx,
        engagementId,
        reviewId,
        libs,
        'added_from_library',
        null,
        ws.facts,
      );
      for (const lib of libs) {
        const areaId = inserted.get(lib.id)!;
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.audit_area_added',
          objectType: 'audit_engagement_area',
          objectId: areaId,
          after: {
            source: 'library',
            areaCode: lib.areaCode,
            libraryVersion: lib.libraryVersion,
            area: lib.areaName,
          },
        });
      }
      await this.touched(client, ctx, wi, reviewId);
      return this.buildSummary(client, engagementId, wi);
    });
  }

  async addCustom(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: AddCustomAreaInput,
  ): Promise<AuditAreaReviewSummary> {
    const name = clean(input.name);
    const reason = clean(input.reason);
    if (!name || !reason) {
      throw new BadRequestException(
        'A custom Audit Area needs a name, an Area Type and a Reason for Addition.',
      );
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(client, ctx, engagementId, wi);
      const signalIds = cleanList(input.signalIds);
      await assertSignalsInShell(client, wi, signalIds);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_engagement_area
           (review_id, engagement_id, seq, source, origin, area_name, area_type, addition_reason,
            created_by_employee_id, updated_by_employee_id)
         VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_engagement_area WHERE review_id = $1),
                 'custom', 'custom', $3, $4, $5, $6, $6) RETURNING id`,
        [reviewId, engagementId, name, input.areaType, reason, ctx.employeeId ?? null],
      );
      const areaId = rows[0]!.id;
      for (const sid of signalIds) {
        await client.query(
          `INSERT INTO hsdg.audit_area_signal_link (area_id, engagement_id, signal_id, origin)
           VALUES ($1, $2, $3, 'manual')`,
          [areaId, engagementId, sid],
        );
      }
      await this.applySuggestions(client, await this.workspace(client, wi), areaId);
      await this.touched(client, ctx, wi, reviewId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_added',
        objectType: 'audit_engagement_area',
        objectId: areaId,
        after: { source: 'custom', name, areaType: input.areaType, reason, signalIds },
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  /**
   * 03.4 §23 — carry a 03.4 Approach Map area that matches no library area into
   * 03.5 as a custom area (origin `scope_map`). Runs in the caller's (03.4)
   * transaction; 03.5 must be open for changes.
   */
  async addFromScopeMap(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    item: { id: string; code: string; name: string; signalIds: string[] },
  ): Promise<string> {
    const { rows: rev } = await client.query(
      `SELECT 1 FROM hsdg.audit_area_review WHERE workflow_instance_id = $1`,
      [wi],
    );
    if (!rev.length) {
      throw new ConflictException(
        'Open 03.5 Audit Areas & Assertions first — the area population is created there.',
      );
    }
    const reviewId = await this.editable(client, ctx, engagementId, wi);
    const reason = `Carried from the 03.4 Preliminary Audit Approach Map (${item.code}).`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_engagement_area
         (review_id, engagement_id, seq, source, origin, area_name, area_type, addition_reason,
          scope_map_item_id, created_by_employee_id, updated_by_employee_id)
       VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_engagement_area WHERE review_id = $1),
               'custom', 'scope_map', $3, 'cross_cutting', $4, $5, $6, $6) RETURNING id`,
      [reviewId, engagementId, item.name, reason, item.id, ctx.employeeId ?? null],
    );
    const areaId = rows[0]!.id;
    for (const sid of item.signalIds) {
      await client.query(
        `INSERT INTO hsdg.audit_area_signal_link (area_id, engagement_id, signal_id, origin)
         VALUES ($1, $2, $3, 'manual') ON CONFLICT DO NOTHING`,
        [areaId, engagementId, sid],
      );
    }
    await this.applySuggestions(client, await this.workspace(client, wi), areaId);
    await this.touched(client, ctx, wi, reviewId);
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.audit_area_added',
      objectType: 'audit_engagement_area',
      objectId: areaId,
      after: { source: 'custom', origin: 'scope_map', name: item.name, mapItem: item.code },
    });
    return areaId;
  }

  // ── Area detail: attention, amount, owner, resolutions ───────────────────

  async updateArea(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    areaId: string,
    input: UpdateAuditAreaInput,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(
        client,
        ctx,
        engagementId,
        wi,
        input.resolveReviewFlag !== undefined ? 'complete' : 'prepare',
      );
      const ws = await this.workspace(client, wi);
      const area = this.area(ws, areaId);
      const cur = ws.stored.find((a) => a.id === areaId)!;
      this.checkVersion(area.version, input.version);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const sets: string[] = [];
      const params: unknown[] = [areaId];
      const set = (col: string, v: unknown, key: string, old: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
        before[key] = old;
        after[key] = v;
      };

      if (input.attention !== undefined && input.attention !== cur.attention) {
        const reason = clean(input.attentionReason);
        if (
          area.displayAttention !== 'requires_review' &&
          input.attention === 'standard' &&
          area.suggestedAttention === 'enhanced' &&
          !reason
        ) {
          throw new BadRequestException(
            `The portal suggests Enhanced Attention (${area.suggestionBasis ?? 'linked information'}) — downgrading to Standard needs a short reason.`,
          );
        }
        set('attention', input.attention, 'attention', cur.attention);
        set('attention_source', 'manager', 'attentionSource', cur.attentionSource);
        set('attention_reason', reason, 'attentionReason', cur.attentionReason);
      }
      const amountTouched = [
        'cyAmount',
        'pyAmount',
        'currency',
        'unit',
        'amountSource',
        'amountNote',
      ].some((k) => (input as unknown as Record<string, unknown>)[k] !== undefined);
      if (amountTouched) {
        const source = input.amountSource !== undefined ? input.amountSource : cur.amountSource;
        if (source) {
          const cy = input.cyAmount !== undefined ? input.cyAmount : cur.manualCy;
          const py = input.pyAmount !== undefined ? input.pyAmount : cur.manualPy;
          const currency = clean(
            input.currency !== undefined ? input.currency : cur.manualCurrency,
          );
          const unit = (
            input.unit !== undefined ? input.unit : cur.manualUnit
          ) as FinancialUnit | null;
          if (!currency || !unit) {
            throw new BadRequestException('A manually entered amount needs its currency and unit.');
          }
          if (cy === null && py === null) {
            throw new BadRequestException('Enter a CY or PY amount (or clear the manual amount).');
          }
          set('cy_amount', cy, 'cyAmount', cur.manualCy);
          set('py_amount', py, 'pyAmount', cur.manualPy);
          set('currency', currency, 'currency', cur.manualCurrency);
          set('unit', unit, 'unit', cur.manualUnit);
          set('amount_source', source, 'amountSource', cur.amountSource);
          set(
            'amount_note',
            clean(input.amountNote !== undefined ? input.amountNote : cur.amountNote),
            'amountNote',
            cur.amountNote,
          );
        } else {
          set('cy_amount', null, 'cyAmount', cur.manualCy);
          set('py_amount', null, 'pyAmount', cur.manualPy);
          set('currency', null, 'currency', cur.manualCurrency);
          set('unit', null, 'unit', cur.manualUnit);
          set('amount_source', null, 'amountSource', cur.amountSource);
          set('amount_note', null, 'amountNote', cur.amountNote);
        }
      }
      if (input.planningOwnerEmployeeId !== undefined) {
        set(
          'planning_owner_employee_id',
          input.planningOwnerEmployeeId,
          'planningOwner',
          cur.planningOwnerEmployeeId,
        );
      }
      if (input.inconsistencyResolution !== undefined) {
        set(
          'inconsistency_resolution',
          clean(input.inconsistencyResolution),
          'inconsistencyResolution',
          cur.inconsistencyResolution,
        );
      }
      if (input.resolveReviewFlag !== undefined) {
        const note = clean(input.resolveReviewFlag);
        if (!cur.reviewFlag)
          throw new ConflictException('This Audit Area has no Requires Review flag to resolve.');
        if (!note)
          throw new BadRequestException(
            'Resolving Requires Review needs a note of how it was resolved.',
          );
        set('review_flag', null, 'reviewFlag', cur.reviewFlag);
        set('review_flag_source', null, 'reviewFlagSource', cur.reviewFlagSource);
        after.resolution = note;
      }
      if (!sets.length) return this.buildSummary(client, engagementId, wi);
      params.push(ctx.employeeId ?? null);
      await client.query(
        `UPDATE hsdg.audit_engagement_area SET ${sets.join(', ')}, updated_by_employee_id = $${params.length},
                version = version + 1 WHERE id = $1`,
        params,
      );
      await this.touched(client, ctx, wi, reviewId);
      await this.audit.recordWith(client, ctx, {
        action: amountTouched
          ? 'statutory_audit.audit_area_amount_changed'
          : input.attention !== undefined
            ? 'statutory_audit.audit_area_attention_changed'
            : 'statutory_audit.audit_area_updated',
        objectType: 'audit_engagement_area',
        objectId: areaId,
        before,
        after,
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  // ── §16/§17 Assertions ──────────────────────────────────────────────────

  async assertionAction(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    areaId: string,
    assertionId: string,
    input: AssertionActionInput,
  ): Promise<AuditAreaReviewSummary> {
    if (!(ASSERTION_IDS as readonly string[]).includes(assertionId)) {
      throw new BadRequestException(
        'Assertions must be selected from the canonical assertion master.',
      );
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(client, ctx, engagementId, wi);
      const ws = await this.workspace(client, wi);
      const area = this.area(ws, areaId);
      if (area.disposition !== 'retained') {
        throw new ConflictException('Restore the Audit Area before changing its assertions.');
      }
      const cur = ws.stored
        .find((a) => a.id === areaId)!
        .assertions.find((x) => x.assertionId === assertionId);
      const reason = clean(input.reason);
      let before: Record<string, unknown> = {};
      let after: Record<string, unknown> = {};
      switch (input.action) {
        case 'add':
        case 'restore': {
          if (cur?.active) throw new ConflictException('The assertion is already active.');
          if (cur) {
            await client.query(
              `UPDATE hsdg.audit_area_assertion SET active = true, version = version + 1 WHERE id = $1`,
              [cur.id],
            );
            before = { active: false, removalReason: cur.removalReason };
          } else {
            if (input.action === 'restore')
              throw new NotFoundException('The assertion was never on this area.');
            await client.query(
              `INSERT INTO hsdg.audit_area_assertion (area_id, engagement_id, assertion_id, origin)
               VALUES ($1, $2, $3, 'user_added')`,
              [areaId, engagementId, assertionId],
            );
          }
          after = { active: true, origin: cur?.origin ?? 'user_added' };
          break;
        }
        case 'remove': {
          if (!cur?.active) throw new ConflictException('The assertion is not active.');
          if (cur.origin === 'suggested' && !reason) {
            throw new BadRequestException(
              'Removing a portal-suggested assertion needs a short reason.',
            );
          }
          await client.query(
            `UPDATE hsdg.audit_area_assertion SET active = false, removal_reason = $2, version = version + 1 WHERE id = $1`,
            [cur.id, reason],
          );
          before = { active: true };
          after = { active: false, reason };
          break;
        }
        case 'set_attention': {
          if (!cur?.active)
            throw new ConflictException('Only an active assertion carries attention.');
          const next = input.attention;
          if (!next) throw new BadRequestException('Choose Standard or Enhanced Attention.');
          if (next === 'standard' && cur.suggestedAttention === 'enhanced' && !reason) {
            throw new BadRequestException(
              'Downgrading a portal-suggested Enhanced Attention assertion to Standard needs a short reason.',
            );
          }
          await client.query(
            `UPDATE hsdg.audit_area_assertion SET attention = $2, attention_reason = $3, version = version + 1 WHERE id = $1`,
            [cur.id, next, next === 'standard' ? reason : clean(input.reason)],
          );
          before = { attention: cur.attention };
          after = { attention: next, reason };
          break;
        }
      }
      await this.touched(client, ctx, wi, reviewId);
      await this.audit.recordWith(client, ctx, {
        action: `statutory_audit.audit_area_assertion_${input.action}`,
        objectType: 'audit_engagement_area',
        objectId: areaId,
        before: { assertionId, ...before },
        after: { assertionId, area: area.areaName, ...after },
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  // ── §18 Planning Signal / VAL-04 specific-materiality links ─────────────

  async link(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    areaId: string,
    input: AreaLinkInput,
  ): Promise<AuditAreaReviewSummary> {
    if (!!input.signalId === !!input.specificKey) {
      throw new BadRequestException(
        'Link either a Planning Signal or a specific-materiality matter.',
      );
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(client, ctx, engagementId, wi);
      const ws = await this.workspace(client, wi);
      const area = this.area(ws, areaId);
      const active = input.action === 'link';
      if (input.signalId) {
        await assertSignalsInShell(client, wi, [input.signalId]);
        await client.query(
          `INSERT INTO hsdg.audit_area_signal_link (area_id, engagement_id, signal_id, origin, active)
           VALUES ($1, $2, $3, 'manual', $4)
           ON CONFLICT (area_id, signal_id) DO UPDATE SET active = EXCLUDED.active,
             version = hsdg.audit_area_signal_link.version + 1`,
          [areaId, engagementId, input.signalId, active],
        );
        if (active) await this.applySuggestions(client, await this.workspace(client, wi), areaId);
      } else {
        const key = input.specificKey!;
        if (active && !ws.facts.specific.some((x) => x.key === key)) {
          throw new BadRequestException(
            'That specific-materiality matter is not in the materiality in force.',
          );
        }
        await client.query(
          `INSERT INTO hsdg.audit_area_specific_link (area_id, engagement_id, specific_key, origin, active)
           VALUES ($1, $2, $3, 'manual', $4)
           ON CONFLICT (area_id, specific_key) DO UPDATE SET active = EXCLUDED.active,
             version = hsdg.audit_area_specific_link.version + 1`,
          [areaId, engagementId, key, active],
        );
      }
      await this.touched(client, ctx, wi, reviewId);
      await this.audit.recordWith(client, ctx, {
        action: input.signalId
          ? `statutory_audit.audit_area_signal_${input.action}ed`
          : `statutory_audit.audit_area_specific_${input.action}ed`,
        objectType: 'audit_engagement_area',
        objectId: areaId,
        after: {
          area: area.areaName,
          signalId: input.signalId ?? null,
          specificKey: input.specificKey ?? null,
        },
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  /** VAL-05 — documented "no Audit Area mapping required" resolution. */
  async resolveSignal(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: SignalResolutionInput,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(client, ctx, engagementId, wi);
      await assertSignalsInShell(client, wi, [input.signalId]);
      const note = clean(input.note);
      if (note) {
        await client.query(
          `INSERT INTO hsdg.audit_area_signal_resolution (review_id, engagement_id, signal_id, note, created_by_employee_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (review_id, signal_id) DO UPDATE SET note = EXCLUDED.note,
             version = hsdg.audit_area_signal_resolution.version + 1`,
          [reviewId, engagementId, input.signalId, note, ctx.employeeId ?? null],
        );
      } else {
        await client.query(
          `DELETE FROM hsdg.audit_area_signal_resolution WHERE review_id = $1 AND signal_id = $2`,
          [reviewId, input.signalId],
        );
      }
      await this.touched(client, ctx, wi, reviewId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_signal_resolution',
        objectType: 'audit_area_review',
        objectId: reviewId,
        after: { signalId: input.signalId, note },
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  // ── §22 Completion / reopen ──────────────────────────────────────────────

  async complete(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: CompleteAreaReviewInput,
  ): Promise<AuditAreaReviewSummary> {
    if (input.confirm !== true)
      throw new BadRequestException('AA-01 must be confirmed to complete 03.5.');
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(client, ctx, engagementId, wi, 'complete');
      const ws = await this.workspace(client, wi);
      const summary = await this.buildSummary(client, engagementId, wi, ws);
      const rec = summary.record!;
      this.checkVersion(rec.version, input.version);
      const failing = summary.validations.filter((v) => !v.met);
      if (failing.length) {
        throw new ConflictException(
          `03.5 cannot be completed: ${failing.map((v) => `${v.id} ${v.detail ?? v.label}`).join(' ')}`,
        );
      }
      await client.query(
        `INSERT INTO hsdg.audit_area_matrix_version
           (review_id, engagement_id, version_no, library_version, matrix, summary, confirmed_by_employee_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
        [
          reviewId,
          engagementId,
          rec.versionNo,
          rec.libraryVersion,
          JSON.stringify(summary.matrix),
          JSON.stringify(summary.completeness),
          ctx.employeeId ?? null,
        ],
      );
      await client.query(
        `UPDATE hsdg.audit_area_review
            SET status = 'complete', completion_basis = $2::jsonb, completed_by_employee_id = $3,
                completed_at = now(), update_reason = NULL, version = version + 1
          WHERE id = $1`,
        [
          reviewId,
          JSON.stringify(
            completionBasis(
              ws.facts,
              applicableLibrary(ws.library, ws.facts.profile, ws.periodEnd),
            ),
          ),
          ctx.employeeId ?? null,
        ],
      );
      await this.rollUp(client, ctx, wi, 'complete');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_review_completed',
        objectType: 'audit_area_review',
        objectId: reviewId,
        after: {
          sectionVersion: areaReviewVersionLabel(rec.versionNo),
          libraryVersion: rec.libraryVersion,
          aa01: true,
          ...summary.completeness,
        },
      });
      const leads = await this.leads(client, engagementId);
      await notifyPlanning(client, [leads.partnerId], {
        type: NOTIFICATION_TYPE.planningAreasReview,
        title: `03.5 Audit Areas & Assertions ${areaReviewVersionLabel(rec.versionNo)} completed`,
        body: `${summary.completeness.retained} retained / ${summary.completeness.removed} removed areas — the matrix is ready for your review.`,
        engagementId,
        objectType: 'audit_area_review',
        objectId: reviewId,
        dedup: `areas-complete:${reviewId}:${rec.versionNo}`,
        except: ctx.employeeId ?? null,
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  /** Reopen a completed / update-required section as the next version (§25/§26). */
  async reopen(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: ReopenAreaReviewInput,
  ): Promise<AuditAreaReviewSummary> {
    const reason = clean(input.reason);
    if (!reason) throw new BadRequestException('Reopening 03.5 needs a reason.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      assertAreaCapability(await resolveAreaAccess(client, engagementId), 'complete');
      await this.lockReview(client, wi);
      const ws = await this.workspace(client, wi);
      const rec = ws.record;
      if (!rec || rec.status === 'in_progress') {
        throw new ConflictException(
          'Only a completed 03.5 is reopened; edit the current review instead.',
        );
      }
      // Impacted areas carry Requires Review into the new version (VAL-09).
      // One statement; the first impact naming an area wins (as the old per-row loop did).
      const flagged = new Map<string, { message: string; kind: string }>();
      for (const imp of ws.impacts) {
        for (const areaId of imp.areaIds) {
          if (!flagged.has(areaId)) flagged.set(areaId, { message: imp.message, kind: imp.kind });
        }
      }
      if (flagged.size) {
        const ids = [...flagged.keys()];
        await client.query(
          `UPDATE hsdg.audit_engagement_area a
              SET review_flag = f.message, review_flag_source = f.kind, version = a.version + 1
             FROM unnest($1::uuid[], $2::text[], $3::text[]) AS f(id, message, kind)
            WHERE a.id = f.id AND a.review_flag IS NULL`,
          [ids, ids.map((i) => flagged.get(i)!.message), ids.map((i) => flagged.get(i)!.kind)],
        );
      }
      const nextNo = rec.versionNo + 1;
      await client.query(
        `UPDATE hsdg.audit_area_review
            SET status = 'in_progress', version_no = $2, reopen_reason = $3,
                completed_by_employee_id = NULL, completed_at = NULL, version = version + 1
          WHERE id = $1`,
        [rec.id, nextNo, reason],
      );
      await this.rollUp(client, ctx, wi, 'in_progress');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_review_reopened',
        objectType: 'audit_area_review',
        objectId: rec.id,
        before: { sectionVersion: rec.versionLabel, status: rec.status },
        after: {
          sectionVersion: areaReviewVersionLabel(nextNo),
          reason,
          impacts: ws.impacts.map((i) => i.message),
        },
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  /** §3 / AT-18 — controlled refresh to the current library version. */
  async applyMethodologyUpdate(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(client, ctx, engagementId, wi, 'complete');
      const ws = await this.workspace(client, wi);
      const current = await this.currentLibraryVersion(client);
      if (!current || current === ws.record!.libraryVersion) {
        throw new ConflictException('The engagement already uses the current Audit Area Library.');
      }
      const next = applicableLibrary(
        await this.readLibrary(client, current),
        ws.facts.profile,
        ws.periodEnd,
      );
      const fresh = next.filter((lib) => !ws.stored.some((a) => a.areaCode === lib.areaCode));
      await this.insertLibraryAreas(
        client,
        ctx,
        engagementId,
        reviewId,
        fresh,
        'methodology_refresh',
        `Added by methodology update ${current} — review.`,
        ws.facts,
      );
      const added = fresh.map((l) => l.areaName);
      const withdrawn: string[] = [];
      for (const a of ws.stored.filter((x) => x.source === 'library')) {
        if (next.some((l) => l.areaCode === a.areaCode)) continue;
        await client.query(
          `UPDATE hsdg.audit_engagement_area SET review_flag = $2, review_flag_source = 'methodology_refresh',
                  version = version + 1 WHERE id = $1 AND review_flag IS NULL`,
          [a.id, `No longer in the applicable library ${current} — review whether to retain.`],
        );
        withdrawn.push(a.areaName);
      }
      await client.query(
        `UPDATE hsdg.audit_area_review SET library_version = $2, version = version + 1 WHERE id = $1`,
        [reviewId, current],
      );
      await this.rollUp(client, ctx, wi, 'in_progress');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_methodology_refreshed',
        objectType: 'audit_area_review',
        objectId: reviewId,
        before: { libraryVersion: ws.record!.libraryVersion },
        after: { libraryVersion: current, added, withdrawn },
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  // ── §27 Partner review comments ──────────────────────────────────────────

  async addComment(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: AreaCommentInput,
  ): Promise<AuditAreaReviewSummary> {
    const body = clean(input.body);
    if (!body) throw new BadRequestException('Write the comment.');
    if (input.kind === 'downstream_request') {
      throw new BadRequestException(
        'Ask for a missing area with "Request an area" (it names the area and the risk).',
      );
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      const access = await resolveAreaAccess(client, engagementId);
      // §27 — the EP comments, challenges and requests reassessment; the
      // preparer may leave a plain comment.
      if (input.kind !== 'comment' || !access.capabilities.prepare) {
        assertAreaCapability(access, 'partnerReview');
      }
      const ws = await this.workspace(client, wi);
      if (!ws.record) throw new ConflictException('03.5 has not been started on this audit file.');
      const target = input.areaId ? this.area(ws, input.areaId) : null;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_area_review_comment (review_id, engagement_id, area_id, kind, body, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          ws.record.id,
          engagementId,
          input.areaId ?? null,
          input.kind,
          body,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_comment_added',
        objectType: 'audit_area_review',
        objectId: ws.record.id,
        after: { commentId: rows[0]!.id, kind: input.kind, areaId: input.areaId ?? null, body },
      });
      const what = KIND_NOUN[input.kind];
      const on = target ? ` on ${target.areaName}` : '';
      // §25 — a reassessment request on a completed 03.5 makes it Update Required.
      const flagged =
        input.kind === 'reassessment_request' && ws.record.status === 'complete'
          ? await this.flagUpdateRequired(
              client,
              ws.record.id,
              `Engagement Partner requested reassessment${on}: ${body}`,
            )
          : false;
      await this.notifyPreparers(client, engagementId, ws.record.id, {
        type: flagged
          ? NOTIFICATION_TYPE.planningAreasUpdateRequired
          : NOTIFICATION_TYPE.planningAreasReview,
        title: `03.5 — ${what}${on}`,
        body,
        dedup: `areas-comment:${rows[0]!.id}`,
        except: ctx.employeeId ?? null,
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  async respondComment(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    commentId: string,
    input: RespondAreaCommentInput,
  ): Promise<AuditAreaReviewSummary> {
    const response = clean(input.response);
    if (!response) throw new BadRequestException('Write the response.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      assertAreaCapability(await resolveAreaAccess(client, engagementId), 'respond');
      const { rows: found } = await client.query<{
        kind: AreaCommentKind;
        created_by_employee_id: string | null;
        source_risk_id: string | null;
        proposed_area_name: string | null;
      }>(
        `SELECT c.kind, c.created_by_employee_id, c.source_risk_id, c.proposed_area_name
           FROM hsdg.audit_area_review_comment c
           JOIN hsdg.audit_area_review r ON r.id = c.review_id
          WHERE c.id = $1 AND r.workflow_instance_id = $2 AND c.status = 'open'
          FOR UPDATE OF c`,
        [commentId, wi],
      );
      const comment = found[0];
      if (!comment) throw new NotFoundException('Open comment not found on this audit file.');
      let resolved: { id: string; name: string } | null = null;
      if (input.resolvedAreaId) {
        if (comment.kind !== 'downstream_request') {
          throw new BadRequestException('Only an area request is answered with an Audit Area.');
        }
        const { rows: a } = await client.query<{ id: string; area_name: string }>(
          `SELECT a.id, a.area_name FROM hsdg.audit_engagement_area a
             JOIN hsdg.audit_area_review r ON r.id = a.review_id
            WHERE a.id = $1 AND r.workflow_instance_id = $2 AND a.disposition = 'retained'`,
          [input.resolvedAreaId, wi],
        );
        if (!a[0]) throw new BadRequestException('Answer the request with a retained Audit Area.');
        resolved = { id: a[0].id, name: a[0].area_name };
      }
      await client.query(
        `UPDATE hsdg.audit_area_review_comment
            SET status = 'addressed', response = $2, responded_by_employee_id = $3,
                responded_at = now(), resolved_area_id = $4, version = version + 1
          WHERE id = $1`,
        [commentId, response, ctx.employeeId ?? null, resolved?.id ?? null],
      );
      // §24 — the requesting risk now sits in the area that answers it.
      let riskLinked = false;
      if (resolved && comment.source_risk_id) {
        const { rowCount } = await client.query(
          `UPDATE hsdg.audit_risks SET audit_area_id = $2, fs_area = COALESCE(fs_area, $3),
                  version = version + 1
            WHERE id = $1 AND workflow_instance_id = $4 AND audit_area_id IS NULL`,
          [comment.source_risk_id, resolved.id, resolved.name, wi],
        );
        riskLinked = !!rowCount;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_comment_addressed',
        objectType: 'audit_area_review_comment',
        objectId: commentId,
        after: {
          response,
          kind: comment.kind,
          resolvedAreaId: resolved?.id ?? null,
          riskLinked,
        },
      });
      await notifyPlanning(client, [comment.created_by_employee_id], {
        type: NOTIFICATION_TYPE.planningAreasReview,
        title:
          comment.kind === 'downstream_request'
            ? `03.5 answered your area request "${comment.proposed_area_name}"`
            : `03.5 — the Manager answered your ${KIND_NOUN[comment.kind].toLowerCase()}`,
        body: resolved ? `${response} (Audit Area: ${resolved.name})` : response,
        engagementId,
        objectType: 'audit_area_review_comment',
        objectId: commentId,
        dedup: `areas-answer:${commentId}`,
        except: ctx.employeeId ?? null,
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  /**
   * §25 "03.6 identifies an affected area not present → allow return / addition
   * to 03.5". Any team member (typically from the risk register) names the
   * missing area; 03.5 shows it as an open review item (VAL-09) and a
   * completed 03.5 becomes Update Required. The Manager answers it by adding /
   * restoring the area and responding with it (the risk is then linked).
   */
  async requestArea(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: DownstreamAreaRequestInput,
  ): Promise<AuditAreaReviewSummary> {
    const name = clean(input.proposedAreaName);
    const reason = clean(input.reason);
    if (!name || !reason) {
      throw new BadRequestException(
        'Name the Audit Area needed and why the risk assessment needs it.',
      );
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      assertAreaCapability(await resolveAreaAccess(client, engagementId), 'requestArea');
      const { rows: rv } = await client.query<{ id: string; status: StoredAreaReviewStatus }>(
        `SELECT id, status FROM hsdg.audit_area_review WHERE workflow_instance_id = $1`,
        [wi],
      );
      const review = rv[0];
      if (!review) {
        throw new ConflictException(
          '03.5 has not been started on this audit file — the Manager populates it first.',
        );
      }
      if (input.riskId) {
        const { rowCount } = await client.query(
          `SELECT 1 FROM hsdg.audit_risks WHERE id = $1 AND workflow_instance_id = $2`,
          [input.riskId, wi],
        );
        if (!rowCount) throw new BadRequestException('That risk is not on this audit file.');
      }
      const { rows: dup } = await client.query<{ area_name: string }>(
        `SELECT area_name FROM hsdg.audit_engagement_area
          WHERE review_id = $1 AND disposition = 'retained' AND lower(area_name) = lower($2)`,
        [review.id, name],
      );
      if (dup[0]) {
        throw new ConflictException(
          `${dup[0].area_name} is already a retained Audit Area — link the risk to it instead.`,
        );
      }
      // One open request per area name — a second risk joins the existing one.
      const { rows: pending } = await client.query<{ proposed_area_name: string }>(
        `SELECT proposed_area_name FROM hsdg.audit_area_review_comment
          WHERE review_id = $1 AND kind = 'downstream_request' AND status = 'open'
            AND lower(proposed_area_name) = lower($2)`,
        [review.id, name],
      );
      if (pending[0]) {
        throw new ConflictException(
          `"${pending[0].proposed_area_name}" is already requested and awaiting the Manager's answer.`,
        );
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_area_review_comment
           (review_id, engagement_id, kind, body, proposed_area_name, source_module, source_risk_id,
            created_by_employee_id)
         VALUES ($1, $2, 'downstream_request', $3, $4, $5, $6, hsdg.ctx_employee_id()) RETURNING id`,
        [
          review.id,
          engagementId,
          reason,
          name,
          input.riskId ? 'section_04' : '03.6',
          input.riskId ?? null,
        ],
      );
      const flagged =
        review.status === 'complete'
          ? await this.flagUpdateRequired(
              client,
              review.id,
              `The risk assessment needs an Audit Area not in 03.5: "${name}" — ${reason}`,
            )
          : false;
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_requested',
        objectType: 'audit_area_review',
        objectId: review.id,
        after: {
          commentId: rows[0]!.id,
          proposedAreaName: name,
          reason,
          riskId: input.riskId ?? null,
        },
      });
      await this.notifyPreparers(client, engagementId, review.id, {
        type: flagged
          ? NOTIFICATION_TYPE.planningAreasUpdateRequired
          : NOTIFICATION_TYPE.planningAreasReview,
        title: `03.5 — the risk assessment asks for "${name}"`,
        body: reason,
        dedup: `areas-request:${rows[0]!.id}`,
        except: ctx.employeeId ?? null,
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  // ── §27 Senior / Article authorisation ───────────────────────────────────

  async grantPermission(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    input: GrantAreaPermissionInput,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      assertAreaCapability(await resolveAreaAccess(client, engagementId), 'manageGrants');
      const candidates = await this.grantCandidates(client, engagementId);
      const who = candidates.find((c) => c.employeeId === input.employeeId);
      if (!who) {
        throw new BadRequestException(
          'Authorise a Senior / Article on this engagement team (the EP and Manager need no grant).',
        );
      }
      const note = clean(input.note);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_area_review_permission
           (engagement_id, employee_id, level, note, granted_by_employee_id)
         VALUES ($1, $2, $3, $4, hsdg.ctx_employee_id())
         ON CONFLICT (engagement_id, employee_id) DO UPDATE
           SET level = EXCLUDED.level, note = EXCLUDED.note,
               granted_by_employee_id = EXCLUDED.granted_by_employee_id, granted_at = now()
         RETURNING id`,
        [engagementId, input.employeeId, input.level, note],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_permission_granted',
        objectType: 'audit_area_review_permission',
        objectId: rows[0]!.id,
        after: { employeeId: input.employeeId, name: who.name, level: input.level, note },
      });
      await notifyPlanning(client, [input.employeeId], {
        type: NOTIFICATION_TYPE.planningAreasReview,
        title: `03.5 Audit Areas & Assertions — ${AREA_PERMISSION_LEVEL_LABEL[input.level]}`,
        body: note ?? 'The Engagement Manager authorised you on 03.5 for this engagement.',
        engagementId,
        objectType: 'audit_area_review_permission',
        objectId: rows[0]!.id,
        dedup: `areas-grant:${rows[0]!.id}:${input.level}`,
        except: ctx.employeeId ?? null,
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  async revokePermission(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    grantId: string,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      assertAreaCapability(await resolveAreaAccess(client, engagementId), 'manageGrants');
      const { rows } = await client.query<{ employee_id: string; level: string }>(
        `DELETE FROM hsdg.audit_area_review_permission WHERE id = $1 AND engagement_id = $2
         RETURNING employee_id, level`,
        [grantId, engagementId],
      );
      if (!rows[0])
        throw new NotFoundException('That 03.5 authorisation is not on this engagement.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_permission_revoked',
        objectType: 'audit_area_review_permission',
        objectId: grantId,
        before: { employeeId: rows[0].employee_id, level: rows[0].level },
      });
      return this.buildSummary(client, engagementId, wi);
    });
  }

  /**
   * The retained 03.5 areas as Section 05 / 06 reads them — names, attention,
   * live figures and active assertions — so the audit work never re-keys them.
   */
  async retainedForWork(
    client: PoolClient,
    wi: string,
  ): Promise<{ areas: EngagementAuditArea[]; datasetUnit: FinancialUnit | null }> {
    const ws = await this.workspace(client, wi);
    const datasetUnit = ws.facts.datasetUnit ?? null;
    if (!ws.record) return { areas: [], datasetUnit };
    // §23 — once AA-01 has generated a matrix, the work follows the latest
    // APPROVED matrix (a reopened draft changes nothing downstream until it is
    // completed again); before that, the live retained population.
    const { rows } = await client.query<{ matrix: AreaMatrixVersion['rows'] }>(
      `SELECT matrix FROM hsdg.audit_area_matrix_version
        WHERE review_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [ws.record.id],
    );
    const approved = rows[0]?.matrix;
    if (!approved) {
      return { areas: ws.areas.filter((a) => a.disposition === 'retained'), datasetUnit };
    }
    const byId = new Map(approved.map((r) => [r.areaId, r]));
    return {
      areas: ws.areas
        .filter((a) => byId.has(a.id))
        .map((a) => {
          const row = byId.get(a.id)!;
          const active = new Set(row.assertions.map((x) => x.assertionId));
          return {
            ...a,
            attention: row.attention,
            assertions: a.assertions.map((x) => ({ ...x, active: active.has(x.assertionId) })),
          };
        }),
      datasetUnit,
    };
  }

  /**
   * §25 hook for upstream modules (03.2 figures, 03.3, 03.1 signals, Section
   * 02): a completed 03.5 whose completeness is affected becomes Update
   * Required — never silently changed. Cheap when 03.5 is not complete.
   */
  async markImpacted(client: PoolClient, wi: string): Promise<void> {
    const { rows } = await client.query<{ id: string; status: StoredAreaReviewStatus }>(
      `SELECT id, status FROM hsdg.audit_area_review WHERE workflow_instance_id = $1`,
      [wi],
    );
    if (rows[0]?.status !== 'complete') return;
    const ws = await this.workspace(client, wi);
    if (!ws.impacts.length) return;
    await this.flagUpdateRequired(client, rows[0].id, ws.impacts.map((i) => i.message).join(' '));
  }

  // ── internals ───────────────────────────────────────────────────────────

  private area(ws: Workspace, areaId: string): EngagementAuditArea {
    const a = ws.areas.find((x) => x.id === areaId);
    if (!a) throw new NotFoundException('Audit Area not found on this audit file.');
    return a;
  }

  private checkVersion(current: number, given: number): void {
    if (given !== current)
      throw new ConflictException('Changed since you loaded it; refresh and retry.');
  }

  private async editable(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    capability: keyof AreaReviewCapabilities = 'prepare',
  ): Promise<string> {
    await assertShell(client, engagementId, wi);
    assertAreaCapability(await resolveAreaAccess(client, engagementId), capability);
    const id = await this.ensure(client, ctx, engagementId, wi);
    const { rows } = await client.query<{ status: StoredAreaReviewStatus; version_no: number }>(
      `SELECT status, version_no FROM hsdg.audit_area_review WHERE id = $1`,
      [id],
    );
    const st = rows[0]!.status;
    if (st !== 'in_progress') {
      throw new ConflictException(
        st === 'complete'
          ? `03.5 ${areaReviewVersionLabel(rows[0]!.version_no)} is complete. Reopen it to change a decision — the approved matrix is never overwritten.`
          : '03.5 is Update Required — reopen it to review the impacted decisions.',
      );
    }
    return id;
  }

  private async touched(
    client: PoolClient,
    ctx: RlsContext,
    wi: string,
    reviewId: string,
  ): Promise<void> {
    await client.query(`UPDATE hsdg.audit_area_review SET version = version + 1 WHERE id = $1`, [
      reviewId,
    ]);
    await this.rollUp(client, ctx, wi, 'in_progress');
    // A new / restored area may be the one a 03.4 map area was waiting for.
    await linkScopeMap(client, wi);
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
        WHERE workflow_instance_id = $1 AND item_key = $2 AND state <> $3`,
      [wi, AREA_ITEM_KEY, state, ctx.employeeId ?? null],
    );
  }

  /**
   * complete → update_required (+ the 03 checklist row), via the definer
   * function so a team member's request or a non-lead's upstream change can
   * flag it. Notifies the preparers once per transition.
   */
  private async flagUpdateRequired(
    client: PoolClient,
    reviewId: string,
    reason: string,
  ): Promise<boolean> {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT hsdg.flag_area_review_update_required($1, $2) AS ok`,
      [reviewId, reason],
    );
    if (!rows[0]?.ok) return false;
    const { rows: rv } = await client.query<{ engagement_id: string; version_no: number }>(
      `SELECT engagement_id, version_no FROM hsdg.audit_area_review WHERE id = $1`,
      [reviewId],
    );
    if (rv[0]) {
      await this.notifyPreparers(client, rv[0].engagement_id, reviewId, {
        type: NOTIFICATION_TYPE.planningAreasUpdateRequired,
        title: `03.5 ${areaReviewVersionLabel(rv[0].version_no)} is Update Required`,
        body: reason,
        dedup: `areas-update:${reviewId}:${rv[0].version_no}`,
        except: null,
      });
    }
    return true;
  }

  private async leads(
    client: PoolClient,
    engagementId: string,
  ): Promise<{ partnerId: string | null; managerId: string | null }> {
    const { rows } = await client.query<{ partner_id: string | null; manager_id: string | null }>(
      `SELECT engagement_partner_id AS partner_id, engagement_manager_id AS manager_id
         FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    return { partnerId: rows[0]?.partner_id ?? null, managerId: rows[0]?.manager_id ?? null };
  }

  /** The Manager (else the EP acting as Manager) and Manager-equivalent grant holders. */
  private async notifyPreparers(
    client: PoolClient,
    engagementId: string,
    reviewId: string,
    n: { type: string; title: string; body: string; dedup: string; except: string | null },
  ): Promise<void> {
    const leads = await this.leads(client, engagementId);
    const { rows } = await client.query<{ employee_id: string }>(
      `SELECT employee_id FROM hsdg.audit_area_review_permission
        WHERE engagement_id = $1 AND level = 'manager_equivalent'`,
      [engagementId],
    );
    await notifyPlanning(
      client,
      [leads.managerId ?? leads.partnerId, ...rows.map((r) => r.employee_id)],
      { ...n, engagementId, objectType: 'audit_area_review', objectId: reviewId },
    );
  }

  /** New engagements are populated from the latest RELEASED library (drafts never). */
  private async currentLibraryVersion(client: PoolClient): Promise<string | null> {
    const { rows } = await client.query<{ library_version: string }>(
      `SELECT library_version FROM hsdg.audit_area_library_release
        WHERE status = 'released' ORDER BY released_at DESC, library_version DESC LIMIT 1`,
    );
    return rows[0]?.library_version ?? null;
  }

  private async readLibrary(client: PoolClient, version: string): Promise<LibraryRow[]> {
    const { rows } = await client.query<Row>(
      `SELECT * FROM hsdg.audit_area_library WHERE library_version = $1 ORDER BY sort_order`,
      [version],
    );
    return rows.map((r) => ({
      id: String(r.id),
      libraryVersion: String(r.library_version),
      areaCode: String(r.area_code),
      areaName: String(r.area_name),
      areaType: r.area_type as LibraryRow['areaType'],
      category: r.category as LibraryRow['category'],
      frameworkProfile: r.framework_profile as LibraryRow['frameworkProfile'],
      industryProfile: String(r.industry_profile),
      conditionKey: (r.condition_key as LibraryRow['conditionKey']) ?? null,
      defaultAssertions: arr<AssertionId>(r.default_assertions),
      nonAssertionWorkstream: r.non_assertion_workstream === true,
      defaultAttention: r.default_attention as LibraryRow['defaultAttention'],
      relatedAuthorities: arr(r.related_authorities),
      signalMappingTags: arr(r.signal_mapping_tags),
      metricKeys: arr(r.metric_keys),
      indicatorTags: arr(r.indicator_tags),
      assertionAttentionRules: arr<AttentionRule>(r.assertion_attention_rules),
      aliases: arr(r.aliases),
      effectiveFrom: (iso(r.effective_from) ?? '').slice(0, 10),
      effectiveTo: r.effective_to ? (iso(r.effective_to) ?? '').slice(0, 10) : null,
      active: r.active === true,
      sortOrder: Number(r.sort_order),
    }));
  }

  /** Creates the review + complete applicable population once (§3, AT-01/AT-02). */
  private async lockReview(client: PoolClient, wi: string): Promise<string | null> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.audit_area_review WHERE workflow_instance_id = $1 FOR UPDATE`,
      [wi],
    );
    if (rows[0]) return rows[0].id;
    // RLS applies the UPDATE policy to FOR UPDATE, hiding the row from non-leads;
    // they still get a plain read (their writes are refused by RLS as before).
    const { rows: seen } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.audit_area_review WHERE workflow_instance_id = $1`,
      [wi],
    );
    return seen[0]?.id ?? null;
  }

  private async ensure(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    wi: string,
  ): Promise<string> {
    // Row lock serialises every mutation of this review, so the read-then-compare
    // version checks in the callers cannot interleave (no lost updates).
    const existing = await this.lockReview(client, wi);
    if (existing) return existing;
    const version = await this.currentLibraryVersion(client);
    if (!version) throw new ConflictException('No DHVAJ Audit Area Library has been released.');
    const { facts, periodEnd } = await this.readFacts(client, wi);
    const population = applicableLibrary(
      await this.readLibrary(client, version),
      facts.profile,
      periodEnd,
    );
    const { rows: ins } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_area_review
         (workflow_instance_id, engagement_id, library_version, library_profile, initial_population_count,
          created_by_employee_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (workflow_instance_id) DO NOTHING RETURNING id`,
      [
        wi,
        engagementId,
        version,
        JSON.stringify(facts.profile),
        population.length,
        ctx.employeeId ?? null,
      ],
    );
    if (!ins[0]) return (await this.lockReview(client, wi))!;
    const id = ins[0].id;
    await this.insertLibraryAreas(
      client,
      ctx,
      engagementId,
      id,
      population,
      'population',
      null,
      facts,
    );
    await this.rollUp(client, ctx, wi, 'in_progress');
    await linkScopeMap(client, wi);
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.audit_area_population_created',
      objectType: 'audit_area_review',
      objectId: id,
      after: { libraryVersion: version, profile: facts.profile, areas: population.length },
    });
    return id;
  }

  /**
   * Inserts library areas with their default assertions, auto-suggested signal
   * / specific-materiality links and §14/§17 attention suggestions — a fixed
   * number of statements however large the population (was ~10 per area).
   * Returns library id → engagement area id.
   */
  private async insertLibraryAreas(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    reviewId: string,
    libs: LibraryRow[],
    origin: 'population' | 'added_from_library' | 'methodology_refresh',
    reviewFlag: string | null,
    facts: AreaFacts,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!libs.length) return out;
    const { rows } = await client.query<{ id: string; lib_id: string }>(
      `INSERT INTO hsdg.audit_engagement_area
         (review_id, engagement_id, seq, source, source_audit_area_id, area_code, library_version, origin,
          area_name, area_type, attention, review_flag, review_flag_source,
          created_by_employee_id, updated_by_employee_id)
       SELECT $1, $2, base.n + x.ord, 'library', x.lib_id, x.code, x.ver, $3, x.name, x.type, x.att,
              $4, $5, $6, $6
         FROM (SELECT COALESCE(MAX(seq), 0) AS n FROM hsdg.audit_engagement_area WHERE review_id = $1) base,
              unnest($7::uuid[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[])
                WITH ORDINALITY AS x(lib_id, code, ver, name, type, att, ord)
       RETURNING id, source_audit_area_id AS lib_id`,
      [
        reviewId,
        engagementId,
        origin,
        reviewFlag,
        reviewFlag ? 'methodology_refresh' : null,
        ctx.employeeId ?? null,
        libs.map((l) => l.id),
        libs.map((l) => l.areaCode),
        libs.map((l) => l.libraryVersion),
        libs.map((l) => l.areaName),
        libs.map((l) => l.areaType),
        libs.map((l) => l.defaultAttention),
      ],
    );
    for (const r of rows) out.set(r.lib_id, r.id);

    const pairs = (f: (lib: LibraryRow) => string[]) => {
      const ids: string[] = [];
      const vals: string[] = [];
      for (const lib of libs) {
        for (const v of f(lib)) {
          ids.push(out.get(lib.id)!);
          vals.push(v);
        }
      }
      return [ids, vals] as const;
    };
    const [asrAreas, asrIds] = pairs((l) => l.defaultAssertions);
    if (asrAreas.length) {
      await client.query(
        `INSERT INTO hsdg.audit_area_assertion (area_id, engagement_id, assertion_id, origin)
         SELECT x.area_id, $1, x.assertion_id, 'suggested'
           FROM unnest($2::uuid[], $3::text[]) AS x(area_id, assertion_id)
         ON CONFLICT (area_id, assertion_id) DO NOTHING`,
        [engagementId, asrAreas, asrIds],
      );
    }
    const linkedByLib = new Map(libs.map((l) => [l.id, suggestSignals(l, facts.signals)]));
    const [sigAreas, sigIds] = pairs((l) => linkedByLib.get(l.id)!);
    if (sigAreas.length) {
      await client.query(
        `INSERT INTO hsdg.audit_area_signal_link (area_id, engagement_id, signal_id, origin)
         SELECT x.area_id, $1, x.signal_id, 'auto'
           FROM unnest($2::uuid[], $3::uuid[]) AS x(area_id, signal_id)
         ON CONFLICT DO NOTHING`,
        [engagementId, sigAreas, sigIds],
      );
    }
    const specByLib = new Map(
      libs.map((l) => [
        l.id,
        facts.specific.filter((x) => specificMatchesArea(x, l)).map((x) => x.key),
      ]),
    );
    const [spAreas, spKeys] = pairs((l) => specByLib.get(l.id)!);
    if (spAreas.length) {
      await client.query(
        `INSERT INTO hsdg.audit_area_specific_link (area_id, engagement_id, specific_key, origin)
         SELECT x.area_id, $1, x.specific_key, 'auto'
           FROM unnest($2::uuid[], $3::text[]) AS x(area_id, specific_key)
         ON CONFLICT DO NOTHING`,
        [engagementId, spAreas, spKeys],
      );
    }
    // §14 / §17 suggestions, decided in memory from the links just made.
    const enhance: string[] = [];
    const sugAreas: string[] = [];
    const sugIds: string[] = [];
    const sugBasis: string[] = [];
    for (const lib of libs) {
      const areaId = out.get(lib.id)!;
      const ids = new Set(linkedByLib.get(lib.id));
      const linked = facts.signals.filter((x) => ids.has(x.id));
      if (linked.some((x) => x.attention !== 'standard') || specByLib.get(lib.id)!.length) {
        enhance.push(areaId);
      }
      for (const [assertionId, basis] of assertionSuggestions(
        lib.assertionAttentionRules,
        linked,
      )) {
        sugAreas.push(areaId);
        sugIds.push(assertionId);
        sugBasis.push(basis);
      }
    }
    if (enhance.length) {
      await client.query(
        `UPDATE hsdg.audit_engagement_area SET attention = 'enhanced', attention_source = 'portal',
                version = version + 1
          WHERE id = ANY($1::uuid[]) AND attention = 'standard' AND attention_source = 'default'`,
        [enhance],
      );
    }
    if (sugAreas.length) {
      await client.query(
        `UPDATE hsdg.audit_area_assertion t
            SET suggested_attention = 'enhanced', suggestion_basis = x.basis, attention = 'enhanced',
                version = t.version + 1
           FROM unnest($1::uuid[], $2::text[], $3::text[]) AS x(area_id, assertion_id, basis)
          WHERE t.area_id = x.area_id AND t.assertion_id = x.assertion_id AND t.active
            AND t.suggested_attention IS NULL`,
        [sugAreas, sugIds, sugBasis],
      );
    }
    return out;
  }

  private async insertDefaultAssertions(
    client: PoolClient,
    areaId: string,
    engagementId: string,
    lib: LibraryRow,
  ) {
    for (const a of lib.defaultAssertions) {
      await client.query(
        `INSERT INTO hsdg.audit_area_assertion (area_id, engagement_id, assertion_id, origin)
         VALUES ($1, $2, $3, 'suggested') ON CONFLICT (area_id, assertion_id) DO NOTHING`,
        [areaId, engagementId, a],
      );
    }
  }

  private async applySuggestions(client: PoolClient, ws: Workspace, areaId: string): Promise<void> {
    const a = ws.stored.find((x) => x.id === areaId);
    const lib = a?.sourceAuditAreaId
      ? (ws.library.find((l) => l.id === a.sourceAuditAreaId) ?? null)
      : null;
    await this.applySuggestionsFor(client, areaId, lib, ws.facts);
  }

  /**
   * §14/§17 portal suggestions: Enhanced Attention on the area when an
   * Enhanced / Immediate signal or specific materiality is linked, and on the
   * assertions a §17 scenario maps to. Applied once per new suggestion; the
   * Manager may change it (a downgrade needs a reason). Never overrides a
   * Manager-set attention.
   */
  private async applySuggestionsFor(
    client: PoolClient,
    areaId: string,
    lib: LibraryRow | null,
    facts: AreaFacts,
  ): Promise<void> {
    const { rows: links } = await client.query<{ signal_id: string }>(
      `SELECT signal_id FROM hsdg.audit_area_signal_link WHERE area_id = $1 AND active`,
      [areaId],
    );
    const { rows: specs } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM hsdg.audit_area_specific_link WHERE area_id = $1 AND active`,
      [areaId],
    );
    const linked = facts.signals.filter((x) => links.some((l) => l.signal_id === x.id));
    if (linked.some((x) => x.attention !== 'standard') || Number(specs[0]?.n ?? 0) > 0) {
      await client.query(
        `UPDATE hsdg.audit_engagement_area SET attention = 'enhanced', attention_source = 'portal', version = version + 1
          WHERE id = $1 AND attention = 'standard' AND attention_source = 'default'`,
        [areaId],
      );
    }
    const suggestions = assertionSuggestions(lib?.assertionAttentionRules ?? [], linked);
    for (const [assertionId, basis] of suggestions) {
      await client.query(
        `UPDATE hsdg.audit_area_assertion
            SET suggested_attention = 'enhanced', suggestion_basis = $3, attention = 'enhanced', version = version + 1
          WHERE area_id = $1 AND assertion_id = $2 AND active AND suggested_attention IS NULL`,
        [areaId, assertionId, basis],
      );
    }
  }

  private async readFacts(
    client: PoolClient,
    wi: string,
  ): Promise<{ facts: AreaFacts; periodEnd: string | null; materialityLabel: string | null }> {
    const one = async <T extends Row>(sql: string): Promise<T | undefined> =>
      (await client.query<T>(sql, [wi])).rows[0];
    const profileRow = await one<Row>(
      `SELECT initial_audit FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
    );
    const frfRow = await one<Row>(
      `SELECT conclusion, facts, system_detail FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = '02.2' ORDER BY updated_at DESC LIMIT 1`,
    );
    const buRow = await one<Row>(
      `SELECT industry_profile FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
    );
    const { rows: fw } = await client.query<{ area_key: string; conclusion: string }>(
      `SELECT area_key, conclusion FROM hsdg.audit_framework_assessments
        WHERE workflow_instance_id = $1 AND conclusion IS NOT NULL`,
      [wi],
    );
    const concl = Object.fromEntries(fw.map((r) => [r.area_key, r.conclusion]));
    const frf = s(frfRow?.conclusion);
    const industry = s(buRow?.industry_profile);
    const frfFacts = (frfRow?.facts ?? {}) as Record<string, unknown>;
    const frfDetail = (frfRow?.system_detail ?? {}) as Record<string, unknown>;
    const firstTime =
      typeof frfFacts.firstTimeAdoption === 'boolean'
        ? frfFacts.firstTimeAdoption
        : frfDetail.firstTimeIndAs === true;
    const profile: AreaLibraryProfile = {
      // 02.2 conclusion first; else the Section 02 "Ind AS / AS" assessment
      // (applicable = Ind AS, not applicable = AS).
      frf:
        frf === 'ind_as'
          ? 'ind_as'
          : frf === 'accounting_standards'
            ? 'as'
            : concl.ind_as_as === 'applicable'
              ? 'ind_as'
              : concl.ind_as_as === 'not_applicable'
                ? 'as'
                : 'unknown',
      // 03.2 industry profile; `generic` is the general corporate library.
      industry: !industry || industry === 'generic' ? GENERAL_CORPORATE_INDUSTRY : industry,
      cfsApplicable: concl.cfs === 'applicable',
      initialAudit: profileRow?.initial_audit === true,
      caroApplicable: concl.caro === 'applicable',
      ifcApplicable: concl.ifc === 'applicable',
      indAsTransition: false,
    };
    profile.indAsTransition = profile.frf === 'ind_as' && firstTime;

    const { header, analytics } = await this.understanding.readFinancialBasis(client, wi);
    const metrics: AreaFacts['metrics'] = {};
    for (const m of analytics.movements) metrics[m.metricKey] = { cy: m.cy, py: m.py };

    const det = await one<Row>(
      `SELECT id, version_no, selected_om FROM hsdg.audit_materiality_determination
        WHERE workflow_instance_id = $1 AND status = 'complete' ORDER BY version_no DESC LIMIT 1`,
    );
    let specific: AreaFacts['specific'] = [];
    if (det) {
      const { rows: sp } = await client.query<Row>(
        `SELECT scope, scope_type, amount, affected_areas FROM hsdg.audit_materiality_specific
          WHERE determination_id = $1 ORDER BY seq`,
        [det.id],
      );
      specific = sp.map((x) => ({
        key: specificKeyOf(String(x.scope)),
        label: String(x.scope),
        scopeType: String(x.scope_type),
        amount: n(x.amount),
        affectedAreas: arr(x.affected_areas),
      }));
    }
    const { rows: signals } = await client.query<Row>(
      `SELECT id, seq, observation, potential_implications, rule_key, attention, status
         FROM hsdg.audit_planning_signal
        WHERE workflow_instance_id = $1 AND manager_assessment IS DISTINCT FROM 'not_relevant'
        ORDER BY seq`,
      [wi],
    );
    return {
      facts: {
        profile,
        caroApplicable: concl.caro === 'applicable',
        metrics,
        datasetUnit: header.units,
        currency: header.currency,
        om: det ? n(det.selected_om) : null,
        specific,
        signals: signals.map((x) => ({
          id: String(x.id),
          code: displayCode('PS', Number(x.seq))!,
          observation: String(x.observation),
          potentialImplications: s(x.potential_implications),
          ruleKey: s(x.rule_key),
          attention: x.attention as PlanningAttention,
          status: String(x.status),
        })),
      },
      periodEnd: header.periodEnd,
      materialityLabel: det ? materialityVersionLabel(Number(det.version_no)) : null,
    };
  }

  private async readRecord(
    client: PoolClient,
    wi: string,
  ): Promise<(AreaReviewRecord & { basis: CompletionBasis | null }) | null> {
    const { rows } = await client.query<Row>(
      `SELECT r.*, cb.full_name AS completed_by_name
         FROM hsdg.audit_area_review r
         LEFT JOIN hsdg.employees cb ON cb.id = r.completed_by_employee_id
        WHERE r.workflow_instance_id = $1`,
      [wi],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r.id),
      versionNo: Number(r.version_no),
      versionLabel: areaReviewVersionLabel(Number(r.version_no)),
      status: r.status as StoredAreaReviewStatus,
      libraryVersion: String(r.library_version),
      libraryProfile: r.library_profile as AreaLibraryProfile,
      initialPopulationCount: Number(r.initial_population_count),
      updateReason: s(r.update_reason),
      reopenReason: s(r.reopen_reason),
      completedByName: s(r.completed_by_name),
      completedAt: iso(r.completed_at),
      version: Number(r.version),
      basis: (r.completion_basis as CompletionBasis | null) ?? null,
    };
  }

  private async readStored(client: PoolClient, reviewId: string): Promise<StoredArea[]> {
    const { rows } = await client.query<Row>(
      `SELECT a.*, rb.full_name AS removed_by_name, po.full_name AS owner_name
         FROM hsdg.audit_engagement_area a
         LEFT JOIN hsdg.employees rb ON rb.id = a.removed_by_employee_id
         LEFT JOIN hsdg.employees po ON po.id = a.planning_owner_employee_id
        WHERE a.review_id = $1 ORDER BY a.seq`,
      [reviewId],
    );
    const ids = rows.map((r) => String(r.id));
    const { rows: asr } = await client.query<Row>(
      `SELECT * FROM hsdg.audit_area_assertion WHERE area_id = ANY($1::uuid[])`,
      [ids],
    );
    const { rows: sig } = await client.query<Row>(
      `SELECT area_id, signal_id, origin, active FROM hsdg.audit_area_signal_link WHERE area_id = ANY($1::uuid[]) ORDER BY created_at`,
      [ids],
    );
    const { rows: spl } = await client.query<Row>(
      `SELECT area_id, specific_key, origin, active FROM hsdg.audit_area_specific_link WHERE area_id = ANY($1::uuid[]) ORDER BY created_at`,
      [ids],
    );
    return rows.map((r) => {
      const id = String(r.id);
      return {
        id,
        seq: Number(r.seq),
        source: r.source as StoredArea['source'],
        origin: r.origin as StoredArea['origin'],
        sourceAuditAreaId: s(r.source_audit_area_id),
        areaCode: s(r.area_code),
        libraryVersion: s(r.library_version),
        areaName: String(r.area_name),
        areaType: r.area_type as StoredArea['areaType'],
        additionReason: s(r.addition_reason),
        disposition: r.disposition as StoredArea['disposition'],
        attention: r.attention as StoredArea['attention'],
        attentionSource: r.attention_source as StoredArea['attentionSource'],
        attentionReason: s(r.attention_reason),
        removalReasonCode: (r.removal_reason_code as StoredArea['removalReasonCode']) ?? null,
        removalReasonText: s(r.removal_reason_text),
        coveredUnderAreaId: s(r.covered_under_area_id),
        removedAt: iso(r.removed_at),
        removedByName: s(r.removed_by_name),
        manualCy: n(r.cy_amount),
        manualPy: n(r.py_amount),
        manualCurrency: s(r.currency),
        manualUnit: (r.unit as FinancialUnit | null) ?? null,
        amountSource: (r.amount_source as StoredArea['amountSource']) ?? null,
        amountNote: s(r.amount_note),
        planningOwnerEmployeeId: s(r.planning_owner_employee_id),
        planningOwnerName: s(r.owner_name),
        reviewFlag: s(r.review_flag),
        reviewFlagSource: s(r.review_flag_source),
        inconsistencyResolution: s(r.inconsistency_resolution),
        scopeMapItemId: s(r.scope_map_item_id),
        version: Number(r.version),
        assertions: asr
          .filter((x) => String(x.area_id) === id)
          .map((x): StoredAssertion => ({
            id: String(x.id),
            assertionId: x.assertion_id as AssertionId,
            origin: x.origin as StoredAssertion['origin'],
            active: x.active === true,
            removalReason: s(x.removal_reason),
            attention: x.attention as StoredAssertion['attention'],
            suggestedAttention:
              (x.suggested_attention as StoredAssertion['suggestedAttention']) ?? null,
            suggestionBasis: s(x.suggestion_basis),
            attentionReason: s(x.attention_reason),
            version: Number(x.version),
          })),
        signalLinks: sig
          .filter((x) => String(x.area_id) === id)
          .map((x) => ({
            signalId: String(x.signal_id),
            origin: x.origin as 'auto' | 'manual',
            active: x.active === true,
          })),
        specificLinks: spl
          .filter((x) => String(x.area_id) === id)
          .map((x) => ({
            specificKey: String(x.specific_key),
            origin: x.origin as 'auto' | 'manual',
            active: x.active === true,
          })),
      };
    });
  }

  /**
   * §20 — prior-year context from last year's 03.5 matrix: the predecessor
   * engagement when one is recorded, else the client's latest earlier-year file.
   */
  private async readPriorYear(client: PoolClient, wi: string): Promise<Map<string, AreaPriorYear>> {
    const prior = await readPriorAuditFile(client, wi);
    const { rows } = prior
      ? await client.query<Row>(
          `SELECT id AS review_id FROM hsdg.audit_area_review WHERE workflow_instance_id = $1 LIMIT 1`,
          [prior.workflowInstanceId],
        )
      : { rows: [] as Row[] };
    const out = new Map<string, AreaPriorYear>();
    if (!rows[0]) return out;
    const { rows: areas } = await client.query<Row>(
      `SELECT a.area_code, a.area_name, a.disposition, a.attention, a.cy_amount, a.unit,
              ARRAY(SELECT x.assertion_id FROM hsdg.audit_area_assertion x WHERE x.area_id = a.id AND x.active) AS assertions
         FROM hsdg.audit_engagement_area a WHERE a.review_id = $1`,
      [rows[0].review_id],
    );
    for (const a of areas) {
      out.set(s(a.area_code) ?? `name:${String(a.area_name).toLowerCase()}`, {
        inPriorMatrix: true,
        retained: a.disposition === 'retained',
        attention: (a.attention as AreaPriorYear['attention']) ?? null,
        assertions: arr(a.assertions),
        cy: n(a.cy_amount),
        unit: s(a.unit),
        matters: [],
      });
    }
    return out;
  }

  /** §20 — this year's 03.1 register of prior-year matters (resolved ones drop out). */
  private async readPriorYearMatters(
    client: PoolClient,
    wi: string,
  ): Promise<AreaPriorYearMatter[]> {
    const { rows } = await client.query<Row>(
      `SELECT id, seq, matter_type, description FROM hsdg.audit_prior_year_matter
        WHERE workflow_instance_id = $1 AND assessment IS DISTINCT FROM 'resolved' ORDER BY seq`,
      [wi],
    );
    return rows.map((r) => ({
      id: String(r.id),
      code: displayCode('PY', Number(r.seq))!,
      matterType: String(r.matter_type),
      description: String(r.description),
    }));
  }

  private async readAuthorities(
    client: PoolClient,
    codes: string[],
  ): Promise<Map<string, AreaAuthorityRef>> {
    const { rows } = await client.query<Row>(
      `SELECT code, title, provision_number FROM hsdg.authority_provision
        WHERE code = ANY($1::text[]) AND effective_to IS NULL`,
      [codes],
    );
    const cat = (code: string): AuthorityCategory =>
      code.startsWith('AS_') || code.startsWith('INDAS_')
        ? 'accounting'
        : code.startsWith('SA_') || code.startsWith('IG_')
          ? 'auditing'
          : code.startsWith('COS_ACT') || code.startsWith('CARO') || code.startsWith('AUDIT_RULE')
            ? 'companies_act_caro'
            : code.startsWith('SCH_III')
              ? 'schedule_iii'
              : 'other';
    return new Map(
      rows.map((r) => [
        String(r.code),
        {
          code: String(r.code),
          label: String(r.provision_number),
          title: String(r.title),
          category: cat(String(r.code)),
        },
      ]),
    );
  }

  private async readAssertionMaster(client: PoolClient): Promise<AssertionMasterItem[]> {
    const { rows } = await client.query<Row>(
      `SELECT id, assertion_group, label FROM hsdg.audit_assertion WHERE active ORDER BY sort_order`,
    );
    return rows.map((r) => ({
      id: r.id as AssertionId,
      group: r.assertion_group as AssertionGroup,
      label: String(r.label),
    }));
  }

  private async workspace(client: PoolClient, wi: string): Promise<Workspace> {
    const { facts, periodEnd, materialityLabel } = await this.readFacts(client, wi);
    const rec = await this.readRecord(client, wi);
    const libVersion = rec?.libraryVersion ?? (await this.currentLibraryVersion(client));
    const library = libVersion ? await this.readLibrary(client, libVersion) : [];
    const stored = rec ? await this.readStored(client, rec.id) : [];
    const master = await this.readAssertionMaster(client);
    const masterMap = new Map(
      master.map((m) => [m.id as string, { group: m.group, label: m.label }]),
    );
    const libById = new Map(library.map((l) => [l.id, l]));
    const py = await this.readPriorYear(client, wi);
    const pyMatters = await this.readPriorYearMatters(client, wi);
    const usage = rec ? await this.readUsage(client, rec.id, wi) : null;
    const authorities = await this.readAuthorities(client, [
      ...new Set(library.flatMap((l) => l.relatedAuthorities)),
    ]);
    const signalById = new Map(facts.signals.map((x) => [x.id, x]));
    const specificByKey = new Map(facts.specific.map((x) => [x.key, x]));
    const areaName = new Map(stored.map((a) => [a.id, a.areaName]));
    const hideFrf =
      facts.profile.frf === 'ind_as' ? 'AS_' : facts.profile.frf === 'as' ? 'INDAS_' : null;

    const areas = stored.map((a) => {
      const lib = a.sourceAuditAreaId ? (libById.get(a.sourceAuditAreaId) ?? null) : null;
      const d = deriveArea(a, {
        facts,
        lib,
        signalById,
        specificByKey,
        areaName,
        priorYear: priorYearFor(
          py.get(a.areaCode ?? `name:${a.areaName.toLowerCase()}`) ?? null,
          pyMatters.filter((m) =>
            textMentionsArea(m.description, {
              areaName: a.areaName,
              areaCode: a.areaCode,
              aliases: lib?.aliases ?? [],
            }),
          ),
        ),
        authorities: (lib?.relatedAuthorities ?? [])
          .filter((c) => !hideFrf || !c.startsWith(hideFrf))
          .map((c) => authorities.get(c))
          .filter((x): x is AreaAuthorityRef => !!x),
        assertionMaster: masterMap,
      });
      if (lib && d.disposition === 'retained') {
        const linkedIds = new Set(a.signalLinks.map((l) => l.signalId));
        d.suggestedSignals = suggestSignals(lib, facts.signals)
          .filter((id) => !linkedIds.has(id))
          .map((id) => signalById.get(id)!)
          .map((x) => ({
            signalId: x.id,
            code: x.code,
            observation: x.observation,
            attention: x.attention,
          }));
      }
      if (d.disposition === 'retained') {
        const keys = new Set(a.specificLinks.map((l) => l.specificKey));
        d.suggestedSpecific = facts.specific
          .filter(
            (x) =>
              !keys.has(x.key) &&
              specificMatchesArea(x, {
                areaName: a.areaName,
                areaCode: a.areaCode,
                aliases: lib?.aliases ?? [],
              }),
          )
          .map((x) => ({ specificKey: x.key, label: x.label }));
      }
      const dw = usage?.downstream.get(a.id);
      if (dw) {
        d.downstreamDetail = dw;
        d.downstreamWork = dw.risks + dw.procedures + dw.workAreas;
      }
      d.evidenceCount = usage?.areaEvidence[a.id] ?? 0;
      return d;
    });
    // 03.4 §23 — the preliminary strategy carried in from the Approach Map.
    const strategies = await readScopeStrategies(
      client,
      stored.flatMap((a) => (a.scopeMapItemId ? [a.scopeMapItemId] : [])),
    );
    for (const [i, a] of stored.entries()) {
      if (a.scopeMapItemId) areas[i]!.scopeStrategy = strategies.get(a.scopeMapItemId) ?? null;
    }
    const resolutions = new Map<string, string>();
    if (rec) {
      const { rows } = await client.query<{ signal_id: string; note: string }>(
        `SELECT signal_id, note FROM hsdg.audit_area_signal_resolution WHERE review_id = $1`,
        [rec.id],
      );
      for (const r of rows) resolutions.set(r.signal_id, r.note);
    }
    const openItems = usage?.openItems(areaName) ?? [];
    const impacts =
      rec && rec.status !== 'in_progress'
        ? assessImpacts(
            rec.basis,
            facts,
            areas,
            applicableLibrary(library, facts.profile, periodEnd),
            { fullLibrary: library, openItems },
          )
        : [];
    return {
      record: rec,
      facts,
      library,
      areas,
      stored,
      resolutions,
      impacts,
      materialityLabel,
      periodEnd,
      master,
      openItems,
      assertionEvidence: usage?.assertionEvidence ?? {},
    };
  }

  /**
   * Per-review usage in three statements: §9.1/§24 downstream references
   * (risks; procedures / work areas only once started — untouched generated
   * work is simply regenerated), §28 evidence counts and the open blocking
   * review items.
   */
  private async readUsage(client: PoolClient, reviewId: string, wi: string) {
    const { rows: dw } = await client.query<{
      area_id: string;
      risks: number;
      procedures: number;
      work_areas: number;
    }>(
      `SELECT a.id AS area_id,
              (SELECT count(*)::int FROM hsdg.audit_risks r WHERE r.audit_area_id = a.id) AS risks,
              (SELECT count(*)::int FROM hsdg.audit_procedures p
                WHERE p.audit_area_id = a.id AND p.state <> 'not_started') AS procedures,
              (SELECT count(*)::int FROM hsdg.audit_work_areas w
                WHERE w.audit_area_id = a.id AND w.is_active AND w.state <> 'not_started') AS work_areas
         FROM hsdg.audit_engagement_area a WHERE a.review_id = $1`,
      [reviewId],
    );
    const { rows: ev } = await client.query<{ target_type: string; target_id: string; n: number }>(
      `SELECT target_type, target_id, count(*)::int AS n FROM hsdg.audit_planning_evidence
        WHERE workflow_instance_id = $1 AND target_type IN ('audit_area', 'area_assertion')
          AND removed_at IS NULL
        GROUP BY target_type, target_id`,
      [wi],
    );
    const { rows: open } = await client.query<{
      id: string;
      kind: OpenReviewItem['kind'];
      area_id: string | null;
      body: string;
      proposed_area_name: string | null;
    }>(
      `SELECT id, kind, area_id, body, proposed_area_name FROM hsdg.audit_area_review_comment
        WHERE review_id = $1 AND status = 'open' AND kind = ANY($2::text[]) ORDER BY created_at`,
      [reviewId, BLOCKING],
    );
    const areaEvidence: Record<string, number> = {};
    const assertionEvidence: Record<string, number> = {};
    for (const r of ev) {
      (r.target_type === 'audit_area' ? areaEvidence : assertionEvidence)[r.target_id] = r.n;
    }
    return {
      downstream: new Map(
        dw.map((r) => [
          r.area_id,
          { risks: r.risks, procedures: r.procedures, workAreas: r.work_areas },
        ]),
      ),
      areaEvidence,
      assertionEvidence,
      openItems: (names: Map<string, string>): OpenReviewItem[] =>
        open.map((c) => {
          const on = c.area_id && names.get(c.area_id) ? ` on ${names.get(c.area_id)}` : '';
          return {
            id: c.id,
            kind: c.kind,
            areaId: c.area_id,
            label:
              c.kind === 'downstream_request'
                ? `Risk assessment asks for "${c.proposed_area_name}" — ${c.body}`
                : `${KIND_NOUN[c.kind]}${on}: ${c.body}`,
          };
        }),
    };
  }

  private async buildSummary(
    client: PoolClient,
    engagementId: string,
    wi: string,
    workspace?: Workspace,
    knownAccess?: AreaReviewAccess,
  ): Promise<AuditAreaReviewSummary> {
    const ws = workspace ?? (await this.workspace(client, wi));
    const access = knownAccess ?? (await resolveAreaAccess(client, engagementId));
    const rec = ws.record;
    const specific = specificMatters(ws.facts, ws.areas);
    const signals = signalRefs(ws.facts, ws.areas, ws.resolutions);
    const checks = rec
      ? validations({
          profile: ws.facts.profile,
          areas: ws.areas,
          specific,
          signals,
          openItems: ws.openItems,
          unconvertedMap: await readUnconvertedMapAreas(client, wi),
        })
      : [];
    const current = await this.currentLibraryVersion(client);
    const initial =
      rec?.initialPopulationCount ??
      applicableLibrary(ws.library, ws.facts.profile, ws.periodEnd).length;
    const present = new Set(ws.stored.map((a) => a.areaCode));
    const availableLibrary: AuditAreaLibraryItem[] = ws.library
      .filter((l) => l.active && !present.has(l.areaCode))
      .map((l) => ({
        id: l.id,
        libraryVersion: l.libraryVersion,
        areaCode: l.areaCode,
        areaName: l.areaName,
        areaType: l.areaType,
        category: l.category,
        conditionKey: l.conditionKey,
        defaultAssertions: l.defaultAssertions,
        aliases: l.aliases,
      }));
    const { rows: scope } = await client.query<{ status: string; version_no: number }>(
      `SELECT status, version_no FROM hsdg.audit_scope_approach WHERE workflow_instance_id = $1`,
      [wi],
    );
    return {
      record: rec ? publicRecord(rec) : null,
      status: sectionStatus(rec?.status ?? null, checks, ws.impacts),
      profile: ws.facts.profile,
      currentLibraryVersion: current,
      methodologyUpdateAvailable: !!rec && !!current && current !== rec.libraryVersion,
      scopeApproachStatus: scope[0] ? scope[0].status : null,
      materiality: ws.materialityLabel
        ? { versionLabel: ws.materialityLabel, overallMateriality: ws.facts.om }
        : null,
      datasetUnit: ws.facts.datasetUnit,
      tiles: tiles(initial, ws.areas),
      areas: ws.areas,
      availableLibrary,
      specificMatters: specific,
      signals,
      validations: checks,
      completeness: completenessSummary(initial, ws.areas, signals),
      matrix: buildMatrix(ws.areas),
      matrixVersions: rec ? await this.readMatrixVersions(client, rec.id) : [],
      impacts: ws.impacts,
      comments: rec ? await this.readComments(client, rec.id, ws.areas) : [],
      assertionMaster: ws.master,
      openReviewItems: ws.openItems.length,
      access,
      grants: await this.readGrants(client, engagementId),
      grantCandidates: access.capabilities.manageGrants
        ? await this.grantCandidates(client, engagementId)
        : [],
      assertionEvidenceCounts: ws.assertionEvidence,
    };
  }

  private async readGrants(client: PoolClient, engagementId: string): Promise<AreaReviewGrant[]> {
    const { rows } = await client.query<Row>(
      `SELECT p.id, p.employee_id, e.full_name AS employee_name, p.level, p.note,
              g.full_name AS granted_by_name, p.granted_at
         FROM hsdg.audit_area_review_permission p
         LEFT JOIN hsdg.employees e ON e.id = p.employee_id
         LEFT JOIN hsdg.employees g ON g.id = p.granted_by_employee_id
        WHERE p.engagement_id = $1 ORDER BY p.granted_at`,
      [engagementId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      employeeId: String(r.employee_id),
      employeeName: s(r.employee_name),
      level: r.level as AreaReviewGrant['level'],
      note: s(r.note),
      grantedByName: s(r.granted_by_name),
      grantedAt: iso(r.granted_at)!,
    }));
  }

  /** Team members other than the EP / Manager (they need no grant). */
  private async grantCandidates(
    client: PoolClient,
    engagementId: string,
  ): Promise<AreaGrantCandidate[]> {
    const { rows } = await client.query<Row>(
      `SELECT t.employee_id, e.full_name, t.role_on_engagement
         FROM hsdg.engagement_team t
         JOIN hsdg.engagements g ON g.id = t.engagement_id
         JOIN hsdg.employees e ON e.id = t.employee_id
        WHERE t.engagement_id = $1
          AND t.employee_id IS DISTINCT FROM g.engagement_partner_id
          AND t.employee_id IS DISTINCT FROM g.engagement_manager_id
        ORDER BY e.full_name`,
      [engagementId],
    );
    return rows.map((r) => ({
      employeeId: String(r.employee_id),
      name: String(r.full_name),
      roleOnEngagement: String(r.role_on_engagement),
    }));
  }

  private async readMatrixVersions(
    client: PoolClient,
    reviewId: string,
  ): Promise<AreaMatrixVersion[]> {
    const { rows } = await client.query<Row>(
      `SELECT m.*, e.full_name AS confirmed_by_name FROM hsdg.audit_area_matrix_version m
         LEFT JOIN hsdg.employees e ON e.id = m.confirmed_by_employee_id
        WHERE m.review_id = $1 ORDER BY m.version_no DESC`,
      [reviewId],
    );
    return rows.map((r) => ({
      versionNo: Number(r.version_no),
      versionLabel: areaReviewVersionLabel(Number(r.version_no)),
      libraryVersion: String(r.library_version),
      confirmedAt: iso(r.confirmed_at)!,
      confirmedByName: s(r.confirmed_by_name),
      rows: r.matrix as AreaMatrixVersion['rows'],
      summary: r.summary as AreaMatrixVersion['summary'],
    }));
  }

  private async readComments(
    client: PoolClient,
    reviewId: string,
    areas: EngagementAuditArea[],
  ): Promise<AreaReviewComment[]> {
    const { rows } = await client.query<Row>(
      `SELECT c.*, e.full_name AS created_by_name, rb.full_name AS responded_by_name
         FROM hsdg.audit_area_review_comment c
         LEFT JOIN hsdg.employees e ON e.id = c.created_by_employee_id
         LEFT JOIN hsdg.employees rb ON rb.id = c.responded_by_employee_id
        WHERE c.review_id = $1 ORDER BY c.created_at`,
      [reviewId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      areaId: s(r.area_id),
      areaName: r.area_id ? (areas.find((a) => a.id === r.area_id)?.areaName ?? null) : null,
      kind: r.kind as AreaReviewComment['kind'],
      body: String(r.body),
      status: r.status as AreaReviewComment['status'],
      response: s(r.response),
      createdByName: s(r.created_by_name),
      createdAt: iso(r.created_at)!,
      respondedByName: s(r.responded_by_name),
      respondedAt: iso(r.responded_at),
      proposedAreaName: s(r.proposed_area_name),
      sourceModule: (r.source_module as AreaReviewComment['sourceModule']) ?? null,
      sourceRiskId: s(r.source_risk_id),
      resolvedAreaId: s(r.resolved_area_id),
      version: Number(r.version),
    }));
  }
}

function publicRecord(r: AreaReviewRecord & { basis: CompletionBasis | null }): AreaReviewRecord {
  const { basis, ...rest } = r;
  void basis;
  return rest;
}

const KIND_NOUN: Record<AreaCommentKind, string> = {
  comment: 'Comment',
  challenge: 'Engagement Partner challenge',
  reassessment_request: 'Engagement Partner reassessment request',
  downstream_request: 'Area request',
};

/** Prior-year context for an area: last year's matrix row and/or matching matters. */
function priorYearFor(
  row: AreaPriorYear | null,
  matters: AreaPriorYearMatter[],
): AreaPriorYear | null {
  if (!row && !matters.length) return null;
  return {
    ...(row ?? {
      inPriorMatrix: false,
      retained: false,
      attention: null,
      assertions: [],
      cy: null,
      unit: null,
    }),
    matters,
  };
}
