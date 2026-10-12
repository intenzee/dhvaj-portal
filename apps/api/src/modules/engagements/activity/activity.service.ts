import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ActivityItem, ActivityKind, ActivityPage, Stream } from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { periodLabel } from '../../filing-workspace/filing-rules';

interface ActivityRow {
  id: string;
  kind: ActivityKind;
  occurred_at: Date;
  occurred_at_text: string;
  actor_employee_id: string | null;
  actor_name: string | null;
  title: string;
  detail: string | null;
  stream: string | null;
  engagement_service_id: string | null;
  compliance_instance_id: string | null;
  task_id: string | null;
  is_pinned: boolean;
  meta: Record<string, unknown>;
}

export interface ActivityQuery {
  stream?: Stream;
  person?: string;
  kind?: ActivityKind[];
  pinned?: boolean;
  cursor?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

/** occurred_at::text, e.g. `2026-10-12 09:15:02.123456+00`. */
const PG_TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

/** Opaque cursor = base64url(JSON [occurred_at as Postgres text, id]); full precision. */
export function encodeCursor(occurredAt: string, id: string): string {
  return Buffer.from(JSON.stringify([occurredAt, id])).toString('base64url');
}

export function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === 'string' &&
      typeof v[1] === 'string' &&
      PG_TIMESTAMPTZ.test(v[0]) &&
      v[1].length <= 200
    ) {
      return { at: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor.');
}

const TASK_STATUS_WORDS: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  paused: 'Paused',
  in_review: 'In review',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Human title per kind; the view hands over the raw parts. */
export function activityTitle(
  kind: ActivityKind,
  raw: string,
  meta: Record<string, unknown>,
): string {
  const period = typeof meta.periodKey === 'string' ? ` ${periodLabel(meta.periodKey)}` : '';
  const words = (s: unknown) =>
    typeof s === 'string' ? (TASK_STATUS_WORDS[s] ?? s.replace(/_/g, ' ')) : '';
  switch (kind) {
    case 'filing_lodged': {
      const ref = meta.referenceNo
        ? ` — ${String(meta.referenceKind ?? 'ref').toUpperCase()} ${String(meta.referenceNo)}`
        : '';
      return `${raw}${period} filed${meta.isNil ? ' (Nil)' : ''}${ref}`;
    }
    case 'filing_undone':
      return `${raw}${period} filing undone`;
    case 'filing_correction':
      return `Correction noted on ${raw}${period}`;
    case 'filing_waived':
      return `${raw}${period} marked not applicable`;
    case 'task_event':
      return meta.from
        ? `${raw}: ${words(meta.from)} → ${words(meta.to)}`
        : `${raw}: ${words(meta.to)}`;
    case 'document_uploaded':
      return `${meta.viaClientUpload ? 'Client uploaded' : 'Uploaded'} ${raw}`;
    case 'dependency_raised':
      return `Requested from client: ${raw}`;
    case 'dependency_closed':
      return `Client request ${words(meta.status).toLowerCase()}: ${raw}`;
    case 'review_point':
      return `Review point${meta.status === 'resolved' ? ' (resolved)' : ''}: ${raw}`;
    case 'time_day':
      return `${formatDuration(Number(meta.seconds ?? 0))} recorded`;
    case 'independence_ack':
      return `Independence warning acknowledged — ${raw}`;
    default:
      return raw;
  }
}

/**
 * Change 3 — Activity → Timeline. Reads hsdg.engagement_activity (a
 * security_invoker view), so every source's own RLS decides what the caller
 * sees; newest first, keyset-paged on (occurred_at, id).
 */
@Injectable()
export class ActivityService {
  constructor(private readonly db: DatabaseService) {}

  async list(ctx: RlsContext, engagementId: string, q: ActivityQuery): Promise<ActivityPage> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const after = q.cursor ? decodeCursor(q.cursor) : null;
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
        engagementId,
      ]);
      if (!eng.rowCount) throw new NotFoundException('Engagement not found.');

      const { rows } = await client.query<ActivityRow>(
        `SELECT a.id, a.kind, a.occurred_at, a.occurred_at::text AS occurred_at_text,
                a.actor_employee_id, emp.full_name AS actor_name, a.title, a.detail, a.stream,
                a.engagement_service_id, a.compliance_instance_id, a.task_id, a.is_pinned, a.meta
           FROM hsdg.engagement_activity a
           LEFT JOIN hsdg.employees emp ON emp.id = a.actor_employee_id
          WHERE a.engagement_id = $1
            AND ($2::text IS NULL OR a.stream = $2)
            AND ($3::uuid IS NULL OR a.actor_employee_id = $3)
            AND ($4::text[] IS NULL OR a.kind = ANY ($4))
            AND (NOT $5::boolean OR (a.kind = 'comment' AND a.is_pinned))
            AND ($6::timestamptz IS NULL OR (a.occurred_at, a.id) < ($6::timestamptz, $7::text))
          ORDER BY a.occurred_at DESC, a.id DESC
          LIMIT $8`,
        [
          engagementId,
          q.stream ?? null,
          q.person ?? null,
          q.kind?.length ? q.kind : null,
          q.pinned === true,
          after?.at ?? null,
          after?.id ?? null,
          limit + 1,
        ],
      );
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toItem),
        nextCursor:
          rows.length > limit && last ? encodeCursor(last.occurred_at_text, last.id) : null,
      };
    });
  }
}

function toItem(r: ActivityRow): ActivityItem {
  const meta = r.meta ?? {};
  return {
    id: r.id,
    kind: r.kind,
    occurredAt: r.occurred_at.toISOString(),
    actorId: r.actor_employee_id,
    actorName: r.actor_name,
    title: activityTitle(r.kind, r.title, meta),
    detail: r.detail,
    stream: r.stream,
    engagementServiceId: r.engagement_service_id,
    complianceInstanceId: r.compliance_instance_id,
    taskId: r.task_id,
    isPinned: r.is_pinned,
    meta,
  };
}
