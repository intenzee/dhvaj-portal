import {
  GST_STATES,
  checkTaxIds,
  firmTypeFromIds,
  gstStateOptions,
  gstinCheckChar,
  hasCompanyForm,
  legalFormOf,
  readGstin,
  withCompanySuffix,
} from '@hsdg/contracts';

/** A GSTIN with a correct check digit: g('07', 'AADCD1234K') → '07AADCD1234K1Z?'. */
const g = (state: string, pan: string): string => {
  const first14 = `${state}${pan}1Z`;
  return `${first14}${gstinCheckChar(first14)}`;
};

describe('readGstin', () => {
  it('forgives case, spaces, dashes and dots', () => {
    const gstin = g('07', 'AADCD1234K');
    const messy = ` ${gstin.slice(0, 7).toLowerCase()}-${gstin.slice(7, 12)}.${gstin.slice(12)} `;
    expect(readGstin(messy)).toEqual({
      gstin,
      valid: true,
      pan: 'AADCD1234K',
      stateCode: '07',
      stateName: 'Delhi',
    });
  });

  it('rejects a bad check digit', () => {
    const gstin = g('06', 'AADCD1234K');
    const bad = gstin.slice(0, 14) + (gstin[14] === 'A' ? 'B' : 'A');
    expect(readGstin(bad).valid).toBe(false);
  });

  it('knows every state code in GST_STATES', () => {
    for (const [code, name] of Object.entries(GST_STATES))
      expect(readGstin(g(code, 'AADCD1234K'))).toMatchObject({ stateCode: code, stateName: name });
  });
});

describe('checkTaxIds', () => {
  const codes = (input: Parameters<typeof checkTaxIds>[0]) => checkTaxIds(input).map((i) => i.code);

  it('passes a GSTIN of the same PAN', () => {
    expect(checkTaxIds({ pan: 'AADCD1234K', gstins: [{ number: g('07', 'AADCD1234K') }] })).toEqual([]);
  });

  it('blocks a GSTIN of another PAN', () => {
    const [issue] = checkTaxIds({ pan: 'aadcd1234k', gstins: [{ number: g('07', 'AADCX9999K') }] });
    expect(issue).toMatchObject({
      code: 'PAN_GSTIN_MISMATCH',
      severity: 'block',
      expected: 'AADCD1234K',
      actual: 'AADCX9999K',
    });
  });

  it('blocks two GSTINs of different PANs when the PAN is blank', () => {
    expect(
      codes({ gstins: [{ number: g('07', 'AADCD1234K') }, { number: g('06', 'AADCX9999K') }] }),
    ).toEqual(['GSTINS_DIFFERENT_PAN']);
  });

  it('flags an invalid PAN, an invalid GSTIN and an unknown state', () => {
    expect(codes({ pan: 'ABC' })).toEqual(['PAN_INVALID']);
    expect(codes({ gstins: [{ number: '07AADCD1234K1Z0' }] })).toContain('GSTIN_INVALID');
    expect(codes({ gstins: [{ number: g('99', 'AADCD1234K') }] })).toEqual(['STATE_UNKNOWN']);
  });

  it('asks to confirm a state that differs from the code', () => {
    const [issue] = checkTaxIds({ gstins: [{ number: g('07', 'AADCD1234K'), stateCode: '06' }] });
    expect(issue).toMatchObject({ code: 'STATE_MISMATCH', severity: 'confirm', expected: '07', actual: '06' });
  });
});

