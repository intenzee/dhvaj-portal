import type { AppConfigService } from '../../config/config.module';
import { FeatureFlagsService } from './feature-flags.service';

// The real module validates the whole environment on import.
jest.mock('../../config/config.module', () => ({ AppConfigService: class {} }));

const service = (env: Record<string, string | undefined>, isProduction = true) =>
  new FeatureFlagsService({
    get: (k: string) => env[k],
    isProduction,
  } as unknown as AppConfigService);

describe('FeatureFlagsService office rollout', () => {
  const flags = service({
    FEATURE_FLAGS: 'ff_work_links,ff_today_view',
    FEATURE_FLAG_OFFICES: 'ff_today_view:NORTH;ff_filing_runs:NORTH',
  });

  it('a flag limited to an office is on only there', () => {
    expect(flags.isOnFor('ff_today_view', 'NORTH')).toBe(true);
    expect(flags.isOnFor('ff_today_view', 'south')).toBe(false);
    expect(flags.isOnFor('ff_today_view', null)).toBe(false);
  });

  it('an unrestricted flag is on everywhere; a disabled flag nowhere, whatever the office list', () => {
    expect(flags.isOnFor('ff_work_links', 'SOUTH')).toBe(true);
    expect(flags.isOnFor('ff_filing_runs', 'NORTH')).toBe(false);
  });

  it('all() is per office; without an office it is the firm-wide switch', () => {
    expect(flags.all('SOUTH')).toMatchObject({ ff_work_links: true, ff_today_view: false });
    expect(flags.all('NORTH')).toMatchObject({ ff_today_view: true });
    expect(flags.all()).toMatchObject({ ff_today_view: true });
  });
});
