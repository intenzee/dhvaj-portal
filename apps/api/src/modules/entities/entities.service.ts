import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ENTITY_STATUS,
  REGULATORY_PROFILE_STATUS,
  type ContactType,
  type MissingInfoItem,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
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
} from '@hsdg/contracts';

// Summary-level columns, shared by the list and detail selects so mapSummary
// can consume either. Aliased to stable names.
const ENTITY_SUMMARY_COLS = `
  e.id, e.entity_code, e.legal_name, e.display_name, e.trade_name, e.short_name,
  e.pan, e.status, e.legal_status, e.regulatory_profile_status, e.listing_status,
  e.current_accounting_framework, e.country_of_incorporation, e.client_id,
  e.group_id, e.incorporation_date, e.version, e.home_office_id,
  e.entity_type_id, e.parent_entity_id`;

const ENTITY_SUMMARY_SELECT = `
  SELECT ${ENTITY_SUMMARY_COLS}, o.code AS office_code,
         et.slug AS type_slug, et.name AS type_name, et.category AS type_category,
         e.roc, e.authorised_capital, e.paid_up_capital, e.llp_contribution,
         e.business_description, e.act_manufacturing, e.act_trading, e.act_services,
         e.act_import, e.act_export, e.act_ecommerce, e.act_regulated,
         (SELECT count(*) FROM hsdg.entity_registrations r WHERE r.entity_id = e.id) AS registration_count,
         (SELECT ec.full_name FROM hsdg.entity_contacts ec
            WHERE ec.entity_id = e.id AND ec.is_primary LIMIT 1) AS primary_contact_name
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
  primary_contact_name: string | null;
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

@Injectable()
export class EntitiesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
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
    const conditions: string[] = [];
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
                (SELECT ec.full_name FROM hsdg.entity_contacts ec
                   WHERE ec.entity_id = sub.id AND ec.is_primary LIMIT 1)
                  AS primary_contact_name
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
        `SELECT id, entity_code, legal_name, pan, score, match_reason FROM (
           SELECT id, entity_code, legal_name, pan, 1.0::float AS score, 'pan' AS match_reason
           FROM hsdg.entities
           WHERE $1::text IS NOT NULL AND pan = $1
           UNION
           SELECT id, entity_code, legal_name, pan,
                  similarity(lower(legal_name), lower($2)) AS score, 'name' AS match_reason
           FROM hsdg.entities
           WHERE $2::text IS NOT NULL AND similarity(lower(legal_name), lower($2)) > 0.3
         ) matches
         ORDER BY score DESC, legal_name
         LIMIT 10`,
        [args.pan ?? null, args.legalName ?? null],
      );
      return rows.map((r) => ({
        id: r.id,
        entityCode: r.entity_code,
        legalName: r.legal_name,
        pan: r.pan,
        score: Number(r.score),
        matchReason: r.match_reason,
      }));
    });
  }

  async createEntity(ctx: RlsContext, input: CreateEntityInput): Promise<EntityDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const typeId = await this.resolveTypeId(client, input.typeSlug);
      const officeId = await this.resolveOfficeId(client, input.officeCode);

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
    });
  }

  async updateEntity(ctx: RlsContext, id: string, input: UpdateEntityInput): Promise<EntityDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
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
      if (input.typeSlug !== undefined) {
        set('entity_type_id', await this.resolveTypeId(client, input.typeSlug));
      }
      if (input.officeCode !== undefined) {
        set('home_office_id', await this.resolveOfficeId(client, input.officeCode));
      }
      if (input.clientId !== undefined) set('client_id', input.clientId);
      if (input.pan !== undefined) set('pan', input.pan);
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

      const after = await this.selectDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'entity.updated',
        objectType: 'entity',
        objectId: id,
        before,
        after,
      });
      return after!;
    });
  }

  async addRegistration(
    ctx: RlsContext,
    entityId: string,
    input: RegistrationInput,
  ): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.registration_added', async (client) => {
      await this.insertRegistration(client, entityId, input);
      await this.flagReassessmentIfComplete(client, entityId);
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
      if (input.stateCode !== undefined) set('state_code', input.stateCode);
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
      const result = await client.query(
        `UPDATE hsdg.entity_registrations SET ${sets.join(', ')}
         WHERE id = $${params.length - 1} AND entity_id = $${params.length}`,
        params,
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('Registration not found for this entity.');
      }
      await this.flagReassessmentIfComplete(client, entityId);
    });
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

  async addContact(ctx: RlsContext, entityId: string, input: ContactInput): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.contact_added', (client) =>
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
        state: input.state,
        pincode: input.pincode,
        country: input.country,
        is_primary: input.isPrimary,
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
    return this.db.withRlsContext(ctx, async (client) => {
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
    });
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

  private async insertRegistration(
    client: PoolClient,
    entityId: string,
    reg: RegistrationInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.entity_registrations
         (entity_id, registration_type, registration_number, state_code, status,
          valid_from, valid_to, jurisdiction, registration_date, issuing_authority,
          source, is_principal, applicability, document_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               COALESCE($11,'client'),COALESCE($12,true),COALESCE($13,'unknown'),$14)`,
      [
        entityId,
        reg.registrationType,
        reg.registrationNumber,
        reg.stateCode ?? null,
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
    }>(
      `SELECT id, registration_type, registration_number, state_code, status, valid_from,
              valid_to, jurisdiction, registration_date, issuing_authority, source,
              is_principal, applicability, verified, verified_by, verified_at, document_ref
       FROM hsdg.entity_registrations WHERE entity_id = $1
       ORDER BY registration_type, is_principal DESC`,
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
    }>(
      `SELECT id, full_name, designation, email, phone, is_primary, is_signatory,
              department, contact_type, is_portal_user, portal_role
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
    const addresses = await client.query<AddressRow>(
      `SELECT id, address_type, line1, line2, city, state, pincode, country, is_primary
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
      missingInfo: [],
    };
    detail.missingInfo = computeMissingInfo(detail);
    return detail;
  }

  private async insertAddress(
    client: PoolClient,
    entityId: string,
    a: AddressInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.entity_addresses
         (entity_id, address_type, line1, line2, city, state, pincode, country, is_primary)
       VALUES ($1,COALESCE($2,'registered'),$3,$4,$5,$6,$7,COALESCE($8,'IN'),COALESCE($9,false))`,
      [
        entityId,
        a.addressType ?? null,
        a.line1,
        a.line2 ?? null,
        a.city ?? null,
        a.state ?? null,
        a.pincode ?? null,
        a.country ?? null,
        a.isPrimary ?? null,
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
    primaryContactName: row.primary_contact_name,
    version: row.version,
  };
}

/**
 * Progressive-completion signal (§5/§27/§28). Reports what is ABSENT so it can
 * be surfaced prominently — never as "Not Applicable". Creation is not blocked
 * by these; they are enrichment prompts, not statutory conclusions.
 */
export function computeMissingInfo(d: EntityDetail): MissingInfoItem[] {
  const items: MissingInfoItem[] = [];
  const rec = (code: string, label: string): void => {
    items.push({ code, label, severity: 'recommended' });
  };
  if (!d.pan) rec('pan', 'PAN not recorded');
  if (!d.incorporationDate) rec('incorporation_date', 'Date of incorporation/birth not recorded');
  if (!d.legalStatus) rec('legal_status', 'Legal/operational status not assessed');
  if (d.registrations.length === 0) rec('registrations', 'No registrations recorded');
  if (!d.contacts.some((c) => c.isPrimary)) rec('primary_contact', 'No primary contact recorded');
  if (d.financialProfiles.filter((f) => f.isCurrent).length === 0)
    rec('financials', 'No financial year recorded');
  // A company/LLP without its identity registration is a notable gap.
  if (d.typeCategory === 'company' && !d.registrations.some((r) => r.registrationType === 'cin'))
    rec('cin', 'CIN not recorded for a company');
  if (d.typeCategory === 'llp' && !d.registrations.some((r) => r.registrationType === 'llpin'))
    rec('llpin', 'LLPIN not recorded for an LLP');
  return items;
}

/** Map PostgreSQL constraint/RLS violations to clean HTTP errors. */
export function translatePgError(err: unknown): Error {
  const e = err as { code?: string; constraint?: string };
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
  if (e.code === '23514')
    return new BadRequestException('A value violates a constraint (check the format).');
  // new row violates row-level security policy — writing outside your office.
  if (e.code === '42501') {
    return new ForbiddenException('Not permitted to write an entity for this office.');
  }
  return err as Error;
}
