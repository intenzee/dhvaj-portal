import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  FRAUD_CONCLUSION,
  FRAUD_MATTER_ROUTE,
  REPORTING_CARD,
  REPORTING_EVIDENCE_KIND,
  SUB_SECTION_KEY,
  type AddDirectorCheckInput,
  type CreateFraudMatterInput,
  type FraudMatterCandidate,
  type LinkReportingEvidenceInput,
  type RecordFraudConsultationInput,
  type StatutoryAuditReportingRecords,
  type UpdateDirectorCheckInput,
  type UpdateFraudMatterInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { directorStatus, fraudMatterRef, fraudRoute, fraudRulesOn } from './fraud-matters';
import { findingRef } from './group-audit';
import { isEngagementLead } from './master-facts';
import {
  contactDirectorsOn,
  fraudRuleVersionsOn,
  readDirectorChecksOn,
  readFraudMattersOn,
  readReportingEvidenceLinksOn,
  reportingCrossRefsOn,
  reportingEvidenceCountsOn,
  workflowPeriodStartOn,
} from './other-reporting-records-read';
import { crossRefLinksOf } from './reporting-records';

const trimOrNull = (s: string | null | undefined) => (s == null ? null : s.trim() || null);

interface MatterRow {
  id: string;
  seq: number;
  amount: string | null;
  amount_estimated: boolean;
  knowledge_date: string | null;
  board_reported_on: string | null;
  reply_received_on: string | null;
  cg_forwarded_on: string | null;
  partner_consulted_at: Date | null;
  conclusion: string;
  conclusion_note: string | null;
  withdrawn_at: Date | null;
  version: number;
}

/** UpdateFraudMatterInput key → column. */
const MATTER_COLUMNS: Record<string, string> = {
  nature: 'nature',
  description: 'description',
  amount: 'amount',
  amountEstimated: 'amount_estimated',
  perpetrator: 'perpetrator',
  partiesInvolved: 'parties_involved',
  knowledgeDate: 'knowledge_date',
  source: 'source',
  sourceRef: 'source_ref',
  procedureId: 'procedure_id',
  auditProcedures: 'audit_procedures',
  tcwgCommunication: 'tcwg_communication',
  boardReportedOn: 'board_reported_on',
  replyReceivedOn: 'reply_received_on',
  cgForwardedOn: 'cg_forwarded_on',
  adt4Reference: 'adt4_reference',
  regulatoryNote: 'regulatory_note',
  conclusion: 'conclusion',
  conclusionNote: 'conclusion_note',
};

const DIRECTOR_COLUMNS: Record<string, string> = {
  name: 'name',
  din: 'din',
  designation: 'designation',
  appointedOn: 'appointed_on',
  ceasedOn: 'ceased_on',
  directorshipInfo: 'directorship_info',
  representationRef: 'representation_ref',
  mcaSource: 'mca_source',
  disqualified: 'disqualified',
  legalAnalysis: 'legal_analysis',
  auditorConclusion: 'auditor_conclusion',
};

/**
 * Statutory Audit — 02.7 Track B records (DHVAJ 02.7 spec §12, §14–§16):
 * Section 143(12) Fraud Matters with the Rule 13 deadline engine, the Section
 * 164(2) director workpaper, the 02.4 / 02.5 / 02.6 cross-references and the
 * per-card evidence links. Members read; only the engagement leads change the
 * records (RLS enforces it too); the Engagement Partner records the fraud
 * consultation. Nothing is hard-deleted — matters and directors are withdrawn,
 * evidence links removed.
 */
