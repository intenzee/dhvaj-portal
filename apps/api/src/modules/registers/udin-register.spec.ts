import { udinGeneratedLate, udinMembershipNo, udinWindowEnd } from '@hsdg/contracts';
import { csvCell, pendingItem, type PendingRow } from './udin-register.service';

describe('UDIN register helpers', () => {
  it('reads the membership no. inside a UDIN', () => {
    expect(udinMembershipNo('26123456ABCDE12345')).toBe('123456');
  });

  it('the window ends windowDays after signing; a UDIN after it is late', () => {
    expect(udinWindowEnd('2026-09-01', 60)).toBe('2026-10-31');
    expect(udinGeneratedLate('2026-09-01', '2026-10-31', 60)).toBe(false);
    expect(udinGeneratedLate('2026-09-01', '2026-11-01', 60)).toBe(true);
  });

  it('quotes CSV cells and defuses formulas', () => {
    expect(csvCell('Acme Ltd')).toBe('Acme Ltd');
    expect(csvCell('Acme, Ltd')).toBe('"Acme, Ltd"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  });

  const row: PendingRow = {
    source_kind: 'tax_audit',
    source_id: 's1',
    document_kind: 'tax_audit',
    entity_id: 'ent',
    entity_name: 'Acme',
    engagement_id: 'eng',
    engagement_code: 'E-1',
    engagement_kind: 'compliance',
    financial_year: '2025-26',
    partner_id: 'p1',
    partner_name: 'Partner A',
    signed_on: '2026-09-01',
    window_ends_on: '2026-10-31',
    days_left: -4,
  };

  it('a tax audit signed without one links to its tax audit tab, overdue', () => {
    expect(pendingItem(row)).toMatchObject({
      sourceKind: 'tax_audit',
      daysLeft: -4,
      overdue: true,
      signingPartnerName: 'Partner A',
      link: { engagementId: 'eng', stream: 'tax_audit', financialYear: '2025-26' },
    });
  });

  it('an archived audit file links to its engagement, still open', () => {
    const p = pendingItem({
      ...row,
      source_kind: 'archive',
      document_kind: 'audit_report',
      days_left: 3,
    });
    expect(p.overdue).toBe(false);
    expect(p.link).toEqual({ engagementId: 'eng', engagementKind: 'compliance' });
  });
});
