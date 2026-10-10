import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  COMPONENT_AUDITOR_TYPE,
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  type AddIcfrComponentInput,
  type AddIcfrProcessAreaInput,
  type ConcludeIcfrConsolidatedInput,
  type ConcludeIcfrWorkstreamInput,
  type CreateIcfrControlInput,
  type CreateIcfrDeficiencyInput,
  type IcfrActivation,
  type IcfrApprovedResult,
  type IcfrComponent,
  type IcfrComponentAuditor,
  type IcfrComponentIcfr,
  type IcfrComponentMateriality,
  type IcfrControl,
  type IcfrControlEvidence,
  type IcfrControlFrequency,
  type IcfrControlNature,
  type IcfrControlReviewState,
  type IcfrControlsPriorYear,
  type IcfrDeficiency,
  type IcfrDeficiencyClass,
  type IcfrDesign,
  type IcfrFollowUp,
  type IcfrFollowUpStatus,
  type IcfrImplementation,
  type IcfrLibraryArea,
  type IcfrLikelihood,
  type IcfrMagnitude,
  type IcfrOperating,
  type IcfrOutcome,
  type IcfrParentConclusion,
  type IcfrPriorControl,
  type IcfrProcedureTemplate,
  type IcfrProcessArea,
  type IcfrRemediationStatus,
  type IcfrReportingImpact,
  type IcfrReportingSummary,
  type IcfrScoping,
  type IcfrWorkstreamConclusion,
  type IcfrWorkstreamLevel1,
  type IcfrWorkstreamRecord,
  type LinkIcfrControlEvidenceInput,
  type ReviewIcfrControlInput,
  type ReviewIcfrDeficiencyInput,
  type RiskAssertion,
  type StatutoryAuditIcfrConsolidated,
  type StatutoryAuditIcfrWorkstream,
  type UpdateIcfrComponentInput,
  type UpdateIcfrControlInput,
  type UpdateIcfrDeficiencyInput,
  type UpdateIcfrFollowUpInput,
  type UpdateIcfrProcessAreaInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import {
  ICFR_DEFICIENCY_METHODOLOGY,
  ICFR_WORK_AREA_KEY,
  areasInForce,
  componentMissing,
  consolidatedConclusionBlockers,
  controlBlockers,
  controlOverall,
  deficiencyBlockers,
  needsFollowUp,
  partnerRequiredFor,
  planConsolidated,
  planIcfrProcedures,
  planWorkstream,
  suggestDeficiencyClass,
  suggestParentConclusion,
  suggestScoping,
  summariseDeficiencies,
  summariseWorkstream,
  workstreamConclusionBlockers,
  type ComponentForConclusion,
  type PlannedIcfrProcedure,
  type ScopingFacts,
  type WorkstreamPlan,
} from './icfr-controls';
import { icfrDeficiencyRef, readIcfrReportingOn } from './icfr-controls-read';
import { readIcfrResultOn } from './icfr-read';
import { componentAuditorFeedOn } from './consolidation-group-read';
import { isEngagementLead, readPriorAuditFile, type PriorAuditFile } from './master-facts';

/** 02.6 perimeter relationships whose entities are components of the CFS. */
const CFS_COMPONENT_RELATIONSHIPS = new Set(['subsidiary', 'associate', 'joint_venture']);

interface WorkstreamRow {
  id: string;
  framework_code: string;
  framework_label: string;
  period_start: string;
  status: 'active' | 'withdrawn';
  withdrawn_at: Date | null;
  withdrawn_reason: string | null;
  conclusion: IcfrWorkstreamConclusion | null;
  conclusion_note: string | null;
  concluded_by_name: string | null;
  concluded_at: Date | null;
  created_at: Date;
  version: number;
}

interface AreaRow {
  id: string;
  library_area_id: string | null;
  area_key: string;
  title: string;
  description: string | null;
  activation: IcfrActivation;
  procedures: IcfrProcedureTemplate[];
  source: 'framework' | 'manual';
  scoping: IcfrScoping;
  scoping_source: 'system' | 'team';
  system_basis: string | null;
  scoping_reason: string | null;
  scoped_by_name: string | null;
  scoped_at: Date | null;
  sort_order: number;
  status: 'active' | 'withdrawn';
  version: number;
  trigger_area_codes: string[] | null;
  trigger_keywords: string[] | null;
}

interface ControlRow {
  id: string;
  seq: number;
  control_ref: string;
  process_area_id: string | null;
  process: string;
  description: string;
  purpose_fs_audit: boolean;
  purpose_icfr: boolean;
  assertions: RiskAssertion[];
  related_risk_id: string | null;
  related_risk_ref: string | null;
  related_risk: string | null;
  nature: IcfrControlNature | null;
  frequency: IcfrControlFrequency | null;
  is_key: boolean;
  owner: string | null;
  procedure_id: string | null;
  procedure_ref: string | null;
  design: IcfrDesign | null;
  implementation: IcfrImplementation | null;
  operating_effectiveness: IcfrOperating | null;
  test_note: string | null;
  review_state: IcfrControlReviewState;
  return_note: string | null;
  submitted_by_name: string | null;
  submitted_at: Date | null;
  reviewed_by_name: string | null;
  reviewed_at: Date | null;
  withdrawn_at: Date | null;
  version: number;
}

const CONTROL_SELECT = `
  SELECT c.id, c.seq, c.control_ref, c.process_area_id, c.process, c.description,
         c.purpose_fs_audit, c.purpose_icfr, c.assertions, c.related_risk_id,
         r.risk_ref AS related_risk_ref, c.related_risk, c.nature, c.frequency, c.is_key, c.owner,
         c.procedure_id, p.procedure_ref, c.design, c.implementation, c.operating_effectiveness,
         c.test_note, c.review_state, c.return_note,
         se.full_name AS submitted_by_name, c.submitted_at,
         re.full_name AS reviewed_by_name, c.reviewed_at, c.withdrawn_at, c.version
    FROM hsdg.audit_icfr_control c
    LEFT JOIN hsdg.audit_risks r ON r.id = c.related_risk_id
    LEFT JOIN hsdg.audit_procedures p ON p.id = c.procedure_id
    LEFT JOIN hsdg.employees se ON se.id = c.submitted_by_employee_id
    LEFT JOIN hsdg.employees re ON re.id = c.reviewed_by_employee_id`;

interface DeficiencyRow {
  id: string;
  seq: number;
  classification: IcfrDeficiencyClass;
  description: string;
  control_id: string | null;
  control_ref: string | null;
  process_area_id: string | null;
  process_title: string | null;
  work_area_key: string | null;
  affected_account: string | null;
  assertions: RiskAssertion[];
  magnitude: IcfrMagnitude | null;
  likelihood: IcfrLikelihood | null;
  compensating_control_ids: string[];
  compensating_note: string | null;
  remediation_action: string | null;
  remediation_status: IcfrRemediationStatus;
  audit_impact: string | null;
  reporting_impact: IcfrReportingImpact | null;
  reporting_note: string | null;
  followup_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: Date | null;
  partner_conclusion: string | null;
  partner_by_name: string | null;
  partner_at: Date | null;
  status: 'open' | 'closed';
  withdrawn_at: Date | null;
  version: number;
}

const DEFICIENCY_SELECT = `
  SELECT d.id, d.seq, d.classification, d.description, d.control_id, c.control_ref,
         d.process_area_id, a.title AS process_title, d.work_area_key, d.affected_account,
         d.assertions, d.magnitude, d.likelihood, d.compensating_control_ids, d.compensating_note,
         d.remediation_action, d.remediation_status, d.audit_impact, d.reporting_impact,
         d.reporting_note, d.followup_id, rv.full_name AS reviewed_by_name, d.reviewed_at,
         d.partner_conclusion, pt.full_name AS partner_by_name, d.partner_at, d.status,
         d.withdrawn_at, d.version
    FROM hsdg.audit_icfr_deficiency d
    LEFT JOIN hsdg.audit_icfr_control c ON c.id = d.control_id
    LEFT JOIN hsdg.audit_icfr_process_area a ON a.id = d.process_area_id
    LEFT JOIN hsdg.employees rv ON rv.id = d.reviewed_by_employee_id
    LEFT JOIN hsdg.employees pt ON pt.id = d.partner_by_employee_id`;

interface ConsolidatedRow {
  id: string;
  status: 'active' | 'withdrawn';
  withdrawn_reason: string | null;
  parent_conclusion: IcfrParentConclusion | null;
  parent_conclusion_note: string | null;
  concluded_by_name: string | null;
  concluded_at: Date | null;
  version: number;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const dateOnly = (d: string | Date) =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const trimOrNull = (s: string | null | undefined) => (s == null ? null : s.trim() || null);
const controlRef = (seq: number) => `IC-${String(seq).padStart(3, '0')}`;

function stale(what = 'record'): ConflictException {
  return new ConflictException(`This ${what} changed since you loaded it; refresh and retry.`);
}

type Ensured = {
  workstream: WorkstreamPlan;
  consolidated: ReturnType<typeof planConsolidated>;
  level1: IcfrWorkstreamLevel1 | null;
  facts: ScopingFacts;
};

/**
 * 02.5 — the Section 05 ICFR workstream and the Consolidated ICFR Reporting
 * Consideration (DHVAJ 02.5 spec §13–§17, §19, §22). Reads the 02.5 result
 * through the DI-free {@link readIcfrResultOn} (never AuditIcfrService), and on
 * read idempotently instantiates the versioned process-area framework when
 * section 143(3)(i) reporting applies — scoping each area from the significant
 * accounts (03.5), the Section 04 risks and the IT dependency (02.1) — or
 * withdraws it when 02.5 later concludes Exempt. Nothing is deleted.
 *
 * The control register is one record per control serving the FS audit, ICFR or
 * both (§14), with design, implementation and operating effectiveness as
 * separate conclusions (§15). The deficiency register classifies under the DHVAJ
 * methodology with Manager review and, for SD / MW, the Partner's conclusion
 * (§16), and feeds Section 07 / 08 (§22).
 */
@Injectable()
export class AuditIcfrControlsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ───────────────────────────────────────────────────────────────

