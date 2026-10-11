import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  DOCUMENT_TEMPLATE_KEY,
  NOTIFICATION_TYPE,
  templateDefinition,
  type ConfirmFrameworkImpactInput,
  type CreateFrameworkMemorandumInput,
  type FileVersionHistory,
  type FrameworkImpactView,
  type FrameworkMemoCard,
  type FrameworkMemoHistoryItem,
  type FrameworkMemorandumCreated,
  type FrameworkSummaryMatter,
  type ReturnFrameworkMatterInput,
  type UpdateFrameworkMatterInput,
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
import { AuditFrameworkSummaryService } from './audit-framework-summary.service';
import { confirmImpactOn, readImpactOn, readSupersededWorkOn } from './framework-summary-impact';
import { readFrameworkMattersOn } from './framework-summary-matters';
import { readFrameworkMemoHistoryOn, readFrameworkMemoOn } from './framework-summary-memo';
import {
  frameworkMemorandumValues,
  readFrameworkMemoDetailsOn,
} from './framework-summary-memo-values';
import { readSnapshotFactsOn } from './framework-summary-prior-year';
import { isEngagementLead } from './master-facts';

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEMPLATE_KEY = DOCUMENT_TEMPLATE_KEY.auditFrameworkMemorandum;
const NO_TEMPLATE =
  'No approved DHVAJ template for the Audit Framework Memorandum yet — an administrator must upload and approve one under Settings → Document templates.';

interface CurrentBaseline {
  id: string;
  version: string;
  status: string;
  reopened_from_version: string | null;
}

/**
 * 02.8 Track B records (spec v1.0 §7, §10–§11, §15–§17): the matter actions,
 * the Audit Framework Memorandum lifecycle (create from the approved DHVAJ
 * template into the engagement SharePoint workspace → Microsoft 365 → submit)
 * and the professional confirmation of a revision's change impact. AF-02
 * approval / return and the reopen run in AuditFrameworkSummaryService, which
 * calls the DI-free hooks (controlFrameworkMemoOn, onFrameworkReopenedOn …).
 */
