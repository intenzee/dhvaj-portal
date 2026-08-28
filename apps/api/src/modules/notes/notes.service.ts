import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { EngagementNote } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { translatePgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';

interface NoteRow {
  id: string;
  engagement_id: string;
  engagement_service_id: string | null;
  engagement_component_id: string | null;
  author_employee_id: string | null;
  author_name: string | null;
  body: string;
  is_pinned: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateNoteInput {
  body: string;
  engagementServiceId?: string | null;
  engagementComponentId?: string | null;
  isPinned?: boolean;
}

export interface UpdateNoteInput {
  body?: string;
  isPinned?: boolean;
  version?: number;
}

export interface NoteFilter {
  engagementServiceId?: string;
  engagementComponentId?: string;
}

const NOTE_BASE = `
  SELECT n.id, n.engagement_id, n.engagement_service_id, n.engagement_component_id,
         n.author_employee_id, e.full_name AS author_name,
         n.body, n.is_pinned, n.version, n.created_at, n.updated_at
  FROM hsdg.engagement_notes n
  LEFT JOIN hsdg.employees e ON e.id = n.author_employee_id`;

/**
 * Engagement Notes (spec §26). A shared notebook: any team MEMBER may read and
 * add; a note is editable/removable only by its AUTHOR or an engagement LEAD —
 * enforced by RLS, so this service does not re-check authorship. Pinned notes
 * sort to the top.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RlsContext, engagementId: string, filter: NoteFilter): Promise<EngagementNote[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertEngagementVisible(client, engagementId);
      const params: unknown[] = [engagementId];
      const conds = ['n.engagement_id = $1'];
      if (filter.engagementServiceId) {
        params.push(filter.engagementServiceId);
        conds.push(`n.engagement_service_id = $${params.length}`);
      }
      if (filter.engagementComponentId) {
        params.push(filter.engagementComponentId);
        conds.push(`n.engagement_component_id = $${params.length}`);
      }
      const { rows } = await client.query<NoteRow>(
        `${NOTE_BASE} WHERE ${conds.join(' AND ')}
         ORDER BY n.is_pinned DESC, n.created_at DESC`,
        params,
      );
      return rows.map(mapNote);
    });
  }

  async create(
    ctx: RlsContext,
    engagementId: string,
    input: CreateNoteInput,
  ): Promise<EngagementNote> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertEngagementVisible(client, engagementId);
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_notes
             (engagement_id, engagement_service_id, engagement_component_id, author_employee_id,
              body, is_pinned)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6, false))
           RETURNING id`,
          [
            engagementId,
            input.engagementServiceId ?? null,
            input.engagementComponentId ?? null,
            ctx.employeeId ?? null,
            input.body,
            input.isPinned ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateNoteError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'note.created',
        objectType: 'engagement_note',
        objectId: id,
        after: { engagementId },
      });
      return (await this.selectOne(client, id))!;
    });
  }

  async update(
    ctx: RlsContext,
    engagementId: string,
    noteId: string,
    input: UpdateNoteInput,
  ): Promise<EngagementNote> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.selectOneForEngagement(client, engagementId, noteId);
      const sets: string[] = [];
      const params: unknown[] = [];
      if (input.body !== undefined) {
        params.push(input.body);
        sets.push(`body = $${params.length}`);
      }
      if (input.isPinned !== undefined) {
        params.push(input.isPinned);
        sets.push(`is_pinned = $${params.length}`);
      }
      if (sets.length === 0) return current;
      params.push(noteId);
      const idIdx = params.length;
      params.push(engagementId);
      const engIdx = params.length;
      let versionGuard = '';
      if (input.version !== undefined) {
        params.push(input.version);
        versionGuard = ` AND version = $${params.length}`;
      }
      const result = await client.query(
        `UPDATE hsdg.engagement_notes SET ${sets.join(', ')}, version = version + 1
         WHERE id = $${idIdx} AND engagement_id = $${engIdx}${versionGuard}`,
        params,
      );
      if ((result.rowCount ?? 0) === 0) {
        // RLS write-denial (not author/lead) or a stale version.
        throw new NotFoundException('Note not found, not yours to edit, or modified concurrently.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'note.updated',
        objectType: 'engagement_note',
        objectId: noteId,
        after: { fields: sets.map((s) => s.split(' = ')[0]) },
      });
      return (await this.selectOne(client, noteId))!;
    });
  }

  async remove(ctx: RlsContext, engagementId: string, noteId: string): Promise<void> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.selectOneForEngagement(client, engagementId, noteId);
      const result = await client.query(
        `DELETE FROM hsdg.engagement_notes WHERE id = $1 AND engagement_id = $2`,
        [noteId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('Note not found or not yours to remove.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'note.removed',
        objectType: 'engagement_note',
        objectId: noteId,
        before: { engagementId },
      });
    });
  }

  private async selectOne(client: PoolClient, id: string): Promise<EngagementNote | null> {
    const { rows } = await client.query<NoteRow>(`${NOTE_BASE} WHERE n.id = $1`, [id]);
    return rows[0] ? mapNote(rows[0]) : null;
  }

  private async selectOneForEngagement(
    client: PoolClient,
    engagementId: string,
    noteId: string,
  ): Promise<EngagementNote> {
    const { rows } = await client.query<NoteRow>(
      `${NOTE_BASE} WHERE n.id = $1 AND n.engagement_id = $2`,
      [noteId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Note not found.');
    return mapNote(rows[0]);
  }

  private async assertEngagementVisible(client: PoolClient, engagementId: string): Promise<void> {
    const { rows } = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
      engagementId,
    ]);
    if (!rows[0]) throw new NotFoundException('Engagement not found.');
  }
}

function mapNote(row: NoteRow): EngagementNote {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    engagementServiceId: row.engagement_service_id,
    engagementComponentId: row.engagement_component_id,
    authorEmployeeId: row.author_employee_id,
    authorName: row.author_name,
    body: row.body,
    isPinned: row.is_pinned,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function translateNoteError(err: unknown): Error {
  return translatePgError(err, {
    foreignKey: 'A referenced record does not exist.',
    check: 'A note must have a non-empty body.',
    forbidden: 'Not permitted to write this note.',
  });
}
