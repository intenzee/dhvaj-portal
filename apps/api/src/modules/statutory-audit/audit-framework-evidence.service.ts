import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  DOCUMENT_TEMPLATE_KEY,
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  templateDefinition,
  type AddFrameworkFileInput,
  type CreateFrameworkMemoInput,
  type FileVersionHistory,
  type FrameworkEvidenceView,
  type FrameworkFileKind,
  type FrameworkFileRecord,
  type FrameworkMemoAvailability,
  type FrameworkMemoCreated,
  type LinkFrameworkFileInput,
  FRAMEWORK_EVIDENCE_QUESTION_LABEL,
  FRAMEWORK_EVIDENCE_QUESTIONS,
  type DocumentTemplateKey,
  type FrameworkEvidenceQuestion,
  type SubSectionKey,
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
import { readFinancialReportingMemoFacts } from './financial-reporting-result';
import { frameworkMemoMergeValues } from './framework-memo-values';
import { isEngagementLead } from './master-facts';
import { readScheduleIiiMemoInput, scheduleIiiMergeValues } from './schedule-iii-memo-values';
import { caroMergeValues, readCaroMemoInput } from './caro-memo-values';

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The Section 02 sub-assessments that create a technical memo, and from which template. */
interface MemoSpec {
  subSectionKey: SubSectionKey;
  templateKey: DocumentTemplateKey;
  areaKey: string;
  /** Missing-template message. */
  noTemplate: string;
  /** The sub-assessment is not open yet. */
  notOpen: string;
  /** The memo's `frf.*` / `sch.*` merge values. */
  values: (
    client: PoolClient,
    workflowInstanceId: string,
  ) => Promise<Record<string, string | null>>;
}
const noTemplate = (what: string) =>
  `No approved DHVAJ template for the ${what} memo yet — an administrator must upload and approve one under Settings → Document templates.`;
const MEMOS: Partial<Record<SubSectionKey, MemoSpec>> = {
  [SUB_SECTION_KEY.financialReporting]: {
    subSectionKey: SUB_SECTION_KEY.financialReporting,
    templateKey: DOCUMENT_TEMPLATE_KEY.financialReportingFrameworkMemo,
    areaKey: FRAMEWORK_AREA_KEY.financialReportingFramework,
    noTemplate: noTemplate('Financial Reporting Framework'),
    notOpen: 'Open 02.2 Financial Reporting Framework before creating its memo.',
    values: async (client, wf) =>
      frameworkMemoMergeValues(await readFinancialReportingMemoFacts(client, wf)),
  },
  [SUB_SECTION_KEY.scheduleIii]: {
    subSectionKey: SUB_SECTION_KEY.scheduleIii,
    templateKey: DOCUMENT_TEMPLATE_KEY.scheduleIiiPresentationMemo,
    areaKey: FRAMEWORK_AREA_KEY.scheduleIii,
    noTemplate: noTemplate('Schedule III Presentation Framework'),
    notOpen: 'Open 02.3 Schedule III & Presentation before creating its memo.',
    values: async (client, wf) =>
      scheduleIiiMergeValues(await readScheduleIiiMemoInput(client, wf)),
  },
  [SUB_SECTION_KEY.caro]: {
    subSectionKey: SUB_SECTION_KEY.caro,
    templateKey: DOCUMENT_TEMPLATE_KEY.caroApplicabilityMemo,
    areaKey: FRAMEWORK_AREA_KEY.caro,
    noTemplate: noTemplate('CARO 2020 Applicability'),
    notOpen: 'Open 02.4 CARO 2020 Applicability before creating its memo.',
    values: async (client, wf) => caroMergeValues(await readCaroMemoInput(client, wf)),
  },
};

