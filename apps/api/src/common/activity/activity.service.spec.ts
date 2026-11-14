import { ActivityService, countsAsActivity, isWriteMethod, workingTick } from './activity.service';

describe('ActivityService', () => {
  it('remembers the last request and tells listeners whether it could write', () => {
    const a = new ActivityService();
    const seen: boolean[] = [];
    const stop = a.onActivity((e) => seen.push(e.write));
    expect(a.activeSince(0)).toBe(false);
    a.touch(false, 1_000);
    a.touch(true, 2_000);
    expect(a.lastActiveAt).toBe(2_000);
    expect(a.activeSince(1_500)).toBe(true);
    expect(a.activeSince(2_000)).toBe(false);
    stop();
    a.touch(true, 3_000);
    expect(seen).toEqual([false, true]);
  });

  it('a listener that throws never breaks the request', () => {
    const a = new ActivityService();
    a.onActivity(() => {
      throw new Error('boom');
    });
    expect(() => a.touch(true)).not.toThrow();
  });

  it('health probes are not people using the portal', () => {
    expect(countsAsActivity('/api/v1/health/live')).toBe(false);
    expect(countsAsActivity('/api/v1/health/ready?x=1')).toBe(false);
    expect(countsAsActivity('/api/v1/health')).toBe(false);
    expect(countsAsActivity('/api/v1/work/today')).toBe(true);
    expect(countsAsActivity('/api/v1/healthcare-clients')).toBe(true);
  });

  it('only GET, HEAD and OPTIONS cannot change anything', () => {
    expect(isWriteMethod('GET')).toBe(false);
    expect(isWriteMethod('head')).toBe(false);
    expect(isWriteMethod('OPTIONS')).toBe(false);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(isWriteMethod(m)).toBe(true);
  });

  describe('workingTick', () => {
    const at = (h: number, m: number) => new Date(2026, 10, 16, h, m);
    it('runs after people used the portal since the last run', () => {
      const a = new ActivityService();
      const last = at(10, 5).getTime();
      expect(workingTick(at(10, 10), last, a)).toBe(false);
      a.touch(false, at(10, 7).getTime());
      expect(workingTick(at(10, 10), last, a)).toBe(true);
    });
    it('always on the hour (the sweep’s wake) and on its first tick', () => {
      const a = new ActivityService();
      expect(workingTick(at(3, 0), at(2, 0).getTime(), a)).toBe(true);
      expect(workingTick(at(3, 5), at(3, 0).getTime(), a)).toBe(false);
      expect(workingTick(at(3, 5), 0, a)).toBe(true);
    });
  });
});
