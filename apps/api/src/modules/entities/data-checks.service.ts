import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DATA_CHECKS,
  DATA_CHECK_META,
  DATA_CHECK_PAGE_SIZE,
  type ApplyDataCheckInput,
  type DataCheck,
  type DataCheckApplyResult,
  type DataCheckCount,
  type DataCheckRow,
  type Paginated,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { EngagementKindsService } from '../engagements/engagement-kinds.service';
import { TeamsService } from '../teams/teams.service';
import { BranchesService } from './branches.service';
import { EntitiesService } from './entities.service';
import {
  dataCheckCsv,
  dataCheckRows,
  type CheckClient,
  type CheckInput,
  type CheckRow,
} from './data-checks';

/**
 * CM-9 · the data check. Reads every live client the caller can see, lists
 * those breaking a CM-1 to CM-8 rule with the proposed fix, and applies safe
 * fixes one client per transaction through the same service methods the
 * forms use — so every rule, guard and audit entry applies, and one failure
 * never stops the rest.
 */
@Injectable()
export class DataChecksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly entities: EntitiesService,
    private readonly branches: BranchesService,
    private readonly years: EngagementKindsService,
    private readonly teams: TeamsService,
  ) {}

  async counts(ctx: RlsContext): Promise<DataCheckCount[]> {
    const input = await this.load(ctx);
    const offices = (await this.branches.candidates(ctx)).length;
    return DATA_CHECKS.map((check) => ({
      check,
      count: check === 'offices' ? offices : dataCheckRows(check, input).length,
    }));
  }

  async rows(ctx: RlsContext, check: DataCheck, page = 1): Promise<Paginated<DataCheckRow>> {
    const all = dataCheckRows(check, await this.load(ctx));
    const offset = (Math.max(1, page) - 1) * DATA_CHECK_PAGE_SIZE;
    return {
      items: all.slice(offset, offset + DATA_CHECK_PAGE_SIZE).map(strip),
      total: all.length,
      limit: DATA_CHECK_PAGE_SIZE,
      offset,
    };
  }

  async csv(ctx: RlsContext, check: DataCheck): Promise<string> {
    return dataCheckCsv(dataCheckRows(check, await this.load(ctx)));
  }

  async apply(
    ctx: RlsContext,
    check: DataCheck,
    input: ApplyDataCheckInput,
  ): Promise<DataCheckApplyResult[]> {
    if (!DATA_CHECK_META[check].bulk)
      throw new BadRequestException(
        `"${DATA_CHECK_META[check].label}" is fixed one client at a time.`,
      );
    if (check === 'client_without_team' && !input.teamId)
      throw new BadRequestException('Pick the team to assign.');
    if (input.action === 'keep' && check !== 'firm_type')
      throw new BadRequestException('Only a firm type can be kept as it is.');

    const byEntity = new Map<string, CheckRow[]>();
    for (const r of dataCheckRows(check, await this.load(ctx))) {
      if (!r.entityId) continue;
      byEntity.set(r.entityId, [...(byEntity.get(r.entityId) ?? []), r]);
    }

    const results: DataCheckApplyResult[] = [];
    for (const entityId of [...new Set(input.entityIds)]) {
      const rows = byEntity.get(entityId) ?? [];
      const fixable = rows.filter((r) => r.canApply && r.fix);
      if (fixable.length === 0) {
        results.push({
          entityId,
          ok: false,
          message: rows.length ? 'This one needs a person to fix it.' : 'Nothing to fix any more.',
        });
        continue;
      }
      try {
        for (const r of fixable) await this.fix(ctx, entityId, r, input);
        results.push({ entityId, ok: true, message: fixedMessage(check, input, fixable) });
      } catch (err) {
        results.push({ entityId, ok: false, message: messageOf(err) });
      }
    }
    return results;
  }

  /** One row's fix, in its own transaction (each service call opens one). */
  private async fix(
    ctx: RlsContext,
    entityId: string,
    row: CheckRow,
    input: ApplyDataCheckInput,
  ): Promise<void> {
    const f = row.fix!;
    switch (f.kind) {
      case 'state':
        await this.entities.updateRegistration(ctx, entityId, f.registrationId, {
          stateCode: f.stateCode,
        });
        return;
      case 'type':
        await this.entities.updateEntity(
          ctx,
          entityId,
          input.action === 'keep'
            ? { typeSlug: f.current, entityTypeSource: 'manual' }
            : { typeSlug: f.slug, entityTypeSource: 'pan' },
        );
        return;
      case 'name':
        await this.entities.updateEntity(ctx, entityId, { legalName: f.legalName });
        return;
      case 'fees':
        for (const y of f.years)
          await this.years.updateYear(ctx, y.engagementId, y.fy, {
            version: y.version,
            feePeriod: 'annual',
          });
        return;
      case 'team':
        await this.teams.assignClients(ctx, input.teamId!, [entityId]);
        return;
    }
  }

  /** Every live client the caller can see, with what the checks read. */
  private async load(ctx: RlsContext): Promise<CheckInput> {
    return this.db.withRlsContext(ctx, async (client) => {
      const clients = await client.query<{
        id: string;
        entity_code: string | null;
        legal_name: string;
        pan: string | null;
        type_slug: string;
        entity_type_source: string;
        team_id: string | null;
        registrations: CheckClient['registrations'];
        addresses: CheckClient['addresses'];
        fees: CheckClient['fees'];
      }>(
        `SELECT e.id, e.entity_code, e.legal_name, e.pan, et.slug AS type_slug,
                e.entity_type_source, e.team_id,
                COALESCE((SELECT json_agg(json_build_object(
                           'id', r.id, 'type', r.registration_type, 'number', r.registration_number,
                           'status', r.status, 'stateCode', r.state_code,
                           'acked', r.state_mismatch_ack_at IS NOT NULL) ORDER BY r.created_at)
                            FROM hsdg.entity_registrations r WHERE r.entity_id = e.id), '[]')
                  AS registrations,
                COALESCE((SELECT json_agg(json_build_object(
                           'id', a.id, 'state', a.state, 'stateCode', a.state_code,
                           'country', a.country))
                            FROM hsdg.entity_addresses a WHERE a.entity_id = e.id), '[]')
                  AS addresses,
                COALESCE((SELECT json_agg(json_build_object(
                           'engagementId', y.engagement_id, 'fy', y.financial_year,
                           'amount', y.fee_amount::text, 'period', y.fee_period,
                           'version', y.version) ORDER BY y.financial_year)
                            FROM hsdg.compliance_engagement_years y
                            JOIN hsdg.engagements g ON g.id = y.engagement_id
                           WHERE g.entity_id = e.id AND y.status = 'open'
                             AND y.fee_amount IS NOT NULL AND y.fee_period_set_at IS NULL), '[]')
                  AS fees
           FROM hsdg.entities e
           JOIN hsdg.entity_types et ON et.id = e.entity_type_id
          WHERE e.merged_into_id IS NULL AND e.status <> 'archived'`,
      );
      const teams = await client.query<{ id: string; name: string }>(
        `SELECT t.id, t.name FROM hsdg.teams t
          WHERE t.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM hsdg.team_members m
                             WHERE m.team_id = t.id AND m.team_role = 'overseeing_partner')`,
      );
      const types = await client.query<{ slug: string; name: string }>(
        'SELECT slug, name FROM hsdg.entity_types',
      );
      return {
        clients: clients.rows.map((r) => ({
          id: r.id,
          code: r.entity_code,
          name: r.legal_name,
          pan: r.pan,
          typeSlug: r.type_slug,
          typeSource: r.entity_type_source,
          teamId: r.team_id,
          registrations: r.registrations,
          addresses: r.addresses,
          fees: r.fees,
        })),
        teams: teams.rows,
        typeNames: Object.fromEntries(types.rows.map((t) => [t.slug, t.name])),
      };
    });
  }
}

function strip({ fix: _fix, ...row }: CheckRow): DataCheckRow {
  return row;
}

function fixedMessage(check: DataCheck, input: ApplyDataCheckInput, rows: CheckRow[]): string {
  if (check === 'firm_type' && input.action === 'keep') return `Kept as ${rows[0]!.current}.`;
  if (check === 'fee_period') return 'Fees confirmed as per year.';
  if (check === 'client_without_team') return 'Team assigned.';
  return rows.map((r) => r.proposed).join('; ');
}

function messageOf(err: unknown): string {
  const res = (err as { getResponse?: () => unknown }).getResponse?.();
  if (res && typeof res === 'object' && 'message' in res) {
    const m = (res as { message: unknown }).message;
    return Array.isArray(m) ? m.join(' ') : String(m);
  }
  return err instanceof Error ? err.message : 'Could not fix this client.';
}