/** Which sub-assessment a checklist question belongs to (02.2 §6–§7; 02.3 §7, §13). */
const QUESTION_SUB_SECTION: Record<FrameworkEvidenceQuestion, SubSectionKey> = {
  frf_02: SUB_SECTION_KEY.financialReporting,
  frf_03: SUB_SECTION_KEY.financialReporting,
  sch_02: SUB_SECTION_KEY.scheduleIii,
  sch_04: SUB_SECTION_KEY.scheduleIii,
};

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_id: string;
  sub_section_key: string;
  state: string;
}

interface FileRow {
  id: string;
  document_id: string;
  kind: FrameworkFileKind;
  question_key: FrameworkEvidenceQuestion | null;
  title: string;
  filename: string | null;
  current_version_no: number;
  last_edited_by: string | null;
  last_saved_at: Date | null;
  linked_by_name: string | null;
  linked_at: Date;
  in_sharepoint: boolean;
  edit_locked: boolean;
  template_variant_key: string | null;
  template_version_no: number | null;
}

/**
 * Section 02 evidence and the 02.2 / 02.3 technical memos (DHVAJ 02.2 spec §7,
 * §18; 02.3 spec §17, §18).
 *
 * Files sit on a sub-assessment and point at engagement documents — stored in
 * the engagement's SharePoint workspace when Microsoft 365 is on, linked from
 * what the engagement already holds (never a copy), opened from the portal,
 * with SharePoint's version history. The memo is created from the firm's
 * approved Word template with the 02.2 assessment facts merged in, and keeps
 * the exact template version used. Once Section 02 is approved the files are
 * read-only (the sub-assessment state is `approved`).
 */
