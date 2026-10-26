import { gstinCheckChar } from '@hsdg/contracts';
import { gstinStateCheck, matchStates, OUTSIDE_INDIA } from '../gst-state-select';

const DELHI = `07AAACA1234A1Z${gstinCheckChar('07AAACA1234A1Z')}`;

describe('CM-2 state dropdown helpers', () => {
  it('finds a state by name or by code', () => {
    expect(matchStates('del').map((o) => o.code)).toContain('07');
    expect(matchStates('07').map((o) => o.code)).toEqual(['07']);
  });

  it('offers Outside India only on addresses', () => {
    expect(matchStates('outside').map((o) => o.code)).toEqual([]);
    expect(matchStates('outside', true).map((o) => o.code)).toEqual([OUTSIDE_INDIA]);
  });

  it('flags a state that is not the GSTIN prefix', () => {
    expect(gstinStateCheck(DELHI, '07')).toEqual({ prefix: '07', mismatch: false });
    expect(gstinStateCheck(DELHI, '06')).toEqual({ prefix: '07', mismatch: true });
    expect(gstinStateCheck(DELHI, OUTSIDE_INDIA).mismatch).toBe(false);
    expect(gstinStateCheck('07AAAC', '06')).toEqual({ prefix: null, mismatch: false });
  });
});
