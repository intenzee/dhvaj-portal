import { dscEffectiveStatus, dscExpiryBand } from '@hsdg/contracts';
import type { PoolClient } from 'pg';
import { endOfIstDay, withRegisterDscExpiry } from './dsc-register.service';

describe('DSC register helpers', () => {
  it('nudges once in the 30-day band and once in the 7-day band', () => {
    expect(dscExpiryBand(31)).toBeNull();
    expect(dscExpiryBand(30)).toBe(30);
    expect(dscExpiryBand(8)).toBe(30);
    expect(dscExpiryBand(7)).toBe(7);
    expect(dscExpiryBand(0)).toBe(7);
    expect(dscExpiryBand(-1)).toBeNull();
  });

  it('shows an active token past its expiry as expired, and leaves the rest', () => {
    expect(dscEffectiveStatus('active', '2026-11-03', '2026-11-04')).toBe('expired');
    expect(dscEffectiveStatus('active', '2026-11-04', '2026-11-04')).toBe('active');
    expect(dscEffectiveStatus('lost', '2026-01-01', '2026-11-04')).toBe('lost');
    expect(dscEffectiveStatus('returned_to_holder', '2026-01-01', '2026-11-04')).toBe(
      'returned_to_holder',
    );
  });

  it('a token due back on a day is due by the end of that IST day', () => {
    expect(new Date(endOfIstDay('2026-11-04')).toISOString()).toBe('2026-11-04T18:29:59.000Z');
  });

  it('the ROC profile’s DSC expiry yields to the register’s, by DIN', async () => {
    const query = jest
      .fn()
      .mockResolvedValue({ rows: [{ din: '01234567', valid_to: '2028-03-31' }] });
    const client = { query } as unknown as PoolClient;
    const out = await withRegisterDscExpiry(client, [
      { din: '01234567', name: 'A', dscExpiresOn: '2026-12-01' },
      { din: '07654321', name: 'B', dscExpiresOn: '2026-12-01' },
      { din: 'bad', name: 'C' },
    ]);
    expect(out.map((d) => d.dscExpiresOn)).toEqual(['2028-03-31', '2026-12-01', undefined]);
    expect(query.mock.calls[0][1]).toEqual([['01234567', '07654321']]);
  });

  it('asks nothing when no director has a DIN', async () => {
    const query = jest.fn();
    const out = await withRegisterDscExpiry({ query } as unknown as PoolClient, [
      { din: '', name: 'X' },
    ]);
    expect(out).toEqual([{ din: '', name: 'X' }]);
    expect(query).not.toHaveBeenCalled();
  });
});
