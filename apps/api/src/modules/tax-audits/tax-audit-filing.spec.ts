import { checkUdin, itrWaitReason, reportLodgeReason } from '@hsdg/contracts';
import { recordedDateProblem } from './tax-audit-filing.service';

describe('tax audit sign and file', () => {
  it('takes a UDIN on the signing Partner’s membership number, tidied', () => {
    expect(checkUdin(' 26123456abcdef 1234 ', '123456')).toEqual({ value: '26123456ABCDEF1234' });
    expect(checkUdin('26012345ABCDEF1234', '12345')).toEqual({ value: '26012345ABCDEF1234' });
    expect(checkUdin('26999999ABCDEF1234', '123456')).toEqual({
      error: 'This UDIN is not on the signing Partner’s membership number (123456).',
    });
    expect(checkUdin('26123456ABCDEF12', '123456')).toEqual({
      error: 'A UDIN is 18 characters: 8 digits, 6 letters, 4 digits.',
    });
    // No membership number on the profile: the shape alone.
    expect(checkUdin('26999999ABCDEF1234', null)).toEqual({ value: '26999999ABCDEF1234' });
  });

  it('holds the audit-case ITR until the report is filed', () => {
    expect(itrWaitReason('2025-26', 'review')).toBe(
      'The tax audit report for FY 2025-26 is not filed yet (Review); the ITR waits on it.',
    );
    expect(itrWaitReason('2025-26', 'filed')).toBeNull();
    expect(itrWaitReason('2025-26', 'not_applicable')).toBeNull();
    expect(itrWaitReason('2025-26', null)).toBeNull();
  });

  it('lodges the report’s filing only once the client accepts it (or off the portal)', () => {
    expect(reportLodgeReason('client_accepted')).toBeNull();
    expect(reportLodgeReason('not_started')).toBeNull();
    expect(reportLodgeReason('uploaded')).toMatch(/^The tax audit report is at Uploaded: sign it/);
  });

  it('records dates that happened, in order', () => {
    const after = { date: '2026-10-20', what: 'the upload' };
    expect(recordedDateProblem('2026-10-21', '2026-11-04', after, 'acceptance')).toBeNull();
    expect(recordedDateProblem('2026-10-19', '2026-11-04', after, 'acceptance')).toBe(
      'The acceptance date cannot be before the upload (2026-10-20).',
    );
    expect(recordedDateProblem('2026-11-05', '2026-11-04', after, 'acceptance')).toBe(
      'The acceptance date cannot be in the future.',
    );
    expect(recordedDateProblem('20-10-2026', '2026-11-04', after, 'acceptance')).toBe(
      'The acceptance date must be a date (YYYY-MM-DD).',
    );
  });
});
