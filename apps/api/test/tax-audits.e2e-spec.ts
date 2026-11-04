import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * F-1 — Tax Audit as the seventh stream on a Compliance engagement. A client
 * over ₹1 crore turnover with Income Tax and Tax Audit in scope gets the year's
 * tax audit report on the Tax Audit line, and with it the year's audit; filing
 * the report moves the audit to Filed.
 *
 * F-2 — the year's applicability decision (calculator + override with a
 * reason) drives the calendar, and the radar lists clients likely to need an
 * audit, with Tax Audit added to a year's scope from it.
 */
describe('Tax audits (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: Record<string, string>;
  let client: string;
  let eng: string;
  const http = () => request(app.getHttpServer());

  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const audits = async () =>
    (await http().get(`/api/v1/engagements/${eng}/tax-audits`).set(pa).expect(200)).body as {
      id: string;
      financialYear: string;
      revision: number;
      stage: string;
      instanceId: string | null;
      filingStatus: string | null;
      dueDate: string | null;
      daysLeft: number | null;
      filedOn: string | null;
      applicabilityReason: string | null;
    }[];

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    const mp = await as('mp@dhvaj.in');
    pa = await as('partner.a@dhvaj.in');
    const acme = await http().get('/api/v1/entities?search=Acme&limit=10').set(mp).expect(200);
    client = await freshClient(acme.body.items[0].id as string);
    await su.query(`UPDATE hsdg.entities SET annual_turnover = 25000000 WHERE id = $1`, [client]);
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          kind: 'compliance',
          entityId: client,
          status: 'accepted',
          financialYear: '2026-27',
          streams: ['income_tax', 'tax_audit'],
          years: [{ financialYear: '2026-27' }],
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('the year gets its report filing on the Tax Audit line, and its audit', async () => {
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      financialYear: '2026-27',
      revision: 0,
      stage: 'not_started',
      filingStatus: 'not_started',
      dueDate: '2027-09-30',
      filedOn: null,
    });
    expect(typeof rows[0]!.daysLeft).toBe('number');

    const { rows: lines } = await su.query<{ code: string; stream: string }>(
      `SELECT s.code, v.stream
         FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rule_versions v ON v.id = ci.compliance_rule_version_id
         JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
         JOIN hsdg.services s ON s.id = es.service_id
        WHERE ci.id = $1`,
      [rows[0]!.instanceId],
    );
    expect(lines).toEqual([{ code: 'STREAM_TAX_AUDIT', stream: 'tax_audit' }]);

    const tabs = await http().get(`/api/v1/engagements/${eng}/tabs`).set(pa).expect(200);
    expect(tabs.body.streams.map((s: { stream: string }) => s.stream)).toEqual([
      'income_tax',
      'tax_audit',
    ]);
  });

  it('filing the report files the audit; reopening it puts the audit back', async () => {
    const [a] = await audits();
    await su.query(
      `UPDATE hsdg.compliance_instances
          SET workflow_status = 'filed', completed_at = '2027-09-20T10:00:00+05:30'
        WHERE id = $1`,
      [a!.instanceId],
    );
    expect((await audits())[0]).toMatchObject({
      stage: 'filed',
      filedOn: '2027-09-20',
      daysLeft: null,
    });

    await su.query(
      `UPDATE hsdg.compliance_instances SET workflow_status = 'in_preparation', completed_at = NULL
        WHERE id = $1`,
      [a!.instanceId],
    );
    expect((await audits())[0]).toMatchObject({ stage: 'not_started', filedOn: null });
  });

  it('the firm cannot keep the books of a year it tax-audits', async () => {
    const { rows } = await su.query<{ version: number }>(
      `SELECT version FROM hsdg.compliance_engagement_years
        WHERE engagement_id = $1 AND financial_year = '2026-27'`,
      [eng],
    );
    const res = await http()
      .patch(`/api/v1/engagements/${eng}/years/2026-27/streams`)
      .set(pa)
      .send({ add: ['bookkeeping'], version: rows[0]!.version })
      .expect(409);
    expect(res.body.rule).toBe('TAX_AUDIT_BY_BOOKKEEPER');
  });

  it('someone outside the engagement does not see its audits', async () => {
    await http()
      .get(`/api/v1/engagements/${eng}/tax-audits`)
      .set(await as('partner.b@dhvaj.in'))
      .expect(404);
  });

  it('the old stand-alone Tax Audit service is retired', async () => {
    const res = await http().get('/api/v1/services?search=TAX_AUDIT&limit=100').set(pa).expect(200);
    const byCode = Object.fromEntries(
      (res.body.items as { code: string; isActive: boolean }[]).map((s) => [s.code, s.isActive]),
    );
    expect(byCode).toMatchObject({ TAX_AUDIT: false, STREAM_TAX_AUDIT: true });
  });

  describe('applicability and the radar (F-2)', () => {
    const inputs = {
      businessTurnover: 5_000_000,
      professionReceipts: null,
      cashWithinFivePercent: false,
      presumptiveScheme: null,
      profitBelowPresumptive: false,
      incomeAboveExemption: true,
      optedOutOf44AD: false,
    };
    const decide = (body: object, expect: number) =>
      http()
        .put(`/api/v1/engagements/${eng}/tax-audit-applicability/2026-27`)
        .set(pa)
        .send(body)
        .expect(expect);
    const radar = async (query = '') =>
      (
        await http()
          .get(`/api/v1/tax-audits/radar?financialYear=2026-27${query}`)
          .set(pa)
          .expect(200)
      ).body as {
        engagementId: string;
        likely: boolean;
        basis: string;
        inScope: boolean;
        yearVersion: number;
        financialYear: string;
      }[];

    it('the calculator saying no takes the report off the calendar, with its reason', async () => {
      // Only a filing nobody has started comes off; work under way stays.
      const instanceId = (await audits())[0]!.instanceId;
      await su.query(
        `UPDATE hsdg.compliance_instances SET workflow_status = 'not_started' WHERE id = $1`,
        [instanceId],
      );
      await su.query(
        `UPDATE hsdg.tasks SET status = 'todo', completed_at = NULL
          WHERE source_compliance_instance_id = $1`,
        [instanceId],
      );
      const res = await decide({ inputs, override: null }, 200);
      expect(res.body).toMatchObject({
        applicable: false,
        computed: { applicable: false, clause: null },
        override: null,
        version: 1,
      });
      expect((await audits())[0]).toMatchObject({
        stage: 'not_applicable',
        filingStatus: 'not_applicable',
        applicabilityReason: res.body.reason,
      });
    });

    it('an override needs a reason, a stale version is refused, and the calendar follows it', async () => {
      await decide({ inputs, override: { applicable: true, reason: '   ' }, version: 1 }, 400);
      await decide({ inputs, override: null, version: 7 }, 409);

      const res = await decide(
        {
          inputs,
          override: { applicable: true, reason: 'Speculative turnover counted' },
          version: 1,
        },
        200,
      );
      expect(res.body).toMatchObject({
        applicable: true,
        reason: 'Decided: Speculative turnover counted',
        computed: { applicable: false },
        version: 2,
      });
      expect((await audits())[0]).toMatchObject({
        stage: 'not_started',
        filingStatus: 'not_started',
      });

      const list = await http()
        .get(`/api/v1/engagements/${eng}/tax-audit-applicability`)
        .set(pa)
        .expect(200);
      expect(list.body).toHaveLength(1);
      const { rows } = await su.query<{ action: string }>(
        `SELECT action FROM hsdg.audit_events WHERE object_id = $1 ORDER BY occurred_at`,
        [res.body.id],
      );
      expect(rows.map((r) => r.action)).toEqual([
        'tax_audit.applicability_decided',
        'tax_audit.applicability_decided',
      ]);
    });

    it('someone outside the engagement can neither read nor make the decision', async () => {
      const pb = await as('partner.b@dhvaj.in');
      await http().get(`/api/v1/engagements/${eng}/tax-audit-applicability`).set(pb).expect(404);
      await http()
        .put(`/api/v1/engagements/${eng}/tax-audit-applicability/2026-27`)
        .set(pb)
        .send({ inputs, override: null })
        .expect(404);
    });

    it('the radar puts a likely client not yet in scope first, and Tax Audit is added from it', async () => {
      const make = async (turnover: number) => {
        const entity = await freshClient(
          (
            await su.query<{ entity_id: string }>(
              `SELECT entity_id FROM hsdg.engagements WHERE id = $1`,
              [eng],
            )
          ).rows[0]!.entity_id,
        );
        await su.query(`UPDATE hsdg.entities SET annual_turnover = $2 WHERE id = $1`, [
          entity,
          turnover,
        ]);
        return (
          await http()
            .post('/api/v1/engagements')
            .set(pa)
            .send({
              kind: 'compliance',
              entityId: entity,
              status: 'accepted',
              financialYear: '2026-27',
              streams: ['income_tax'],
              years: [{ financialYear: '2026-27' }],
            })
            .expect(201)
        ).body.id as string;
      };
      const big = await make(30_000_000);
      const small = await make(4_000_000);

      const rows = await radar();
      const ours = rows.filter((r) => [eng, big, small].includes(r.engagementId));
      expect(ours.map((r) => r.engagementId)).toEqual([big, eng]);
      expect(ours[0]).toMatchObject({ likely: true, basis: 'turnover', inScope: false });
      expect(ours[1]).toMatchObject({ likely: true, basis: 'decided', inScope: true });
      expect((await radar('&all=true')).find((r) => r.engagementId === small)).toMatchObject({
        likely: false,
        inScope: false,
      });

      await http()
        .patch(`/api/v1/engagements/${big}/years/2026-27/streams`)
        .set(pa)
        .send({ add: ['tax_audit'], version: ours[0]!.yearVersion })
        .expect(200);
      expect((await radar()).find((r) => r.engagementId === big)).toMatchObject({ inScope: true });
      const bigAudits = await http()
        .get(`/api/v1/engagements/${big}/tax-audits`)
        .set(pa)
        .expect(200);
      expect(bigAudits.body).toHaveLength(1);
    });
  });
});
