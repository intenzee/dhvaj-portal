import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_LABEL,
  type FeatureFlag,
  type FeatureRollout,
  type FeatureRolloutList,
  type RolloutMode,
  type UpdateFeatureRolloutInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { AuditService } from '../audit/audit.service';

interface RolloutRow {
  flag: string;
  mode: RolloutMode;
  office_codes: string[];
  note: string | null;
  version: number;
  updated_at: Date;
  updated_by_name: string | null;
}

/**
 * Staff Workflow · Rollout (Admin → Rollout): the firm turns each deployed
 * phase on for every office, for pilot offices, or pauses it — no deploy. Every
 * API instance picks a change up within 30 seconds; this one at once.
 */
@Injectable()
export class FeatureRolloutsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly flags: FeatureFlagsService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RlsContext): Promise<FeatureRolloutList> {
    await this.flags.refresh();
    const rows = await this.db.withRlsContext(ctx, (client) => this.rows(client));
    return { items: FEATURE_FLAGS.map((f) => this.toItem(f, rows.get(f))) };
  }

  async update(
    ctx: RlsContext,
    flag: string,
    input: UpdateFeatureRolloutInput,
  ): Promise<FeatureRollout> {
    const f = known(flag);
    const codes = [...new Set((input.officeCodes ?? []).map((c) => c.toUpperCase()))].sort();
    if (input.mode === 'offices' && codes.length === 0) {
      throw new BadRequestException('Name at least one pilot office.');
    }
    const officeCodes = input.mode === 'offices' ? codes : [];
    const item = await this.db.withRlsContext(ctx, async (client) => {
      if (officeCodes.length) {
        const { rows } = await client.query<{ code: string }>(
          `SELECT upper(code) AS code FROM hsdg.offices WHERE upper(code) = ANY($1) AND is_active`,
          [officeCodes],
        );
        const found = new Set(rows.map((r) => r.code));
        const missing = officeCodes.filter((c) => !found.has(c));
        if (missing.length) {
          throw new BadRequestException(`No active office ${missing.join(', ')}.`);
        }
      }
      const before = (await this.rows(client)).get(f);
      if ((before?.version ?? 0) !== input.version) {
        throw new ConflictException('This rollout changed since you loaded it; refresh and retry.');
      }
      await client.query(
        `INSERT INTO hsdg.feature_rollouts (flag, mode, office_codes, note, updated_by_employee_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (flag) DO UPDATE
           SET mode = EXCLUDED.mode, office_codes = EXCLUDED.office_codes, note = EXCLUDED.note,
               updated_by_employee_id = EXCLUDED.updated_by_employee_id,
               version = hsdg.feature_rollouts.version + 1, updated_at = now()`,
        [f, input.mode, officeCodes, input.note ?? null, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'feature_rollout.updated',
        objectType: 'feature_rollout',
        objectId: null,
        before: before
          ? { flag: f, mode: before.mode, officeCodes: before.office_codes }
          : { flag: f },
        after: { flag: f, mode: input.mode, officeCodes },
      });
      return (await this.rows(client)).get(f)!;
    });
    await this.flags.refresh();
    return this.toItem(f, item);
  }

  /** Back to the deploy's own setting. */
  async reset(ctx: RlsContext, flag: string): Promise<FeatureRollout> {
    const f = known(flag);
    await this.db.withRlsContext(ctx, async (client) => {
      const before = (await this.rows(client)).get(f);
      if (!before) return;
      await client.query(`DELETE FROM hsdg.feature_rollouts WHERE flag = $1`, [f]);
      await this.audit.recordWith(client, ctx, {
        action: 'feature_rollout.reset',
        objectType: 'feature_rollout',
        objectId: null,
        before: { flag: f, mode: before.mode, officeCodes: before.office_codes },
        after: { flag: f },
      });
    });
    await this.flags.refresh();
    return this.toItem(f, undefined);
  }

  private async rows(client: PoolClient): Promise<Map<string, RolloutRow>> {
    const { rows } = await client.query<RolloutRow>(
      `SELECT r.flag, r.mode, r.office_codes, r.note, r.version, r.updated_at,
              e.full_name AS updated_by_name
         FROM hsdg.feature_rollouts r
         LEFT JOIN hsdg.employees e ON e.id = r.updated_by_employee_id`,
    );
    return new Map(rows.map((r) => [r.flag, r]));
  }

  private toItem(flag: FeatureFlag, row: RolloutRow | undefined): FeatureRollout {
    return {
      flag,
      label: FEATURE_FLAG_LABEL[flag],
      deployed: this.flags.isDeployed(flag),
      deployOffices: this.flags.deployOffices(flag),
      mode: row?.mode ?? null,
      officeCodes: row?.office_codes ?? [],
      note: row?.note ?? null,
      liveIn: this.flags.liveIn(flag),
      version: row?.version ?? 0,
      updatedAt: row?.updated_at.toISOString() ?? null,
      updatedByName: row?.updated_by_name ?? null,
    };
  }
}

function known(flag: string): FeatureFlag {
  if (!(FEATURE_FLAGS as string[]).includes(flag)) throw new NotFoundException('No such feature.');
  return flag as FeatureFlag;
}
