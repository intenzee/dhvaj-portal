import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { FilingCleanupResult, Stream } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { setEventContext } from '../engagements/time/auto-time';
import { lastMonthOfQuarter, quarterOfMonth } from './filing-rules';

/** Marks a filing this service removed, so Restore can find it (first line of its notes). */
export const REMOVED_MARK = '[removed]';
/** The task_events reason on a task cancelled here, so Restore can reopen it. */
const TASK_REASON = 'period_removed';

const STREAM_JOINS = `
  LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
  LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
  LEFT JOIN hsdg.services sv ON sv.id = es.service_id`;

/**
 * The period keys a stream-tab row stands for: a GST quarter (QRMP,
 * '2026-27:Q2') shows on its last month, so removing September takes it too.
 */
export function rowPeriodKeys(stream: Stream, periodKey: string): string[] {
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periodKey);
  if (stream !== 'gst' || !month) return [periodKey];
  const fyStart = Number(month[2]) >= 4 ? Number(month[1]) : Number(month[1]) - 1;
  const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  const quarter = quarterOfMonth(periodKey);
  return lastMonthOfQuarter(fy, quarter) === periodKey
    ? [periodKey, `${fy}:${quarter}`]
    : [periodKey];
}

/** Still to do: open, not lodged, not already Not applicable. */
const STILL_OPEN = `ci.status = 'open' AND ci.workflow_status NOT IN ('filed', 'not_applicable')`;

/**
 * Taking old filings off the portal when the firm keeps their history
 * elsewhere (the client's return history). Nothing is deleted: open filings
 * are waived (so they show Not applicable and stop being overdue), their open
 * tasks cancelled and their open client requests waived. A removed period can
 * be restored. Lodged filings are never touched.
 *
 *  · a period — "Remove this month" on a stream tab, engagement lead only;
 *  · start fresh — firm-wide, the Managing Partner only: every overdue filing
 *    for a period that ended before a date.
 */
