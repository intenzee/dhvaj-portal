import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ENTITY_STATUS } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import type {
  ContactInput,
  CreateEntityInput,
  DuplicateCandidate,
  EntityDetail,
  EntityFilter,
  EntitySummary,
  EntityTypeRecord,
  RegistrationInput,
  RegistrationRecord,
  UpdateEntityInput,
} from './entities.types';

const ENTITY_SUMMARY_SELECT = `
  SELECT e.id, e.entity_code, e.legal_name, e.display_name, e.pan, e.status,
         e.incorporation_date, e.version, e.home_office_id, o.code AS office_code,
         e.entity_type_id, et.slug AS type_slug, et.name AS type_name,
         et.category AS type_category, e.parent_entity_id,
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
  pan: string | null;
  status: EntitySummary['status'];
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
      // Page first (with the windowed total over the filtered set), THEN compute
      // the per-entity counts — so the correlated subqueries run only for the
      // rows on this page, not for every matching row before LIMIT.
      const { rows } = await client.query<SummaryRow & { total_count: string }>(
        `SELECT sub.*,
                (SELECT count(*) FROM hsdg.entity_registrations r WHERE r.entity_id = sub.id)
                  AS registration_count,
                (SELECT ec.full_name FROM hsdg.entity_contacts ec
                   WHERE ec.entity_id = sub.id AND ec.is_primary LIMIT 1)
                  AS primary_contact_name
         FROM (
           SELECT e.id, e.entity_code, e.legal_name, e.display_name, e.pan, e.status,
                  e.incorporation_date, e.version, e.home_office_id, o.code AS office_code,
                  et.slug AS type_slug, et.name AS type_name, et.category AS type_category,
                  e.parent_entity_id, count(*) OVER() AS total_count
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
             (legal_name, display_name, entity_type_id, pan, home_office_id,
              parent_entity_id, status, incorporation_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            input.legalName,
            input.displayName ?? null,
            typeId,
            input.pan ?? null,
            officeId,
            input.parentEntityId ?? null,
            input.status ?? ENTITY_STATUS.active,
            input.incorporationDate ?? null,
          ],
        );
        entityId = rows[0]!.id;

        for (const reg of input.registrations ?? []) {
          await this.insertRegistration(client, entityId, reg);
        }
        for (const contact of input.contacts ?? []) {
          await this.insertContact(client, entityId, contact);
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
      if (input.typeSlug !== undefined) {
        set('entity_type_id', await this.resolveTypeId(client, input.typeSlug));
      }
      if (input.officeCode !== undefined) {
        set('home_office_id', await this.resolveOfficeId(client, input.officeCode));
      }
      if (input.pan !== undefined) set('pan', input.pan);
      if (input.parentEntityId !== undefined) set('parent_entity_id', input.parentEntityId);
      if (input.status !== undefined) set('status', input.status);
      if (input.incorporationDate !== undefined) set('incorporation_date', input.incorporationDate);

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
    return this.mutateChild(ctx, entityId, 'entity.registration_added', (client) =>
      this.insertRegistration(client, entityId, input),
    );
  }

  async addContact(ctx: RlsContext, entityId: string, input: ContactInput): Promise<EntityDetail> {
    return this.mutateChild(ctx, entityId, 'entity.contact_added', (client) =>
      this.insertContact(client, entityId, input),
    );
  }

  /** Shared flow for adding a child row: scope-check, insert, audit, return detail. */
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

  private async insertRegistration(
    client: PoolClient,
    entityId: string,
    reg: RegistrationInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.entity_registrations
         (entity_id, registration_type, registration_number, state_code, status, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entityId,
        reg.registrationType,
        reg.registrationNumber,
        reg.stateCode ?? null,
        reg.status ?? 'active',
        reg.validFrom ?? null,
        reg.validTo ?? null,
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
         (entity_id, full_name, designation, email, phone, is_primary, is_signatory)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entityId,
        contact.fullName,
        contact.designation ?? null,
        contact.email ?? null,
        contact.phone ?? null,
        contact.isPrimary ?? false,
        contact.isSignatory ?? false,
      ],
    );
  }

  private async selectDetail(client: PoolClient, id: string): Promise<EntityDetail | null> {
    const { rows } = await client.query<SummaryRow>(`${ENTITY_SUMMARY_SELECT} WHERE e.id = $1`, [
      id,
    ]);
    if (!rows[0]) return null;

    const regs = await client.query<{
      id: string;
      registration_type: RegistrationRecord['registrationType'];
      registration_number: string;
      state_code: string | null;
      status: RegistrationRecord['status'];
      valid_from: string | null;
      valid_to: string | null;
    }>(
      `SELECT id, registration_type, registration_number, state_code, status, valid_from, valid_to
       FROM hsdg.entity_registrations WHERE entity_id = $1 ORDER BY registration_type`,
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
    }>(
      `SELECT id, full_name, designation, email, phone, is_primary, is_signatory
       FROM hsdg.entity_contacts WHERE entity_id = $1 ORDER BY is_primary DESC, full_name`,
      [id],
    );

    return {
      ...mapSummary(rows[0]),
      registrations: regs.rows.map((r) => ({
        id: r.id,
        registrationType: r.registration_type,
        registrationNumber: r.registration_number,
        stateCode: r.state_code,
        status: r.status,
        validFrom: r.valid_from,
        validTo: r.valid_to,
      })),
      contacts: contacts.rows.map((c) => ({
        id: c.id,
        fullName: c.full_name,
        designation: c.designation,
        email: c.email,
        phone: c.phone,
        isPrimary: c.is_primary,
        isSignatory: c.is_signatory,
      })),
    };
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

function mapSummary(row: SummaryRow): EntitySummary {
  return {
    id: row.id,
    entityCode: row.entity_code,
    legalName: row.legal_name,
    displayName: row.display_name,
    typeSlug: row.type_slug,
    typeName: row.type_name,
    typeCategory: row.type_category,
    pan: row.pan,
    status: row.status,
    officeId: row.home_office_id,
    officeCode: row.office_code,
    parentEntityId: row.parent_entity_id,
    incorporationDate: row.incorporation_date,
    registrationCount: Number(row.registration_count),
    primaryContactName: row.primary_contact_name,
    version: row.version,
  };
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
