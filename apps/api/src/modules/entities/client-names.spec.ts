import { gstinCheckChar, guessStateCode } from '@hsdg/contracts';
import {
  officesOfOneBusiness,
  formsConflict,
  matchNames,
  parseClientName,
  sameClient,
  similarNames,
  type ClientIdentity,
} from './client-names';

describe('guessStateCode', () => {
  it('reads states, cities and typos set apart as a place', () => {
    expect(guessStateCode('Delhi')).toBe('07');
    expect(guessStateCode('Chandigarh')).toBe('04');
    expect(guessStateCode('Gurjrat')).toBe('24');
    expect(guessStateCode('Gujrat')).toBe('24');
    expect(guessStateCode('Mohali')).toBe('03');
    expect(guessStateCode('Panchkula')).toBe('06');
    expect(guessStateCode('Chandigrah')).toBe('04');
    expect(guessStateCode('Maharastra')).toBe('27');
  });

  it('does not read a form, a person or a short word as a place', () => {
    expect(guessStateCode('HUF')).toBeNull();
    expect(guessStateCode('Firm')).toBeNull();
    expect(guessStateCode('Prop')).toBeNull();
    expect(guessStateCode('Jatin Dagar')).toBeNull();
    expect(guessStateCode('India')).toBeNull();
    expect(guessStateCode('Impex')).toBeNull();
  });
});

describe('parseClientName', () => {
  const p = (raw: string) => {
    const n = parseClientName(raw);
    return { core: n.core, form: n.form, place: n.place?.state ?? null, qualifier: n.qualifier };
  };

  it('takes the legal form off, however it is written', () => {
    expect(p('3Aces Technologies - Firm')).toEqual({
      core: '3Aces Technologies',
      form: 'firm',
      place: null,
      qualifier: null,
    });
    expect(p('3Aces Technologies Private Limited').form).toBe('company');
    expect(p('Aveer Green PrivateLimited')).toMatchObject({ core: 'Aveer Green', form: 'company' });
    expect(p('Dawon Drone India Pvt Ltd')).toMatchObject({
      core: 'Dawon Drone India',
      form: 'company',
    });
    expect(p('Drift Logistics Pvt. Ltd.')).toMatchObject({
      core: 'Drift Logistics',
      form: 'company',
    });
    expect(p('Sharma Exports (P) Ltd')).toMatchObject({ core: 'Sharma Exports', form: 'company' });
    expect(p('Dawon LLP')).toMatchObject({ core: 'Dawon', form: 'llp' });
    expect(p('Avtar Woods- Firm')).toMatchObject({ core: 'Avtar Woods', form: 'firm' });
    expect(p('Ram Kumar (HUF)')).toMatchObject({ core: 'Ram Kumar', form: 'huf' });
    expect(p('Neha Gupta OPC Private Limited')).toMatchObject({
      core: 'Neha Gupta',
      form: 'company',
    });
    expect(p('M/s Hasol Impex Private Limited')).toMatchObject({
      core: 'Hasol Impex',
      form: 'company',
    });
  });

  it('keeps words that are part of the name', () => {
    expect(p('Deepak G Gupta & Associates').core).toBe('Deepak G Gupta & Associates');
    expect(p('HSDG & Associates').core).toBe('HSDG & Associates');
    expect(p('Global Impex').core).toBe('Global Impex');
    expect(p('Dawon Drone India Pvt Ltd').core).toBe('Dawon Drone India');
    expect(p('Punjab State Legal Service- Chandigarh')).toMatchObject({
      core: 'Punjab State Legal Service',
      place: '04',
    });
    expect(p('Limited')).toMatchObject({ core: 'Limited', form: null });
  });

  it('takes a place off after a dash, a comma or a bracket, closed or not', () => {
    expect(p('GRIID- Chandigarh')).toMatchObject({ core: 'GRIID', place: '04' });
    expect(p('Khatri RoadLines (Gurjrat)')).toMatchObject({
      core: 'Khatri RoadLines',
      place: '24',
    });
    expect(p('Drifts Logistics Private Limited (Delhi')).toMatchObject({
      core: 'Drifts Logistics',
      form: 'company',
      place: '07',
    });
    expect(p('Bharat Traders, Mumbai')).toMatchObject({ core: 'Bharat Traders', place: '27' });
    expect(p('Mohan Stores Pvt Ltd - Pune')).toMatchObject({
      core: 'Mohan Stores',
      form: 'company',
      place: '27',
    });
  });

  it('reads the proprietor after a dash', () => {
    expect(p('Jai Hanuman- Jatin Dagar (Prop)')).toEqual({
      core: 'Jai Hanuman',
      form: 'proprietor',
      place: null,
      qualifier: 'Jatin Dagar',
    });
    expect(p('Sharma - Sons')).toMatchObject({ core: 'Sharma - Sons', qualifier: null });
  });
});

