import { Injectable } from '@nestjs/common';
import { FEATURE_FLAGS, type FeatureFlag } from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { parseFeatureFlags, parseFlagOffices } from './parse-feature-flags';

/**
 * Which Engagement Restructure phases are switched on (spec "Rollout": each
 * phase ships behind its own flag). Read once from FEATURE_FLAGS — a comma
 * list, 'all' or 'none'; unset means 'all' outside production, 'none' in it.
 */
@Injectable()
export class FeatureFlagsService {
  private readonly enabled: ReadonlySet<FeatureFlag>;
  private readonly offices: ReadonlyMap<FeatureFlag, ReadonlySet<string>>;

  constructor(config: AppConfigService) {
    this.enabled = parseFeatureFlags(config.get('FEATURE_FLAGS'), config.isProduction);
    this.offices = parseFlagOffices(config.get('FEATURE_FLAG_OFFICES'));
  }

  /** Enabled for the firm (ignores office rollout — background jobs, schedulers). */
  isOn(flag: FeatureFlag): boolean {
    return this.enabled.has(flag);
  }

  /** Enabled for a person in this office (FEATURE_FLAG_OFFICES rollout). */
  isOnFor(flag: FeatureFlag, officeCode: string | null | undefined): boolean {
    if (!this.enabled.has(flag)) return false;
    const only = this.offices.get(flag);
    return !only || (!!officeCode && only.has(officeCode.toUpperCase()));
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
