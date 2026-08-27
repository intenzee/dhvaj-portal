import { evaluateApplicability, type CatalogueRow, type EntityFacts } from './engagement-components.service';

/** Build a catalogue row with just the fields §11 evaluation reads. */
function comp(partial: Partial<CatalogueRow>): CatalogueRow {
  return {
    id: 'c1',
    service_id: 's1',
    code: 'X',
    name: 'X',
    description: null,
    default_applicability: 'mandatory',
    default_frequency: 'monthly',
    compliance_rule_id: null,
    requires_registration: null,
    applies_to_categories: null,
    ...partial,
  };
}

const facts = (category: string, regs: string[]): EntityFacts => ({
  category,
  activeRegistrations: new Set(regs),
});

describe('evaluateApplicability (§11 fact-driven applicability)', () => {
  it('keeps a registration-gated component applicable when the client holds it', () => {
    const r = evaluateApplicability(
      comp({ requires_registration: ['gstin'], default_applicability: 'mandatory' }),
      facts('company', ['gstin']),
    );
    expect(r.category).toBe('mandatory');
    expect(r.reason).toMatch(/client holds an active GST registration/i);
  });

  it('marks a registration-gated component not_applicable when the client lacks it', () => {
    const r = evaluateApplicability(
      comp({ requires_registration: ['gstin'] }),
      facts('company', ['tan']),
    );
    expect(r.category).toBe('not_applicable');
    expect(r.reason).toMatch(/no active GST registration/i);
  });

  it('honours a category rule: applicable for a company', () => {
    const r = evaluateApplicability(
      comp({ applies_to_categories: ['company', 'llp'], default_applicability: 'recommended' }),
      facts('company', []),
    );
    // recommended surfaces as "applicable" in discovery categories.
    expect(r.category).toBe('applicable');
    expect(r.reason).toMatch(/company entity/i);
  });

  it('honours a category rule: not_applicable for an individual', () => {
    const r = evaluateApplicability(
      comp({ applies_to_categories: ['company', 'llp'] }),
      facts('individual', []),
    );
    expect(r.category).toBe('not_applicable');
    expect(r.reason).toMatch(/applies to company \/ llp entities only/i);
  });

  it('falls back to the catalogue default when there is no fact rule', () => {
    const r = evaluateApplicability(
      comp({ default_applicability: 'optional' }),
      facts('individual', []),
    );
    expect(r.category).toBe('optional');
    expect(r.reason).toMatch(/optional/i);
  });

  it('passes when any one of several required registrations is present', () => {
    const r = evaluateApplicability(
      comp({ requires_registration: ['gstin', 'tan'] }),
      facts('company', ['tan']),
    );
    expect(r.category).toBe('mandatory');
  });
});