describe('formsConflict', () => {
  it('lets loose forms pass and keeps strict ones apart', () => {
    expect(formsConflict('company', 'llp')).toBe(true);
    expect(formsConflict('company', 'huf')).toBe(true);
    expect(formsConflict('firm', 'company')).toBe(false);
    expect(formsConflict('proprietor', 'company')).toBe(false);
    expect(formsConflict('firm_or_llp', 'llp')).toBe(false);
    expect(formsConflict('firm_or_llp', 'company')).toBe(true);
    expect(formsConflict(null, 'company')).toBe(false);
  });
});

describe('matchNames', () => {
  const m = (a: string, b: string) => matchNames(parseClientName(a), parseClientName(b));
  it('folds plurals, typos and the proprietor', () => {
    expect(m('3Aces Technologies - Firm', '3Aces Technologies Private Limited')).toBe('equal');
    expect(m('3Aces Technology', '3Aces Technologies - Firm')).toBe('equal');
    expect(m('Director of Estates', 'Director of estate')).toBe('equal');
    expect(m('Drift Logistics Private Limited', 'Drifts Logistics Private Limited (Delhi')).toBe(
      'equal',
    );
    expect(m('GRIID', 'GRIID- Chandigarh')).toBe('equal');
    expect(m('Cosmotrendez', 'Cosmotrendz')).toBe('typo');
    expect(m('Jatin Dagar', 'Jai Hanuman- Jatin Dagar (Prop)')).toBe('proprietor');
    expect(m('Dawon LLP', 'Dawon Drone India Pvt Ltd')).toBe('prefix');
    expect(m('Global Impex', 'Gopal Eng works')).toBe('none');
  });
});

describe('similarNames', () => {
  it('knows names that are probably the same client', () => {
    expect(similarNames('Drift Logistics Pvt. Ltd.', 'drift logistics')).toBe(true);
    expect(similarNames('Cosmotrendez', 'Cosmotrendz')).toBe(true);
    expect(similarNames('GRIID Chandigarh', 'griid')).toBe(true);
    expect(similarNames('aveer green', 'aveer')).toBe(true);
    expect(similarNames('DRIFTS LOGISTICS PRIVATE LIMITED', 'Drift')).toBe(false);
    expect(similarNames('Ricky', 'Rocky')).toBe(false);
    expect(similarNames('Jai hanuman', 'Jaynat Gupta')).toBe(false);
    expect(similarNames('Jaynat Gupta', 'Jayant Gupta')).toBe(true);
    expect(similarNames('aveer green', 'Aveer Green PrivateLimited')).toBe(true);
    expect(similarNames('Director of estate', 'Director of Estates')).toBe(true);
    expect(similarNames('ABC Traders', 'ABC')).toBe(false);
  });

  it('keeps apart names whose legal forms cannot be one entity', () => {
    expect(similarNames('Dawon LLP', 'Dawon Drone India Pvt Ltd')).toBe(false);
    expect(similarNames('3Aces Technologies - Firm', '3Aces Technologies Private Limited')).toBe(
      true,
    );
    expect(similarNames('GRIID', 'GRIID- Chandigarh')).toBe(true);
  });
});