describe('firmTypeFromIds', () => {
  const slug = (input: Parameters<typeof firmTypeFromIds>[0]) => firmTypeFromIds(input)?.slug ?? null;

  it.each([
    ['AADCD1234K', 'private_limited'],
    ['AADFD1234K', 'partnership'],
    ['AADHD1234K', 'huf'],
    ['AADAD1234K', 'aop'],
    ['AADBD1234K', 'aop'],
    ['AADTD1234K', 'trust'],
    ['AADGD1234K', null],
    ['AADLD1234K', null],
  ])('PAN %s → %s', (pan, type) => {
    expect(slug({ pan })).toBe(type);
  });

  it('reads the GSTIN 6th letter when the PAN is blank', () => {
    expect(slug({ gstins: [g('07', 'AADCD1234K')] })).toBe('private_limited');
  });

  it('D1: a company named Public Limited or OPC keeps that', () => {
    expect(slug({ pan: 'AADCD1234K', nameOrTypedType: 'Hero MotoCorp Public Limited' })).toBe('public_limited');
    expect(slug({ pan: 'AADCD1234K', nameOrTypedType: 'Neha Gupta OPC Private Limited' })).toBe('opc');
  });

  it('D2: P is a proprietorship only with a business registration', () => {
    expect(slug({ pan: 'BAOPG6013Q' })).toBe('individual');
    expect(slug({ pan: 'BAOPG6013Q', hasBusinessRegistration: true })).toBe('proprietorship');
    expect(slug({ pan: 'BAOPG6013Q', gstins: [g('07', 'BAOPG6013Q')] })).toBe('proprietorship');
  });

  it('D3: an F client named LLP is an LLP', () => {
    expect(slug({ pan: 'AADFD1234K', nameOrTypedType: 'Dawon LLP' })).toBe('llp');
    expect(slug({ pan: 'AADFD1234K', nameOrTypedType: 'Dawon L.L.P.' })).toBe('llp');
  });

  it('gives a plain reason', () => {
    expect(firmTypeFromIds({ pan: 'AADCD1234K' })?.reason).toBe(
      'PAN AADCD1234K: 4th letter C means a company.',
    );
  });
});

describe('company names', () => {
  it.each([
    'Drift Logistics Pvt Ltd',
    'Drift Logistics Pvt. Ltd.',
    'Drift Logistics Private Limited',
    'Drift Logistics Pvt Limited',
    'Drift Logistics Private Ltd',
    'Drift Logistics (P) Ltd',
    'Drift Logistics PvtLtd',
    'Drift Logistics Limited',
    'Drift Logistics Pvt',
    'Neha Gupta OPC',
    'Drift Logistics Private Limited (Delhi',
  ])('%s already says it is a company', (name) => {
    expect(hasCompanyForm(name)).toBe(true);
    expect(withCompanySuffix(name, 'private_limited')).toBe(name);
  });

  it('adds Private Limited, keeping a trailing place last', () => {
    expect(withCompanySuffix('Drift Logistics', 'private_limited')).toBe('Drift Logistics Private Limited');
    expect(withCompanySuffix('Drift Logistics (Delhi', 'private_limited')).toBe(
      'Drift Logistics Private Limited (Delhi',
    );
    expect(withCompanySuffix('GRIID - Chandigarh', 'private_limited')).toBe(
      'GRIID Private Limited - Chandigarh',
    );
    expect(withCompanySuffix('Sharma - Sons', 'private_limited')).toBe('Sharma - Sons Private Limited');
  });

  it('leaves other types alone', () => {
    expect(withCompanySuffix('Drift Logistics', 'public_limited')).toBe('Drift Logistics');
    expect(withCompanySuffix('Avtar Woods', 'partnership')).toBe('Avtar Woods');
  });

  it('reads a legal form at the end', () => {
    expect(legalFormOf('Dawon LLP')).toBe('llp');
    expect(legalFormOf('Jatin (Prop)')).toBe('proprietor');
    expect(legalFormOf('Avtar Woods')).toBeNull();
  });
});

describe('gstStateOptions', () => {
  it('lists every state sorted by code', () => {
    const options = gstStateOptions();
    expect(options).toHaveLength(Object.keys(GST_STATES).length);
    expect(options.find((o) => o.code === '07')?.label).toBe('07 · Delhi');
    expect(options.map((o) => o.code)).toEqual([...options.map((o) => o.code)].sort());
  });
});
