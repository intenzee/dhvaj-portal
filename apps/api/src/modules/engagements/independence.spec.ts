import {
  evaluateIndependence,
  independenceBlock,
  unacknowledged,
  type IndependenceFact,
  type IndependenceProposal,
} from './independence';

const fact = (
  f: IndependenceFact['fact'],
  financialYear = '2026-27',
  engagementCode = f === 'statutory_audit' ? 'SA/00012' : 'CR/00003',
  engagementId = engagementCode,
): IndependenceFact => ({ engagementId, engagementCode, financialYear, fact: f });

const compliance = (
  streams: IndependenceProposal['streams'],
  over: Partial<IndependenceProposal> = {},
): IndependenceProposal => ({
  isCompany: true,
  kind: 'compliance',
  financialYears: ['2026-27'],
  streams,
  ...over,
});

const rules = (p: IndependenceProposal, facts: IndependenceFact[]) =>
  evaluateIndependence(p, facts).map((f) => `${f.rule}:${f.outcome}`);

describe('independence guard matrix (entity type × streams × open audit)', () => {
  describe('s.144 — a company the firm audits', () => {
    const audit = [fact('statutory_audit')];

    it.each([['bookkeeping'], ['mis']] as const)('blocks adding the %s stream', (stream) => {
      const [f] = evaluateIndependence(compliance([stream]), audit);
      expect(f).toMatchObject({
        rule: 'S144_PROHIBITED_SERVICE',
        outcome: 'block',
        financialYear: '2026-27',
      });
      expect(f!.message).toMatch(/Section 144 of the Companies Act, 2013/);
      expect(f!.message).toMatch(/FY 2026-27 \(SA\/00012\)/);
    });

    it('blocks an internal audit assignment', () => {
      const p: IndependenceProposal = {
        isCompany: true,
        kind: 'assignment',
        financialYears: ['2026-27'],
        serviceCodes: ['INT_AUDIT'],
      };
      expect(rules(p, audit)).toEqual(['S144_PROHIBITED_SERVICE:block']);
    });

    it('only for an overlapping year', () => {
      expect(rules(compliance(['bookkeeping']), [fact('statutory_audit', '2025-26')])).toEqual([]);
      const twoYears = compliance(['bookkeeping'], { financialYears: ['2026-27', '2027-28'] });
      expect(rules(twoYears, [fact('statutory_audit', '2027-28')])).toEqual([
        'S144_PROHIBITED_SERVICE:block',
      ]);
    });

    it('warns on permitted filing streams without the approval reference', () => {
      const [f] = evaluateIndependence(compliance(['gst', 'tds']), audit);
      expect(f).toMatchObject({ rule: 'S144_PERMITTED_SERVICE_APPROVAL', outcome: 'warn' });
      expect(f!.message).toMatch(/GST, TDS \/ TCS are permitted/);
    });

    it('passes permitted streams once the approval is recorded', () => {
      const p = compliance(['income_tax', 'roc'], { s144ApprovalRef: 'BR/2026/14' });
      expect(rules(p, audit)).toEqual(['S144_PERMITTED_SERVICE_APPROVAL:pass']);
    });

    it('a blank approval reference still warns', () => {
      expect(rules(compliance(['gst'], { s144ApprovalRef: '  ' }), audit)).toEqual([
        'S144_PERMITTED_SERVICE_APPROVAL:warn',
      ]);
    });

    it('a mix blocks and warns together', () => {
      expect(rules(compliance(['gst', 'bookkeeping']), audit)).toEqual([
        'S144_PROHIBITED_SERVICE:block',
        'S144_PERMITTED_SERVICE_APPROVAL:warn',
      ]);
    });
  });

  describe('s.144 reverse — taking the audit of a company we serve', () => {
    const sa: IndependenceProposal = {
      isCompany: true,
      kind: 'statutory_audit',
      financialYears: ['2026-27'],
    };

    it.each([['bookkeeping'], ['mis'], ['internal_audit']] as const)(
      'blocks while %s is in scope for the year',
      (f) => {
        const [finding] = evaluateIndependence(sa, [fact(f)]);
        expect(finding).toMatchObject({
          rule: 'S144_AUDIT_WITH_PROHIBITED_SERVICE',
          outcome: 'block',
        });
        expect(finding!.message).toMatch(/End it for those years/);
      },
    );

    it('allows the audit when the stream is for another year, or only filing streams run', () => {
      expect(rules(sa, [fact('bookkeeping', '2025-26')])).toEqual([]);
      expect(rules(sa, [fact('compliance')])).toEqual([]);
    });
  });

  describe('a company the firm does not audit', () => {
    it('allows every stream', () => {
      expect(
        rules(compliance(['mis', 'bookkeeping', 'gst', 'tds', 'income_tax', 'roc']), []),
      ).toEqual([]);
    });
  });

  describe('non-company clients', () => {
    const firmAudit: IndependenceProposal = {
      isCompany: false,
      kind: 'statutory_audit',
      financialYears: ['2026-27'],
    };

    it('s.144 does not apply to bookkeeping for a firm we audit', () => {
      expect(
        rules(compliance(['bookkeeping'], { isCompany: false }), [fact('statutory_audit')]),
      ).toEqual([]);
    });

    it('a statutory audit of a firm warns and needs the partner to acknowledge', () => {
      const findings = evaluateIndependence(firmAudit, []);
      expect(findings).toEqual([
        expect.objectContaining({
          rule: 'NON_COMPANY_AUDIT_ACK',
          outcome: 'warn',
          requiresAcknowledgement: true,
        }),
      ]);
      expect(unacknowledged(findings)).toHaveLength(1);
      expect(unacknowledged(findings, ['NON_COMPANY_AUDIT_ACK'])).toEqual([]);
      expect(independenceBlock(findings)).toBeNull();
    });

    it('nor does it block the audit of a firm whose books we keep', () => {
      expect(rules(firmAudit, [fact('bookkeeping')])).toEqual(['NON_COMPANY_AUDIT_ACK:warn']);
    });
  });

  describe('s.44AB — tax audit by the firm that keeps the books (any entity)', () => {
    it.each([[true], [false]])(
      'blocks adding bookkeeping during a tax audit (company=%s)',
      (isCompany) => {
        expect(
          rules(compliance(['bookkeeping'], { isCompany }), [
            fact('tax_audit', '2026-27', 'AS/00040'),
          ]),
        ).toEqual(['TAX_AUDIT_BY_BOOKKEEPER:block']);
      },
    );

    it('blocks a tax audit while the books are kept, and names the engagement', () => {
      const p: IndependenceProposal = {
        isCompany: false,
        kind: 'assignment',
        financialYears: ['2026-27'],
        serviceCodes: ['TAX_AUDIT'],
      };
      const [f] = evaluateIndependence(p, [fact('bookkeeping')]);
      expect(f).toMatchObject({ rule: 'TAX_AUDIT_BY_BOOKKEEPER', outcome: 'block' });
      expect(f!.message).toMatch(/keeps this client's books for FY 2026-27 \(CR\/00003\)/);
    });

    it('allows a tax audit with only filing streams in scope', () => {
      const p: IndependenceProposal = {
        isCompany: false,
        kind: 'assignment',
        financialYears: ['2026-27'],
        serviceCodes: ['TAX_AUDIT'],
      };
      expect(rules(p, [fact('compliance')])).toEqual([]);
    });
  });

  it('an engagement is never in conflict with itself', () => {
    const own = fact('bookkeeping', '2026-27', 'CR/00003', 'eng-1');
    const audit = fact('statutory_audit');
    const p = compliance(['bookkeeping', 'mis'], { isCompany: true, engagementId: 'eng-1' });
    expect(rules(p, [own])).toEqual([]);
    expect(independenceBlock(evaluateIndependence(p, [own, audit]))).toMatchObject({
      rule: 'S144_PROHIBITED_SERVICE',
    });
  });

  it('lists several conflicting years in order', () => {
    const p = compliance(['mis'], { financialYears: ['2026-27', '2025-26'] });
    const [f] = evaluateIndependence(p, [
      fact('statutory_audit', '2026-27', 'SA/00031'),
      fact('statutory_audit', '2025-26', 'SA/00012'),
    ]);
    expect(f!.financialYear).toBe('2025-26');
    expect(f!.message).toMatch(/FY 2025-26 \(SA\/00012\) and FY 2026-27 \(SA\/00031\)/);
  });
});