describe('sameClient — the DHVAJ client master', () => {
  // The rows of the firm's workbook that look alike, as the portal holds them.
  const aces: ClientIdentity = {
    name: '3Aces Technologies - Firm',
    pan: 'AADCZ0569K',
    gstins: ['07AADCZ0569K1ZX'],
  };
  const acesPvt: ClientIdentity = {
    name: '3Aces Technologies Private Limited',
    gstins: ['07AADCZ0569K1Z-X'],
  };
  const acesProp: ClientIdentity = { name: '3Aces Technology', pan: 'BAOPG6013Q' };

  it('calls one PAN one client, whatever the suffix', () => {
    const r = sameClient(aces, acesPvt);
    expect(r.verdict).toBe('same');
    expect(r.reasons[0]).toMatch(/07AADCZ0569K1ZX/);
    expect(sameClient(acesPvt, { name: 'Anything', pan: 'AADCZ0569K' }).verdict).toBe('same');
    expect(
      sameClient({ name: 'X', tan: 'delk12345a' }, { name: 'Y', tan: 'DELK12345A' }).verdict,
    ).toBe('same');
  });

  it('calls different PANs different clients, however alike the names', () => {
    const r = sameClient(acesProp, aces);
    expect(r.verdict).toBe('different');
    expect(r.reasons[0]).toMatch(/BAOPG6013Q and AADCZ0569K/);
    expect(
      sameClient(
        { name: 'Khatri RoadLines', pan: 'AAHCD1679C', gstins: ['07AAHCD1679C1ZR'] },
        { name: 'Khatri RoadLines (Gurjrat)', pan: 'AAXCA7265K', gstins: ['07AAXCA7265K1ZV'] },
      ).verdict,
    ).toBe('different');
  });

  it('calls an LLP and a company different clients', () => {
    const r = sameClient({ name: 'Dawon LLP' }, { name: 'Dawon Drone India Pvt Ltd' });
    expect(r.verdict).toBe('different');
    expect(r.reasons[0]).toMatch(/an LLP .* a company/);
  });

  it('calls look-alike names without IDs probable, and says what is missing', () => {
    const drift = sameClient(
      { name: 'Drift Logistics Private Limited', pan: 'BFNPD1986H', gstins: ['07BFNPD1986H2Z6'] },
      { name: 'Drifts Logistics Private Limited (Delhi' },
    );
    expect(drift.verdict).toBe('probable');
    expect(drift.reasons.join(' ')).toMatch(/Only Drift Logistics Private Limited has a PAN/);
    expect(sameClient({ name: 'Cosmotrendez' }, { name: 'Cosmotrendez' }).verdict).toBe('probable');
    expect(
      sameClient({ name: 'Director of Estates' }, { name: 'Director of estate' }).verdict,
    ).toBe('probable');
    expect(sameClient({ name: 'GRIID' }, { name: 'GRIID- Chandigarh' }).verdict).toBe('probable');
    expect(sameClient({ name: 'aveer' }, { name: 'Aveer Green PrivateLimited' }).verdict).toBe(
      'possible',
    );
  });

  it('notes a different place as a second registration, not a second client', () => {
    const r = sameClient({ name: 'Bharat Traders (Delhi)' }, { name: 'Bharat Traders - Mumbai' });
    expect(r.verdict).toBe('probable');
    expect(r.reasons.join(' ')).toMatch(/Delhi, Maharashtra/);
  });

  it('keeps unrelated names apart', () => {
    expect(sameClient({ name: 'Global Impex' }, { name: 'Gopal Eng works' }).verdict).toBe(
      'different',
    );
    expect(sameClient({ name: 'Ricky' }, { name: 'Rocky' }).verdict).toBe('different');
  });

  it('finds exactly the likely duplicates among the 42 rows', () => {
    const rows: ClientIdentity[] = [
      aces,
      acesPvt,
      acesProp,
      { name: 'Akhil Awana', pan: 'BRFPA4763B', gstins: ['07BRFPA4763B1Z8'] },
      { name: 'Aveer Green PrivateLimited' },
      { name: 'Avtar Woods- Firm' },
      { name: 'BD Global Services' },
      { name: 'Cosmotrendez', pan: 'AAHCC8658G', tan: 'KNPC01874F' },
      { name: 'Cosmotrendez', gstins: ['290IOIJDLKNASLD'] },
      { name: 'Darshan Tours' },
      { name: 'Dawon Drone India Pvt Ltd' },
      { name: 'Dawon LLP' },
      { name: 'Deepak G Gupta & Associates' },
      { name: 'Design Module Private Limited' },
      { name: 'Director of Estates' },
      { name: 'Director of estate' },
      { name: 'Drift Logistics Private Limited', pan: 'BFNPD1986H', gstins: ['07BFNPD1986H2Z6'] },
      { name: 'Drifts Logistics Private Limited (Delhi' },
      { name: 'GRIID' },
      { name: 'GRIID- Chandigarh' },
      { name: 'Gensync Brat Media', pan: 'BNOPG4472L', gstins: ['07BNOPG4472L1ZI'] },
      { name: 'Global Impex' },
      { name: 'Gopal Eng works' },
      { name: 'Gumlabs' },
      { name: 'HSDG & Associates', pan: 'AVGPS9971B', gstins: ['07AVGPS9971B1Z6'] },
      { name: 'Harneet Kaur' },
      { name: 'Hasol Impex Private Limited' },
      { name: 'Homes N Beyond', tan: 'MRTH04896D' },
      { name: 'Jai Hanuman- Jatin Dagar (Prop)' },
      { name: 'Jayant Gupta', pan: 'AEOPG9255P' },
      {
        name: 'Khatri RoadLines',
        pan: 'AAHCD1679C',
        gstins: ['07AAHCD1679C1ZR', '07AAGFK6007R1ZW'],
        tan: 'DELD21856C',
      },
      {
        name: 'Khatri RoadLines (Gurjrat)',
        pan: 'AAXCA7265K',
        gstins: ['07AAXCA7265K1ZV'],
        tan: 'DELA69160A',
      },
      { name: 'Kumar Gaurav', pan: 'AHNPC0744K', gstins: ['07AZWPG4860B1Z8'] },
      { name: 'Malkit Singh', pan: 'APHPA8643K', gstins: ['20APHPA8643K2Z0'] },
      { name: 'Mimoo Innovation' },
      { name: 'ONS Financial Services' },
      { name: 'Prime Forensic Investigation Services' },
      { name: 'Punjab State Legal Service- Chandigarh' },
      { name: 'RamJay Ventures' },
      { name: 'Ricky' },
      { name: 'Samid Ansari' },
      { name: 'SmartSafe Console', pan: 'AYKPC5668A', gstins: ['07AYKPC5668A1ZK'] },
    ];
    const found: string[] = [];
    for (let i = 0; i < rows.length; i += 1)
      for (let j = i + 1; j < rows.length; j += 1) {
        const { verdict } = sameClient(rows[i]!, rows[j]!);
        if (verdict !== 'different') found.push(`${verdict}: ${rows[i]!.name} / ${rows[j]!.name}`);
      }
    expect(found).toEqual([
      'same: 3Aces Technologies - Firm / 3Aces Technologies Private Limited',
      'probable: Cosmotrendez / Cosmotrendez',
      'probable: Director of Estates / Director of estate',
      'probable: Drift Logistics Private Limited / Drifts Logistics Private Limited (Delhi',
      'probable: GRIID / GRIID- Chandigarh',
    ]);
  });
});

