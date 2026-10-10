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
  DOCUMENT_TEMPLATE_KEY,
  PACKAGE_DOCUMENT_KEYS,
  PACKAGE_DOCUMENT_LABEL,
  templateDefinition,
  type AddGroupAuditFileInput,
  type Br01Answer,
  type BranchAppointmentBasis,
  type BranchConclusion,
  type ComponentAuditorType,
  type ComponentInstructionsCreated,
  type ComponentReportType,
  type ComponentSignificance,
  type ConsolidationApprovedResult,
  type ConsolidationWorkItem,
  type ConsolidationWorkLibraryItem,
  type ConsolidationWorkProgramme,
  type CreateComponentInstructionsInput,
  type CreateGroupAuditBranchInput,
  type CreateGroupAuditFindingInput,
  type FileVersionHistory,
  type Ga01Answer,
  type Ga02Answer,
  type GaYesNoPending,
  type GroupAuditBranch,
  type GroupAuditComponent,
  type GroupAuditFile,
  type GroupAuditFileSlot,
  type GroupAuditFinding,
  type GroupAuditValueSource,
  type GroupFindingCategory,
  type GroupFindingImpact,
  type GroupFindingStatus,
  type InvesteeRelationship,
  type ConsolidationMethod,
  type LinkGroupAuditFileInput,
  type PackageDocument,
  type PackageDocumentKey,
  type PackageDocumentStatus,
  type PerimeterInclusion,
  type Sa600Consideration,
  type StatutoryAuditGroupAudit,
  type UpdateGroupAuditBranchInput,
  type UpdateGroupAuditComponentInput,
  type UpdateGroupAuditFindingInput,
  type UpdateGroupAuditInput,
  type UpdatePackageDocumentInput,
  type WorkItemActivation,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { M365Service } from '../documents/m365/m365.service';
import {
  DocumentTemplatesService,
  KNOWN_MERGE_FIELDS,
} from '../document-templates/document-templates.service';
import { mergeDocx } from '../document-templates/docx-merge';
import {
  buildMergeValues,
  readMergeInput,
  templateSelectionFacts,
} from './acceptance-merge-values';
import { groupAuditStatusOn } from './consolidation-group-read';
import { componentInstructionValues } from './consolidation-memo-values';
import { readConsolidationResultOn } from './consolidation-read';
import {
  auditorChanged,
  branchMissing,
  componentMissing,
  findingDefaults,
  findingImpactError,
  findingRef,
  groupMatrixState,
  matrixComponents,
  packageRelevance,
  pendingPackageDocuments,
  perimeterFromDetail,
  planConsolidationProcedures,
  planWorkProgramme,
  suggestAuditor,
  suggestBr01,
  suggestGa01,
  suggestSa600,
  workItemApplicability,
  workItemsInForce,
  workProgrammeFacts,
  workProgrammeState,
  type PerimeterComponent,
  type PlannedConsolidationProcedure,
  type PriorComponent,
} from './group-audit';
import { isEngagementLead, readPriorAuditFile, type PriorAuditFile } from './master-facts';

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const COMPONENT_SLOTS = new Set<GroupAuditFileSlot>([
  'report',
  'completion_memo',
  'instructions',
  'package',
]);
const MATERIALITY_NOTE =
  'No materiality percentage is set here (spec §18). Group, performance, component and clearly trivial amounts are determined in Section 03.3 and reach the component instructions only after approval.';

interface GroupRow {
  id: string;
  engagement_id: string;
  ga01: Ga01Answer | null;
  ga01_basis: string | null;
  ga01_source: 'system' | 'team' | null;
  br01: Br01Answer;
  br01_source: 'system' | 'team';
  br01_basis: string | null;
  work_status: 'none' | 'active' | 'withdrawn';
  work_framework_code: string | null;
  work_framework_label: string | null;
  work_generated_at: Date | null;
  version: number;
}

interface ComponentRow {
  id: string;
  component_id: string;
  component_name: string;
  relationship: InvesteeRelationship;
  method: ConsolidationMethod;
  included: PerimeterInclusion;
  country: string | null;
  is_indian_company: boolean | null;
  auditor_type: ComponentAuditorType;
  auditor_source: GroupAuditValueSource;
  firm_name: string | null;
  frn: string | null;
  professional_body: string | null;
  auditor_country: string | null;
  partner_contact: string | null;
  period_from: string | null;
  period_to: string | null;
  report_type: ComponentReportType | null;
  report_date: string | null;
  reporting_deadline: string | null;
  sa600: Sa600Consideration;
  sa600_source: 'system' | 'team';
  significance: ComponentSignificance;
  significance_note: string | null;
  ga02: Ga02Answer;
  ga02_basis: string | null;
  ga03: GaYesNoPending;
  ga03_note: string | null;
  ga04: GaYesNoPending;
  ga04_basis: string | null;
  prior_auditor_type: ComponentAuditorType | null;
  prior_firm_name: string | null;
  prior_report_type: ComponentReportType | null;
  withdrawn_at: Date | null;
  version: number;
}

interface BranchRow {
  id: string;
  branch_name: string;
  location: string | null;
  country: string | null;
  firm_name: string | null;
  frn: string | null;
  partner_contact: string | null;
  appointment_basis: BranchAppointmentBasis | null;
  appointment_note: string | null;
  period_from: string | null;
  period_to: string | null;
  significance: ComponentSignificance;
  ga02: Ga02Answer;
  ga02_basis: string | null;
  ga03: GaYesNoPending;
  ga03_note: string | null;
  ga04: GaYesNoPending;
  ga04_basis: string | null;
  principal_response: string | null;
  conclusion: BranchConclusion;
  prior_branch_id: string | null;
  withdrawn_at: Date | null;
  version: number;
}

interface FindingRow {
  id: string;
  seq: number;
  component_row_id: string | null;
  branch_id: string | null;
  subject_name: string | null;
  category: GroupFindingCategory;
  impacts: GroupFindingImpact[];
  description: string;
  icfr_cross_ref: string | null;
  escalated: boolean;
  reporting_consideration: boolean;
  status: GroupFindingStatus;
  response: string | null;
  resolved_by_name: string | null;
  resolved_at: Date | null;
  prior_ref: string | null;
  withdrawn_at: Date | null;
  version: number;
}

interface FileRow {
  id: string;
  slot: GroupAuditFileSlot;
  component_row_id: string | null;
  branch_id: string | null;
  package_key: PackageDocumentKey | null;
  document_id: string;
  how: 'added' | 'linked' | 'generated';
  title: string;
  filename: string | null;
  current_version_no: number;
  in_sharepoint: boolean;
  linked_by_name: string | null;
  linked_at: Date;
  superseded_at: Date | null;
}

interface PackageRow {
  component_row_id: string;
  package_key: PackageDocumentKey;
  status: PackageDocumentStatus;
  note: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
}

interface FileTarget {
  slot: GroupAuditFileSlot;
  componentRowId: string | null;
  branchId: string | null;
  packageKey: PackageDocumentKey | null;
}

interface Ensured {
  result: ConsolidationApprovedResult | null;
  perimeter: PerimeterComponent[];
  planned: PerimeterComponent[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const trimOrNull = (s: string | null | undefined) => (s == null ? null : s.trim() || null);
const stale = (what: string) =>
  new ConflictException(`This ${what} changed since you loaded it; refresh and retry.`);
const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const COMPONENT_SELECT = `
  SELECT id, component_id, component_name, relationship, method, included, country,
         is_indian_company, auditor_type, auditor_source, firm_name, frn, professional_body,
         auditor_country, partner_contact, period_from, period_to, report_type, report_date,
         reporting_deadline, sa600, sa600_source, significance, significance_note,
         ga02, ga02_basis, ga03, ga03_note, ga04, ga04_basis,
         prior_auditor_type, prior_firm_name, prior_report_type, withdrawn_at, version
    FROM hsdg.audit_group_component`;

const BRANCH_SELECT = `
  SELECT id, branch_name, location, country, firm_name, frn, partner_contact, appointment_basis,
         appointment_note, period_from, period_to, significance, ga02, ga02_basis, ga03, ga03_note,
         ga04, ga04_basis, principal_response, conclusion, prior_branch_id, withdrawn_at, version
    FROM hsdg.audit_group_branch`;

const FINDING_SELECT = `
  SELECT f.id, f.seq, f.component_row_id, f.branch_id,
         COALESCE(c.component_name, b.branch_name) AS subject_name, f.category, f.impacts,
         f.description, f.icfr_cross_ref, f.escalated, f.reporting_consideration, f.status,
         f.response, e.full_name AS resolved_by_name, f.resolved_at, f.prior_ref, f.withdrawn_at,
         f.version
    FROM hsdg.audit_group_finding f
    LEFT JOIN hsdg.audit_group_component c ON c.id = f.component_row_id
    LEFT JOIN hsdg.audit_group_branch b ON b.id = f.branch_id
    LEFT JOIN hsdg.employees e ON e.id = f.resolved_by_employee_id`;

/**
 * 02.6 Part B — the group / component / branch auditor framework (DHVAJ 02.6
 * spec §12–§17, §19–§21). Reads the 02.6 result through the DI-free
 * {@link readConsolidationResultOn} (never AuditConsolidationService) and, on
 * read, keeps ONE matrix row per included perimeter component keyed on its
 * stable id (withdrawn, never deleted, when it leaves), rolls last year's
 * auditor, branch records and unresolved findings forward as suggestions /
 * follow-ups (§21), and generates — or withdraws — the consolidation work
 * programme in Section 06 as CFS becomes (un)required (§19). Only engagement
 * leads change anything; members read.
 */
@Injectable()
export class AuditGroupAuditService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly m365: M365Service,
    private readonly templates: DocumentTemplatesService,
  ) {}

