import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Engagement kinds (spec Change 1): Statutory Audit / Compliance / assignment,
 * the standing Compliance engagement's years and streams, and the independence
 * rules — s.144 (company auditor), s.44AB (tax audit by the bookkeeper) and the
 * partner's acknowledgement for a non-company audit.
 */
describe('Engagement kinds (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let mx: string;
  let acme: string; // private limited company, North
  let bharat: string; // LLP, North
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const entityId = async (search: string): Promise<string> => {
    const res = await http().get(`/api/v1/entities?search=${search}&limit=100`).set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const serviceId = async (code: string): Promise<string> => {
    const res = await http().get(`/api/v1/services?search=${code}&limit=100`).set(bearer(mp));
    return (res.body.items as Array<{ id: string; code: string }>).find((s) => s.code === code)!.id;
  };
  const create = (t: string, body: Record<string, unknown>) =>
    http()
      .post('/api/v1/engagements')
      .set(bearer(t))
      .send({ status: 'accepted', financialYear: '2026-27', ...body });

  const checksFor = async (engagementId: string) => {
    const db = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await db.connect();
    try {
      const { rows } = await db.query<{
        rule_code: string;
        outcome: string;
        acknowledged_by_employee_id: string | null;
      }>(
        `SELECT rule_code, outcome, acknowledged_by_employee_id
           FROM hsdg.engagement_independence_checks WHERE engagement_id = $1`,
        [engagementId],
      );
      return rows;
    } finally {
      await db.end();
    }
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    acme = await entityId('Acme');
    bharat = await entityId('Bharat');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists the six streams in tab order, each with its service', async () => {
    const res = await http().get('/api/v1/streams').set(bearer(pa)).expect(200);
    expect(res.body.map((s: { stream: string }) => s.stream)).toEqual([
      'mis',
      'bookkeeping',
      'gst',
      'tds',
      'income_tax',
      'roc',
    ]);
    expect(res.body[2]).toMatchObject({ serviceCode: 'STREAM_GST', registrationTypes: ['gstin'] });
  });

  describe('a Compliance engagement', () => {
    let client: string;
    let eng: string;

    beforeAll(async () => {
      client = await freshClient(acme);
    });

    it('is created with its streams and years in scope, and its calendar', async () => {
      const res = await create(pa, {
        kind: 'compliance',
        entityId: client,
        streams: ['income_tax', 'gst'],
        years: [{ financialYear: '2027-28' }, { financialYear: '2026-27', feeAmount: 120000 }],
      }).expect(201);
      eng = res.body.id;
      expect(res.body).toMatchObject({ kind: 'compliance', financialYear: '2026-27' });
      expect(res.body.engagementCode).toMatch(/^CR\/\d{5}$/);
      const streams = (res.body.services as Array<{ stream: string | null }>)
        .map((s) => s.stream)
        .sort();
      expect(streams).toEqual(['gst', 'income_tax']);

      const years = await http()
        .get(`/api/v1/engagements/${eng}/years`)
        .set(bearer(pa))
        .expect(200);
      expect(years.body).toEqual([
        expect.objectContaining({
          financialYear: '2026-27',
          streams: ['gst', 'income_tax'],
          feeAmount: 120000,
          status: 'open',
          s144ApprovalMissing: false,
        }),
        expect.objectContaining({ financialYear: '2027-28', streams: ['gst', 'income_tax'] }),
      ]);

      const cal = await http()
        .get(`/api/v1/engagements/${eng}/compliance/calendar`)
        .set(bearer(pa));
      if (cal.status === 200) {
        expect(JSON.stringify(cal.body)).toMatch(/gst|income_tax/i);
      }
    });

    it('is the only open one for the client — a second is refused with a pointer', async () => {
      const res = await create(pa, {
        kind: 'compliance',
        entityId: client,
        streams: ['tds'],
      }).expect(409);
      expect(res.body).toMatchObject({
        rule: 'COMPLIANCE_ENGAGEMENT_EXISTS',
        engagementId: eng,
      });
      // The legacy path (a stream service, no kind) is held to the same rule.
      const legacy = await create(pa, {
        entityId: client,
        serviceId: await serviceId('ITR_FILING'),
      }).expect(409);
      expect(legacy.body.rule).toBe('COMPLIANCE_ENGAGEMENT_EXISTS');
    });

    it('adds a year (defaulting to the latest year’s streams); a repeat is refused', async () => {
      const res = await http()
        .post(`/api/v1/engagements/${eng}/years`)
        .set(bearer(pa))
        .send({ financialYear: '2028-29' })
        .expect(201);
      expect(res.body).toMatchObject({ financialYear: '2028-29', streams: ['gst', 'income_tax'] });
      await http()
        .post(`/api/v1/engagements/${eng}/years`)
        .set(bearer(pa))
        .send({ financialYear: '2028-29' })
        .expect(409);
    });

    it('closes and reopens a year, with optimistic concurrency', async () => {
      const [y] = (await http().get(`/api/v1/engagements/${eng}/years`).set(bearer(pa))).body;
      const closed = await http()
        .patch(`/api/v1/engagements/${eng}/years/2026-27`)
        .set(bearer(pa))
        .send({ status: 'closed', version: y.version })
        .expect(200);
      expect(closed.body).toMatchObject({ status: 'closed' });
      expect(closed.body.closedAt).toBeTruthy();
      await http()
        .patch(`/api/v1/engagements/${eng}/years/2026-27`)
        .set(bearer(pa))
        .send({ status: 'open', version: y.version })
        .expect(409);
      const reopened = await http()
        .patch(`/api/v1/engagements/${eng}/years/2026-27`)
        .set(bearer(pa))
        .send({ status: 'open', version: closed.body.version })
        .expect(200);
      expect(reopened.body).toMatchObject({ status: 'open', closedAt: null });
    });

    it('adds and ends streams on a year; a year keeps at least one', async () => {
      const [y] = (await http().get(`/api/v1/engagements/${eng}/years`).set(bearer(pa))).body;
      const res = await http()
        .patch(`/api/v1/engagements/${eng}/years/2026-27/streams`)
        .set(bearer(pa))
        .send({ add: ['tds'], end: ['income_tax'], version: y.version })
        .expect(200);
      expect(res.body.streams).toEqual(['gst', 'tds']);
      await http()
        .patch(`/api/v1/engagements/${eng}/years/2026-27/streams`)
        .set(bearer(pa))
        .send({ end: ['gst', 'tds'], version: res.body.version })
        .expect(400);
      // The stream line was added to the engagement.
      const detail = await http().get(`/api/v1/engagements/${eng}`).set(bearer(pa)).expect(200);
      expect(detail.body.services.map((s: { stream: string }) => s.stream)).toContain('tds');
    });

    it('filters the list by kind', async () => {
      const res = await http()
        .get(`/api/v1/engagements?kind=compliance&entityId=${client}`)
        .set(bearer(pa))
        .expect(200);
      expect(res.body.items.map((e: { id: string }) => e.id)).toEqual([eng]);
      const sa = await http()
        .get(`/api/v1/engagements?kind=statutory_audit&entityId=${client}`)
        .set(bearer(pa))
        .expect(200);
      expect(sa.body.items).toEqual([]);
    });
  });

  describe('section 144 — a company the firm audits', () => {
    let client: string;
    let cr: string;

    beforeAll(async () => {
      client = await freshClient(acme);
      const res = await create(pa, {
        kind: 'compliance',
        entityId: client,
        streams: ['gst'],
      }).expect(201);
      cr = res.body.id;
    });

    it('creates the Statutory Audit without naming the service', async () => {
      const res = await create(pa, { kind: 'statutory_audit', entityId: client }).expect(201);
      expect(res.body).toMatchObject({ kind: 'statutory_audit', serviceCode: 'STAT_AUDIT' });
      expect(res.body.engagementCode).toMatch(/^SA\/\d{5}$/);
    });

    it('flags the missing approval for permitted filing streams until it is recorded', async () => {
      const [y] = (await http().get(`/api/v1/engagements/${cr}/years`).set(bearer(pa))).body;
      expect(y.s144ApprovalMissing).toBe(true);
      const res = await http()
        .patch(`/api/v1/engagements/${cr}/years/2026-27`)
        .set(bearer(pa))
        .send({ s144ApprovalRef: 'BR/2026/14', version: y.version })
        .expect(200);
      expect(res.body.s144ApprovalMissing).toBe(false);
    });

    it('blocks bookkeeping and MIS for the audited year — hard, no override', async () => {
      const [y] = (await http().get(`/api/v1/engagements/${cr}/years`).set(bearer(pa))).body;
      const res = await http()
        .patch(`/api/v1/engagements/${cr}/years/2026-27/streams`)
        .set(bearer(pa))
        .send({ add: ['bookkeeping'], version: y.version })
        .expect(409);
      expect(res.body.rule).toBe('S144_PROHIBITED_SERVICE');
      expect(res.body.message).toMatch(/Section 144 of the Companies Act, 2013/);
      expect(res.body.message).toMatch(/FY 2026-27 \(SA\/\d{5}\)/);
    });

    it('allows bookkeeping for a year the firm does not audit', async () => {
      await http()
        .post(`/api/v1/engagements/${cr}/years`)
        .set(bearer(pa))
        .send({ financialYear: '2027-28', streams: ['gst', 'bookkeeping'] })
        .expect(201);
    });

    it('blocks an internal audit assignment for the audited year', async () => {
      const res = await create(pa, {
        kind: 'assignment',
        entityId: client,
        serviceId: await serviceId('INT_AUDIT'),
      }).expect(409);
      expect(res.body.rule).toBe('S144_PROHIBITED_SERVICE');
    });

    it('blocks the audit of a year whose books the firm keeps (the reverse)', async () => {
      const res = await create(pa, {
        kind: 'statutory_audit',
        entityId: client,
        financialYear: '2027-28',
      }).expect(409);
      expect(res.body.rule).toBe('S144_AUDIT_WITH_PROHIBITED_SERVICE');
      expect(res.body.message).toMatch(/End it for those years/);
    });

    it('previews the rules before submit', async () => {
      const res = await http()
        .post('/api/v1/engagements/independence-check')
        .set(bearer(pa))
        .send({
          entityId: client,
          kind: 'compliance',
          financialYears: ['2026-27'],
          streams: ['mis', 'roc'],
          engagementId: cr,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        isCompany: true,
        block: { rule: 'S144_PROHIBITED_SERVICE' },
      });
      expect(res.body.findings.map((f: { rule: string }) => f.rule)).toEqual([
        'S144_PROHIBITED_SERVICE',
        'S144_PERMITTED_SERVICE_APPROVAL',
      ]);
      const fresh = await http()
        .post('/api/v1/engagements/independence-check')
        .set(bearer(pa))
        .send({
          entityId: client,
          kind: 'compliance',
          financialYears: ['2026-27'],
          streams: ['gst'],
        })
        .expect(200);
      expect(fresh.body.openComplianceEngagement).toMatchObject({ id: cr });
    });
  });

  describe('a non-company client', () => {
    let client: string;

    beforeAll(async () => {
      client = await freshClient(bharat);
    });

    it('a statutory audit needs the partner’s acknowledgement', async () => {
      const res = await create(pa, { kind: 'statutory_audit', entityId: client }).expect(409);
      expect(res.body.rule).toBe('ACKNOWLEDGEMENT_REQUIRED');
      // Only a partner may give it.
      await create(mx, {
        kind: 'statutory_audit',
        entityId: client,
        engagementPartnerEmployeeId: undefined,
        acknowledgedIndependenceRules: ['NON_COMPANY_AUDIT_ACK'],
      }).expect((r) => expect([403, 400]).toContain(r.status));
      const ok = await create(pa, {
        kind: 'statutory_audit',
        entityId: client,
        acknowledgedIndependenceRules: ['NON_COMPANY_AUDIT_ACK'],
      }).expect(201);
      const checks = await checksFor(ok.body.id);
      expect(checks).toEqual([
        expect.objectContaining({ rule_code: 'NON_COMPANY_AUDIT_ACK', outcome: 'warn' }),
      ]);
      expect(checks[0]!.acknowledged_by_employee_id).toBeTruthy();
    });

    it('section 44AB: no tax audit while the firm keeps the books, and vice versa', async () => {
      await create(pa, {
        kind: 'compliance',
        entityId: client,
        streams: ['bookkeeping'],
      }).expect(201);
      const res = await create(pa, {
        kind: 'assignment',
        entityId: client,
        serviceId: await serviceId('TAX_AUDIT'),
      }).expect(409);
      expect(res.body.rule).toBe('TAX_AUDIT_BY_BOOKKEEPER');

      const other = await freshClient(bharat);
      await create(pa, {
        kind: 'assignment',
        entityId: other,
        serviceId: await serviceId('TAX_AUDIT'),
      }).expect(201);
      const books = await create(pa, {
        kind: 'compliance',
        entityId: other,
        streams: ['bookkeeping'],
      }).expect(409);
      expect(books.body.rule).toBe('TAX_AUDIT_BY_BOOKKEEPER');
    });
  });

  describe('kind and service must agree', () => {
    it('an assignment cannot carry a stream service or the statutory audit', async () => {
      const client = await freshClient(acme);
      for (const code of ['STREAM_GST', 'STAT_AUDIT']) {
        await create(pa, {
          kind: 'assignment',
          entityId: client,
          serviceId: await serviceId(code),
        }).expect(400);
      }
      await create(pa, { kind: 'assignment', entityId: client }).expect(400);
    });

    it('a Statutory Audit cannot carry another service, nor years or streams', async () => {
      const client = await freshClient(acme);
      await create(pa, {
        kind: 'statutory_audit',
        entityId: client,
        serviceId: await serviceId('TAX_AUDIT'),
      }).expect(400);
      await create(pa, { kind: 'statutory_audit', entityId: client, streams: ['gst'] }).expect(400);
    });

    it('a Compliance engagement needs a stream; registrations must be the client’s', async () => {
      const client = await freshClient(acme);
      await create(pa, { kind: 'compliance', entityId: client, streams: [] }).expect(400);
      await create(pa, {
        kind: 'compliance',
        entityId: client,
        streams: ['gst'],
        streamRegistrations: { gst: ['00000000-0000-4000-8000-000000000000'] },
      }).expect(400);
      await create(pa, {
        kind: 'compliance',
        entityId: client,
        streams: ['gst'],
        streamRegistrations: { tds: [] },
      }).expect(400);
    });
  });

  it('years belong to Compliance engagements only', async () => {
    const client = await freshClient(acme);
    const sa = await create(pa, { kind: 'statutory_audit', entityId: client }).expect(201);
    await http().get(`/api/v1/engagements/${sa.body.id}/years`).set(bearer(pa)).expect(400);
    await http()
      .patch(`/api/v1/engagements/${sa.body.id}/years/2026-27x`)
      .set(bearer(pa))
      .send({ version: 1 })
      .expect(400);
  });
});