describe('officesOfOneBusiness (CM-6)', () => {
  const gst = (state: string, pan: string): string => {
    const first14 = `${state}${pan}1Z`;
    return `${first14}${gstinCheckChar(first14)}`;
  };
  it('reads a name with a place beside the plain name as an office, PAN or no PAN', () => {
    const r = officesOfOneBusiness({ name: 'GRIID- Chandigarh' }, { name: 'GRIID' });
    expect(r?.[0]).toMatch(/"GRIID- Chandigarh" is "GRIID" with a place \(Chandigarh\)/);
  });
  it('reads one name for two places as offices', () => {
    expect(
      officesOfOneBusiness({ name: 'ABC Traders (Delhi)' }, { name: 'ABC Traders - Gujarat' }),
    ).not.toBeNull();
  });
  it('reads one PAN in two states as offices', () => {
    const r = officesOfOneBusiness(
      { name: 'Drift Logistics', pan: 'AADCD1234K', gstins: [gst('27', 'AADCD1234K')] },
      { name: 'Drift Logistics Pvt Ltd', gstins: [gst('07', 'AADCD1234K')] },
    );
    expect(r?.[0]).toMatch(/different states/);
  });
  it('leaves a shared GSTIN, two PANs and the same name without a place to the duplicate check', () => {
    expect(
      officesOfOneBusiness(
        { name: 'GRIID - Delhi', gstins: [gst('07', 'AADCD1234K')] },
        { name: 'GRIID', gstins: [gst('07', 'AADCD1234K')] },
      ),
    ).toBeNull();
    expect(
      officesOfOneBusiness(
        { name: 'GRIID - Delhi', pan: 'AADCD1234K' },
        { name: 'GRIID', pan: 'BAOPG6013Q' },
      ),
    ).toBeNull();
    expect(officesOfOneBusiness({ name: 'GRIID' }, { name: 'Griid' })).toBeNull();
  });
});