  // ── Read ───────────────────────────────────────────────────────────────

  async view(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const ensured = await this.ensureOn(client, engagementId, workflowInstanceId);
      return this.readView(client, engagementId, workflowInstanceId, ensured);
    });
  }

  async workProgramme(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<ConsolidationWorkProgramme> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const ensured = await this.ensureOn(client, engagementId, workflowInstanceId);
      return this.readWorkProgramme(client, engagementId, workflowInstanceId, ensured);
    });
  }

  /** The file's version history (SharePoint's when it holds the file). */
  async fileVersions(
    principal: Principal,
    engagementId: string,
    workflowInstanceId: string,
    fileId: string,
  ): Promise<FileVersionHistory> {
    const ctx = rlsContextFromPrincipal(principal);
    const documentId = await this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const { rows } = await client.query<{ document_id: string }>(
        `SELECT document_id FROM hsdg.audit_group_file
          WHERE id = $1 AND workflow_instance_id = $2`,
        [fileId, workflowInstanceId],
      );
      if (!rows[0]) throw new NotFoundException('That file is not linked here.');
      return rows[0].document_id;
    });
    return this.m365.versionHistory(principal, engagementId, documentId);
  }

  // ── Section 06 (spec §19) ──────────────────────────────────────────────

  /**
   * The Section 06 procedures the consolidation work programme calls for — one
   * per applicable item — after bringing the programme in line with 02.6.
   * Empty unless CFS is required (the generic CFS programme is never generated).
   */
  async consolidationProceduresOn(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlannedConsolidationProcedure[]> {
    await this.ensureOn(client, engagementId, workflowInstanceId);
    const group = await this.loadGroup(client, workflowInstanceId);
    if (!group || group.work_status !== 'active') return [];
    const { rows } = await client.query<{
      item_key: string;
      title: string;
      objective: string;
      evidence: string;
      applicable: boolean;
      status: string;
    }>(
      `SELECT item_key, title, objective, evidence, applicable, status
         FROM hsdg.audit_group_work_item WHERE group_audit_id = $1 ORDER BY sort_order`,
      [group.id],
    );
    return planConsolidationProcedures(
      rows.map((r) => ({
        itemKey: r.item_key,
        title: r.title,
        objective: r.objective,
        evidence: r.evidence,
        applicable: r.applicable,
        withdrawn: r.status === 'withdrawn',
      })),
      group.work_framework_label ?? 'Consolidation work programme',
    );
  }

  /** Point each unlinked work item at the Section 06 procedure it generated. */
  async linkProceduresOn(client: PoolClient, workflowInstanceId: string): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_group_work_item w
          SET procedure_id = p.id
         FROM hsdg.audit_procedures p
        WHERE w.workflow_instance_id = $1 AND w.procedure_id IS NULL
          AND p.workflow_instance_id = w.workflow_instance_id
          AND p.source_key = 'cfs:' || w.item_key`,
      [workflowInstanceId],
    );
  }

  // ── GA-01 / BR-01 ──────────────────────────────────────────────────────

  async update(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: UpdateGroupAuditInput,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client, ensured) => {
      const group = await this.requireGroup(client, workflowInstanceId);
      if (group.version !== input.version) throw stale('group-audit assessment');
      const sets: Record<string, unknown> = {};
      if (input.ga01 !== undefined) {
        if (input.ga01 === null) {
          Object.assign(sets, { ga01: null, ga01_basis: null, ga01_source: null });
        } else {
          const basis = trimOrNull(
            input.ga01Basis !== undefined ? input.ga01Basis : group.ga01_basis,
          );
          if (input.ga01 === 'yes' && !basis)
            throw new BadRequestException(
              "Document the significance of the components and DHVAJ's own involvement (GA-01).",
            );
          Object.assign(sets, {
            ga01: input.ga01,
            ga01_basis: basis,
            ga01_source: 'team',
            ga01_by_employee_id: ctx.employeeId ?? null,
            ga01_at: new Date(),
          });
        }
      } else if (input.ga01Basis !== undefined && group.ga01) {
        const basis = trimOrNull(input.ga01Basis);
        if (group.ga01 === 'yes' && !basis)
          throw new BadRequestException('GA-01 Yes needs its documented basis.');
        sets.ga01_basis = basis;
      }
      if (input.br01 !== undefined) {
        const live = await this.liveBranchCount(client, workflowInstanceId);
        const suggested = suggestBr01({
          branchesOnMaster: ensured.result?.branchesOnMaster ?? false,
          branchRecords: live,
        });
        const basis = trimOrNull(input.br01Basis ?? null);
        if (input.br01 === 'no' && live > 0)
          throw new BadRequestException(
            'Withdraw the branch auditor records before answering BR-01 No.',
          );
        if (input.br01 !== suggested.answer && !basis)
          throw new BadRequestException(
            `Say why BR-01 differs from the system suggestion (${suggested.answer}).`,
          );
        Object.assign(sets, { br01: input.br01, br01_source: 'team', br01_basis: basis });
      }
      if (!Object.keys(sets).length) return;
      await this.updateRow(client, 'audit_group_audit', group.id, {
        ...sets,
        version: group.version + 1,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.group_audit_updated',
        objectType: 'audit_group_audit',
        objectId: group.id,
        before: { ga01: group.ga01, br01: group.br01, br01Source: group.br01_source },
        after: sets,
      });
    });
  }

  // ── §12 / §13 matrix row ───────────────────────────────────────────────

  async updateComponent(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    rowId: string,
    input: UpdateGroupAuditComponentInput,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const row = await this.loadComponent(client, workflowInstanceId, rowId);
      if (row.version !== input.version) throw stale('component');
      const sets: Record<string, unknown> = {};
      if (input.auditorType !== undefined && input.auditorType !== row.auditor_type) {
        sets.auditor_type = input.auditorType;
        sets.auditor_source = 'team';
        if (input.sa600 === undefined && row.sa600_source === 'system')
          sets.sa600 = suggestSa600(input.auditorType);
      } else if (input.auditorType !== undefined) {
        sets.auditor_source = 'team';
      }
      if (input.sa600 !== undefined)
        Object.assign(sets, { sa600: input.sa600, sa600_source: 'team' });
      const text: Array<[keyof UpdateGroupAuditComponentInput, string]> = [
        ['firmName', 'firm_name'],
        ['frn', 'frn'],
        ['professionalBody', 'professional_body'],
        ['auditorCountry', 'auditor_country'],
        ['partnerContact', 'partner_contact'],
        ['significanceNote', 'significance_note'],
        ['ga02Basis', 'ga02_basis'],
        ['ga03Note', 'ga03_note'],
        ['ga04Basis', 'ga04_basis'],
      ];
      for (const [k, col] of text)
        if (input[k] !== undefined) sets[col] = trimOrNull(input[k] as string | null);
      const plain: Array<[keyof UpdateGroupAuditComponentInput, string]> = [
        ['periodFrom', 'period_from'],
        ['periodTo', 'period_to'],
        ['reportType', 'report_type'],
        ['reportDate', 'report_date'],
        ['reportingDeadline', 'reporting_deadline'],
        ['significance', 'significance'],
        ['ga02', 'ga02'],
        ['ga03', 'ga03'],
        ['ga04', 'ga04'],
      ];
      for (const [k, col] of plain) if (input[k] !== undefined) sets[col] = input[k] ?? null;
      if (!Object.keys(sets).length) return;
      const merged = { ...row, ...sets } as ComponentRow;
      assertBasis('GA-02', merged.ga02, merged.ga02_basis, 'the competence consideration');
      assertBasis('GA-04', merged.ga04, merged.ga04_basis, 'the evidence obtained');
      assertPeriod(merged.period_from, merged.period_to);
      await this.updateRow(client, 'audit_group_component', row.id, {
        ...sets,
        version: row.version + 1,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.group_component_updated',
        objectType: 'audit_group_component',
        objectId: row.id,
        before: pick(row, Object.keys(sets)),
        after: { component: row.component_name, ...sets },
      });
    });
  }

  // ── Files (§12, §14, §15, §17) ─────────────────────────────────────────

  async addFile(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: AddGroupAuditFileInput,
  ): Promise<StatutoryAuditGroupAudit> {
    await this.db.withRlsContext(ctx, async (client) => {
      await this.assertLeadShell(client, engagementId, workflowInstanceId);
      const target = await this.resolveTarget(client, workflowInstanceId, input);
      await this.assertReplaceable(client, target, input.replaceReason);
    });
    // Stored in the engagement workspace (SharePoint when Microsoft 365 is on).
    const doc = await this.documents.create(ctx, engagementId, {
      title: input.title?.trim() || input.filename.replace(/\.[^.]+$/, ''),
      filename: input.filename,
      contentType: input.contentType,
      contentBase64: input.contentBase64,
      documentType: 'evidence',
    });
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const target = await this.resolveTarget(client, workflowInstanceId, input);
      await this.insertFile(
        client,
        ctx,
        workflowInstanceId,
        engagementId,
        target,
        doc.id,
        'added',
        input.replaceReason,
      );
    });
  }

  async linkFile(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: LinkGroupAuditFileInput,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const target = await this.resolveTarget(client, workflowInstanceId, input);
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
        [input.documentId, engagementId],
      );
      if (!rows[0]) throw new BadRequestException('That document is not on this engagement.');
      await this.insertFile(
        client,
        ctx,
        workflowInstanceId,
        engagementId,
        target,
        input.documentId,
        'linked',
        input.replaceReason,
      );
    });
  }

  // ── §15 reporting package ──────────────────────────────────────────────

  async updatePackage(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    rowId: string,
    key: PackageDocumentKey,
    input: UpdatePackageDocumentInput,
  ): Promise<StatutoryAuditGroupAudit> {
    if (!PACKAGE_DOCUMENT_KEYS.includes(key))
      throw new BadRequestException('Unknown reporting-package document.');
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const row = await this.loadComponent(client, workflowInstanceId, rowId);
      const relevance = packageRelevance(row.auditor_type, row.is_indian_company);
      if (!relevance)
        throw new BadRequestException(
          'This component takes no reporting package (only another auditor or an unaudited component does).',
        );
      const note = trimOrNull(input.note);
      const hasFile = await this.liveFile(client, {
        slot: 'package',
        componentRowId: row.id,
        branchId: null,
        packageKey: key,
      });
      if ((input.status === 'approved' || input.status === 'received') && !hasFile)
        throw new BadRequestException(
          'Add or link the document before marking it received or approved.',
        );
      if (input.status === 'not_applicable' && relevance[key] && !note)
        throw new BadRequestException('Say why this document is not applicable.');
      const approved = input.status === 'approved';
      await client.query(
        `INSERT INTO hsdg.audit_group_package
           (component_row_id, engagement_id, package_key, status, note, approved_by_employee_id, approved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (component_row_id, package_key) DO UPDATE
            SET status = EXCLUDED.status, note = EXCLUDED.note,
                approved_by_employee_id = EXCLUDED.approved_by_employee_id,
                approved_at = EXCLUDED.approved_at,
                version = audit_group_package.version + 1`,
        [
          row.id,
          engagementId,
          key,
          input.status,
          note,
          approved ? (ctx.employeeId ?? null) : null,
          approved ? new Date() : null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.group_package_updated',
        objectType: 'audit_group_component',
        objectId: row.id,
        after: { component: row.component_name, document: key, status: input.status, note },
      });
    });
  }

  // ── §16 findings ───────────────────────────────────────────────────────

  async createFinding(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateGroupAuditFindingInput,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const subject =
        input.subjectKind === 'component'
          ? {
              component: (await this.loadComponent(client, workflowInstanceId, input.subjectId)).id,
              branch: null,
            }
          : {
              component: null,
              branch: (await this.loadBranch(client, workflowInstanceId, input.subjectId)).id,
            };
      const err = findingImpactError(input.category, input.impacts);
      if (err) throw new BadRequestException(err);
      const description = trimOrNull(input.description);
      if (!description) throw new BadRequestException('Describe the finding.');
      const defaults = findingDefaults(input.category);
      const { rows } = await client.query<{ id: string; seq: number }>(
        `INSERT INTO hsdg.audit_group_finding
           (workflow_instance_id, engagement_id, seq, component_row_id, branch_id, category, impacts,
            description, icfr_cross_ref, escalated, reporting_consideration, created_by_employee_id)
         SELECT $1, $2, COALESCE(max(seq), 0) + 1, $3, $4, $5, $6, $7, $8, $9, $10, $11
           FROM hsdg.audit_group_finding WHERE workflow_instance_id = $1
         RETURNING id, seq`,
        [
          workflowInstanceId,
          engagementId,
          subject.component,
          subject.branch,
          input.category,
          [...new Set(input.impacts)],
          description,
          trimOrNull(input.icfrCrossRef),
          defaults.escalated,
          input.reportingConsideration ?? defaults.reportingConsideration,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.group_finding_created',
        objectType: 'audit_group_finding',
        objectId: rows[0]!.id,
        after: { ref: findingRef(rows[0]!.seq), category: input.category, impacts: input.impacts },
      });
    });
  }

  async updateFinding(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    findingId: string,
    input: UpdateGroupAuditFindingInput,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const { rows } = await client.query<FindingRow>(
        `${FINDING_SELECT} WHERE f.id = $1 AND f.workflow_instance_id = $2`,
        [findingId, workflowInstanceId],
      );
      const f = rows[0];
      if (!f) throw new NotFoundException('Finding not found.');
      if (f.version !== input.version) throw stale('finding');
      const sets: Record<string, unknown> = {};
      const category = input.category ?? f.category;
      const impacts = input.impacts ?? (input.category ? [] : f.impacts);
      if (input.category !== undefined || input.impacts !== undefined) {
        const err = findingImpactError(category, impacts);
        if (err) throw new BadRequestException(err);
        Object.assign(sets, { category, impacts: [...new Set(impacts)] });
      }
      if (input.description !== undefined) {
        const d = trimOrNull(input.description);
        if (!d) throw new BadRequestException('Describe the finding.');
        sets.description = d;
      }
      if (input.icfrCrossRef !== undefined) sets.icfr_cross_ref = trimOrNull(input.icfrCrossRef);
      if (input.reportingConsideration !== undefined)
        sets.reporting_consideration = input.reportingConsideration;
      if (input.escalated !== undefined) sets.escalated = input.escalated;
      if (category === 'fraud') sets.escalated = true;
      if (input.response !== undefined) sets.response = trimOrNull(input.response);
      if (input.status !== undefined && input.status !== f.status) {
        sets.status = input.status;
        if (input.status === 'resolved') {
          const response = input.response !== undefined ? trimOrNull(input.response) : f.response;
          if (!response)
            throw new BadRequestException(
              "Record the principal auditor's response before resolving the finding.",
            );
          Object.assign(sets, {
            resolved_by_employee_id: ctx.employeeId ?? null,
            resolved_at: new Date(),
          });
        } else {
          Object.assign(sets, { resolved_by_employee_id: null, resolved_at: null });
        }
      }
      if (input.withdrawn !== undefined && input.withdrawn !== !!f.withdrawn_at)
        sets.withdrawn_at = input.withdrawn ? new Date() : null;
      if (!Object.keys(sets).length) return;
      await this.updateRow(client, 'audit_group_finding', f.id, {
        ...sets,
        version: f.version + 1,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.group_finding_updated',
        objectType: 'audit_group_finding',
        objectId: f.id,
        before: { category: f.category, status: f.status, withdrawn: !!f.withdrawn_at },
        after: { ref: findingRef(f.seq), ...sets },
      });
    });
  }

  // ── §17 branches ───────────────────────────────────────────────────────

  async createBranch(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateGroupAuditBranchInput,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const group = await this.requireGroup(client, workflowInstanceId);
      if (group.br01_source === 'team' && group.br01 === 'no')
        throw new BadRequestException('BR-01 is No — change it before adding a branch auditor.');
      const name = trimOrNull(input.branchName);
      if (!name) throw new BadRequestException('Name the branch.');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_group_branch
           (group_audit_id, workflow_instance_id, engagement_id, branch_name, location, country, sort_order)
         SELECT $1, $2, $3, $4, $5, $6, COALESCE(max(sort_order), 0) + 1
           FROM hsdg.audit_group_branch WHERE group_audit_id = $1
         RETURNING id`,
        [
          group.id,
          workflowInstanceId,
          engagementId,
          name,
          trimOrNull(input.location),
          trimOrNull(input.country),
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.group_branch_created',
        objectType: 'audit_group_branch',
        objectId: rows[0]!.id,
        after: { branchName: name },
      });
    });
  }

  async updateBranch(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    branchId: string,
    input: UpdateGroupAuditBranchInput,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const b = await this.loadBranch(client, workflowInstanceId, branchId, true);
      if (b.version !== input.version) throw stale('branch record');
      const sets: Record<string, unknown> = {};
      if (input.branchName !== undefined) {
        const n = trimOrNull(input.branchName);
        if (!n) throw new BadRequestException('Name the branch.');
        sets.branch_name = n;
      }
      const text: Array<[keyof UpdateGroupAuditBranchInput, string]> = [
        ['location', 'location'],
        ['country', 'country'],
        ['firmName', 'firm_name'],
        ['frn', 'frn'],
        ['partnerContact', 'partner_contact'],
        ['appointmentNote', 'appointment_note'],
        ['ga02Basis', 'ga02_basis'],
        ['ga03Note', 'ga03_note'],
        ['ga04Basis', 'ga04_basis'],
        ['principalResponse', 'principal_response'],
      ];
      for (const [k, col] of text)
        if (input[k] !== undefined) sets[col] = trimOrNull(input[k] as string | null);
      const plain: Array<[keyof UpdateGroupAuditBranchInput, string]> = [
        ['appointmentBasis', 'appointment_basis'],
        ['periodFrom', 'period_from'],
        ['periodTo', 'period_to'],
        ['significance', 'significance'],
        ['ga02', 'ga02'],
        ['ga03', 'ga03'],
        ['ga04', 'ga04'],
        ['conclusion', 'conclusion'],
      ];
      for (const [k, col] of plain) if (input[k] !== undefined) sets[col] = input[k] ?? null;
      if (input.withdrawn !== undefined && input.withdrawn !== !!b.withdrawn_at)
        sets.withdrawn_at = input.withdrawn ? new Date() : null;
      if (!Object.keys(sets).length) return;
      const merged = { ...b, ...sets } as BranchRow;
      assertBasis('GA-02', merged.ga02, merged.ga02_basis, 'the competence consideration');
      assertBasis('GA-04', merged.ga04, merged.ga04_basis, 'the evidence obtained');
      assertPeriod(merged.period_from, merged.period_to);
      if (merged.conclusion !== 'pending' && !trimOrNull(merged.principal_response))
        throw new BadRequestException(
          "Record the principal auditor's response before concluding on the branch report.",
        );
      await this.updateRow(client, 'audit_group_branch', b.id, { ...sets, version: b.version + 1 });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.group_branch_updated',
        objectType: 'audit_group_branch',
        objectId: b.id,
        before: pick(b, Object.keys(sets)),
        after: { branch: b.branch_name, ...sets },
      });
    });
  }

  // ── §14 Component Auditor Instructions ─────────────────────────────────

  async createInstructions(
    principal: Principal,
    engagementId: string,
    workflowInstanceId: string,
    rowId: string,
    input: CreateComponentInstructionsInput,
  ): Promise<ComponentInstructionsCreated> {
    const ctx = rlsContextFromPrincipal(principal);
    const templateKey = DOCUMENT_TEMPLATE_KEY.componentAuditorInstructions;
    const tdef = templateDefinition(templateKey)!;

    // 1. The component, the approved template and the merge values.
    const prepared = await this.db.withRlsContext(ctx, async (client) => {
      await this.assertLeadShell(client, engagementId, workflowInstanceId);
      const row = await this.loadComponent(client, workflowInstanceId, rowId);
      if (row.auditor_type !== COMPONENT_AUDITOR_TYPE.otherAuditor)
        throw new BadRequestException(
          'Component Auditor Instructions go to another auditor — record the component auditor first.',
        );
      if (
        await this.liveFile(client, {
          slot: 'instructions',
          componentRowId: row.id,
          branchId: null,
          packageKey: null,
        })
      )
        throw new ConflictException(
          'The instructions already exist — open them from the component.',
        );
      const firm = await this.templates.readFirm(client);
      const mergeInput = await readMergeInput(client, workflowInstanceId, firm);
      if (!mergeInput) throw new NotFoundException('Engagement facts could not be read.');
      const resolved = await this.templates.resolveOn(
        client,
        templateKey,
        templateSelectionFacts(mergeInput.master),
        input.variantKey,
      );
      if (!resolved)
        throw new BadRequestException(
          'No approved DHVAJ template for the Component Auditor Instructions yet — an administrator must upload and approve one under Settings → Document templates.',
        );
      const result = await readConsolidationResultOn(client, workflowInstanceId);
      const [{ rows: mat }, { rows: risks }, { rows: others }] = await Promise.all([
        client.query<{
          version_no: number;
          om: string | null;
          pm: string | null;
          ctt: string | null;
        }>(
          `SELECT version_no, selected_om::text AS om, selected_pm::text AS pm, selected_ctt::text AS ctt
             FROM hsdg.audit_materiality_determination
            WHERE workflow_instance_id = $1 AND status = 'complete'
            ORDER BY version_no DESC LIMIT 1`,
          [workflowInstanceId],
        ),
        client.query<{ risk_ref: string; description: string }>(
          `SELECT risk_ref, description FROM hsdg.audit_risks
            WHERE workflow_instance_id = $1 AND is_significant ORDER BY risk_ref`,
          [workflowInstanceId],
        ),
        client.query<{ component_name: string }>(
          `SELECT component_name FROM hsdg.audit_group_component
            WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL AND id <> $2
            ORDER BY sort_order, component_name`,
          [workflowInstanceId, row.id],
        ),
      ]);
      const relevance = packageRelevance(row.auditor_type, row.is_indian_company)!;
      return {
        row,
        resolved,
        clientName: mergeInput.master.legalName,
        values: {
          ...buildMergeValues(mergeInput),
          ...componentInstructionValues({
            componentName: row.component_name,
            relationship: row.relationship,
            componentCountry: row.country,
            isIndianCompany: row.is_indian_company,
            firmName: row.firm_name,
            frn: row.frn,
            professionalBody: row.professional_body,
            partnerContact: row.partner_contact,
            periodFrom: row.period_from,
            periodTo: row.period_to,
            reportingDeadline: row.reporting_deadline,
            groupFramework: result?.groupFramework ?? null,
            materiality: mat[0]
              ? {
                  versionNo: mat[0].version_no,
                  overall: mat[0].om,
                  performance: mat[0].pm,
                  clearlyTrivial: mat[0].ctt,
                }
              : null,
            significantRisks: risks.map((r) => ({ ref: r.risk_ref, description: r.description })),
            otherComponents: others.map((o) => o.component_name),
            packageDocuments: PACKAGE_DOCUMENT_KEYS.filter((k) => relevance[k]),
          }),
        },
      };
    });

    // 2. Merge the component and group facts into the template.
    const bytes = await this.templates.readBytes(prepared.resolved.reference);
    const merged = await mergeDocx(bytes, prepared.values, KNOWN_MERGE_FIELDS);
    const filename = tdef.filenamePattern
      .replace('{component}', prepared.row.component_name)
      .replace('{client}', prepared.clientName)
      .replace(/[\\/:*?"<>|]/g, '-');

    // 3. File it as an engagement document (SharePoint workspace when on) …
    const doc = await this.documents.create(ctx, engagementId, {
      title: filename.replace(/\.docx$/i, ''),
      filename,
      contentType: DOCX_CONTENT_TYPE,
      contentBase64: merged.buffer.toString('base64'),
      documentType: 'working_paper',
      classification: 'confidential',
    });

    // 4. … and link it to the component, remembering the exact template version.
    const groupAudit = await this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const row = await this.loadComponent(client, workflowInstanceId, rowId);
      await this.insertFile(
        client,
        ctx,
        workflowInstanceId,
        engagementId,
        { slot: 'instructions', componentRowId: row.id, branchId: null, packageKey: null },
        doc.id,
        'generated',
        null,
        {
          versionId: prepared.resolved.versionId,
          templateKey,
          variantKey: prepared.resolved.variantKey,
          versionNo: prepared.resolved.versionNo,
          missingFields: merged.missing,
        },
      );
    });

    // 5. Open it in Microsoft 365 (AutoSave) when the tenant is connected.
    let editorUrl: string | null = null;
    if (this.m365.enabled && this.m365.supports(filename)) {
      try {
        editorUrl = (await this.m365.buildSession(principal, engagementId, doc.id)).editorUrl;
      } catch {
        editorUrl = null; // The portal preview still opens it.
      }
    }
    return { groupAudit, documentId: doc.id, editorUrl, missingFields: merged.missing };
  }

  // ── Ensure (idempotent, on read) ───────────────────────────────────────

  private async ensureOn(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<Ensured> {
    const result = await readConsolidationResultOn(client, workflowInstanceId);
    if (!result) return { result: null, perimeter: [], planned: [] };
    const { rows: det } = await client.query<{ system_detail: unknown }>(
      `SELECT system_detail FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = '02.6' AND area_key = 'cfs'`,
      [workflowInstanceId],
    );
    const perimeter = perimeterFromDetail(det[0]?.system_detail ?? null);
    const planned = result.cfsRequired === true ? matrixComponents(perimeter) : [];
    const ensured = { result, perimeter, planned };
    // Members read what the leads have set up; only leads write (RLS).
    if (!(await isEngagementLead(client, engagementId))) return ensured;

    await client.query(
      `INSERT INTO hsdg.audit_group_audit (workflow_instance_id, engagement_id)
       VALUES ($1, $2) ON CONFLICT (workflow_instance_id) DO NOTHING`,
      [workflowInstanceId, engagementId],
    );
    const group = (await this.loadGroup(client, workflowInstanceId))!;
    const prior = await readPriorAuditFile(client, workflowInstanceId);

    if (result.cfsRequired === true) {
      await this.syncMatrix(client, group, engagementId, workflowInstanceId, planned, prior);
    } else if (result.cfsRequired === false) {
      await client.query(
        `UPDATE hsdg.audit_group_component SET withdrawn_at = now()
          WHERE group_audit_id = $1 AND withdrawn_at IS NULL`,
        [group.id],
      );
    }
    if (prior) {
      await this.carryBranches(client, group, workflowInstanceId, engagementId, prior);
      await this.carryFindings(client, workflowInstanceId, engagementId, prior);
    }
    await this.syncWorkProgramme(client, group, engagementId, workflowInstanceId, result, planned);
    return ensured;
  }

  /** One row per included perimeter component, keyed on its stable id (§12, §21). */
  private async syncMatrix(
    client: PoolClient,
    group: GroupRow,
    engagementId: string,
    workflowInstanceId: string,
    planned: PerimeterComponent[],
    prior: PriorAuditFile | null,
  ): Promise<void> {
    const priorRows = prior ? await this.readPriorComponents(client, prior) : [];
    const priorById = new Map(priorRows.map((p) => [p.componentId, p]));
    const priorByName = new Map(priorRows.map((p) => [nameKey(p.name), p]));
    const { rows: existing } = await client.query<ComponentRow>(
      `${COMPONENT_SELECT} WHERE group_audit_id = $1`,
      [group.id],
    );
    const byId = new Map(existing.map((r) => [r.component_id, r]));
    let order = 0;
    for (const c of planned) {
      order += 1;
      const p = priorById.get(c.id) ?? priorByName.get(nameKey(c.name)) ?? null;
      const suggestion = suggestAuditor(c, p);
      const row = byId.get(c.id);
      if (!row) {
        const fromPrior = suggestion.source === 'prior_year' && p;
        await client.query(
          `INSERT INTO hsdg.audit_group_component
             (group_audit_id, workflow_instance_id, engagement_id, component_id, component_name,
              relationship, method, included, country, is_indian_company, auditor_type,
              auditor_source, sa600, firm_name, frn, professional_body, auditor_country,
              partner_contact, prior_auditor_type, prior_firm_name, prior_report_type, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           ON CONFLICT (group_audit_id, component_id) DO NOTHING`,
          [
            group.id,
            workflowInstanceId,
            engagementId,
            c.id,
            c.name,
            c.relationship,
            c.method,
            c.included,
            c.country,
            c.isIndianCompany,
            suggestion.type,
            suggestion.source,
            suggestSa600(suggestion.type),
            fromPrior ? p.firmName : null,
            fromPrior ? p.frn : null,
            fromPrior ? p.professionalBody : null,
            fromPrior ? p.auditorCountry : null,
            fromPrior ? p.partnerContact : null,
            p?.auditorType ?? null,
            p?.firmName ?? null,
            p?.reportType ?? null,
            order,
          ],
        );
        continue;
      }
      // Refresh the perimeter snapshot; a system auditor follows the 02.6 record.
      const followSystem =
        row.auditor_source === 'system' &&
        suggestion.source === 'system' &&
        row.auditor_type !== suggestion.type;
      await client.query(
        `UPDATE hsdg.audit_group_component
            SET component_name = $2, relationship = $3, method = $4, included = $5, country = $6,
                is_indian_company = $7, sort_order = $8, withdrawn_at = NULL,
                auditor_type = CASE WHEN $9 THEN $10 ELSE auditor_type END,
                sa600 = CASE WHEN $9 AND sa600_source = 'system' THEN $11 ELSE sa600 END,
                version = version + CASE WHEN $9 THEN 1 ELSE 0 END
          WHERE id = $1
            AND (component_name, relationship, method, included, country, is_indian_company, sort_order)
                IS DISTINCT FROM ($2, $3, $4, $5, $6, $7, $8)
             OR (id = $1 AND (withdrawn_at IS NOT NULL OR $9))`,
        [
          row.id,
          c.name,
          c.relationship,
          c.method,
          c.included,
          c.country,
          c.isIndianCompany,
          order,
          followSystem,
          suggestion.type,
          suggestSa600(suggestion.type),
        ],
      );
    }
    await client.query(
      `UPDATE hsdg.audit_group_component SET withdrawn_at = now()
        WHERE group_audit_id = $1 AND withdrawn_at IS NULL AND NOT (component_id = ANY($2::text[]))`,
      [group.id, planned.map((c) => c.id)],
    );
  }

  /** Last year's branch records roll forward once — details kept, answers fresh (§21). */
  private async carryBranches(
    client: PoolClient,
    group: GroupRow,
    workflowInstanceId: string,
    engagementId: string,
    prior: PriorAuditFile,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.audit_group_branch
         (group_audit_id, workflow_instance_id, engagement_id, branch_name, location, country,
          firm_name, frn, partner_contact, appointment_basis, appointment_note, prior_branch_id,
          sort_order)
       SELECT $1, $2, $3, pb.branch_name, pb.location, pb.country, pb.firm_name, pb.frn,
              pb.partner_contact, pb.appointment_basis, pb.appointment_note, pb.id, pb.sort_order
         FROM hsdg.audit_group_branch pb
        WHERE pb.workflow_instance_id = $4 AND pb.withdrawn_at IS NULL
       ON CONFLICT (group_audit_id, prior_branch_id) WHERE prior_branch_id IS NOT NULL DO NOTHING`,
      [group.id, workflowInstanceId, engagementId, prior.workflowInstanceId],
    );
  }

  /** Last year's unresolved findings become current-year follow-ups, never conclusions (§21). */
  private async carryFindings(
    client: PoolClient,
    workflowInstanceId: string,
    engagementId: string,
    prior: PriorAuditFile,
  ): Promise<void> {
    const { rows } = await client.query<{
      id: string;
      seq: number;
      category: GroupFindingCategory;
      impacts: GroupFindingImpact[];
      description: string;
      icfr_cross_ref: string | null;
      escalated: boolean;
      reporting_consideration: boolean;
      component_row_id: string | null;
      branch_id: string | null;
    }>(
      `SELECT pf.id, pf.seq, pf.category, pf.impacts, pf.description, pf.icfr_cross_ref,
              pf.escalated, pf.reporting_consideration,
              (SELECT c.id FROM hsdg.audit_group_component c
                 JOIN hsdg.audit_group_component pc ON pc.id = pf.component_row_id
                WHERE c.workflow_instance_id = $1 AND c.component_id = pc.component_id
                  AND c.withdrawn_at IS NULL) AS component_row_id,
              (SELECT b.id FROM hsdg.audit_group_branch b
                WHERE b.workflow_instance_id = $1 AND b.prior_branch_id = pf.branch_id
                  AND b.withdrawn_at IS NULL) AS branch_id
         FROM hsdg.audit_group_finding pf
        WHERE pf.workflow_instance_id = $2 AND pf.status = 'open' AND pf.withdrawn_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM hsdg.audit_group_finding cf
                           WHERE cf.workflow_instance_id = $1 AND cf.prior_finding_id = pf.id)
        ORDER BY pf.seq`,
      [workflowInstanceId, prior.workflowInstanceId],
    );
    for (const f of rows) {
      if (!f.component_row_id && !f.branch_id) continue; // Subject no longer in scope.
      const ref = `${findingRef(f.seq)} (${prior.financialYear})`;
      await client.query(
        `INSERT INTO hsdg.audit_group_finding
           (workflow_instance_id, engagement_id, seq, component_row_id, branch_id, category, impacts,
            description, icfr_cross_ref, escalated, reporting_consideration, prior_finding_id, prior_ref)
         SELECT $1, $2, COALESCE(max(seq), 0) + 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
           FROM hsdg.audit_group_finding WHERE workflow_instance_id = $1
         ON CONFLICT (workflow_instance_id, prior_finding_id) WHERE prior_finding_id IS NOT NULL
         DO NOTHING`,
        [
          workflowInstanceId,
          engagementId,
          f.component_row_id,
          f.branch_id,
          f.category,
          f.impacts,
          `Follow-up of last year's ${ref}: ${f.description}`,
          f.icfr_cross_ref,
          f.escalated,
          f.reporting_consideration,
          f.id,
          ref,
        ],
      );
    }
  }

  /** §19: generate (frozen items, refreshed applicability) or withdraw the programme. */
  private async syncWorkProgramme(
    client: PoolClient,
    group: GroupRow,
    engagementId: string,
    workflowInstanceId: string,
    result: ConsolidationApprovedResult,
    planned: PerimeterComponent[],
  ): Promise<void> {
    const action = planWorkProgramme(result.cfsRequired, group.work_status);
    if (action === 'withdraw') {
      await client.query(
        `UPDATE hsdg.audit_group_audit SET work_status = 'withdrawn', work_withdrawn_at = now()
          WHERE id = $1 AND work_status = 'active'`,
        [group.id],
      );
      await client.query(
        `UPDATE hsdg.audit_group_work_item SET status = 'withdrawn'
          WHERE group_audit_id = $1 AND status = 'active'`,
        [group.id],
      );
      return;
    }
    if (action !== 'ensure') return;
    const items = workItemsInForce(await this.loadLibrary(client), result.periodStart);
    if (!items.length) return;
    if (group.work_status !== 'active') {
      await client.query(
        `UPDATE hsdg.audit_group_audit
            SET work_status = 'active', work_framework_code = $2, work_framework_label = $3,
                work_generated_at = now(), work_withdrawn_at = NULL
          WHERE id = $1`,
        [group.id, items[0]!.frameworkCode, items[0]!.frameworkLabel],
      );
    }
    const { rows: oa } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.audit_group_component
        WHERE group_audit_id = $1 AND withdrawn_at IS NULL AND auditor_type = 'other_auditor'`,
      [group.id],
    );
    const facts = workProgrammeFacts(planned, oa[0]?.n ?? 0);
    for (const i of items) {
      const a = workItemApplicability(i.activation, facts);
      await client.query(
        `INSERT INTO hsdg.audit_group_work_item
           (group_audit_id, workflow_instance_id, engagement_id, library_item_id, item_key, title,
            objective, evidence, activation, applicable, basis, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (group_audit_id, item_key) DO UPDATE
            SET applicable = EXCLUDED.applicable, basis = EXCLUDED.basis, status = 'active'
          WHERE (audit_group_work_item.applicable, audit_group_work_item.basis, audit_group_work_item.status)
                IS DISTINCT FROM (EXCLUDED.applicable, EXCLUDED.basis, 'active')`,
        [
          group.id,
          workflowInstanceId,
          engagementId,
          i.id,
          i.itemKey,
          i.title,
          i.objective,
          i.evidence,
          i.activation,
          a.applicable,
          a.basis,
          i.sortOrder,
        ],
      );
    }
  }

  // ── View assembly ──────────────────────────────────────────────────────

  private async readView(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    ensured: Ensured,
  ): Promise<StatutoryAuditGroupAudit> {
    const result = ensured.result;
    const group = await this.loadGroup(client, workflowInstanceId);
    const lead = await isEngagementLead(client, engagementId);
    const matrix = groupMatrixState(result?.cfsRequired ?? null);
    const [comps, branches, findings, files, packages, status, mat] = await Promise.all([
      group
        ? client
            .query<ComponentRow>(
              `${COMPONENT_SELECT} WHERE group_audit_id = $1 ORDER BY sort_order, component_name`,
              [group.id],
            )
            .then((r) => r.rows)
        : Promise.resolve([] as ComponentRow[]),
      group
        ? client
            .query<BranchRow>(
              `${BRANCH_SELECT} WHERE group_audit_id = $1 ORDER BY sort_order, branch_name`,
              [group.id],
            )
            .then((r) => r.rows)
        : Promise.resolve([] as BranchRow[]),
      client
        .query<FindingRow>(`${FINDING_SELECT} WHERE f.workflow_instance_id = $1 ORDER BY f.seq`, [
          workflowInstanceId,
        ])
        .then((r) => r.rows),
      this.loadFiles(client, workflowInstanceId),
      client
        .query<PackageRow>(
          `SELECT p.component_row_id, p.package_key, p.status, p.note,
                  e.full_name AS approved_by_name, p.approved_at
             FROM hsdg.audit_group_package p
             JOIN hsdg.audit_group_component c ON c.id = p.component_row_id
             LEFT JOIN hsdg.employees e ON e.id = p.approved_by_employee_id
            WHERE c.workflow_instance_id = $1`,
          [workflowInstanceId],
        )
        .then((r) => r.rows),
      groupAuditStatusOn(client, workflowInstanceId),
      client
        .query(
          `SELECT 1 FROM hsdg.audit_materiality_determination
            WHERE workflow_instance_id = $1 AND status = 'complete' LIMIT 1`,
          [workflowInstanceId],
        )
        .then((r) => r.rows.length > 0),
    ]);

    const liveFile = (owner: string, slot: GroupAuditFileSlot, key: string | null = null) =>
      files.find(
        (f) =>
          (f.component_row_id ?? f.branch_id) === owner &&
          f.slot === slot &&
          (f.package_key ?? null) === key &&
          !f.superseded_at,
      ) ?? null;
    const openFindings = (owner: string) =>
      findings.filter(
        (f) =>
          (f.component_row_id ?? f.branch_id) === owner && f.status === 'open' && !f.withdrawn_at,
      ).length;

    const components: GroupAuditComponent[] = comps.map((r) => {
      const relevance = packageRelevance(r.auditor_type, r.is_indian_company);
      const pkgRows = packages.filter((p) => p.component_row_id === r.id);
      const statusOf: Partial<Record<PackageDocumentKey, PackageDocumentStatus>> = {};
      for (const p of pkgRows) statusOf[p.package_key] = p.status;
      const pkg: PackageDocument[] = relevance
        ? PACKAGE_DOCUMENT_KEYS.map((key) => {
            const p = pkgRows.find((x) => x.package_key === key);
            const live = liveFile(r.id, 'package', key);
            return {
              key,
              label: PACKAGE_DOCUMENT_LABEL[key],
              relevant: relevance[key],
              status: p?.status ?? (relevance[key] ? 'pending' : 'not_applicable'),
              file: live ? mapFile(live) : null,
              superseded: files
                .filter(
                  (f) =>
                    f.component_row_id === r.id &&
                    f.slot === 'package' &&
                    f.package_key === key &&
                    f.superseded_at,
                )
                .map(mapFile),
              approvedByName: p?.approved_by_name ?? null,
              approvedAt: iso(p?.approved_at ?? null),
              note: p?.note ?? null,
            };
          })
        : [];
      const report = liveFile(r.id, 'report');
      const memo = liveFile(r.id, 'completion_memo');
      const instructions = liveFile(r.id, 'instructions');
      const prior: PriorComponent | null = r.prior_auditor_type
        ? {
            auditorType: r.prior_auditor_type,
            firmName: r.prior_firm_name,
            frn: null,
            professionalBody: null,
            auditorCountry: null,
            partnerContact: null,
            reportType: r.prior_report_type,
          }
        : null;
      const suggestion = suggestAuditor(
        ensured.perimeter.find((p) => p.id === r.component_id) ?? { auditedByOtherAuditor: false },
        prior,
      );
      const pendingPackage = pendingPackageDocuments(relevance, statusOf).length;
      return {
        id: r.id,
        componentId: r.component_id,
        componentName: r.component_name,
        relationship: r.relationship,
        method: r.method,
        included: r.included,
        country: r.country,
        isIndianCompany: r.is_indian_company,
        auditorType: r.auditor_type,
        auditorSource: r.auditor_source,
        suggestedAuditorType: suggestion.type,
        suggestedBasis: suggestion.basis,
        firmName: r.firm_name,
        frn: r.frn,
        professionalBody: r.professional_body,
        auditorCountry: r.auditor_country,
        partnerContact: r.partner_contact,
        periodFrom: r.period_from,
        periodTo: r.period_to,
        reportType: r.report_type,
        reportDate: r.report_date,
        reportingDeadline: r.reporting_deadline,
        sa600: r.sa600,
        sa600Source: r.sa600_source,
        significance: r.significance,
        significanceNote: r.significance_note,
        answers: {
          ga02: r.ga02,
          ga02Basis: r.ga02_basis,
          ga03: r.ga03,
          ga03Note: r.ga03_note,
          ga04: r.ga04,
          ga04Basis: r.ga04_basis,
        },
        report: report ? mapFile(report) : null,
        completionMemo: memo ? mapFile(memo) : null,
        instructions: instructions ? mapFile(instructions) : null,
        package: pkg,
        openFindings: openFindings(r.id),
        missing: r.withdrawn_at
          ? []
          : componentMissing({
              auditorType: r.auditor_type,
              firmName: r.firm_name,
              country: r.country,
              auditorCountry: r.auditor_country,
              periodFrom: r.period_from,
              periodTo: r.period_to,
              reportType: r.report_type,
              sa600: r.sa600,
              significance: r.significance,
              ga02: r.ga02,
              ga03: r.ga03,
              ga04: r.ga04,
              hasReport: !!report,
              hasCompletionMemo: !!memo,
              hasInstructions: !!instructions,
              pendingPackage,
              priorReportType: r.prior_report_type,
              findingCategories: findings
                .filter((f) => f.component_row_id === r.id && !f.withdrawn_at)
                .map((f) => f.category),
            }),
        priorYear: prior
          ? {
              auditorType: prior.auditorType,
              firmName: prior.firmName,
              reportType: prior.reportType,
            }
          : null,
        auditorChanged: auditorChanged(
          { auditorType: r.auditor_type, firmName: r.firm_name },
          prior,
        ),
        withdrawn: !!r.withdrawn_at,
        version: r.version,
      };
    });

    const branchView: GroupAuditBranch[] = branches.map((b) => {
      const report = liveFile(b.id, 'branch_report');
      const instructions = liveFile(b.id, 'branch_instructions');
      return {
        id: b.id,
        branchName: b.branch_name,
        location: b.location,
        country: b.country,
        firmName: b.firm_name,
        frn: b.frn,
        partnerContact: b.partner_contact,
        appointmentBasis: b.appointment_basis,
        appointmentNote: b.appointment_note,
        periodFrom: b.period_from,
        periodTo: b.period_to,
        instructions: instructions ? mapFile(instructions) : null,
        report: report ? mapFile(report) : null,
        answers: {
          ga02: b.ga02,
          ga02Basis: b.ga02_basis,
          ga03: b.ga03,
          ga03Note: b.ga03_note,
          ga04: b.ga04,
          ga04Basis: b.ga04_basis,
        },
        significance: b.significance,
        principalResponse: b.principal_response,
        conclusion: b.conclusion,
        openFindings: openFindings(b.id),
        missing: b.withdrawn_at
          ? []
          : branchMissing({
              firmName: b.firm_name,
              appointmentBasis: b.appointment_basis,
              periodFrom: b.period_from,
              periodTo: b.period_to,
              significance: b.significance,
              ga02: b.ga02,
              ga03: b.ga03,
              ga04: b.ga04,
              hasReport: !!report,
              hasInstructions: !!instructions,
              principalResponse: b.principal_response,
              conclusion: b.conclusion,
            }),
        fromPriorYear: !!b.prior_branch_id,
        withdrawn: !!b.withdrawn_at,
        version: b.version,
      };
    });

    const liveTypes = comps.filter((c) => !c.withdrawn_at).map((c) => c.auditor_type);
    const ga01Suggested = suggestGa01(liveTypes);
    const liveBranches = branches.filter((b) => !b.withdrawn_at).length;
    const br01Suggested = suggestBr01({
      branchesOnMaster: result?.branchesOnMaster ?? false,
      branchRecords: liveBranches,
    });
    const br01Team = group?.br01_source === 'team';

    return {
      workflowInstanceId,
      engagementId,
      matrixState: matrix.state,
      matrixReason: matrix.reason,
      consolidationOutcome: result?.outcome ?? null,
      cfsRequired: result?.cfsRequired ?? null,
      periodStart: result?.periodStart ?? new Date().toISOString().slice(0, 10),
      ga01: group?.ga01 ?? ga01Suggested.answer,
      ga01Basis: group?.ga01 ? group.ga01_basis : null,
      ga01Source: group?.ga01
        ? (group.ga01_source ?? 'team')
        : ga01Suggested.answer
          ? 'system'
          : null,
      ga01Suggested: ga01Suggested.answer,
      ga01SuggestedBasis: ga01Suggested.basis,
      components,
      br01: br01Team ? group!.br01 : br01Suggested.answer,
      br01Source: br01Team ? 'team' : 'system',
      br01Basis: br01Team ? (group!.br01_basis ?? '') : br01Suggested.basis,
      branches: branchView,
      findings: findings.map(mapFinding),
      status,
      materialityNote: MATERIALITY_NOTE,
      materialityApproved: mat,
      version: group?.version ?? 0,
      readOnly: !lead || !group,
    };
  }

  private async readWorkProgramme(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    ensured: Ensured,
  ): Promise<ConsolidationWorkProgramme> {
    const group = await this.loadGroup(client, workflowInstanceId);
    const current = group?.work_status ?? 'none';
    const st = workProgrammeState(ensured.result?.cfsRequired ?? null, current);
    const { rows } = group
      ? await client.query<{
          id: string;
          item_key: string;
          title: string;
          objective: string;
          evidence: string;
          activation: WorkItemActivation;
          applicable: boolean;
          basis: string;
          procedure_id: string | null;
          procedure_ref: string | null;
          procedure_state: string | null;
          status: string;
        }>(
          `SELECT w.id, w.item_key, w.title, w.objective, w.evidence, w.activation, w.applicable,
                  w.basis, w.procedure_id, p.procedure_ref, p.state AS procedure_state, w.status
             FROM hsdg.audit_group_work_item w
             LEFT JOIN hsdg.audit_procedures p ON p.id = w.procedure_id
            WHERE w.group_audit_id = $1 ORDER BY w.sort_order`,
          [group.id],
        )
      : { rows: [] };
    const items: ConsolidationWorkItem[] = rows.map((r) => ({
      id: r.id,
      itemKey: r.item_key,
      title: r.title,
      objective: r.objective,
      evidence: r.evidence,
      activation: r.activation,
      applicable: r.applicable,
      basis: r.basis,
      procedureId: r.procedure_id,
      procedureRef: r.procedure_ref,
      procedureStatus: r.procedure_state,
      withdrawn: r.status === 'withdrawn',
    }));
    return {
      workflowInstanceId,
      engagementId,
      state: st.state,
      reason: st.reason,
      frameworkLabel: group?.work_framework_label ?? null,
      generatedAt: iso(group?.work_generated_at ?? null),
      items,
      linked: items.filter((i) => i.applicable && !i.withdrawn && i.procedureId).length,
      readOnly: true,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async mutate(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    fn: (client: PoolClient, ensured: Ensured) => Promise<void>,
  ): Promise<StatutoryAuditGroupAudit> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertLeadShell(client, engagementId, workflowInstanceId);
      const before = await this.ensureOn(client, engagementId, workflowInstanceId);
      await fn(client, before);
      const ensured = await this.ensureOn(client, engagementId, workflowInstanceId);
      return this.readView(client, engagementId, workflowInstanceId, ensured);
    });
  }

  private async insertFile(
    client: PoolClient,
    ctx: RlsContext,
    workflowInstanceId: string,
    engagementId: string,
    target: FileTarget,
    documentId: string,
    how: 'added' | 'linked' | 'generated',
    replaceReason: string | null | undefined,
    template?: {
      versionId: string;
      templateKey: string;
      variantKey: string;
      versionNo: number;
      missingFields: string[];
    },
  ): Promise<void> {
    const existing = await this.liveFile(client, target);
    if (existing?.document_id === documentId)
      throw new ConflictException('That file is already linked here.');
    if (existing) {
      const approved = await this.assertReplaceable(client, target, replaceReason);
      await client.query(
        `UPDATE hsdg.audit_group_file
            SET superseded_at = now(), superseded_reason = $2, superseded_by_employee_id = $3
          WHERE id = $1`,
        [
          existing.id,
          trimOrNull(replaceReason) ?? 'Replaced by a newer file',
          ctx.employeeId ?? null,
        ],
      );
      if (approved && target.componentRowId && target.packageKey) {
        // Replaced approved evidence goes back to Received — it needs approving again.
        await client.query(
          `UPDATE hsdg.audit_group_package
              SET status = 'received', approved_by_employee_id = NULL, approved_at = NULL,
                  version = version + 1
            WHERE component_row_id = $1 AND package_key = $2`,
          [target.componentRowId, target.packageKey],
        );
      }
    }
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_group_file
         (workflow_instance_id, engagement_id, slot, component_row_id, branch_id, package_key,
          document_id, how, template_version_id, template_key, template_variant_key,
          template_version_no, linked_by_employee_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        workflowInstanceId,
        engagementId,
        target.slot,
        target.componentRowId,
        target.branchId,
        target.packageKey,
        documentId,
        how,
        template?.versionId ?? null,
        template?.templateKey ?? null,
        template?.variantKey ?? null,
        template?.versionNo ?? null,
        ctx.employeeId ?? null,
      ],
    );
    if (target.slot === 'package' && target.componentRowId && target.packageKey) {
      await client.query(
        `INSERT INTO hsdg.audit_group_package (component_row_id, engagement_id, package_key, status)
         VALUES ($1, $2, $3, 'received')
         ON CONFLICT (component_row_id, package_key) DO UPDATE
            SET status = 'received', version = audit_group_package.version + 1
          WHERE audit_group_package.status IN ('pending','not_applicable')`,
        [target.componentRowId, engagementId, target.packageKey],
      );
    }
    await this.audit.recordWith(client, ctx, {
      action: `statutory_audit.group_file_${how}`,
      objectType: target.branchId ? 'audit_group_branch' : 'audit_group_component',
      objectId: (target.componentRowId ?? target.branchId)!,
      after: {
        fileId: rows[0]!.id,
        slot: target.slot,
        packageKey: target.packageKey,
        documentId,
        replaced: existing?.document_id ?? null,
        replaceReason: existing ? trimOrNull(replaceReason) : null,
        ...(template ?? {}),
      },
    });
  }

  /** Approved package evidence is never silently replaced. Returns whether it was approved. */
  private async assertReplaceable(
    client: PoolClient,
    target: FileTarget,
    replaceReason: string | null | undefined,
  ): Promise<boolean> {
    if (target.slot !== 'package' || !target.componentRowId || !target.packageKey) return false;
    const { rows } = await client.query<{ status: PackageDocumentStatus }>(
      `SELECT status FROM hsdg.audit_group_package WHERE component_row_id = $1 AND package_key = $2`,
      [target.componentRowId, target.packageKey],
    );
    const approved = rows[0]?.status === 'approved';
    if (approved && !(await this.liveFile(client, target))) return false;
    if (approved && !trimOrNull(replaceReason))
      throw new BadRequestException(
        `${PACKAGE_DOCUMENT_LABEL[target.packageKey]} is approved — give a reason to replace it.`,
      );
    return approved;
  }

  private async resolveTarget(
    client: PoolClient,
    workflowInstanceId: string,
    input: { slot: GroupAuditFileSlot; ownerId: string; packageKey?: PackageDocumentKey | null },
  ): Promise<FileTarget> {
    if (COMPONENT_SLOTS.has(input.slot)) {
      const row = await this.loadComponent(client, workflowInstanceId, input.ownerId);
      let packageKey: PackageDocumentKey | null = null;
      if (input.slot === 'package') {
        if (!input.packageKey) throw new BadRequestException('Say which package document this is.');
        const relevance = packageRelevance(row.auditor_type, row.is_indian_company);
        if (!relevance) throw new BadRequestException('This component takes no reporting package.');
        packageKey = input.packageKey;
      } else if (input.packageKey) {
        throw new BadRequestException('Only package documents take a package key.');
      }
      return { slot: input.slot, componentRowId: row.id, branchId: null, packageKey };
    }
    if (input.packageKey)
      throw new BadRequestException('Only package documents take a package key.');
    const b = await this.loadBranch(client, workflowInstanceId, input.ownerId);
    return { slot: input.slot, componentRowId: null, branchId: b.id, packageKey: null };
  }

  private async liveFile(
    client: PoolClient,
    t: FileTarget,
  ): Promise<{ id: string; document_id: string } | null> {
    const { rows } = await client.query<{ id: string; document_id: string }>(
      `SELECT id, document_id FROM hsdg.audit_group_file
        WHERE COALESCE(component_row_id, branch_id) = $1 AND slot = $2
          AND COALESCE(package_key, '') = COALESCE($3, '') AND superseded_at IS NULL`,
      [t.componentRowId ?? t.branchId, t.slot, t.packageKey],
    );
    return rows[0] ?? null;
  }

  private async loadFiles(client: PoolClient, workflowInstanceId: string): Promise<FileRow[]> {
    const { rows } = await client.query<FileRow>(
      `SELECT f.id, f.slot, f.component_row_id, f.branch_id, f.package_key, f.document_id, f.how,
              d.title, cv.filename, d.current_version_no,
              (d.m365_live_item_id IS NOT NULL) AS in_sharepoint,
              lb.full_name AS linked_by_name, f.linked_at, f.superseded_at
         FROM hsdg.audit_group_file f
         JOIN hsdg.documents d ON d.id = f.document_id AND d.deleted_at IS NULL
         LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
         LEFT JOIN hsdg.employees lb ON lb.id = f.linked_by_employee_id
        WHERE f.workflow_instance_id = $1
        ORDER BY f.linked_at`,
      [workflowInstanceId],
    );
    return rows;
  }

  private async loadLibrary(client: PoolClient): Promise<ConsolidationWorkLibraryItem[]> {
    const { rows } = await client.query<{
      id: string;
      framework_code: string;
      framework_label: string;
      item_key: string;
      title: string;
      objective: string;
      evidence: string;
      activation: WorkItemActivation;
      sort_order: number;
      effective_from: string;
      effective_to: string | null;
    }>(
      `SELECT id, framework_code, framework_label, item_key, title, objective, evidence, activation,
              sort_order, effective_from, effective_to
         FROM hsdg.consolidation_work_library ORDER BY sort_order`,
    );
    return rows.map((r) => ({
      id: r.id,
      frameworkCode: r.framework_code,
      frameworkLabel: r.framework_label,
      itemKey: r.item_key,
      title: r.title,
      objective: r.objective,
      evidence: r.evidence,
      activation: r.activation,
      sortOrder: r.sort_order,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
    }));
  }

  private async readPriorComponents(
    client: PoolClient,
    prior: PriorAuditFile,
  ): Promise<Array<PriorComponent & { componentId: string; name: string }>> {
    const { rows } = await client.query<{
      component_id: string;
      component_name: string;
      auditor_type: ComponentAuditorType;
      firm_name: string | null;
      frn: string | null;
      professional_body: string | null;
      auditor_country: string | null;
      partner_contact: string | null;
      report_type: ComponentReportType | null;
    }>(
      `SELECT component_id, component_name, auditor_type, firm_name, frn, professional_body,
              auditor_country, partner_contact, report_type
         FROM hsdg.audit_group_component
        WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL`,
      [prior.workflowInstanceId],
    );
    return rows.map((r) => ({
      componentId: r.component_id,
      name: r.component_name,
      auditorType: r.auditor_type,
      firmName: r.firm_name,
      frn: r.frn,
      professionalBody: r.professional_body,
      auditorCountry: r.auditor_country,
      partnerContact: r.partner_contact,
      reportType: r.report_type,
    }));
  }

  private async loadGroup(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<GroupRow | null> {
    const { rows } = await client.query<GroupRow>(
      `SELECT id, engagement_id, ga01, ga01_basis, ga01_source, br01, br01_source, br01_basis,
              work_status, work_framework_code, work_framework_label, work_generated_at, version
         FROM hsdg.audit_group_audit WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows[0] ?? null;
  }

  private async requireGroup(client: PoolClient, workflowInstanceId: string): Promise<GroupRow> {
    const g = await this.loadGroup(client, workflowInstanceId);
    if (!g) throw new NotFoundException('02.6 has not been opened on this file yet.');
    return g;
  }

  private async loadComponent(
    client: PoolClient,
    workflowInstanceId: string,
    rowId: string,
  ): Promise<ComponentRow> {
    const { rows } = await client.query<ComponentRow>(
      `${COMPONENT_SELECT} WHERE id = $1 AND workflow_instance_id = $2`,
      [rowId, workflowInstanceId],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('Component not found in the group-audit matrix.');
    if (r.withdrawn_at)
      throw new ConflictException(
        'This component has left the perimeter — its record is kept read-only.',
      );
    return r;
  }

  private async loadBranch(
    client: PoolClient,
    workflowInstanceId: string,
    branchId: string,
    allowWithdrawn = false,
  ): Promise<BranchRow> {
    const { rows } = await client.query<BranchRow>(
      `${BRANCH_SELECT} WHERE id = $1 AND workflow_instance_id = $2`,
      [branchId, workflowInstanceId],
    );
    const b = rows[0];
    if (!b) throw new NotFoundException('Branch auditor record not found.');
    if (b.withdrawn_at && !allowWithdrawn)
      throw new ConflictException('This branch auditor record is withdrawn.');
    return b;
  }

  private async liveBranchCount(client: PoolClient, workflowInstanceId: string): Promise<number> {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.audit_group_branch
        WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL`,
      [workflowInstanceId],
    );
    return rows[0]?.n ?? 0;
  }

  /** `UPDATE hsdg.<table> SET <cols> WHERE id = $1` from a column map (columns are ours, never input). */
  private async updateRow(
    client: PoolClient,
    table: string,
    id: string,
    sets: Record<string, unknown>,
  ): Promise<void> {
    const cols = Object.keys(sets);
    await client.query(
      `UPDATE hsdg.${table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [id, ...cols.map((c) => sets[c])],
    );
  }

  private async assertLeadShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ) {
    await this.assertShell(client, engagementId, workflowInstanceId);
    if (!(await isEngagementLead(client, engagementId)))
      throw new ForbiddenException(
        'Only the engagement leads can change the group-audit framework.',
      );
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

function assertBasis(q: string, answer: string, basis: string | null, what: string): void {
  if ((answer === 'yes' || answer === 'no') && !trimOrNull(basis))
    throw new BadRequestException(
      `${q} ${answer === 'yes' ? 'Yes' : 'No'} needs its basis — record ${what}.`,
    );
}

function assertPeriod(from: string | null, to: string | null): void {
  if (from && to && to < from) throw new BadRequestException('The period ends before it starts.');
}

function pick<T extends object>(o: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in o) out[k] = (o as Record<string, unknown>)[k];
  return out;
}

function mapFile(f: FileRow): GroupAuditFile {
  return {
    id: f.id,
    documentId: f.document_id,
    title: f.title,
    filename: f.filename,
    versionNo: f.current_version_no,
    inSharePoint: f.in_sharepoint,
    linkedByName: f.linked_by_name,
    linkedAt: f.linked_at.toISOString(),
    how: f.how,
  };
}

function mapFinding(f: FindingRow): GroupAuditFinding {
  return {
    id: f.id,
    seq: f.seq,
    ref: findingRef(f.seq),
    subjectKind: f.component_row_id ? 'component' : 'branch',
    subjectId: (f.component_row_id ?? f.branch_id)!,
    subjectName: f.subject_name ?? '—',
    category: f.category,
    impacts: f.impacts ?? [],
    description: f.description,
    icfrCrossRef: f.icfr_cross_ref,
    escalated: f.escalated,
    reportingConsideration: f.reporting_consideration,
    status: f.status,
    response: f.response,
    resolvedByName: f.resolved_by_name,
    resolvedAt: iso(f.resolved_at),
    priorYearRef: f.prior_ref,
    withdrawn: !!f.withdrawn_at,
    version: f.version,
  };
}
