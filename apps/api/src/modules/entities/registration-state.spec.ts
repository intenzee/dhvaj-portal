import { addressState, normaliseStateCode, registrationState } from './registration-state';

const DELHI_GSTIN = '07AAACA1234A1Z5';

describe('CM-2 registration state', () => {
  it('takes the GSTIN prefix when no state is chosen', () => {
    expect(registrationState('gstin', DELHI_GSTIN, null)).toEqual({
      stateCode: '07',
      mismatch: null,
    });
  });

  it('flags a chosen state that is not the prefix', () => {
    expect(registrationState('gstin', DELHI_GSTIN, '06')).toEqual({
      stateCode: '06',
      mismatch: { expected: '07', actual: '06' },
    });
  });

  it('reads state names, so "New Delhi" matches 07', () => {
    expect(registrationState('gstin', DELHI_GSTIN, 'New Delhi').mismatch).toBeNull();
    expect(normaliseStateCode('NCT of Delhi')).toBe('07');
    expect(normaliseStateCode('Haryana ')).toBe('06');
  });

  it('never flags a non-GSTIN registration', () => {
    expect(registrationState('pan', 'AAACA1234A', '06')).toEqual({
      stateCode: '06',
      mismatch: null,
    });
  });
});

describe('CM-2 address state', () => {
  it('keeps the code and names the state when only the code is sent', () => {
    expect(addressState({ stateCode: '07' })).toEqual({ state_code: '07', state: 'Delhi' });
  });

  it('reads the code from a typed state, keeping the text', () => {
    expect(addressState({ state: 'NCT of Delhi' })).toEqual({
      state_code: '07',
      state: 'NCT of Delhi',
    });
  });

  it('leaves both alone when neither is sent', () => {
    expect(addressState({})).toEqual({});
  });
});
