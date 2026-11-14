import {
  IDLE_NOTICE,
  IdleTracker,
  LAST_ACTIVE_KEY,
  activeWithin,
  idlePhase,
  markActive,
  parseStamp,
  readLastActive,
  secondsUntilSignOut,
  signOutPlan,
  type KeyValueStore,
} from '../idle';

const MIN = 60_000;

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('idle sign-out', () => {
  it('warns at 14 minutes and expires at 15', () => {
    expect(idlePhase(0, 13 * MIN + 59_000)).toBe('active');
    expect(idlePhase(0, 14 * MIN)).toBe('warn');
    expect(idlePhase(0, 15 * MIN - 1)).toBe('warn');
    expect(idlePhase(0, 15 * MIN)).toBe('expired');
    expect(secondsUntilSignOut(0, 14 * MIN)).toBe(60);
    expect(secondsUntilSignOut(0, 14 * MIN + 59_500)).toBe(1);
    expect(secondsUntilSignOut(0, 16 * MIN)).toBe(0);
  });

  it('renews only after recent activity', () => {
    expect(activeWithin(null, 1000)).toBe(false);
    expect(activeWithin(0, 14 * MIN)).toBe(true);
    expect(activeWithin(0, 15 * MIN)).toBe(false);
  });

  it('reads only a real stamp', () => {
    expect(parseStamp('1700000000000')).toBe(1_700_000_000_000);
    expect(parseStamp(42)).toBe(42);
    expect(parseStamp('soon')).toBeNull();
    expect(parseStamp(null)).toBeNull();
    expect(parseStamp('-5')).toBeNull();
  });

  it('starts from the shared stamp, or from now when there is none', () => {
    const store = memoryStore();
    let now = 10 * MIN;
    const fresh = new IdleTracker({ now: () => now, store });
    expect(fresh.lastActive()).toBe(10 * MIN);
    expect(store.data.get(LAST_ACTIVE_KEY)).toBe(String(10 * MIN));

    // A tab opened later picks up the same stamp; it does not count as activity.
    now = 20 * MIN;
    const later = new IdleTracker({ now: () => now, store });
    expect(later.lastActive()).toBe(10 * MIN);
    expect(later.phase()).toBe('active');
    now = 24 * MIN;
    expect(later.phase()).toBe('warn');
    now = 25 * MIN;
    expect(later.phase()).toBe('expired');
  });

  it('activity in one tab keeps every tab signed in (storage and broadcast)', () => {
    const store = memoryStore();
    let now = 0;
    const heard: number[] = [];
    const a = new IdleTracker({ now: () => now, store, broadcast: (t) => heard.push(t) });
    const b = new IdleTracker({ now: () => now, store });

    now = 14 * MIN + 10_000;
    expect(b.phase()).toBe('warn');
    a.record();
    expect(heard).toEqual([14 * MIN + 10_000]);
    // Tab B sees it through the shared stamp, with no event delivered.
    expect(b.phase()).toBe('active');

    // And through a message alone, when storage is blocked.
    const c = new IdleTracker({ now: () => now, store: null });
    now = 29 * MIN;
    expect(c.phase()).toBe('warn');
    c.receive(String(now));
    expect(c.phase()).toBe('active');
    c.receive('garbage');
    expect(c.lastActive()).toBe(29 * MIN);
  });

  it('writes at most once a second, and "Stay signed in" always writes', () => {
    const store = memoryStore();
    let now = 1000;
    const sent: number[] = [];
    const t = new IdleTracker({ now: () => now, store, broadcast: (s) => sent.push(s) });
    t.record();
    now = 1400;
    t.record();
    now = 1800;
    t.record();
    expect(sent).toEqual([1000]);
    // This tab still knows the latest.
    expect(t.lastActive()).toBe(1800);
    now = 2100;
    t.record();
    expect(sent).toEqual([1000, 2100]);
    now = 2200;
    t.record(true);
    expect(sent).toEqual([1000, 2100, 2200]);
    expect(readLastActive(store)).toBe(2200);
  });

  it('resets the warning: activity during the last minute keeps the session', () => {
    const store = memoryStore();
    let now = 0;
    const t = new IdleTracker({ now: () => now, store });
    now = 14 * MIN + 30_000;
    expect(t.phase()).toBe('warn');
    expect(t.secondsLeft()).toBe(30);
    t.record(true);
    expect(t.phase()).toBe('active');
    now += 15 * MIN;
    expect(t.phase()).toBe('expired');
  });

  it('a sign-in marks the browser active, so an old stamp cannot sign it straight out', () => {
    const store = memoryStore();
    markActive(0, store);
    markActive(60 * MIN, store);
    expect(new IdleTracker({ now: () => 60 * MIN, store }).phase()).toBe('active');
  });

  it('survives storage that throws', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    let now = 0;
    const t = new IdleTracker({
      now: () => now,
      store: broken,
      broadcast: () => {
        throw new Error('closed');
      },
    });
    now = 5000;
    expect(() => t.record(true)).not.toThrow();
    expect(t.lastActive()).toBe(5000);
    expect(readLastActive(broken)).toBeNull();
  });
});

describe('signOutPlan', () => {
  it('an idle sign-out keeps push and does not open Microsoft sign-out', () => {
    expect(signOutPlan('idle', true, true)).toEqual({
      stopPush: false,
      entraSignOut: false,
      notice: IDLE_NOTICE,
    });
  });

  it('the Sign out button stops push, and signs out of Microsoft when signed in with it', () => {
    expect(signOutPlan('manual', true, true)).toEqual({
      stopPush: true,
      entraSignOut: true,
      notice: null,
    });
    expect(signOutPlan('manual', false, true).entraSignOut).toBe(false);
    expect(signOutPlan('manual', true, false).entraSignOut).toBe(false);
  });
});
