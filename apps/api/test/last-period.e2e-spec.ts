import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Staff Workflow WF-303 — last period beside this one. September's GSTR-1
 * shows August's uploads, checklist answers, filed reference and review
 * points, read-only; August (the first period) has none. The lines that carry
 * over start from August's answer, open, for the preparer to confirm. RLS: a
 * partner off the engagement gets a 404.
 */
describe('Last period (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let mx: string;
  let sy: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const employeeId = async (code: string): Promise<string> => {
    const r = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE employee_code = $1`,
      [code],
    );
    return r.rows[0]!.id;
  };

  type Item = { id: string; itemCode: string; version: number; status: string; carried: unknown };
  const ws = (t: string, inst: string) =>
    http().get(`/api/v1/compliance-instances/${inst}`).set(bearer(t));
  const last = (t: string, inst: string) =>
    http().get(`/api/v1/compliance-instances/${inst}/last-period`).set(bearer(t));
  const item = (body: { checklist: Item[] }, code: string): Item =>
    body.checklist.find((i) => i.itemCode === code)!;
  const act = (t: string, eng: string, task: string, action: string, body: object = {}) =>
    http().post(`/api/v1/engagements/${eng}/tasks/${task}/${action}`).set(bearer(t)).send(body);

  /** A GSTR-1 (Outward) for August and September on one GSTIN; Senior Y prepares, Manager X reviews. */
  const setup = async (): Promise<{
    eng: string;
    aug: string;
    sep: string;
    augTask: string;
  }> => {
    const entityId = await freshClient(
      (await http().get('/api/v1/entities?search=Bharat&limit=100').set(bearer(mp))).body.items[0]
        .id as string,
    );
    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    const eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `LP${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    await http()
      .patch(`/api/v1/engagements/${eng}`)
      .set(bearer(mp))
      .send({ engagementManagerEmployeeId: await employeeId('EMP005') })
      .expect(200);
    await http()
      .post(`/api/v1/engagements/${eng}/team`)
      .set(bearer(pa))
      .send({ employeeId: await employeeId('EMP006'), roleOnEngagement: 'in_charge' })
      .expect(201);

    const code = `GST_GSTR1_${unique()}`;
    const rule = await http()
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code, name: 'GSTR-1', dueDateCategory: 'STATUTORY_RULE' })
      .expect(201);
    await http()
      .post(`/api/v1/compliance-rules/${rule.body.id}/versions`)
      .set(bearer(mp))
      .send({
        effectiveFrom: '2017-04-01',
        calculationBasis: 'period_end',
        offsetDays: 11,
        workingDayAdjustment: 'none',
      })
      .expect(201);
    await su.query(
      `UPDATE hsdg.compliance_rule_versions SET stream = 'gst', section = 'outward', form_label = 'GSTR-1'
        WHERE compliance_rule_id = $1`,
      [rule.body.id],
    );
    const gstin = `19AAAC${unique().slice(-9)}`.slice(0, 15).padEnd(15, 'Z');
    const reg = (
      await su.query<{ id: string }>(
        `INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, state_code)
         VALUES ($1,'gstin',$2,'19') RETURNING id`,
        [entityId, gstin],
      )
    ).rows[0]!.id;
    const month = async (ref: string, key: string, start: string): Promise<string> => {
      const inst = (
        await http()
          .post(`/api/v1/engagements/${eng}/compliance`)
          .set(bearer(pa))
          .send({ complianceRuleCode: code, referenceDate: ref })
          .expect(201)
      ).body.id as string;
      await su.query(
        `UPDATE hsdg.compliance_instances
            SET registration_id = $2, section = 'outward', financial_year = '2026-27', period_key = $3,
                period_start = $4, period_end = $5
          WHERE id = $1`,
        [inst, reg, key, start, ref],
      );
      await su.query(
        `UPDATE hsdg.tasks SET assigned_to_employee_id = $2, reviewer_employee_id = $3
          WHERE source_compliance_instance_id = $1`,
        [inst, await employeeId('EMP006'), await employeeId('EMP005')],
      );
      return inst;
    };
    const aug = await month('2026-08-31', '2026-08', '2026-08-01');
    const sep = await month('2026-09-30', '2026-09', '2026-09-01');
    const augTask = (
      await su.query<{ id: string }>(
        `SELECT id FROM hsdg.tasks WHERE source_compliance_instance_id = $1`,
        [aug],
      )
    ).rows[0]!.id;
    return { eng, aug, sep, augTask };
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('shows last month beside this one, and carries its standing answers over for confirmation', async () => {
    const { eng, aug, sep, augTask } = await setup();

    // The first period has nothing before it.
    expect((await last(sy, aug).expect(200)).body).toEqual({ previous: null });
    // September's checklist is seeded before August is worked; it still picks August up later.
    expect(item((await ws(sy, sep).expect(200)).body, 'ADVANCES').carried).toBeNull();

    // August: answers, an upload, a return with review points, then the filing.
    const a = (await ws(sy, aug).expect(200)).body;
    const adv = item(a, 'ADVANCES');
    await http()
      .patch(`/api/v1/compliance-instances/${aug}/items/${adv.id}`)
      .set(bearer(sy))
      .send({ status: 'done', note: 'No advances this month', version: adv.version })
      .expect(200);
    const ewb = item(a, 'EWB_REPORT');
    await http()
      .patch(`/api/v1/compliance-instances/${aug}/items/${ewb.id}`)
      .set(bearer(sy))
      .send({
        status: 'not_applicable',
        naReason: 'Below the e-way bill limit',
        version: ewb.version,
      })
      .expect(200);
    const sales = await http()
      .post(`/api/v1/compliance-instances/${aug}/slots/SALES_REGISTER/documents`)
      .set(bearer(sy))
      .send({
        filename: 'sales-aug.pdf',
        contentType: 'application/pdf',
        contentBase64: b64('aug'),
      })
      .expect(201);
    expect(sales.body).toBeTruthy();
    await act(sy, eng, augTask, 'start').expect(201);
    await act(sy, eng, augTask, 'send-for-review').expect(201);
    await act(mx, eng, augTask, 'start-review').expect(201);
    await act(mx, eng, augTask, 'return', { reason: 'Credit notes missing from Table 9B' }).expect(
      201,
    );
    const ack = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.documents WHERE compliance_instance_id = $1 LIMIT 1`,
      [aug],
    );
    await su.query(
      `INSERT INTO hsdg.filing_records
         (compliance_instance_id, engagement_id, compliance_rule_id, reference_kind, reference_no,
          filed_on, ack_document_id, filed_by_employee_id)
       SELECT ci.id, ci.engagement_id, ci.compliance_rule_id, 'arn', 'AA190826000001X', '2026-09-10', $2, $3
         FROM hsdg.compliance_instances ci WHERE ci.id = $1`,
      [aug, ack.rows[0]!.id, await employeeId('EMP006')],
    );

    // September: the panel reads August, read-only.
    const lp = (await last(sy, sep).expect(200)).body.previous;
    expect(lp).toMatchObject({
      instanceId: aug,
      engagementId: eng,
      formLabel: 'GSTR-1',
      periodKey: '2026-08',
      periodLabel: 'Aug 2026',
      filing: { referenceKind: 'arn', referenceNo: 'AA190826000001X', filedOn: '2026-09-10' },
      reviewPoints: [{ note: 'Credit notes missing from Table 9B', byName: expect.any(String) }],
    });
    expect(lp.slots).toEqual([
      expect.objectContaining({
        slotCode: 'SALES_REGISTER',
        documents: [expect.objectContaining({ filename: 'sales-aug.pdf' })],
      }),
    ]);
    expect(lp.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemCode: 'ADVANCES',
          status: 'done',
          doneNote: 'No advances this month',
        }),
        expect.objectContaining({
          itemCode: 'EWB_REPORT',
          status: 'not_applicable',
          naReason: 'Below the e-way bill limit',
        }),
      ]),
    );

    // September's own checklist: the standing answers come over, open, to confirm.
    const s = (await ws(sy, sep).expect(200)).body;
    expect(item(s, 'ADVANCES')).toMatchObject({
      status: 'open',
      carriesOver: true,
      carried: {
        status: 'done',
        note: 'No advances this month',
        instanceId: aug,
        periodKey: '2026-08',
      },
    });
    expect(item(s, 'EWB_REPORT')).toMatchObject({
      status: 'open',
      carried: { status: 'not_applicable', naReason: 'Below the e-way bill limit' },
    });
    // A document line's Done never carries (it needs this month's upload); nor does a line not marked.
    expect(item(s, 'SALES_REGISTER')).toMatchObject({ carriesOver: false, carried: null });

    // Confirming is ticking it with last period's answer; the flag then clears.
    const advSep = item(s, 'ADVANCES');
    const confirmed = await http()
      .patch(`/api/v1/compliance-instances/${sep}/items/${advSep.id}`)
      .set(bearer(sy))
      .send({ status: 'done', note: 'No advances this month', version: advSep.version })
      .expect(200);
    expect(item(confirmed.body, 'ADVANCES')).toMatchObject({ status: 'done', carried: null });
  });

  it('respects RLS: a partner off the engagement gets a 404; a bad id is a 400', async () => {
    const { sep } = await setup();
    await last(pb, sep).expect(404);
    await last(sy, 'not-a-uuid').expect(400);
  });
});
