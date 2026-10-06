import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  describeAuditChange,
  type AuditChangeCount,
  type AuditUndoResult,
  type AuditUndoStatus,
  type AuditUndoStep,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

interface RawStep {
  id: string;
  label: string | null;
  at: string;
  changes: AuditChangeCount[];
}

type Direction = 'undo' | 'redo';

/** SQLSTATE raised by hsdg.audit_undo_apply_row when a row moved on since. */
const CHANGED_SINCE = 'HU409';
/** SQLSTATE raised when the file is signed off or archived (final). */
const SIGNED_OFF = 'HU423';

function toStep(raw: RawStep | null): AuditUndoStep | null {
  if (!raw) return null;
  return {
    id: raw.id,
    description: describeAuditChange(raw.label, raw.changes),
    at: raw.at,
    changes: raw.changes,
  };
}

/**
 * Audit file undo / redo. Every mutating request is one change set (recorded
 * by the database trigger from migration 1765600000000); this replays the
 * caller's own latest change set backwards (undo) or forwards (redo). The
 * replay is all-or-nothing and refuses when anyone has changed the same rows
 * since — it never overwrites someone else's work.
 */
@Injectable()
export class AuditUndoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  status(ctx: RlsContext, engagementId: string): Promise<AuditUndoStatus> {
    return this.db.withRlsContext(ctx, (client) => this.statusWith(client, engagementId));
  }

  async apply(
    ctx: RlsContext,
    engagementId: string,
    direction: Direction,
  ): Promise<AuditUndoResult> {
    try {
      return await this.db.withRlsContext(ctx, async (client) => {
        const { rows } = await client.query<{ step: RawStep | null }>(
          'SELECT hsdg.audit_undo_apply($1, $2) AS step',
          [engagementId, direction],
        );
        const applied = toStep(rows[0]?.step ?? null);
        if (!applied) {
          throw new ConflictException(
            direction === 'undo' ? 'There is nothing to undo.' : 'There is nothing to redo.',
          );
        }
        await this.audit.recordWith(client, ctx, {
          action: direction === 'undo' ? 'audit_file.change_undone' : 'audit_file.change_redone',
          objectType: 'engagement',
          objectId: engagementId,
          after: { changeSetId: applied.id, description: applied.description },
        });
        return { applied, ...(await this.statusWith(client, engagementId)) };
      });
    } catch (err) {
      throw this.translate(err, direction);
    }
  }

  private async statusWith(client: PoolClient, engagementId: string): Promise<AuditUndoStatus> {
    const { rows } = await client.query<{ status: { undo: RawStep | null; redo: RawStep | null } }>(
      'SELECT hsdg.audit_undo_status($1) AS status',
      [engagementId],
    );
    const status = rows[0]?.status;
    return { undo: toStep(status?.undo ?? null), redo: toStep(status?.redo ?? null) };
  }

  private translate(err: unknown, direction: Direction): unknown {
    const code = (err as { code?: string } | null)?.code;
    if (code === CHANGED_SINCE || code === '23505' || code === '23503') {
      return new ConflictException(
        `This can't be ${direction === 'undo' ? 'undone' : 'redone'} because it has been ` +
          'changed since. Refresh to see the latest.',
      );
    }
    if (code === SIGNED_OFF) {
      return new ConflictException(
        'This audit file is signed off, so changes on it can no longer be undone or redone.',
      );
    }
    if (code === '42501') {
      return new ForbiddenException('You are not on this engagement.');
    }
    return err;
  }
}