@Injectable()
export class AuditFrameworkEvidenceService {
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
    subAssessmentId: string,
  ): Promise<FrameworkEvidenceView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const sub = await this.loadSub(client, engagementId, workflowInstanceId, subAssessmentId);
      return this.readView(client, sub);
    });
  }

  private async readView(client: PoolClient, sub: SubRow): Promise<FrameworkEvidenceView> {
    const { rows } = await client.query<FileRow>(
      `SELECT f.id, f.document_id, f.kind, f.question_key, d.title, cv.filename, d.current_version_no,
              ue.full_name AS last_edited_by, cv.uploaded_at AS last_saved_at,
              lb.full_name AS linked_by_name, f.linked_at,
              (d.m365_live_item_id IS NOT NULL) AS in_sharepoint, d.edit_locked,
              f.template_variant_key, f.template_version_no
         FROM hsdg.audit_framework_files f
         JOIN hsdg.documents d ON d.id = f.document_id AND d.deleted_at IS NULL
         LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
         LEFT JOIN hsdg.employees ue ON ue.id = cv.uploaded_by_employee_id
         LEFT JOIN hsdg.employees lb ON lb.id = f.linked_by_employee_id
        WHERE f.subassessment_id = $1 AND f.removed_at IS NULL
        ORDER BY (f.kind = 'technical_memo') DESC, f.linked_at ASC`,
      [sub.id],
    );
    const files = rows.map(mapFile);
    const readOnly =
      sub.state === 'approved' || !(await isEngagementLead(client, sub.engagement_id));
    let memo: FrameworkMemoAvailability | null = null;
    const spec = MEMOS[sub.sub_section_key as SubSectionKey];
    if (spec) {
      const live = files.find((f) => f.kind === 'technical_memo') ?? null;
      const resolved = await this.resolveMemoTemplate(
        client,
        spec.templateKey,
        sub.workflow_instance_id,
      );
      memo = {
        templateAvailable: resolved !== null,
        reason: live
          ? 'The technical memo already exists — open it from the list.'
          : sub.state === 'approved'
            ? 'Section 02 is approved; reopen it before adding a memo.'
            : resolved
              ? null
              : spec.noTemplate,
        memoFileId: live?.id ?? null,
      };
    }
    return {
      subAssessmentId: sub.id,
      subSectionKey: sub.sub_section_key,
      workflowInstanceId: sub.workflow_instance_id,
      readOnly,
      m365Enabled: this.m365.enabled,
      files,
      memo,
    };
  }

  /** The file's version history (SharePoint's when it holds the file). */
  async versions(
    principal: Principal,
    engagementId: string,
    workflowInstanceId: string,
    subAssessmentId: string,
    fileId: string,
  ): Promise<FileVersionHistory> {
    const ctx = rlsContextFromPrincipal(principal);
    const documentId = await this.db.withRlsContext(ctx, async (client) => {
      const sub = await this.loadSub(client, engagementId, workflowInstanceId, subAssessmentId);
      return (await this.loadFile(client, sub.id, fileId)).document_id;
    });
    return this.m365.versionHistory(principal, engagementId, documentId);
  }

  // ── Add File / Link Existing File / Remove ─────────────────────────────

  async add(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    subAssessmentId: string,
    input: AddFrameworkFileInput,
  ): Promise<FrameworkEvidenceView> {
    let question: FrameworkEvidenceQuestion | null = null;
    await this.db.withRlsContext(ctx, async (client) => {
      const sub = await this.loadSub(client, engagementId, workflowInstanceId, subAssessmentId);
      assertEditable(sub);
      question = questionFor(sub, input.questionKey);
    });
    // Stored in the engagement workspace (SharePoint when Microsoft 365 is on).
    const doc = await this.documents.create(ctx, engagementId, {
      title: input.title?.trim() || input.filename.replace(/\.[^.]+$/, ''),
      filename: input.filename,
      contentType: input.contentType,
      contentBase64: input.contentBase64,
      documentType: 'evidence',
    });
    return this.db.withRlsContext(ctx, async (client) => {
      const sub = await this.loadSub(client, engagementId, workflowInstanceId, subAssessmentId);
      await this.insertFile(client, ctx, sub, doc.id, 'evidence', null, 'added', {}, question);
      return this.readView(client, sub);
    });
  }

  async link(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    subAssessmentId: string,
    input: LinkFrameworkFileInput,
  ): Promise<FrameworkEvidenceView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const sub = await this.loadSub(client, engagementId, workflowInstanceId, subAssessmentId);
      assertEditable(sub);
      const question = questionFor(sub, input.questionKey);
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
        [input.documentId, engagementId],
      );
      if (!rows[0]) throw new BadRequestException('That document is not on this engagement.');
      await this.insertFile(
        client,
        ctx,
        sub,
        input.documentId,
        'evidence',
        null,
        'linked',
        {},
        question,
      );
      return this.readView(client, sub);
    });
  }

  /** Take a file off the sub-assessment (the document stays on the engagement). */
  async unlink(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    subAssessmentId: string,
    fileId: string,
  ): Promise<FrameworkEvidenceView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const sub = await this.loadSub(client, engagementId, workflowInstanceId, subAssessmentId);
      assertEditable(sub);
      const { rows } = await client.query<{ document_id: string; kind: FrameworkFileKind }>(
        `UPDATE hsdg.audit_framework_files
            SET removed_at = now(), removed_by_employee_id = $3
          WHERE id = $1 AND subassessment_id = $2 AND removed_at IS NULL
          RETURNING document_id, kind`,
        [fileId, sub.id, ctx.employeeId ?? null],
      );
      if (!rows[0]) throw new NotFoundException('That file is not linked here.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_file_unlinked',
        objectType: 'audit_framework_subassessment',
        objectId: sub.id,
        before: { documentId: rows[0].document_id, kind: rows[0].kind },
      });
      return this.readView(client, sub);
    });
  }

  // ── Create Technical Memo (02.2 §18, 02.3 §17) ──────────────────────────

  async createMemo(
    principal: Principal,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateFrameworkMemoInput,
    subSectionKey: SubSectionKey = SUB_SECTION_KEY.financialReporting,
  ): Promise<FrameworkMemoCreated> {
    const ctx = rlsContextFromPrincipal(principal);
    const spec = MEMOS[subSectionKey]!;
    const tdef = templateDefinition(spec.templateKey)!;

    // 1. The sub-assessment, the approved template and the merge values.
    const prepared = await this.db.withRlsContext(ctx, async (client) => {
      const sub = await this.loadMemoSub(client, engagementId, workflowInstanceId, spec);
      assertEditable(sub);
      const { rows: live } = await client.query(
        `SELECT 1 FROM hsdg.audit_framework_files
          WHERE subassessment_id = $1 AND kind = 'technical_memo' AND removed_at IS NULL`,
        [sub.id],
      );
      if (live[0]) {
        throw new ConflictException('The technical memo already exists — open it from the list.');
      }
      const firm = await this.templates.readFirm(client);
      const mergeInput = await readMergeInput(client, workflowInstanceId, firm);
      if (!mergeInput) throw new NotFoundException('Engagement facts could not be read.');
      const resolved = await this.templates.resolveOn(
        client,
        spec.templateKey,
        templateSelectionFacts(mergeInput.master),
        input.variantKey,
      );
      if (!resolved) throw new BadRequestException(spec.noTemplate);
      return {
        sub,
        resolved,
        values: {
          ...buildMergeValues(mergeInput),
          ...(await spec.values(client, workflowInstanceId)),
        },
        clientName: mergeInput.master.legalName,
      };
    });

    // 2. Merge the assessment facts into the template.
    const bytes = await this.templates.readBytes(prepared.resolved.reference);
    const merged = await mergeDocx(bytes, prepared.values, KNOWN_MERGE_FIELDS);
    const filename = tdef.filenamePattern
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

    // 4. … and link it to the sub-assessment, remembering the exact template version.
    const { evidence, fileId } = await this.db.withRlsContext(ctx, async (client) => {
      const sub = await this.loadMemoSub(client, engagementId, workflowInstanceId, spec);
      const id = await this.insertFile(
        client,
        ctx,
        sub,
        doc.id,
        'technical_memo',
        {
          templateKey: spec.templateKey,
          versionId: prepared.resolved.versionId,
          variantKey: prepared.resolved.variantKey,
          versionNo: prepared.resolved.versionNo,
        },
        'created_from_template',
        { missingFields: merged.missing, unknownFields: merged.unknown },
      );
      return { evidence: await this.readView(client, sub), fileId: id };
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
    return { evidence, fileId, documentId: doc.id, editorUrl, missingFields: merged.missing };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async insertFile(
    client: PoolClient,
    ctx: RlsContext,
    sub: SubRow,
    documentId: string,
    kind: FrameworkFileKind,
    template: {
      templateKey: DocumentTemplateKey;
      versionId: string;
      variantKey: string;
      versionNo: number;
    } | null,
    how: 'added' | 'linked' | 'created_from_template',
    extra: Record<string, unknown> = {},
    question: FrameworkEvidenceQuestion | null = null,
  ): Promise<string> {
    let id: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_framework_files
           (subassessment_id, workflow_instance_id, engagement_id, document_id, kind,
            template_version_id, template_key, template_variant_key, template_version_no,
            linked_by_employee_id, question_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          sub.id,
          sub.workflow_instance_id,
          sub.engagement_id,
          documentId,
          kind,
          template?.versionId ?? null,
          template?.templateKey ?? null,
          template?.variantKey ?? null,
          template?.versionNo ?? null,
          ctx.employeeId ?? null,
          question,
        ],
      );
      id = rows[0]!.id;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(
          kind === 'technical_memo'
            ? 'The technical memo already exists — open it from the list.'
            : question
              ? `That file is already linked under ${FRAMEWORK_EVIDENCE_QUESTION_LABEL[question]}.`
              : 'That file is already linked here.',
        );
      }
      throw err;
    }
    await this.audit.recordWith(client, ctx, {
      action: `statutory_audit.framework_file_${how}`,
      objectType: 'audit_framework_subassessment',
      objectId: sub.id,
      after: {
        subSectionKey: sub.sub_section_key,
        documentId,
        kind,
        ...(question ? { questionKey: question } : {}),
        ...(template ?? {}),
        ...extra,
      },
    });
    return id;
  }

  private async resolveMemoTemplate(
    client: PoolClient,
    templateKey: DocumentTemplateKey,
    workflowInstanceId: string,
  ) {
    const firm = await this.templates.readFirm(client);
    const mergeInput = await readMergeInput(client, workflowInstanceId, firm);
    const facts = mergeInput
      ? templateSelectionFacts(mergeInput.master)
      : { listed: false, entityTypeSlug: null, hasGroup: false };
    return this.templates.resolveOn(client, templateKey, facts);
  }

  private async loadFile(
    client: PoolClient,
    subAssessmentId: string,
    fileId: string,
  ): Promise<{ document_id: string }> {
    const { rows } = await client.query<{ document_id: string }>(
      `SELECT document_id FROM hsdg.audit_framework_files
        WHERE id = $1 AND subassessment_id = $2 AND removed_at IS NULL`,
      [fileId, subAssessmentId],
    );
    if (!rows[0]) throw new NotFoundException('That file is not linked here.');
    return rows[0];
  }

  private async loadSub(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    subAssessmentId: string,
  ): Promise<SubRow> {
    const { rows } = await client.query<SubRow>(
      `SELECT s.id, s.workflow_instance_id, s.engagement_id, s.sub_section_key, s.state
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi
           ON swi.id = s.workflow_instance_id AND swi.status <> 'cancelled'
        WHERE s.id = $1 AND s.workflow_instance_id = $2 AND s.engagement_id = $3`,
      [subAssessmentId, workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Section 02 assessment not found on this engagement.');
    return rows[0];
  }

  private async loadMemoSub(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    spec: MemoSpec,
  ): Promise<SubRow> {
    const { rows } = await client.query<SubRow>(
      `SELECT s.id, s.workflow_instance_id, s.engagement_id, s.sub_section_key, s.state
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi
           ON swi.id = s.workflow_instance_id AND swi.status <> 'cancelled'
        WHERE s.workflow_instance_id = $1 AND s.engagement_id = $2
          AND s.sub_section_key = $3 AND s.area_key = $4`,
      [workflowInstanceId, engagementId, spec.subSectionKey, spec.areaKey],
    );
    if (!rows[0]) throw new NotFoundException(spec.notOpen);
    return rows[0];
  }
}

function assertEditable(sub: SubRow): void {
  if (sub.state === 'approved') {
    throw new ConflictException('Section 02 is approved; reopen it before its evidence changes.');
  }
}

function mapFile(r: FileRow): FrameworkFileRecord {
  return {
    id: r.id,
    documentId: r.document_id,
    kind: r.kind,
    questionKey: r.question_key,
    title: r.title,
    filename: r.filename,
    currentVersionNo: r.current_version_no,
    lastEditedBy: r.last_edited_by,
    lastSavedAt: r.last_saved_at ? r.last_saved_at.toISOString() : null,
    linkedByName: r.linked_by_name,
    linkedAt: r.linked_at.toISOString(),
    inSharePoint: r.in_sharepoint,
    editLocked: r.edit_locked,
    templateVariantKey: r.template_variant_key,
    templateVersionNo: r.template_version_no,
  };
}

/** A checklist question carries evidence only on its own sub-assessment (02.2 FRF, 02.3 SCH). */
function questionFor(
  sub: SubRow,
  questionKey: FrameworkEvidenceQuestion | undefined,
): FrameworkEvidenceQuestion | null {
  if (!questionKey) return null;
  if (
    !FRAMEWORK_EVIDENCE_QUESTIONS.includes(questionKey) ||
    QUESTION_SUB_SECTION[questionKey] !== sub.sub_section_key
  ) {
    throw new BadRequestException('That question does not take evidence here.');
  }
  return questionKey;
}