@Injectable()
export class AuditReportingRecordsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ───────────────────────────────────────────────────────────────

  async view(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
      return this.readView(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── §14 Fraud Matters ──────────────────────────────────────────────────

  async createFraudMatter(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateFraudMatterInput,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      if (input.procedureId)
        await this.assertProcedure(client, workflowInstanceId, input.procedureId);
      const seq = await this.nextSeq(client, workflowInstanceId);
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_fraud_matter
             (workflow_instance_id, engagement_id, seq, nature, description, amount,
              amount_estimated, perpetrator, parties_involved, knowledge_date, source, source_ref,
              procedure_id, created_by_employee_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING id`,
          [
            workflowInstanceId,
            engagementId,
            seq,
            input.nature.trim(),
            trimOrNull(input.description),
            input.amount ?? null,
            input.amountEstimated ?? false,
            input.perpetrator ?? 'unknown',
            trimOrNull(input.partiesInvolved),
            input.knowledgeDate ?? null,
            input.source ?? 'audit_procedure',
            trimOrNull(input.sourceRef),
            input.procedureId ?? null,
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw friendly(err, 'That matter is already raised as a Fraud Matter.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.fraud_matter_created',
        objectType: 'audit_fraud_matter',
        objectId: id,
        after: { ref: fraudMatterRef(seq), ...input },
      });
    });
  }

  async updateFraudMatter(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    matterId: string,
    input: UpdateFraudMatterInput,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const before = await this.loadMatter(client, workflowInstanceId, matterId);
      if (before.version !== input.version)
        throw new ConflictException('This Fraud Matter changed — reload and try again.');
      if (input.procedureId)
        await this.assertProcedure(client, workflowInstanceId, input.procedureId);

      const pick = <K extends keyof UpdateFraudMatterInput>(k: K, cur: unknown) =>
        input[k] !== undefined ? (input[k] as unknown) : cur;
      const knowledge = pick('knowledgeDate', before.knowledge_date) as string | null;
      const board = pick('boardReportedOn', before.board_reported_on) as string | null;
      const reply = pick('replyReceivedOn', before.reply_received_on) as string | null;
      const forwarded = pick('cgForwardedOn', before.cg_forwarded_on) as string | null;
      const amountRaw = pick('amount', before.amount);
      const amount = amountRaw === null ? null : Number(amountRaw);
      const estimated = pick('amountEstimated', before.amount_estimated) as boolean;
      const conclusion = pick('conclusion', before.conclusion) as string;
      const note = trimOrNull(pick('conclusionNote', before.conclusion_note) as string | null);

      if (board && knowledge && board < knowledge)
        throw new BadRequestException(
          'The report to the Board / Audit Committee cannot precede the date knowledge was obtained.',
        );
      if ((reply || forwarded) && !board)
        throw new BadRequestException(
          'Record the date the matter was reported to the Board / Audit Committee first.',
        );
      if (reply && board && reply < board)
        throw new BadRequestException('The reply cannot precede the report it answers.');
      if (forwarded && board && forwarded < board)
        throw new BadRequestException(
          'The forward to the Central Government cannot precede the report to the Board / Audit Committee.',
        );

      if (conclusion !== FRAUD_CONCLUSION.pending) {
        if (!note) throw new BadRequestException('Record the basis of the conclusion.');
        if (!before.partner_consulted_at)
          throw new BadRequestException(
            'The Engagement Partner records the consultation before the matter is concluded.',
          );
        const rules = fraudRulesOn(
          await fraudRuleVersionsOn(client),
          knowledge ?? (await workflowPeriodStartOn(client, workflowInstanceId)),
        );
        const { route } = fraudRoute(amount, estimated, rules);
        if (conclusion === FRAUD_CONCLUSION.reportedCentralGovernment) {
          if (!forwarded)
            throw new BadRequestException(
              'Record the date the report was forwarded to the Central Government (Form ADT-4).',
            );
          if (route === FRAUD_MATTER_ROUTE.auditCommitteeBoard)
            throw new BadRequestException(
              'The amount is below the Central Government threshold — the route is the Audit Committee / Board.',
            );
        }
        if (conclusion === FRAUD_CONCLUSION.reportedAuditCommitteeBoard) {
          if (!board)
            throw new BadRequestException(
              'Record the date the matter was reported to the Audit Committee / Board.',
            );
          if (route !== FRAUD_MATTER_ROUTE.auditCommitteeBoard)
            throw new BadRequestException(
              route === FRAUD_MATTER_ROUTE.pending
                ? 'Record the amount (or estimate) first — the route depends on the threshold.'
                : 'The amount is at or above the Central Government threshold — report to the Central Government.',
            );
        }
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [key, col] of Object.entries(MATTER_COLUMNS)) {
        let v = (input as unknown as Record<string, unknown>)[key];
        if (v === undefined) continue;
        if (
          typeof v === 'string' &&
          key !== 'nature' &&
          key !== 'conclusion' &&
          key !== 'source' &&
          key !== 'perpetrator'
        )
          v = trimOrNull(v);
        if (key === 'nature' && typeof v === 'string') v = v.trim();
        values.push(v ?? null);
        sets.push(`${col} = $${values.length}`);
      }
      if (input.withdrawn !== undefined) {
        if (input.withdrawn) {
          values.push(ctx.employeeId ?? null);
          sets.push(`withdrawn_at = COALESCE(withdrawn_at, now())`);
          sets.push(`withdrawn_by_employee_id = $${values.length}`);
        } else {
          sets.push('withdrawn_at = NULL', 'withdrawn_by_employee_id = NULL');
        }
      }
      if (sets.length === 0) return;
      values.push(matterId, input.version);
      try {
        const res = await client.query(
          `UPDATE hsdg.audit_fraud_matter
              SET ${sets.join(', ')}, version = version + 1
            WHERE id = $${values.length - 1} AND version = $${values.length}`,
          values,
        );
        if (res.rowCount === 0)
          throw new ConflictException('This Fraud Matter changed — reload and try again.');
      } catch (err) {
        throw friendly(err, 'That matter is already raised as a live Fraud Matter.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.fraud_matter_updated',
        objectType: 'audit_fraud_matter',
        objectId: matterId,
        before: { ref: fraudMatterRef(before.seq), version: before.version },
        after: input,
      });
    });
  }

  /** The Engagement Partner's consultation on a matter (spec §14). */
  async recordConsultation(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    matterId: string,
    input: RecordFraudConsultationInput,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      if (!(await this.isEngagementPartner(client, ctx, engagementId)))
        throw new ForbiddenException('Only the Engagement Partner records the consultation.');
      const before = await this.loadMatter(client, workflowInstanceId, matterId);
      if (before.withdrawn_at) throw new BadRequestException('This matter is withdrawn.');
      const res = await client.query(
        `UPDATE hsdg.audit_fraud_matter
            SET partner_consulted_by_employee_id = $1, partner_consulted_at = now(),
                partner_note = $2, version = version + 1
          WHERE id = $3 AND version = $4`,
        [ctx.employeeId ?? null, input.note.trim(), matterId, input.version],
      );
      if (res.rowCount === 0)
        throw new ConflictException('This Fraud Matter changed — reload and try again.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.fraud_matter_partner_consulted',
        objectType: 'audit_fraud_matter',
        objectId: matterId,
        after: { ref: fraudMatterRef(before.seq), note: input.note.trim() },
      });
    });
  }

  // ── §12 director workpaper ─────────────────────────────────────────────

  async addDirector(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: AddDirectorCheckInput,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_director_check
           (workflow_instance_id, engagement_id, name, din, designation, source,
            created_by_employee_id)
         VALUES ($1,$2,$3,$4,$5,'team',$6) RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          input.name.trim(),
          trimOrNull(input.din),
          trimOrNull(input.designation),
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.director_check_added',
        objectType: 'audit_director_check',
        objectId: rows[0]!.id,
        after: input,
      });
    });
  }

  /** Add the contacts-master directors not yet on the workpaper. */
  async fillDirectors(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const added = await this.fillDirectorsOn(client, ctx, engagementId, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.director_checks_filled',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { added },
      });
    });
  }

  async updateDirector(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    directorId: string,
    input: UpdateDirectorCheckInput,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const { rows } = await client.query<{
        version: number;
        appointed_on: string | null;
        ceased_on: string | null;
        disqualified: string;
        legal_analysis: string | null;
      }>(
        `SELECT version, appointed_on::text, ceased_on::text, disqualified, legal_analysis
           FROM hsdg.audit_director_check WHERE id = $1 AND workflow_instance_id = $2`,
        [directorId, workflowInstanceId],
      );
      const before = rows[0];
      if (!before) throw new NotFoundException('That director is not on this workpaper.');
      if (before.version !== input.version)
        throw new ConflictException('This director changed — reload and try again.');
      const appointed = input.appointedOn !== undefined ? input.appointedOn : before.appointed_on;
      const ceased = input.ceasedOn !== undefined ? input.ceasedOn : before.ceased_on;
      if (appointed && ceased && ceased < appointed)
        throw new BadRequestException('The director ceased before being appointed.');
      const disqualified = input.disqualified ?? before.disqualified;
      const analysis =
        input.legalAnalysis !== undefined ? trimOrNull(input.legalAnalysis) : before.legal_analysis;
      if (disqualified !== 'pending' && !analysis)
        throw new BadRequestException(
          'A Yes / No conclusion needs the Section 164(2) legal analysis — a DIN status alone is not the conclusion.',
        );

      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [key, col] of Object.entries(DIRECTOR_COLUMNS)) {
        let v = (input as unknown as Record<string, unknown>)[key];
        if (v === undefined) continue;
        if (typeof v === 'string' && key !== 'disqualified')
          v = key === 'name' ? v.trim() : trimOrNull(v);
        values.push(v ?? null);
        sets.push(`${col} = $${values.length}`);
      }
      if (input.withdrawn !== undefined) {
        if (input.withdrawn) {
          values.push(ctx.employeeId ?? null);
          sets.push(`withdrawn_at = COALESCE(withdrawn_at, now())`);
          sets.push(`withdrawn_by_employee_id = $${values.length}`);
        } else {
          sets.push('withdrawn_at = NULL', 'withdrawn_by_employee_id = NULL');
        }
      }
      if (sets.length === 0) return;
      values.push(directorId, input.version);
      try {
        const res = await client.query(
          `UPDATE hsdg.audit_director_check
              SET ${sets.join(', ')}, version = version + 1
            WHERE id = $${values.length - 1} AND version = $${values.length}`,
          values,
        );
        if (res.rowCount === 0)
          throw new ConflictException('This director changed — reload and try again.');
      } catch (err) {
        throw friendly(err, 'That contact is already on the workpaper.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.director_check_updated',
        objectType: 'audit_director_check',
        objectId: directorId,
        after: input,
      });
    });
  }

  // ── §16 per-card evidence ──────────────────────────────────────────────

  async linkEvidence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: LinkReportingEvidenceInput,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      if (!!input.documentId === !!input.auditEvidenceId)
        throw new BadRequestException('Link either an engagement document or an evidence record.');
      if (input.fraudMatterId && input.directorId)
        throw new BadRequestException('Link to a Fraud Matter or a director, not both.');
      if (input.fraudMatterId) {
        if (input.cardKey !== REPORTING_CARD.s143_12Fraud)
          throw new BadRequestException(
            'Fraud Matter evidence belongs on the Section 143(12) card.',
          );
        await this.loadMatter(client, workflowInstanceId, input.fraudMatterId);
      }
      if (input.directorId) {
        if (input.cardKey !== REPORTING_CARD.s143Directors)
          throw new BadRequestException('Director evidence belongs on the Section 143(3)(g) card.');
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.audit_director_check WHERE id = $1 AND workflow_instance_id = $2`,
          [input.directorId, workflowInstanceId],
        );
        if (!rows[0]) throw new NotFoundException('That director is not on this workpaper.');
      }
      if (input.documentId) {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
          [input.documentId, engagementId],
        );
        if (!rows[0]) throw new BadRequestException('That document is not on this engagement.');
      } else {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.audit_evidence WHERE id = $1 AND workflow_instance_id = $2`,
          [input.auditEvidenceId, workflowInstanceId],
        );
        if (!rows[0]) throw new BadRequestException('That evidence is not in this audit file.');
      }
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_reporting_evidence
             (workflow_instance_id, engagement_id, card_key, kind, fraud_matter_id, director_id,
              document_id, audit_evidence_id, note, linked_by_employee_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            workflowInstanceId,
            engagementId,
            input.cardKey,
            input.kind ?? REPORTING_EVIDENCE_KIND.evidence,
            input.fraudMatterId ?? null,
            input.directorId ?? null,
            input.documentId ?? null,
            input.auditEvidenceId ?? null,
            trimOrNull(input.note),
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw friendly(err, 'That evidence is already linked here.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.reporting_evidence_linked',
        objectType: 'audit_reporting_evidence',
        objectId: id,
        after: input,
      });
    });
  }

  async unlinkEvidence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    linkId: string,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const res = await client.query(
        `UPDATE hsdg.audit_reporting_evidence
            SET removed_at = now(), removed_by_employee_id = $3
          WHERE id = $1 AND workflow_instance_id = $2 AND removed_at IS NULL`,
        [linkId, workflowInstanceId, ctx.employeeId ?? null],
      );
      if (res.rowCount === 0) throw new NotFoundException('That evidence is not linked here.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.reporting_evidence_unlinked',
        objectType: 'audit_reporting_evidence',
        objectId: linkId,
      });
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  /**
   * First open by a lead: the records row, the legacy single-fraud 02.7 facts
   * moved into a first Fraud Matter (once), and the §164(2) workpaper filled
   * from the contacts master (once). Members who cannot write just read.
   */
  private async ensureOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    if (!(await isEngagementLead(client, engagementId))) return;
    await client.query(
      `INSERT INTO hsdg.audit_reporting_records (workflow_instance_id, engagement_id)
       VALUES ($1, $2) ON CONFLICT (workflow_instance_id) DO NOTHING`,
      [workflowInstanceId, engagementId],
    );
    const { rows } = await client.query<{
      id: string;
      legacy_fraud_migrated_at: Date | null;
      directors_filled_at: Date | null;
    }>(
      `SELECT id, legacy_fraud_migrated_at, directors_filled_at
         FROM hsdg.audit_reporting_records WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const rec = rows[0]!;

    if (!rec.legacy_fraud_migrated_at) {
      const { rows: facts } = await client.query<{
        facts: {
          fraudIdentified?: boolean;
          fraudAmount?: number | null;
          fraudEventDate?: string | null;
        } | null;
      }>(
        `SELECT facts FROM hsdg.audit_framework_subassessment
          WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
        [workflowInstanceId, SUB_SECTION_KEY.otherReporting, FRAMEWORK_AREA_KEY.otherRegulatory],
      );
      if (facts[0]) {
        const f = facts[0].facts;
        if (f?.fraudIdentified === true) {
          const seq = await this.nextSeq(client, workflowInstanceId);
          const date =
            typeof f.fraudEventDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(f.fraudEventDate)
              ? f.fraudEventDate.slice(0, 10)
              : null;
          const amount =
            typeof f.fraudAmount === 'number' && f.fraudAmount >= 0 ? f.fraudAmount : null;
          await client.query(
            `INSERT INTO hsdg.audit_fraud_matter
               (workflow_instance_id, engagement_id, seq, nature, description, amount,
                knowledge_date, source, from_legacy, created_by_employee_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'other',true,$8)
             ON CONFLICT DO NOTHING`,
            [
              workflowInstanceId,
              engagementId,
              seq,
              'Fraud identified (moved from the earlier 02.7 facts)',
              'Recorded before Fraud Matters existed. Confirm the nature, the parties involved and ' +
                'that the date below is the date knowledge was obtained — the Rule 13 deadlines run from it.',
              amount,
              date,
              ctx.employeeId ?? null,
            ],
          );
        }
        await client.query(
          `UPDATE hsdg.audit_reporting_records SET legacy_fraud_migrated_at = now() WHERE id = $1`,
          [rec.id],
        );
      }
    }

    if (!rec.directors_filled_at) {
      await this.fillDirectorsOn(client, ctx, engagementId, workflowInstanceId);
      await client.query(
        `UPDATE hsdg.audit_reporting_records SET directors_filled_at = now() WHERE id = $1`,
        [rec.id],
      );
    }
  }

  private async fillDirectorsOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<number> {
    const contacts = await contactDirectorsOn(client, workflowInstanceId);
    let added = 0;
    for (const c of contacts) {
      const res = await client.query(
        `INSERT INTO hsdg.audit_director_check
           (workflow_instance_id, engagement_id, contact_id, name, designation, source,
            created_by_employee_id)
         SELECT $1,$2,$3,$4,$5,'contacts',$6
          WHERE NOT EXISTS (SELECT 1 FROM hsdg.audit_director_check
                             WHERE workflow_instance_id = $1 AND contact_id = $3
                               AND withdrawn_at IS NULL)
         ON CONFLICT DO NOTHING`,
        [
          workflowInstanceId,
          engagementId,
          c.contactId,
          c.name,
          c.designation,
          ctx.employeeId ?? null,
        ],
      );
      added += res.rowCount ?? 0;
    }
    return added;
  }

  private async readView(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditReportingRecords> {
    const periodStart = await workflowPeriodStartOn(client, workflowInstanceId);
    const [fraud, candidates, directors, contacts, crossRefs, counts, links, canManage, isPartner] =
      await Promise.all([
        readFraudMattersOn(client, workflowInstanceId, periodStart),
        this.candidatesOn(client, workflowInstanceId),
        readDirectorChecksOn(client, workflowInstanceId),
        contactDirectorsOn(client, workflowInstanceId),
        reportingCrossRefsOn(client, workflowInstanceId),
        reportingEvidenceCountsOn(client, workflowInstanceId),
        readReportingEvidenceLinksOn(client, workflowInstanceId),
        isEngagementLead(client, engagementId),
        this.isEngagementPartner(client, ctx, engagementId),
      ]);
    const onWorkpaper = new Set(
      directors.filter((d) => !d.withdrawn && d.contactId).map((d) => d.contactId),
    );
    return {
      workflowInstanceId,
      engagementId,
      periodStart,
      canManage,
      viewerIsPartner: isPartner,
      fraud: { status: fraud.status, rules: fraud.periodRules, matters: fraud.matters, candidates },
      directors: {
        status: directorStatus(directors),
        rows: directors,
        contactsAvailable: contacts.filter((c) => !onWorkpaper.has(c.contactId)).length,
      },
      crossRefs,
      crossRefLinks: crossRefLinksOf(crossRefs),
      evidence: { counts, links },
    };
  }

  /** 02.6 fraud findings not yet raised as a live Fraud Matter. */
  private async candidatesOn(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<FraudMatterCandidate[]> {
    const { rows } = await client.query<{
      id: string;
      seq: number;
      description: string;
      subject: string | null;
    }>(
      `SELECT f.id, f.seq, f.description, COALESCE(c.component_name, b.branch_name) AS subject
         FROM hsdg.audit_group_finding f
         LEFT JOIN hsdg.audit_group_component c ON c.id = f.component_row_id
         LEFT JOIN hsdg.audit_group_branch b ON b.id = f.branch_id
        WHERE f.workflow_instance_id = $1 AND f.category = 'fraud' AND f.withdrawn_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM hsdg.audit_fraud_matter m
                           WHERE m.workflow_instance_id = f.workflow_instance_id
                             AND m.source_ref = f.id::text AND m.withdrawn_at IS NULL)
        ORDER BY f.seq`,
      [workflowInstanceId],
    );
    return rows.map((r) => ({
      source: 'component_or_branch_auditor',
      sourceRef: r.id,
      label: `02.6 finding ${findingRef(r.seq)}${r.subject ? ` — ${r.subject}` : ''}`,
      description: r.description,
    }));
  }

  private async nextSeq(client: PoolClient, workflowInstanceId: string): Promise<number> {
    // Serialise numbering per workflow on the records row.
    await client.query(
      `SELECT 1 FROM hsdg.audit_reporting_records WHERE workflow_instance_id = $1 FOR UPDATE`,
      [workflowInstanceId],
    );
    const { rows } = await client.query<{ next: number }>(
      `SELECT COALESCE(max(seq), 0) + 1 AS next FROM hsdg.audit_fraud_matter
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows[0]!.next;
  }

  private async loadMatter(
    client: PoolClient,
    workflowInstanceId: string,
    matterId: string,
  ): Promise<MatterRow> {
    const { rows } = await client.query<MatterRow>(
      `SELECT id, seq, amount::text AS amount, amount_estimated, knowledge_date::text,
              board_reported_on::text, reply_received_on::text, cg_forwarded_on::text,
              partner_consulted_at, conclusion, conclusion_note, withdrawn_at, version
         FROM hsdg.audit_fraud_matter WHERE id = $1 AND workflow_instance_id = $2`,
      [matterId, workflowInstanceId],
    );
    if (!rows[0]) throw new NotFoundException('That Fraud Matter is not in this audit file.');
    return rows[0];
  }

  private async assertProcedure(client: PoolClient, workflowInstanceId: string, id: string) {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_procedures WHERE id = $1 AND workflow_instance_id = $2`,
      [id, workflowInstanceId],
    );
    if (!rows[0]) throw new BadRequestException('That procedure is not in this audit file.');
  }

  private async isEngagementPartner(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
  ): Promise<boolean> {
    if (!ctx.employeeId) return false;
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.engagements WHERE id = $1 AND engagement_partner_id = $2`,
      [engagementId, ctx.employeeId],
    );
    return rows.length > 0;
  }

  private async mutate(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    fn: (client: PoolClient) => Promise<void>,
  ): Promise<StatutoryAuditReportingRecords> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      if (!(await isEngagementLead(client, engagementId)))
        throw new ForbiddenException('Only the engagement leads can change the 02.7 records.');
      await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
      await fn(client);
      return this.readView(client, ctx, engagementId, workflowInstanceId);
    });
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

/** Unique-index and check violations as 409 / 400 with a plain message. */
function friendly(err: unknown, duplicate: string): unknown {
  const code = (err as { code?: string }).code;
  if (code === '23505') return new ConflictException(duplicate);
  if (code === '23514')
    return new BadRequestException(
      `That change breaks a rule of the record (${(err as { constraint?: string }).constraint ?? 'check'}).`,
    );
  return err;
}
