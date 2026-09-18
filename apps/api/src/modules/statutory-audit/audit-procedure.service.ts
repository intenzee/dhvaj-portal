import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  nextProcedureRef,
  procedureCompletionBlock,
  PROCEDURE_STATE,
  type AuditEvidence,
  type AuditException,
  type AuditProcedure,
  type EvidenceKind,
  type ExceptionSeverity,
  type ExceptionStatus,
  type ProcedureAreaLink,
  type ProcedureAssertion,
  type ProcedureState,
  type SamplingMethod,
  type StatutoryAuditProcedures,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

interface ProcedureRow {
  id: string;
  workflow_instance_id: string;
  work_area_id: string;
  procedure_ref: string;
  title: string;
  objective: string | null;
  assertions: ProcedureAssertion[];
  risk_id: string | null;
  risk_ref: string | null;
  population: string | null;
  sampling_method: SamplingMethod | null;
  sample_size: number | null;
  owner_employee_id: string | null;
  owner_name: string | null;
  reviewer_employee_id: string | null;
  reviewer_name: string | null;
  // DATE columns come back as raw 'YYYY-MM-DD' strings (see database/pg-types.ts).
  due_date: string | null;
  expected_evidence: string | null;
  conclusion: string | null;
  state: ProcedureState;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ProcedureInput {
  title: string;
  objective?: string | null;
  assertions?: ProcedureAssertion[];
  riskId?: string | null;
  population?: string | null;
  samplingMethod?: SamplingMethod | null;
  sampleSize?: number | null;
  ownerEmployeeId?: string | null;
  reviewerEmployeeId?: string | null;
  dueDate?: string | null;
  expectedEvidence?: string | null;
  conclusion?: string | null;
}

export interface EvidenceInput {
  title: string;
  kind?: EvidenceKind;
  documentId?: string | null;
  note?: string | null;
}

export interface ExceptionInput {
  description: string;
  severity?: ExceptionSeverity;
  status?: ExceptionStatus;
  resolution?: string | null;
}

/**
 * Statutory Audit — Audit-Area Execution service (Audit Spec §9–§14).
 *
 * Procedures are the professional work inside an audit area. A procedure is ONE
 * source record that can be linked to several areas (§14 cross-referencing), and
 * evidence is ONE source record that can support several procedures (§9 reuse) —
 * neither is duplicated to appear elsewhere. Exceptions capture findings (§12).
 * Completion is gated on objective + conclusion + no open exceptions (§13).
 */
@Injectable()
export class AuditProcedureService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditProcedures[]> {
    return this.db.withRlsContext(ctx, (client) => this.readProcedures(client, engagementId));
  }