@Injectable()
export class AuditFrameworkRecordsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly m365: M365Service,
    private readonly templates: DocumentTemplatesService,
    private readonly summary: AuditFrameworkSummaryService,
  ) {}

  // ── Audit Framework Memorandum (§10–§11) ──────────────────────────────────

  async memoHistory(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<FrameworkMemoHistoryItem[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      return readFrameworkMemoHistoryOn(client, workflowInstanceId);
    });
  }

  async createMemo(
    principal: Principal,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateFrameworkMemorandumInput,
  ): Promise<FrameworkMemorandumCreated> {
    const ctx = rlsContextFromPrincipal(principal);
    const tdef = templateDefinition(TEMPLATE_KEY)!;

    // 1. Only after AF-01 (canCreateMemo), and once per baseline version.
    const baseline = await this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertLead(client, engagementId);
      const b = await this.current(client, workflowInstanceId);
      assertMemoCreatable(b);
      await this.assertNoMemo(client, b!);
      return b!;
    });

    // 2. The summary as the reviewers see it, merged into the approved template.
    const summary = (await this.summary.listForEngagement(ctx, engagementId)).find(
      (s) => s.workflowInstanceId === workflowInstanceId,
    );
    if (!summary)
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    const prepared = await this.db.withRlsContext(ctx, async (client) => {
      const firm = await this.templates.readFirm(client);
      const mergeInput = await readMergeInput(client, workflowInstanceId, firm);
      if (!mergeInput) throw new NotFoundException('Engagement facts could not be read.');
      const resolved = await this.templates.resolveOn(
        client,
        TEMPLATE_KEY,
        templateSelectionFacts(mergeInput.master),
        input.variantKey,
      );
      if (!resolved) throw new BadRequestException(NO_TEMPLATE);
      const details = await readFrameworkMemoDetailsOn(client, workflowInstanceId);
      const facts = await readSnapshotFactsOn(client, workflowInstanceId);
      return {
        resolved,
        values: {
          ...buildMergeValues(mergeInput),
          ...frameworkMemorandumValues(summary, details, facts),
        },
        clientName: mergeInput.master.legalName,
      };
    });
    const bytes = await this.templates.readBytes(prepared.resolved.reference);
    const merged = await mergeDocx(bytes, prepared.values, KNOWN_MERGE_FIELDS);
    const filename = tdef.filenamePattern
      .replace('{version}', baseline.version)
      .replace('{client}', prepared.clientName)
      .replace(/[\\/:*?"<>|]/g, '-');

    // 3. Filed directly in the engagement workspace (SharePoint when Microsoft 365 is on).
    const doc = await this.documents.create(ctx, engagementId, {
      title: filename.replace(/\.docx$/i, ''),
      filename,
      contentType: DOCX_CONTENT_TYPE,
      contentBase64: merged.buffer.toString('base64'),
      documentType: 'working_paper',
      classification: 'confidential',
    });

    // 4. Bound to the baseline version, remembering the exact template version.
    const { memo, memoId } = await this.db.withRlsContext(ctx, async (client) => {
      await this.lockBaseline(client, workflowInstanceId);
      const b = await this.current(client, workflowInstanceId);
      if (!b || b.id !== baseline.id)
        throw new ConflictException('The framework baseline changed; refresh and retry.');
      assertMemoCreatable(b);
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_framework_memo
             (baseline_id, workflow_instance_id, engagement_id, baseline_version, document_id,
              template_version_id, template_variant_key, template_version_no, missing_fields,
              prepared_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10)
           RETURNING id`,
          [
            b.id,
            workflowInstanceId,
            engagementId,
            b.version,
            doc.id,
            prepared.resolved.versionId,
            prepared.resolved.variantKey,
            prepared.resolved.versionNo,
            merged.missing,
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw memoExists(b.version);
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_memo_created',
        objectType: 'audit_framework_baseline',
        objectId: b.id,
        after: {
          documentId: doc.id,
          version: b.version,
          templateVersionNo: prepared.resolved.versionNo,
          missingFields: merged.missing,
        },
      });
      return { memo: (await readFrameworkMemoOn(client, workflowInstanceId, b.id))!, memoId: id };
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
    return { memo, memoId, editorUrl, missingFields: merged.missing };
  }

  /** Submit for Review (§11): the memo AF-02 approves becomes `submitted`. */
  async submitMemo(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    memoId: string,
  ): Promise<FrameworkMemoCard> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertLead(client, engagementId);
      await this.lockBaseline(client, workflowInstanceId);
      const b = await this.current(client, workflowInstanceId);
      const memo = await this.loadMemo(client, workflowInstanceId, memoId);
      if (!b || memo.baseline_id !== b.id)
        throw new ConflictException(
          'This memorandum belongs to a superseded framework version — create the memorandum of the current revision.',
        );
      if (b.status !== 'manager_confirmed')
        throw new BadRequestException(
          'Submit the memorandum after the Manager confirmation (AF-01).',
        );
      if (memo.status !== 'draft')
        throw new ConflictException(`The memorandum is already ${memo.status.replace(/_/g, ' ')}.`);
      await client.query(
        `UPDATE hsdg.audit_framework_memo m
            SET status = 'submitted', submitted_at = now(), submitted_by_employee_id = $2,
                submitted_version_no = d.current_version_no, version = m.version + 1
           FROM hsdg.documents d
          WHERE m.id = $1 AND d.id = m.document_id`,
        [memoId, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_memo_submitted',
        objectType: 'audit_framework_baseline',
        objectId: b.id,
        after: { memoId, version: b.version },
      });
      return (await readFrameworkMemoOn(client, workflowInstanceId, b.id))!;
    });
  }

  /** The memo file's version history (SharePoint's when it holds the file). */
  async memoVersions(
    principal: Principal,
    engagementId: string,
    workflowInstanceId: string,
    memoId: string,
  ): Promise<FileVersionHistory> {
    const ctx = rlsContextFromPrincipal(principal);
    const documentId = await this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      return (await this.loadMemo(client, workflowInstanceId, memoId)).document_id;
    });
    return this.m365.versionHistory(principal, engagementId, documentId);
  }

  // ── Framework Matters (§7) ────────────────────────────────────────────────

  async updateMatter(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    matterId: string,
    input: UpdateFrameworkMatterInput,
  ): Promise<FrameworkSummaryMatter> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertLead(client, engagementId);
      const before = await this.loadMatter(client, workflowInstanceId, matterId);
      const has = (k: keyof UpdateFrameworkMatterInput) =>
        Object.prototype.hasOwnProperty.call(input, k);
      await client.query(
        `UPDATE hsdg.audit_matter
            SET partner_attention = CASE WHEN $2 THEN $3 ELSE partner_attention END,
                impact = CASE WHEN $4 THEN NULLIF(trim($5), '') ELSE impact END,
                resolution = CASE WHEN $6 THEN NULLIF(trim($7), '') ELSE resolution END,
                owner_employee_id = CASE WHEN $8 THEN $9::uuid ELSE owner_employee_id END,
                due_date = CASE WHEN $10 THEN $11::date ELSE due_date END,
                version = version + 1
          WHERE id = $1`,
        [
          matterId,
          has('partnerAttention'),
          input.partnerAttention ?? false,
          has('impact'),
          input.impact ?? null,
          has('resolution'),
          input.resolution ?? null,
          has('ownerEmployeeId'),
          input.ownerEmployeeId ?? null,
          has('dueDate'),
          input.dueDate ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_matter_updated',
        objectType: 'audit_matter',
        objectId: matterId,
        before,
        after: input as Record<string, unknown>,
      });
      return this.matter(client, workflowInstanceId, matterId);
    });
  }

  /** Return to source section: re-assign the SAME matter and set it Under Review (§7). */
  async returnMatter(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    matterId: string,
    input: ReturnFrameworkMatterInput,
  ): Promise<FrameworkSummaryMatter> {
    const note = input.note?.trim();
    if (!note) throw new BadRequestException('Say what the source section must do.');
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertLead(client, engagementId);
      const before = await this.loadMatter(client, workflowInstanceId, matterId);
      if (before.status === 'resolved' || before.status === 'accepted_with_approval')
        throw new ConflictException('A closed matter cannot be returned — it is already resolved.');
      const { rows } = await client.query<{ owner_employee_id: string | null; title: string }>(
        `UPDATE hsdg.audit_matter
            SET status = CASE WHEN status = 'blocking' THEN status ELSE 'under_review' END,
                owner_employee_id = COALESCE($2::uuid, owner_employee_id),
                returned_at = now(), returned_by_employee_id = $3, return_note = $4,
                version = version + 1
          WHERE id = $1
          RETURNING owner_employee_id, title`,
        [matterId, input.ownerEmployeeId ?? null, ctx.employeeId ?? null, note],
      );
      const owner = rows[0]?.owner_employee_id ?? null;
      if (owner)
        await client.query(`SELECT hsdg.emit_notification($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
          owner,
          NOTIFICATION_TYPE.taskAssigned,
          'Framework matter returned to you',
          `${rows[0]!.title} — ${note}`,
          engagementId,
          'audit_matter',
          matterId,
          `framework_matter_return:${matterId}:${Date.now()}`,
          null,
        ]);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_matter_returned',
        objectType: 'audit_matter',
        objectId: matterId,
        before,
        after: { ownerEmployeeId: owner, note },
      });
      return this.matter(client, workflowInstanceId, matterId);
    });
  }

  // ── Change impact (§15–§17) ───────────────────────────────────────────────

  async impact(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<FrameworkImpactView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      return this.impactView(client, workflowInstanceId);
    });
  }

  async confirmImpact(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ConfirmFrameworkImpactInput,
  ): Promise<FrameworkImpactView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertLead(client, engagementId);
      await this.lockBaseline(client, workflowInstanceId);
      const b = await this.current(client, workflowInstanceId);
      if (!b?.reopened_from_version)
        throw new BadRequestException(
          'Only a reopened framework revision has an impact analysis to confirm.',
        );
      if (b.status !== 'draft')
        throw new ConflictException(
          'The impact analysis is confirmed before the Manager review (AF-01).',
        );
      const analysis = await confirmImpactOn(
        client,
        ctx,
        workflowInstanceId,
        engagementId,
        b.id,
        input.note ?? null,
      );
      if (!analysis)
        throw new BadRequestException('The superseded approved baseline could not be read.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_impact_confirmed',
        objectType: 'audit_framework_baseline',
        objectId: b.id,
        after: { version: b.version, items: analysis.items.length, note: input.note ?? null },
      });
      return this.impactView(client, workflowInstanceId);
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async impactView(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<FrameworkImpactView> {
    const b = await this.current(client, workflowInstanceId);
    const analysis = await readImpactOn(client, workflowInstanceId, b?.id ?? null);
    let supersededWork: FrameworkImpactView['supersededWork'] = [];
    if (b?.reopened_from_version) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.audit_framework_baseline
          WHERE workflow_instance_id = $1 AND version = $2`,
        [workflowInstanceId, b.reopened_from_version],
      );
      if (rows[0]) supersededWork = await readSupersededWorkOn(client, rows[0].id);
    }
    return { analysis, supersededWork };
  }

  private async matter(client: PoolClient, workflowInstanceId: string, matterId: string) {
    const m = (await readFrameworkMattersOn(client, workflowInstanceId)).find(
      (x) => x.id === matterId,
    );
    if (!m) throw new NotFoundException('Framework matter not found.');
    return m;
  }

  private async loadMatter(client: PoolClient, workflowInstanceId: string, matterId: string) {
    const { rows } = await client.query<{
      status: string;
      impact: string | null;
      partner_attention: boolean;
      resolution: string | null;
      owner_employee_id: string | null;
      due_date: string | null;
    }>(
      `SELECT status, impact, partner_attention, resolution, owner_employee_id,
              due_date::text AS due_date
         FROM hsdg.audit_matter
        WHERE id = $1 AND workflow_instance_id = $2 AND section = 'framework'`,
      [matterId, workflowInstanceId],
    );
    if (!rows[0]) throw new NotFoundException('Framework matter not found.');
    return rows[0];
  }

  private async loadMemo(client: PoolClient, workflowInstanceId: string, memoId: string) {
    const { rows } = await client.query<{
      baseline_id: string;
      document_id: string;
      status: string;
    }>(
      `SELECT baseline_id, document_id, status FROM hsdg.audit_framework_memo
        WHERE id = $1 AND workflow_instance_id = $2`,
      [memoId, workflowInstanceId],
    );
    if (!rows[0]) throw new NotFoundException('Audit Framework Memorandum not found.');
    return rows[0];
  }

  private async assertNoMemo(client: PoolClient, b: CurrentBaseline): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_framework_memo WHERE baseline_id = $1`,
      [b.id],
    );
    if (rows[0]) throw memoExists(b.version);
  }

  private async current(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<CurrentBaseline | null> {
    const { rows } = await client.query<CurrentBaseline>(
      `SELECT id, version, status, reopened_from_version FROM hsdg.audit_framework_baseline
        WHERE workflow_instance_id = $1 AND status <> 'superseded'
        ORDER BY created_at DESC LIMIT 1`,
      [workflowInstanceId],
    );
    return rows[0] ?? null;
  }

  private async lockBaseline(client: PoolClient, workflowInstanceId: string): Promise<void> {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('audit_framework_baseline:' || $1))`,
      [workflowInstanceId],
    );
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
    if (rows.length === 0)
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
  }

  private async assertLead(client: PoolClient, engagementId: string): Promise<void> {
    if (!(await isEngagementLead(client, engagementId)))
      throw new ForbiddenException('Only an engagement lead can change the framework records.');
  }
}

function assertMemoCreatable(b: CurrentBaseline | null): void {
  if (!b || b.status !== 'manager_confirmed')
    throw new BadRequestException(
      b?.status === 'approved'
        ? 'The approved memorandum is controlled — reopen the framework to create a revision.'
        : 'Create the Audit Framework Memorandum after the Manager confirmation (AF-01).',
    );
}

function memoExists(version: string): ConflictException {
  return new ConflictException(
    `The Audit Framework Memorandum for v${version} already exists — open it from the file card. A later revision creates a new memorandum.`,
  );
}
