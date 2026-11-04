import {
  acceptanceMissing,
  assessmentYearOf,
  copValid,
  partnerLoadSummary,
  signingPartnerOffer,
  taxAuditWarnAt,
} from '@hsdg/contracts';
import { signingRefusal, taxAuditIndependence } from './tax-audit-acceptance.service';

const TODAY = '2026-11-04';
const FY = '2025-26';

describe('tax audit acceptance (F-3)', () => {
  describe('the signing-partner picker', () => {
    it('shows the count against the limit', () => {
      expect(partnerLoadSummary('Deepak', 41, 60, FY)).toBe('Deepak: 41 of 60 for FY 2025-26');
    });

    it('a COP is valid through its last day (IST date)', () => {
      expect(copValid('2026-11-04', TODAY)).toBe(true);
      expect(copValid('2026-11-03', TODAY)).toBe(false);
      expect(copValid(null, TODAY)).toBe(false);
    });

    it('offers a partner with a valid COP and room', () => {
      expect(
        signingPartnerOffer(
          { name: 'Deepak', copValidUntil: '2027-03-31', reports: 41 },
          60,
          FY,
          TODAY,
        ),
      ).toEqual({
        offered: true,
        reason: null,
        summary: 'Deepak: 41 of 60 for FY 2025-26',
        warning: null,
      });
    });

    it('warns from the 50th report, still offering the partner', () => {
      const at = (reports: number, limit = 60) =>
        signingPartnerOffer(
          { name: 'Harvinder', copValidUntil: '2027-03-31', reports },
          limit,
          FY,
          TODAY,
        );
      expect(at(49).warning).toBeNull();
      expect(at(50)).toMatchObject({ offered: true, warning: '50 of 60 — 10 left for FY 2025-26' });
      expect(at(59).warning).toBe('59 of 60 — 1 left for FY 2025-26');
      // A lower firm limit warns ten short of it.
      expect(taxAuditWarnAt(60)).toBe(50);
      expect(taxAuditWarnAt(40)).toBe(30);
      expect(at(30, 40).warning).toBe('30 of 40 — 10 left for FY 2025-26');
    });

    it('refuses a 61st report, with the count', () => {
      const offer = signingPartnerOffer(
        { name: 'Deepak', copValidUntil: '2027-03-31', reports: 60 },
        60,
        FY,
        TODAY,
      );
      expect(offer.offered).toBe(false);
      expect(offer.summary).toBe('Deepak: 60 of 60 for FY 2025-26');
      expect(offer.reason).toContain('60 of 60');
    });

    it('a firm limit lower than 60 binds', () => {
      expect(
        signingPartnerOffer({ name: 'A', copValidUntil: '2027-03-31', reports: 40 }, 40, FY, TODAY)
          .offered,
      ).toBe(false);
    });

    it('the partner already on the audit keeps their place', () => {
      expect(
        signingPartnerOffer(
          { name: 'A', copValidUntil: '2027-03-31', reports: 60 },
          60,
          FY,
          TODAY,
          true,
        ).offered,
      ).toBe(true);
    });

    it('does not offer a partner without a valid COP, and says who fixes it', () => {
      const none = signingPartnerOffer(
        { name: 'B', copValidUntil: null, reports: 0 },
        60,
        FY,
        TODAY,
      );
      expect(none.offered).toBe(false);
      expect(none.reason).toMatch(/No certificate of practice.*administrator/);
      const expired = signingPartnerOffer(
        { name: 'B', copValidUntil: '2026-03-31', reports: 0 },
        60,
        FY,
        TODAY,
        true,
      );
      expect(expired.offered).toBe(false);
      expect(expired.reason).toContain('COP expired on 2026-03-31');
    });
  });

  describe('what stands between the audit and acceptance', () => {
    const ready = {
      independenceOk: true,
      formType: '3CB' as const,
      signingPartnerId: 'p',
      previousAuditorChanged: false,
      previousAuditorName: null,
      previousAuditorLetterDocumentId: null,
      appointmentLetterDocumentId: 'd',
    };

    it('nothing when every step is done', () => {
      expect(acceptanceMissing(ready)).toEqual([]);
    });

    it('a changed auditor needs a name and the written communication', () => {
      expect(acceptanceMissing({ ...ready, previousAuditorChanged: true })).toEqual([
        'Name the previous auditor.',
        'Upload the written communication to the previous auditor.',
      ]);
      expect(
        acceptanceMissing({
          ...ready,
          previousAuditorChanged: true,
          previousAuditorName: 'Old & Co',
          previousAuditorLetterDocumentId: 'l',
        }),
      ).toEqual([]);
    });

    it('lists every open step', () => {
      expect(
        acceptanceMissing({
          independenceOk: false,
          formType: null,
          signingPartnerId: null,
          previousAuditorChanged: null,
          previousAuditorName: null,
          previousAuditorLetterDocumentId: null,
          appointmentLetterDocumentId: null,
        }),
      ).toHaveLength(5);
    });
  });

  describe('independence (s.44AB)', () => {
    const fact = (fact: 'bookkeeping' | 'tax_audit' | 'statutory_audit', fy = FY) => ({
      engagementId: 'e1',
      engagementCode: 'CO/00001',
      financialYear: fy,
      fact,
    });

    it('blocks a tax audit of a year whose books the firm keeps', () => {
      const r = taxAuditIndependence(false, FY, [fact('bookkeeping'), fact('tax_audit')]);
      expect(r.ok).toBe(false);
      expect(r.findings[0]!.message).toContain('books for FY 2025-26 (CO/00001)');
    });

    it('passes when the books are kept for another year only', () => {
      expect(taxAuditIndependence(false, FY, [fact('bookkeeping', '2024-25')])).toEqual({
        ok: true,
        findings: [],
      });
    });

    it('speaks only to s.44AB, not to s.144', () => {
      expect(taxAuditIndependence(true, FY, [fact('statutory_audit')]).findings).toEqual([]);
    });
  });

  it('turns the trigger’s refusal into the message to show', () => {
    expect(
      signingRefusal({
        code: '23514',
        message: 'tax_audit_limit: Deepak has 60 of 60 tax audit reports for FY 2025-26.',
      }),
    ).toBe('Deepak has 60 of 60 tax audit reports for FY 2025-26.');
    expect(signingRefusal({ code: '23514', message: 'other_check' })).toBeNull();
    expect(signingRefusal(new Error('x'))).toBeNull();
  });

  it('the assessment year follows the financial year', () => {
    expect(assessmentYearOf('2025-26')).toBe('2026-27');
    expect(assessmentYearOf('2099-00')).toBe('2100-01');
  });
});
