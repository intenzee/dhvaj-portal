import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  PRIOR_FILED_TOKEN_RE,
  STREAMS,
  priorFiledCovers,
  type PriorFiledResult,
  type Stream,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

/** First line of the notes on a filing marked filed here, so Undo finds only those. */
export const PRIOR_FILED_NOTE = 'Filed before the portal — marked by the team, no lodgement here.';
const MAX_TOKENS = 400;

interface FilingRow {
  id: string;
  stream: Stream;
  period_key: string | null;
  financial_year: string | null;
  period_start: string | null;
  period_end: string | null;
}

/**
 * Check {stream: tokens} from a request: known streams (and, when given, only
 * those in scope), 'YYYY-MM' / 'FY:YYYY-YY' tokens, de-duplicated (pure;
 * exported for tests).
 */
export function normalisePriorFiled(
  input: unknown,
  inScope?: readonly Stream[],
): Partial<Record<Stream, string[]>> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('priorFiled must be {stream: periods}.');
  }
  const out: Partial<Record<Stream, string[]>> = {};
  let count = 0;
  for (const [stream, tokens] of Object.entries(input as Record<string, unknown>)) {
    if (!STREAMS.includes(stream as Stream)) {
      throw new BadRequestException(`priorFiled: unknown stream ${stream}.`);
    }
    if (inScope && !inScope.includes(stream as Stream)) {
      throw new BadRequestException(`priorFiled: ${stream} is not a stream in scope.`);
    }
    if (!Array.isArray(tokens) || tokens.some((t) => typeof t !== 'string')) {
      throw new BadRequestException(`priorFiled.${stream} must be a list of periods.`);
    }
    const bad = (tokens as string[]).find((t) => !PRIOR_FILED_TOKEN_RE.test(t));
    if (bad) {
      throw new BadRequestException(
        `priorFiled: "${bad}" is not a period (use 2026-04 for a month, FY:2026-27 for the year).`,
      );
    }
    const unique = [...new Set(tokens as string[])];
    count += unique.length;
    if (unique.length > 0) out[stream as Stream] = unique;
  }
  if (count > MAX_TOKENS) throw new BadRequestException('priorFiled: too many periods.');
  return out;
}

/**
 * "Filed before the portal": periods the client filed before the firm's
 * filings were in the portal, ticked when the Compliance engagement is
 * created (or later on a stream's tab). Their open filings are marked Filed —
 * no lodgement record, a note saying so — so they are never shown overdue.
 * Lodged, already closed and event filings are left alone. Undo puts back
 * only filings marked here. Engagement leads only (the creator counts while
 * the engagement is being created).
 */
