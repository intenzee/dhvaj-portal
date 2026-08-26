import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  ComponentApplicabilityDefault,
  Recurrence,
  ServiceComponentRecord,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { translatePgError as mapPgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';
import type { CreateServiceComponentInput, UpdateServiceComponentInput } from './components.types';

interface ComponentRow {
  id: string;
  service_id: string;
  service_code: string;
  code: string;
  name: string;
  description: string | null;
  default_applicability: ComponentApplicabilityDefault;
  default_frequency: Recurrence;
  compliance_rule_id: string | null;
  compliance_rule_code: string | null;
  display_order: number;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const COMPONENT_BASE = `
  SELECT sc.id, sc.service_id, s.code AS service_code, sc.code, sc.name, sc.description,
         sc.default_applicability, sc.default_frequency,
         sc.compliance_rule_id, cr.code AS compliance_rule_code,
         sc.display_order, sc.is_active, sc.version, sc.created_at, sc.updated_at
  FROM hsdg.service_components sc
  JOIN hsdg.services s ON s.id = sc.service_id
  LEFT JOIN hsdg.compliance_rules cr ON cr.id = sc.compliance_rule_id`;

/**
 * Firm-wide component CATALOGUE (spec §11/§13/§36). The scopes/obligations
 * available under a service, their default applicability and frequency, and an
 * optional link to the compliance rule that governs the deadline. Reads need
 * `service.read` (all staff); writes need `service.manage` and are additionally
 * floored by `ctx_is_firmwide` RLS — no source change to add a component.
 */
@Injectable()
export class ServiceComponentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(
    ctx: RlsContext,
    page: PageParams,
    filter: { serviceCode?: string; serviceId?: string; activeOnly?: boolean },
  ): Promise<PageResult<ServiceComponentRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter.serviceCode) {
        params.push(filter.serviceCode);
        conditions.push(`s.code = $${params.length}`);
      }
      if (filter.serviceId) {
        params.push(filter.serviceId);
        conditions.push(`sc.service_id = $${params.length}`);
      }
      if (filter.activeOnly) conditions.push(`sc.is_active = true`);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      // Single query: count(*) OVER() reports the full filtered total (computed
      // before LIMIT), so page + total come back together (same pattern as the
      // compliance-rules list).
      params.push(page.limit, page.offset);
      const { rows } = await client.query<ComponentRow & { total_count: string }>(
        `SELECT c.*, count(*) OVER() AS total_count
         FROM (${COMPONENT_BASE} ${where}) c
         ORDER BY c.service_code, c.display_order, c.code
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: rows.map(mapComponent),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  async getOne(ctx: RlsContext, idOrCode: string): Promise<ServiceComponentRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const component = await this.selectComponent(client, idOrCode);
      if (!component) throw new NotFoundException('Service component not found.');
      return component;
    });
  }

  async create(
    ctx: RlsContext,
    input: CreateServiceComponentInput,
  ): Promise<ServiceComponentRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const serviceId = await resolveServiceId(client, input.serviceCode);
      const complianceRuleId = input.complianceRuleCode
        ? await resolveRuleId(client, input.complianceRuleCode)
        : null;
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.service_components
             (service_id, code, name, description, default_applicability, default_frequency,
              compliance_rule_id, display_order)
           VALUES ($1,$2,$3,$4,COALESCE($5,'optional'),COALESCE($6,'as_required'),$7,COALESCE($8,0))
           RETURNING id`,
          [
            serviceId,
            input.code,
            input.name,
            input.description ?? null,
            input.defaultApplicability ?? null,
            input.defaultFrequency ?? null,
            complianceRuleId,
            input.displayOrder ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateComponentError(err);
      }
      const component = (await this.selectComponent(client, id))!;
      await this.audit.recordWith(client, ctx, {
        action: 'component.created',
        objectType: 'service_component',
        objectId: id,
        after: { code: input.code, serviceCode: input.serviceCode },
      });
      return component;
    });
  }

  async update(
    ctx: RlsContext,
    id: string,
    input: UpdateServiceComponentInput,
  ): Promise<ServiceComponentRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.name !== undefined) push('name', input.name);
      if (input.description !== undefined) push('description', input.description);
      if (input.defaultApplicability !== undefined)
        push('default_applicability', input.defaultApplicability);
      if (input.defaultFrequency !== undefined) push('default_frequency', input.defaultFrequency);
      if (input.displayOrder !== undefined) push('display_order', input.displayOrder);
      if (input.isActive !== undefined) push('is_active', input.isActive);
      if (input.complianceRuleCode !== undefined) {
        const ruleId =
          input.complianceRuleCode === null
            ? null
            : await resolveRuleId(client, input.complianceRuleCode);
        push('compliance_rule_id', ruleId);
      }
      if (sets.length === 0) return this.getOne(ctx, id);

      params.push(id);
      let updated: number;
      try {
        const result = await client.query(
          `UPDATE hsdg.service_components
           SET ${sets.join(', ')}, version = version + 1
           WHERE id = $${params.length}`,
          params,
        );
        updated = result.rowCount ?? 0;
      } catch (err) {
        throw translateComponentError(err);
      }
      if (updated === 0) throw new NotFoundException('Service component not found.');
      const component = (await this.selectComponent(client, id))!;
      await this.audit.recordWith(client, ctx, {
        action: 'component.updated',
        objectType: 'service_component',
        objectId: id,
        after: { fields: sets.map((s) => s.split(' = ')[0]) },
      });
      return component;
    });
  }

  private async selectComponent(
    client: PoolClient,
    idOrCode: string,
  ): Promise<ServiceComponentRecord | null> {
    const byId = /^[0-9a-f-]{36}$/i.test(idOrCode);
    const { rows } = await client.query<ComponentRow>(
      `${COMPONENT_BASE} WHERE sc.${byId ? 'id' : 'code'} = $1`,
      [idOrCode],
    );
    return rows[0] ? mapComponent(rows[0]) : null;
  }
}

async function resolveServiceId(client: PoolClient, serviceCode: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM hsdg.services WHERE code = $1`,
    [serviceCode],
  );
  if (!rows[0]) throw new BadRequestException(`Unknown service "${serviceCode}".`);
  return rows[0].id;
}

async function resolveRuleId(client: PoolClient, ruleCode: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM hsdg.compliance_rules WHERE code = $1`,
    [ruleCode],
  );
  if (!rows[0]) throw new BadRequestException(`Unknown compliance rule "${ruleCode}".`);
  return rows[0].id;
}

function mapComponent(row: ComponentRow): ServiceComponentRecord {
  return {
    id: row.id,
    serviceId: row.service_id,
    serviceCode: row.service_code,
    code: row.code,
    name: row.name,
    description: row.description,
    defaultApplicability: row.default_applicability,
    defaultFrequency: row.default_frequency,
    complianceRuleId: row.compliance_rule_id,
    complianceRuleCode: row.compliance_rule_code,
    displayOrder: row.display_order,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Map PostgreSQL constraint/RLS violations to clean HTTP errors (component catalogue). */
export function translateComponentError(err: unknown): Error {
  return mapPgError(err, {
    unique: [
      { match: 'service_components_code', message: 'A component with that code already exists.' },
    ],
    uniqueDefault: 'A duplicate value violates a unique constraint.',
    foreignKey: 'A referenced record does not exist.',
    check: (message) =>
      message && message.length <= 200 ? message : 'A value violates a check constraint.',
    forbidden: 'Not permitted to write this component.',
  });
}
