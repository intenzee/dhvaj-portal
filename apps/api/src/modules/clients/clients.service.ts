import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { translatePgError } from '../entities/entities.service';
import type {
  ClientDetail,
  ClientFilter,
  ClientSummary,
  CreateClientInput,
  UpdateClientInput,
} from './clients.types';

const CLIENT_COLS = `
  c.id, c.client_code, c.name, c.short_name, c.client_kind, c.status,
  c.home_office_id, o.code AS office_code, c.group_id, c.version,
  (SELECT count(*) FROM hsdg.entities e WHERE e.client_id = c.id) AS entity_count`;

interface ClientRow {
  id: string;
  client_code: string;
  name: string;
  short_name: string | null;
  client_kind: ClientSummary['clientKind'];
  status: ClientSummary['status'];
  home_office_id: string;
  office_code: string;
  group_id: string | null;
  version: number;
  entity_count: string;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async listClients(
    ctx: RlsContext,
    filter: ClientFilter,
    page: PageParams,
  ): Promise<PageResult<ClientSummary>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`c.status = $${params.length}`);
    }
    if (filter.kind) {
      params.push(filter.kind);
      conditions.push(`c.client_kind = $${params.length}`);
    }
    if (filter.officeCode) {
      params.push(filter.officeCode);
      conditions.push(`o.code = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search}%`);
      conditions.push(`(c.name ILIKE $${params.length} OR c.client_code ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(page.limit, page.offset);
    const limitParam = `$${params.length - 1}`;
    const offsetParam = `$${params.length}`;

    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ClientRow & { total_count: string }>(
        `SELECT ${CLIENT_COLS}, count(*) OVER() AS total_count
         FROM hsdg.clients c
         JOIN hsdg.offices o ON o.id = c.home_office_id
         ${where}
         ORDER BY c.name
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params,
      );
      return {
        items: rows.map(mapClient),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  async getClientById(ctx: RlsContext, id: string): Promise<ClientDetail | null> {
    return this.db.withRlsContext(ctx, (client) => this.selectDetail(client, id));
  }

  async createClient(ctx: RlsContext, input: CreateClientInput): Promise<ClientDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const officeId = await this.resolveOfficeId(client, input.officeCode);
      let clientId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.clients (name, short_name, client_kind, home_office_id, group_id, status)
           VALUES ($1,$2,COALESCE($3,'legal_entity'),$4,$5,COALESCE($6,'active'))
           RETURNING id`,
          [
            input.name,
            input.shortName ?? null,
            input.clientKind ?? null,
            officeId,
            input.groupId ?? null,
            input.status ?? null,
          ],
        );
        clientId = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err);
      }
      const detail = await this.selectDetail(client, clientId);
      await this.audit.recordWith(client, ctx, {
        action: 'client.created',
        objectType: 'client',
        objectId: clientId,
        after: detail,
      });
      return detail!;
    });
  }

  async updateClient(ctx: RlsContext, id: string, input: UpdateClientInput): Promise<ClientDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.selectDetail(client, id);
      if (!before) throw new NotFoundException('Client not found.');

      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.name !== undefined) set('name', input.name);
      if (input.shortName !== undefined) set('short_name', input.shortName);
      if (input.clientKind !== undefined) set('client_kind', input.clientKind);
      if (input.officeCode !== undefined) {
        set('home_office_id', await this.resolveOfficeId(client, input.officeCode));
      }
      if (input.groupId !== undefined) set('group_id', input.groupId);
      if (input.status !== undefined) set('status', input.status);
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
          `UPDATE hsdg.clients SET ${sets.join(', ')} WHERE id = ${idParam}${versionClause}`,
          params,
        );
        updated = result.rowCount ?? 0;
      } catch (err) {
        throw translatePgError(err);
      }
      if (updated === 0) {
        throw new ConflictException(
          'Client was modified by someone else. Refresh and retry (stale version).',
        );
      }
      const after = await this.selectDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'client.updated',
        objectType: 'client',
        objectId: id,
        before,
        after,
      });
      return after!;
    });
  }

  private async selectDetail(client: PoolClient, id: string): Promise<ClientDetail | null> {
    const { rows } = await client.query<ClientRow>(
      `SELECT ${CLIENT_COLS}
       FROM hsdg.clients c JOIN hsdg.offices o ON o.id = c.home_office_id
       WHERE c.id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    const entities = await client.query<{ id: string; entity_code: string; legal_name: string }>(
      `SELECT id, entity_code, legal_name FROM hsdg.entities WHERE client_id = $1 ORDER BY legal_name`,
      [id],
    );
    return {
      ...mapClient(rows[0]),
      entities: entities.rows.map((e) => ({
        id: e.id,
        entityCode: e.entity_code,
        legalName: e.legal_name,
      })),
    };
  }

  private async resolveOfficeId(client: PoolClient, code: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.offices WHERE code = $1`,
      [code],
    );
    if (!rows[0]) throw new NotFoundException(`Unknown office "${code}".`);
    return rows[0].id;
  }
}

function mapClient(r: ClientRow): ClientSummary {
  return {
    id: r.id,
    clientCode: r.client_code,
    name: r.name,
    shortName: r.short_name,
    clientKind: r.client_kind,
    status: r.status,
    officeId: r.home_office_id,
    officeCode: r.office_code,
    groupId: r.group_id,
    entityCount: Number(r.entity_count),
    version: r.version,
  };
}
