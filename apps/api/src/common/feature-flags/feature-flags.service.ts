import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { FEATURE_FLAGS, SYSTEM_ROLE, type FeatureFlag, type RolloutMode } from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { DatabaseService } from '../../database/database.service';
import { ActivityService } from '../activity/activity.service';
import { parseFeatureFlags, parseFlagOffices } from './parse-feature-flags';

/** A row of hsdg.feature_rollouts: the firm's choice for a deployed flag. */
export interface RolloutRule {
  mode: RolloutMode;
  officeCodes: ReadonlySet<string>;
}

/**
 * How old the firm's rollout choices may be before a request re-reads them.
 * They are re-read only while the portal is in use — never on a bare timer,
 * which would keep a serverless database awake all night.
 */
export const REFRESH_MS = 30_000;

/**
 * Which phases are switched on (spec "Rollout": each phase ships behind its own
 * flag). FEATURE_FLAGS — a comma list, 'all' or 'none'; unset means 'all'
 * outside production, 'none' in it — is the deploy's master switch. Within it,
 * Admin → Rollout (hsdg.feature_rollouts) turns a flag on for every office, for
 * pilot offices or pauses it; without a row, FEATURE_FLAG_OFFICES decides.
 */
@Injectable()
export class FeatureFlagsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private readonly enabled: ReadonlySet<FeatureFlag>;
  private readonly offices: ReadonlyMap<FeatureFlag, ReadonlySet<string>>;
  private rules: ReadonlyMap<FeatureFlag, RolloutRule> = new Map();
  private readAt = 0;
  private reading: Promise<void> | null = null;
  private stopListening: (() => void) | null = null;

  constructor(
    config: AppConfigService,
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly activity?: ActivityService,
  ) {
    this.enabled = parseFeatureFlags(config.get('FEATURE_FLAGS'), config.isProduction);
    this.offices = parseFlagOffices(config.get('FEATURE_FLAG_OFFICES'));
  }

  async onModuleInit(): Promise<void> {
    if (!this.db) return;
    await this.refresh();
    // A request finding them older than REFRESH_MS has them re-read in the
    // background (it is served by the choices in hand, at most that stale).
    this.stopListening =
      this.activity?.onActivity(({ at }) => {
        // One background read at a time.
        if (at - this.readAt >= REFRESH_MS && !this.reading) void this.refresh();
      }) ?? null;
  }

  onModuleDestroy(): void {
    this.stopListening?.();
  }

  /**
   * Re-read the firm's rollout choices — after a change (a read begun before
   * it is not enough, so this always reads afresh) and while the portal is in
   * use.
   */
  refresh(): Promise<void> {
    if (!this.db) return Promise.resolve();
    const next = (this.reading ?? Promise.resolve()).then(() => this.read());
    const mine = next.finally(() => {
      if (this.reading === mine) this.reading = null;
    });
    this.reading = mine;
    return mine;
  }

  private async read(): Promise<void> {
    if (!this.db) return;
    this.readAt = Date.now();
    try {
      const { rows } = await this.db.withRlsContext(
        { userId: '', role: SYSTEM_ROLE, officeId: '' },
        (client) =>
          client.query<{ flag: string; mode: RolloutMode; office_codes: string[] }>(
            `SELECT flag, mode, office_codes FROM hsdg.feature_rollouts`,
          ),
      );
      this.rules = rulesFrom(rows);
    } catch (err) {
      // Keep the last known choices; the deploy's switches still apply.
      this.logger.warn(`Could not read feature rollouts: ${(err as Error).message}`);
    }
  }

  /** Replace the cached choices (unit tests). */
  setRules(rules: ReadonlyMap<FeatureFlag, RolloutRule>): void {
    this.rules = rules;
  }

  /** In the deploy's FEATURE_FLAGS. */
  isDeployed(flag: FeatureFlag): boolean {
    return this.enabled.has(flag);
  }

  /** The deploy's FEATURE_FLAG_OFFICES for a flag (null ⇒ every office). */
  deployOffices(flag: FeatureFlag): string[] | null {
    const only = this.offices.get(flag);
    return only ? [...only].sort() : null;
  }

  /** Enabled for the firm (ignores office rollout — background jobs, schedulers). */
  isOn(flag: FeatureFlag): boolean {
    if (!this.enabled.has(flag)) return false;
    return this.rules.get(flag)?.mode !== 'off';
  }

  /** Enabled for a person in this office. */
  isOnFor(flag: FeatureFlag, officeCode: string | null | undefined): boolean {
    const live = this.liveIn(flag);
    if (live === 'all') return true;
    return !!officeCode && live.includes(officeCode.toUpperCase());
  }

  /** Where a flag is on right now: every office, or these office codes (none ⇒ nowhere). */
  liveIn(flag: FeatureFlag): 'all' | string[] {
    if (!this.enabled.has(flag)) return [];
    const rule = this.rules.get(flag);
    if (rule) {
      if (rule.mode === 'firm') return 'all';
      if (rule.mode === 'off') return [];
      return [...rule.officeCodes].sort();
    }
    return this.deployOffices(flag) ?? 'all';
  }

  /** Every flag, for a person in `officeCode` (omit for the firm-wide view). */
  all(officeCode?: string | null): Record<FeatureFlag, boolean> {
    return Object.fromEntries(
      FEATURE_FLAGS.map((f) => [
        f,
        officeCode === undefined ? this.isOn(f) : this.isOnFor(f, officeCode),
      ]),
    ) as Record<FeatureFlag, boolean>;
  }
}

function rulesFrom(
  rows: { flag: string; mode: RolloutMode; office_codes: string[] }[],
): Map<FeatureFlag, RolloutRule> {
  const known = new Set<string>(FEATURE_FLAGS);
  return new Map(
    rows
      .filter((r) => known.has(r.flag))
      .map((r) => [
        r.flag as FeatureFlag,
        { mode: r.mode, officeCodes: new Set(r.office_codes.map((c) => c.toUpperCase())) },
      ]),
  );
}