  async view(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const ensured = await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
      return this.readView(client, engagementId, workflowInstanceId, ensured);
    });
  }

  async consolidatedView(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditIcfrConsolidated> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const ensured = await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
      return this.readConsolidatedView(client, engagementId, workflowInstanceId, ensured);
    });
  }

  /** The framework in force on a date (methodology view; spec §13). */
  async library(ctx: RlsContext, on: string): Promise<IcfrLibraryArea[]> {
    return this.db.withRlsContext(ctx, async (client) =>
      areasInForce(await this.loadLibrary(client), on),
    );
  }

  /** §22 — the Section 07 / 08 summary, after bringing the workstream in line. */
  async reporting(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<IcfrReportingSummary | null> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
      return readIcfrReportingOn(client, workflowInstanceId);
    });
  }

  // ── Section 06 (spec §13) ──────────────────────────────────────────────

  /**
   * The Section 06 procedures the ICFR workstream calls for — one per step of
   * each in-scope process area plus the deficiency evaluation / conclusion —
   * after bringing the workstream in line with 02.5. Empty when no workstream
   * is active (the generic IFC programme is never generated).
   */
  async icfrProceduresOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlannedIcfrProcedure[]> {
    await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
    const ws = await this.loadWorkstream(client, workflowInstanceId);
    if (!ws || ws.status !== 'active') return [];
    const areas = await this.loadAreas(client, ws.id);
    return planIcfrProcedures(
      areas.map((a) => ({
        areaKey: a.area_key,
        title: a.title,
        scoping: a.scoping,
        withdrawn: a.status === 'withdrawn',
        procedures: a.procedures ?? [],
      })),
    );
  }

  /** Point each unlinked control at its process area's Section 06 procedure. */
  async linkProceduresOn(client: PoolClient, workflowInstanceId: string): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_icfr_control c
          SET procedure_id = x.procedure_id
         FROM (SELECT DISTINCT ON (a.id) a.id AS area_id, p.id AS procedure_id
                 FROM hsdg.audit_icfr_process_area a
                 JOIN hsdg.audit_procedures p
                   ON p.workflow_instance_id = a.workflow_instance_id
                  AND p.source_key LIKE 'icfr:' || a.area_key || ':%'
                WHERE a.workflow_instance_id = $1
                ORDER BY a.id, p.source_key) x
        WHERE c.workflow_instance_id = $1 AND c.procedure_id IS NULL
          AND c.process_area_id = x.area_id AND c.withdrawn_at IS NULL`,
      [workflowInstanceId],
    );
  }

  // ── Process areas (spec §13) ───────────────────────────────────────────

  async updateArea(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    areaId: string,
    input: UpdateIcfrProcessAreaInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const area = await this.loadArea(client, workflowInstanceId, areaId);
      if (area.version !== input.version) throw stale('process area');
      const reason = trimOrNull(input.scopingReason);
      if (input.scoping === 'not_in_scope' && !reason)
        throw new BadRequestException('Say why this process is not in scope.');
      await client.query(
        `UPDATE hsdg.audit_icfr_process_area
            SET scoping = $2, scoping_source = 'team', scoping_reason = $3,
                scoped_by_employee_id = $4, scoped_at = now(), version = version + 1
          WHERE id = $1`,
        [area.id, input.scoping, reason, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_area_scoped',
        objectType: 'audit_icfr_process_area',
        objectId: area.id,
        before: { scoping: area.scoping, source: area.scoping_source },
        after: { area: area.title, scoping: input.scoping, reason },
      });
    });
  }

  /** A further significant process identified by risk / scoping (spec §13). */
  async addArea(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: AddIcfrProcessAreaInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const ws = await this.loadWorkstream(client, workflowInstanceId);
      if (!ws || ws.status !== 'active')
        throw new ConflictException(
          'The ICFR workstream is not active — add processes once 02.5 concludes reporting applies.',
        );
      const title = input.title?.trim();
      const reason = trimOrNull(input.scopingReason);
      if (!title) throw new BadRequestException('Name the process.');
      if (!reason) throw new BadRequestException('Say why the process is significant.');
      const key = `other_${title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 30)}`;
      try {
        await client.query(
          `INSERT INTO hsdg.audit_icfr_process_area
             (workstream_id, workflow_instance_id, engagement_id, area_key, title, description,
              activation, procedures, source, scoping, scoping_source, scoping_reason,
              scoped_by_employee_id, scoped_at, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,'scoping',$7::jsonb,'manual','in_scope','team',$8,$9,now(),
                   (SELECT COALESCE(MAX(sort_order),0) + 1 FROM hsdg.audit_icfr_process_area
                     WHERE workstream_id = $1))`,
          [
            ws.id,
            workflowInstanceId,
            engagementId,
            key,
            title,
            trimOrNull(input.description),
            JSON.stringify([
              {
                key: 'controls',
                title: `Understand and test the key controls over ${title}`,
                objective: `Walk through ${title}, identify the key controls addressing the risks of material misstatement, and evaluate their design, implementation and operating effectiveness.`,
                evidence: 'Walkthrough note, control matrix and test of controls workpapers.',
              },
            ]),
            reason,
            ctx.employeeId ?? null,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new ConflictException('That process is already in the workstream.');
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_area_added',
        objectType: 'audit_icfr_workstream',
        objectId: ws.id,
        after: { title, reason },
      });
    });
  }

  // ── Controls (spec §14, §15) ───────────────────────────────────────────

  async createControl(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateIcfrControlInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const description = input.description?.trim();
      if (!description) throw new BadRequestException('Describe the control.');
      if (!input.purposeFsAudit && !input.purposeIcfr)
        throw new BadRequestException(
          'Say what the control is relied on for (FS audit, ICFR or both).',
        );
      if (input.purposeIcfr) await this.assertWorkstreamActive(client, workflowInstanceId);
      const area = input.processAreaId
        ? await this.loadArea(client, workflowInstanceId, input.processAreaId)
        : null;
      const process = trimOrNull(input.process) ?? area?.title ?? null;
      if (!process) throw new BadRequestException('Name the process (or pick a process area).');
      await this.assertControlLinks(
        client,
        workflowInstanceId,
        input.relatedRiskId,
        input.procedureId,
      );
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('icfr_control:' || $1))`, [
        workflowInstanceId,
      ]);
      const { rows: seq } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM hsdg.audit_icfr_control
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const n = seq[0]!.next;
      const ref = trimOrNull(input.controlRef) ?? controlRef(n);
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_icfr_control
             (workflow_instance_id, engagement_id, process_area_id, process, seq, control_ref,
              description, purpose_fs_audit, purpose_icfr, assertions, related_risk_id,
              related_risk, nature, frequency, is_key, owner, procedure_id, created_by_employee_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING id`,
          [
            workflowInstanceId,
            engagementId,
            area?.id ?? null,
            process,
            n,
            ref,
            description,
            input.purposeFsAudit,
            input.purposeIcfr,
            input.assertions ?? [],
            input.relatedRiskId ?? null,
            trimOrNull(input.relatedRisk),
            input.nature ?? null,
            input.frequency ?? null,
            input.isKey ?? true,
            trimOrNull(input.owner),
            input.procedureId ?? null,
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new ConflictException(`Control reference ${ref} is already used in this file.`);
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_control_created',
        objectType: 'audit_icfr_control',
        objectId: id,
        after: {
          ref,
          process,
          purposeFsAudit: input.purposeFsAudit,
          purposeIcfr: input.purposeIcfr,
        },
      });
    });
  }

  async updateControl(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    controlId: string,
    input: UpdateIcfrControlInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const c = await this.loadControl(client, workflowInstanceId, controlId);
      if (c.version !== input.version) throw stale('control');
      if (c.review_state === 'submitted' || c.review_state === 'reviewed')
        throw new ConflictException(
          c.review_state === 'reviewed'
            ? 'This control is reviewed; reopen it before changing it.'
            : 'This control is with the reviewer; it can change once returned.',
        );
      if (c.withdrawn_at && input.withdrawn !== false)
        throw new ConflictException('This control was withdrawn; restore it first.');
      const fsAudit = input.purposeFsAudit ?? c.purpose_fs_audit;
      const icfr = input.purposeIcfr ?? c.purpose_icfr;
      if (!fsAudit && !icfr)
        throw new BadRequestException(
          'Say what the control is relied on for (FS audit, ICFR or both).',
        );
      if (input.purposeIcfr === true && !c.purpose_icfr)
        await this.assertWorkstreamActive(client, workflowInstanceId);
      if (input.description !== undefined && !input.description?.trim())
        throw new BadRequestException('Describe the control.');
      if (input.process !== undefined && !input.process.trim())
        throw new BadRequestException('Name the process.');
      if (input.processAreaId) await this.loadArea(client, workflowInstanceId, input.processAreaId);
      await this.assertControlLinks(
        client,
        workflowInstanceId,
        input.relatedRiskId,
        input.procedureId,
      );
      const sets: string[] = [];
      const params: unknown[] = [c.id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.processAreaId !== undefined) set('process_area_id', input.processAreaId);
      if (input.process !== undefined) set('process', input.process.trim());
      if (input.controlRef !== undefined) {
        const ref = trimOrNull(input.controlRef);
        if (!ref) throw new BadRequestException('A control needs a reference.');
        set('control_ref', ref);
      }
      if (input.description !== undefined) set('description', input.description!.trim());
      if (input.purposeFsAudit !== undefined) set('purpose_fs_audit', input.purposeFsAudit);
      if (input.purposeIcfr !== undefined) set('purpose_icfr', input.purposeIcfr);
      if (input.assertions !== undefined) set('assertions', input.assertions);
      if (input.relatedRiskId !== undefined) set('related_risk_id', input.relatedRiskId);
      if (input.relatedRisk !== undefined) set('related_risk', trimOrNull(input.relatedRisk));
      if (input.nature !== undefined) set('nature', input.nature);
      if (input.frequency !== undefined) set('frequency', input.frequency);
      if (input.isKey !== undefined) set('is_key', input.isKey);
      if (input.owner !== undefined) set('owner', trimOrNull(input.owner));
      if (input.procedureId !== undefined) set('procedure_id', input.procedureId);
      if (input.design !== undefined) set('design', input.design);
      if (input.implementation !== undefined) set('implementation', input.implementation);
      if (input.operatingEffectiveness !== undefined)
        set('operating_effectiveness', input.operatingEffectiveness);
      if (input.testNote !== undefined) set('test_note', trimOrNull(input.testNote));
      // Withdrawn, never deleted: a control raised in error stays on the trail.
      if (input.withdrawn !== undefined)
        sets.push(
          input.withdrawn ? 'withdrawn_at = COALESCE(withdrawn_at, now())' : 'withdrawn_at = NULL',
        );
      if (sets.length === 0) return;
      try {
        await client.query(
          `UPDATE hsdg.audit_icfr_control SET ${sets.join(', ')}, version = version + 1 WHERE id = $1`,
          params,
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new ConflictException('That control reference is already used in this file.');
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_control_updated',
        objectType: 'audit_icfr_control',
        objectId: c.id,
        before: {
          design: c.design,
          implementation: c.implementation,
          operatingEffectiveness: c.operating_effectiveness,
        },
        after: { ref: c.control_ref, ...stripVersion(input) },
      });
    });
  }

  async reviewControl(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    controlId: string,
    input: ReviewIcfrControlInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const c = await this.loadControl(client, workflowInstanceId, controlId);
      if (c.withdrawn_at) throw new ConflictException('This control was withdrawn.');
      if (c.version !== input.version) throw stale('control');
      const blockers = async () => controlBlockers(await this.controlForReview(client, c));
      let sql: string;
      const params: unknown[] = [c.id];
      const me = () => {
        params.push(ctx.employeeId ?? null);
        return `$${params.length}`;
      };
      switch (input.action) {
        case 'submit': {
          if (c.review_state !== 'open' && c.review_state !== 'returned')
            throw new ConflictException('Only an open or returned control can be submitted.');
          const b = await blockers();
          if (b.length) throw new BadRequestException(b.join(' '));
          sql = `review_state = 'submitted', submitted_by_employee_id = ${me()}, submitted_at = now(),
                 return_note = NULL`;
          break;
        }
        case 'review': {
          if (c.review_state !== 'submitted')
            throw new ConflictException('Submit the control for review first.');
          const b = await blockers();
          if (b.length) throw new BadRequestException(b.join(' '));
          sql = `review_state = 'reviewed', reviewed_by_employee_id = ${me()}, reviewed_at = now()`;
          break;
        }
        case 'return':
          if (c.review_state !== 'submitted')
            throw new ConflictException('Only a submitted control can be returned.');
          if (!trimOrNull(input.note))
            throw new BadRequestException('Say what needs to change when returning a control.');
          params.push(trimOrNull(input.note));
          sql = `review_state = 'returned', return_note = $${params.length}`;
          break;
        case 'reopen':
          if (c.review_state !== 'reviewed')
            throw new ConflictException('Only a reviewed control can be reopened.');
          sql = `review_state = 'open', reviewed_by_employee_id = NULL, reviewed_at = NULL`;
          break;
        default:
          throw new BadRequestException('Unknown review action.');
      }
      await client.query(
        `UPDATE hsdg.audit_icfr_control SET ${sql}, version = version + 1 WHERE id = $1`,
        params,
      );
      await this.audit.recordWith(client, ctx, {
        action: `statutory_audit.icfr_control_${input.action}`,
        objectType: 'audit_icfr_control',
        objectId: c.id,
        before: { reviewState: c.review_state },
        after: { ref: c.control_ref, note: input.note ?? null },
      });
    });
  }

  /** Link existing evidence — reused across controls, never re-uploaded (§14). */
  async linkEvidence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    controlId: string,
    input: LinkIcfrControlEvidenceInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const c = await this.loadControl(client, workflowInstanceId, controlId);
      assertControlEditable(c);
      if (!!input.documentId === !!input.auditEvidenceId)
        throw new BadRequestException('Link either an engagement document or an evidence record.');
      if (input.documentId) {
        await this.assertDocument(client, engagementId, input.documentId);
      } else {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.audit_evidence WHERE id = $1 AND workflow_instance_id = $2`,
          [input.auditEvidenceId, workflowInstanceId],
        );
        if (!rows[0]) throw new BadRequestException('That evidence is not in this audit file.');
      }
      try {
        await client.query(
          `INSERT INTO hsdg.audit_icfr_control_evidence
             (control_id, engagement_id, document_id, audit_evidence_id, note, linked_by_employee_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            c.id,
            engagementId,
            input.documentId ?? null,
            input.auditEvidenceId ?? null,
            trimOrNull(input.note),
            ctx.employeeId ?? null,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new ConflictException('That evidence is already linked to this control.');
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_evidence_linked',
        objectType: 'audit_icfr_control',
        objectId: c.id,
        after: {
          ref: c.control_ref,
          documentId: input.documentId ?? null,
          auditEvidenceId: input.auditEvidenceId ?? null,
        },
      });
    });
  }

  async unlinkEvidence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    controlId: string,
    linkId: string,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const c = await this.loadControl(client, workflowInstanceId, controlId);
      assertControlEditable(c);
      const res = await client.query(
        `UPDATE hsdg.audit_icfr_control_evidence
            SET removed_at = now(), removed_by_employee_id = $3
          WHERE id = $1 AND control_id = $2 AND removed_at IS NULL`,
        [linkId, c.id, ctx.employeeId ?? null],
      );
      if (res.rowCount === 0) throw new NotFoundException('That evidence is not linked here.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_evidence_unlinked',
        objectType: 'audit_icfr_control',
        objectId: c.id,
        before: { linkId },
      });
    });
  }

  // ── Deficiency register (spec §16) ─────────────────────────────────────

  async createDeficiency(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateIcfrDeficiencyInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const description = input.description?.trim();
      if (!description) throw new BadRequestException('Describe the deficiency.');
      const control = input.controlId
        ? await this.loadControl(client, workflowInstanceId, input.controlId)
        : null;
      const areaId = input.processAreaId ?? control?.process_area_id ?? null;
      if (input.processAreaId) await this.loadArea(client, workflowInstanceId, input.processAreaId);
      await this.assertDeficiencyLinks(client, workflowInstanceId, input);
      const id = await this.insertDeficiency(client, ctx, engagementId, workflowInstanceId, {
        ...input,
        description,
        processAreaId: areaId,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_deficiency_raised',
        objectType: 'audit_icfr_deficiency',
        objectId: id,
        after: {
          classification: input.classification,
          description,
          controlRef: control?.control_ref ?? null,
        },
      });
    });
  }

  async updateDeficiency(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    deficiencyId: string,
    input: UpdateIcfrDeficiencyInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const d = await this.loadDeficiency(client, workflowInstanceId, deficiencyId);
      if (d.version !== input.version) throw stale('deficiency');
      // Reviewed conclusions are frozen; only the remediation status / closing moves on.
      const lateOnly =
        Object.keys(stripVersion(input)).every((k) =>
          ['remediationStatus', 'status', 'reportingNote'].includes(k),
        ) && input.withdrawn === undefined;
      if (d.reviewed_at && !lateOnly)
        throw new ConflictException('This deficiency is reviewed; reopen it before changing it.');
      if (input.description !== undefined && !input.description?.trim())
        throw new BadRequestException('Describe the deficiency.');
      if (input.controlId) await this.loadControl(client, workflowInstanceId, input.controlId);
      if (input.processAreaId) await this.loadArea(client, workflowInstanceId, input.processAreaId);
      await this.assertDeficiencyLinks(client, workflowInstanceId, input);
      const sets: string[] = [];
      const params: unknown[] = [d.id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.classification !== undefined) set('classification', input.classification);
      if (input.description !== undefined) set('description', input.description!.trim());
      if (input.controlId !== undefined) set('control_id', input.controlId);
      if (input.processAreaId !== undefined) set('process_area_id', input.processAreaId);
      if (input.workAreaKey !== undefined) set('work_area_key', input.workAreaKey);
      if (input.affectedAccount !== undefined)
        set('affected_account', trimOrNull(input.affectedAccount));
      if (input.assertions !== undefined) set('assertions', input.assertions);
      if (input.magnitude !== undefined) set('magnitude', input.magnitude);
      if (input.likelihood !== undefined) set('likelihood', input.likelihood);
      if (input.compensatingControlIds !== undefined)
        set('compensating_control_ids', input.compensatingControlIds);
      if (input.compensatingNote !== undefined)
        set('compensating_note', trimOrNull(input.compensatingNote));
      if (input.remediationAction !== undefined)
        set('remediation_action', trimOrNull(input.remediationAction));
      if (input.remediationStatus !== undefined) set('remediation_status', input.remediationStatus);
      if (input.auditImpact !== undefined) set('audit_impact', trimOrNull(input.auditImpact));
      if (input.reportingImpact !== undefined) set('reporting_impact', input.reportingImpact);
      if (input.reportingNote !== undefined) set('reporting_note', trimOrNull(input.reportingNote));
      if (input.followUpId !== undefined) set('followup_id', input.followUpId);
      if (input.status !== undefined) set('status', input.status);
      if (input.withdrawn !== undefined)
        sets.push(
          input.withdrawn ? 'withdrawn_at = COALESCE(withdrawn_at, now())' : 'withdrawn_at = NULL',
        );
      if (sets.length === 0) return;
      await client.query(
        `UPDATE hsdg.audit_icfr_deficiency SET ${sets.join(', ')}, version = version + 1 WHERE id = $1`,
        params,
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_deficiency_updated',
        objectType: 'audit_icfr_deficiency',
        objectId: d.id,
        before: { classification: d.classification, status: d.status },
        after: { ref: icfrDeficiencyRef(d.seq), ...stripVersion(input) },
      });
    });
  }

  async reviewDeficiency(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    deficiencyId: string,
    input: ReviewIcfrDeficiencyInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const d = await this.loadDeficiency(client, workflowInstanceId, deficiencyId);
      if (d.withdrawn_at) throw new ConflictException('This deficiency was withdrawn.');
      if (d.version !== input.version) throw stale('deficiency');
      const ref = icfrDeficiencyRef(d.seq);
      let sql: string;
      const params: unknown[] = [d.id];
      const me = () => {
        params.push(ctx.employeeId ?? null);
        return `$${params.length}`;
      };
      switch (input.action) {
        case 'manager_review': {
          if (d.reviewed_at) throw new ConflictException('This deficiency is already reviewed.');
          const b = deficiencyBlockers(this.deficiencyForReview(d), 'manager_review');
          if (b.length) throw new BadRequestException(b.join(' '));
          sql = `reviewed_by_employee_id = ${me()}, reviewed_at = now()`;
          break;
        }
        case 'partner_conclude': {
          const partner = await this.engagementPartner(client, engagementId);
          if (!ctx.employeeId || ctx.employeeId !== partner)
            throw new ForbiddenException(
              'Only the Engagement Partner concludes on a significant deficiency or material weakness.',
            );
          if (d.partner_at) throw new ConflictException('The Partner has already concluded.');
          const b = deficiencyBlockers(this.deficiencyForReview(d), 'partner_conclude');
          if (b.length) throw new BadRequestException(b.join(' '));
          const note = trimOrNull(input.partnerConclusion);
          if (!note) throw new BadRequestException("Record the Partner's conclusion.");
          params.push(note);
          sql = `partner_conclusion = $${params.length}, partner_by_employee_id = ${me()}, partner_at = now()`;
          break;
        }
        case 'reopen':
          if (!d.reviewed_at)
            throw new ConflictException('Only a reviewed deficiency is reopened.');
          sql = `reviewed_by_employee_id = NULL, reviewed_at = NULL, partner_conclusion = NULL,
                 partner_by_employee_id = NULL, partner_at = NULL`;
          break;
        default:
          throw new BadRequestException('Unknown review action.');
      }
      await client.query(
        `UPDATE hsdg.audit_icfr_deficiency SET ${sql}, version = version + 1 WHERE id = $1`,
        params,
      );
      await this.audit.recordWith(client, ctx, {
        action: `statutory_audit.icfr_deficiency_${input.action}`,
        objectType: 'audit_icfr_deficiency',
        objectId: d.id,
        after: {
          ref,
          classification: d.classification,
          partnerConclusion: input.partnerConclusion ?? null,
        },
      });
    });
  }

  // ── Prior-year follow-up (spec §19) ────────────────────────────────────

  async updateFollowUp(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    followUpId: string,
    input: UpdateIcfrFollowUpInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const { rows } = await client.query<{
        id: string;
        status: IcfrFollowUpStatus;
        prior_ref: string;
        prior_classification: IcfrDeficiencyClass;
        prior_description: string;
        deficiency_id: string | null;
        version: number;
      }>(
        `SELECT id, status, prior_ref, prior_classification, prior_description, deficiency_id, version
           FROM hsdg.audit_icfr_followup WHERE id = $1 AND workflow_instance_id = $2`,
        [followUpId, workflowInstanceId],
      );
      const f = rows[0];
      if (!f) throw new NotFoundException('Follow-up not found in this audit file.');
      if (f.version !== input.version) throw stale('follow-up');
      const note = trimOrNull(input.conclusionNote);
      if (input.status !== 'open' && !note)
        throw new BadRequestException('Record what the follow-up found.');
      let deficiencyId = f.deficiency_id;
      // Persists → the same weakness is raised once as a current-year deficiency.
      if (input.status === 'persists' && !deficiencyId) {
        deficiencyId = await this.insertDeficiency(client, ctx, engagementId, workflowInstanceId, {
          classification: f.prior_classification,
          description: `${f.prior_description} (persists from prior-year ${f.prior_ref})`,
          followUpId: f.id,
        });
      }
      await client.query(
        `UPDATE hsdg.audit_icfr_followup
            SET status = $2, conclusion_note = $3, deficiency_id = $4,
                concluded_by_employee_id = CASE WHEN $2 = 'open' THEN NULL ELSE $5::uuid END,
                concluded_at = CASE WHEN $2 = 'open' THEN NULL ELSE now() END,
                version = version + 1
          WHERE id = $1`,
        [f.id, input.status, note, deficiencyId, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_followup_updated',
        objectType: 'audit_icfr_followup',
        objectId: f.id,
        before: { status: f.status },
        after: { priorRef: f.prior_ref, status: input.status, note },
      });
    });
  }

  // ── Workstream conclusion (→ Section 08) ───────────────────────────────

  async concludeWorkstream(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ConcludeIcfrWorkstreamInput,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const ws = await this.loadWorkstream(client, workflowInstanceId);
      if (!ws || ws.status !== 'active')
        throw new ConflictException('The ICFR workstream is not active.');
      if (ws.version !== input.version) throw stale('workstream');
      const partner = await this.engagementPartner(client, engagementId);
      if (!ctx.employeeId || ctx.employeeId !== partner)
        throw new ForbiddenException('Only the Engagement Partner concludes on ICFR.');
      if (input.conclusion) {
        const b = workstreamConclusionBlockers(
          await this.conclusionInput(client, workflowInstanceId, ws.id),
          input.conclusion,
        );
        if (b.length) throw new BadRequestException(b.join(' '));
      }
      await client.query(
        `UPDATE hsdg.audit_icfr_workstream
            SET conclusion = $2, conclusion_note = $3,
                concluded_by_employee_id = CASE WHEN $2::text IS NULL THEN NULL ELSE $4::uuid END,
                concluded_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END,
                version = version + 1, updated_at = now()
          WHERE id = $1`,
        [ws.id, input.conclusion, trimOrNull(input.note), ctx.employeeId],
      );
      await this.audit.recordWith(client, ctx, {
        action: input.conclusion
          ? 'statutory_audit.icfr_workstream_concluded'
          : 'statutory_audit.icfr_workstream_reopened',
        objectType: 'audit_icfr_workstream',
        objectId: ws.id,
        before: { conclusion: ws.conclusion },
        after: { conclusion: input.conclusion, note: trimOrNull(input.note) },
      });
    });
  }

  // ── Consolidated consideration (spec §17) ──────────────────────────────

  async addComponent(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: AddIcfrComponentInput,
  ): Promise<StatutoryAuditIcfrConsolidated> {
    return this.mutateConsolidated(ctx, engagementId, workflowInstanceId, async (client) => {
      const c = await this.loadConsolidated(client, workflowInstanceId);
      if (!c || c.status !== 'active')
        throw new ConflictException('The consolidated ICFR consideration is not active.');
      if (c.parent_conclusion) throw concludedConsolidated();
      const name = input.componentName?.trim();
      if (!name) throw new BadRequestException('Name the component company.');
      try {
        await client.query(
          `INSERT INTO hsdg.audit_icfr_component
             (consolidated_id, engagement_id, source, source_key, component_name, relationship, sort_order)
           VALUES ($1,$2,'manual',$3,$4,$5,
                   (SELECT COALESCE(MAX(sort_order),0) + 1 FROM hsdg.audit_icfr_component
                     WHERE consolidated_id = $1))`,
          [c.id, engagementId, componentKey(name), name, trimOrNull(input.relationship)],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new ConflictException('That company is already listed.');
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_component_added',
        objectType: 'audit_icfr_consolidated',
        objectId: c.id,
        after: { componentName: name },
      });
    });
  }

  async updateComponent(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    componentId: string,
    input: UpdateIcfrComponentInput,
  ): Promise<StatutoryAuditIcfrConsolidated> {
    return this.mutateConsolidated(ctx, engagementId, workflowInstanceId, async (client) => {
      const { rows } = await client.query<{
        id: string;
        version: number;
        source: '02.6' | 'manual';
        component_name: string;
        material_weakness: boolean | null;
        material_weakness_details: string | null;
        parent_conclusion: string | null;
      }>(
        `SELECT m.id, m.version, m.source, m.component_name, m.material_weakness,
                m.material_weakness_details, c.parent_conclusion
           FROM hsdg.audit_icfr_component m
           JOIN hsdg.audit_icfr_consolidated c ON c.id = m.consolidated_id
          WHERE m.id = $1 AND c.workflow_instance_id = $2`,
        [componentId, workflowInstanceId],
      );
      const m = rows[0];
      if (!m) throw new NotFoundException('Component not found in this audit file.');
      if (m.version !== input.version) throw stale('component');
      if (m.parent_conclusion) throw concludedConsolidated();
      if (input.reportDocumentId)
        await this.assertDocument(client, engagementId, input.reportDocumentId);
      const mw =
        input.materialWeakness !== undefined ? input.materialWeakness : m.material_weakness;
      const details =
        input.materialWeaknessDetails !== undefined
          ? trimOrNull(input.materialWeaknessDetails)
          : m.material_weakness_details;
      if (mw === true && !details)
        throw new BadRequestException('Describe the material weakness / qualification reported.');
      const sets: string[] = [];
      const params: unknown[] = [m.id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.indianCompany !== undefined) set('indian_company', input.indianCompany);
      if (input.componentIcfr !== undefined) set('component_icfr', input.componentIcfr);
      if (input.auditor !== undefined) set('auditor', input.auditor);
      if (input.auditorName !== undefined) set('auditor_name', trimOrNull(input.auditorName));
      if (input.reportDocumentId !== undefined) set('report_document_id', input.reportDocumentId);
      if (input.materiality !== undefined) set('materiality', input.materiality);
      if (input.materialityNote !== undefined)
        set('materiality_note', trimOrNull(input.materialityNote));
      if (input.materialWeakness !== undefined) set('material_weakness', input.materialWeakness);
      if (input.materialWeaknessDetails !== undefined)
        set('material_weakness_details', trimOrNull(input.materialWeaknessDetails));
      if (input.withdrawn !== undefined) {
        if (m.source !== 'manual')
          throw new BadRequestException(
            'This company comes from the 02.6 group structure — change it there.',
          );
        sets.push(
          input.withdrawn ? 'withdrawn_at = COALESCE(withdrawn_at, now())' : 'withdrawn_at = NULL',
        );
      }
      if (sets.length === 0) return;
      await client.query(
        `UPDATE hsdg.audit_icfr_component SET ${sets.join(', ')}, version = version + 1,
                updated_at = now() WHERE id = $1`,
        params,
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_component_updated',
        objectType: 'audit_icfr_component',
        objectId: m.id,
        after: { componentName: m.component_name, ...stripVersion(input) },
      });
    });
  }

  async concludeConsolidated(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ConcludeIcfrConsolidatedInput,
  ): Promise<StatutoryAuditIcfrConsolidated> {
    return this.mutateConsolidated(ctx, engagementId, workflowInstanceId, async (client) => {
      const c = await this.loadConsolidated(client, workflowInstanceId);
      if (!c || c.status !== 'active')
        throw new ConflictException('The consolidated ICFR consideration is not active.');
      if (c.version !== input.version) throw stale('consolidated consideration');
      const partner = await this.engagementPartner(client, engagementId);
      if (!ctx.employeeId || ctx.employeeId !== partner)
        throw new ForbiddenException('Only the Engagement Partner concludes on consolidated ICFR.');
      if (input.parentConclusion) {
        const comps = await this.readComponents(client, c.id);
        const b = consolidatedConclusionBlockers(
          comps.map(componentForConclusion),
          comps.map((x) => x.componentName),
          input.parentConclusion,
          await this.parentMaterialWeakness(client, workflowInstanceId),
        );
        if (b.length) throw new BadRequestException(b.join(' '));
      }
      await client.query(
        `UPDATE hsdg.audit_icfr_consolidated
            SET parent_conclusion = $2, parent_conclusion_note = $3,
                concluded_by_employee_id = CASE WHEN $2::text IS NULL THEN NULL ELSE $4::uuid END,
                concluded_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END,
                version = version + 1, updated_at = now()
          WHERE id = $1`,
        [c.id, input.parentConclusion, trimOrNull(input.note), ctx.employeeId],
      );
      await this.audit.recordWith(client, ctx, {
        action: input.parentConclusion
          ? 'statutory_audit.icfr_consolidated_concluded'
          : 'statutory_audit.icfr_consolidated_reopened',
        objectType: 'audit_icfr_consolidated',
        objectId: c.id,
        before: { parentConclusion: c.parent_conclusion },
        after: { parentConclusion: input.parentConclusion, note: trimOrNull(input.note) },
      });
    });
  }

  // ── Instantiation (spec §13, §17, §19) ─────────────────────────────────

  /**
   * Bring the workstream and the consolidated consideration in line with the
   * 02.5 result: instantiate the framework in force for the audit period and
   * scope each area from the facts (a team decision is never overridden),
   * carry the prior year's open deficiencies forward as follow-ups, withdraw
   * what 02.5 no longer requires, sync components from 02.6 and link the
   * Section 06 procedures. Idempotent; only a lead writes (RLS).
   */
  async ensureOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<Ensured> {
    const level1 = toLevel1(await readIcfrResultOn(client, workflowInstanceId));
    const existing = await this.loadWorkstream(client, workflowInstanceId);
    const periodStart = existing ? dateOnly(existing.period_start) : (level1?.periodStart ?? null);
    const library = periodStart ? areasInForce(await this.loadLibrary(client), periodStart) : [];
    const workstream = planWorkstream(level1, existing, library.length > 0);
    const existingCons = await this.loadConsolidated(client, workflowInstanceId);
    const consolidated = planConsolidated(level1, existingCons);
    const facts = await this.readScopingFacts(client, workflowInstanceId);
    const out: Ensured = { workstream, consolidated, level1, facts };
    if (!(await isEngagementLead(client, engagementId))) return out;

    const changes: Record<string, number> = {};
    if (workstream.action === 'ensure' && level1 && library.length) {
      const wsId = await this.upsertWorkstream(
        client,
        ctx,
        engagementId,
        workflowInstanceId,
        library[0]!,
        periodStart ?? level1.periodStart,
      );
      if (!existing || existing.status === 'withdrawn') changes.workstream_instantiated = 1;
      changes.areas = await this.ensureAreas(
        client,
        wsId,
        engagementId,
        workflowInstanceId,
        library,
        facts,
      );
      changes.follow_ups = await this.ensureFollowUps(client, engagementId, workflowInstanceId);
    } else if (workstream.action === 'withdraw' && existing) {
      await client.query(
        `UPDATE hsdg.audit_icfr_workstream
            SET status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = $2,
                version = version + 1, updated_at = now()
          WHERE id = $1 AND status = 'active'`,
        [existing.id, workstream.reason],
      );
      // ICFR purpose falls away with the workstream; FS-audit controls stay as they are.
      changes.workstream_withdrawn = 1;
    }
    if (consolidated.action === 'ensure') {
      const id = await this.upsertConsolidated(client, engagementId, workflowInstanceId);
      if (!existingCons || existingCons.status === 'withdrawn') changes.consolidated_configured = 1;
      await this.syncComponents(client, engagementId, workflowInstanceId, id);
    } else if (consolidated.action === 'withdraw' && existingCons) {
      await client.query(
        `UPDATE hsdg.audit_icfr_consolidated
            SET status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = $2,
                version = version + 1, updated_at = now()
          WHERE id = $1 AND status = 'active'`,
        [existingCons.id, consolidated.reason],
      );
      changes.consolidated_withdrawn = 1;
    }
    await this.linkProceduresOn(client, workflowInstanceId);
    const touched = Object.entries(changes).filter(([, n]) => n > 0);
    if (touched.length) {
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_workstream_synced',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: {
          ...Object.fromEntries(touched),
          state: workstream.state,
          consolidated: consolidated.state,
          outcome: level1?.outcome,
        },
      });
    }
    return out;
  }

  private async upsertWorkstream(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    framework: IcfrLibraryArea,
    periodStart: string,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_icfr_workstream
         (workflow_instance_id, engagement_id, framework_code, framework_label, period_start,
          instantiated_by_employee_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (workflow_instance_id) DO UPDATE
          SET status = 'active', withdrawn_at = NULL, withdrawn_reason = NULL,
              version = hsdg.audit_icfr_workstream.version + 1, updated_at = now()
        WHERE hsdg.audit_icfr_workstream.status = 'withdrawn'
       RETURNING id`,
      [
        workflowInstanceId,
        engagementId,
        framework.frameworkCode,
        framework.frameworkLabel,
        periodStart,
        ctx.employeeId ?? null,
      ],
    );
    if (rows[0]) return rows[0].id;
    return (await this.loadWorkstream(client, workflowInstanceId))!.id;
  }

  /**
   * Insert the framework areas not yet in the workstream and keep system-scoped
   * areas in line with the facts. A team decision stays; only its basis
   * refreshes. Returns rows touched.
   */
  private async ensureAreas(
    client: PoolClient,
    workstreamId: string,
    engagementId: string,
    workflowInstanceId: string,
    library: IcfrLibraryArea[],
    facts: ScopingFacts,
  ): Promise<number> {
    const have = new Map((await this.loadAreas(client, workstreamId)).map((a) => [a.area_key, a]));
    let touched = 0;
    const insert: Array<Record<string, unknown>> = [];
    for (const lib of library) {
      const s = suggestScoping(lib, facts);
      const row = have.get(lib.areaKey);
      if (!row) {
        insert.push({
          library_area_id: lib.id,
          area_key: lib.areaKey,
          title: lib.title,
          description: lib.description,
          activation: lib.activation,
          procedures: lib.procedures,
          scoping: s.scoping,
          system_basis: s.basis,
          sort_order: lib.sortOrder,
        });
        continue;
      }
      const scoping = row.scoping_source === 'system' ? s.scoping : row.scoping;
      if (row.system_basis !== s.basis || row.scoping !== scoping) {
        await client.query(
          `UPDATE hsdg.audit_icfr_process_area
              SET scoping = $2, system_basis = $3, version = version + 1, updated_at = now()
            WHERE id = $1`,
          [row.id, scoping, s.basis],
        );
        touched += 1;
      }
    }
    if (insert.length) {
      const res = await client.query(
        `INSERT INTO hsdg.audit_icfr_process_area
           (workstream_id, workflow_instance_id, engagement_id, library_area_id, area_key, title,
            description, activation, procedures, source, scoping, scoping_source, system_basis,
            sort_order)
         SELECT $1, $2, $3, a.library_area_id, a.area_key, a.title, a.description, a.activation,
                a.procedures, 'framework', a.scoping, 'system', a.system_basis, a.sort_order
           FROM jsonb_to_recordset($4::jsonb) AS a(
                  library_area_id uuid, area_key text, title text, description text,
                  activation text, procedures jsonb, scoping text, system_basis text,
                  sort_order integer)
         ON CONFLICT (workstream_id, area_key) DO NOTHING`,
        [workstreamId, workflowInstanceId, engagementId, JSON.stringify(insert)],
      );
      touched += res.rowCount ?? 0;
    }
    return touched;
  }

  /** §19 — the prior year's SD / MW and unremediated deficiencies, followed up once. */
  private async ensureFollowUps(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<number> {
    const prior = await readPriorAuditFile(client, workflowInstanceId);
    if (!prior) return 0;
    const { rows } = await client.query<{
      id: string;
      seq: number;
      classification: IcfrDeficiencyClass;
      description: string;
      process: string | null;
      remediation_action: string | null;
      remediation_status: string;
    }>(
      `SELECT d.id, d.seq, d.classification, d.description,
              COALESCE(a.title, c.process) AS process, d.remediation_action, d.remediation_status
         FROM hsdg.audit_icfr_deficiency d
         LEFT JOIN hsdg.audit_icfr_process_area a ON a.id = d.process_area_id
         LEFT JOIN hsdg.audit_icfr_control c ON c.id = d.control_id
        WHERE d.workflow_instance_id = $1 AND d.withdrawn_at IS NULL
        ORDER BY d.seq`,
      [prior.workflowInstanceId],
    );
    const due = rows.filter((r) =>
      needsFollowUp({
        classification: r.classification,
        remediationStatus: r.remediation_status,
        withdrawn: false,
      }),
    );
    if (!due.length) return 0;
    const res = await client.query(
      `INSERT INTO hsdg.audit_icfr_followup
         (workflow_instance_id, engagement_id, prior_deficiency_id, prior_financial_year,
          prior_ref, prior_classification, prior_description, prior_process,
          prior_remediation_action, prior_remediation_status)
       SELECT $1, $2, f.id, $3, f.ref, f.classification, f.description, f.process,
              f.remediation_action, f.remediation_status
         FROM jsonb_to_recordset($4::jsonb) AS f(
                id uuid, ref text, classification text, description text, process text,
                remediation_action text, remediation_status text)
       ON CONFLICT (workflow_instance_id, prior_deficiency_id) DO NOTHING`,
      [
        workflowInstanceId,
        engagementId,
        prior.financialYear,
        JSON.stringify(
          due.map((r) => ({
            id: r.id,
            ref: icfrDeficiencyRef(r.seq),
            classification: r.classification,
            description: r.description,
            process: r.process,
            remediation_action: r.remediation_action,
            remediation_status: r.remediation_status,
          })),
        ),
      ],
    );
    return res.rowCount ?? 0;
  }

  private async upsertConsolidated(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_icfr_consolidated (workflow_instance_id, engagement_id)
       VALUES ($1,$2)
       ON CONFLICT (workflow_instance_id) DO UPDATE
          SET status = 'active', withdrawn_at = NULL, withdrawn_reason = NULL,
              version = hsdg.audit_icfr_consolidated.version + 1, updated_at = now()
        WHERE hsdg.audit_icfr_consolidated.status = 'withdrawn'
       RETURNING id`,
      [workflowInstanceId, engagementId],
    );
    if (rows[0]) return rows[0].id;
    return (await this.loadConsolidated(client, workflowInstanceId))!.id;
  }

  /** One component per company in the 02.6 perimeter (one source — no re-entry). */
  private async syncComponents(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    consolidatedId: string,
  ): Promise<void> {
    const { rows } = await client.query<{
      perimeter: Array<{ name: string; relationship: string }> | null;
    }>(
      `SELECT system_detail -> 'perimeter' AS perimeter
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, SUB_SECTION_KEY.consolidation, FRAMEWORK_AREA_KEY.cfs],
    );
    const perimeter = (rows[0]?.perimeter ?? []).filter(
      (p) => p?.name?.trim() && CFS_COMPONENT_RELATIONSHIPS.has(p.relationship),
    );
    const keys: string[] = [];
    let order = 0;
    for (const p of perimeter) {
      const key = componentKey(p.name);
      keys.push(key);
      order += 1;
      await client.query(
        `INSERT INTO hsdg.audit_icfr_component
           (consolidated_id, engagement_id, source, source_key, component_name, relationship, sort_order)
         VALUES ($1, $2, '02.6', $3, $4, $5, $6)
         ON CONFLICT (consolidated_id, source_key) DO UPDATE
            SET relationship = EXCLUDED.relationship, withdrawn_at = NULL
          WHERE audit_icfr_component.source = '02.6'
            AND (audit_icfr_component.withdrawn_at IS NOT NULL
                 OR audit_icfr_component.relationship IS DISTINCT FROM EXCLUDED.relationship)`,
        [
          consolidatedId,
          engagementId,
          key,
          p.name.trim(),
          p.relationship.replace(/_/g, ' '),
          order,
        ],
      );
    }
    await client.query(
      `UPDATE hsdg.audit_icfr_component
          SET withdrawn_at = now()
        WHERE consolidated_id = $1 AND source = '02.6' AND withdrawn_at IS NULL
          AND NOT (source_key = ANY($2::text[]))`,
      [consolidatedId, keys],
    );
    // 02.6 §20 — one group structure: the component auditor matrix supplies the
    // auditor, its name and the linked report; a team entry is never overwritten.
    for (const f of await componentAuditorFeedOn(client, workflowInstanceId)) {
      const auditor =
        f.auditorType === COMPONENT_AUDITOR_TYPE.dhvaj
          ? 'dhvaj'
          : f.auditorType === COMPONENT_AUDITOR_TYPE.otherAuditor
            ? 'other'
            : null;
      if (!auditor) continue;
      await client.query(
        `UPDATE hsdg.audit_icfr_component
            SET auditor = COALESCE(auditor, $3),
                auditor_name = CASE WHEN auditor IS NULL OR auditor = $3
                                    THEN COALESCE(auditor_name, $4) ELSE auditor_name END,
                report_document_id = COALESCE(report_document_id, $5)
          WHERE consolidated_id = $1 AND source_key = $2 AND withdrawn_at IS NULL
            AND (auditor IS NULL
              OR (auditor = $3 AND auditor_name IS NULL AND $4::text IS NOT NULL)
              OR (report_document_id IS NULL AND $5::uuid IS NOT NULL))`,
        [consolidatedId, componentKey(f.componentName), auditor, f.auditorName, f.reportDocumentId],
      );
    }
  }

  // ── View assembly ──────────────────────────────────────────────────────

  private async readView(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    ensured: Ensured,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    const ws = await this.loadWorkstream(client, workflowInstanceId);
    const readOnly = !(await isEngagementLead(client, engagementId));
    const prior = await readPriorAuditFile(client, workflowInstanceId);
    const [areaRows, controlRows, deficiencyRows, followUps, risks, workAreas, priorControls] =
      await Promise.all([
        ws ? this.loadAreas(client, ws.id) : Promise.resolve([] as AreaRow[]),
        this.loadControls(client, workflowInstanceId),
        this.loadDeficiencies(client, workflowInstanceId),
        this.readFollowUps(client, workflowInstanceId),
        this.readRisks(client, workflowInstanceId),
        this.readWorkAreas(client, workflowInstanceId),
        this.readPriorControls(client, prior),
      ]);
    const evidence = await this.readEvidence(
      client,
      controlRows.map((c) => c.id),
    );
    const refById = new Map(controlRows.map((c) => [c.id, c.control_ref]));
    const defsByControl = new Map<string, string[]>();
    for (const d of deficiencyRows)
      if (d.control_id && !d.withdrawn_at)
        defsByControl.set(d.control_id, [
          ...(defsByControl.get(d.control_id) ?? []),
          icfrDeficiencyRef(d.seq),
        ]);

    const controls: IcfrControl[] = controlRows.map((r) => {
      const ev = evidence.get(r.id) ?? [];
      const defs = defsByControl.get(r.id) ?? [];
      const overall = controlOverall({
        design: r.design,
        implementation: r.implementation,
        operatingEffectiveness: r.operating_effectiveness,
      });
      return {
        id: r.id,
        seq: r.seq,
        controlRef: r.control_ref,
        processAreaId: r.process_area_id,
        process: r.process,
        description: r.description,
        purposeFsAudit: r.purpose_fs_audit,
        purposeIcfr: r.purpose_icfr,
        assertions: r.assertions,
        relatedRiskId: r.related_risk_id,
        relatedRiskRef: r.related_risk_ref,
        relatedRisk: r.related_risk,
        nature: r.nature,
        frequency: r.frequency,
        isKey: r.is_key,
        owner: r.owner,
        procedureId: r.procedure_id,
        procedureRef: r.procedure_ref,
        design: r.design,
        implementation: r.implementation,
        operatingEffectiveness: r.operating_effectiveness,
        overall,
        testNote: r.test_note,
        reviewState: r.review_state,
        returnNote: r.return_note,
        submittedByName: r.submitted_by_name,
        submittedAt: iso(r.submitted_at),
        reviewedByName: r.reviewed_by_name,
        reviewedAt: iso(r.reviewed_at),
        evidence: ev,
        deficiencies: defs,
        priorYear: priorControls?.get(r.control_ref.toLowerCase()) ?? null,
        blockers:
          r.review_state === 'reviewed' || r.withdrawn_at
            ? []
            : controlBlockers({
                purposeIcfr: r.purpose_icfr,
                design: r.design,
                implementation: r.implementation,
                operatingEffectiveness: r.operating_effectiveness,
                testNote: r.test_note,
                evidence: ev.length,
                deficiencies: defs.length,
              }),
        withdrawn: r.withdrawn_at != null,
        version: r.version,
      };
    });

    const deficiencies: IcfrDeficiency[] = deficiencyRows.map((r) => {
      const review = this.deficiencyForReview(r);
      return {
        id: r.id,
        seq: r.seq,
        ref: icfrDeficiencyRef(r.seq),
        classification: r.classification,
        suggestedClassification: suggestDeficiencyClass(r.magnitude, r.likelihood),
        description: r.description,
        controlId: r.control_id,
        controlRef: r.control_ref,
        processAreaId: r.process_area_id,
        processTitle: r.process_title,
        workAreaKey: r.work_area_key,
        affectedAccount: r.affected_account,
        assertions: r.assertions,
        magnitude: r.magnitude,
        likelihood: r.likelihood,
        compensatingControlIds: r.compensating_control_ids,
        compensatingControlRefs: r.compensating_control_ids
          .map((id) => refById.get(id))
          .filter((x): x is string => !!x),
        compensatingNote: r.compensating_note,
        remediationAction: r.remediation_action,
        remediationStatus: r.remediation_status,
        auditImpact: r.audit_impact,
        reportingImpact: r.reporting_impact,
        reportingNote: r.reporting_note,
        followUpId: r.followup_id,
        reviewedByName: r.reviewed_by_name,
        reviewedAt: iso(r.reviewed_at),
        partnerRequired: partnerRequiredFor(r.classification),
        partnerConclusion: r.partner_conclusion,
        partnerByName: r.partner_by_name,
        partnerAt: iso(r.partner_at),
        status: r.status,
        blockers: r.withdrawn_at
          ? []
          : !r.reviewed_at
            ? deficiencyBlockers(review, 'manager_review')
            : partnerRequiredFor(r.classification) && !r.partner_at
              ? deficiencyBlockers(review, 'partner_conclude')
              : [],
        withdrawn: r.withdrawn_at != null,
        version: r.version,
      };
    });

    const liveControls = controls.filter((c) => !c.withdrawn);
    const processAreas: IcfrProcessArea[] = areaRows.map((a) => {
      const mine = liveControls.filter((c) => c.processAreaId === a.id);
      return {
        id: a.id,
        areaKey: a.area_key,
        title: a.title,
        description: a.description,
        activation: a.activation,
        source: a.source,
        scoping: a.scoping,
        scopingSource: a.scoping_source,
        suggestedScoping:
          a.source === 'manual'
            ? a.scoping
            : suggestScoping(
                {
                  activation: a.activation,
                  triggerAreaCodes: a.trigger_area_codes ?? [],
                  triggerKeywords: a.trigger_keywords ?? [],
                },
                ensured.facts,
              ).scoping,
        systemBasis: a.system_basis,
        scopingReason: a.scoping_reason,
        scopedByName: a.scoped_by_name,
        scopedAt: iso(a.scoped_at),
        procedures: a.procedures ?? [],
        controls: mine.length,
        keyIcfrControls: mine.filter((c) => c.purposeIcfr && c.isKey).length,
        openDeficiencies: deficiencies.filter(
          (d) => !d.withdrawn && d.status === 'open' && d.processAreaId === a.id,
        ).length,
        withdrawn: a.status === 'withdrawn',
        version: a.version,
      };
    });

    const deficiencySummary = summariseDeficiencies(
      deficiencies.map((d) => ({
        classification: d.classification,
        status: d.status,
        reviewed: d.reviewedAt != null,
        partnerConcluded: d.partnerAt != null,
        withdrawn: d.withdrawn,
      })),
    );
    const active = ws?.status === 'active';
    return {
      workflowInstanceId,
      engagementId,
      state:
        ws && ensured.workstream.state === 'awaiting_conclusion'
          ? ws.status
          : ensured.workstream.state,
      reason: ensured.workstream.reason,
      level1: ensured.level1,
      workstream: ws ? mapWorkstream(ws) : null,
      processAreas,
      controls,
      deficiencies,
      followUps,
      priorYear: await this.priorYearContext(client, prior),
      summary: summariseWorkstream({
        areas: processAreas.map((a) => ({ scoping: a.scoping, withdrawn: a.withdrawn })),
        controls: controls.map((c) => ({
          purposeFsAudit: c.purposeFsAudit,
          purposeIcfr: c.purposeIcfr,
          overall: c.overall,
          reviewState: c.reviewState,
          withdrawn: c.withdrawn,
        })),
        deficiencies: deficiencySummary,
        followUps,
      }),
      conclusionBlockers: active
        ? workstreamConclusionBlockers(
            {
              areas: processAreas.map((a) => ({
                title: a.title,
                scoping: a.scoping,
                keyIcfrControls: a.keyIcfrControls,
                withdrawn: a.withdrawn,
              })),
              controls: controls.map((c) => ({
                ref: c.controlRef,
                purposeIcfr: c.purposeIcfr,
                reviewState: c.reviewState,
                withdrawn: c.withdrawn,
              })),
              deficiencies: deficiencies.map((d) => ({
                ref: d.ref,
                classification: d.classification,
                reviewed: d.reviewedAt != null,
                partnerConcluded: d.partnerAt != null,
                withdrawn: d.withdrawn,
              })),
              followUps: followUps.map((f) => ({ priorRef: f.priorRef, status: f.status })),
            },
            ws?.conclusion ?? null,
          )
        : [],
      methodology: ICFR_DEFICIENCY_METHODOLOGY,
      risks,
      workAreas: workAreas.map((a) => ({ key: a.work_area_key, title: a.title })),
      readOnly,
    };
  }

  private async readConsolidatedView(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    ensured: Ensured,
  ): Promise<StatutoryAuditIcfrConsolidated> {
    const c = await this.loadConsolidated(client, workflowInstanceId);
    const readOnly = !(await isEngagementLead(client, engagementId));
    const components = c ? await this.readComponents(client, c.id) : [];
    const live = components.filter((x) => !x.withdrawn);
    const forConclusion = components.map(componentForConclusion);
    const parentMw = await this.parentMaterialWeakness(client, workflowInstanceId);
    const active = c?.status === 'active';
    return {
      workflowInstanceId,
      engagementId,
      state: c && ensured.consolidated.state === 'pending' ? c.status : ensured.consolidated.state,
      reason: ensured.consolidated.reason,
      consolidated: c
        ? {
            id: c.id,
            status: c.status,
            withdrawnReason: c.withdrawn_reason,
            parentConclusion: c.parent_conclusion,
            parentConclusionNote: c.parent_conclusion_note,
            concludedByName: c.concluded_by_name,
            concludedAt: iso(c.concluded_at),
            version: c.version,
          }
        : null,
      components,
      summary: {
        components: live.length,
        pending: live.filter((x) => x.missing.length > 0).length,
        indianCompanies: live.filter((x) => x.indianCompany === 'yes').length,
        materialWeaknesses: live.filter((x) => x.materialWeakness === true).length,
      },
      suggestedConclusion: active ? suggestParentConclusion(forConclusion, parentMw) : null,
      conclusionBlockers: active
        ? consolidatedConclusionBlockers(
            forConclusion,
            components.map((x) => x.componentName),
            c?.parent_conclusion ?? null,
            parentMw,
          )
        : [],
      readOnly,
    };
  }

  private async readComponents(
    client: PoolClient,
    consolidatedId: string,
  ): Promise<IcfrComponent[]> {
    const { rows } = await client.query<{
      id: string;
      source: '02.6' | 'manual';
      component_name: string;
      relationship: string | null;
      indian_company: 'yes' | 'no' | null;
      component_icfr: IcfrComponentIcfr;
      auditor: IcfrComponentAuditor | null;
      auditor_name: string | null;
      report_document_id: string | null;
      report_document_title: string | null;
      materiality: IcfrComponentMateriality | null;
      materiality_note: string | null;
      material_weakness: boolean | null;
      material_weakness_details: string | null;
      withdrawn_at: Date | null;
      version: number;
    }>(
      `SELECT m.id, m.source, m.component_name, m.relationship, m.indian_company, m.component_icfr,
              m.auditor, m.auditor_name, m.report_document_id, d.title AS report_document_title,
              m.materiality, m.materiality_note, m.material_weakness, m.material_weakness_details,
              m.withdrawn_at, m.version
         FROM hsdg.audit_icfr_component m
         LEFT JOIN hsdg.documents d ON d.id = m.report_document_id AND d.deleted_at IS NULL
        WHERE m.consolidated_id = $1
        ORDER BY (m.withdrawn_at IS NOT NULL), m.sort_order, m.component_name`,
      [consolidatedId],
    );
    return rows.map((r) => {
      const base = {
        indianCompany: r.indian_company,
        componentIcfr: r.component_icfr,
        auditor: r.auditor,
        reportLinked: r.report_document_id != null,
        materiality: r.materiality,
        materialWeakness: r.material_weakness,
        withdrawn: r.withdrawn_at != null,
      };
      return {
        id: r.id,
        source: r.source,
        componentName: r.component_name,
        relationship: r.relationship,
        indianCompany: r.indian_company,
        componentIcfr: r.component_icfr,
        auditor: r.auditor,
        auditorName: r.auditor_name,
        reportDocumentId: r.report_document_id,
        reportDocumentTitle: r.report_document_title,
        materiality: r.materiality,
        materialityNote: r.materiality_note,
        materialWeakness: r.material_weakness,
        materialWeaknessDetails: r.material_weakness_details,
        missing: base.withdrawn ? [] : componentMissing(base),
        withdrawn: base.withdrawn,
        version: r.version,
      };
    });
  }

  private async readEvidence(
    client: PoolClient,
    controlIds: string[],
  ): Promise<Map<string, IcfrControlEvidence[]>> {
    const out = new Map<string, IcfrControlEvidence[]>();
    if (!controlIds.length) return out;
    const { rows } = await client.query<{
      id: string;
      control_id: string;
      document_id: string | null;
      audit_evidence_id: string | null;
      title: string | null;
      note: string | null;
      linked_by_name: string | null;
      linked_at: Date;
      also: string[] | null;
    }>(
      `SELECT l.id, l.control_id, COALESCE(l.document_id, ev.document_id) AS document_id,
              l.audit_evidence_id, COALESCE(d.title, ev.title) AS title, l.note,
              lb.full_name AS linked_by_name, l.linked_at,
              ARRAY(SELECT DISTINCT oc.control_ref
                      FROM hsdg.audit_icfr_control_evidence o
                      JOIN hsdg.audit_icfr_control oc ON oc.id = o.control_id
                     WHERE o.removed_at IS NULL AND o.control_id <> l.control_id
                       AND oc.withdrawn_at IS NULL
                       AND (o.document_id = l.document_id
                            OR o.audit_evidence_id = l.audit_evidence_id)) AS also
         FROM hsdg.audit_icfr_control_evidence l
         LEFT JOIN hsdg.audit_evidence ev ON ev.id = l.audit_evidence_id
         LEFT JOIN hsdg.documents d ON d.id = COALESCE(l.document_id, ev.document_id)
                                   AND d.deleted_at IS NULL
         LEFT JOIN hsdg.employees lb ON lb.id = l.linked_by_employee_id
        WHERE l.control_id = ANY($1::uuid[]) AND l.removed_at IS NULL
        ORDER BY l.linked_at`,
      [controlIds],
    );
    for (const r of rows) {
      const list = out.get(r.control_id) ?? [];
      list.push({
        id: r.id,
        documentId: r.document_id,
        auditEvidenceId: r.audit_evidence_id,
        title: r.title ?? 'Removed document',
        note: r.note,
        linkedByName: r.linked_by_name,
        linkedAt: r.linked_at.toISOString(),
        alsoSupports: r.also ?? [],
      });
      out.set(r.control_id, list);
    }
    return out;
  }

  private async readFollowUps(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<IcfrFollowUp[]> {
    const { rows } = await client.query<{
      id: string;
      prior_financial_year: string;
      prior_ref: string;
      prior_classification: IcfrDeficiencyClass;
      prior_description: string;
      prior_process: string | null;
      prior_remediation_action: string | null;
      prior_remediation_status: string;
      status: IcfrFollowUpStatus;
      conclusion_note: string | null;
      deficiency_id: string | null;
      deficiency_seq: number | null;
      concluded_by_name: string | null;
      concluded_at: Date | null;
      version: number;
    }>(
      `SELECT f.id, f.prior_financial_year, f.prior_ref, f.prior_classification, f.prior_description,
              f.prior_process, f.prior_remediation_action, f.prior_remediation_status, f.status,
              f.conclusion_note, f.deficiency_id, d.seq AS deficiency_seq,
              e.full_name AS concluded_by_name, f.concluded_at, f.version
         FROM hsdg.audit_icfr_followup f
         LEFT JOIN hsdg.audit_icfr_deficiency d ON d.id = f.deficiency_id
         LEFT JOIN hsdg.employees e ON e.id = f.concluded_by_employee_id
        WHERE f.workflow_instance_id = $1
        ORDER BY f.prior_ref`,
      [workflowInstanceId],
    );
    return rows.map((r) => ({
      id: r.id,
      priorFinancialYear: r.prior_financial_year,
      priorRef: r.prior_ref,
      priorClassification: r.prior_classification,
      priorDescription: r.prior_description,
      priorProcess: r.prior_process,
      priorRemediationAction: r.prior_remediation_action,
      priorRemediationStatus: r.prior_remediation_status,
      status: r.status,
      conclusionNote: r.conclusion_note,
      deficiencyId: r.deficiency_id,
      deficiencyRef: r.deficiency_seq != null ? icfrDeficiencyRef(r.deficiency_seq) : null,
      concludedByName: r.concluded_by_name,
      concludedAt: iso(r.concluded_at),
      version: r.version,
    }));
  }

  private async readRisks(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditIcfrWorkstream['risks']> {
    const { rows } = await client.query<{
      id: string;
      risk_ref: string;
      description: string;
      fs_area: string | null;
    }>(
      `SELECT id, risk_ref, description, fs_area FROM hsdg.audit_risks
        WHERE workflow_instance_id = $1 ORDER BY risk_ref`,
      [workflowInstanceId],
    );
    return rows.map((r) => ({
      id: r.id,
      ref: r.risk_ref,
      description: r.description,
      fsArea: r.fs_area,
    }));
  }

  private async readWorkAreas(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<Array<{ work_area_key: string; title: string }>> {
    const { rows } = await client.query<{ work_area_key: string; title: string }>(
      `SELECT work_area_key, title FROM hsdg.audit_work_areas
        WHERE workflow_instance_id = $1 AND is_active ORDER BY sort_order`,
      [workflowInstanceId],
    );
    return rows;
  }

  /** The facts that scope the framework (03.5 accounts, Section 04 risks, 02.1 IT). */
  private async readScopingFacts(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<ScopingFacts> {
    const [{ rows: areas }, { rows: risks }, { rows: profile }] = await Promise.all([
      client.query<{ code: string | null; name: string; attention: 'standard' | 'enhanced' }>(
        `SELECT a.area_code AS code, a.area_name AS name, a.attention
           FROM hsdg.audit_engagement_area a
           JOIN hsdg.audit_area_review r ON r.id = a.review_id
          WHERE r.workflow_instance_id = $1 AND a.disposition = 'retained'
          ORDER BY a.seq`,
        [workflowInstanceId],
      ),
      client.query<{
        ref: string;
        fs_area: string | null;
        description: string;
        is_significant: boolean;
      }>(
        `SELECT risk_ref AS ref, fs_area, description, is_significant
           FROM hsdg.audit_risks WHERE workflow_instance_id = $1 ORDER BY risk_ref`,
        [workflowInstanceId],
      ),
      client.query<{ accounting_software: string | null; records_electronic: 'yes' | 'no' | null }>(
        `SELECT accounting_software, records_electronic
           FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      ),
    ]);
    return {
      areas,
      risks: risks.map((r) => ({
        ref: r.ref,
        fsArea: r.fs_area,
        description: r.description,
        isSignificant: r.is_significant,
      })),
      accountingSoftware: profile[0]?.accounting_software ?? null,
      recordsElectronic: profile[0]?.records_electronic ?? null,
    };
  }

  // ── Prior year (spec §19) — context only, never rolled forward ─────────

  private async readPriorControls(
    client: PoolClient,
    prior: PriorAuditFile | null,
  ): Promise<Map<string, IcfrPriorControl> | null> {
    if (!prior) return null;
    const { rows } = await client.query<{
      control_ref: string;
      design: IcfrDesign | null;
      implementation: IcfrImplementation | null;
      operating_effectiveness: IcfrOperating | null;
      evidence: Array<{ documentId: string | null; title: string | null }> | null;
    }>(
      // Prior evidence is a cross-reference only (§19) — titles, never re-linked here.
      `SELECT c.control_ref, c.design, c.implementation, c.operating_effectiveness,
              (SELECT json_agg(json_build_object(
                        'documentId', COALESCE(l.document_id, ev.document_id),
                        'title', COALESCE(d.title, ev.title)) ORDER BY l.linked_at)
                 FROM hsdg.audit_icfr_control_evidence l
                 LEFT JOIN hsdg.audit_evidence ev ON ev.id = l.audit_evidence_id
                 LEFT JOIN hsdg.documents d ON d.id = COALESCE(l.document_id, ev.document_id)
                                           AND d.deleted_at IS NULL
                WHERE l.control_id = c.id AND l.removed_at IS NULL) AS evidence
         FROM hsdg.audit_icfr_control c
        WHERE c.workflow_instance_id = $1 AND c.withdrawn_at IS NULL`,
      [prior.workflowInstanceId],
    );
    return new Map(
      rows.map((r) => [
        r.control_ref.toLowerCase(),
        {
          financialYear: prior.financialYear,
          engagementId: prior.engagementId,
          evidence: (r.evidence ?? []).map((e) => ({
            documentId: e.documentId,
            title: e.title ?? 'Removed document',
          })),
          design: r.design,
          implementation: r.implementation,
          operatingEffectiveness: r.operating_effectiveness,
          overall: controlOverall({
            design: r.design,
            implementation: r.implementation,
            operatingEffectiveness: r.operating_effectiveness,
          }),
        },
      ]),
    );
  }

  private async priorYearContext(
    client: PoolClient,
    prior: PriorAuditFile | null,
  ): Promise<IcfrControlsPriorYear | null> {
    if (!prior) return null;
    const [{ rows: sub }, { rows: ws }, { rows: defs }] = await Promise.all([
      client.query<{ outcome: IcfrOutcome | null }>(
        `SELECT COALESCE(conclusion, system_outcome) AS outcome
           FROM hsdg.audit_framework_subassessment
          WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
        [prior.workflowInstanceId, SUB_SECTION_KEY.icfr, FRAMEWORK_AREA_KEY.ifc],
      ),
      client.query<{ conclusion: IcfrWorkstreamConclusion | null }>(
        `SELECT conclusion FROM hsdg.audit_icfr_workstream WHERE workflow_instance_id = $1`,
        [prior.workflowInstanceId],
      ),
      client.query<{
        seq: number;
        classification: IcfrDeficiencyClass;
        description: string;
        remediation_status: string;
      }>(
        `SELECT seq, classification, description, remediation_status
           FROM hsdg.audit_icfr_deficiency
          WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL
            AND classification IN ('significant_deficiency','material_weakness')
          ORDER BY seq`,
        [prior.workflowInstanceId],
      ),
    ]);
    if (!sub[0] && !ws[0] && !defs.length) return null;
    const pick = (c: IcfrDeficiencyClass) =>
      defs
        .filter((d) => d.classification === c)
        .map((d) => ({
          ref: icfrDeficiencyRef(d.seq),
          description: d.description,
          remediationStatus: d.remediation_status,
        }));
    return {
      financialYear: prior.financialYear,
      applicability: sub[0]?.outcome ?? null,
      workstreamConclusion: ws[0]?.conclusion ?? null,
      materialWeaknesses: pick('material_weakness'),
      significantDeficiencies: pick('significant_deficiency'),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async mutate(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    fn: (client: PoolClient) => Promise<void>,
  ): Promise<StatutoryAuditIcfrWorkstream> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertLeadShell(client, engagementId, workflowInstanceId);
      await fn(client);
      const ensured = await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
      return this.readView(client, engagementId, workflowInstanceId, ensured);
    });
  }

  private async mutateConsolidated(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    fn: (client: PoolClient) => Promise<void>,
  ): Promise<StatutoryAuditIcfrConsolidated> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertLeadShell(client, engagementId, workflowInstanceId);
      await fn(client);
      const ensured = await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
      return this.readConsolidatedView(client, engagementId, workflowInstanceId, ensured);
    });
  }

  private async assertLeadShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ) {
    await this.assertShell(client, engagementId, workflowInstanceId);
    if (!(await isEngagementLead(client, engagementId)))
      throw new ForbiddenException('Only the engagement leads can change the ICFR workstream.');
  }

  private async controlForReview(client: PoolClient, c: ControlRow) {
    const [{ rows: ev }, { rows: defs }] = await Promise.all([
      client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM hsdg.audit_icfr_control_evidence
          WHERE control_id = $1 AND removed_at IS NULL`,
        [c.id],
      ),
      client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM hsdg.audit_icfr_deficiency
          WHERE control_id = $1 AND withdrawn_at IS NULL`,
        [c.id],
      ),
    ]);
    return {
      purposeIcfr: c.purpose_icfr,
      design: c.design,
      implementation: c.implementation,
      operatingEffectiveness: c.operating_effectiveness,
      testNote: c.test_note,
      evidence: ev[0]!.n,
      deficiencies: defs[0]!.n,
    };
  }

  private deficiencyForReview(d: DeficiencyRow) {
    return {
      classification: d.classification,
      magnitude: d.magnitude,
      likelihood: d.likelihood,
      assertions: d.assertions,
      affected: !!(d.affected_account?.trim() || d.process_area_id || d.control_id),
      compensatingControls: d.compensating_control_ids.length,
      compensatingNote: d.compensating_note,
      remediationAction: d.remediation_action,
      remediationStatus: d.remediation_status,
      auditImpact: d.audit_impact,
      reportingImpact: d.reporting_impact,
      reviewed: d.reviewed_at != null,
    };
  }

  private async conclusionInput(
    client: PoolClient,
    workflowInstanceId: string,
    workstreamId: string,
  ) {
    const [areas, controls, defs, { rows: fus }] = await Promise.all([
      this.loadAreas(client, workstreamId),
      this.loadControls(client, workflowInstanceId),
      this.loadDeficiencies(client, workflowInstanceId),
      client.query<{ prior_ref: string; status: IcfrFollowUpStatus }>(
        `SELECT prior_ref, status FROM hsdg.audit_icfr_followup WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      ),
    ]);
    const live = controls.filter((c) => !c.withdrawn_at);
    return {
      areas: areas.map((a) => ({
        title: a.title,
        scoping: a.scoping,
        keyIcfrControls: live.filter(
          (c) => c.process_area_id === a.id && c.purpose_icfr && c.is_key,
        ).length,
        withdrawn: a.status === 'withdrawn',
      })),
      controls: controls.map((c) => ({
        ref: c.control_ref,
        purposeIcfr: c.purpose_icfr,
        reviewState: c.review_state,
        withdrawn: c.withdrawn_at != null,
      })),
      deficiencies: defs.map((d) => ({
        ref: icfrDeficiencyRef(d.seq),
        classification: d.classification,
        reviewed: d.reviewed_at != null,
        partnerConcluded: d.partner_at != null,
        withdrawn: d.withdrawn_at != null,
      })),
      followUps: fus.map((f) => ({ priorRef: f.prior_ref, status: f.status })),
    };
  }

  private async parentMaterialWeakness(client: PoolClient, workflowInstanceId: string) {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_icfr_deficiency
        WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL
          AND classification = 'material_weakness' LIMIT 1`,
      [workflowInstanceId],
    );
    return rows.length > 0;
  }

  private async insertDeficiency(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateIcfrDeficiencyInput,
  ): Promise<string> {
    // Serialise the ICD-00n sequence per audit file (concurrent raises).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('icfr_deficiency:' || $1))`, [
      workflowInstanceId,
    ]);
    const { rows: seq } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM hsdg.audit_icfr_deficiency
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_icfr_deficiency
         (workflow_instance_id, engagement_id, seq, classification, description, control_id,
          process_area_id, work_area_key, affected_account, assertions, magnitude, likelihood,
          compensating_control_ids, compensating_note, remediation_action, remediation_status,
          audit_impact, reporting_impact, reporting_note, followup_id, raised_by_employee_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
      [
        workflowInstanceId,
        engagementId,
        seq[0]!.next,
        input.classification,
        input.description.trim(),
        input.controlId ?? null,
        input.processAreaId ?? null,
        input.workAreaKey ?? ICFR_WORK_AREA_KEY,
        trimOrNull(input.affectedAccount),
        input.assertions ?? [],
        input.magnitude ?? null,
        input.likelihood ?? null,
        input.compensatingControlIds ?? [],
        trimOrNull(input.compensatingNote),
        trimOrNull(input.remediationAction),
        input.remediationStatus ?? 'not_started',
        trimOrNull(input.auditImpact),
        input.reportingImpact ?? null,
        trimOrNull(input.reportingNote),
        input.followUpId ?? null,
        ctx.employeeId ?? null,
      ],
    );
    return rows[0]!.id;
  }

  private async assertWorkstreamActive(client: PoolClient, workflowInstanceId: string) {
    const ws = await this.loadWorkstream(client, workflowInstanceId);
    if (!ws)
      throw new BadRequestException(
        'The ICFR workstream is configured once 02.5 finds section 143(3)(i) reporting applies — until then a control can be relied on for the FS audit only.',
      );
    if (ws.status !== 'active')
      throw new BadRequestException(
        'Section 143(3)(i) reporting does not apply (02.5) — a control can be relied on for the FS audit only.',
      );
  }

  private async assertControlLinks(
    client: PoolClient,
    workflowInstanceId: string,
    riskId: string | null | undefined,
    procedureId: string | null | undefined,
  ) {
    if (riskId) {
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.audit_risks WHERE id = $1 AND workflow_instance_id = $2`,
        [riskId, workflowInstanceId],
      );
      if (!rows[0]) throw new BadRequestException('That risk is not in this audit file.');
    }
    if (procedureId) {
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.audit_procedures WHERE id = $1 AND workflow_instance_id = $2`,
        [procedureId, workflowInstanceId],
      );
      if (!rows[0]) throw new BadRequestException('That procedure is not in this audit file.');
    }
  }

  private async assertDeficiencyLinks(
    client: PoolClient,
    workflowInstanceId: string,
    input: Partial<CreateIcfrDeficiencyInput>,
  ) {
    if (input.workAreaKey && input.workAreaKey !== ICFR_WORK_AREA_KEY) {
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.audit_work_areas WHERE workflow_instance_id = $1 AND work_area_key = $2`,
        [workflowInstanceId, input.workAreaKey],
      );
      if (!rows[0]) throw new BadRequestException('That audit area is not in this audit file.');
    }
    if (input.compensatingControlIds?.length) {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM hsdg.audit_icfr_control
          WHERE workflow_instance_id = $1 AND id = ANY($2::uuid[]) AND withdrawn_at IS NULL`,
        [workflowInstanceId, input.compensatingControlIds],
      );
      if (rows[0]!.n !== new Set(input.compensatingControlIds).size)
        throw new BadRequestException('A compensating control is not in this audit file.');
    }
    if (input.followUpId) {
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.audit_icfr_followup WHERE id = $1 AND workflow_instance_id = $2`,
        [input.followUpId, workflowInstanceId],
      );
      if (!rows[0]) throw new BadRequestException('That follow-up is not in this audit file.');
    }
  }

  private async assertDocument(client: PoolClient, engagementId: string, documentId: string) {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
      [documentId, engagementId],
    );
    if (!rows[0]) throw new BadRequestException('That document is not on this engagement.');
  }

  private async engagementPartner(
    client: PoolClient,
    engagementId: string,
  ): Promise<string | null> {
    const { rows } = await client.query<{ engagement_partner_id: string | null }>(
      `SELECT engagement_partner_id FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    return rows[0]?.engagement_partner_id ?? null;
  }

  private async loadWorkstream(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<WorkstreamRow | null> {
    const { rows } = await client.query<WorkstreamRow>(
      `SELECT w.id, w.framework_code, w.framework_label, w.period_start::text AS period_start,
              w.status, w.withdrawn_at, w.withdrawn_reason, w.conclusion, w.conclusion_note,
              e.full_name AS concluded_by_name, w.concluded_at, w.created_at, w.version
         FROM hsdg.audit_icfr_workstream w
         LEFT JOIN hsdg.employees e ON e.id = w.concluded_by_employee_id
        WHERE w.workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows[0] ?? null;
  }

  private async loadAreas(client: PoolClient, workstreamId: string): Promise<AreaRow[]> {
    const { rows } = await client.query<AreaRow>(
      `${AREA_SELECT} WHERE a.workstream_id = $1 ORDER BY a.sort_order, a.title`,
      [workstreamId],
    );
    return rows;
  }

  private async loadArea(
    client: PoolClient,
    workflowInstanceId: string,
    areaId: string,
  ): Promise<AreaRow> {
    const { rows } = await client.query<AreaRow>(
      `${AREA_SELECT} WHERE a.id = $1 AND a.workflow_instance_id = $2`,
      [areaId, workflowInstanceId],
    );
    if (!rows[0]) throw new NotFoundException('Process area not found in this audit file.');
    return rows[0];
  }

  private async loadControls(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<ControlRow[]> {
    const { rows } = await client.query<ControlRow>(
      `${CONTROL_SELECT} WHERE c.workflow_instance_id = $1 ORDER BY (c.withdrawn_at IS NOT NULL), c.seq`,
      [workflowInstanceId],
    );
    return rows;
  }

  private async loadControl(
    client: PoolClient,
    workflowInstanceId: string,
    id: string,
  ): Promise<ControlRow> {
    const { rows } = await client.query<ControlRow>(
      `${CONTROL_SELECT} WHERE c.id = $1 AND c.workflow_instance_id = $2`,
      [id, workflowInstanceId],
    );
    if (!rows[0]) throw new NotFoundException('Control not found in this audit file.');
    return rows[0];
  }

  private async loadDeficiencies(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<DeficiencyRow[]> {
    const { rows } = await client.query<DeficiencyRow>(
      `${DEFICIENCY_SELECT} WHERE d.workflow_instance_id = $1 ORDER BY d.seq`,
      [workflowInstanceId],
    );
    return rows;
  }

  private async loadDeficiency(
    client: PoolClient,
    workflowInstanceId: string,
    id: string,
  ): Promise<DeficiencyRow> {
    const { rows } = await client.query<DeficiencyRow>(
      `${DEFICIENCY_SELECT} WHERE d.id = $1 AND d.workflow_instance_id = $2`,
      [id, workflowInstanceId],
    );
    if (!rows[0]) throw new NotFoundException('Deficiency not found in this audit file.');
    return rows[0];
  }

  private async loadConsolidated(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<ConsolidatedRow | null> {
    const { rows } = await client.query<ConsolidatedRow>(
      `SELECT c.id, c.status, c.withdrawn_reason, c.parent_conclusion, c.parent_conclusion_note,
              e.full_name AS concluded_by_name, c.concluded_at, c.version
         FROM hsdg.audit_icfr_consolidated c
         LEFT JOIN hsdg.employees e ON e.id = c.concluded_by_employee_id
        WHERE c.workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows[0] ?? null;
  }

  private async loadLibrary(client: PoolClient): Promise<IcfrLibraryArea[]> {
    const { rows } = await client.query<{
      id: string;
      framework_code: string;
      framework_label: string;
      area_key: string;
      title: string;
      description: string;
      activation: IcfrActivation;
      trigger_area_codes: string[];
      trigger_keywords: string[];
      procedures: IcfrProcedureTemplate[];
      sort_order: number;
      effective_from: string;
      effective_to: string | null;
    }>(
      `SELECT id, framework_code, framework_label, area_key, title, description, activation,
              trigger_area_codes, trigger_keywords, procedures, sort_order,
              effective_from::text AS effective_from, effective_to::text AS effective_to
         FROM hsdg.icfr_process_area_library ORDER BY sort_order`,
    );
    return rows.map((r) => ({
      id: r.id,
      frameworkCode: r.framework_code,
      frameworkLabel: r.framework_label,
      areaKey: r.area_key,
      title: r.title,
      description: r.description,
      activation: r.activation,
      triggerAreaCodes: r.trigger_area_codes,
      triggerKeywords: r.trigger_keywords,
      procedures: r.procedures ?? [],
      sortOrder: r.sort_order,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
    }));
  }

  private async assertShell(client: PoolClient, engagementId: string, workflowInstanceId: string) {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances
        WHERE id = $1 AND engagement_id = $2 AND status <> 'cancelled'`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
  }
}

const AREA_SELECT = `
  SELECT a.id, a.library_area_id, a.area_key, a.title, a.description, a.activation, a.procedures,
         a.source, a.scoping, a.scoping_source, a.system_basis, a.scoping_reason,
         e.full_name AS scoped_by_name, a.scoped_at, a.sort_order, a.status, a.version,
         l.trigger_area_codes, l.trigger_keywords
    FROM hsdg.audit_icfr_process_area a
    LEFT JOIN hsdg.icfr_process_area_library l ON l.id = a.library_area_id
    LEFT JOIN hsdg.employees e ON e.id = a.scoped_by_employee_id`;

function mapWorkstream(w: WorkstreamRow): IcfrWorkstreamRecord {
  return {
    id: w.id,
    frameworkCode: w.framework_code,
    frameworkLabel: w.framework_label,
    periodStart: dateOnly(w.period_start),
    status: w.status,
    withdrawnAt: iso(w.withdrawn_at),
    withdrawnReason: w.withdrawn_reason,
    conclusion: w.conclusion,
    conclusionNote: w.conclusion_note,
    concludedByName: w.concluded_by_name,
    concludedAt: iso(w.concluded_at),
    createdAt: w.created_at.toISOString(),
    version: w.version,
  };
}

/** The 02.5 result as the workstream acts on it. */
export function toLevel1(r: IcfrApprovedResult | null): IcfrWorkstreamLevel1 | null {
  if (!r) return null;
  return {
    outcome: r.outcome,
    decided: r.decided,
    reportingApplies: r.reportingApplies,
    consolidatedStatus: r.consolidated.status,
    financialYear: r.financialYear,
    periodStart: r.periodStart,
  };
}

function componentForConclusion(c: IcfrComponent): ComponentForConclusion {
  return {
    indianCompany: c.indianCompany,
    componentIcfr: c.componentIcfr,
    auditor: c.auditor,
    reportLinked: c.reportDocumentId != null,
    materiality: c.materiality,
    materialWeakness: c.materialWeakness,
    withdrawn: c.withdrawn,
  };
}

function componentKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function concludedConsolidated(): ConflictException {
  return new ConflictException(
    'The consolidated ICFR consideration is concluded; the Partner reopens it before changes.',
  );
}

function assertControlEditable(c: ControlRow): void {
  if (c.withdrawn_at) throw new ConflictException('This control was withdrawn.');
  if (c.review_state === 'reviewed' || c.review_state === 'submitted')
    throw new ConflictException(
      c.review_state === 'reviewed'
        ? 'This control is reviewed; reopen it before changing it.'
        : 'This control is with the reviewer; it can change once returned.',
    );
}

function stripVersion<T extends { version?: number }>(input: T): Omit<T, 'version'> {
  const rest: Partial<T> = { ...input };
  delete rest.version;
  return rest as Omit<T, 'version'>;
}
