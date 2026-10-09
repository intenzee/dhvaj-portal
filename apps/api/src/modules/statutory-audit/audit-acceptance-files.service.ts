import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ACCEPTANCE_FILE_STATUS_LABEL,
  DOCUMENT_TEMPLATE_DEFINITIONS,
  fileTransitionError,
  isLockedFileStatus,
  slotOf,
  type AcceptanceFileRecord,
  type AcceptanceFileStatus,
  type AcceptanceFilesView,
  type AcceptanceTemplateAvailability,
  type DocumentType,
  type FileVersionHistory,
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
import { readEngagementMasterFacts } from './master-facts';

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The engagement document type each slot files its document under. */
const SLOT_DOCUMENT_TYPE: Record<string, DocumentType> = {
  appointment_communication: 'correspondence',
  consent_certificate: 'certificate',
  previous_auditor_communication: 'correspondence',
  previous_auditor_sent_evidence: 'evidence',
  previous_auditor_response: 'correspondence',
  engagement_letter: 'engagement_letter',
  engagement_letter_delivery: 'evidence',
  client_acknowledgement: 'acknowledgement',
  appointment_filing: 'filing',
  evidence: 'evidence',
};

/** Approving partner conclusions — an active one locks Section 01. */
const APPROVING = `('accept','continue','accept_with_conditions')`;

interface FileRow {
  id: string;
  slot_key: string;
  document_id: string;
  status: AcceptanceFileStatus;
  meta: Record<string, string | null>;
  template_key: string | null;
  template_variant_key: string | null;
  template_version_no: number | null;
  version: number;
  title: string;
  current_filename: string | null;
  current_version_no: number;
  last_edited_by: string | null;
  last_saved_at: Date | null;
  in_sharepoint: boolean;
  edit_locked: boolean;
}

const FILE_SELECT = `
  SELECT f.id, f.slot_key, f.document_id, f.status, f.meta, f.template_key,
         f.template_variant_key, f.template_version_no, f.version,
         d.title, cv.filename AS current_filename, d.current_version_no,
         ue.full_name AS last_edited_by, cv.uploaded_at AS last_saved_at,
         (d.m365_live_item_id IS NOT NULL) AS in_sharepoint, d.edit_locked
    FROM hsdg.audit_acceptance_files f
    JOIN hsdg.documents d ON d.id = f.document_id
    LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
    LEFT JOIN hsdg.employees ue ON ue.id = cv.uploaded_by_employee_id`;

/**
 * Section 01 file cards (spec §2, §5.1, §6.2, §10).
 *
 * Every Section 01 document sits in a slot that points at an engagement
 * document — created from the firm's approved Word template with engagement
 * data merged in, added, or linked from what the engagement already holds
 * (never a copy). The card carries the slot's working status (Draft → Ready to
 * Send → Sent, Draft → Partner Review → Approved → Issued → Accepted …) and the
 * template version used, so history never changes. Approved work is locked
 * (documents.edit_locked) until the card is reopened with a reason, and the
 * whole section is read-only once the Engagement Partner approves it.
 */
