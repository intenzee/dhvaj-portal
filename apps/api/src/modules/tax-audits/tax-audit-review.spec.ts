import {
  nextReviewLevel,
  reportObservations,
  signingBlockers,
  startReviewBlockers,
  type TaxAuditObservationKind,
  type TaxAuditObservationStatus,
} from '@hsdg/contracts';
import { reviewLevelOf } from './tax-audit-review.service';

const obs = (
  id: string,
  status: TaxAuditObservationStatus,
  kind: TaxAuditObservationKind | null,
  clauseNo: string | null,
) => ({ id, status, kind, clauseNo });

describe('tax audit review', () => {
  it('reviews the signing Partner at Partner level, a lead Manager at Manager, any Senior up at Senior', () => {
    const at = (role: string, lead = false, employeeId = 'e1') =>
      reviewLevelOf({ employeeId, role, lead }, 'sp');
    expect(at('partner', true, 'sp')).toBe('partner');
    expect(at('partner', true)).toBe('manager');
    expect(at('manager', true)).toBe('manager');
    expect(at('manager')).toBe('senior');
    expect(at('senior', true)).toBe('senior');
    expect(at('article', true)).toBeNull();
    expect(at('admin', true)).toBeNull();
  });

  it('goes Senior, then Manager, then Partner', () => {
    expect(nextReviewLevel([])).toBe('senior');
    expect(nextReviewLevel(['senior'])).toBe('manager');
    expect(nextReviewLevel(['senior', 'manager'])).toBe('partner');
    expect(nextReviewLevel(['senior', 'manager', 'partner'])).toBeNull();
  });

  it('starts only with every clause settled, naming the rest in clause order', () => {
    expect(startReviewBlockers([])).toEqual([]);
    expect(startReviewBlockers(['34', '18', '3'])).toEqual(['Finish clause 3, 18, 34 first.']);
  });

  it('blocks signing on anything open, unconfirmed, undecided or not signed off', () => {
    const clear = {
      unsettled: [],
      unconfirmedDrafts: [],
      openPoints: 0,
      undecided: 0,
      partnerSignedOff: true,
    };
    expect(signingBlockers(clear)).toEqual([]);
    expect(
      signingBlockers({
        unsettled: ['26'],
        unconfirmedDrafts: ['44', '34'],
        openPoints: 2,
        undecided: 1,
        partnerSignedOff: false,
      }),
    ).toEqual([
      'Finish clause 26 first.',
      'Confirm the portal draft on clause 34, 44.',
      'Clear 2 open review points.',
      'Decide 1 flagged matter for the report.',
      'The signing Partner has not signed off the review.',
    ]);
  });

  it('lists accepted entries only: qualifications first, report-wide matters first, then clause order', () => {
    const list = [
      obs('a', 'accepted', 'observation', '34'),
      obs('b', 'dropped', null, '3'),
      obs('c', 'accepted', 'observation', '21'),
      obs('d', 'accepted', 'qualification', '44'),
      obs('e', 'proposed', null, '1'),
      obs('f', 'accepted', 'observation', null),
      obs('g', 'accepted', 'qualification', '13'),
    ];
    expect(reportObservations(list).map((o) => o.id)).toEqual(['g', 'd', 'f', 'c', 'a']);
  });
});
