import { gateView, unblockSteps } from '../notification-gate';

describe('gateView', () => {
  it('stays out of the way once alerts are on', () => {
    expect(gateView('on', 'granted', false)).toBe('none');
  });

  it('asks when the browser has not been asked, or has no subscription yet', () => {
    expect(gateView('ask', 'default', false)).toBe('ask');
    expect(gateView('ask', 'granted', false)).toBe('ask');
  });

  it('explains the site settings once they said no', () => {
    expect(gateView('blocked', 'denied', false)).toBe('blocked');
  });

  it('sends iPhone Safari to the Home Screen app; other browsers without push are left alone', () => {
    expect(gateView('unsupported', null, true)).toBe('home-screen');
    expect(gateView('unsupported', null, false)).toBe('none');
  });

  it('without push keys on the server, still needs the browser permission', () => {
    expect(gateView('off-server', 'default', false)).toBe('ask');
    expect(gateView('off-server', 'denied', false)).toBe('blocked');
    expect(gateView('off-server', 'granted', false)).toBe('none');
    expect(gateView('off-server', null, false)).toBe('none');
  });
});

describe('unblockSteps', () => {
  const CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const FIREFOX =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0';

  it('points each browser to its own settings', () => {
    expect(unblockSteps(CHROME).join(' ')).toMatch(/Site settings/);
    expect(unblockSteps(SAFARI).join(' ')).toMatch(/Safari → Settings → Websites/);
    expect(unblockSteps(FIREFOX).join(' ')).toMatch(/Blocked/);
  });
});
