import type { UnbilledEngagement, UnbilledItem } from '@hsdg/contracts';
import { ageLine, partnersOf, selectedTotal } from '../unbilled';

const item = (key: string, amount: string, ageDays = 0) =>
  ({ key, amount, ageDays }) as UnbilledItem;

describe('PS-206 unbilled fees', () => {
  it('totals the ticked periods only', () => {
    const items = [item('a', '20000.00'), item('b', '20000.00'), item('c', '1.50')];
    expect(selectedTotal(items, new Set(['a', 'c']))).toBe('20001.50');
    expect(selectedTotal(items, new Set())).toBe('0.00');
  });

  it('says how long ago the period ended', () => {
    expect(ageLine(item('a', '1', 0))).toBe('Running');
    expect(ageLine(item('a', '1', 1))).toBe('Ended 1 day ago');
    expect(ageLine(item('a', '1', 47))).toBe('Ended 47 days ago');
  });

  it('lists each partner once, by name', () => {
    const rows = [
      { partnerId: 'b', partnerName: 'Zoya' },
      { partnerId: 'a', partnerName: 'Arun' },
      { partnerId: 'b', partnerName: 'Zoya' },
      { partnerId: null, partnerName: null },
    ] as UnbilledEngagement[];
    expect(partnersOf(rows)).toEqual([
      { id: 'a', name: 'Arun' },
      { id: 'b', name: 'Zoya' },
    ]);
  });
});
