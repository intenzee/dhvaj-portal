import { Injectable } from '@nestjs/common';
import {
  CHANGE_LOG_AREAS,
  changeLogFieldLabel,
  type ChangeLogEntry,
  type ChangeLogField,
  type ChangeLogOp,
} from '@hsdg/contracts';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';

export interface ChangeLogFilter {
  entityId?: string;
  engagementId?: string;
  actorUserId?: string;
  table?: string;
  op?: ChangeLogOp;
  q?: string;
  from?: string;
  to?: string;
}

interface Row {
  id: string;
  occurred_at: Date;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  table_name: string;
  op: ChangeLogOp;
  row_id: string | null;
  label: string | null;
  entity_id: string | null;
  entity_code: string | null;
  entity_name: string | null;
  engagement_id: string | null;
  engagement_code: string | null;
  changes: Record<string, unknown>;
  total_count: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A logged value as text; an id the lookup named, by its name. */
function show(value: unknown, names: Map<string, string>): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return names.get(value) ?? value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null))
    return value.map((v) => show(v, names) ?? '—').join(', ') || '—';
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'string' ? (names.get(v) ?? v) : v,
  );
}

/** Every id-shaped string in the logged values. */
function idsIn(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (UUID.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) idsIn(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) idsIn(v, out);
  }
}

/**
 * Reads the change log (written by the database's log_change trigger). Row
 * Level Security shows it to the Managing Partner and administrators only.
 */
@Injectable()
export class ChangeLogService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    ctx: RlsContext,
    filter: ChangeLogFilter,
    page: PageParams,
  ): Promise<PageResult<ChangeLogEntry>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, value: unknown): void => {
        params.push(value);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (filter.entityId) add('c.entity_id = ?', filter.entityId);
      if (filter.engagementId) add('c.engagement_id = ?', filter.engagementId);
      if (filter.actorUserId) add('c.actor_user_id = ?', filter.actorUserId);
      if (filter.table) add('c.table_name = ?', filter.table);
      if (filter.op) add('c.op = ?', filter.op);
      if (filter.from) add('c.occurred_at >= ?::date', filter.from);
      if (filter.to) add(`c.occurred_at < ?::date + 1`, filter.to);
      if (filter.q?.trim()) {
        params.push(`%${filter.q.trim()}%`);
        const p = `$${params.length}`;
        where.push(
          `(c.label ILIKE ${p} OR ent.legal_name ILIKE ${p} OR ent.entity_code ILIKE ${p}
            OR eng.engagement_code ILIKE ${p} OR emp.full_name ILIKE ${p} OR u.email ILIKE ${p})`,
        );
      }
      params.push(page.limit, page.offset);
      const { rows } = await client.query<Row>(
        `SELECT c.id::text, c.occurred_at, c.actor_user_id,
                COALESCE(emp.full_name, u.display_name, u.email::text) AS actor_name,
                c.actor_role, c.table_name, c.op, c.row_id, c.label,
                c.entity_id, ent.entity_code, ent.legal_name AS entity_name,
                c.engagement_id, eng.engagement_code, c.changes,
                count(*) OVER () AS total_count
           FROM hsdg.change_log c
           LEFT JOIN hsdg.users u ON u.id = c.actor_user_id
           LEFT JOIN hsdg.employees emp ON emp.user_id = c.actor_user_id AND emp.deleted_at IS NULL
           LEFT JOIN hsdg.entities ent ON ent.id = c.entity_id
           LEFT JOIN hsdg.engagements eng ON eng.id = c.engagement_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY c.occurred_at DESC, c.id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const names = await this.names(client, rows);
      return {
        items: rows.map((r) => ({
          id: r.id,
          occurredAt: r.occurred_at.toISOString(),
          actorUserId: r.actor_user_id,
          actorName: r.actor_name,
          actorRole: r.actor_role,
          table: r.table_name,
          area: CHANGE_LOG_AREAS[r.table_name] ?? r.table_name,
          op: r.op,
          rowId: r.row_id,
          label: r.label,
          entityId: r.entity_id,
          entityCode: r.entity_code,
          entityName: r.entity_name,
          engagementId: r.engagement_id,
          engagementCode: r.engagement_code,
          fields: this.fields(r, names),
        })),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  private fields(r: Row, names: Map<string, string>): ChangeLogField[] {
    const skip = new Set(['entity_id', 'engagement_id']);
    return Object.entries(r.changes ?? {})
      .filter(([k]) => !(r.op !== 'update' && skip.has(k)))
      .map(([field, v]) => {
        const [before, after] =
          r.op === 'update' && Array.isArray(v)
            ? [v[0], v[1]]
            : r.op === 'delete'
              ? [v, null]
              : [null, v];
        return {
          field,
          label: changeLogFieldLabel(field),
          before: show(before, names),
          after: show(after, names),
        };
      });
  }

  /** The people, offices, clients, services … the logged ids name. */
  private async names(client: PoolClient, rows: Row[]): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const r of rows) idsIn(r.changes, ids);
    if (ids.size === 0) return new Map();
    const { rows: found } = await client.query<{ id: string; name: string }>(
      `WITH ids AS (SELECT unnest($1::uuid[]) AS id)
       SELECT ids.id::text,
              COALESCE(emp.full_name, eu.full_name, u.display_name, u.email::text,
                       o.code || ' · ' || o.name, ent.entity_code || ' · ' || ent.legal_name,
                       eng.engagement_code, s.name, et.name, reg.registration_number,
                       t.name, ind.name, g.name, b.label) AS name
         FROM ids
         LEFT JOIN hsdg.employees emp ON emp.id = ids.id
         LEFT JOIN hsdg.users u ON u.id = ids.id
         LEFT JOIN hsdg.employees eu ON eu.user_id = u.id AND eu.deleted_at IS NULL
         LEFT JOIN hsdg.offices o ON o.id = ids.id
         LEFT JOIN hsdg.entities ent ON ent.id = ids.id
         LEFT JOIN hsdg.engagements eng ON eng.id = ids.id
         LEFT JOIN hsdg.services s ON s.id = ids.id
         LEFT JOIN hsdg.entity_types et ON et.id = ids.id
         LEFT JOIN hsdg.entity_registrations reg ON reg.id = ids.id
         LEFT JOIN hsdg.teams t ON t.id = ids.id
         LEFT JOIN hsdg.industries ind ON ind.id = ids.id
         LEFT JOIN hsdg.entity_groups g ON g.id = ids.id
         LEFT JOIN hsdg.entity_branches b ON b.id = ids.id`,
      [[...ids]],
    );
    return new Map(found.filter((f) => f.name).map((f) => [f.id, f.name]));
  }
}