@Injectable()
export class FilingCleanupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async removePeriod(
    ctx: RlsContext,
    engagementId: string,
    stream: Stream,
    periodKey: string,
    registrationId: string | null,
  ): Promise<FilingCleanupResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireLead(client, engagementId);
      const { rows } = await client.query<{ id: string }>(
        `SELECT ci.id FROM hsdg.compliance_instances ci ${STREAM_JOINS}
          WHERE ci.engagement_id = $1 AND COALESCE(rv.stream, sv.stream) = $2
            AND ci.period_key = ANY($3::text[])
            AND ($4::uuid IS NULL OR ci.registration_id = $4 OR ci.registration_id IS NULL)
            AND ${STILL_OPEN}`,
        [engagementId, stream, rowPeriodKeys(stream, periodKey), registrationId],
      );
      const ids = rows.map((r) => r.id);
      const result = await this.remove(client, ids, `Removed ${periodKey} from the portal.`);
      if (result.filings > 0) {
        await this.audit.recordWith(client, ctx, {
          action: 'filing.period_removed',
          objectType: 'engagement',
          objectId: engagementId,
          after: { stream, periodKey, registrationId, ...result, instanceIds: ids },
        });
      }
      return result;
    });
  }

  async restorePeriod(
    ctx: RlsContext,
    engagementId: string,
    stream: Stream,
    periodKey: string,
    registrationId: string | null,
  ): Promise<FilingCleanupResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireLead(client, engagementId);
      const { rows } = await client.query<{ id: string }>(
        `SELECT ci.id FROM hsdg.compliance_instances ci ${STREAM_JOINS}
          WHERE ci.engagement_id = $1 AND COALESCE(rv.stream, sv.stream) = $2
            AND ci.period_key = ANY($3::text[])
            AND ($4::uuid IS NULL OR ci.registration_id = $4 OR ci.registration_id IS NULL)
            AND ci.status = 'waived' AND ci.notes LIKE $5`,
        [
          engagementId,
          stream,
          rowPeriodKeys(stream, periodKey),
          registrationId,
          `${REMOVED_MARK}%`,
        ],
      );
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return { filings: 0, tasks: 0, requests: 0 };

      await client.query(
        `UPDATE hsdg.compliance_instances
            SET status = 'open', workflow_status = 'not_started', version = version + 1,
                notes = NULLIF(regexp_replace(notes, $2, ''), '')
          WHERE id = ANY($1::uuid[])`,
        [ids, `^\\${REMOVED_MARK}[^\\n]*\\n?`],
      );
      // Reopen the tasks this service cancelled, at the status they had.
      await setEventContext(client, 'period_restored', false);
      const tasks = await client.query<{ id: string }>(
        `UPDATE hsdg.tasks t SET status = ev.from_status, version = t.version + 1
           FROM (SELECT DISTINCT ON (e.task_id) e.task_id, e.from_status, e.to_status, e.reason
                   FROM hsdg.task_events e
                  ORDER BY e.task_id, e.created_at DESC) ev
          WHERE ev.task_id = t.id AND t.source_compliance_instance_id = ANY($1::uuid[])
            AND t.status = 'cancelled' AND ev.to_status = 'cancelled' AND ev.reason = $2
            AND ev.from_status IS NOT NULL
          RETURNING t.id`,
        [ids, TASK_REASON],
      );
      await setEventContext(client, null, false);
      await client.query(
        `SELECT hsdg.refresh_instance_workflow_status(x) FROM unnest($1::uuid[]) x`,
        [ids],
      );
      const result = { filings: ids.length, tasks: tasks.rowCount ?? 0, requests: 0 };
      await this.audit.recordWith(client, ctx, {
        action: 'filing.period_restored',
        objectType: 'engagement',
        objectId: engagementId,
        after: { stream, periodKey, registrationId, ...result, instanceIds: ids },
      });
      return result;
    });
  }

  /**
   * Firm-wide: waive every overdue, unlodged filing whose period ended before
   * `from` (a filing with no period counts by its due date). `dryRun` counts
   * only. The Managing Partner only — it reaches every client.
   */
  async startFresh(ctx: RlsContext, from: string, dryRun: boolean): Promise<FilingCleanupResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const mp = await client.query<{ ok: boolean }>(
        `SELECT hsdg.ctx_is_business_firmwide() AS ok`,
      );
      if (!mp.rows[0]?.ok) {
        throw new ForbiddenException('Only the Managing Partner can clear old filings firm-wide.');
      }
      const { rows } = await client.query<{ id: string }>(
        `SELECT ci.id FROM hsdg.compliance_instances ci
           LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
          WHERE ${STILL_OPEN}
            AND COALESCE(ci.period_end, ci.period_start,
                         ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline) < $1::date
            AND COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)
                  < CURRENT_DATE`,
        [from],
      );
      const ids = rows.map((r) => r.id);
      if (dryRun) {
        const counts = await client.query<{ tasks: number; requests: number }>(
          `SELECT (SELECT count(*) FROM hsdg.tasks t
                    WHERE t.source_compliance_instance_id = ANY($1::uuid[])
                      AND t.status NOT IN ('done', 'cancelled'))::int AS tasks,
                  (SELECT count(*) FROM hsdg.client_dependencies d
                    WHERE d.compliance_instance_id = ANY($1::uuid[])
                      AND d.status IN ('pending', 'partially_received'))::int AS requests`,
          [ids],
        );
        return { filings: ids.length, ...counts.rows[0]!, dryRun: true, from };
      }
      const result = await this.remove(
        client,
        ids,
        `Removed before ${from}: history kept on the client.`,
      );
      await this.audit.recordWith(client, ctx, {
        action: 'filing.start_fresh',
        objectType: 'compliance',
        objectId: from,
        after: { from, ...result },
      });
      return { ...result, dryRun: false, from };
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async requireLead(client: PoolClient, engagementId: string): Promise<void> {
    const { rows } = await client.query<{ lead: boolean }>(
      `SELECT hsdg.is_engagement_lead(e.id) AS lead FROM hsdg.engagements e WHERE e.id = $1`,
      [engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Engagement not found.');
    if (!rows[0].lead) {
      throw new ForbiddenException('Only the engagement manager or partner can remove a period.');
    }
  }

  private async remove(
    client: PoolClient,
    ids: string[],
    note: string,
  ): Promise<FilingCleanupResult> {
    if (ids.length === 0) return { filings: 0, tasks: 0, requests: 0 };
    const filings = await client.query(
      `UPDATE hsdg.compliance_instances
          SET status = 'waived', version = version + 1,
              notes = $2 || COALESCE(E'\\n' || notes, '')
        WHERE id = ANY($1::uuid[]) AND status = 'open'`,
      [ids, `${REMOVED_MARK} ${note}`],
    );
    // A task with its clock running is left alone: stop it first.
    await setEventContext(client, TASK_REASON, false);
    const tasks = await client.query(
      `UPDATE hsdg.tasks t SET status = 'cancelled', version = t.version + 1
        WHERE t.source_compliance_instance_id = ANY($1::uuid[])
          AND t.status NOT IN ('done', 'cancelled')
          AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_time_entries te
                           WHERE te.task_id = t.id AND te.ended_at IS NULL)`,
      [ids],
    );
    await setEventContext(client, null, false);
    const requests = await client.query(
      `UPDATE hsdg.client_dependencies SET status = 'waived', version = version + 1
        WHERE compliance_instance_id = ANY($1::uuid[])
          AND status IN ('pending', 'partially_received')`,
      [ids],
    );
    await client.query(
      `SELECT hsdg.refresh_instance_workflow_status(x) FROM unnest($1::uuid[]) x`,
      [ids],
    );
    return {
      filings: filings.rowCount ?? 0,
      tasks: tasks.rowCount ?? 0,
      requests: requests.rowCount ?? 0,
    };
  }
}
