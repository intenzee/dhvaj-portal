import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  FS_WORKBOOK_TEMPLATE_KEYS,
  SCHEDULE_III_OUTCOME,
  SUB_SECTION_KEY,
  TEMPLATE_CONTENT_TYPE,
  auditPeriodStartFromFinancialYear,
  templateDefinition,
  type CreateFsWorkbookInput,
  type DocumentTemplateKey,
  type FileVersionHistory,
  type FsWorkbookCreated,
  type FsWorkbookRecord,
  type FsWorkbookSelection,
  type FsWorkbookView,
  type ScheduleIiiDetail,
  type ScheduleIiiFrameworkVersion,
  type TemplateSelectionFacts,
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
import { mergeXlsx } from '../document-templates/xlsx-merge';
import {
  buildMergeValues,
  readMergeInput,
  templateSelectionFacts,
  type MergeInput,
} from './acceptance-merge-values';
import { isEngagementLead } from './master-facts';
import { readScheduleIiiMemoInput, scheduleIiiMergeValues } from './schedule-iii-memo-values';

/** The Division a Schedule III conclusion routes to (null for a non-Division outcome). */
const OUTCOME_DIVISION: Record<string, 'I' | 'II' | 'III'> = {
  [SCHEDULE_III_OUTCOME.divisionI]: 'I',
  [SCHEDULE_III_OUTCOME.divisionII]: 'II',
  [SCHEDULE_III_OUTCOME.divisionIII]: 'III',
};

interface Basis {
  subId: string;
  conclusion: string | null;
  frameworkVersion: ScheduleIiiFrameworkVersion | null;
  reportingConcluded: boolean;
  financialYear: string | null;
  periodStart: string;
}

interface WorkbookRow {
  id: string;
  workflow_instance_id: string;
  engagement_id: string;
  document_id: string;
  title: string;
  filename: string | null;
  template_key: DocumentTemplateKey;
  template_id: string;
  template_variant_key: string;
  template_version_id: string;
  template_version_no: number;
  framework_version_id: string | null;
  framework_id: string | null;
  framework_version_label: string | null;
  division: 'I' | 'II' | 'III' | null;
  financial_year: string | null;
  entity_type_slug: string | null;
  created_by_name: string | null;
  created_at: Date;
  in_sharepoint: boolean;
  current_version_no: number;
  last_edited_by: string | null;
  last_saved_at: Date | null;
}

/**
 * The Financial Statements Workbook (DHVAJ 02.3 spec §16, §18).
 *
 * Offered once 02.2 and 02.3 establish the framework. The approved DHVAJ Excel
 * template is chosen centrally — the template key the concluded Schedule III
 * framework version names, the variant matching the entity type and the audit
 * period (template effective version), and that variant's approved version —
 * merged with the engagement and 02.3 facts, and created directly in the
 * engagement's SharePoint workspace (Microsoft 365 on) to open and AutoSave
 * from the portal. The record keeps the template id / version, the framework
 * version and the creation date; a later template or amendment never changes
 * it (acceptance tests 10, 11). One live workbook per audit file — no silent
 * replacement.
 */
