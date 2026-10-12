import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  AREA_ATTENTIONS,
  AREA_CATEGORIES,
  AREA_CONDITION_KEYS,
  AREA_TYPES,
  GENERAL_CORPORATE_INDUSTRY,
  type AssertionGroup,
  type AssertionId,
  type AssertionMasterItem,
  type AuditAreaLibraryAdminRow,
  type AuditAreaLibraryAdminView,
  type AuditAreaLibraryRelease,
  type CreateLibraryDraftInput,
  type UpsertLibraryAreaInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v);
const day = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
};
const arr = <T = string>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^[a-z0-9_.-]{3,60}$/;
const CODE = /^[A-Z0-9_]{2,20}$/;

/** Columns copied when a draft is cloned from its base release. */
const COPY_COLUMNS = [
  'area_code',
  'area_name',
  'area_type',
  'category',
  'framework_profile',
  'industry_profile',
  'condition_key',
  'default_assertions',
  'non_assertion_workstream',
  'default_attention',
  'related_authorities',
  'signal_mapping_tags',
  'metric_keys',
  'indicator_tags',
  'assertion_attention_rules',
  'aliases',
  'effective_from',
  'effective_to',
  'active',
  'sort_order',
].join(', ');

/**
 * DHVAJ 03.5 §4 / §6 / §7 — Audit Area Library administration. Methodology
 * only (no client data). A release is immutable once published (DB trigger);
 * changes are made on ONE draft cloned from the current release, then
 * published as the next version. New engagements populate from the latest
 * released version; existing engagements keep theirs until the Manager applies
 * the methodology update (AT-18). Writes need a firm-wide role (RLS).
 */