@Injectable()
export class AuditAcceptanceFilesService {
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
  ): Promise<AcceptanceFilesView> {
    return this.db.withRlsContext(ctx, (client) =>
      this.readView(client, ctx, engagementId, workflowInstanceId),
    );
  }

  private async readView(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<AcceptanceFilesView> {
    await this.assertShell(client, engagementId, workflowInstanceId);
    const { rows } = await client.query<FileRow>(
      `${FILE_SELECT}
        WHERE f.workflow_instance_id = $1 AND d.deleted_at IS NULL
        ORDER BY f.created_at ASC`,
      [workflowInstanceId],
    );
    const master = await readEngagementMasterFacts(client, workflowInstanceId);
    const facts = master
      ? templateSelectionFacts(master)
      : { listed: false, entityTypeSlug: null, hasGroup: false };
    const templates: AcceptanceTemplateAvailability[] = [];
    for (const def of DOCUMENT_TEMPLATE_DEFINITIONS.filter((d) => d.section === '01')) {
      const resolved = await this.templates.resolveOn(client, def.templateKey, facts);
      templates.push({
        templateKey: def.templateKey,
        title: def.title,
        variantKey: resolved?.variantKey ?? null,
        versionNo: resolved?.versionNo ?? null,
        available: resolved !== null,
        reason: resolved
          ? null
          : `No approved DHVAJ template for “${def.title}” yet — an administrator must upload and approve one under Settings → Document templates.`,
      });
    }
    return {
      workflowInstanceId,
      sectionLocked: await this.isSectionLocked(client, workflowInstanceId),
      callerIsEngagementPartner: await this.isEngagementPartner(client, ctx, engagementId),
      m365Enabled: this.m365.enabled,
      files: rows.map(mapFile),
      templates,
    };
  }

  /** The file's version history (SharePoint's when it holds the file). */
  async versions(
    principal: Principal,
    engagementId: string,
    workflowInstanceId: string,
    fileId: string,
  ): Promise<FileVersionHistory> {
    const ctx = rlsContextFromPrincipal(principal);
    const file = await this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      return this.loadFile(client, workflowInstanceId, fileId);
    });
    return this.m365.versionHistory(principal, engagementId, file.document_id);
  }

  // ── Create from Template ────────────────────────────────────────────────

  async createFromTemplate(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { slotKey: string; variantKey?: string },
  ): Promise<AcceptanceFilesView> {
    const def = slotOf(input.slotKey);
    if (!def) throw new BadRequestException('Unknown file slot.');
    if (!def.templateKey) {
      throw new BadRequestException(
        `${def.title} is not created from a template; add or link the file.`,
      );
    }
    const templateKey = def.templateKey;
    const tdef = DOCUMENT_TEMPLATE_DEFINITIONS.find((t) => t.templateKey === templateKey)!;

    // 1. Resolve the approved template + gather the merge values.
    const prepared = await this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertEditable(client, workflowInstanceId);
      await this.assertSlotFree(client, workflowInstanceId, input.slotKey, def.multiple);
      const firm = await this.templates.readFirm(client);
      const mergeInput = await readMergeInput(client, workflowInstanceId, firm);
      if (!mergeInput) throw new NotFoundException('Engagement facts could not be read.');
      const resolved = await this.templates.resolveOn(
        client,
        templateKey,
        templateSelectionFacts(mergeInput.master),
        input.variantKey,
      );
      if (!resolved) {
        throw new BadRequestException(
          `No approved DHVAJ template for “${tdef.title}” yet — an administrator must upload and approve one under Settings → Document templates.`,
        );
      }
      return {
        resolved,
        values: buildMergeValues(mergeInput),
        clientName: mergeInput.master.legalName,
      };
    });

    // 2. Merge the engagement data into the template.
    const bytes = await this.templates.readBytes(prepared.resolved.reference);
    const merged = await mergeDocx(bytes, prepared.values, KNOWN_MERGE_FIELDS);
    const filename = tdef.filenamePattern
      .replace('{client}', prepared.clientName)
      .replace(/[\\/:*?"<>|]/g, '-');

    // 3. File it as an engagement document (audited, versioned) …
    const doc = await this.documents.create(ctx, engagementId, {
      title: filename.replace(/\.docx$/i, ''),
      filename,
      contentType: DOCX_CONTENT_TYPE,
      contentBase64: merged.buffer.toString('base64'),
      documentType: SLOT_DOCUMENT_TYPE[def.slot] ?? 'other',
      classification: 'confidential',
    });

    // 4. … and put it in the slot, remembering the exact template version.
    return this.db.withRlsContext(ctx, async (client) => {
      await this.insertFile(client, ctx, {
        workflowInstanceId,
        engagementId,
        slotKey: input.slotKey,
        documentId: doc.id,
        status: def.initialStatus,
        template: {
          versionId: prepared.resolved.versionId,
          key: templateKey,
          variantKey: prepared.resolved.variantKey,
          versionNo: prepared.resolved.versionNo,
        },
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.acceptance_file_created_from_template',
        objectType: 'document',
        objectId: doc.id,
        after: {
          slotKey: input.slotKey,
          templateKey,
          variantKey: prepared.resolved.variantKey,
          templateVersionNo: prepared.resolved.versionNo,
          missingFields: merged.missing,
          unknownFields: merged.unknown,
        },
      });
      return this.readView(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Add File / Link Existing File ───────────────────────────────────────

  async add(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: {
      slotKey: string;
      title?: string;
      filename: string;
      contentType?: string;
      contentBase64: string;
    },
  ): Promise<AcceptanceFilesView> {
    const def = slotOf(input.slotKey);
    if (!def) throw new BadRequestException('Unknown file slot.');
    await this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertEditable(client, workflowInstanceId);
      await this.assertSlotFree(client, workflowInstanceId, input.slotKey, def.multiple);
    });
    const doc = await this.documents.create(ctx, engagementId, {
      title: input.title?.trim() || input.filename.replace(/\.[^.]+$/, ''),
      filename: input.filename,
      contentType: input.contentType,
      contentBase64: input.contentBase64,
      documentType: SLOT_DOCUMENT_TYPE[def.slot] ?? 'evidence',
    });
    return this.db.withRlsContext(ctx, async (client) => {
      await this.insertFile(client, ctx, {
        workflowInstanceId,
        engagementId,
        slotKey: input.slotKey,
        documentId: doc.id,
        status: def.initialStatus,
        template: null,
      });
      return this.readView(client, ctx, engagementId, workflowInstanceId);
    });
  }

  async link(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { slotKey: string; documentId: string },
  ): Promise<AcceptanceFilesView> {
    const def = slotOf(input.slotKey);
    if (!def) throw new BadRequestException('Unknown file slot.');
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertEditable(client, workflowInstanceId);
      await this.assertSlotFree(client, workflowInstanceId, input.slotKey, def.multiple);
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.documents
          WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
        [input.documentId, engagementId],
      );
      if (!rows[0]) throw new BadRequestException('That document is not on this engagement.');
      await this.insertFile(client, ctx, {
        workflowInstanceId,
        engagementId,
        slotKey: input.slotKey,
        documentId: input.documentId,
        status: def.initialStatus,
        template: null,
      });
      return this.readView(client, ctx, engagementId, workflowInstanceId);
    });
  }

  /** Take a file out of its slot (the document stays on the engagement). */
  async unlink(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    fileId: string,
  ): Promise<AcceptanceFilesView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertEditable(client, workflowInstanceId);
      const file = await this.loadFile(client, workflowInstanceId, fileId);
      if (isLockedFileStatus(file.status)) {
        throw new ConflictException(
          `This file is ${ACCEPTANCE_FILE_STATUS_LABEL[file.status]}; reopen it before removing it.`,
        );
      }
      await client.query(`DELETE FROM hsdg.audit_acceptance_files WHERE id = $1`, [fileId]);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.acceptance_file_unlinked',
        objectType: 'document',
        objectId: file.document_id,
        before: { slotKey: file.slot_key, status: file.status },
      });
      return this.readView(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Status steps ────────────────────────────────────────────────────────

  async setStatus(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    fileId: string,
    input: { status: AcceptanceFileStatus; meta?: Record<string, string | null>; version: number },
  ): Promise<AcceptanceFilesView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertEditable(client, workflowInstanceId);
      const file = await this.loadFile(client, workflowInstanceId, fileId);
      const def = slotOf(file.slot_key);
      if (!def) throw new BadRequestException('Unknown file slot.');
      const meta = { ...file.meta, ...(input.meta ?? {}) };
      const isPartner = await this.isEngagementPartner(client, ctx, engagementId);
      const error = fileTransitionError(def, file.status, input.status, meta, isPartner);
      if (error) throw new BadRequestException(error);
      // A reopen reason belongs to that reopen only — it is logged, not kept.
      const kept = { ...meta };
      const reopenReason = kept.reopenReason ?? null;
      delete kept.reopenReason;

      const res = await client.query(
        `UPDATE hsdg.audit_acceptance_files
            SET status = $3, meta = $4::jsonb, version = version + 1
          WHERE id = $1 AND version = $2`,
        [fileId, input.version, input.status, JSON.stringify(kept)],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ConflictException('This file changed since you loaded it; refresh and retry.');
      }
      const locked = isLockedFileStatus(input.status);
      await client.query(
        `UPDATE hsdg.documents SET edit_locked = $2, edit_locked_reason = $3 WHERE id = $1`,
        [
          file.document_id,
          locked,
          locked
            ? `${def.title} is ${ACCEPTANCE_FILE_STATUS_LABEL[input.status]}; reopen it in Section 01 before editing.`
            : null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: reopenReason
          ? 'statutory_audit.acceptance_file_reopened'
          : 'statutory_audit.acceptance_file_status_changed',
        objectType: 'document',
        objectId: file.document_id,
        before: { slotKey: file.slot_key, status: file.status },
        after: { status: input.status, meta: kept, reopenReason },
      });
      return this.readView(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Section-level lock (used by partner approval / reopen) ──────────────

  /**
   * Lock (approval) or release (reopen) every Section 01 document. Releasing
   * keeps the files whose own status is still approved work locked.
   */
  async setSectionLockOn(
    client: PoolClient,
    workflowInstanceId: string,
    locked: boolean,
  ): Promise<void> {
    if (locked) {
      await client.query(
        `UPDATE hsdg.documents d
            SET edit_locked = true,
                edit_locked_reason = 'Section 01 is approved; reopen it before editing its documents.'
           FROM hsdg.audit_acceptance_files f
          WHERE f.document_id = d.id AND f.workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      return;
    }
    await client.query(
      `UPDATE hsdg.documents d
          SET edit_locked = false, edit_locked_reason = NULL
         FROM hsdg.audit_acceptance_files f
        WHERE f.document_id = d.id AND f.workflow_instance_id = $1
          AND f.status NOT IN ('final','partner_review','sent','approved','issued','accepted')`,
      [workflowInstanceId],
    );
  }

  /** Slot statuses for readiness (01.7 letter, 01.3 communication …). */
  async slotStatusesOn(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<Array<{ slotKey: string; status: AcceptanceFileStatus }>> {
    const { rows } = await client.query<{ slot_key: string; status: AcceptanceFileStatus }>(
      `SELECT slot_key, status FROM hsdg.audit_acceptance_files WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows.map((r) => ({ slotKey: r.slot_key, status: r.status }));
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async insertFile(
    client: PoolClient,
    ctx: RlsContext,
    f: {
      workflowInstanceId: string;
      engagementId: string;
      slotKey: string;
      documentId: string;
      status: AcceptanceFileStatus;
      template: { versionId: string; key: string; variantKey: string; versionNo: number } | null;
    },
  ): Promise<void> {
    try {
      await client.query(
        `INSERT INTO hsdg.audit_acceptance_files
           (workflow_instance_id, engagement_id, slot_key, document_id, status,
            template_version_id, template_key, template_variant_key, template_version_no,
            created_by_employee_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          f.workflowInstanceId,
          f.engagementId,
          f.slotKey,
          f.documentId,
          f.status,
          f.template?.versionId ?? null,
          f.template?.key ?? null,
          f.template?.variantKey ?? null,
          f.template?.versionNo ?? null,
          ctx.employeeId ?? null,
        ],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('That file is already in this slot.');
      }
      throw err;
    }
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.acceptance_file_added',
      objectType: 'document',
      objectId: f.documentId,
      after: { slotKey: f.slotKey, status: f.status },
    });
  }

  private async loadFile(
    client: PoolClient,
    workflowInstanceId: string,
    fileId: string,
  ): Promise<{
    slot_key: string;
    document_id: string;
    status: AcceptanceFileStatus;
    meta: Record<string, string | null>;
  }> {
    const { rows } = await client.query<{
      slot_key: string;
      document_id: string;
      status: AcceptanceFileStatus;
      meta: Record<string, string | null>;
    }>(
      `SELECT slot_key, document_id, status, meta FROM hsdg.audit_acceptance_files
        WHERE id = $1 AND workflow_instance_id = $2`,
      [fileId, workflowInstanceId],
    );
    if (!rows[0]) throw new NotFoundException('File not found in Section 01.');
    return rows[0];
  }

  private async assertSlotFree(
    client: PoolClient,
    workflowInstanceId: string,
    slotKey: string,
    multiple: boolean,
  ): Promise<void> {
    if (multiple) return;
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_acceptance_files WHERE workflow_instance_id = $1 AND slot_key = $2`,
      [workflowInstanceId, slotKey],
    );
    if (rows[0]) {
      throw new ConflictException('This document already exists — open it from its card.');
    }
  }

  async isSectionLocked(client: PoolClient, workflowInstanceId: string): Promise<boolean> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_acceptance_approvals
        WHERE workflow_instance_id = $1 AND conclusion IN ${APPROVING} AND reopened_at IS NULL
        LIMIT 1`,
      [workflowInstanceId],
    );
    return rows.length > 0;
  }

  private async assertEditable(client: PoolClient, workflowInstanceId: string): Promise<void> {
    if (await this.isSectionLocked(client, workflowInstanceId)) {
      throw new ConflictException(
        'Section 01 is approved; the Engagement Partner must reopen it before its documents change.',
      );
    }
  }

  async isEngagementPartner(
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

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances
        WHERE id = $1 AND engagement_id = $2 AND status <> 'cancelled'`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    }
  }
}

function mapFile(r: FileRow): AcceptanceFileRecord {
  return {
    id: r.id,
    slotKey: r.slot_key,
    documentId: r.document_id,
    title: r.title,
    filename: r.current_filename,
    status: r.status,
    meta: r.meta ?? {},
    templateKey: r.template_key,
    templateVariantKey: r.template_variant_key,
    templateVersionNo: r.template_version_no,
    currentVersionNo: r.current_version_no,
    lastEditedBy: r.last_edited_by,
    lastSavedAt: r.last_saved_at ? r.last_saved_at.toISOString() : null,
    inSharePoint: r.in_sharepoint,
    editLocked: r.edit_locked,
    version: r.version,
  };
}
