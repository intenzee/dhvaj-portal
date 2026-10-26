import { gstinCheckChar } from '@hsdg/contracts';
import { dataCheckCsv, dataCheckRows, type CheckClient, type CheckInput } from './data-checks';

const gstin = (first14: string): string => `${first14}${gstinCheckChar(first14)}`;
const PAN = 'AADCD1234K';
const OTHER_PAN = 'AAFCB9876Q';

function client(over: Partial<CheckClient>): CheckClient {
  return {
    id: 'e1',
    code: 'CL-0001',
    name: 'Drift Logistics Private Limited',
    pan: PAN,
    typeSlug: 'private_limited',
    typeSource: 'pan',
    teamId: 't1',
    registrations: [],
    addresses: [],
    fees: [],
    ...over,
  };
}

function input(clients: CheckClient[], teams: CheckInput['teams'] = []): CheckInput {
  return {
    clients,
    teams,
    typeNames: { private_limited: 'Private Limited', partnership: 'Partnership' },
  };
}

const reg = (number: string, over: Partial<CheckClient['registrations'][number]> = {}) => ({
  id: `r-${number}`,
  type: 'gstin',
  number,
  status: 'active',
  stateCode: number.slice(0, 2),
  acked: false,
  ...over,
});

describe('CM-9 data check rows', () => {
  it('lists a GSTIN of another PAN and offers the client holding it', () => {
    const holder = client({ id: 'e2', code: 'CL-0002', name: 'Bright Co', pan: OTHER_PAN });
    const rows = dataCheckRows(
      'gstin_other_pan',
      input([client({ registrations: [reg(gstin(`07${OTHER_PAN}1Z`))] }), holder]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityId: 'e1',
      proposed: 'Move it to CL-0002 Bright Co',
      canApply: false,
    });
  });

  it('lists a GSTIN with a wrong check digit', () => {
    const rows = dataCheckRows(
      'gstin_invalid',
      input([client({ registrations: [reg(`07${PAN}1Z0`)] })]),
    );
    expect(rows.map((r) => r.current)).toEqual([`07${PAN}1Z0`]);
  });

  it('proposes the GSTIN state for an unconfirmed mismatch, and skips a confirmed one', () => {
    const g = gstin(`07${PAN}1Z`);
    const rows = dataCheckRows(
      'state',
      input([client({ registrations: [reg(g, { stateCode: '06' })] })]),
    );
    expect(rows[0]).toMatchObject({ current: '06 Haryana', proposed: '07 Delhi', canApply: true });
    expect(rows[0]!.fix).toEqual({ kind: 'state', registrationId: `r-${g}`, stateCode: '07' });
    expect(
      dataCheckRows(
        'state',
        input([client({ registrations: [reg(g, { stateCode: '06', acked: true })] })]),
      ),
    ).toEqual([]);
  });

  it('offers the PAN type only for types set before the PAN rules', () => {
    const legacy = client({ typeSlug: 'partnership', typeSource: 'legacy' });
    const rows = dataCheckRows(
      'firm_type',
      input([legacy, { ...legacy, id: 'e3', typeSource: 'manual' }]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ current: 'Partnership', proposed: 'Private Limited' });
  });

  it('adds Private Limited to a company name, showing before and after', () => {
    const rows = dataCheckRows('company_name', input([client({ name: 'Drift Logistics' })]));
    expect(rows[0]).toMatchObject({
      current: 'Drift Logistics',
      proposed: 'Drift Logistics Private Limited',
    });
  });

  it('confirms per year in bulk only when every unconfirmed fee is yearly', () => {
    const fee = { engagementId: 'g1', fy: '2026-27', amount: '60000', version: 2 };
    const yearly = dataCheckRows(
      'fee_period',
      input([client({ fees: [{ ...fee, period: 'annual' }] })]),
    );
    expect(yearly[0]).toMatchObject({ canApply: true, proposed: 'Confirm per year' });
    expect(yearly[0]!.current).toBe('FY 2026-27: ₹60,000 per year');
    const monthly = dataCheckRows(
      'fee_period',
      input([client({ fees: [{ ...fee, period: 'monthly' }] })]),
    );
    expect(monthly[0]!.canApply).toBe(false);
  });

  it('lists clients without a team and teams without a partner', () => {
    expect(dataCheckRows('client_without_team', input([client({ teamId: null })]))).toHaveLength(1);
    const teams = dataCheckRows('team_without_partner', input([], [{ id: 't9', name: 'North' }]));
    expect(teams[0]).toMatchObject({ entityId: null, href: '/people/teams/t9' });
  });

  it('writes CSV with quoted cells', () => {
    expect(
      dataCheckCsv([
        {
          id: 'e1',
          entityId: 'e1',
          code: 'CL-1',
          name: 'A, B "and" C',
          problem: 'x',
          current: null,
          proposed: 'y',
          href: '/entities/e1',
          canApply: true,
        },
      ]),
    ).toBe('Code,Client,Problem,Current,Proposed fix\nCL-1,"A, B ""and"" C",x,,y\n');
  });
});
