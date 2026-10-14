import { reachedStep, type OnboardingStep } from '../onboarding';

const step = (donePath: string): OnboardingStep => ({
  key: donePath,
  title: '',
  body: '',
  href: donePath,
  cta: '',
  donePath,
});

describe('reachedStep', () => {
  it('ticks a step on its own path and below it', () => {
    expect(reachedStep(step('/compliance'), '/compliance', '')).toBe(true);
    expect(reachedStep(step('/engagements/'), '/engagements/e1', '?tab=gst')).toBe(true);
    expect(reachedStep(step('/compliance'), '/today', '')).toBe(false);
  });

  it('ticks an old list route reached as its My Work tab (WF-106)', () => {
    const reviews = step('/reviews');
    expect(reachedStep(reviews, '/reviews', '')).toBe(true);
    expect(reachedStep(reviews, '/my-work', '?tab=to-review')).toBe(true);
    expect(reachedStep(reviews, '/my-work', '?filter=signoff&tab=to-review')).toBe(true);
    expect(reachedStep(reviews, '/my-work', '?tab=tasks')).toBe(false);
    expect(reachedStep(reviews, '/my-work', '')).toBe(false);
  });
});
