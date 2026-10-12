import { Injectable } from '@nestjs/common';
import { FEATURE_FLAGS, type FeatureFlag } from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { parseFeatureFlags } from './parse-feature-flags';

/**
 * Which Engagement Restructure phases are switched on (spec "Rollout": each
 * phase ships behind its own flag). Read once from FEATURE_FLAGS — a comma
 * list, 'all' or 'none'; unset means 'all' outside production, 'none' in it.
 */
@Injectable()
export class FeatureFlagsService {
  private readonly enabled: ReadonlySet<FeatureFlag>;

  constructor(config: AppConfigService) {
    this.enabled = parseFeatureFlags(config.get('FEATURE_FLAGS'), config.isProduction);
  }

  isOn(flag: FeatureFlag): boolean {
    return this.enabled.has(flag);
  }

  all(): Record<FeatureFlag, boolean> {
    return Object.fromEntries(FEATURE_FLAGS.map((f) => [f, this.enabled.has(f)])) as Record<
      FeatureFlag,
      boolean
    >;
  }
}
