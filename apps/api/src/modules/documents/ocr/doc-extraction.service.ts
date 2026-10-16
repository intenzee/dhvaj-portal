import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { AppConfigService } from '../../../config/config.module';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage-provider';
import { DocIntelligenceClient } from './doc-intelligence.client';
import { pdfTextLayer } from './pdf-text';

/**
 * Document types read locally from the PDF's text layer when Document
 * Intelligence is off (PS-104): a notice's own papers, which the department
 * issues as digital PDFs, so intake can pre-fill the notice form.
 */
const TEXT_LAYER_TYPES = new Set(['notice', 'reply', 'order']);

/** File extensions Azure Document Intelligence can read (text + fields). */
const OCR_SUPPORTED_EXT = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'tif',
  'tiff',
  'bmp',
  'heif',
  'docx',
  'xlsx',
  'pptx',
  'html',
]);

/**
 * Extracts a document's text (and key fields) via Azure Document Intelligence so
 * the portal can full-text search contents and pre-fill fields. Best-effort and
 * off by default (DOC_AI_ENABLED + a configured client); without it a notice's
 * PDFs are still read from their text layer (pdf-text.ts). Every path records an
 * `ocr_status` and NEVER throws to its caller, so an extraction problem can't
 * break an upload. Reads bytes straight from storage (not the audited download)
 * to avoid polluting the audit trail with machine reads.
 */
@Injectable()
export class DocExtractionService {
  private readonly logger = new Logger(DocExtractionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
    private readonly client: DocIntelligenceClient,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  get enabled(): boolean {
    return this.config.get('DOC_AI_ENABLED') && this.client.configured;
  }

  private extOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  }

  /**
   * Extract text for one document's current version and store it. Sets
   * `ocr_status` to disabled/skipped/done/failed as appropriate. Safe to call
   * fire-and-forget after an upload.
   */
  async extractForDocument(
    ctx: RlsContext,
    engagementId: string,
    documentId: string,
  ): Promise<void> {
    try {
      const current = await this.db.withRlsContext(ctx, async (client) => {
        const { rows } = await client.query<{
          storage_reference: string;
          filename: string;
          content_type: string;
          document_type: string;
        }>(
          `SELECT v.storage_reference, v.filename, v.content_type, d.document_type
             FROM hsdg.documents d
             JOIN hsdg.document_versions v ON v.id = d.current_version_id
            WHERE d.id = $1 AND d.engagement_id = $2`,
          [documentId, engagementId],
        );
        return rows[0] ?? null;
      });
      if (!current) return; // document/version gone or not visible — nothing to do
      if (!this.enabled) {
        const text =
          TEXT_LAYER_TYPES.has(current.document_type) && this.extOf(current.filename) === 'pdf'
            ? await pdfTextLayer(await this.storage.read(current.storage_reference))
            : null;
        if (text === null) await this.setStatus(ctx, engagementId, documentId, 'disabled');
        else await this.store(ctx, engagementId, documentId, text, deriveHints(text));
        return;
      }
      if (!OCR_SUPPORTED_EXT.has(this.extOf(current.filename))) {
        await this.setStatus(ctx, engagementId, documentId, 'skipped');
        return;
      }

      const bytes = await this.storage.read(current.storage_reference);
      const { text, fields } = await this.client.analyze(bytes, current.content_type);
      await this.store(ctx, engagementId, documentId, text, { ...fields, ...deriveHints(text) });
    } catch (err) {
      this.logger.warn(`Text extraction failed for document ${documentId}: ${String(err)}`);
      await this.setStatus(ctx, engagementId, documentId, 'failed').catch(() => undefined);
    }
  }

  private async store(
    ctx: RlsContext,
    engagementId: string,
    documentId: string,
    text: string,
    fields: object,
  ): Promise<void> {
    await this.db.withRlsContext(ctx, async (client) => {
      await client.query(
        `UPDATE hsdg.documents
           SET extracted_text = $1, extracted_fields = $2::jsonb,
               extracted_at = now(), ocr_status = 'done', version = version + 1
         WHERE id = $3 AND engagement_id = $4`,
        [text.slice(0, 1_000_000), JSON.stringify(fields), documentId, engagementId],
      );
    });
  }

  private async setStatus(
    ctx: RlsContext,
    engagementId: string,
    documentId: string,
    status: 'disabled' | 'skipped' | 'failed',
  ): Promise<void> {
    await this.db.withRlsContext(ctx, async (client) => {
      await client.query(
        `UPDATE hsdg.documents SET ocr_status = $1 WHERE id = $2 AND engagement_id = $3`,
        [status, documentId, engagementId],
      );
    });
  }
}

/**
 * Cheap heuristics over the extracted text — a suggested document type and a few
 * India-tax key fields (GSTIN, PAN). Real classification lives in the extractor's
 * key-value pairs; these just help pre-fill when they are absent.
 */
function deriveHints(text: string): Record<string, string> {
  const hints: Record<string, string> = {};
  const gstin = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b/.exec(text);
  if (gstin) hints.gstin = gstin[0];
  const pan = /\b[A-Z]{5}\d{4}[A-Z]\b/.exec(text);
  if (pan) hints.pan = pan[0];
  const upper = text.toUpperCase();
  if (upper.includes('GSTR') || upper.includes('ITR') || upper.includes('ACKNOWLEDGEMENT')) {
    hints.__suggestedType = upper.includes('ACKNOWLEDGEMENT') ? 'acknowledgement' : 'filing';
  }
  return hints;
}
