import { lastQuarter } from '@hsdg/contracts';
import {
  employeeRateOn,
  monthLabel,
  pct,
  profitability,
  profitabilityCsv,
  rupees,
  toPaise,
  type EngagementMeta,
  type RateBook,
} from './profitability-math';
import { utilisationOf } from './reports.service';

const H = 3600;

const eng = (id: string, entity: string, partner = 'p1'): EngagementMeta => ({
  id,
  code: `ENG-${id}`,
  entityId: entity,
  entityName: `Client ${entity}`,
  partnerId: partner,
  partnerName: `Partner ${partner}`,
  officeCode: 'MUM',
  primaryServiceId: 'svc-audit',
});

// Seniors cost ₹500/h and charge ₹1,500/h until 15 Aug; ₹600 and ₹2,000 from then.
// Asha has her own rates from 1 Sep: ₹900 and ₹3,000.
const book: RateBook = {
  byGrade: new Map([
    [
      'senior',
      [
        { effectiveFrom: '2026-08-15', costPaise: 60000, chargePaise: 200000 },
        { effectiveFrom: '2026-04-01', costPaise: 50000, chargePaise: 150000 },
      ],
    ],
  ]),
  byEmployee: new Map([
    ['asha', [{ effectiveFrom: '2026-09-01', costPaise: 90000, chargePaise: 300000 }]],
  ]),
  gradeOf: new Map<string, string | null>([
    ['ravi', 'senior'],
    ['asha', 'senior'],
    ['nobody', null],
  ]),
};

