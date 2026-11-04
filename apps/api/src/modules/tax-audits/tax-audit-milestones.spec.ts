import {
  DEFAULT_TAX_AUDIT_MILESTONE_OFFSETS,
  canSeeTaxAuditBoard,
  isoDaysBefore,
  section271BExposure,
  taxAuditBoardBucket,
  taxAuditMilestoneOffsets,
  taxAuditMilestonePlan,
  type TaxAuditMilestoneFacts,
} from '@hsdg/contracts';
import { ownerOf, type MilestoneAuditRow } from './tax-audit-milestones.service';

const TODAY = '2026-09-01';
const facts = (over: Partial<TaxAuditMilestoneFacts> = {}): TaxAuditMilestoneFacts => ({
  stage: 'not_started',
  dueDate: '2026-10-31',
  applicabilityDecided: false,
  acceptedAt: null,
  signedAt: null,
  ticked: {},
  ...over,
});
const plan = (over: Partial<TaxAuditMilestoneFacts> = {}, today = TODAY) =>
  Object.fromEntries(
    taxAuditMilestonePlan(facts(over), DEFAULT_TAX_AUDIT_MILESTONE_OFFSETS, today).map((p) => [
      p.key,
      p,
    ]),
  );

describe('taxAuditMilestonePlan (F-9)', () => {
  it('counts each date back from the due date by the firm’s offsets', () => {
    const p = plan();
    expect(p.applicability!.dueOn).toBe('2026-08-02');
    expect(p.accepted!.dueOn).toBe('2026-08-17');
    expect(p.info_received!.dueOn).toBe('2026-09-01');
    expect(p.client_accepted!.dueOn).toBe('2026-10-29');
    expect(isoDaysBefore('2026-03-01', 1)).toBe('2026-02-28');
  });

  it('marks a milestone missed only once its date has passed and it is not done', () => {
    const p = plan();
    expect(p.applicability).toMatchObject({ missed: true, done: false });
    // Due today is not yet missed.
    expect(p.info_received).toMatchObject({ missed: false, done: false });
    expect(plan({ dueDate: null }).applicability).toMatchObject({ dueOn: null, missed: false });
  });

  it('takes a milestone as done once the stage is past it, or on its own date', () => {
    const p = plan({ stage: 'clause_work' });
    expect(p.applicability!.done).toBe(true);
    expect(p.accepted!.done).toBe(true);
    expect(p.info_requests!.done).toBe(true);
    expect(p.info_received!.done).toBe(true);
    expect(p.clause_work!.done).toBe(false);
    expect(plan({ applicabilityDecided: true }).applicability!.done).toBe(true);
    expect(plan({ acceptedAt: '2026-08-01T00:00:00Z' }).accepted!.done).toBe(true);
    expect(plan({ ticked: { review: '2026-08-30T00:00:00Z' } }).review!.done).toBe(true);
    expect(Object.values(plan({ stage: 'filed' })).every((m) => m.done)).toBe(true);
    expect(
      taxAuditMilestonePlan(
        facts({ stage: 'not_applicable' }),
        DEFAULT_TAX_AUDIT_MILESTONE_OFFSETS,
        TODAY,
      ),
    ).toEqual([]);
  });

  it('keeps the firm’s offsets to whole days 0–365, defaulting the rest', () => {
    expect(taxAuditMilestoneOffsets({ review: 20, signed: -1, uploaded: 2.5, junk: 3 })).toEqual({
      ...DEFAULT_TAX_AUDIT_MILESTONE_OFFSETS,
      review: 20,
    });
    expect(taxAuditMilestoneOffsets(null)).toEqual(DEFAULT_TAX_AUDIT_MILESTONE_OFFSETS);
  });
});

describe('section271BExposure', () => {
  it('is 0.5% of turnover, up to ₹1.5 lakh', () => {
    expect(section271BExposure(25_000_000)).toBe(125_000);
    expect(section271BExposure(100_000_000)).toBe(150_000);
    expect(section271BExposure(null)).toBeNull();
  });
});

describe('the board', () => {
  it('buckets stages as Not started, In progress and Completed', () => {
    expect(taxAuditBoardBucket('not_started')).toBe('not_started');
    expect(taxAuditBoardBucket('review')).toBe('in_progress');
    expect(taxAuditBoardBucket('filed')).toBe('completed');
    expect(taxAuditBoardBucket('not_applicable')).toBeNull();
  });

  it('is for the Managing Partner and Partners', () => {
    expect(canSeeTaxAuditBoard('managing_partner')).toBe(true);
    expect(canSeeTaxAuditBoard('partner')).toBe(true);
    expect(canSeeTaxAuditBoard('manager')).toBe(false);
    expect(canSeeTaxAuditBoard(undefined)).toBe(false);
  });
});

describe('ownerOf', () => {
  const row = {
    manager_id: 'm',
    manager_name: 'Manager X',
    partner_id: 'p',
    partner_name: 'Partner A',
    senior_id: 's',
    senior_name: 'Senior Y',
    marks: { review: { doneAt: null, doneByName: null, ownerId: 'n', ownerName: 'Named' } },
  } as unknown as MilestoneAuditRow;

  it('gives the role’s person, unless the firm named someone', () => {
    expect(ownerOf(row, 'applicability', 'manager')).toEqual({
      id: 'm',
      name: 'Manager X',
      named: false,
    });
    expect(ownerOf(row, 'signed', 'signing_partner').id).toBe('p');
    expect(ownerOf(row, 'uploaded', 'senior').id).toBe('s');
    expect(ownerOf(row, 'review', 'manager')).toEqual({ id: 'n', name: 'Named', named: true });
  });
});
