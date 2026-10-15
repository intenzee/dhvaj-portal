import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { FEATURE_FLAGS, SYSTEM_ROLE, type FeatureFlag, type RolloutMode } from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { DatabaseService } from '../../database/database.service';
import { parseFeatureFlags, parseFlagOffices } from './parse-feature-flags';

/** A row of hsdg.feature_rollouts: the firm's choice for a deployed flag. */
export interface RolloutRule {
  mode: RolloutMode;
  officeCodes: ReadonlySet<string>;
}

/** How often every API instance re-reads the firm's rollout choices. */
const REFRESH_MS = 30_000;

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
  private timer: NodeJS.Timeout | null = null;

  constructor(
    config: AppConfigService,
    @Optional() private readonly db?: DatabaseService,
  ) {
    this.enabled = parseFeatureFlags(config.get('FEATURE_FLAGS'), config.isProduction);
    this.offices = parseFlagOffices(config.get('FEATURE_FLAG_OFFICES'));
  }

  async onModuleInit(): Promise<void> {
    if (!this.db) return;
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Re-read the firm's rollout choices (after a change, and every 30 s). */
  async refresh(): Promise<void> {
    if (!this.db) return;
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