describe('PS-302 profitability maths', () => {
  it('takes the rate in force on the day of the work', () => {
    expect(employeeRateOn(book, 'ravi', '2026-03-31')).toBeNull();
    expect(employeeRateOn(book, 'ravi', '2026-08-14')?.costPaise).toBe(50000);
    expect(employeeRateOn(book, 'ravi', '2026-08-15')?.costPaise).toBe(60000);
    // Asha's own rate from 1 Sep; her grade's before that.
    expect(employeeRateOn(book, 'asha', '2026-08-31')?.chargePaise).toBe(200000);
    expect(employeeRateOn(book, 'asha', '2026-09-01')?.chargePaise).toBe(300000);
    expect(employeeRateOn(book, 'nobody', '2026-09-01')).toBeNull();
  });

  it('costs a period across a mid-period rate change, and works out every measure', () => {
    const r = profitability({
      by: 'client',
      time: [
        // 10h before the change (8 billable), 10h after (all billable).
        {
          engagementId: 'e1',
          employeeId: 'ravi',
          day: '2026-08-10',
          serviceId: null,
          seconds: 10 * H,
          billableSeconds: 8 * H,
        },
        {
          engagementId: 'e1',
          employeeId: 'ravi',
          day: '2026-08-20',
          serviceId: null,
          seconds: 10 * H,
          billableSeconds: 10 * H,
        },
      ],
      money: [
        { engagementId: 'e1', day: '2026-09-05', kind: 'billed', paise: toPaise('40000') },
        { engagementId: 'e1', day: '2026-09-20', kind: 'billed', paise: -toPaise('2000') },
        { engagementId: 'e1', day: '2026-09-25', kind: 'collected', paise: toPaise('19000') },
      ],
      engagements: new Map([['e1', eng('e1', 'acme')]]),
      serviceNames: new Map(),
      employeeNames: new Map([['ravi', 'Ravi']]),
      rates: book,
    });
    // Cost: 10 × 500 + 10 × 600 = 11,000. Standard: 8 × 1,500 + 10 × 2,000 = 32,000.
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      key: 'acme',
      label: 'Client acme',
      hours: 20,
      billableHours: 18,
      timeCost: '11000.00',
      standardValue: '32000.00',
      billed: '38000.00',
      collected: '19000.00',
      realisationPct: 118.8, // 38,000 ÷ 32,000
      collectionPct: 50,
      margin: '27000.00',
      marginPct: 71.1,
      unratedHours: 0,
      bottom: false,
    });
    expect(r.totals.margin).toBe('27000.00');
    expect(r.unratedPeople).toEqual([]);
  });

  it('counts hours with no rate as unrated, and names the people', () => {
    const r = profitability({
      by: 'engagement',
      time: [
        {
          engagementId: 'e1',
          employeeId: 'nobody',
          day: '2026-09-01',
          serviceId: null,
          seconds: 2 * H,
          billableSeconds: 2 * H,
        },
      ],
      money: [],
      engagements: new Map([['e1', eng('e1', 'acme')]]),
      serviceNames: new Map(),
      employeeNames: new Map([['nobody', 'Neha']]),
      rates: book,
    });
    expect(r.rows[0]).toMatchObject({
      label: 'ENG-e1',
      sub: 'Client acme',
      unratedHours: 2,
      timeCost: '0.00',
      realisationPct: null,
      collectionPct: null,
    });
    expect(r.unratedPeople).toEqual(['Neha']);
  });

  it('ranks by margin, flags the bottom 10 of more than 10, and any loss', () => {
    const engagements = new Map<string, EngagementMeta>();
    const money = [];
    for (let i = 0; i < 12; i++) {
      engagements.set(`e${i}`, eng(`e${i}`, `c${i}`));
      money.push({
        engagementId: `e${i}`,
        day: '2026-09-01',
        kind: 'billed' as const,
        paise: (i + 1) * 100000,
      });
    }
    const r = profitability({
      by: 'client',
      time: [],
      money,
      engagements,
      serviceNames: new Map(),
      employeeNames: new Map(),
      rates: book,
    });
    expect(r.rows.map((x) => x.key).slice(0, 2)).toEqual(['c11', 'c10']);
    expect(r.rows.filter((x) => x.bottom).map((x) => x.key)).toHaveLength(10);
    expect(r.rows.find((x) => x.key === 'c11')!.bottom).toBe(false);

    const small = profitability({
      by: 'client',
      time: [
        {
          engagementId: 'e0',
          employeeId: 'ravi',
          day: '2026-09-01',
          serviceId: null,
          seconds: 10 * H,
          billableSeconds: 0,
        },
      ],
      money: [],
      engagements,
      serviceNames: new Map(),
      employeeNames: new Map(),
      rates: book,
    });
    expect(small.rows[0]).toMatchObject({ margin: '-6000.00', bottom: true });
  });

  it('groups by service (the entry’s, else the engagement’s), partner and month', () => {
    const engagements = new Map([['e1', eng('e1', 'acme', 'p1')]]);
    const time = [
      {
        engagementId: 'e1',
        employeeId: 'ravi',
        day: '2026-08-10',
        serviceId: 'svc-gst',
        seconds: H,
        billableSeconds: H,
      },
      {
        engagementId: 'e1',
        employeeId: 'ravi',
        day: '2026-09-10',
        serviceId: null,
        seconds: H,
        billableSeconds: H,
      },
    ];
    const common = {
      time,
      money: [],
      engagements,
      serviceNames: new Map([
        ['svc-gst', 'GST'],
        ['svc-audit', 'Audit'],
      ]),
      employeeNames: new Map(),
      rates: book,
    };
    expect(
      profitability({ ...common, by: 'service' })
        .rows.map((r) => r.label)
        .sort(),
    ).toEqual(['Audit', 'GST']);
    expect(profitability({ ...common, by: 'partner' }).rows.map((r) => [r.label, r.sub])).toEqual([
      ['Partner p1', 'MUM'],
    ]);
    expect(profitability({ ...common, by: 'month' }).rows.map((r) => r.label)).toEqual([
      'Aug 2026',
      'Sep 2026',
    ]);
  });

  it('formats money, percentages, months, and the CSV', () => {
    expect(rupees(123456)).toBe('1234.56');
    expect(rupees(-5)).toBe('-0.05');
    expect(toPaise('1500.5')).toBe(150050);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 0)).toBeNull();
    expect(monthLabel('2026-01')).toBe('Jan 2026');
    const r = profitability({
      by: 'client',
      time: [],
      money: [{ engagementId: 'e1', day: '2026-09-01', kind: 'billed', paise: 100000 }],
      engagements: new Map([['e1', { ...eng('e1', 'x'), entityName: '=Evil, Ltd' }]]),
      serviceNames: new Map(),
      employeeNames: new Map(),
      rates: book,
    });
    const csv = profitabilityCsv('Client', r.rows, r.totals).split('\n');
    expect(csv[0]).toMatch(/^Client,Detail,Hours/);
    expect(csv[1]).toMatch(/^"'=Evil, Ltd",,0,0,0.00,0.00,1000.00/);
    expect(csv[2]).toMatch(/^Total,/);
  });

  it('the last full quarter (Indian FY quarters)', () => {
    expect(lastQuarter('2026-11-04')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(lastQuarter('2026-02-10')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    expect(lastQuarter('2026-04-01')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(lastQuarter('2026-07-15')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('utilisation: chargeable ÷ available hours', () => {
    expect(utilisationOf(30 * H, 48)).toEqual({
      chargeableHours: 30,
      availableHours: 48,
      chargeablePct: 62.5,
    });
    expect(utilisationOf(H, 0).chargeablePct).toBeNull();
  });
});
