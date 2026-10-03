import {
  pickClientOwner,
  planStandardPbcList,
  samePbcRequirement,
  type StandardPbcFacts,
} from './pbc-standard-list';

const base: StandardPbcFacts = {
  isCompany: true,
  activityFlags: {
    manufacturing: false,
    trading: false,
    services: true,
    import: false,
    export: false,
    ecommerce: false,
    regulated: false,
  },
  borrowings: 0,
  hasGroupRelationships: false,
  hasSubsidiaries: false,
  initialAudit: false,
  activeWorkAreas: new Set(['schedule_iii_work', 'caro']),
};

const has = (list: { requirement: string }[], word: string) =>
  list.some((r) => r.requirement.toLowerCase().includes(word));

describe('planStandardPbcList (§16)', () => {
  it('always asks for the core records', () => {
    const list = planStandardPbcList(base);
    expect(has(list, 'trial balance')).toBe(true);
    expect(has(list, 'bank statements')).toBe(true);
    expect(has(list, 'gst returns')).toBe(true);
    expect(has(list, 'related parties')).toBe(true);
  });

  it('tailors the list from the client master', () => {
    const services = planStandardPbcList(base);
    expect(has(services, 'inventory')).toBe(false);
    expect(has(services, 'loan sanction')).toBe(false);
    expect(has(services, 'shipping bills')).toBe(false);
    expect(has(services, 'predecessor')).toBe(false);

    const maker = planStandardPbcList({
      ...base,
      activityFlags: { ...base.activityFlags, manufacturing: true, export: true },
      borrowings: 5_00_00_000,
      hasGroupRelationships: true,
      hasSubsidiaries: true,
      initialAudit: true,
    });
    expect(has(maker, 'inventory')).toBe(true);
    expect(has(maker, 'production')).toBe(true);
    expect(has(maker, 'loan sanction')).toBe(true);
    expect(has(maker, 'shipping bills')).toBe(true);
    expect(has(maker, 'group companies')).toBe(true);
    expect(has(maker, 'component financial statements')).toBe(true);
    expect(has(maker, 'predecessor')).toBe(true);
  });

  it('asks about borrowings when the master does not say', () => {
    expect(has(planStandardPbcList({ ...base, borrowings: null }), 'loan sanction')).toBe(true);
  });

  it('skips MCA filings for a non-company', () => {
    expect(has(planStandardPbcList({ ...base, isCompany: false }), 'mca filings')).toBe(false);
  });

  it('links only to work areas active on the file', () => {
    const list = planStandardPbcList(base);
    const tb = list.find((r) => has([r], 'trial balance'))!;
    expect(tb.workAreaKey).toBe('schedule_iii_work');
    const mca = list.find((r) => has([r], 'mca filings'))!;
    expect(mca.workAreaKey).toBeNull(); // auditor_reporting not active
    expect(has(list, 'risk-control matrix')).toBe(false);
    expect(
      has(
        planStandardPbcList({ ...base, activeWorkAreas: new Set(['ifc']) }),
        'risk-control matrix',
      ),
    ).toBe(true);
  });
});

describe('pickClientOwner', () => {
  const contacts = [
    { fullName: 'Asha Rao', designation: 'Director', contactType: 'director', isPrimary: true },
    { fullName: 'Vikram Shah', designation: 'CFO', contactType: 'cfo', isPrimary: false },
    { fullName: 'Neha Jain', designation: null, contactType: 'gst', isPrimary: false },
  ];

  it('picks the contact whose role answers the request', () => {
    expect(pickClientOwner('finance', contacts)).toBe('Vikram Shah (CFO)');
    expect(pickClientOwner('gst', contacts)).toBe('Neha Jain');
    expect(pickClientOwner('secretarial', contacts)).toBe('Asha Rao (Director)');
  });

  it('falls back to the primary contact, then to none', () => {
    expect(pickClientOwner('hr', [contacts[0]!])).toBe('Asha Rao (Director)');
    expect(pickClientOwner('hr', [])).toBeNull();
  });
});

describe('samePbcRequirement', () => {
  it('ignores case and spacing', () => {
    expect(samePbcRequirement('Trial  balance ', 'trial balance')).toBe(true);
    expect(samePbcRequirement('Trial balance', 'Bank statements')).toBe(false);
  });
});