@Injectable()
export class AuditAreaLibraryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async view(ctx: RlsContext, version?: string): Promise<AuditAreaLibraryAdminView> {
    return this.db.withRlsContext(ctx, (client) => this.read(client, version));
  }

  async createDraft(
    ctx: RlsContext,
    input: CreateLibraryDraftInput,
  ): Promise<AuditAreaLibraryAdminView> {
    const version = input.libraryVersion?.trim() ?? '';
    const note = input.note?.trim() ?? '';
    if (!VERSION.test(version)) {
      throw new BadRequestException(
        'Name the version in lower case, e.g. dhvaj-gc-2026.3 (3–60 of a–z, 0–9, ".", "-", "_").',
      );
    }
    if (!note) throw new BadRequestException('Describe what the new library version changes.');
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertFirmwide(client);
      const { rows: draft } = await client.query<{ library_version: string }>(
        `SELECT library_version FROM hsdg.audit_area_library_release WHERE status = 'draft'`,
      );
      if (draft[0]) {
        throw new ConflictException(
          `Draft ${draft[0].library_version} is already open — publish it before starting another.`,
        );
      }
      const base = await this.current(client);
      try {
        await client.query(
          `INSERT INTO hsdg.audit_area_library_release
             (library_version, status, based_on, note, released_at, created_by_employee_id)
           VALUES ($1, 'draft', $2, $3, NULL, hsdg.ctx_employee_id())`,
          [version, base, note],
        );
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        if (err.code === '23505') {
          throw new ConflictException(
            err.constraint === 'audit_area_library_release_one_draft'
              ? 'Another draft was just opened — publish it before starting another.'
              : `Library version ${version} already exists.`,
          );
        }
        throw e;
      }
      if (base) {
        await client.query(
          `INSERT INTO hsdg.audit_area_library (library_version, ${COPY_COLUMNS})
           SELECT $1, ${COPY_COLUMNS} FROM hsdg.audit_area_library WHERE library_version = $2`,
          [version, base],
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'methodology.audit_area_library_draft_created',
        objectType: 'audit_area_library_release',
        objectId: version,
        after: { libraryVersion: version, basedOn: base, note },
      });
      return this.read(client, version);
    });
  }

  /** Add (areaId null) or change one area of the open draft. */
  async upsertArea(
    ctx: RlsContext,
    version: string,
    areaId: string | null,
    input: UpsertLibraryAreaInput,
  ): Promise<AuditAreaLibraryAdminView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertFirmwide(client);
      await this.assertDraft(client, version);
      const row = await this.validate(client, input);
      const values = [
        row.areaCode,
        row.areaName,
        row.areaType,
        row.category,
        row.frameworkProfile,
        row.industryProfile,
        row.conditionKey,
        row.defaultAssertions,
        row.nonAssertionWorkstream,
        row.defaultAttention,
        row.relatedAuthorities,
        row.signalMappingTags,
        row.metricKeys,
        row.indicatorTags,
        row.aliases,
        row.effectiveFrom,
        row.effectiveTo,
        row.active,
        row.sortOrder,
      ];
      try {
        if (areaId) {
          const { rowCount } = await client.query(
            `UPDATE hsdg.audit_area_library
                SET area_code = $3, area_name = $4, area_type = $5, category = $6,
                    framework_profile = $7, industry_profile = $8, condition_key = $9,
                    default_assertions = $10, non_assertion_workstream = $11,
                    default_attention = $12, related_authorities = $13, signal_mapping_tags = $14,
                    metric_keys = $15, indicator_tags = $16, aliases = $17, effective_from = $18,
                    effective_to = $19, active = $20, sort_order = $21, updated_at = now()
              WHERE id = $1 AND library_version = $2`,
            [areaId, version, ...values],
          );
          if (!rowCount) throw new NotFoundException('That area is not in this draft.');
        } else {
          await client.query(
            `INSERT INTO hsdg.audit_area_library
               (library_version, area_code, area_name, area_type, category, framework_profile,
                industry_profile, condition_key, default_assertions, non_assertion_workstream,
                default_attention, related_authorities, signal_mapping_tags, metric_keys,
                indicator_tags, aliases, effective_from, effective_to, active, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
            [version, ...values],
          );
        }
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          throw new ConflictException(`Area code ${row.areaCode} is already in ${version}.`);
        }
        throw e;
      }
      await this.audit.recordWith(client, ctx, {
        action: areaId
          ? 'methodology.audit_area_library_area_updated'
          : 'methodology.audit_area_library_area_added',
        objectType: 'audit_area_library_release',
        objectId: version,
        after: { areaId, ...row },
      });
      return this.read(client, version);
    });
  }

  async publish(ctx: RlsContext, version: string): Promise<AuditAreaLibraryAdminView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertFirmwide(client);
      await this.assertDraft(client, version);
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM hsdg.audit_area_library WHERE library_version = $1 AND active`,
        [version],
      );
      if (!rows[0]?.n)
        throw new ConflictException('A library release needs at least one active area.');
      await client.query(
        `UPDATE hsdg.audit_area_library_release
            SET status = 'released', released_at = now(), released_by_employee_id = hsdg.ctx_employee_id()
          WHERE library_version = $1 AND status = 'draft'`,
        [version],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'methodology.audit_area_library_released',
        objectType: 'audit_area_library_release',
        objectId: version,
        after: { libraryVersion: version, activeAreas: rows[0].n },
      });
      return this.read(client, version);
    });
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** Library writes are firm-wide methodology (RLS refuses others; this explains why). */
  private async assertFirmwide(client: PoolClient): Promise<void> {
    const { rows } = await client.query<{ ok: boolean }>(`SELECT hsdg.ctx_is_firmwide() AS ok`);
    if (!rows[0]?.ok) {
      throw new ForbiddenException('Audit Area Library changes need a firm-wide methodology role.');
    }
  }

  private async current(client: PoolClient): Promise<string | null> {
    const { rows } = await client.query<{ library_version: string }>(
      `SELECT library_version FROM hsdg.audit_area_library_release
        WHERE status = 'released' ORDER BY released_at DESC, library_version DESC LIMIT 1`,
    );
    return rows[0]?.library_version ?? null;
  }

  private async assertDraft(client: PoolClient, version: string): Promise<void> {
    const { rows } = await client.query<{ status: string }>(
      `SELECT status FROM hsdg.audit_area_library_release WHERE library_version = $1 FOR UPDATE`,
      [version],
    );
    if (!rows[0]) throw new NotFoundException(`Library version ${version} not found.`);
    if (rows[0].status !== 'draft') {
      throw new ConflictException(
        `${version} is released and immutable — start a new draft to change the library.`,
      );
    }
  }

  private async industryProfiles(client: PoolClient): Promise<{ key: string; label: string }[]> {
    const { rows } = await client.query<{ profile_key: string; label: string }>(
      `SELECT DISTINCT ON (profile_key) profile_key, label FROM hsdg.analytics_industry_profile
        WHERE profile_key <> 'generic' ORDER BY profile_key, version DESC`,
    );
    return [
      { key: GENERAL_CORPORATE_INDUSTRY, label: 'All engagements (general corporate)' },
      ...rows.map((r) => ({ key: r.profile_key, label: r.label })),
    ];
  }

  private async assertionMaster(client: PoolClient): Promise<AssertionMasterItem[]> {
    const { rows } = await client.query<Row>(
      `SELECT id, assertion_group, label FROM hsdg.audit_assertion WHERE active ORDER BY sort_order`,
    );
    return rows.map((r) => ({
      id: r.id as AssertionId,
      group: r.assertion_group as AssertionGroup,
      label: String(r.label),
    }));
  }

  private async validate(
    client: PoolClient,
    input: UpsertLibraryAreaInput,
  ): Promise<UpsertLibraryAreaInput> {
    const list = (v: string[] | undefined) => [
      ...new Set((v ?? []).map((x) => x.trim()).filter(Boolean)),
    ];
    const areaCode = input.areaCode?.trim().toUpperCase() ?? '';
    const areaName = input.areaName?.trim() ?? '';
    if (!CODE.test(areaCode)) {
      throw new BadRequestException('Area code: 2–20 capitals, digits or "_" (e.g. TRADE_REC).');
    }
    if (!areaName) throw new BadRequestException('Name the Audit Area.');
    if (!AREA_TYPES.includes(input.areaType)) throw new BadRequestException('Unknown area type.');
    if (!AREA_CATEGORIES.includes(input.category)) {
      throw new BadRequestException('Unknown area category.');
    }
    if (!['both', 'as', 'ind_as'].includes(input.frameworkProfile)) {
      throw new BadRequestException('Framework profile is both, as or ind_as.');
    }
    if (input.conditionKey && !AREA_CONDITION_KEYS.includes(input.conditionKey)) {
      throw new BadRequestException('Unknown condition key.');
    }
    if (!AREA_ATTENTIONS.includes(input.defaultAttention)) {
      throw new BadRequestException('Default attention is standard or enhanced.');
    }
    const industries = await this.industryProfiles(client);
    if (!industries.some((i) => i.key === input.industryProfile)) {
      throw new BadRequestException(
        `Industry profile must be one of: ${industries.map((i) => i.key).join(', ')}.`,
      );
    }
    const master = new Set((await this.assertionMaster(client)).map((m) => m.id as string));
    const assertions = list(input.defaultAssertions);
    const unknown = assertions.filter((a) => !master.has(a));
    if (unknown.length) {
      throw new BadRequestException(`Unknown assertion id(s): ${unknown.join(', ')}.`);
    }
    if (!assertions.length && !input.nonAssertionWorkstream) {
      throw new BadRequestException(
        'Give the area at least one default assertion, or mark it a non-assertion workstream.',
      );
    }
    if (!DATE.test(input.effectiveFrom ?? '')) {
      throw new BadRequestException('Effective from is a date (YYYY-MM-DD).');
    }
    if (
      input.effectiveTo &&
      (!DATE.test(input.effectiveTo) || input.effectiveTo < input.effectiveFrom)
    ) {
      throw new BadRequestException('Effective to is a date on or after effective from.');
    }
    if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
      throw new BadRequestException('Sort order is a whole number.');
    }
    return {
      ...input,
      areaCode,
      areaName,
      conditionKey: input.conditionKey ?? null,
      defaultAssertions: assertions as AssertionId[],
      nonAssertionWorkstream: input.nonAssertionWorkstream === true,
      relatedAuthorities: list(input.relatedAuthorities),
      signalMappingTags: list(input.signalMappingTags),
      metricKeys: list(input.metricKeys),
      indicatorTags: list(input.indicatorTags),
      aliases: list(input.aliases),
      effectiveTo: input.effectiveTo || null,
      active: input.active !== false,
    };
  }

  private async read(client: PoolClient, version?: string): Promise<AuditAreaLibraryAdminView> {
    const current = await this.current(client);
    const { rows } = await client.query<Row>(
      `SELECT r.library_version, r.status, r.based_on, r.note, r.released_at, r.created_at,
              (SELECT count(*)::int FROM hsdg.audit_area_library l
                WHERE l.library_version = r.library_version) AS area_count,
              (SELECT count(*)::int FROM hsdg.audit_area_library l
                WHERE l.library_version = r.library_version AND l.active) AS active_count,
              (SELECT count(*)::int FROM hsdg.audit_area_review v
                WHERE v.library_version = r.library_version) AS engagements_using
         FROM hsdg.audit_area_library_release r
        ORDER BY (r.status = 'draft') DESC, r.released_at DESC NULLS LAST, r.library_version DESC`,
    );
    const releases: AuditAreaLibraryRelease[] = rows.map((r) => ({
      libraryVersion: String(r.library_version),
      status: r.status as AuditAreaLibraryRelease['status'],
      basedOn: r.based_on ? String(r.based_on) : null,
      note: r.note ? String(r.note) : null,
      areaCount: Number(r.area_count),
      activeCount: Number(r.active_count),
      releasedAt: iso(r.released_at),
      createdAt: iso(r.created_at)!,
      current: r.library_version === current,
      engagementsUsing: Number(r.engagements_using),
    }));
    const selected =
      (version ? releases.find((r) => r.libraryVersion === version) : undefined) ??
      releases.find((r) => r.status === 'draft') ??
      releases.find((r) => r.current) ??
      null;
    if (version && selected?.libraryVersion !== version) {
      throw new NotFoundException(`Library version ${version} not found.`);
    }
    const { rows: areas } = selected
      ? await client.query<Row>(
          `SELECT * FROM hsdg.audit_area_library WHERE library_version = $1
            ORDER BY sort_order, area_code`,
          [selected.libraryVersion],
        )
      : { rows: [] as Row[] };
    return {
      releases,
      selected,
      rows: areas.map((r): AuditAreaLibraryAdminRow => ({
        id: String(r.id),
        libraryVersion: String(r.library_version),
        areaCode: String(r.area_code),
        areaName: String(r.area_name),
        areaType: r.area_type as AuditAreaLibraryAdminRow['areaType'],
        category: r.category as AuditAreaLibraryAdminRow['category'],
        frameworkProfile: r.framework_profile as AuditAreaLibraryAdminRow['frameworkProfile'],
        industryProfile: String(r.industry_profile),
        conditionKey: (r.condition_key as AuditAreaLibraryAdminRow['conditionKey']) ?? null,
        defaultAssertions: arr<AssertionId>(r.default_assertions),
        nonAssertionWorkstream: r.non_assertion_workstream === true,
        defaultAttention: r.default_attention as AuditAreaLibraryAdminRow['defaultAttention'],
        relatedAuthorities: arr(r.related_authorities),
        signalMappingTags: arr(r.signal_mapping_tags),
        metricKeys: arr(r.metric_keys),
        indicatorTags: arr(r.indicator_tags),
        aliases: arr(r.aliases),
        effectiveFrom: day(r.effective_from)!,
        effectiveTo: day(r.effective_to),
        active: r.active === true,
        sortOrder: Number(r.sort_order),
      })),
      assertionMaster: await this.assertionMaster(client),
      industryProfiles: await this.industryProfiles(client),
    };
  }
}
