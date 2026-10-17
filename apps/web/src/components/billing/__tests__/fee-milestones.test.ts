import { MILESTONE_STATUS, milestoneInputError } from '../fee-milestones-model';
import { SOURCE_LABEL, setAsideLine } from '../unbilled';

const ok = {
  kind: 'milestone' as const,
  description: 'Valuation',
  amount: '75000',
  dueOn: '2026-11-30',
};

describe('PS-206 fee milestones and set-aside fees', () => {
  it('checks a new fee before it is sent', () => {
    expect(milestoneInputError(ok)).toBeNull();
    expect(milestoneInputError({ ...ok, amount: '75000.50' })).toBeNull();
    expect(milestoneInputError({ ...ok, description: '  ' })).toMatch(/what the fee/);
    expect(milestoneInputError({ ...ok, amount: '0' })).toMatch(/above zero/);
    expect(milestoneInputError({ ...ok, amount: '1.234' })).toMatch(/above zero/);
    expect(milestoneInputError({ ...ok, amount: '-5' })).toMatch(/above zero/);
    expect(milestoneInputError({ ...ok, dueOn: '' })).toMatch(/date/);
  });

  it('labels every status and source', () => {
    expect(MILESTONE_STATUS.due.label).toBe('Unbilled');
    expect(MILESTONE_STATUS.billed.tone).toBe('success');
    expect(SOURCE_LABEL.milestone).toBe('Milestone fee');
  });

  it('says why and who set a period aside', () => {
    expect(
      setAsideLine({ reason: 'Billed in Tally', byName: 'Asha Rao', at: '2026-10-03T06:00:00Z' }),
    ).toBe('Billed in Tally — Asha Rao, 03 Oct 2026');
    expect(setAsideLine({ reason: 'Waived', byName: null, at: '' })).toBe('Waived');
  });
});
