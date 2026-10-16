import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { NoticeIntakeClientMatch, NoticeIntakeResponse } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { extractNoticeFields, type NoticeExtractedFields } from '../notices/notice-extract';

type OcrState = NoticeIntakeResponse['ocrStatus'];

/** documents.ocr_status → the intake's view of it. Exported for tests. */
export function intakeOcrStatus(status: string): OcrState {
  switch (status) {
    case 'pending':
    case 'done':
    case 'failed':
      return status;
    // 'skipped' (a file type OCR cannot read) and 'disabled' (DOC_AI off): no text will come.
    default:
      return 'not_applicable';
  }
}

/** Engagement statuses a notice can no longer be worked under. */
const ENGAGEMENT_DONE = ['completed', 'closed', 'declined', 'withdrawn', 'cancelled'];

@Injectable()
export class NoticeIntakeService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The suggestions for one uploaded notice. Everything runs under the
   * caller's RLS context: a document on an engagement they are not on is 404,
   * and only clients / engagements they can see are offered.
   */
  async suggest(ctx: RlsContext, documentId: string): Promise<NoticeIntakeResponse> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ ocr_status: string; extracted_text: string | null }>(
        `SELECT ocr_status, extracted_text FROM hsdg.documents
          WHERE id = $1 AND deleted_at IS NULL`,
        [documentId],
      );
      const doc = rows[0];
      if (!doc) throw new NotFoundException('Document not found.');
      const ocrStatus = intakeOcrStatus(doc.ocr_status);
      if (ocrStatus !== 'done') {
        return { documentId, ocrStatus, fields: {}, noticeTypeCode: null, clients: [] };
      }
      const { fields, noticeTypeCode } = extractNoticeFields(doc.extracted_text);
      return {
        documentId,
        ocrStatus,
        fields,
        noticeTypeCode,
        clients: await this.matchClients(client, fields),
      };
    });
  }

  /** Clients whose GSTIN or PAN is on the notice — GSTIN matches first. */
  private async matchClients(
    client: PoolClient,
    fields: NoticeExtractedFields,
  ): Promise<NoticeIntakeClientMatch[]> {
    const gstin = fields.gstin?.value ?? null;
    const pans = [
      ...new Set([fields.pan?.value, gstin?.slice(2, 12)].filter((p): p is string => !!p)),
    ];
    if (!gstin && pans.length === 0) return [];

    const { rows } = await client.query<{
      entity_id: string;
      entity_name: string;
      matched_on: 'gstin' | 'pan';
      registration_id: string | null;
    }>(
      `SELECT DISTINCT ON (m.entity_id) m.entity_id, e.legal_name AS entity_name,
              m.matched_on, m.registration_id
         FROM (
           SELECT r.entity_id, 'gstin'::text AS matched_on, r.id AS registration_id, 0 AS rank
             FROM hsdg.entity_registrations r
            WHERE $1::text IS NOT NULL AND r.registration_type = 'gstin'
              AND upper(trim(r.registration_number)) = $1
           UNION ALL
           SELECT e.id, 'pan', NULL, 1
             FROM hsdg.entities e
            WHERE e.pan = ANY($2::text[])
         ) m
         JOIN hsdg.entities e ON e.id = m.entity_id
        WHERE e.status <> 'archived'
        ORDER BY m.entity_id, m.rank`,
      [gstin, pans],
    );
    if (rows.length === 0) return [];

    const engagements = await client.query<{
      id: string;
      entity_id: string;
      engagement_code: string;
      service_name: string;
      financial_year: string;
      period_label: string;
    }>(
      `SELECT g.id, g.entity_id, g.engagement_code, s.name AS service_name,
              g.financial_year, g.period_label
         FROM hsdg.engagements g
         JOIN hsdg.services s ON s.id = g.service_id
        WHERE g.entity_id = ANY($1::uuid[])
          AND g.status <> ALL($2::text[])
          AND g.kind IS DISTINCT FROM 'statutory_audit'
        ORDER BY g.financial_year DESC, g.engagement_code`,
      [rows.map((r) => r.entity_id), ENGAGEMENT_DONE],
    );
    const byEntity = new Map<string, NoticeIntakeClientMatch['engagements']>();
    for (const g of engagements.rows) {
      const list = byEntity.get(g.entity_id) ?? [];
      const period = g.period_label === 'FY' ? '' : ` · ${g.period_label}`;
      list.push({
        id: g.id,
        code: g.engagement_code,
        name: `${g.service_name} · FY ${g.financial_year}${period}`,
      });
      byEntity.set(g.entity_id, list);
    }

    return rows
      .map((r) => ({
        entityId: r.entity_id,
        entityName: r.entity_name,
        matchedOn: r.matched_on,
        registrationId: r.registration_id,
        engagements: byEntity.get(r.entity_id) ?? [],
      }))
      .sort(
        (a, b) =>
          (a.matchedOn === 'gstin' ? 0 : 1) - (b.matchedOn === 'gstin' ? 0 : 1) ||
          a.entityName.localeCompare(b.entityName),
      );
  }
}
