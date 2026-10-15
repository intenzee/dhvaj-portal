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

describe('FeatureFlagsService with the firm’s rollout choices (Admin → Rollout)', () => {
  const flags = service({
    FEATURE_FLAGS: 'ff_work_links,ff_today_view,ff_filing_runs',
    FEATURE_FLAG_OFFICES: 'ff_today_view:NORTH',
  });
  const rule = (mode: 'firm' | 'offices' | 'off', codes: string[] = []) => ({
    mode,
    officeCodes: new Set(codes),
  });
  afterEach(() => flags.setRules(new Map()));

  it('a pilot list replaces the deploy’s office list', () => {
    flags.setRules(new Map([['ff_today_view', rule('offices', ['SOUTH'])]]));
    expect(flags.isOnFor('ff_today_view', 'south')).toBe(true);
    expect(flags.isOnFor('ff_today_view', 'NORTH')).toBe(false);
    expect(flags.liveIn('ff_today_view')).toEqual(['SOUTH']);
  });

  it('every office, or paused everywhere — background jobs pause too', () => {
    flags.setRules(
      new Map([
        ['ff_today_view', rule('firm')],
        ['ff_filing_runs', rule('off')],
      ]),
    );
    expect(flags.isOnFor('ff_today_view', 'SOUTH')).toBe(true);
    expect(flags.isOnFor('ff_filing_runs', 'NORTH')).toBe(false);
    expect(flags.isOn('ff_filing_runs')).toBe(false);
    expect(flags.liveIn('ff_filing_runs')).toEqual([]);
  });

  it('nothing here turns on a flag the deploy left off', () => {
    flags.setRules(new Map([['ff_gst_tab', rule('firm')]]));
    expect(flags.isOnFor('ff_gst_tab', 'NORTH')).toBe(false);
    expect(flags.isOn('ff_gst_tab')).toBe(false);
  });

  it('without a choice the deploy decides', () => {
    expect(flags.liveIn('ff_today_view')).toEqual(['NORTH']);
    expect(flags.liveIn('ff_work_links')).toBe('all');
    expect(flags.deployOffices('ff_work_links')).toBeNull();
  });
});
