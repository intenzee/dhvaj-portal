import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  AccountsDesk,
  ApprovalItem,
  BillingClientRow,
  ClientBillingProfile,
  EngagementCommercialView,
  InvoiceDetail,
  InvoiceIssueRequest,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Accountant role, phase 1 (spec §3.4, §3.5, §7.4): a client's billing
 * profile, an engagement's commercial view, the Accounts desk, and the
 * ad-hoc invoice rule — a line no agreed fee or billable time stands behind
 * needs billing.approve to issue; the rest ask the engagement partner.
 */
describe('Accounts desk and the ad-hoc issue rule (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let mx: string;
  let sy: string;
  let today: string;
  let managerX: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const superuser = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  const findId = async (path: string): Promise<string> => {
    const res = await http().get(path).set(bearer(mp));
    return res.body.items[0].id as string;
  };

  /** A fresh NORTH client and an engagement Partner A leads. */
  const engagement = async (): Promise<{ eng: string; client: string }> => {
    const bharat = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=GST_MONTHLY&limit=100');
    const client = await freshClient(bharat);
    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId: client,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `P${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    const eng = res.body.id as string;
    // Manager X bills NORTH clients; on the team, they see the engagement too.
    await http()
      .post(`/api/v1/engagements/${eng}/team`)
      .set(bearer(pa))
      .send({ employeeId: managerX, roleOnEngagement: 'member' })
      .expect(201);
    return { eng, client };
  };

  const adHocDraft = async (eng: string, t = mx): Promise<InvoiceDetail> =>
    (
      await http()
        .post(`/api/v1/engagements/${eng}/invoices`)
        .set(bearer(t))
        .send({ lines: [{ description: 'Advisory call', quantity: '1', unitAmount: '5000.00' }] })
        .expect(201)
    ).body as InvoiceDetail;

  const setStatus = (t: string, eng: string, inv: string, status: string) =>
    http()
      .post(`/api/v1/engagements/${eng}/invoices/${inv}/status`)
      .set(bearer(t))
      .send({ status, issueDate: today });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    const { rows } = await superuser((c) =>
      c.query<{ d: string }>(`SELECT timezone('Asia/Kolkata', now())::date::text AS d`),
    );
    today = rows[0]!.d;
    const { rows: mgr } = await superuser((c) =>
      c.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE full_name = 'Manager X'`),
    );
    managerX = mgr[0]!.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('billing profile', () => {
    it('gives the billing contact, address and state, and only to billing readers', async () => {
      const { client } = await engagement();
      await superuser(async (c) => {
        await c.query(
          `INSERT INTO hsdg.entity_addresses
             (entity_id, address_type, line1, city, state, pincode, country, is_primary)
           VALUES ($1, 'registered', '12 Ring Road', 'New Delhi', 'Delhi', '110001', 'IN', true)`,
          [client],
        );
        await c.query(
          `INSERT INTO hsdg.entity_contacts (entity_id, full_name, email, phone, is_primary)
           VALUES ($1, 'Accounts Head', 'accounts@example.test', '9800000000', true),
                  ($1, 'Second Contact', 'second@example.test', NULL, false)`,
          [client],
        );
      });
      const res = await http()
        .get(`/api/v1/billing/clients/${client}/profile`)
        .set(bearer(mx))
        .expect(200);
      const p = res.body as ClientBillingProfile;
      expect(p).toMatchObject({
        id: client,
        billingAddress: '12 Ring Road, New Delhi, Delhi 110001',
        stateCode: '07',
        contact: {
          name: 'Accounts Head',
          email: 'accounts@example.test',
          phone: '9800000000',
        },
      });
      expect(p.legalName).toMatch(/^E2E client/);
      expect(typeof p.creditTermsDays).toBe('number');
      // Only what an invoice needs: the second contact is not there.
      expect(JSON.stringify(p)).not.toContain('second@example.test');

      await http().get(`/api/v1/billing/clients/${client}/profile`).set(bearer(sy)).expect(403);
      await http()
        .get(`/api/v1/billing/clients/${client}/profile`)
        .set(bearer(await token('partner.b@dhvaj.in')))
        .expect(404);
    });

    it('lists the clients the caller may bill, searchable', async () => {
      const { client } = await engagement();
      const name = (
        (await http().get(`/api/v1/billing/clients/${client}/profile`).set(bearer(pa)).expect(200))
          .body as ClientBillingProfile
      ).legalName;
      const rows = (
        await http()
          .get(`/api/v1/billing/clients?q=${encodeURIComponent(name)}`)
          .set(bearer(pa))
          .expect(200)
      ).body as BillingClientRow[];
      expect(rows.map((r) => r.id)).toEqual([client]);
      expect(rows[0]).toMatchObject({ outstanding: '0.00', openInvoices: 0 });
    });
  });

  describe('engagement commercial view', () => {
    it('shows the header, fees and hours by person, never the time notes', async () => {
      const { eng, client } = await engagement();
      await http()
        .post(`/api/v1/engagements/${eng}/time/other`)
        .set(bearer(pa))
        .send({
          category: 'client_call',
          minutes: 90,
          date: today,
          note: 'Discussed the secret merger plan',
        })
        .expect(201);
      const res = await http()
        .get(`/api/v1/billing/engagements/${eng}`)
        .set(bearer(mx))
        .expect(200);
      const v = res.body as EngagementCommercialView;
      expect(v).toMatchObject({
        id: eng,
        clientId: client,
        financialYear: '2026-27',
        partner: { name: 'Partner A' },
      });
      expect(v.hours).toEqual([
        expect.objectContaining({
          employeeName: 'Partner A',
          billableSeconds: 5400,
          billedSeconds: 0,
          unbilledSeconds: 5400,
          lastRatePerHour: null,
        }),
      ]);
      expect(Array.isArray(v.feeMilestones)).toBe(true);
      expect(JSON.stringify(v)).not.toContain('secret merger');
      await http().get(`/api/v1/billing/engagements/${eng}`).set(bearer(sy)).expect(403);
    });
  });

  describe('ad-hoc invoices (decision 9.3)', () => {
    it('a manager asks; the engagement partner is told and issues it', async () => {
      const { eng } = await engagement();
      const inv = await adHocDraft(eng);
      const refused = await setStatus(mx, eng, inv.id, 'issued').expect(403);
      expect(refused.body.message).toMatch(/A partner issues this invoice.*"Advisory call"/);

      const asked = await http()
        .post(`/api/v1/billing/invoices/${inv.id}/request-issue`)
        .set(bearer(mx))
        .send({ note: 'Agreed on the phone' })
        .expect(201);
      const req = asked.body as InvoiceIssueRequest;
      expect(req).toMatchObject({
        invoiceId: inv.id,
        engagementId: eng,
        adHocLines: ['Advisory call'],
        note: 'Agreed on the phone',
        closedAt: null,
      });
      await http()
        .post(`/api/v1/billing/invoices/${inv.id}/request-issue`)
        .set(bearer(mx))
        .send({})
        .expect(409);

      const { rows: notes } = await superuser((c) =>
        c.query<{ title: string }>(
          `SELECT n.title FROM hsdg.notifications n
             JOIN hsdg.users u ON u.id = n.recipient_user_id
             JOIN hsdg.employees e ON e.user_id = u.id
            WHERE e.full_name = 'Partner A' AND n.object_id = $1`,
          [inv.id],
        ),
      );
      expect(notes.map((n) => n.title)).toEqual([
        expect.stringMatching(/^Invoice of [\d,]+\.\d{2} to issue · E2E client/),
      ]);

      const mine = (await http().get('/api/v1/billing/approvals').set(bearer(mx)).expect(200))
        .body as ApprovalItem[];
      expect(mine.find((a) => a.id === req.id)).toMatchObject({
        kind: 'invoice_issue',
        status: 'pending',
        amount: inv.total,
      });
      const partnersOwn = (
        await http().get('/api/v1/billing/approvals').set(bearer(pa)).expect(200)
      ).body as ApprovalItem[];
      expect(partnersOwn.find((a) => a.id === req.id)).toBeUndefined();
      const all = (
        await http().get('/api/v1/billing/approvals?scope=all').set(bearer(pa)).expect(200)
      ).body as ApprovalItem[];
      expect(all.find((a) => a.id === req.id)).toBeDefined();

      await setStatus(pa, eng, inv.id, 'issued').expect(201);
      const recent = (
        await http().get('/api/v1/billing/approvals?status=recent').set(bearer(mx)).expect(200)
      ).body as ApprovalItem[];
      expect(recent.find((a) => a.id === req.id)).toMatchObject({ status: 'issued' });
      await http()
        .post(`/api/v1/billing/invoices/${inv.id}/request-issue`)
        .set(bearer(mx))
        .send({})
        .expect(400);
    });

    it('the requester can withdraw; nobody else can', async () => {
      const { eng } = await engagement();
      const inv = await adHocDraft(eng);
      const req = (
        await http()
          .post(`/api/v1/billing/invoices/${inv.id}/request-issue`)
          .set(bearer(mx))
          .send({})
          .expect(201)
      ).body as InvoiceIssueRequest;
      await http()
        .post(`/api/v1/billing/issue-requests/${req.id}/withdraw`)
        .set(bearer(pa))
        .expect(404);
      const back = await http()
        .post(`/api/v1/billing/issue-requests/${req.id}/withdraw`)
        .set(bearer(mx))
        .expect(201);
      expect(back.body).toMatchObject({ closedReason: 'withdrawn' });
      // Asking again opens a new request.
      await http()
        .post(`/api/v1/billing/invoices/${inv.id}/request-issue`)
        .set(bearer(mx))
        .send({})
        .expect(201);
    });

    it('time and agreed fees need no partner; a line edited off its fee does', async () => {
      const { eng } = await engagement();
      const entry = (
        await http()
          .post(`/api/v1/engagements/${eng}/time/other`)
          .set(bearer(pa))
          .send({ category: 'client_call', minutes: 60, date: today })
          .expect(201)
      ).body.id as string;
      const fromTime = (
        await http()
          .post(`/api/v1/billing/engagements/${eng}/time/draft`)
          .set(bearer(mx))
          .send({
            entryIds: [entry],
            rates: [{ stream: 'none', ratePerHour: '2000' }],
            period: 'October 2026',
          })
          .expect(201)
      ).body as InvoiceDetail;
      await http()
        .post(`/api/v1/billing/invoices/${fromTime.id}/request-issue`)
        .set(bearer(mx))
        .send({})
        .expect(400);
      await setStatus(mx, eng, fromTime.id, 'issued').expect(201);

      // An ad-hoc line added to a time draft makes it the partner's.
      const entry2 = (
        await http()
          .post(`/api/v1/engagements/${eng}/time/other`)
          .set(bearer(pa))
          .send({ category: 'client_call', minutes: 30, date: today })
          .expect(201)
      ).body.id as string;
      const mixed = (
        await http()
          .post(`/api/v1/billing/engagements/${eng}/time/draft`)
          .set(bearer(mx))
          .send({
            entryIds: [entry2],
            rates: [{ stream: 'none', ratePerHour: '2000' }],
            period: 'October 2026',
          })
          .expect(201)
      ).body as InvoiceDetail;
      await http()
        .post(`/api/v1/engagements/${eng}/invoices/${mixed.id}/lines`)
        .set(bearer(mx))
        .send({ description: 'Out-of-pocket', quantity: '1', unitAmount: '750.00' })
        .expect(201);
      const refused = await setStatus(mx, eng, mixed.id, 'issued').expect(403);
      expect(refused.body.message).toContain('"Out-of-pocket"');
      // The partner may issue it as it is.
      await setStatus(pa, eng, mixed.id, 'issued').expect(201);
    });
  });

  describe('Accounts desk', () => {
    it('counts drafts, open requests and six months of collections', async () => {
      const { eng } = await engagement();
      const before = (await http().get('/api/v1/accounts/desk').set(bearer(pa)).expect(200))
        .body as AccountsDesk;
      const inv = await adHocDraft(eng);
      await http()
        .post(`/api/v1/billing/invoices/${inv.id}/request-issue`)
        .set(bearer(mx))
        .send({})
        .expect(201);
      const after = (await http().get('/api/v1/accounts/desk').set(bearer(pa)).expect(200))
        .body as AccountsDesk;
      expect(after.queues.readyToIssue).toBe(before.queues.readyToIssue + 1);
      expect(after.queues.waitingForPartner).toBe(before.queues.waitingForPartner + 1);
      expect(after.queues.payrollToBook).toBeNull();
      expect(after.collections).toHaveLength(6);
      expect(after.month.start <= after.asOf && after.asOf <= after.month.end).toBe(true);
      expect(after.kpis.outstanding).toMatch(/^\d+\.\d{2}$/);
      await http().get('/api/v1/accounts/desk').set(bearer(sy)).expect(403);
    });
  });
});
