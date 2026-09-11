import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  ComponentDocChecklistItem,
  CreateComponentDocRequirementInput,
  ServiceComponentDocRequirementRecord,
  UpdateComponentDocRequirementInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { translatePgError as mapPgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';

interface RequirementRow {
  id: string;
  service_component_id: string;
  name: string;
  description: string | null;
  is_mandatory: boolean;
  display_order: number;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const REQ_BASE = `
  SELECT r.id, r.service_component_id, r.name, r.description, r.is_mandatory,
         r.display_order, r.is_active, r.version, r.created_at, r.updated_at
  FROM hsdg.service_component_doc_requirements r`;

/**
 * Required-documents checklist catalogue (feature: "what's missing"). Per service
 * component, the firm lists the documents each period should carry (e.g. GST →
 * GSTR-1, GSTR-3B). Reads need `service.read` (all staff); writes need
 * `service.manage` and are floored by `ctx_is_firmwide` RLS. The satisfied/missing
 * state is resolved per component-work period against documents tagged with the
 * requirement.
 */
@Injectable()
export class ComponentDocRequirementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** All requirements (active + inactive) for one service component. */
  async list(
    ctx: RlsContext,
    serviceComponentId: string,
  ): Promise<ServiceComponentDocRequirementRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<RequirementRow>(
        `${REQ_BASE} WHERE r.service_component_id = $1 ORDER BY r.display_order, r.name`,
        [serviceComponentId],
      );
      return rows.map(mapRequirement);
    });
  }

  async create(
    ctx: RlsContext,
    serviceComponentId: string,
    input: CreateComponentDocRequirementInput,
  ): Promise<ServiceComponentDocRequirementRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.service_component_doc_requirements
             (service_component_id, name, description, is_mandatory, display_order)
           VALUES ($1,$2,$3,COALESCE($4,true),COALESCE($5,0))
           RETURNING id`,
          [
            serviceComponentId,
            input.name,
            input.description ?? null,
            input.isMandatory ?? null,
            input.displayOrder ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateRequirementError(err);
      }
      const record = (await this.selectOne(client, id))!;
      await this.audit.recordWith(client, ctx, {
        action: 'component_doc_requirement.created',
        objectType: 'service_component_doc_requirement',
        objectId: id,
        after: { serviceComponentId, name: input.name },
      });
      return record;
    });
  }

  async update(
    ctx: RlsContext,
    id: string,
    input: UpdateComponentDocRequirementInput,
  ): Promise<ServiceComponentDocRequirementRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.name !== undefined) push('name', input.name);
      if (input.description !== undefined) push('description', input.description);
      if (input.isMandatory !== undefined) push('is_mandatory', input.isMandatory);
      if (input.displayOrder !== undefined) push('display_order', input.displayOrder);
      if (input.isActive !== undefined) push('is_active', input.isActive);
      if (sets.length === 0) {
        const current = await this.selectOne(client, id);
        if (!current) throw new NotFoundException('Requirement not found.');
        return current;
      }
      params.push(id);
      let updated: number;
      try {
        const result = await client.query(
          `UPDATE hsdg.service_component_doc_requirements
             SET ${sets.join(', ')}, version = version + 1
           WHERE id = $${params.length}`,
          params,
        );
        updated = result.rowCount ?? 0;
      } catch (err) {
        throw translateRequirementError(err);
      }
      if (updated === 0) throw new NotFoundException('Requirement not found.');
      const record = (await this.selectOne(client, id))!;
      await this.audit.recordWith(client, ctx, {
        action: 'component_doc_requirement.updated',
        objectType: 'service_component_doc_requirement',
        objectId: id,
        after: { fields: sets.map((s) => s.split(' = ')[0]) },
      });
      return record;
    });
  }

  /** Remove a requirement from the catalogue; documents tagged with it keep their bytes (FK SET NULL). */
  async remove(ctx: RlsContext, id: string): Promise<void> {
    await this.db.withRlsContext(ctx, async (client) => {
      const result = await client.query(
        `DELETE FROM hsdg.service_component_doc_requirements WHERE id = $1`,
        [id],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Requirement not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'component_doc_requirement.deleted',
        objectType: 'service_component_doc_requirement',
        objectId: id,
      });
    });
  }

  /**
   * The checklist for one component-work period: every active requirement of the
   * instance's component, each with whether a non-deleted document is filed
   * against it for THIS period. RLS scopes visibility of the instance and its
   * documents to engagement members, so a non-member gets an empty list.
   */
  async checklistForInstance(
    ctx: RlsContext,
    engagementId: string,
    instanceId: string,
  ): Promise<ComponentDocChecklistItem[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        name: string;
        description: string | null;
        is_mandatory: boolean;
        display_order: number;
        document_count: number;
      }>(
        `SELECT r.id, r.name, r.description, r.is_mandatory, r.display_order,
                (SELECT count(*)::int FROM hsdg.documents d
                   WHERE d.component_instance_id = ci.id
                     AND d.doc_requirement_id = r.id
                     AND d.deleted_at IS NULL) AS document_count
           FROM hsdg.component_instances ci
           JOIN hsdg.engagement_components ec ON ec.id = ci.engagement_component_id
           JOIN hsdg.service_component_doc_requirements r
             ON r.service_component_id = ec.service_component_id AND r.is_active
          WHERE ci.id = $1 AND ci.engagement_id = $2
          ORDER BY r.display_order, r.name`,
        [instanceId, engagementId],
      );
      return rows.map((row) => ({
        requirementId: row.id,
        name: row.name,
        description: row.description,
        isMandatory: row.is_mandatory,
        displayOrder: row.display_order,
        satisfied: row.document_count > 0,
        documentCount: row.document_count,
      }));
    });
  }

  private async selectOne(
    client: PoolClient,
    id: string,
  ): Promise<ServiceComponentDocRequirementRecord | null> {
    const { rows } = await client.query<RequirementRow>(`${REQ_BASE} WHERE r.id = $1`, [id]);
    return rows[0] ? mapRequirement(rows[0]) : null;
  }
}

function mapRequirement(row: RequirementRow): ServiceComponentDocRequirementRecord {
  return {
    id: row.id,
    serviceComponentId: row.service_component_id,
    name: row.name,
    description: row.description,
    isMandatory: row.is_mandatory,
    displayOrder: row.display_order,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Map PostgreSQL constraint/RLS violations to clean HTTP errors (checklist catalogue). */
export function translateRequirementError(err: unknown): Error {
  return mapPgError(err, {
    unique: [
      {
        match: 'service_component_doc_requirements_unique',
        message: 'A requirement with that name already exists for this component.',
      },
    ],
    uniqueDefault: 'A duplicate value violates a unique constraint.',
    foreignKey: 'A referenced record does not exist.',
    check: (message) =>
      message && message.length <= 200 ? message : 'A value violates a check constraint.',
    forbidden: 'Not permitted to change the checklist (firm-wide authority required).',
  });
}
