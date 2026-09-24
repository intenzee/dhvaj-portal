import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ASSERTION_IDS,
  REMOVAL_REASON_LABEL,
  REMOVAL_REASON_NEEDS_TEXT,
  areaReviewVersionLabel,
  materialityVersionLabel,
  type AddCustomAreaInput,
  type AddLibraryAreasInput,
  type AreaAuthorityRef,
  type AreaCommentInput,
  type AreaImpact,
  type AreaLibraryProfile,
  type AreaLinkInput,
  type AreaMatrixVersion,
  type AreaPriorYear,
  type AreaReviewComment,
  type AreaReviewRecord,
  type AssertionActionInput,
  type AssertionGroup,
  type AssertionId,
  type AssertionMasterItem,
  type AuditAreaLibraryItem,
  type AuditAreaReviewSummary,
  type AuthorityCategory,
  type CompleteAreaReviewInput,
  type EngagementAuditArea,
  type FinancialUnit,
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
  tiles,
  validations,
  type AreaFacts,
  type AttentionRule,
  type CompletionBasis,
  type LibraryRow,
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
}

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
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  async getSummary(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      return this.buildSummary(client, wi);
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
      await this.ensure(client, ctx, engagementId, wi);
      return this.buildSummary(client, wi);
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
        throw new ConflictException(
          'Downstream work already exists for this Audit Area — resolve or reassign it before removing the area.',
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
      return this.buildSummary(client, wi);
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
      return this.buildSummary(client, wi);
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
      const added: string[] = [];
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
        const areaId = await this.insertLibraryArea(
          client,
          ctx,
          engagementId,
          reviewId,
          lib,
          'added_from_library',
          null,
          ws.facts,
        );
        added.push(lib.areaName);
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
      return this.buildSummary(client, wi);
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
      return this.buildSummary(client, wi);
    });
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
      const reviewId = await this.editable(client, ctx, engagementId, wi);
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
      if (!sets.length) return this.buildSummary(client, wi);
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
      return this.buildSummary(client, wi);
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
      return this.buildSummary(client, wi);
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
      return this.buildSummary(client, wi);
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
      return this.buildSummary(client, wi);
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
      const reviewId = await this.editable(client, ctx, engagementId, wi);
      const summary = await this.buildSummary(client, wi);
      const rec = summary.record!;
      this.checkVersion(rec.version, input.version);
      const failing = summary.validations.filter((v) => !v.met);
      if (failing.length) {
        throw new ConflictException(
          `03.5 cannot be completed: ${failing.map((v) => `${v.id} ${v.detail ?? v.label}`).join(' ')}`,
        );
      }
      const ws = await this.workspace(client, wi);
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
        [reviewId, JSON.stringify(completionBasis(ws.facts)), ctx.employeeId ?? null],
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
      return this.buildSummary(client, wi);
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
      return this.buildSummary(client, wi);
    });
  }

  /** §3 / AT-18 — controlled refresh to the current library version. */
  async applyMethodologyUpdate(
    ctx: RlsContext,
    engagementId: string,
    wi: string,
  ): Promise<AuditAreaReviewSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const reviewId = await this.editable(client, ctx, engagementId, wi);
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
      const added: string[] = [];
      const withdrawn: string[] = [];
      for (const lib of next) {
        if (ws.stored.some((a) => a.areaCode === lib.areaCode)) continue;
        await this.insertLibraryArea(
          client,
          ctx,
          engagementId,
          reviewId,
          lib,
          'methodology_refresh',
          `Added by methodology update ${current} — review.`,
          ws.facts,
        );
        added.push(lib.areaName);
      }
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
      return this.buildSummary(client, wi);
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
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, wi);
      const ws = await this.workspace(client, wi);
      if (!ws.record) throw new ConflictException('03.5 has not been started on this audit file.');
      if (input.areaId) this.area(ws, input.areaId);
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
      return this.buildSummary(client, wi);
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
      const { rowCount } = await client.query(
        `UPDATE hsdg.audit_area_review_comment c
            SET status = 'addressed', response = $2, responded_by_employee_id = $3, version = c.version + 1
           FROM hsdg.audit_area_review r
          WHERE c.id = $1 AND c.review_id = r.id AND r.workflow_instance_id = $4 AND c.status = 'open'`,
        [commentId, response, ctx.employeeId ?? null, wi],
      );
      if (!rowCount) throw new NotFoundException('Open comment not found on this audit file.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.audit_area_comment_addressed',
        objectType: 'audit_area_review_comment',
        objectId: commentId,
        after: { response },
      });
      return this.buildSummary(client, wi);
    });
  }

  /**
   * §25 hook for upstream modules (03.3 completion): a completed 03.5 whose
   * completeness is affected becomes Update Required — never silently changed.
   */
  async markImpacted(client: PoolClient, wi: string): Promise<void> {
    const ws = await this.workspace(client, wi);
    if (!ws.record || ws.record.status !== 'complete' || !ws.impacts.length) return;
    await client.query(
      `UPDATE hsdg.audit_area_review SET status = 'update_required', update_reason = $2, version = version + 1
        WHERE id = $1`,
      [ws.record.id, ws.impacts.map((i) => i.message).join(' ')],
    );
    await client.query(
      `UPDATE hsdg.audit_planning_items SET state = 'needs_attention', version = version + 1
        WHERE workflow_instance_id = $1 AND item_key = $2 AND state = 'complete'`,
      [wi, AREA_ITEM_KEY],
    );
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
  ): Promise<string> {
    await assertShell(client, engagementId, wi);
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

  private async currentLibraryVersion(client: PoolClient): Promise<string | null> {
    const { rows } = await client.query<{ library_version: string }>(
      `SELECT library_version FROM hsdg.audit_area_library_release ORDER BY released_at DESC, library_version DESC LIMIT 1`,
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
    for (const lib of population) {
      await this.insertLibraryArea(client, ctx, engagementId, id, lib, 'population', null, facts);
    }
    await this.rollUp(client, ctx, wi, 'in_progress');
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.audit_area_population_created',
      objectType: 'audit_area_review',
      objectId: id,
      after: { libraryVersion: version, profile: facts.profile, areas: population.length },
    });
    return id;
  }

  private async insertLibraryArea(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    reviewId: string,
    lib: LibraryRow,
    origin: 'population' | 'added_from_library' | 'methodology_refresh',
    reviewFlag: string | null,
    facts: AreaFacts,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_engagement_area
         (review_id, engagement_id, seq, source, source_audit_area_id, area_code, library_version, origin,
          area_name, area_type, attention, review_flag, review_flag_source,
          created_by_employee_id, updated_by_employee_id)
       VALUES ($1, $2, (SELECT COALESCE(MAX(seq),0)+1 FROM hsdg.audit_engagement_area WHERE review_id = $1),
               'library', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
      [
        reviewId,
        engagementId,
        lib.id,
        lib.areaCode,
        lib.libraryVersion,
        origin,
        lib.areaName,
        lib.areaType,
        lib.defaultAttention,
        reviewFlag,
        reviewFlag ? 'methodology_refresh' : null,
        ctx.employeeId ?? null,
      ],
    );
    const areaId = rows[0]!.id;
    await this.insertDefaultAssertions(client, areaId, engagementId, lib);
    for (const sid of suggestSignals(lib, facts.signals)) {
      await client.query(
        `INSERT INTO hsdg.audit_area_signal_link (area_id, engagement_id, signal_id, origin)
         VALUES ($1, $2, $3, 'auto') ON CONFLICT DO NOTHING`,
        [areaId, engagementId, sid],
      );
    }
    for (const sp of facts.specific.filter((x) => specificMatchesArea(x, lib))) {
      await client.query(
        `INSERT INTO hsdg.audit_area_specific_link (area_id, engagement_id, specific_key, origin)
         VALUES ($1, $2, $3, 'auto') ON CONFLICT DO NOTHING`,
        [areaId, engagementId, sp.key],
      );
    }
    await this.applySuggestionsFor(client, areaId, lib, facts);
    return areaId;
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
      `SELECT conclusion FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = '02.2' ORDER BY updated_at DESC LIMIT 1`,
    );
    const { rows: fw } = await client.query<{ area_key: string; conclusion: string }>(
      `SELECT area_key, conclusion FROM hsdg.audit_framework_assessments
        WHERE workflow_instance_id = $1 AND conclusion IS NOT NULL`,
      [wi],
    );
    const concl = Object.fromEntries(fw.map((r) => [r.area_key, r.conclusion]));
    const frf = s(frfRow?.conclusion);
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
      industry: 'general_corporate',
      cfsApplicable: concl.cfs === 'applicable',
      initialAudit: profileRow?.initial_audit === true,
    };

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

  /** §20 — prior-year context from the predecessor engagement's latest 03.5 matrix. */
  private async readPriorYear(client: PoolClient, wi: string): Promise<Map<string, AreaPriorYear>> {
    const { rows } = await client.query<Row>(
      `SELECT pr.id AS review_id
         FROM hsdg.service_workflow_instances w
         JOIN hsdg.engagements e ON e.id = w.engagement_id
         JOIN hsdg.service_workflow_instances pw ON pw.engagement_id = e.predecessor_engagement_id
         JOIN hsdg.audit_area_review pr ON pr.workflow_instance_id = pw.id
        WHERE w.id = $1 LIMIT 1`,
      [wi],
    );
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
        retained: a.disposition === 'retained',
        attention: (a.attention as AreaPriorYear['attention']) ?? null,
        assertions: arr(a.assertions),
        cy: n(a.cy_amount),
        unit: s(a.unit),
      });
    }
    return out;
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
        priorYear: py.get(a.areaCode ?? `name:${a.areaName.toLowerCase()}`) ?? null,
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
      d.downstreamWork = downstreamWorkCount();
      return d;
    });
    const resolutions = new Map<string, string>();
    if (rec) {
      const { rows } = await client.query<{ signal_id: string; note: string }>(
        `SELECT signal_id, note FROM hsdg.audit_area_signal_resolution WHERE review_id = $1`,
        [rec.id],
      );
      for (const r of rows) resolutions.set(r.signal_id, r.note);
    }
    const impacts =
      rec && rec.status !== 'in_progress'
        ? assessImpacts(
            rec.basis,
            facts,
            areas,
            applicableLibrary(library, facts.profile, periodEnd),
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
    };
  }

  private async buildSummary(client: PoolClient, wi: string): Promise<AuditAreaReviewSummary> {
    const ws = await this.workspace(client, wi);
    const rec = ws.record;
    const specific = specificMatters(ws.facts, ws.areas);
    const signals = signalRefs(ws.facts, ws.areas, ws.resolutions);
    const checks = rec
      ? validations({ profile: ws.facts.profile, areas: ws.areas, specific, signals })
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
      assertionMaster: await this.readAssertionMaster(client),
    };
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
      `SELECT c.*, e.full_name AS created_by_name FROM hsdg.audit_area_review_comment c
         LEFT JOIN hsdg.employees e ON e.id = c.created_by_employee_id
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
      version: Number(r.version),
    }));
  }
}

function publicRecord(r: AreaReviewRecord & { basis: CompletionBasis | null }): AreaReviewRecord {
  const { basis, ...rest } = r;
  void basis;
  return rest;
}

/**
 * §9.1 — downstream work linked to an Audit Area blocks its removal. 03.6
 * (risks / responses) is not built yet, so nothing links to an area today.
 */
function downstreamWorkCount(): number {
  return 0;
}
