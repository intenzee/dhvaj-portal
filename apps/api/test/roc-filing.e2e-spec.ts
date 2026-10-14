import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * ROC / MCA filing (docs/roc-mca-filing-spec.md, Track A): the CIN profile
 * facts drive the rules (small company → MGT-7A and calendar-half board
 * meetings, DPT-3 off only on a "no", AOC-4 XBRL / CFS) and the per-form
 * checklists (onlyIf lines, the AGM line that ticks on the event, the CERT line
 * only a partner ticks with the UDIN); the workspace estimates the ROC
 * additional fee and warns when a director's DSC lapses before the due date.
 */
describe('ROC filing (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let mx: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}`.slice(-6) + `${Math.floor(Math.random() * 90 + 10)}`;
  /** Today in India, as the API reckons it. */
  const istToday = (offsetDays = 0): string =>
    new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

  type TreeItem = {
    instanceId: string;
    ruleCode: string;
    label: string;
    dueDate: string;
    workflowStatus: string;
    dscWarning?: string | null;
  };
  type TreePeriod = {
    periodKey: string;
    label: string;
    items: TreeItem[];
    sections: Record<string, TreeItem[]>;
  };

  /**
   * A company with a CIN and a ROC engagement for FY 2026-27 (EP partner A,
   * manager X). `profile` is in force from 1 Apr 2026 before the calendar is
   * generated, so the generated checklists read it.
   */
  const setup = async (
    typeSlug: string,
    profile: Record<string, unknown> | null,
  ): Promise<{ eng: string; entityId: string; reg: string }> => {
    const n = unique();
    const entity = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `ROC Track A ${n} Pvt Ltd`,
        typeSlug,
        officeCode: 'NORTH',
        pan: `AAACR${n.slice(-4)}R`,
        registrations: [
          { registrationType: 'cin', registrationNumber: `U74999WB2021PTC${n.slice(-6)}` },
        ],
      })
      .expect(201);
    const entityId = entity.body.id as string;
    const reg = (
      await su.query<{ id: string }>(
        `SELECT id FROM hsdg.entity_registrations WHERE entity_id = $1 AND registration_type = 'cin'`,
        [entityId],
      )
    ).rows[0]!.id;
    if (profile) {
      await su.query(
        `INSERT INTO hsdg.registration_compliance_profiles
           (entity_id, registration_id, scope, effective_from, attributes)
         VALUES ($1, $2, 'cin', '2026-04-01', $3)`,
        [entityId, reg, JSON.stringify(profile)],
      );
    }
    const created = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        kind: 'compliance',
        entityId,
        status: 'accepted',
        financialYear: '2026-27',
        streams: ['roc'],
        years: [{ financialYear: '2026-27' }],
      })
      .expect(201);
    const eng = created.body.id as string;
    const managerX = (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = 'EMP005'`)
    ).rows[0]!.id;
    await http()
      .patch(`/api/v1/engagements/${eng}`)
      .set(bearer(mp))
      .send({ engagementManagerEmployeeId: managerX })
      .expect(200);
    return { eng, entityId, reg };
  };

  const tree = async (eng: string): Promise<{ annual: TreeItem[]; periods: TreePeriod[] }> =>
    (
      await http()
        .get(`/api/v1/engagements/${eng}/streams/roc/tree?fy=2026-27`)
        .set(bearer(pa))
        .expect(200)
    ).body;
  const allItems = (t: { annual: TreeItem[]; periods: TreePeriod[] }): TreeItem[] => [
    ...t.annual,
    ...t.periods.flatMap((p) => [...p.items, ...Object.values(p.sections).flat()]),
  ];
  const ws = (t: string, inst: string) =>
    http().get(`/api/v1/compliance-instances/${inst}`).set(bearer(t));

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  describe('a private company with subsidiaries, CSR and XBRL, no deposits', () => {
    let eng: string;
    let aoc4: TreeItem;
    const dscExpiry = istToday(20);

    beforeAll(async () => {
      ({ eng } = await setup('private_limited', {
        companySubtype: 'private',
        hasSubsidiaries: true,
        csrApplicable: true,
        xbrlRequired: true,
        authorisedCapital: 1_000_000,
        depositsOrExemptedLoans: false,
        directors: [
          {
            din: '01234567',
            name: 'A Kumar',
            kycCycleStartFy: '2026-27',
            dscExpiresOn: dscExpiry,
          },
        ],
      }));
      aoc4 = allItems(await tree(eng)).find((i) => i.ruleCode === 'ROC_AOC4')!;
    });

    it('files AOC-4 in XBRL with the consolidated statements; DPT-3 is off on a "no"', async () => {
      const items = allItems(await tree(eng));
      expect(aoc4).toMatchObject({ label: 'AOC-4 XBRL + CFS', dueDate: '2027-10-30' });
      expect(items.find((i) => i.ruleCode === 'ROC_MGT7')?.label).toBe('MGT-7');
      expect(items.some((i) => i.ruleCode === 'ROC_DPT3')).toBe(false);
      // Not small: a board meeting every quarter.
      expect(items.filter((i) => i.ruleCode === 'ROC_BOARD_MEETING')).toHaveLength(4);
      // No AGM recorded → no ADT-1.
      expect(items.some((i) => i.ruleCode === 'ROC_ADT1')).toBe(false);
    });

    it('seeds the AOC-4 checklist from the profile', async () => {
      const res = await ws(pa, aoc4.instanceId).expect(200);
      const lines = res.body.checklist as Array<{
        itemCode: string;
        autoTick: string | null;
        tickedBy: string | null;
      }>;
      const codes = lines.map((l) => l.itemCode);
      expect(codes).toEqual(expect.arrayContaining(['CFS', 'CSR', 'AGM_HELD', 'CERT', 'LODGE']));
      expect(codes).not.toContain('MR3');
      expect(codes).not.toContain('ADOPTED');
      expect(lines.find((l) => l.itemCode === 'AGM_HELD')).toMatchObject({ autoTick: 'event' });
      expect(lines.find((l) => l.itemCode === 'CERT')).toMatchObject({ tickedBy: 'partner' });
      expect(res.body.can.certify).toBe(true);
    });

    it('only a partner ticks the certification, and only with the UDIN', async () => {
      const lines = (await ws(pa, aoc4.instanceId).expect(200)).body.checklist as Array<{
        id: string;
        itemCode: string;
        version: number;
      }>;
      const cert = lines.find((l) => l.itemCode === 'CERT')!;
      const agm = lines.find((l) => l.itemCode === 'AGM_HELD')!;
      const patch = (t: string, id: string, body: object) =>
        http()
          .patch(`/api/v1/compliance-instances/${aoc4.instanceId}/items/${id}`)
          .set(bearer(t))
          .send(body);

      expect((await ws(mx, aoc4.instanceId).expect(200)).body.can.certify).toBe(false);
      await patch(mx, cert.id, {
        status: 'done',
        note: 'UDIN26012345',
        version: cert.version,
      }).expect(403);
      await patch(pa, cert.id, { status: 'done', version: cert.version }).expect(400);
      const done = await patch(pa, cert.id, {
        status: 'done',
        note: ' 26012345BKABCD1234 ',
        version: cert.version,
      }).expect(200);
      const ticked = done.body.checklist.find((l: { itemCode: string }) => l.itemCode === 'CERT');
      expect(ticked).toMatchObject({
        status: 'done',
        tickedBy: 'partner',
        doneNote: '26012345BKABCD1234',
      });
      // Reopening it is the partner's too.
      await patch(mx, cert.id, { status: 'open', version: ticked.version }).expect(403);
      // The AGM line ticks itself once the AGM is recorded.
      await patch(pa, agm.id, { status: 'done', version: agm.version }).expect(409);
    });

    it('warns that a director’s DSC lapses before the due date', async () => {
      const res = await ws(pa, aoc4.instanceId).expect(200);
      const warning = (res.body.warnings as Array<{ code: string; message: string }>).find(
        (w) => w.code === 'dsc_expiring',
      );
      expect(warning?.message).toMatch(/^DSC of A Kumar expires /);
      expect(aoc4.dscWarning).toMatch(/^DSC of A Kumar expires /);
    });

    it('estimates the AOC-4 additional fee at ₹100 a day (E16)', async () => {
      await su.query(
        `UPDATE hsdg.compliance_instances
            SET statutory_deadline = $2, is_provisional = false WHERE id = $1`,
        [aoc4.instanceId, istToday(-10)],
      );
      const res = await ws(pa, aoc4.instanceId).expect(200);
      expect(res.body.instance.lateCharges).toEqual({
        daysLate: 10,
        lateFee: 1000,
        interest: null,
        basis: 'per_day',
      });
    });
  });

  describe('a private company within the small-company limits (G12)', () => {
    let eng: string;
    let entityId: string;
    let reg: string;

    beforeAll(async () => {
      ({ eng, entityId, reg } = await setup('private_limited', null));
    });

    it('with no figures: MGT-7, quarterly board meetings and a DPT-3 kept', async () => {
      const items = allItems(await tree(eng));
      expect(items.find((i) => i.ruleCode === 'ROC_MGT7')?.label).toBe('MGT-7');
      expect(items.filter((i) => i.ruleCode === 'ROC_BOARD_MEETING')).toHaveLength(4);
      expect(items.find((i) => i.ruleCode === 'ROC_DPT3')?.dueDate).toBe('2027-06-30');
    });

    it('the figures make it small: MGT-7A, board meetings on calendar halves; "no deposits" drops DPT-3', async () => {
      await http()
        .put(`/api/v1/entities/${entityId}/compliance-profiles`)
        .set(bearer(pa))
        .send({
          scope: 'cin',
          registrationId: reg,
          effectiveFrom: '2026-04-01',
          attributes: {
            paidUpCapital: 10_00_000,
            turnover: 5_00_00_000,
            depositsOrExemptedLoans: false,
          },
        })
        .expect(200);
      const profiles = await http()
        .get(`/api/v1/entities/${entityId}/compliance-profiles`)
        .set(bearer(pa))
        .expect(200);
      expect(profiles.body.entityTypeSlug).toBe('private_limited');

      const t = await tree(eng);
      const live = allItems(t).filter((i) => i.workflowStatus !== 'not_applicable');
      expect(live.find((i) => i.ruleCode === 'ROC_MGT7')?.label).toBe('MGT-7A');
      expect(live.some((i) => i.ruleCode === 'ROC_DPT3')).toBe(false);
      const meetings = live.filter((i) => i.ruleCode === 'ROC_BOARD_MEETING');
      expect(meetings.map((m) => m.dueDate).sort()).toEqual(['2026-12-31', '2027-06-30']);
      const halves = t.periods.filter((p) => /:CH[12]$/.test(p.periodKey));
      expect(halves.map((p) => [p.periodKey, p.label]).sort()).toEqual([
        ['2026-27:CH1', 'Jan–Jun 2027'],
        ['2026-27:CH2', 'Jul–Dec 2026'],
      ]);
    });

    it('stated as private again: back to MGT-7 and quarterly meetings, no clash on 31 Dec', async () => {
      await http()
        .put(`/api/v1/entities/${entityId}/compliance-profiles`)
        .set(bearer(pa))
        .send({
          scope: 'cin',
          registrationId: reg,
          effectiveFrom: '2026-04-01',
          attributes: { companySubtype: 'private', paidUpCapital: 10_00_000 },
        })
        .expect(200);
      const t = await tree(eng);
      const live = allItems(t).filter((i) => i.workflowStatus !== 'not_applicable');
      expect(live.find((i) => i.ruleCode === 'ROC_MGT7')?.label).toBe('MGT-7');
      expect(live.find((i) => i.ruleCode === 'ROC_DPT3')?.dueDate).toBe('2027-06-30');
      expect(
        live
          .filter((i) => i.ruleCode === 'ROC_BOARD_MEETING')
          .map((m) => m.dueDate)
          .sort(),
      ).toEqual(['2026-06-30', '2026-09-30', '2026-12-31', '2027-03-31']);
    });
  });
});
