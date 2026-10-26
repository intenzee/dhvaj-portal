import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient, QueryResult } from 'pg';
import {
  ENTITY_STATUS,
  GST_STATES,
  MISSING_INFO_LABEL,
  PENDING_REGISTRATION_STREAMS,
  REGULATORY_PROFILE_STATUS,
  ROLE,
  STREAM_REGISTRATION_TYPES,
  ENTITY_TYPE_SOURCE,
  TAX_ID_ERROR,
  cleanPan,
  firmTypeFromIds,
  typeAgreesWithPan,
  type EntityTypeSource,
  panFromGstins,
  readGstin,
  officeLabel,
  type ContactType,
  type DuplicateClientConflict,
  type MissingInfoCode,
  type RegistrationType,
  type Stream,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { ComplianceGeneratorService } from '../compliance/compliance-generator.service';
import { engagementInSectionsSql } from '../../common/sections';
import { sameClient } from './client-names';
import type {
  AddressInput,
  BusinessActivityInput,
  ContactInput,
  CreateEntityInput,
  DuplicateCandidate,
  EntityDetail,
  EntityFilter,
  EntitySummary,
  EntityTypeRecord,
  FinancialProfileInput,
  FinancialProfileRecord,
  ListingInput,
  RegistrationInput,
  RegistrationRecord,
  RegulatoryAttributeInput,
  RelationshipInput,
  UpdateAddressInput,
  UpdateEntityInput,
  UpdateListingInput,
  UpdateRegistrationInput,
  UpdateRelationshipInput,
} from './entities.types';
import type {
  AddressType,
  Exchange,
  ListingLineStatus,
  RegulatoryAttributeSource,
  RelationshipStatus,
  RelationshipType,
  SecurityType,
  ClientTeamRef,
} from '@hsdg/contracts';

import { addressState, registrationState, stateMismatchError } from './registration-state';
// Summary-level columns, shared by the list and detail selects so mapSummary
// can consume either. Aliased to stable names.
const ENTITY_SUMMARY_COLS = `
  e.id, e.entity_code, e.legal_name, e.display_name, e.trade_name, e.short_name,
  e.pan, e.status, e.legal_status, e.regulatory_profile_status, e.listing_status,
  e.current_accounting_framework, e.country_of_incorporation, e.client_id,
  e.group_id, e.incorporation_date, e.version, e.home_office_id,
  e.entity_type_id, e.parent_entity_id, e.team_id`;

/**
 * The client's missing master items (§5/§27/§28) as a text[] of
 * MISSING_INFO_CODES, in their order — for the client page, the list's marker
 * and its filter alike. `e` is the entities row's alias, `category` the SQL
 * for its type category. Absence is reported, never read as "not applicable".
 * GSTIN is missing only for a GST client: one with a GST login or GST
 * return marks (from the login workbook) but no GSTIN.
 */
export function missingInfoSql(e: string, category: string): string {
  const none = (from: string, where: string): string =>
    `NOT EXISTS (SELECT 1 FROM hsdg.${from} WHERE x.entity_id = ${e}.id${where})`;
  return `array_remove(ARRAY[
    CASE WHEN NULLIF(${e}.pan, '') IS NULL THEN 'pan' END,
    CASE WHEN (NOT ${none('client_credentials x', " AND x.portal = 'gst'")}
               OR NOT ${none('client_return_marks x', '')})
          AND ${none('entity_registrations x', " AND x.registration_type = 'gstin'")} THEN 'gstin' END,
    CASE WHEN ${e}.incorporation_date IS NULL THEN 'incorporation_date' END,
    CASE WHEN ${e}.legal_status IS NULL THEN 'legal_status' END,
    CASE WHEN ${none('entity_registrations x', '')} THEN 'registrations' END,
    CASE WHEN ${none('entity_contacts x', ' AND x.is_primary')} THEN 'primary_contact' END,
    CASE WHEN ${none('entity_financial_profiles x', ' AND x.is_current')} THEN 'financials' END,
    CASE WHEN ${category} = 'company'
          AND ${none('entity_registrations x', " AND x.registration_type = 'cin'")} THEN 'cin' END,
    CASE WHEN ${category} = 'llp'
          AND ${none('entity_registrations x', " AND x.registration_type = 'llpin'")} THEN 'llpin' END
  ]::text[], NULL)`;
}

const ENTITY_SUMMARY_SELECT = `
  SELECT ${ENTITY_SUMMARY_COLS}, o.code AS office_code,
         et.slug AS type_slug, et.name AS type_name, et.category AS type_category,
         e.roc, e.authorised_capital, e.paid_up_capital, e.llp_contribution,
         e.business_description, e.act_manufacturing, e.act_trading, e.act_services,
         e.act_import, e.act_export, e.act_ecommerce, e.act_regulated,
         (SELECT count(*) FROM hsdg.entity_registrations r WHERE r.entity_id = e.id) AS registration_count,
         (SELECT count(*) FROM hsdg.entity_branches b
            WHERE b.entity_id = e.id AND b.archived_at IS NULL) AS branch_count,
         (SELECT ec.full_name FROM hsdg.entity_contacts ec
            WHERE ec.entity_id = e.id AND ec.is_primary LIMIT 1) AS primary_contact_name,
         ${missingInfoSql('e', 'et.category')} AS missing_info,
         hsdg.client_team_ref(e.team_id) AS team
  FROM hsdg.entities e
  JOIN hsdg.entity_types et ON et.id = e.entity_type_id
  JOIN hsdg.offices o ON o.id = e.home_office_id`;

interface SummaryRow {
  id: string;
  entity_code: string;
  legal_name: string;
  display_name: string | null;
  trade_name: string | null;
  short_name: string | null;
  pan: string | null;
  status: EntitySummary['status'];
  legal_status: EntitySummary['legalStatus'];
  regulatory_profile_status: EntitySummary['regulatoryProfileStatus'];
  listing_status: EntitySummary['listingStatus'];
  current_accounting_framework: EntitySummary['currentAccountingFramework'];
  country_of_incorporation: string;
  client_id: string | null;
  group_id: string | null;
  incorporation_date: string | null;
  version: number;
  home_office_id: string;
  office_code: string;
  type_slug: string;
  type_name: string;
  type_category: string;
  parent_entity_id: string | null;
  registration_count: string;
  branch_count?: string;
  primary_contact_name: string | null;
  missing_info: MissingInfoCode[];
  team_id: string | null;
  team: ClientTeamRef | null;
}

interface DetailRow extends SummaryRow {
  roc: string | null;
  authorised_capital: string | null;
  paid_up_capital: string | null;
  llp_contribution: string | null;
  business_description: string | null;
  act_manufacturing: boolean;
  act_trading: boolean;
  act_services: boolean;
  act_import: boolean;
  act_export: boolean;
  act_ecommerce: boolean;
  act_regulated: boolean;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/** Engagements that no longer put a client in a section (merged ones live on in their target). */
const CLOSED_ENGAGEMENT_STATUSES = [
  'completed',
  'closed',
  'declined',
  'withdrawn',
  'cancelled',
  'merged',
];

@Injectable()
export class EntitiesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly generator: ComplianceGeneratorService,
  ) {}

  async listEntityTypes(ctx: RlsContext): Promise<EntityTypeRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<EntityTypeRecord>(
        `SELECT id, slug, name, category FROM hsdg.entity_types ORDER BY name`,
      );
      return rows;
    });
  }

  async listIndustries(
    ctx: RlsContext,
  ): Promise<{ id: string; slug: string; name: string; sector: string | null }[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        slug: string;
        name: string;
        sector: string | null;
      }>(`SELECT id, slug, name, sector FROM hsdg.industries WHERE is_active ORDER BY name`);
      return rows;
    });
  }

  async listEntities(
    ctx: RlsContext,
    filter: EntityFilter,
    page: PageParams,
  ): Promise<PageResult<EntitySummary>> {
    // A client merged into another is reached through its keeper, not listed.
    const conditions: string[] = ['e.merged_into_id IS NULL'];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`e.status = $${params.length}`);
    }
    if (filter.typeSlug) {
      params.push(filter.typeSlug);
      conditions.push(`et.slug = $${params.length}`);
    }
    if (filter.officeCode) {
      params.push(filter.officeCode);
      conditions.push(`o.code = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search}%`);
      conditions.push(
        `(e.legal_name ILIKE $${params.length} OR e.entity_code ILIKE $${params.length} OR e.pan ILIKE $${params.length})`,
      );
    }
    if (filter.missing) {
      const missing = missingInfoSql('e', 'et.category');
      if (filter.missing === 'any') conditions.push(`cardinality(${missing}) > 0`);
      else if (filter.missing === 'none') conditions.push(`cardinality(${missing}) = 0`);
      else {
        params.push(filter.missing);
        conditions.push(`$${params.length} = ANY(${missing})`);
      }
    }
    if (filter.team === 'none') conditions.push('e.team_id IS NULL');
    else if (filter.team === 'mine') conditions.push('hsdg.is_on_client_team(e.team_id)');
    else if (filter.team) {
      params.push(filter.team);
      conditions.push(`e.team_id = $${params.length}`);
    }
    if (filter.section?.length) {
      // A client is in a section while it has a live engagement there.
      params.push(filter.section, CLOSED_ENGAGEMENT_STATUSES);
      conditions.push(
        `EXISTS (SELECT 1 FROM hsdg.engagements eng
                  WHERE eng.entity_id = e.id AND eng.status <> ALL($${params.length}::text[])
                    AND ${engagementInSectionsSql('eng', `$${params.length - 1}`)})`,
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;
    params.push(page.limit, page.offset);

    return this.db.withRlsContext(ctx, async (client) => {
      // Page first (windowed total over the filtered set), THEN the per-entity
      // counts — so the correlated subqueries run only for the page's rows.
      const { rows } = await client.query<SummaryRow & { total_count: string }>(
        `SELECT sub.*,
                (SELECT count(*) FROM hsdg.entity_registrations r WHERE r.entity_id = sub.id)
                  AS registration_count,
                (SELECT count(*) FROM hsdg.entity_branches b
                   WHERE b.entity_id = sub.id AND b.archived_at IS NULL)
                  AS branch_count,
                (SELECT ec.full_name FROM hsdg.entity_contacts ec
                   WHERE ec.entity_id = sub.id AND ec.is_primary LIMIT 1)
                  AS primary_contact_name,
                ${missingInfoSql('sub', 'sub.type_category')} AS missing_info,
                hsdg.client_team_ref(sub.team_id) AS team
         FROM (
           SELECT ${ENTITY_SUMMARY_COLS}, o.code AS office_code,
                  et.slug AS type_slug, et.name AS type_name, et.category AS type_category,
                  count(*) OVER() AS total_count
           FROM hsdg.entities e
           JOIN hsdg.entity_types et ON et.id = e.entity_type_id
           JOIN hsdg.offices o ON o.id = e.home_office_id
           ${where}
           ORDER BY e.legal_name
           LIMIT ${limitParam} OFFSET ${offsetParam}
         ) sub
         ORDER BY sub.legal_name`,
        params,
      );
      return {
        items: rows.map(mapSummary),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  async getEntityById(ctx: RlsContext, id: string): Promise<EntityDetail | null> {
    return this.db.withRlsContext(ctx, (client) => this.selectDetail(client, id));
  }

  /** The detail inside the caller's transaction (offices, CM-6). */
  async detailWith(client: PoolClient, id: string): Promise<EntityDetail | null> {
    return this.selectDetail(client, id);
  }

  async checkDuplicates(
    ctx: RlsContext,
    args: { legalName?: string; pan?: string },
  ): Promise<DuplicateCandidate[]> {
    if (!args.legalName && !args.pan) {
      throw new BadRequestException('Provide legalName and/or pan to check.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        entity_code: string;
        legal_name: string;
        pan: string | null;
        score: number;
        match_reason: 'pan' | 'name';
      }>(
        // One row per client: a PAN match outranks the same client's name match.
        `SELECT * FROM (
         SELECT DISTINCT ON (id) id, entity_code, legal_name, pan, score, match_reason FROM (
           SELECT id, entity_code, legal_name, pan, 1.0::float AS score, 'pan' AS match_reason
           FROM hsdg.entities
           WHERE $1::text IS NOT NULL AND pan = $1 AND merged_into_id IS NULL
           UNION
           SELECT id, entity_code, legal_name, pan,
                  similarity(lower(legal_name), lower($2)) AS score, 'name' AS match_reason
           FROM hsdg.entities
           WHERE $2::text IS NOT NULL AND similarity(lower(legal_name), lower($2)) > 0.3
             AND merged_into_id IS NULL
         ) matches
         ORDER BY id, score DESC
         ) best
         ORDER BY score DESC, legal_name
         LIMIT 10`,
        [args.pan ?? null, args.legalName ?? null],
      );
      return rows.map((r) => {
        const { verdict, reasons } = sameClient(
          { name: args.legalName ?? r.legal_name, pan: args.pan ?? null },
          { name: r.legal_name, pan: r.pan },
        );
        return {
          id: r.id,
          entityCode: r.entity_code,
          legalName: r.legal_name,
          pan: r.pan,
          score: Number(r.score),
          matchReason: r.match_reason,
          verdict,
          reasons,
        };
      });
    });
  }

  async createEntity(ctx: RlsContext, input: CreateEntityInput): Promise<EntityDetail> {
    return this.db.withRlsContext(ctx, (client) => this.createEntityWith(client, ctx, input));
  }

  /** createEntity inside the caller's transaction (the client import). */
  async createEntityWith(
    client: PoolClient,
    ctx: RlsContext,
    input: CreateEntityInput,
  ): Promise<EntityDetail> {
    const typeId = await this.resolveTypeId(client, input.typeSlug);
    const officeId = await this.resolveOfficeId(client, input.officeCode);
    const gstins = (input.registrations ?? [])
      .filter((r) => r.registrationType === 'gstin' && (r.status ?? 'active') === 'active')
      .map((r) => r.registrationNumber);
    // A client with no PAN takes it from its first GSTIN (CM-1).
    const panFromGstin = !input.pan ? panFromGstins(gstins) : null;
    if (panFromGstin) {
      const taken = await client.query(`SELECT 1 FROM hsdg.client_holding('pan', $1)`, [
        panFromGstin,
      ]);
      if ((taken.rowCount ?? 0) === 0) input = { ...input, pan: panFromGstin };
    }
    await this.assertGstinsMatchPan(client, input.pan ?? null, gstins);
    if (input.pan) await this.assertPanFree(client, null, input.pan);
    // The type's source (CM-3): the PAN's when it is what the PAN says, else the person's.
    const panType = firmTypeFromIds({
      pan: input.pan,
      gstins,
      nameOrTypedType: input.legalName,
      hasBusinessRegistration: gstins.length > 0,
    });
    const typeSource: EntityTypeSource =
      input.entityTypeSource ??
      (panType?.slug === input.typeSlug ? ENTITY_TYPE_SOURCE.pan : ENTITY_TYPE_SOURCE.manual);

    let entityId: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.entities
           (legal_name, display_name, trade_name, short_name, entity_type_id, pan,
            home_office_id, client_id, parent_entity_id, status, legal_status,
            listing_status, current_accounting_framework, country_of_incorporation,
            incorporation_date, roc, authorised_capital, paid_up_capital,
            llp_contribution, business_description,
            act_manufacturing, act_trading, act_services, act_import, act_export,
            act_ecommerce, act_regulated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 COALESCE($14,'IN'),$15,$16,$17,$18,$19,$20,
                 COALESCE($21,false),COALESCE($22,false),COALESCE($23,false),
                 COALESCE($24,false),COALESCE($25,false),COALESCE($26,false),COALESCE($27,false))
         RETURNING id`,
        [
          input.legalName,
          input.displayName ?? null,
          input.tradeName ?? null,
          input.shortName ?? null,
          typeId,
          input.pan ?? null,
          officeId,
          input.clientId ?? null,
          input.parentEntityId ?? null,
          input.status ?? ENTITY_STATUS.active,
          input.legalStatus ?? null,
          input.listingStatus ?? 'unlisted',
          input.currentAccountingFramework ?? 'not_assessed',
          input.countryOfIncorporation ?? null,
          input.incorporationDate ?? null,
          input.roc ?? null,
          input.authorisedCapital ?? null,
          input.paidUpCapital ?? null,
          input.llpContribution ?? null,
          input.businessDescription ?? null,
          input.activities?.manufacturing ?? null,
          input.activities?.trading ?? null,
          input.activities?.services ?? null,
          input.activities?.import ?? null,
          input.activities?.export ?? null,
          input.activities?.ecommerce ?? null,
          input.activities?.regulated ?? null,
        ],
      );
      entityId = rows[0]!.id;
      await client.query(
        `UPDATE hsdg.entities
            SET entity_type_source = $2,
                entity_type_set_by = CASE WHEN $2 = 'manual' THEN $3::uuid END,
                entity_type_set_at = now()
          WHERE id = $1`,
        [entityId, typeSource, ctx.userId],
      );

      for (const reg of input.registrations ?? []) {
        await this.insertRegistration(client, entityId, reg);
      }
      for (const contact of input.contacts ?? []) {
        await this.insertContact(client, entityId, contact);
      }
      // Atomic wizard submit (§4): the rest of the factual children in the
      // same transaction. Relationships are excluded (they need other entities).
      for (const addr of input.addresses ?? []) {
        await this.insertAddress(client, entityId, addr);
      }
      for (const act of input.businessActivities ?? []) {
        await this.insertBusinessActivity(client, entityId, act);
      }
      for (const listing of input.listings ?? []) {
        await this.insertListing(client, entityId, listing);
      }
      for (const attr of input.regulatoryAttributes ?? []) {
        await this.insertRegulatoryAttribute(client, entityId, attr);
      }
      for (const fin of input.financialProfiles ?? []) {
        await this.writeFinancialProfile(client, entityId, fin, ctx.userId);
      }
    } catch (err) {
      throw translatePgError(err);
    }

    const detail = await this.selectDetail(client, entityId);
    await this.audit.recordWith(client, ctx, {
      action: 'entity.created',
      objectType: 'entity',
      objectId: entityId,
      after: detail,
    });
    return detail!;
  }

  async updateEntity(ctx: RlsContext, id: string, input: UpdateEntityInput): Promise<EntityDetail> {
    return this.db.withRlsContext(ctx, (client) => this.updateEntityWith(client, ctx, id, input));
  }

  /** updateEntity inside the caller's transaction (the client master import). */
  async updateEntityWith(
    client: PoolClient,
    ctx: RlsContext,
    id: string,
    input: UpdateEntityInput,
  ): Promise<EntityDetail> {
    const before = await this.selectDetail(client, id);
    if (!before) throw new NotFoundException('Entity not found.');

    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (input.legalName !== undefined) set('legal_name', input.legalName);
    if (input.displayName !== undefined) set('display_name', input.displayName);
    if (input.tradeName !== undefined) set('trade_name', input.tradeName);
    if (input.shortName !== undefined) set('short_name', input.shortName);
    let typeChanged = false;
    if (input.typeSlug !== undefined && input.typeSlug !== before.typeSlug) {
      const source = input.entityTypeSource ?? ENTITY_TYPE_SOURCE.manual;
      // A type set by hand on Client 360 beats the PAN and any import (CM-3).
      const keepManual =
        source !== ENTITY_TYPE_SOURCE.manual &&
        before.entityTypeSource === ENTITY_TYPE_SOURCE.manual;
      if (!keepManual) {
        const pan = input.pan !== undefined ? input.pan : before.pan;
        if (
          source === ENTITY_TYPE_SOURCE.manual &&
          !input.typeMismatchAcknowledged &&
          !typeAgreesWithPan(input.typeSlug, pan)
        ) {
          const says = firmTypeFromIds({
            pan,
            nameOrTypedType: input.legalName ?? before.legalName,
            hasBusinessRegistration: before.registrations.some(
              (r) => r.registrationType === 'gstin' && r.status === 'active',
            ),
          });
          throw new UnprocessableEntityException({
            code: TAX_ID_ERROR.typePanMismatch,
            message: `${says?.reason ?? `PAN ${pan} says another type.`} Save this type anyway?`,
            expected: says?.slug ?? null,
            actual: input.typeSlug,
          });
        }
        set('entity_type_id', await this.resolveTypeId(client, input.typeSlug));
        set('entity_type_source', source);
        set('entity_type_set_by', source === ENTITY_TYPE_SOURCE.manual ? ctx.userId : null);
        sets.push('entity_type_set_at = now()');
        typeChanged = true;
      }
    } else if (
      input.typeSlug !== undefined &&
      input.entityTypeSource === ENTITY_TYPE_SOURCE.manual &&
      before.entityTypeSource !== ENTITY_TYPE_SOURCE.manual
    ) {
      // The same type confirmed by hand: record it as the person's.
      set('entity_type_source', ENTITY_TYPE_SOURCE.manual);
      set('entity_type_set_by', ctx.userId);
      sets.push('entity_type_set_at = now()');
    }
    if (input.officeCode !== undefined) {
      set('home_office_id', await this.resolveOfficeId(client, input.officeCode));
    }
    if (input.clientId !== undefined) set('client_id', input.clientId);
    if (input.pan !== undefined) {
      if (input.pan) {
        await this.assertPanFree(client, id, input.pan);
        await this.assertPanFitsGstins(client, id, input.pan);
      }
      set('pan', input.pan);
    }
    if (input.parentEntityId !== undefined) set('parent_entity_id', input.parentEntityId);
    if (input.status !== undefined) set('status', input.status);
    if (input.legalStatus !== undefined) set('legal_status', input.legalStatus);
    if (input.regulatoryProfileStatus !== undefined)
      set('regulatory_profile_status', input.regulatoryProfileStatus);
    if (input.listingStatus !== undefined) set('listing_status', input.listingStatus);
    if (input.currentAccountingFramework !== undefined)
      set('current_accounting_framework', input.currentAccountingFramework);
    if (input.countryOfIncorporation !== undefined)
      set('country_of_incorporation', input.countryOfIncorporation);
    if (input.incorporationDate !== undefined) set('incorporation_date', input.incorporationDate);
    if (input.roc !== undefined) set('roc', input.roc);
    if (input.authorisedCapital !== undefined) set('authorised_capital', input.authorisedCapital);
    if (input.paidUpCapital !== undefined) set('paid_up_capital', input.paidUpCapital);
    if (input.llpContribution !== undefined) set('llp_contribution', input.llpContribution);
    if (input.businessDescription !== undefined)
      set('business_description', input.businessDescription);
    if (input.activities) {
      const a = input.activities;
      if (a.manufacturing !== undefined) set('act_manufacturing', a.manufacturing);
      if (a.trading !== undefined) set('act_trading', a.trading);
      if (a.services !== undefined) set('act_services', a.services);
      if (a.import !== undefined) set('act_import', a.import);
      if (a.export !== undefined) set('act_export', a.export);
      if (a.ecommerce !== undefined) set('act_ecommerce', a.ecommerce);
      if (a.regulated !== undefined) set('act_regulated', a.regulated);
    }

    if (sets.length === 0) return before;

    sets.push('version = version + 1');
    params.push(id);
    const idParam = `$${params.length}`;
    let versionClause = '';
    if (input.version !== undefined) {
      params.push(input.version);
      versionClause = ` AND version = $${params.length}`;
    }

    let updated: number;
    try {
      const result = await client.query(
        `UPDATE hsdg.entities SET ${sets.join(', ')} WHERE id = ${idParam}${versionClause}`,
        params,
      );
      updated = result.rowCount ?? 0;
    } catch (err) {
      throw translatePgError(err);
    }
    if (updated === 0) {
      throw new ConflictException(
        'Entity was modified by someone else. Refresh and retry (stale version).',
      );
    }
    // The type decides which compliances apply.
    if (typeChanged) await this.flagReassessmentIfComplete(client, id);

    const after = await this.selectDetail(client, id);
    await this.audit.recordWith(client, ctx, {
      action: 'entity.updated',
      objectType: 'entity',
      objectId: id,
      before,
      after,
    });
    return after!;
  }

  /**
   * Delete a client entered by mistake (a duplicate, a wrong import). The
   * Managing Partner only — the entities_delete policy says the same. Its own
   * master goes with it (registrations, contacts, addresses, logins, return
   * marks…, by ON DELETE CASCADE); a client with work or billing is never
   * deleted (409) — close it (status) instead. Audited with the full master.
   */
  async deleteEntity(ctx: RlsContext, id: string): Promise<void> {
    if (ctx.role !== ROLE.managingPartner) {
      throw new ForbiddenException('Only the Managing Partner can delete a client.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectDetail(client, id);
      if (!before) throw new NotFoundException('Entity not found.');

      const blockers = await this.deleteBlockers(client, id);
      if (blockers.length) {
        throw new ConflictException(
          `${before.legalName} can’t be deleted: it has ${blockers.join(', ')}. ` +
            'Mark the client inactive instead.',
        );
      }
      let deleted: number;
      try {
        deleted =
          (await client.query(`DELETE FROM hsdg.entities WHERE id = $1`, [id])).rowCount ?? 0;
      } catch (err) {
        // A reference the counts could not see (outside the caller's RLS) still
        // holds the row: the foreign key is the last word.
        if ((err as { code?: string }).code === '23503') {
          throw new ConflictException(
            `${before.legalName} can’t be deleted: other records in the portal still refer to it. Mark the client inactive instead.`,
          );
        }
        throw translatePgError(err);
      }
      if (deleted === 0)
        throw new ForbiddenException('Only the Managing Partner can delete a client.');

      await this.audit.recordWith(client, ctx, {
        action: 'entity.deleted',
        objectType: 'entity',
        objectId: id,
        before,
      });
    });
  }

  /** What stops a client being deleted, in words ("2 engagements", "1 invoice"). */
  private async deleteBlockers(client: PoolClient, id: string): Promise<string[]> {
    const { rows } = await client.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM hsdg.engagements WHERE entity_id = $1) AS engagements,
         (SELECT count(*) FROM hsdg.engagement_entities WHERE entity_id = $1)
           + (SELECT count(*) FROM hsdg.engagement_services WHERE entity_id = $1) AS covered,
         (SELECT count(*) FROM hsdg.invoices WHERE client_entity_id = $1) AS invoices,
         (SELECT count(*) FROM hsdg.receipts WHERE client_entity_id = $1) AS receipts,
         (SELECT count(*) FROM hsdg.credit_notes WHERE client_entity_id = $1)
           + (SELECT count(*) FROM hsdg.write_offs WHERE client_entity_id = $1)
           + (SELECT count(*) FROM hsdg.fee_billings WHERE client_entity_id = $1)
           + (SELECT count(*) FROM hsdg.time_billings WHERE client_entity_id = $1)
           + (SELECT count(*) FROM hsdg.fee_waivers WHERE client_entity_id = $1)
           + (SELECT count(*) FROM hsdg.invoice_reminders WHERE client_entity_id = $1)
           + (SELECT count(*) FROM hsdg.tds_reminders WHERE client_entity_id = $1) AS billing`,
      [id],
    );
    const r = rows[0]!;
    const n = (k: string): number => Number(r[k]);
    const words = (count: number, one: string, many: string): string =>
      `${count} ${count === 1 ? one : many}`;
    const out: string[] = [];
    if (n('engagements')) out.push(words(n('engagements'), 'engagement', 'engagements'));
    if (n('covered')) out.push('a place in another client’s engagement');
    if (n('invoices')) out.push(words(n('invoices'), 'invoice', 'invoices'));
    if (n('receipts')) out.push(words(n('receipts'), 'receipt', 'receipts'));
    if (n('billing')) out.push('billing records');
    return out;
  }

  async addRegistration(
    ctx: RlsContext,
    entityId: string,
    input: RegistrationInput,
  ): Promise<EntityDetail> {
    return this.db.withRlsContext(ctx, (client) =>
      this.addRegistrationWith(client, ctx, entityId, input),
    );
  }

  /** addRegistration inside the caller's transaction (the client import). */
  /**
   * A GSTIN added to a client that already has offices (CM-6) gets an office
   * of its own, named for the place or its state; a client without offices is
   * left for "Set up offices". Returns the office id, or null.
   */
  async officeForGstinWith(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    gstin: string,
    place: string | null,
  ): Promise<string | null> {
    const { rows } = await client.query<{
      reg_id: string | null;
      branch_id: string | null;
      labels: string[] | null;
    }>(
      `SELECT r.id AS reg_id, r.branch_id,
              (SELECT array_agg(lower(b.label)) FROM hsdg.entity_branches b
                WHERE b.entity_id = $1 AND b.archived_at IS NULL) AS labels
         FROM (SELECT 1) one
         LEFT JOIN hsdg.entity_registrations r
           ON r.entity_id = $1 AND r.registration_type = 'gstin' AND r.registration_number = $2`,
      [entityId, gstin],
    );
    const row = rows[0];
    if (!row?.reg_id || row.branch_id || !row.labels?.length) return null;
    const stateCode = readGstin(gstin).stateCode;
    const base = officeLabel(place, stateCode ? (GST_STATES[stateCode] ?? null) : null);
    let label = base;
    for (let n = 2; row.labels.includes(label.toLowerCase()); n += 1) label = `${base} ${n}`;
    const ins = await client.query<{ id: string }>(
      `INSERT INTO hsdg.entity_branches (entity_id, label, state_code, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [entityId, label, stateCode, ctx.userId],
    );
    const branchId = ins.rows[0]!.id;
    await client.query(`UPDATE hsdg.entity_registrations SET branch_id = $1 WHERE id = $2`, [
      branchId,
      row.reg_id,
    ]);
    await this.audit.recordWith(client, ctx, {
      action: 'entity.branch_added',
      objectType: 'entity',
      objectId: entityId,
      after: { id: branchId, label, stateCode, gstin },
    });
    return branchId;
  }

  async addRegistrationWith(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    input: RegistrationInput,
  ): Promise<EntityDetail> {
    return this.mutateChildWith(client, ctx, entityId, 'entity.registration_added', async () => {
      if (input.registrationType === 'gstin' && (input.status ?? 'active') === 'active')
        await this.guardGstinForEntity(client, ctx, entityId, input.registrationNumber, null);
      await this.insertRegistration(client, entityId, input);
      await this.flagReassessmentIfComplete(client, entityId);
      await this.regenerateCalendars(client, entityId);
    });
  }

  /**
   * The registration a stream has been waiting on (a GST engagement opened
   * before the client's GSTIN was on file), entered from the engagement: its
   * leads may add it as well as those who manage clients. The calendar
   * rebuilds and the pending filings move onto the GSTIN, work kept.
   */
  async addStreamRegistration(
    ctx: RlsContext,
    engagementId: string,
    stream: Stream,
    input: { registrationNumber: string; stateCode?: string },
    managesClients: boolean,
  ): Promise<EntityDetail> {
    if (!PENDING_REGISTRATION_STREAMS.includes(stream)) {
      throw new BadRequestException('Only a GST stream can wait on its registration.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ entity_id: string; kind: string; is_lead: boolean }>(
        `SELECT e.entity_id, e.kind, hsdg.is_engagement_lead(e.id) AS is_lead
           FROM hsdg.engagements e WHERE e.id = $1`,
        [engagementId],
      );
      const eng = rows[0];
      if (!eng) throw new NotFoundException('Engagement not found.');
      if (eng.kind !== 'compliance') {
        throw new BadRequestException('Only a Compliance engagement has a GST stream.');
      }
      if (!managesClients && !eng.is_lead) {
        throw new ForbiddenException(
          'Only the engagement’s partner or manager can add the client’s GSTIN here — or ask a partner to add it on the client’s page.',
        );
      }
      const number = input.registrationNumber.trim().toUpperCase();
      return this.addRegistrationWith(client, ctx, eng.entity_id, {
        registrationType: STREAM_REGISTRATION_TYPES[stream][0] as RegistrationType,
        registrationNumber: number,
        stateCode: input.stateCode ?? number.slice(0, 2),
        status: 'active',
      });
    });
  }

  /**
   * Update an existing registration — the §34 "registration obtained later"
   * flow: enter the issued number, effective dates and jurisdiction, flip
   * Pending → Active, and mark dependents Needs Reassessment.
   */
  async updateRegistration(
    ctx: RlsContext,
    entityId: string,
    registrationId: string,
    input: UpdateRegistrationInput,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.registration_updated', async (client) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.registrationNumber !== undefined)
        set('registration_number', input.registrationNumber);
      if (input.stateCode !== undefined || input.registrationNumber !== undefined)
        await this.setRegistrationState(client, ctx, entityId, registrationId, input, set);
      if (input.status !== undefined) set('status', input.status);
      if (input.validFrom !== undefined) set('valid_from', input.validFrom);
      if (input.validTo !== undefined) set('valid_to', input.validTo);
      if (input.jurisdiction !== undefined) set('jurisdiction', input.jurisdiction);
      if (input.registrationDate !== undefined) set('registration_date', input.registrationDate);
      if (input.issuingAuthority !== undefined) set('issuing_authority', input.issuingAuthority);
      if (input.source !== undefined) set('source', input.source);
      if (input.isPrincipal !== undefined) set('is_principal', input.isPrincipal);
      if (input.applicability !== undefined) set('applicability', input.applicability);
      if (input.documentRef !== undefined) set('document_ref', input.documentRef);
      if (sets.length === 0) throw new BadRequestException('No registration fields to update.');

      params.push(registrationId, entityId);
      const update = (): Promise<QueryResult> =>
        client.query(
          `UPDATE hsdg.entity_registrations SET ${sets.join(', ')}
           WHERE id = $${params.length - 1} AND entity_id = $${params.length}`,
          params,
        );
      let result: QueryResult | undefined;
      if (input.registrationNumber === undefined) {
        result = await update();
      } else {
        const current = await client.query<{ registration_type: string }>(
          `SELECT registration_type FROM hsdg.entity_registrations WHERE id = $1 AND entity_id = $2`,
          [registrationId, entityId],
        );
        const type = current.rows[0]?.registration_type;
        if (type === 'gstin')
          await this.guardGstinForEntity(
            client,
            ctx,
            entityId,
            input.registrationNumber,
            registrationId,
          );
        if (type) {
          await this.withRegistrationNumber(
            client,
            entityId,
            type,
            input.registrationNumber,
            async () => {
              result = await update();
            },
          );
        }
      }
      if ((result?.rowCount ?? 0) === 0) {
        throw new NotFoundException('Registration not found for this entity.');
      }
      await this.flagReassessmentIfComplete(client, entityId);
      await this.regenerateCalendars(client, entityId);
    });
  }

  /**
   * CM-2: the state an edited registration keeps. A new GSTIN without a
   * chosen state takes its prefix; a state that differs from the prefix
   * needs the flag, unless it was already confirmed for this same GSTIN.
   */
  private async setRegistrationState(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    registrationId: string,
    input: UpdateRegistrationInput,
    set: (col: string, val: unknown) => void,
  ): Promise<void> {
    const { rows } = await client.query<{
      registration_type: string;
      registration_number: string;
      state_code: string | null;
      acked: boolean;
    }>(
      `SELECT registration_type, registration_number, state_code,
              state_mismatch_ack_at IS NOT NULL AS acked
         FROM hsdg.entity_registrations WHERE id = $1 AND entity_id = $2`,
      [registrationId, entityId],
    );
    const cur = rows[0];
    if (!cur) return;
    const number = input.registrationNumber ?? cur.registration_number;
    const chosen =
      input.stateCode !== undefined
        ? input.stateCode
        : input.registrationNumber !== undefined && cur.registration_type === 'gstin'
          ? null
          : cur.state_code;
    const state = registrationState(cur.registration_type, number, chosen);
    set('state_code', state.stateCode);
    if (!state.mismatch) {
      set('state_mismatch_ack_by', null);
      set('state_mismatch_ack_at', null);
      return;
    }
    const alreadyConfirmed =
      cur.acked && number === cur.registration_number && state.stateCode === cur.state_code;
    if (alreadyConfirmed) return;
    if (!input.stateMismatchAcknowledged) throw stateMismatchError(number, state.mismatch);
    set('state_mismatch_ack_at', new Date());
    set('state_mismatch_ack_by', ctx.employeeId ?? null);
  }

  /** Mark a registration Verified after review (§11). */
  async verifyRegistration(
    ctx: RlsContext,
    entityId: string,
    registrationId: string,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.registration_verified', async (client) => {
      const result = await client.query(
        `UPDATE hsdg.entity_registrations
           SET verified = true, verified_by = $1, verified_at = now()
         WHERE id = $2 AND entity_id = $3`,
        [ctx.userId, registrationId, entityId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('Registration not found for this entity.');
      }
    });
  }

  /**
   * Remove a registration recorded in error (e.g. a wrong or duplicate GSTIN).
   * Audited like every other child change; a complete regulatory profile is
   * flagged Needs Reassessment since the registration set it rests on changed.
   */
  async removeRegistration(
    ctx: RlsContext,
    entityId: string,
    registrationId: string,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.registration_removed', async (client) => {
      await this.removeChildRow(
        client,
        'entity_registrations',
        'entity_id',
        entityId,
        registrationId,
      );
      await this.flagReassessmentIfComplete(client, entityId);
    });
  }

  async addContact(ctx: RlsContext, entityId: string, input: ContactInput): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.contact_added', (client) =>
      this.insertContact(client, entityId, input),
    );
  }

  /** addContact inside the caller's transaction (the client import). */
  async addContactWith(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    input: ContactInput,
  ): Promise<EntityDetail> {
    return this.mutateChildWith(client, ctx, entityId, 'entity.contact_added', () =>
      this.insertContact(client, entityId, input),
    );
  }

  /**
   * Record year-wise financial figures (§16). APPEND-ONLY: an existing current
   * row for the same FY is superseded (is_current=false, linked via
   * supersedes_id) and never overwritten. Atomic within the RLS transaction.
   */
  async addFinancialProfile(
    ctx: RlsContext,
    entityId: string,
    input: FinancialProfileInput,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.financial_profile_recorded', async (client) => {
      await this.writeFinancialProfile(client, entityId, input, ctx.userId);
      await this.flagReassessmentIfComplete(client, entityId);
    });
  }

  /**
   * Supersede the current row for the FY (if any) and insert the new figures.
   * Shared by the standalone recorder and the atomic create path.
   */
  private async writeFinancialProfile(
    client: PoolClient,
    entityId: string,
    input: FinancialProfileInput,
    actorId: string,
  ): Promise<void> {
    const { rows: prior } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.entity_financial_profiles
       WHERE entity_id = $1 AND financial_year = $2 AND is_current`,
      [entityId, input.financialYear],
    );
    const supersedesId = prior[0]?.id ?? null;
    if (supersedesId) {
      await client.query(
        `UPDATE hsdg.entity_financial_profiles SET is_current = false WHERE id = $1`,
        [supersedesId],
      );
    }
    await client.query(
      `INSERT INTO hsdg.entity_financial_profiles
         (entity_id, financial_year, turnover, revenue, other_income, net_profit,
          profit_before_tax, net_worth, paid_up_capital, reserves_surplus, total_assets,
          total_borrowings, bank_pfi_borrowings, public_deposits, debentures, outstanding_loans,
          source, source_financial_year, supporting_document_ref, supersedes_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               COALESCE($17,'other'),$18,$19,$20,$21)`,
      [
        entityId,
        input.financialYear,
        input.turnover ?? null,
        input.revenue ?? null,
        input.otherIncome ?? null,
        input.netProfit ?? null,
        input.profitBeforeTax ?? null,
        input.netWorth ?? null,
        input.paidUpCapital ?? null,
        input.reservesSurplus ?? null,
        input.totalAssets ?? null,
        input.totalBorrowings ?? null,
        input.bankPfiBorrowings ?? null,
        input.publicDeposits ?? null,
        input.debentures ?? null,
        input.outstandingLoans ?? null,
        input.source ?? null,
        input.sourceFinancialYear ?? null,
        input.supportingDocumentRef ?? null,
        supersedesId,
        actorId,
      ],
    );
  }

  // ── Addresses (§8/§31) ────────────────────────────────────────────────────
  async addAddress(ctx: RlsContext, entityId: string, input: AddressInput): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.address_added', (client) =>
      this.insertAddress(client, entityId, input),
    );
  }

  /**
   * The client master import filling a contact's or an address's empty
   * fields (never overwriting one), in the caller's transaction. Audited.
   */
  async fillChildWith(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    kind: 'contact' | 'address',
    childId: string,
    patch: Record<string, string>,
  ): Promise<EntityDetail> {
    const table = kind === 'contact' ? 'entity_contacts' : 'entity_addresses';
    return this.mutateChildWith(client, ctx, entityId, `entity.${kind}_updated`, () =>
      this.updateChildRow(client, table, 'entity_id', entityId, childId, patch),
    );
  }

  /** addAddress inside the caller's transaction (the client master import). */
  async addAddressWith(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    input: AddressInput,
  ): Promise<EntityDetail> {
    return this.mutateChildWith(client, ctx, entityId, 'entity.address_added', () =>
      this.insertAddress(client, entityId, input),
    );
  }
  async updateAddress(
    ctx: RlsContext,
    entityId: string,
    addressId: string,
    input: UpdateAddressInput,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.address_updated', (client) =>
      this.updateChildRow(client, 'entity_addresses', 'entity_id', entityId, addressId, {
        address_type: input.addressType,
        line1: input.line1,
        line2: input.line2,
        city: input.city,
        pincode: input.pincode,
        country: input.country,
        is_primary: input.isPrimary,
        ...addressState(input),
      }),
    );
  }
  async removeAddress(ctx: RlsContext, entityId: string, addressId: string): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.address_removed', (client) =>
      this.removeChildRow(client, 'entity_addresses', 'entity_id', entityId, addressId),
    );
  }

  // ── Relationships (§13) ───────────────────────────────────────────────────
  async addRelationship(
    ctx: RlsContext,
    entityId: string,
    input: RelationshipInput,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.relationship_added', async (client) => {
      await client.query(
        `INSERT INTO hsdg.entity_relationships
           (from_entity_id, to_entity_id, relationship_type, shareholding_pct,
            effective_from, effective_to, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'active'),$8)`,
        [
          entityId,
          input.toEntityId,
          input.relationshipType,
          input.shareholdingPct ?? null,
          input.effectiveFrom ?? null,
          input.effectiveTo ?? null,
          input.status ?? null,
          input.notes ?? null,
        ],
      );
    });
  }
  async updateRelationship(
    ctx: RlsContext,
    entityId: string,
    relationshipId: string,
    input: UpdateRelationshipInput,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.relationship_updated', (client) =>
      this.updateChildRow(
        client,
        'entity_relationships',
        'from_entity_id',
        entityId,
        relationshipId,
        {
          relationship_type: input.relationshipType,
          shareholding_pct: input.shareholdingPct,
          effective_from: input.effectiveFrom,
          effective_to: input.effectiveTo,
          status: input.status,
          notes: input.notes,
        },
      ),
    );
  }
  async removeRelationship(
    ctx: RlsContext,
    entityId: string,
    relationshipId: string,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.relationship_removed', (client) =>
      this.removeChildRow(
        client,
        'entity_relationships',
        'from_entity_id',
        entityId,
        relationshipId,
      ),
    );
  }

  // ── Business activities (§18) ─────────────────────────────────────────────
  async addBusinessActivity(
    ctx: RlsContext,
    entityId: string,
    input: BusinessActivityInput,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.business_activity_added', (client) =>
      this.insertBusinessActivity(client, entityId, input),
    );
  }
  async removeBusinessActivity(
    ctx: RlsContext,
    entityId: string,
    activityId: string,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.business_activity_removed', (client) =>
      this.removeChildRow(client, 'entity_business_activities', 'entity_id', entityId, activityId),
    );
  }

  // ── Listings (§15) ────────────────────────────────────────────────────────
  async addListing(ctx: RlsContext, entityId: string, input: ListingInput): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.listing_added', (client) =>
      this.insertListing(client, entityId, input),
    );
  }
  async updateListing(
    ctx: RlsContext,
    entityId: string,
    listingId: string,
    input: UpdateListingInput,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.listing_updated', (client) =>
      this.updateChildRow(client, 'entity_listings', 'entity_id', entityId, listingId, {
        security_type: input.securityType,
        listing_date: input.listingDate,
        status: input.status,
        symbol: input.symbol,
        notes: input.notes,
      }),
    );
  }
  async removeListing(ctx: RlsContext, entityId: string, listingId: string): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.listing_removed', (client) =>
      this.removeChildRow(client, 'entity_listings', 'entity_id', entityId, listingId),
    );
  }

  // ── Regulatory attributes (§19) ───────────────────────────────────────────
  async addRegulatoryAttribute(
    ctx: RlsContext,
    entityId: string,
    input: RegulatoryAttributeInput,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.regulatory_attribute_added', (client) =>
      this.insertRegulatoryAttribute(client, entityId, input),
    );
  }
  async removeRegulatoryAttribute(
    ctx: RlsContext,
    entityId: string,
    attributeId: string,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.regulatory_attribute_removed', (client) =>
      this.removeChildRow(
        client,
        'entity_regulatory_attributes',
        'entity_id',
        entityId,
        attributeId,
      ),
    );
  }

  /** Shared flow for a child mutation: scope-check, work, audit, return detail. */
  private async mutateChild(
    ctx: RlsContext,
    entityId: string,
    action: string,
    work: (client: PoolClient) => Promise<void>,
  ): Promise<EntityDetail> {
    return this.db.withRlsContext(ctx, (client) =>
      this.mutateChildWith(client, ctx, entityId, action, work),
    );
  }

  private async mutateChildWith(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    action: string,
    work: (client: PoolClient) => Promise<void>,
  ): Promise<EntityDetail> {
    const before = await this.selectDetail(client, entityId);
    if (!before) throw new NotFoundException('Entity not found.');
    try {
      await work(client);
    } catch (err) {
      throw translatePgError(err);
    }
    const after = await this.selectDetail(client, entityId);
    await this.audit.recordWith(client, ctx, {
      action,
      objectType: 'entity',
      objectId: entityId,
      before,
      after,
    });
    return after!;
  }

  /**
   * When relevant master data changes, a COMPLETE regulatory profile must be
   * flagged for reassessment (§21/§28). Incomplete/under-review/already-flagged
   * profiles are left as-is; nothing is ever silently marked Not Applicable.
   */
  private async flagReassessmentIfComplete(client: PoolClient, entityId: string): Promise<void> {
    await client.query(
      `UPDATE hsdg.entities
         SET regulatory_profile_status = $1
       WHERE id = $2 AND regulatory_profile_status = $3`,
      [REGULATORY_PROFILE_STATUS.needs_reassessment, entityId, REGULATORY_PROFILE_STATUS.complete],
    );
  }

  /**
   * A GSTIN / TAN / CIN added or changed after the client's Compliance
   * engagement was opened: rebuild its calendar so the new registration's
   * filings appear (savepoint each; a caller who does not lead an engagement
   * leaves it to the nightly run).
   */
  private async regenerateCalendars(client: PoolClient, entityId: string): Promise<void> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.engagements
        WHERE entity_id = $1 AND kind = 'compliance' AND status <> ALL($2::text[])
        ORDER BY created_at`,
      [entityId, CLOSED_ENGAGEMENT_STATUSES],
    );
    for (const { id } of rows) {
      await client.query('SAVEPOINT registration_regen');
      try {
        await this.generator.generateForEngagement(client, id);
        await client.query('RELEASE SAVEPOINT registration_regen');
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT registration_regen');
      }
    }
  }

  /**
   * A GSTIN carries its client's PAN (characters 3–12): one of another PAN
   * belongs to another legal entity and is never saved (CM-1). 422
   * PAN_GSTIN_MISMATCH, naming the client that holds that PAN if any.
   */
  private async assertGstinsMatchPan(
    client: PoolClient,
    pan: string | null,
    gstins: string[],
  ): Promise<void> {
    const own = cleanPan(pan);
    let first: string | null = own;
    for (const number of gstins) {
      const read = readGstin(number);
      if (!read.pan) continue;
      if (first && read.pan !== first) {
        throw await this.panMismatch(client, read.gstin, first, read.pan, own !== null);
      }
      first ??= read.pan;
    }
  }

  private async panMismatch(
    client: PoolClient,
    gstin: string,
    expected: string,
    actual: string,
    againstPan: boolean,
  ): Promise<UnprocessableEntityException> {
    const { rows } = await client.query<{
      entity_id: string;
      entity_code: string;
      legal_name: string;
    }>(`SELECT entity_id, entity_code, legal_name FROM hsdg.client_holding('pan', $1)`, [actual]);
    const holder = rows[0];
    const lead = againstPan
      ? `GSTIN ${gstin} is for PAN ${actual}, but the client's PAN is ${expected}.`
      : `GSTIN ${gstin} is for PAN ${actual}, but the client's other GSTIN is for ${expected}. One client has one PAN.`;
    const tail = holder
      ? ` PAN ${actual} belongs to ${holder.legal_name} (${holder.entity_code}). Add this GSTIN there, or combine the two as offices.`
      : '';
    return new UnprocessableEntityException({
      code: againstPan ? TAX_ID_ERROR.panGstinMismatch : TAX_ID_ERROR.gstinsDifferentPan,
      message: lead + tail,
      expected,
      actual,
      ...(holder
        ? {
            holder: {
              id: holder.entity_id,
              entityCode: holder.entity_code,
              legalName: holder.legal_name,
            },
          }
        : {}),
    });
  }

  /**
   * A GSTIN added to (or changed on) a client: its PAN must be the client's.
   * A client with no PAN yet takes it from the GSTIN, audited as such.
   */
  private async guardGstinForEntity(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    number: string,
    exceptRegistrationId: string | null,
  ): Promise<void> {
    const { rows } = await client.query<{ pan: string | null; others: string[] }>(
      `SELECT e.pan,
              COALESCE(array_agg(r.registration_number) FILTER (WHERE r.id IS NOT NULL), '{}') AS others
         FROM hsdg.entities e
         LEFT JOIN hsdg.entity_registrations r
           ON r.entity_id = e.id AND r.registration_type = 'gstin' AND r.status = 'active'
          AND r.id IS DISTINCT FROM $2::uuid
        WHERE e.id = $1
        GROUP BY e.pan`,
      [entityId, exceptRegistrationId],
    );
    const row = rows[0];
    if (!row) return;
    if (row.pan) {
      await this.assertGstinsMatchPan(client, row.pan, [number]);
      return;
    }
    await this.assertGstinsMatchPan(client, null, [...row.others, number]);
    const read = readGstin(number);
    if (!read.valid || !read.pan) return;
    const taken = await client.query(`SELECT 1 FROM hsdg.client_holding('pan', $1)`, [read.pan]);
    if ((taken.rowCount ?? 0) > 0) return;
    await client.query(
      `UPDATE hsdg.entities SET pan = $1, version = version + 1 WHERE id = $2 AND pan IS NULL`,
      [read.pan, entityId],
    );
    await this.audit.recordWith(client, ctx, {
      action: 'entity.pan_set_from_gstin',
      objectType: 'entity',
      objectId: entityId,
      after: { pan: read.pan, gstin: read.gstin },
    });
  }

  /** A client's PAN may change only when none of its active GSTINs is for another PAN. */
  private async assertPanFitsGstins(client: PoolClient, entityId: string, pan: string) {
    const want = cleanPan(pan);
    const { rows } = await client.query<{ registration_number: string }>(
      `SELECT registration_number FROM hsdg.entity_registrations
        WHERE entity_id = $1 AND registration_type = 'gstin' AND status = 'active'
        ORDER BY registration_number`,
      [entityId],
    );
    const clash = rows
      .map((r) => r.registration_number)
      .filter((n) => {
        const read = readGstin(n);
        return read.pan !== null && read.pan !== want;
      });
    if (clash.length === 0) return;
    throw new UnprocessableEntityException({
      code: TAX_ID_ERROR.panGstinMismatch,
      message: `Remove or move GSTIN${clash.length > 1 ? 's' : ''} ${clash.join(' and ')} first: ${clash.length > 1 ? 'they are' : 'it is'} for another PAN.`,
      expected: want,
      actual: readGstin(clash[0]).pan,
    });
  }

  /** A PAN is one legal entity: if another client has it, say which (409 duplicate_client). */
  private async assertPanFree(client: PoolClient, entityId: string | null, pan: string) {
    const { rows } = await client.query<{ entity_id: string }>(
      `SELECT entity_id FROM hsdg.client_holding('pan', $1)`,
      [pan],
    );
    if (rows[0] && rows[0].entity_id !== entityId) {
      throw await this.holderConflict(client, entityId, 'pan', pan.trim().toUpperCase());
    }
  }

  /**
   * The 409 for a PAN or registration number another client holds. It names
   * that client (it may be another office's) and carries `duplicate_client`,
   * so the web can offer to merge the two: the same number on two clients
   * usually means one client entered twice under different names.
   */
  async holderConflict(
    client: PoolClient,
    entityId: string | null,
    type: string,
    value: string,
  ): Promise<ConflictException> {
    const label = `${type === 'other' ? 'Registration' : type.toUpperCase()} ${value}`;
    const { rows } = await client.query<{
      entity_id: string;
      entity_code: string;
      legal_name: string;
    }>(`SELECT entity_id, entity_code, legal_name FROM hsdg.client_holding($1, $2)`, [type, value]);
    const holder = rows[0];
    if (!holder) return new ConflictException(`${label} is already recorded.`);
    if (holder.entity_id === entityId) {
      return new ConflictException(`${label} is already recorded on this client.`);
    }
    const seen = await client.query(`SELECT 1 FROM hsdg.entities WHERE id = $1`, [
      holder.entity_id,
    ]);
    const body: DuplicateClientConflict = {
      code: 'duplicate_client',
      message:
        `${label} is already on ${holder.legal_name} (${holder.entity_code}). ` +
        (entityId
          ? 'If they are one client, merge them; if it was put there by mistake, remove it from that client first.'
          : 'Open that client instead of adding it again.'),
      entityId,
      holder: {
        id: holder.entity_id,
        entityCode: holder.entity_code,
        legalName: holder.legal_name,
        visible: (seen.rowCount ?? 0) > 0,
      },
      identifier: { type, value },
    };
    return new ConflictException(body);
  }

  /**
   * Run a write that sets a registration number; if the number is already
   * recorded (unique firm-wide), say on which client — it may be another
   * office's, which the caller cannot see.
   */
  private async withRegistrationNumber(
    client: PoolClient,
    entityId: string,
    type: string,
    number: string,
    work: () => Promise<void>,
  ): Promise<void> {
    await client.query('SAVEPOINT registration_number');
    try {
      await work();
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code !== '23505' || e.constraint !== 'entity_registrations_number_unique') throw err;
      await client.query('ROLLBACK TO SAVEPOINT registration_number');
      throw await this.holderConflict(client, entityId, type, number);
    }
    await client.query('RELEASE SAVEPOINT registration_number');
  }

  private async insertRegistration(
    client: PoolClient,
    entityId: string,
    reg: RegistrationInput,
  ): Promise<void> {
    await this.withRegistrationNumber(
      client,
      entityId,
      reg.registrationType,
      reg.registrationNumber,
      () => this.insertRegistrationRow(client, entityId, reg),
    );
  }

  private async insertRegistrationRow(
    client: PoolClient,
    entityId: string,
    reg: RegistrationInput,
  ): Promise<void> {
    const state = registrationState(reg.registrationType, reg.registrationNumber, reg.stateCode);
    if (state.mismatch && !reg.stateMismatchAcknowledged)
      throw stateMismatchError(reg.registrationNumber, state.mismatch);
    await client.query(
      `INSERT INTO hsdg.entity_registrations
         (entity_id, registration_type, registration_number, state_code, status,
          valid_from, valid_to, jurisdiction, registration_date, issuing_authority,
          source, is_principal, applicability, document_ref,
          state_mismatch_ack_by, state_mismatch_ack_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               COALESCE($11,'client'),COALESCE($12,true),COALESCE($13,'unknown'),$14,
               CASE WHEN $15::boolean THEN hsdg.ctx_employee_id() END,
               CASE WHEN $15::boolean THEN now() END)`,
      [
        entityId,
        reg.registrationType,
        reg.registrationNumber,
        state.stateCode,
        reg.status ?? 'active',
        reg.validFrom ?? null,
        reg.validTo ?? null,
        reg.jurisdiction ?? null,
        reg.registrationDate ?? null,
        reg.issuingAuthority ?? null,
        reg.source ?? null,
        reg.isPrincipal ?? null,
        reg.applicability ?? null,
        reg.documentRef ?? null,
        !!state.mismatch,
      ],
    );
  }

  private async insertContact(
    client: PoolClient,
    entityId: string,
    contact: ContactInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.entity_contacts
         (entity_id, full_name, designation, email, phone, is_primary, is_signatory,
          department, contact_type, is_portal_user, portal_role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,false),$11)`,
      [
        entityId,
        contact.fullName,
        contact.designation ?? null,
        contact.email ?? null,
        contact.phone ?? null,
        contact.isPrimary ?? false,
        contact.isSignatory ?? false,
        contact.department ?? null,
        contact.contactType ?? null,
        contact.isPortalUser ?? null,
        contact.portalRole ?? null,
      ],
    );
  }

  private async selectDetail(client: PoolClient, id: string): Promise<EntityDetail | null> {
    const { rows } = await client.query<DetailRow>(`${ENTITY_SUMMARY_SELECT} WHERE e.id = $1`, [
      id,
    ]);
    if (!rows[0]) return null;
    const row = rows[0];

    const regs = await client.query<{
      id: string;
      registration_type: RegistrationRecord['registrationType'];
      registration_number: string;
      state_code: string | null;
      status: RegistrationRecord['status'];
      valid_from: string | null;
      valid_to: string | null;
      jurisdiction: string | null;
      registration_date: string | null;
      issuing_authority: string | null;
      source: RegistrationRecord['source'];
      is_principal: boolean;
      applicability: RegistrationRecord['applicability'];
      verified: boolean;
      verified_by: string | null;
      verified_at: string | null;
      document_ref: string | null;
      branch_id: string | null;
      state_mismatch_ack_at: Date | null;
      state_mismatch_ack_name: string | null;
    }>(
      `SELECT r.id, r.registration_type, r.registration_number, r.state_code, r.status,
              r.valid_from, r.valid_to, r.jurisdiction, r.registration_date,
              r.issuing_authority, r.source, r.is_principal, r.applicability, r.verified,
              r.verified_by, r.verified_at, r.document_ref, r.branch_id,
              r.state_mismatch_ack_at, ack.full_name AS state_mismatch_ack_name
       FROM hsdg.entity_registrations r
       LEFT JOIN hsdg.employees ack ON ack.id = r.state_mismatch_ack_by
       WHERE r.entity_id = $1
       ORDER BY r.registration_type, r.is_principal DESC`,
      [id],
    );
    const branches = await client.query<{
      id: string;
      label: string;
      state_code: string | null;
      is_head_office: boolean;
      archived_at: string | null;
      version: number;
    }>(
      `SELECT id, label, state_code, is_head_office, archived_at, version
         FROM hsdg.entity_branches WHERE entity_id = $1
        ORDER BY archived_at NULLS FIRST, is_head_office DESC, lower(label)`,
      [id],
    );
    const typeSource = await client.query<{
      entity_type_source: EntityTypeSource;
      entity_type_set_at: string | null;
      set_by_name: string | null;
    }>(
      `SELECT e.entity_type_source, e.entity_type_set_at, u.display_name AS set_by_name
         FROM hsdg.entities e LEFT JOIN hsdg.users u ON u.id = e.entity_type_set_by
        WHERE e.id = $1`,
      [id],
    );
    const contacts = await client.query<{
      id: string;
      full_name: string;
      designation: string | null;
      email: string | null;
      phone: string | null;
      is_primary: boolean;
      is_signatory: boolean;
      department: string | null;
      contact_type: ContactType | null;
      is_portal_user: boolean;
      portal_role: string | null;
      branch_id: string | null;
    }>(
      `SELECT id, full_name, designation, email, phone, is_primary, is_signatory,
              department, contact_type, is_portal_user, portal_role, branch_id
       FROM hsdg.entity_contacts WHERE entity_id = $1 ORDER BY is_primary DESC, full_name`,
      [id],
    );
    const fins = await client.query<FinancialRow>(
      `SELECT id, financial_year, turnover, revenue, other_income, net_profit, profit_before_tax,
              net_worth, paid_up_capital, reserves_surplus, total_assets, total_borrowings,
              bank_pfi_borrowings, public_deposits, debentures, outstanding_loans, source,
              source_financial_year, verified, verified_by, verified_at, supporting_document_ref,
              is_current, supersedes_id, created_at
       FROM hsdg.entity_financial_profiles WHERE entity_id = $1
       ORDER BY financial_year DESC, is_current DESC, created_at DESC`,
      [id],
    );
    const addresses = await client.query<
      AddressRow & { branch_id: string | null; state_code: string | null }
    >(
      `SELECT id, address_type, line1, line2, city, state, pincode, country, is_primary, branch_id,
              state_code
       FROM hsdg.entity_addresses WHERE entity_id = $1 ORDER BY is_primary DESC, address_type`,
      [id],
    );
    const rels = await client.query<RelationshipRow>(
      `SELECT er.id, er.to_entity_id, te.legal_name AS to_legal_name, te.entity_code AS to_code,
              er.relationship_type, er.shareholding_pct, er.effective_from, er.effective_to,
              er.status, er.notes
       FROM hsdg.entity_relationships er
       JOIN hsdg.entities te ON te.id = er.to_entity_id
       WHERE er.from_entity_id = $1 ORDER BY er.relationship_type`,
      [id],
    );
    const merged = await client.query<{
      id: string;
      entity_code: string;
      legal_name: string;
      merged_at: string;
    }>(
      `SELECT k.id, k.entity_code, k.legal_name, d.merged_at
       FROM hsdg.entities d JOIN hsdg.entities k ON k.id = d.merged_into_id
       WHERE d.id = $1`,
      [id],
    );
    const acts = await client.query<BusinessActivityRow>(
      `SELECT ba.id, ba.industry_id, i.slug AS industry_slug, i.name AS industry_name,
              ba.nic_code_id, nc.code AS nic_code, ba.is_primary, ba.notes
       FROM hsdg.entity_business_activities ba
       JOIN hsdg.industries i ON i.id = ba.industry_id
       LEFT JOIN hsdg.nic_codes nc ON nc.id = ba.nic_code_id
       WHERE ba.entity_id = $1 ORDER BY ba.is_primary DESC, i.name`,
      [id],
    );
    const listings = await client.query<ListingRow>(
      `SELECT id, exchange, security_type, listing_date, status, symbol, notes
       FROM hsdg.entity_listings WHERE entity_id = $1 ORDER BY exchange, security_type`,
      [id],
    );
    const attrs = await client.query<RegulatoryAttributeRow>(
      `SELECT ra.id, ra.attribute_code, d.name AS attribute_name, ra.value_text, ra.value_number,
              ra.value_boolean, ra.value_date, ra.effective_from, ra.source, ra.notes
       FROM hsdg.entity_regulatory_attributes ra
       JOIN hsdg.entity_regulatory_attribute_defs d ON d.code = ra.attribute_code
       WHERE ra.entity_id = $1 ORDER BY ra.attribute_code`,
      [id],
    );

    const detail: EntityDetail = {
      ...mapSummary(row),
      roc: row.roc,
      authorisedCapital: num(row.authorised_capital),
      paidUpCapital: num(row.paid_up_capital),
      llpContribution: num(row.llp_contribution),
      businessDescription: row.business_description,
      activities: {
        manufacturing: row.act_manufacturing,
        trading: row.act_trading,
        services: row.act_services,
        import: row.act_import,
        export: row.act_export,
        ecommerce: row.act_ecommerce,
        regulated: row.act_regulated,
      },
      registrations: regs.rows.map((r) => ({
        id: r.id,
        registrationType: r.registration_type,
        registrationNumber: r.registration_number,
        stateCode: r.state_code,
        status: r.status,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        jurisdiction: r.jurisdiction,
        registrationDate: r.registration_date,
        issuingAuthority: r.issuing_authority,
        source: r.source,
        isPrincipal: r.is_principal,
        applicability: r.applicability,
        verified: r.verified,
        verifiedBy: r.verified_by,
        verifiedAt: r.verified_at,
        documentRef: r.document_ref,
        branchId: r.branch_id,
        stateName: r.state_code ? (GST_STATES[r.state_code] ?? null) : null,
        stateMismatch: r.state_mismatch_ack_at
          ? { byName: r.state_mismatch_ack_name, at: r.state_mismatch_ack_at.toISOString() }
          : null,
      })),
      contacts: contacts.rows.map((c) => ({
        id: c.id,
        fullName: c.full_name,
        designation: c.designation,
        email: c.email,
        phone: c.phone,
        isPrimary: c.is_primary,
        isSignatory: c.is_signatory,
        department: c.department,
        contactType: c.contact_type,
        isPortalUser: c.is_portal_user,
        portalRole: c.portal_role,
        branchId: c.branch_id,
      })),
      financialProfiles: fins.rows.map(mapFinancial),
      addresses: addresses.rows.map((a) => ({
        id: a.id,
        addressType: a.address_type,
        line1: a.line1,
        line2: a.line2,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
        country: a.country,
        isPrimary: a.is_primary,
        branchId: a.branch_id,
        stateCode: a.state_code,
      })),
      relationships: rels.rows.map((r) => ({
        id: r.id,
        toEntityId: r.to_entity_id,
        toEntityLegalName: r.to_legal_name,
        toEntityCode: r.to_code,
        relationshipType: r.relationship_type,
        shareholdingPct: num(r.shareholding_pct),
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        status: r.status,
        notes: r.notes,
      })),
      businessActivities: acts.rows.map((a) => ({
        id: a.id,
        industryId: a.industry_id,
        industrySlug: a.industry_slug,
        industryName: a.industry_name,
        nicCodeId: a.nic_code_id,
        nicCode: a.nic_code,
        isPrimary: a.is_primary,
        notes: a.notes,
      })),
      listings: listings.rows.map((l) => ({
        id: l.id,
        exchange: l.exchange,
        securityType: l.security_type,
        listingDate: l.listing_date,
        status: l.status,
        symbol: l.symbol,
        notes: l.notes,
      })),
      regulatoryAttributes: attrs.rows.map((a) => ({
        id: a.id,
        attributeCode: a.attribute_code,
        attributeName: a.attribute_name,
        valueText: a.value_text,
        valueNumber: num(a.value_number),
        valueBoolean: a.value_boolean,
        valueDate: a.value_date,
        effectiveFrom: a.effective_from,
        source: a.source,
        notes: a.notes,
      })),
      mergedInto: merged.rows[0]
        ? {
            id: merged.rows[0].id,
            entityCode: merged.rows[0].entity_code,
            legalName: merged.rows[0].legal_name,
            mergedAt: merged.rows[0].merged_at,
          }
        : null,
      entityTypeSource: typeSource.rows[0]?.entity_type_source ?? ENTITY_TYPE_SOURCE.legacy,
      entityTypeSetBy: typeSource.rows[0]?.set_by_name ?? null,
      entityTypeSetAt: typeSource.rows[0]?.entity_type_set_at ?? null,
      branches: branches.rows.map((b) => ({
        id: b.id,
        label: b.label,
        stateCode: b.state_code,
        isHeadOffice: b.is_head_office,
        archivedAt: b.archived_at,
        version: b.version,
      })),
    };
    return detail;
  }

  private async insertAddress(
    client: PoolClient,
    entityId: string,
    a: AddressInput,
  ): Promise<void> {
    const st = addressState({ stateCode: a.stateCode, state: a.state ?? null });
    await client.query(
      `INSERT INTO hsdg.entity_addresses
         (entity_id, address_type, line1, line2, city, state, pincode, country, is_primary,
          state_code)
       VALUES ($1,COALESCE($2,'registered'),$3,$4,$5,$6,$7,COALESCE($8,'IN'),COALESCE($9,false),
               $10)`,
      [
        entityId,
        a.addressType ?? null,
        a.line1,
        a.line2 ?? null,
        a.city ?? null,
        st.state ?? null,
        a.pincode ?? null,
        a.country ?? null,
        a.isPrimary ?? null,
        st.state_code ?? null,
      ],
    );
  }

  private async insertBusinessActivity(
    client: PoolClient,
    entityId: string,
    a: BusinessActivityInput,
  ): Promise<void> {
    const industryId = await this.resolveIndustryId(client, a.industrySlug);
    const nicCodeId = a.nicCode ? await this.resolveNicCodeId(client, a.nicCode) : null;
    await client.query(
      `INSERT INTO hsdg.entity_business_activities
         (entity_id, industry_id, nic_code_id, is_primary, notes)
       VALUES ($1,$2,$3,COALESCE($4,false),$5)`,
      [entityId, industryId, nicCodeId, a.isPrimary ?? null, a.notes ?? null],
    );
  }

  private async insertListing(
    client: PoolClient,
    entityId: string,
    l: ListingInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.entity_listings
         (entity_id, exchange, security_type, listing_date, status, symbol, notes)
       VALUES ($1,$2,COALESCE($3,'equity'),$4,COALESCE($5,'listed'),$6,$7)`,
      [
        entityId,
        l.exchange,
        l.securityType ?? null,
        l.listingDate ?? null,
        l.status ?? null,
        l.symbol ?? null,
        l.notes ?? null,
      ],
    );
  }

  private async insertRegulatoryAttribute(
    client: PoolClient,
    entityId: string,
    a: RegulatoryAttributeInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.entity_regulatory_attributes
         (entity_id, attribute_code, value_text, value_number, value_boolean, value_date,
          effective_from, source, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'client'),$9)`,
      [
        entityId,
        a.attributeCode,
        a.valueText ?? null,
        a.valueNumber ?? null,
        a.valueBoolean ?? null,
        a.valueDate ?? null,
        a.effectiveFrom ?? null,
        a.source ?? null,
        a.notes ?? null,
      ],
    );
  }

  /** Dynamic partial update of a child row, scoped to its parent entity. */
  private async updateChildRow(
    client: PoolClient,
    table: string,
    entityCol: string,
    entityId: string,
    childId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [col, val] of Object.entries(patch)) {
      if (val !== undefined) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length === 0) throw new BadRequestException('No fields to update.');
    params.push(childId, entityId);
    const result = await client.query(
      `UPDATE hsdg.${table} SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND ${entityCol} = $${params.length}`,
      params,
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new NotFoundException('Record not found for this entity.');
    }
  }

  private async removeChildRow(
    client: PoolClient,
    table: string,
    entityCol: string,
    entityId: string,
    childId: string,
  ): Promise<void> {
    const result = await client.query(
      `DELETE FROM hsdg.${table} WHERE id = $1 AND ${entityCol} = $2`,
      [childId, entityId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new NotFoundException('Record not found for this entity.');
    }
  }

  private async resolveIndustryId(client: PoolClient, slug: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.industries WHERE slug = $1`,
      [slug],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown industry "${slug}".`);
    return rows[0].id;
  }

  private async resolveNicCodeId(client: PoolClient, code: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.nic_codes WHERE code = $1`,
      [code],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown NIC code "${code}".`);
    return rows[0].id;
  }

  private async resolveTypeId(client: PoolClient, slug: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.entity_types WHERE slug = $1`,
      [slug],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown entity type "${slug}".`);
    return rows[0].id;
  }

  private async resolveOfficeId(client: PoolClient, code: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.offices WHERE code = $1`,
      [code],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown office "${code}".`);
    return rows[0].id;
  }
}

interface AddressRow {
  id: string;
  address_type: AddressType;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  is_primary: boolean;
}

interface RelationshipRow {
  id: string;
  to_entity_id: string;
  to_legal_name: string;
  to_code: string;
  relationship_type: RelationshipType;
  shareholding_pct: string | null;
  effective_from: string | null;
  effective_to: string | null;
  status: RelationshipStatus;
  notes: string | null;
}

interface BusinessActivityRow {
  id: string;
  industry_id: string;
  industry_slug: string;
  industry_name: string;
  nic_code_id: string | null;
  nic_code: string | null;
  is_primary: boolean;
  notes: string | null;
}

interface ListingRow {
  id: string;
  exchange: Exchange;
  security_type: SecurityType;
  listing_date: string | null;
  status: ListingLineStatus;
  symbol: string | null;
  notes: string | null;
}

interface RegulatoryAttributeRow {
  id: string;
  attribute_code: string;
  attribute_name: string;
  value_text: string | null;
  value_number: string | null;
  value_boolean: boolean | null;
  value_date: string | null;
  effective_from: string | null;
  source: RegulatoryAttributeSource;
  notes: string | null;
}

interface FinancialRow {
  id: string;
  financial_year: string;
  turnover: string | null;
  revenue: string | null;
  other_income: string | null;
  net_profit: string | null;
  profit_before_tax: string | null;
  net_worth: string | null;
  paid_up_capital: string | null;
  reserves_surplus: string | null;
  total_assets: string | null;
  total_borrowings: string | null;
  bank_pfi_borrowings: string | null;
  public_deposits: string | null;
  debentures: string | null;
  outstanding_loans: string | null;
  source: FinancialProfileRecord['source'];
  source_financial_year: string | null;
  verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  supporting_document_ref: string | null;
  is_current: boolean;
  supersedes_id: string | null;
  created_at: string;
}

function mapFinancial(r: FinancialRow): FinancialProfileRecord {
  return {
    id: r.id,
    financialYear: r.financial_year,
    turnover: num(r.turnover),
    revenue: num(r.revenue),
    otherIncome: num(r.other_income),
    netProfit: num(r.net_profit),
    profitBeforeTax: num(r.profit_before_tax),
    netWorth: num(r.net_worth),
    paidUpCapital: num(r.paid_up_capital),
    reservesSurplus: num(r.reserves_surplus),
    totalAssets: num(r.total_assets),
    totalBorrowings: num(r.total_borrowings),
    bankPfiBorrowings: num(r.bank_pfi_borrowings),
    publicDeposits: num(r.public_deposits),
    debentures: num(r.debentures),
    outstandingLoans: num(r.outstanding_loans),
    source: r.source,
    sourceFinancialYear: r.source_financial_year,
    verified: r.verified,
    verifiedBy: r.verified_by,
    verifiedAt: r.verified_at,
    supportingDocumentRef: r.supporting_document_ref,
    isCurrent: r.is_current,
    supersedesId: r.supersedes_id,
    createdAt: r.created_at,
  };
}

function mapSummary(row: SummaryRow): EntitySummary {
  return {
    id: row.id,
    entityCode: row.entity_code,
    legalName: row.legal_name,
    displayName: row.display_name,
    tradeName: row.trade_name,
    shortName: row.short_name,
    typeSlug: row.type_slug,
    typeName: row.type_name,
    typeCategory: row.type_category,
    pan: row.pan,
    status: row.status,
    legalStatus: row.legal_status,
    regulatoryProfileStatus: row.regulatory_profile_status,
    listingStatus: row.listing_status,
    currentAccountingFramework: row.current_accounting_framework,
    countryOfIncorporation: row.country_of_incorporation,
    clientId: row.client_id,
    officeId: row.home_office_id,
    officeCode: row.office_code,
    groupId: row.group_id,
    parentEntityId: row.parent_entity_id,
    incorporationDate: row.incorporation_date,
    registrationCount: Number(row.registration_count),
    branchCount: Number(row.branch_count ?? 0),
    primaryContactName: row.primary_contact_name,
    missingInfo: row.missing_info.map((code) => ({
      code,
      label: MISSING_INFO_LABEL[code],
      severity: 'recommended' as const,
    })),
    version: row.version,
    team: row.team ?? null,
  };
}

/** Map PostgreSQL constraint/RLS violations to clean HTTP errors. */
export function translatePgError(err: unknown): Error {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code === '23505') {
    if (e.constraint?.includes('pan')) {
      return new ConflictException('An entity with this PAN already exists.');
    }
    if (e.constraint?.includes('registration')) {
      return new ConflictException('This registration number is already recorded.');
    }
    if (e.constraint?.includes('financial')) {
      return new ConflictException('A current figure set already exists for this financial year.');
    }
    if (e.constraint?.includes('primary')) {
      return new ConflictException('The entity already has a primary contact.');
    }
    return new ConflictException('A duplicate value violates a unique constraint.');
  }
  if (e.code === '23503') return new BadRequestException('A referenced record does not exist.');
  // restrict_violation — a registration with a lodged return (its delete trigger says why).
  if (e.code === '23001') {
    return new ConflictException(e.message ?? 'This record is still in use.');
  }
  if (e.code === '23514' && e.constraint === 'registration_pan_mismatch')
    return new UnprocessableEntityException({ code: 'PAN_GSTIN_MISMATCH', message: e.message });
  if (e.code === '23514' && e.constraint === 'entity_pan_gstin_mismatch')
    return new UnprocessableEntityException({ code: 'PAN_GSTIN_MISMATCH', message: e.message });
  if (e.code === '23514')
    return new BadRequestException('A value violates a constraint (check the format).');
  // new row violates row-level security policy — writing outside your office.
  if (e.code === '42501') {
    return new ForbiddenException('Not permitted to write an entity for this office.');
  }
  return err as Error;
}
