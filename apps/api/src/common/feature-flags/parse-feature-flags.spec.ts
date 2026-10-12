import { FEATURE_FLAGS } from '@hsdg/contracts';
import { parseFeatureFlags } from './parse-feature-flags';

describe('parseFeatureFlags', () => {
  it('defaults to every flag outside production and none in production', () => {
    expect([...parseFeatureFlags(undefined, false)].sort()).toEqual([...FEATURE_FLAGS].sort());
    expect(parseFeatureFlags(undefined, true).size).toBe(0);
  });

  it('accepts all / none and a comma list, ignoring unknown flags', () => {
    expect(parseFeatureFlags('ALL', true).size).toBe(FEATURE_FLAGS.length);
    expect(parseFeatureFlags('none', false).size).toBe(0);
    expect([...parseFeatureFlags(' ff_gst_tab, ff_bogus ,ff_auto_time', true)].sort()).toEqual([
      'ff_auto_time',
      'ff_gst_tab',
    ]);
  });
});