@Injectable()
export class AuditFsWorkbookService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly m365: M365Service,
    private readonly templates: DocumentTemplatesService,
  ) {}

  async view(ctx: RlsContext, engagementId: string, workflowInstanceId: string) {
    return this.db.withRlsContext(ctx, (client) =>
      this.readView(client, engagementId, workflowInstanceId),
    );
  }

  /** The workbook's version history (SharePoint's when it holds the file). */
  async versions(
    principal: Principal,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<FileVersionHistory> {
    const ctx = rlsContextFromPrincipal(principal);
    const documentId = await this.db.withRlsContext(ctx, async (client) => {
      await this.assertWorkflow(client, engagementId, workflowInstanceId);
      const live = await this.readLive(client, workflowInstanceId);
      if (!live) throw new NotFoundException('No Financial Statements Workbook yet.');
      return live.documentId;
    });
    return this.m365.versionHistory(principal, engagementId, documentId);
  }

  async create(
    principal: Principal,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateFsWorkbookInput,
  ): Promise<FsWorkbookCreated> {
    const ctx = rlsContextFromPrincipal(principal);

    // 1. The established framework, the template it selects and the merge values.
    const prepared = await this.db.withRlsContext(ctx, async (client) => {
      const view = await this.readView(client, engagementId, workflowInstanceId);
      if (view.workbook) {
        throw new ConflictException(
          'The Financial Statements Workbook already exists — open it from the card.',
        );
      }
      if (view.readOnly) {
        throw new BadRequestException('Only an engagement lead creates the workbook.');
      }
      const sel = view.selection;
      if (!sel || (!view.available && !input.variantKey)) {
        throw new BadRequestException(view.reason ?? 'The workbook cannot be created yet.');
      }
      const mergeInput = (await this.mergeInput(client, workflowInstanceId))!;
      const resolved = await this.templates.resolveOn(
        client,
        sel.templateKey,
        this.selectionFacts(mergeInput, sel.periodStart),
        input.variantKey,
      );
      if (!resolved) {
        throw new BadRequestException(
          input.variantKey
            ? 'That template variant has no approved version.'
            : (view.reason ?? 'No approved workbook template.'),
        );
      }
      const basis = (await this.readBasis(client, engagementId, workflowInstanceId))!;
      return {
        sel,
        resolved,
        subId: basis.subId,
        clientName: mergeInput.master.legalName,
        values: {
          ...buildMergeValues(mergeInput),
          ...scheduleIiiMergeValues(await readScheduleIiiMemoInput(client, workflowInstanceId)),
        },
      };
    });

    // 2. Fill the template's `{{…}}` text cells.
    const bytes = await this.templates.readBytes(prepared.resolved.reference);
    let merged;
    try {
      merged = await mergeXlsx(bytes, prepared.values, KNOWN_MERGE_FIELDS);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const tdef = templateDefinition(prepared.sel.templateKey)!;
    const filename = tdef.filenamePattern
      .replace('{client}', prepared.clientName)
      .replace('{fy}', prepared.sel.financialYear ? `FY ${prepared.sel.financialYear}` : '')
      .replace(/\s{2,}/g, ' ')
      .replace(/[\\/:*?"<>|]/g, '-');

    // 3. Create it in the engagement workspace (SharePoint when Microsoft 365 is on) …
    const doc = await this.documents.create(ctx, engagementId, {
      title: filename.replace(/\.xlsx$/i, ''),
      filename,
      contentType: TEMPLATE_CONTENT_TYPE.xlsx,
      contentBase64: merged.buffer.toString('base64'),
      documentType: 'working_paper',
      classification: 'confidential',
    });

    // 4. … and record the version metadata.
    const view = await this.db.withRlsContext(ctx, async (client) => {
      const sel = prepared.sel;
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_fs_workbooks
             (workflow_instance_id, engagement_id, subassessment_id, document_id,
              template_id, template_key, template_variant_key, template_version_id,
              template_version_no, framework_version_id, framework_id, framework_version_label,
              division, financial_year, entity_type_slug, missing_fields, created_by_employee_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING id`,
          [
            workflowInstanceId,
            engagementId,
            prepared.subId,
            doc.id,
            prepared.resolved.templateId,
            sel.templateKey,
            prepared.resolved.variantKey,
            prepared.resolved.versionId,
            prepared.resolved.versionNo,
            sel.frameworkVersionId,
            sel.frameworkId,
            sel.frameworkVersionLabel,
            sel.division,
            sel.financialYear,
            sel.entityTypeSlug,
            merged.missing,
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException(
            'The Financial Statements Workbook already exists — open it from the card.',
          );
        }
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.fs_workbook_created',
        objectType: 'audit_fs_workbook',
        objectId: id,
        after: {
          documentId: doc.id,
          templateKey: sel.templateKey,
          templateId: prepared.resolved.templateId,
          templateVariantKey: prepared.resolved.variantKey,
          templateVersionId: prepared.resolved.versionId,
          templateVersionNo: prepared.resolved.versionNo,
          frameworkVersionId: sel.frameworkVersionId,
          frameworkId: sel.frameworkId,
          financialYear: sel.financialYear,
          entityTypeSlug: sel.entityTypeSlug,
          missingFields: merged.missing,
        },
      });
      return this.readView(client, engagementId, workflowInstanceId);
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
    return { view, documentId: doc.id, editorUrl, missingFields: merged.missing };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async readView(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<FsWorkbookView> {
    await this.assertWorkflow(client, engagementId, workflowInstanceId);
    const workbook = await this.readLive(client, workflowInstanceId);
    const readOnly = !(await isEngagementLead(client, engagementId));
    const base = {
      workflowInstanceId,
      workbook,
      m365Enabled: this.m365.enabled,
      readOnly,
    };
    const basis = await this.readBasis(client, engagementId, workflowInstanceId);
    const blocked = (reason: string, selection: FsWorkbookSelection | null = null) => ({
      ...base,
      available: false,
      reason: workbook ? null : reason,
      selection,
    });
    if (!basis) return blocked('Open 02.3 Schedule III & Presentation first.');
    if (!basis.reportingConcluded) {
      return blocked('Conclude 02.2 Financial Reporting Framework first.');
    }
    if (!basis.conclusion) {
      return blocked(
        'Conclude 02.3 (SCH-06) first — the workbook follows the established presentation framework.',
      );
    }
    const fv = basis.frameworkVersion;
    if (!fv || !fv.templateKey) {
      return blocked(
        basis.conclusion === SCHEDULE_III_OUTCOME.specialisedFormat
          ? 'A specialised statutory format applies — no Schedule III workbook template is mapped to it.'
          : 'No Schedule III framework version with a mapped workbook template applies to this period.',
      );
    }
    const concludedDivision = OUTCOME_DIVISION[basis.conclusion];
    if (concludedDivision && concludedDivision !== fv.division) {
      return blocked(
        `The concluded Division ${concludedDivision} differs from the framework version resolved (Division ${fv.division}) — re-run the 02.3 assessment.`,
      );
    }
    const templateKey = fv.templateKey as DocumentTemplateKey;
    if (!FS_WORKBOOK_TEMPLATE_KEYS.includes(templateKey)) {
      return blocked(
        `The framework version names an unknown workbook template (${fv.templateKey}).`,
      );
    }
    const mergeInput = await this.mergeInput(client, workflowInstanceId);
    const facts = this.selectionFacts(mergeInput, basis.periodStart);
    const resolved = await this.templates.resolveOn(client, templateKey, facts);
    const selection: FsWorkbookSelection = {
      templateKey,
      templateTitle: templateDefinition(templateKey)!.title,
      frameworkVersionId: fv.id,
      frameworkId: fv.frameworkId,
      frameworkVersionLabel: fv.versionLabel,
      division: fv.division,
      financialYear: basis.financialYear,
      periodStart: basis.periodStart,
      entityTypeSlug: facts.entityTypeSlug,
      templateId: resolved?.templateId ?? null,
      templateVariantKey: resolved?.variantKey ?? null,
      templateVersionId: resolved?.versionId ?? null,
      templateVersionNo: resolved?.versionNo ?? null,
    };
    if (workbook) return { ...base, available: false, reason: null, selection };
    if (!resolved) {
      return blocked(
        `No approved DHVAJ workbook template for ${selection.templateTitle} yet — an administrator must upload and approve one under Settings → Document templates.`,
        selection,
      );
    }
    return { ...base, available: true, reason: null, selection };
  }

  /** The 02.3 conclusion and frozen framework version, and the 02.2 status. */
  private async readBasis(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<Basis | null> {
    const { rows } = await client.query<{
      id: string;
      conclusion: string | null;
      system_detail: ScheduleIiiDetail | null;
      reporting_conclusion: string | null;
      financial_year: string | null;
    }>(
      `SELECT s.id, s.conclusion, s.system_detail,
              (SELECT f.conclusion FROM hsdg.audit_framework_subassessment f
                WHERE f.workflow_instance_id = s.workflow_instance_id
                  AND f.sub_section_key = $4 AND f.area_key = $5) AS reporting_conclusion,
              e.financial_year
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.engagements e ON e.id = s.engagement_id
        WHERE s.workflow_instance_id = $1 AND s.engagement_id = $2
          AND s.sub_section_key = $3 AND s.area_key = $6`,
      [
        workflowInstanceId,
        engagementId,
        SUB_SECTION_KEY.scheduleIii,
        SUB_SECTION_KEY.financialReporting,
        FRAMEWORK_AREA_KEY.financialReportingFramework,
        FRAMEWORK_AREA_KEY.scheduleIii,
      ],
    );
    const r = rows[0];
    if (!r) return null;
    const fy = r.financial_year;
    return {
      subId: r.id,
      conclusion: r.conclusion,
      frameworkVersion: r.system_detail?.frameworkVersion ?? null,
      reportingConcluded: r.reporting_conclusion !== null,
      financialYear: fy,
      periodStart: fy
        ? auditPeriodStartFromFinancialYear(fy)
        : new Date().toISOString().slice(0, 10),
    };
  }

  private async mergeInput(client: PoolClient, workflowInstanceId: string) {
    const firm = await this.templates.readFirm(client);
    return readMergeInput(client, workflowInstanceId, firm);
  }

  private selectionFacts(m: MergeInput | null, periodStart: string): TemplateSelectionFacts {
    return {
      ...(m
        ? templateSelectionFacts(m.master)
        : { listed: false, entityTypeSlug: null, hasGroup: false }),
      periodStart,
    };
  }

  private async readLive(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<FsWorkbookRecord | null> {
    const { rows } = await client.query<WorkbookRow>(
      `SELECT w.id, w.workflow_instance_id, w.engagement_id, w.document_id, d.title, cv.filename,
              w.template_key, w.template_id, w.template_variant_key, w.template_version_id,
              w.template_version_no, w.framework_version_id, w.framework_id,
              w.framework_version_label, w.division, w.financial_year, w.entity_type_slug,
              ce.full_name AS created_by_name, w.created_at,
              (d.m365_live_item_id IS NOT NULL) AS in_sharepoint, d.current_version_no,
              ue.full_name AS last_edited_by, cv.uploaded_at AS last_saved_at
         FROM hsdg.audit_fs_workbooks w
         JOIN hsdg.documents d ON d.id = w.document_id AND d.deleted_at IS NULL
         LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
         LEFT JOIN hsdg.employees ue ON ue.id = cv.uploaded_by_employee_id
         LEFT JOIN hsdg.employees ce ON ce.id = w.created_by_employee_id
        WHERE w.workflow_instance_id = $1 AND w.removed_at IS NULL`,
      [workflowInstanceId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      workflowInstanceId: r.workflow_instance_id,
      engagementId: r.engagement_id,
      documentId: r.document_id,
      title: r.title,
      filename: r.filename,
      templateKey: r.template_key,
      templateId: r.template_id,
      templateVariantKey: r.template_variant_key,
      templateVersionId: r.template_version_id,
      templateVersionNo: r.template_version_no,
      frameworkVersionId: r.framework_version_id,
      frameworkId: r.framework_id,
      frameworkVersionLabel: r.framework_version_label,
      division: r.division,
      financialYear: r.financial_year,
      entityTypeSlug: r.entity_type_slug,
      createdByName: r.created_by_name,
      createdAt: r.created_at.toISOString(),
      inSharePoint: r.in_sharepoint,
      currentVersionNo: r.current_version_no,
      lastEditedBy: r.last_edited_by,
      lastSavedAt: r.last_saved_at ? r.last_saved_at.toISOString() : null,
    };
  }

  private async assertWorkflow(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances
        WHERE id = $1 AND engagement_id = $2 AND status <> 'cancelled'`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Statutory audit not found on this engagement.');
  }
}