  private async readProcedures(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditProcedures[]> {
    const { rows: shells } = await client.query<{
      id: string;
      engagement_service_id: string;
      engagement_id: string;
    }>(
      `SELECT id, engagement_service_id, engagement_id
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1
        ORDER BY created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];
    const shellIds = shells.map((s) => s.id);

    // Area id → { key, title } for composing each procedure's linked areas (§14).
    const { rows: areaRows } = await client.query<{
      id: string;
      work_area_key: string;
      title: string;
    }>(
      `SELECT id, work_area_key, title FROM hsdg.audit_work_areas
        WHERE workflow_instance_id = ANY($1::uuid[])`,
      [shellIds],
    );
    const areaById = new Map(areaRows.map((a) => [a.id, a]));

    const { rows: procedures } = await client.query<ProcedureRow>(
      `SELECT p.id, p.workflow_instance_id, p.work_area_id, p.procedure_ref, p.title, p.objective,
              p.assertions, p.risk_id, r.risk_ref, p.population, p.sampling_method, p.sample_size,
              p.owner_employee_id, owner.full_name AS owner_name,
              p.reviewer_employee_id, reviewer.full_name AS reviewer_name,
              p.due_date, p.expected_evidence, p.conclusion, p.state, p.version,
              p.created_at, p.updated_at
         FROM hsdg.audit_procedures p
         LEFT JOIN hsdg.audit_risks r ON r.id = p.risk_id
         LEFT JOIN hsdg.employees owner ON owner.id = p.owner_employee_id
         LEFT JOIN hsdg.employees reviewer ON reviewer.id = p.reviewer_employee_id
        WHERE p.workflow_instance_id = ANY($1::uuid[])
        ORDER BY p.created_at ASC`,
      [shellIds],
    );
    if (procedures.length === 0) {
      return shells.map((shell) => emptyProcedures(shell));
    }
    const procedureIds = procedures.map((p) => p.id);

    const { rows: linkRows } = await client.query<{
      procedure_id: string;
      work_area_id: string;
    }>(
      `SELECT procedure_id, work_area_id FROM hsdg.audit_procedure_areas
        WHERE procedure_id = ANY($1::uuid[])`,
      [procedureIds],
    );

    const { rows: evidenceRows } = await client.query<{
      procedure_id: string;
      id: string;
      title: string;
      kind: EvidenceKind;
      document_id: string | null;
      note: string | null;
      added_by_name: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT ep.procedure_id, e.id, e.title, e.kind, e.document_id, e.note,
              emp.full_name AS added_by_name, e.created_at, e.updated_at
         FROM hsdg.audit_evidence_procedures ep
         JOIN hsdg.audit_evidence e ON e.id = ep.evidence_id
         LEFT JOIN hsdg.employees emp ON emp.id = e.added_by_employee_id
        WHERE ep.procedure_id = ANY($1::uuid[])
        ORDER BY e.created_at ASC`,
      [procedureIds],
    );

    const { rows: exceptionRows } = await client.query<{
      procedure_id: string;
      id: string;
      description: string;
      severity: ExceptionSeverity;
      status: ExceptionStatus;
      resolution: string | null;
      raised_by_name: string | null;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT x.procedure_id, x.id, x.description, x.severity, x.status, x.resolution,
              emp.full_name AS raised_by_name, x.version, x.created_at, x.updated_at
         FROM hsdg.audit_exceptions x
         LEFT JOIN hsdg.employees emp ON emp.id = x.raised_by_employee_id
        WHERE x.procedure_id = ANY($1::uuid[])
        ORDER BY x.created_at ASC`,
      [procedureIds],
    );

    const buildLinks = (p: ProcedureRow): ProcedureAreaLink[] => {
      const links: ProcedureAreaLink[] = [];
      const home = areaById.get(p.work_area_id);
      if (home) {
        links.push({
          workAreaId: home.id,
          workAreaKey: home.work_area_key,
          title: home.title,
          isPrimary: true,
        });
      }
      for (const l of linkRows) {
        if (l.procedure_id !== p.id || l.work_area_id === p.work_area_id) continue;
        const area = areaById.get(l.work_area_id);
        if (area) {
          links.push({
            workAreaId: area.id,
            workAreaKey: area.work_area_key,
            title: area.title,
            isPrimary: false,
          });
        }
      }
      return links;
    };

    return shells.map((shell) => ({
      workflowInstanceId: shell.id,
      engagementServiceId: shell.engagement_service_id,
      engagementId: shell.engagement_id,
      procedures: procedures
        .filter((p) => p.workflow_instance_id === shell.id)
        .map((p) => ({
          ...mapProcedure(p),
          linkedAreas: buildLinks(p),
          evidence: evidenceRows.filter((e) => e.procedure_id === p.id).map(mapEvidence),
          exceptions: exceptionRows.filter((x) => x.procedure_id === p.id).map(mapException),
        })),
    }));
  }

  // ── Procedures (§13) ─────────────────────────────────────────────────────

  async createProcedure(
    ctx: RlsContext,
    engagementId: string,
    workAreaId: string,
    input: ProcedureInput,
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      const workflowInstanceId = await this.assertArea(client, engagementId, workAreaId);
      if (input.riskId) await this.assertRisk(client, engagementId, input.riskId);

      // Ref is unique within the engagement (§13); retry the rare insert race.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { rows: existing } = await client.query<{ procedure_ref: string }>(
          `SELECT procedure_ref FROM hsdg.audit_procedures WHERE engagement_id = $1`,
          [engagementId],
        );
        const procedureRef = nextProcedureRef(existing.map((r) => r.procedure_ref));
        try {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO hsdg.audit_procedures
               (workflow_instance_id, engagement_id, work_area_id, procedure_ref, title, objective,
                assertions, risk_id, population, sampling_method, sample_size, owner_employee_id,
                reviewer_employee_id, due_date, expected_evidence, conclusion)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING id`,
            [
              workflowInstanceId,
              engagementId,
              workAreaId,
              procedureRef,
              input.title.trim(),
              input.objective?.trim() || null,
              input.assertions ?? [],
              input.riskId ?? null,
              input.population?.trim() || null,
              input.samplingMethod ?? null,
              input.sampleSize ?? null,
              input.ownerEmployeeId ?? null,
              input.reviewerEmployeeId ?? null,
              input.dueDate ?? null,
              input.expectedEvidence?.trim() || null,
              input.conclusion?.trim() || null,
            ],
          );
          await this.audit.recordWith(client, ctx, {
            action: 'statutory_audit.procedure_created',
            objectType: 'audit_procedure',
            objectId: rows[0]!.id,
            after: { procedureRef, workAreaId },
          });
          return this.readOne(client, engagementId);
        } catch (err) {
          if ((err as { code?: string }).code === '23505' && attempt < 2) continue; // ref race
          throw err;
        }
      }
      throw new ConflictException('Could not assign a procedure reference; retry.');
    });
  }

  async updateProcedure(
    ctx: RlsContext,
    engagementId: string,
    procedureId: string,
    input: Partial<ProcedureInput> & { version: number },
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.audit_procedures WHERE id = $1 AND engagement_id = $2`,
        [procedureId, engagementId],
      );
      if (!rows[0]) throw new NotFoundException('Procedure not found.');
      if (input.riskId) await this.assertRisk(client, engagementId, input.riskId);

      // PATCH semantics: an omitted field is unchanged; explicit null clears.
      const params: unknown[] = [procedureId, input.version];
      const sets: string[] = [];
      const set = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.title !== undefined) set('title', input.title.trim());
      if (input.objective !== undefined) set('objective', input.objective?.trim() || null);
      if (input.assertions !== undefined) set('assertions', input.assertions);
      if (input.riskId !== undefined) set('risk_id', input.riskId ?? null);
      if (input.population !== undefined) set('population', input.population?.trim() || null);
      if (input.samplingMethod !== undefined) set('sampling_method', input.samplingMethod ?? null);
      if (input.sampleSize !== undefined) set('sample_size', input.sampleSize ?? null);
      if (input.ownerEmployeeId !== undefined)
        set('owner_employee_id', input.ownerEmployeeId ?? null);
      if (input.reviewerEmployeeId !== undefined)
        set('reviewer_employee_id', input.reviewerEmployeeId ?? null);
      if (input.dueDate !== undefined) set('due_date', input.dueDate ?? null);
      if (input.expectedEvidence !== undefined)
        set('expected_evidence', input.expectedEvidence?.trim() || null);
      if (input.conclusion !== undefined) set('conclusion', input.conclusion?.trim() || null);

      const result = await client.query(
        `UPDATE hsdg.audit_procedures
            SET ${sets.length ? `${sets.join(', ')}, ` : ''}version = version + 1
          WHERE id = $1 AND version = $2`,
        params,
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This procedure changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.procedure_updated',
        objectType: 'audit_procedure',
        objectId: procedureId,
      });
      return this.readOne(client, engagementId);
    });
  }

  /**
   * Transition a procedure's professional state (§13). Completing is gated on an
   * objective, a conclusion and no open exceptions (procedureCompletionBlock).
   */
  async setState(
    ctx: RlsContext,
    engagementId: string,
    procedureId: string,
    input: { state: ProcedureState; version: number },
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ objective: string | null; conclusion: string | null }>(
        `SELECT objective, conclusion FROM hsdg.audit_procedures
          WHERE id = $1 AND engagement_id = $2`,
        [procedureId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Procedure not found.');

      if (input.state === PROCEDURE_STATE.complete) {
        const { rows: openRows } = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM hsdg.audit_exceptions
            WHERE procedure_id = $1 AND status = 'open'`,
          [procedureId],
        );
        const block = procedureCompletionBlock({
          objective: current.objective,
          conclusion: current.conclusion,
          openExceptions: Number(openRows[0]!.count),
        });
        if (block) throw new BadRequestException(block);
      }

      const result = await client.query(
        `UPDATE hsdg.audit_procedures SET state = $3, version = version + 1
          WHERE id = $1 AND version = $2`,
        [procedureId, input.version, input.state],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This procedure changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.procedure_state_changed',
        objectType: 'audit_procedure',
        objectId: procedureId,
        after: { state: input.state },
      });
      return this.readOne(client, engagementId);
    });
  }

  async deleteProcedure(
    ctx: RlsContext,
    engagementId: string,
    procedureId: string,
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      const result = await client.query(
        `DELETE FROM hsdg.audit_procedures WHERE id = $1 AND engagement_id = $2`,
        [procedureId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Procedure not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.procedure_deleted',
        objectType: 'audit_procedure',
        objectId: procedureId,
      });
      return this.readOne(client, engagementId);
    });
  }

  // ── Cross-referencing / reuse across areas (§14) ───────────────────────────

  async linkArea(
    ctx: RlsContext,
    engagementId: string,
    procedureId: string,
    workAreaId: string,
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      const proc = await this.assertProcedure(client, engagementId, procedureId);
      await this.assertArea(client, engagementId, workAreaId);
      if (workAreaId === proc.work_area_id) {
        throw new BadRequestException('This is already the procedure’s home area.');
      }
      await client.query(
        `INSERT INTO hsdg.audit_procedure_areas (procedure_id, work_area_id, engagement_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (procedure_id, work_area_id) DO NOTHING`,
        [procedureId, workAreaId, engagementId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.procedure_area_linked',
        objectType: 'audit_procedure',
        objectId: procedureId,
        after: { workAreaId },
      });
      return this.readOne(client, engagementId);
    });
  }

  async unlinkArea(
    ctx: RlsContext,
    engagementId: string,
    procedureId: string,
    workAreaId: string,
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertProcedure(client, engagementId, procedureId);
      const result = await client.query(
        `DELETE FROM hsdg.audit_procedure_areas
          WHERE procedure_id = $1 AND work_area_id = $2 AND engagement_id = $3`,
        [procedureId, workAreaId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('That area is not linked to this procedure.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.procedure_area_unlinked',
        objectType: 'audit_procedure',
        objectId: procedureId,
        after: { workAreaId },
      });
      return this.readOne(client, engagementId);
    });
  }

  // ── Evidence (§9, §12) ─────────────────────────────────────────────────────

  /** Add a new piece of evidence and attach it to a procedure. */
  async addEvidence(
    ctx: RlsContext,
    engagementId: string,
    procedureId: string,
    input: EvidenceInput,
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      const proc = await this.assertProcedure(client, engagementId, procedureId);
      if (input.documentId) {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2`,
          [input.documentId, engagementId],
        );
        if (!rows[0]) throw new BadRequestException('Document not found on this engagement.');
      }
      const { rows: ev } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_evidence
           (workflow_instance_id, engagement_id, title, kind, document_id, note, added_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          proc.workflow_instance_id,
          engagementId,
          input.title.trim(),
          input.kind ?? 'document',
          input.documentId ?? null,
          input.note?.trim() || null,
          ctx.employeeId ?? null,
        ],
      );
      await client.query(
        `INSERT INTO hsdg.audit_evidence_procedures (evidence_id, procedure_id, engagement_id)
         VALUES ($1, $2, $3)`,
        [ev[0]!.id, procedureId, engagementId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.evidence_added',
        objectType: 'audit_evidence',
        objectId: ev[0]!.id,
        after: { procedureId },
      });
      return this.readOne(client, engagementId);
    });
  }

  /** Link an existing evidence record to another procedure (§9 reuse). */
  async linkEvidence(
    ctx: RlsContext,
    engagementId: string,
    procedureId: string,
    evidenceId: string,
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertProcedure(client, engagementId, procedureId);
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.audit_evidence WHERE id = $1 AND engagement_id = $2`,
        [evidenceId, engagementId],
      );
      if (!rows[0]) throw new NotFoundException('Evidence not found on this engagement.');
      await client.query(
        `INSERT INTO hsdg.audit_evidence_procedures (evidence_id, procedure_id, engagement_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (evidence_id, procedure_id) DO NOTHING`,
        [evidenceId, procedureId, engagementId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.evidence_linked',
        objectType: 'audit_evidence',
        objectId: evidenceId,
        after: { procedureId },
      });
      return this.readOne(client, engagementId);
    });
  }

  /**
   * Detach a piece of evidence from a procedure. The evidence record survives
   * while any other procedure still uses it; only the last link deletes it (§9 —
   * one source record, reused, not orphaned).
   */
  async unlinkEvidence(
    ctx: RlsContext,
    engagementId: string,
    procedureId: string,
    evidenceId: string,
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertProcedure(client, engagementId, procedureId);
      const result = await client.query(
        `DELETE FROM hsdg.audit_evidence_procedures
          WHERE evidence_id = $1 AND procedure_id = $2 AND engagement_id = $3`,
        [evidenceId, procedureId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('That evidence is not linked to this procedure.');
      }
      const { rows: remaining } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM hsdg.audit_evidence_procedures WHERE evidence_id = $1`,
        [evidenceId],
      );
      if (Number(remaining[0]!.count) === 0) {
        await client.query(`DELETE FROM hsdg.audit_evidence WHERE id = $1`, [evidenceId]);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.evidence_unlinked',
        objectType: 'audit_evidence',
        objectId: evidenceId,
        after: { procedureId },
      });
      return this.readOne(client, engagementId);
    });
  }

  // ── Exceptions (§12) ────────────────────────────────────────────────────────

  async addException(
    ctx: RlsContext,
    engagementId: string,
    procedureId: string,
    input: ExceptionInput,
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      const proc = await this.assertProcedure(client, engagementId, procedureId);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_exceptions
           (procedure_id, workflow_instance_id, engagement_id, description, severity, status,
            resolution, raised_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          procedureId,
          proc.workflow_instance_id,
          engagementId,
          input.description.trim(),
          input.severity ?? 'medium',
          input.status ?? 'open',
          input.resolution?.trim() || null,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.exception_raised',
        objectType: 'audit_exception',
        objectId: rows[0]!.id,
        after: { procedureId, severity: input.severity ?? 'medium' },
      });
      return this.readOne(client, engagementId);
    });
  }

  async updateException(
    ctx: RlsContext,
    engagementId: string,
    exceptionId: string,
    input: Partial<ExceptionInput> & { version: number },
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.audit_exceptions WHERE id = $1 AND engagement_id = $2`,
        [exceptionId, engagementId],
      );
      if (!rows[0]) throw new NotFoundException('Exception not found.');

      const params: unknown[] = [exceptionId, input.version];
      const sets: string[] = [];
      const set = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.description !== undefined) set('description', input.description.trim());
      if (input.severity !== undefined) set('severity', input.severity);
      if (input.status !== undefined) set('status', input.status);
      if (input.resolution !== undefined) set('resolution', input.resolution?.trim() || null);

      const result = await client.query(
        `UPDATE hsdg.audit_exceptions
            SET ${sets.length ? `${sets.join(', ')}, ` : ''}version = version + 1
          WHERE id = $1 AND version = $2`,
        params,
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This exception changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.exception_updated',
        objectType: 'audit_exception',
        objectId: exceptionId,
        after: { status: input.status },
      });
      return this.readOne(client, engagementId);
    });
  }

  async deleteException(
    ctx: RlsContext,
    engagementId: string,
    exceptionId: string,
  ): Promise<StatutoryAuditProcedures> {
    return this.db.withRlsContext(ctx, async (client) => {
      const result = await client.query(
        `DELETE FROM hsdg.audit_exceptions WHERE id = $1 AND engagement_id = $2`,
        [exceptionId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Exception not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.exception_deleted',
        objectType: 'audit_exception',
        objectId: exceptionId,
      });
      return this.readOne(client, engagementId);
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Read back the one engagement's procedures (there is a single SA shell). */
  private async readOne(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditProcedures> {
    const [procedures] = await this.readProcedures(client, engagementId);
    return procedures!;
  }

  /** Assert the area belongs to the engagement; returns its workflow instance id. */
  private async assertArea(
    client: PoolClient,
    engagementId: string,
    workAreaId: string,
  ): Promise<string> {
    const { rows } = await client.query<{ workflow_instance_id: string }>(
      `SELECT workflow_instance_id FROM hsdg.audit_work_areas
        WHERE id = $1 AND engagement_id = $2`,
      [workAreaId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Audit area not found on this engagement.');
    return rows[0].workflow_instance_id;
  }

  private async assertProcedure(
    client: PoolClient,
    engagementId: string,
    procedureId: string,
  ): Promise<{ work_area_id: string; workflow_instance_id: string }> {
    const { rows } = await client.query<{ work_area_id: string; workflow_instance_id: string }>(
      `SELECT work_area_id, workflow_instance_id FROM hsdg.audit_procedures
        WHERE id = $1 AND engagement_id = $2`,
      [procedureId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Procedure not found.');
    return rows[0];
  }

  private async assertRisk(
    client: PoolClient,
    engagementId: string,
    riskId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_risks WHERE id = $1 AND engagement_id = $2`,
      [riskId, engagementId],
    );
    if (!rows[0]) throw new BadRequestException('Risk not found on this engagement.');
  }
}

function emptyProcedures(shell: {
  id: string;
  engagement_service_id: string;
  engagement_id: string;
}): StatutoryAuditProcedures {
  return {
    workflowInstanceId: shell.id,
    engagementServiceId: shell.engagement_service_id,
    engagementId: shell.engagement_id,
    procedures: [],
  };
}

function mapProcedure(
  p: ProcedureRow,
): Omit<AuditProcedure, 'linkedAreas' | 'evidence' | 'exceptions'> {
  return {
    id: p.id,
    procedureRef: p.procedure_ref,
    workAreaId: p.work_area_id,
    title: p.title,
    objective: p.objective,
    assertions: p.assertions ?? [],
    riskId: p.risk_id,
    riskRef: p.risk_ref,
    population: p.population,
    samplingMethod: p.sampling_method,
    sampleSize: p.sample_size,
    ownerEmployeeId: p.owner_employee_id,
    ownerName: p.owner_name,
    reviewerEmployeeId: p.reviewer_employee_id,
    reviewerName: p.reviewer_name,
    dueDate: p.due_date,
    expectedEvidence: p.expected_evidence,
    conclusion: p.conclusion,
    state: p.state,
    version: p.version,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
  };
}

function mapEvidence(e: {
  id: string;
  title: string;
  kind: EvidenceKind;
  document_id: string | null;
  note: string | null;
  added_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}): AuditEvidence {
  return {
    id: e.id,
    title: e.title,
    kind: e.kind,
    documentId: e.document_id,
    note: e.note,
    addedByName: e.added_by_name,
    createdAt: e.created_at.toISOString(),
    updatedAt: e.updated_at.toISOString(),
  };
}

function mapException(x: {
  id: string;
  description: string;
  severity: ExceptionSeverity;
  status: ExceptionStatus;
  resolution: string | null;
  raised_by_name: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}): AuditException {
  return {
    id: x.id,
    description: x.description,
    severity: x.severity,
    status: x.status,
    resolution: x.resolution,
    raisedByName: x.raised_by_name,
    version: x.version,
    createdAt: x.created_at.toISOString(),
    updatedAt: x.updated_at.toISOString(),
  };
}
