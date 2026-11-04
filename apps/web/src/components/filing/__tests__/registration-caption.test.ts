import { registrationCaption } from '../registration-caption';

describe('the stream tab registration line names the number once', () => {
  it('TDS: "TAN" and the TAN — not the TAN twice', () => {
    expect(
      registrationCaption({ type: 'tan', number: 'DELA12345B', stateCode: null, gstScheme: null }),
    ).toEqual({ kind: 'TAN', number: 'DELA12345B', extra: null });
  });

  it('GST: "GSTIN", the GSTIN once, then state and scheme', () => {
    expect(
      registrationCaption({
        type: 'gstin',
        number: '07AAACA1234A1Z5',
        stateCode: '07',
        gstScheme: 'regular',
      }),
    ).toEqual({ kind: 'GSTIN', number: '07AAACA1234A1Z5', extra: '07 · regular' });
  });

  it('an unknown kind shows just the number', () => {
    expect(
      registrationCaption({ type: 'other', number: 'X1', stateCode: null, gstScheme: null }).kind,
    ).toBeNull();
  });
});