@Injectable()
export class PriorFiledService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async mark(
    ctx: RlsContext,
    engagementId: string,
    stream: Stream,
    tokens: unknown,
  ): Promise<PriorFiledResult> {
    const priorFiled = normalisePriorFiled({ [stream]: tokens });
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireLead(client, engagementId);
      return this.markWith(client, ctx, engagementId, priorFiled);
    });
  }

  async undo(
    ctx: RlsContext,
    engagementId: string,
    stream: Stream,
    tokens: unknown,
  ): Promise<PriorFiledResult> {
    const tokenSet = new Set(normalisePriorFiled({ [stream]: tokens })[stream] ?? []);
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireLead(client, engagementId);
      const rows = (await this.filings(client, engagementId, [stream], 'marked')).filter((f) =>
        priorFiledCovers(tokenSet, this.period(f)),
      );
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return { filings: 0, byStream: {} };
      await client.query(
        `UPDATE hsdg.compliance_instances
            SET workflow_status = 'not_started', completed_by_employee_id = NULL,
                notes = NULLIF(regexp_replace(notes, $2, ''), ''), version = version + 1
          WHERE id = ANY($1::uuid[])`,
        [ids, `^${escapeRe(PRIOR_FILED_NOTE)}\\n?`],
      );
      // Work done since (a checklist ticked) decides where each one stands.
      await client.query(
        `SELECT hsdg.refresh_instance_workflow_status(x) FROM unnest($1::uuid[]) x`,
        [ids],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'filing.prior_filed_undone',
        objectType: 'engagement',
        objectId: engagementId,
        after: { stream, periods: [...tokenSet], instanceIds: ids },
      });
      return { filings: ids.length, byStream: { [stream]: ids.length } };
    });
  }

  /** Mark on the caller's transaction (engagement create). */
  async markWith(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    priorFiled: Partial<Record<Stream, string[]>>,
  ): Promise<PriorFiledResult> {
    const streams = Object.keys(priorFiled) as Stream[];
    if (streams.length === 0) return { filings: 0, byStream: {} };
    const sets = new Map(streams.map((s) => [s, new Set(priorFiled[s])]));
    const rows = (await this.filings(client, engagementId, streams, 'open')).filter((f) =>
      priorFiledCovers(sets.get(f.stream) ?? new Set(), this.period(f)),
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { filings: 0, byStream: {} };
    // compliance_instances_sync_status closes status and completed_at to match.
    await client.query(
      `UPDATE hsdg.compliance_instances
          SET workflow_status = 'filed', completed_by_employee_id = hsdg.ctx_employee_id(),
              notes = CASE WHEN COALESCE(notes, '') = '' THEN $2 ELSE $2 || E'\\n' || notes END,
              version = version + 1
        WHERE id = ANY($1::uuid[])`,
      [ids, PRIOR_FILED_NOTE],
    );
    const byStream: Partial<Record<Stream, number>> = {};
    for (const r of rows) byStream[r.stream] = (byStream[r.stream] ?? 0) + 1;
    await this.audit.recordWith(client, ctx, {
      action: 'filing.prior_filed_marked',
      objectType: 'engagement',
      objectId: engagementId,
      after: { periods: priorFiled, byStream, instanceIds: ids },
    });
    return { filings: ids.length, byStream };
  }

  private period(f: FilingRow) {
    return {
      periodKey: f.period_key,
      financialYear: f.financial_year,
      periodStart: f.period_start,
      periodEnd: f.period_end,
    };
  }

  /** The engagement's periodic filings in these streams: still open, or marked here. */
  private async filings(
    client: PoolClient,
    engagementId: string,
    streams: readonly Stream[],
    which: 'open' | 'marked',
  ): Promise<FilingRow[]> {
    const filter =
      which === 'open'
        ? `ci.status = 'open' AND ci.workflow_status NOT IN ('filed', 'not_applicable')
           AND NOT EXISTS (SELECT 1 FROM hsdg.filing_records fr
                            WHERE fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL)`
        : `ci.workflow_status = 'filed' AND starts_with(COALESCE(ci.notes, ''), $3)
           AND NOT EXISTS (SELECT 1 FROM hsdg.filing_records fr
                            WHERE fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL)`;
    const { rows } = await client.query<FilingRow>(
      `SELECT ci.id, COALESCE(rv.stream, sv.stream) AS stream, ci.period_key, ci.financial_year,
              ci.period_start::text, ci.period_end::text
         FROM hsdg.compliance_instances ci
         LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
         LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
         LEFT JOIN hsdg.services sv ON sv.id = es.service_id
        WHERE ci.engagement_id = $1 AND COALESCE(rv.stream, sv.stream) = ANY($2::text[])
          AND ci.period_key IS NOT NULL AND ${filter}
        ORDER BY ci.period_start, ci.id`,
      which === 'open' ? [engagementId, streams] : [engagementId, streams, PRIOR_FILED_NOTE],
    );
    return rows;
  }

  private async requireLead(client: PoolClient, engagementId: string): Promise<void> {
    const { rows } = await client.query<{ lead: boolean }>(
      `SELECT hsdg.is_engagement_lead(e.id) AS lead FROM hsdg.engagements e WHERE e.id = $1`,
      [engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Engagement not found.');
    if (!rows[0].lead) {
      throw new ForbiddenException(
        'Only the engagement manager or partner can mark periods filed before the portal.',
      );
    }
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
