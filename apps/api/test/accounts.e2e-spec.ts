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
  let ac: string;
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
    ac = await token('accounts@dhvaj.in');
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
      expect(refused.body.rule).toBe('AD_HOC_ISSUE_NEEDS_PARTNER');

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
  describe('as the Accountant (accounts@dhvaj.in)', () => {
    /** An engagement with an agreed fee due today, logged time with a note, and an issued invoice. */
    const billed = async () => {
      const { eng, client } = await engagement();
      await http()
        .post(`/api/v1/billing/engagements/${eng}/fee-milestones`)
        .set(bearer(pa))
        .send({ kind: 'milestone', description: 'Return filed', amount: '12000.00', dueOn: today })
        .expect(201);
      const entry = (
        await http()
          .post(`/api/v1/engagements/${eng}/time/other`)
          .set(bearer(pa))
          .send({
            category: 'client_call',
            minutes: 45,
            date: today,
            note: 'Confidential tax plan',
          })
          .expect(201)
      ).body.id as string;
      const inv = await adHocDraft(eng, pa);
      await setStatus(pa, eng, inv.id, 'issued').expect(201);
      const name = (
        (await http().get(`/api/v1/billing/clients/${client}/profile`).set(bearer(pa)).expect(200))
          .body as ClientBillingProfile
      ).legalName;
      return { eng, client, entry, inv, name };
    };

    it('reads receivables, unbilled, receipts and TDS with client names', async () => {
      const { eng, client, inv, name } = await billed();
      const rec = (await http().get('/api/v1/reports/receivables').set(bearer(ac)).expect(200))
        .body as { byClient: { id: string; name: string }[]; byPartner: { name: string }[] };
      expect(rec.byClient.find((c) => c.id === client)?.name).toBe(name);

      const unbilled = (await http().get('/api/v1/billing/unbilled').set(bearer(ac)).expect(200))
        .body as {
        engagements: { engagementId: string; clientName: string; partnerName: string }[];
      };
      expect(unbilled.engagements.find((e) => e.engagementId === eng)).toMatchObject({
        clientName: name,
        partnerName: 'Partner A',
      });

      await http()
        .post('/api/v1/billing/receipts')
        .set(bearer(ac))
        .send({
          clientEntityId: client,
          receivedOn: today,
          mode: 'bank',
          reference: `UTR${unique()}`,
          netAmount: '4500.00',
          tdsAmount: '500.00',
          tdsSection: '194J',
          allocations: [{ invoiceId: inv.id, amount: '5000.00' }],
        })
        .expect(201);
      const receipts = (
        await http().get('/api/v1/billing/receipts?limit=100').set(bearer(ac)).expect(200)
      ).body as { items: { clientEntityId: string; clientName: string }[] };
      expect(receipts.items.find((r) => r.clientEntityId === client)?.clientName).toBe(name);

      const fy =
        today >= `${today.slice(0, 4)}-04-01`
          ? `${today.slice(0, 4)}-${String((Number(today.slice(0, 4)) + 1) % 100).padStart(2, '0')}`
          : `${Number(today.slice(0, 4)) - 1}-${today.slice(2, 4)}`;
      const tds = (
        await http()
          .get(`/api/v1/billing/tds-credits/match?financialYear=${fy}`)
          .set(bearer(ac))
          .expect(200)
      ).body as { clients: { clientId: string; clientName: string }[] };
      expect(tds.clients.find((c) => c.clientId === client)?.clientName).toBe(name);

      const list = (
        await http()
          .get('/api/v1/billing/invoices?limit=100&search=E2E')
          .set(bearer(ac))
          .expect(200)
      ).body as {
        items: { id: string; entityName: string | null; engagementCode: string | null }[];
      };
      expect(list.items.find((i) => i.id === inv.id)).toMatchObject({ entityName: name });
      expect(list.items.find((i) => i.id === inv.id)?.engagementCode).toBeTruthy();
      await http().get('/api/v1/invoices/summary').set(bearer(ac)).expect(200);
    });

    it('bills an agreed fee and billable time, and asks a partner for an ad-hoc invoice', async () => {
      const { eng, entry, inv } = await billed();
      const unbilled = (await http().get('/api/v1/billing/unbilled').set(bearer(ac)).expect(200))
        .body as { engagements: { engagementId: string; items: { key: string }[] }[] };
      const keys = unbilled.engagements
        .find((e) => e.engagementId === eng)!
        .items.map((i) => i.key);
      const fee = (
        await http()
          .post('/api/v1/billing/unbilled/draft')
          .set(bearer(ac))
          .send({ engagementId: eng, keys })
          .expect(201)
      ).body as InvoiceDetail;
      await setStatus(ac, eng, fee.id, 'issued').expect(201);

      const time = (
        await http().get(`/api/v1/billing/engagements/${eng}/time`).set(bearer(ac)).expect(200)
      ).body as { entries: { entryId: string; note: string | null; taskTitle: string | null }[] };
      expect(time.entries.find((e) => e.entryId === entry)).toMatchObject({
        note: null,
        taskTitle: null,
      });
      expect(JSON.stringify(time)).not.toContain('Confidential');
      const fromTime = (
        await http()
          .post(`/api/v1/billing/engagements/${eng}/time/draft`)
          .set(bearer(ac))
          .send({
            entryIds: [entry],
            rates: [{ stream: 'none', ratePerHour: '3000' }],
            period: 'October 2026',
          })
          .expect(201)
      ).body as InvoiceDetail;
      await setStatus(ac, eng, fromTime.id, 'issued').expect(201);
      const lines = (
        await http().get(`/api/v1/billing/invoices/${fromTime.id}/time`).set(bearer(ac)).expect(200)
      ).body as { employeeName: string; workedOn: string }[];
      expect(lines).toEqual([
        expect.objectContaining({ employeeName: 'Partner A', workedOn: today }),
      ]);

      const adHoc = await adHocDraft(eng, ac);
      await setStatus(ac, eng, adHoc.id, 'issued').expect(403);
      await http()
        .post(`/api/v1/billing/invoices/${adHoc.id}/request-issue`)
        .set(bearer(ac))
        .send({ note: 'Extra certificate' })
        .expect(201);
      const sent = (await http().get('/api/v1/billing/approvals').set(bearer(ac)).expect(200))
        .body as ApprovalItem[];
      expect(sent.find((a) => a.invoiceId === adHoc.id)).toMatchObject({
        kind: 'invoice_issue',
        status: 'pending',
      });

      const view = (
        await http().get(`/api/v1/billing/engagements/${eng}`).set(bearer(ac)).expect(200)
      ).body as EngagementCommercialView;
      expect(view.partner?.name).toBe('Partner A');
      expect(view.feeMilestones.map((m) => m.description)).toEqual(['Return filed']);
      expect(view.hours[0]).toMatchObject({ billableSeconds: 2700, billedSeconds: 2700 });
      expect(JSON.stringify(view)).not.toContain('Confidential');

      // Voiding an issued invoice stays with the partner.
      await http()
        .post(`/api/v1/engagements/${eng}/invoices/${inv.id}/status`)
        .set(bearer(ac))
        .send({ status: 'void', reason: 'Wrong amount on it' })
        .expect(403);
      const pdf = await http()
        .get(`/api/v1/engagements/${eng}/invoices/${inv.id}/pdf`)
        .set(bearer(ac))
        .expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
    });

    it('asks, never decides: credit notes, write-offs and waivers go to a partner', async () => {
      const { eng, inv } = await billed();
      const detail = (
        await http()
          .get(`/api/v1/engagements/${eng}/invoices/${inv.id}`)
          .set(bearer(ac))
          .expect(200)
      ).body as InvoiceDetail;
      const cn = await http()
        .post(`/api/v1/billing/invoices/${inv.id}/credit-notes`)
        .set(bearer(ac))
        .send({
          lines: [{ invoiceLineId: detail.lines[0]!.id, taxableValue: '1000.00' }],
          reason: 'Discount agreed with the client',
        })
        .expect(201);
      await http()
        .post(`/api/v1/billing/credit-notes/${cn.body.id as string}/decision`)
        .set(bearer(ac))
        .send({ decision: 'approve' })
        .expect(403);

      const unbilled = (await http().get('/api/v1/billing/unbilled').set(bearer(ac)).expect(200))
        .body as { engagements: { engagementId: string; items: { key: string }[] }[] };
      const keys = unbilled.engagements
        .find((e) => e.engagementId === eng)!
        .items.map((i) => i.key);
      const aside = await http()
        .post('/api/v1/billing/unbilled/set-aside')
        .set(bearer(ac))
        .send({
          engagementId: eng,
          keys,
          kind: 'not_billing',
          reason: 'Goodwill: the return was late',
        })
        .expect(201);
      expect(aside.body).toMatchObject({ setAside: 0, waiver: { status: 'pending' } });
      await http()
        .post(`/api/v1/billing/fee-waivers/${aside.body.waiver.id as string}/decision`)
        .set(bearer(ac))
        .send({ decision: 'approve' })
        .expect(403);
      const sent = (await http().get('/api/v1/billing/approvals').set(bearer(ac)).expect(200))
        .body as ApprovalItem[];
      expect(sent.map((a) => a.kind).sort()).toEqual(
        expect.arrayContaining(['credit_note', 'fee_waiver']),
      );
      await http().patch('/api/v1/billing/settings').set(bearer(ac)).send({}).expect(403);
      await http().get('/api/v1/billing/settings').set(bearer(ac)).expect(200);
    });

    it('opens no client work: engagement, tasks, documents and the client master stay shut', async () => {
      const { eng, client } = await billed();
      for (const path of [
        `/api/v1/engagements/${eng}`,
        `/api/v1/engagements/${eng}/tasks`,
        `/api/v1/engagements/${eng}/time`,
        `/api/v1/entities/${client}`,
        `/api/v1/entities?limit=5`,
      ]) {
        const res = await http().get(path).set(bearer(ac));
        expect([403, 404]).toContain(res.status);
      }
      await http()
        .patch(`/api/v1/engagements/${eng}/commercial`)
        .set(bearer(ac))
        .send({ billingModel: 'fixed' })
        .expect(403);
      const desk = (await http().get('/api/v1/accounts/desk').set(bearer(ac)).expect(200))
        .body as AccountsDesk;
      expect(desk.queues.readyToIssue).toBeGreaterThanOrEqual(0);
    });
  });

  describe('the billing views keep everyone else to today’s rows', () => {
    /** Row counts as hsdg_app under a user's context (rolled back). */
    const counts = async (email: string, sql: Record<string, string>) =>
      superuser(async (c) => {
        await c.query('BEGIN');
        try {
          const { rows: who } = await c.query<{
            user_id: string;
            emp: string | null;
            office: string;
            roles: string[];
          }>(
            `SELECT u.id AS user_id, e.id AS emp, u.primary_office_id AS office,
                    ARRAY(SELECT r.slug FROM hsdg.user_roles ur JOIN hsdg.roles r ON r.id = ur.role_id
                           WHERE ur.user_id = u.id) AS roles
               FROM hsdg.users u LEFT JOIN hsdg.employees e ON e.user_id = u.id
              WHERE u.email = $1`,
            [email],
          );
          const w = who[0]!;
          const order = [
            'managing_partner',
            'partner',
            'administrator',
            'manager',
            'senior',
            'article',
            'accountant',
            'hr',
          ];
          const top = order.find((r) => w.roles.includes(r)) ?? w.roles[0]!;
          await c.query('SET LOCAL ROLE hsdg_app');
          await c.query(
            `SELECT set_config('hsdg.user_id', $1, true), set_config('hsdg.role', $2, true),
                    set_config('hsdg.roles', $3, true), set_config('hsdg.office_id', $4, true),
                    set_config('hsdg.employee_id', $5, true)`,
            [w.user_id, top, w.roles.join(','), w.office, w.emp ?? ''],
          );
          const out: Record<string, number> = {};
          for (const [k, q] of Object.entries(sql)) {
            out[k] = Number(
              (await c.query<{ n: string }>(`SELECT count(*) AS n FROM ${q}`)).rows[0]!.n,
            );
          }
          out.windowAfter = Number(
            (
              await c.query<{ on: boolean }>(
                `SELECT current_setting('hsdg.billing_scope', true) = 'on' AS on`,
              )
            ).rows[0]!.on,
          );
          return out;
        } finally {
          await c.query('ROLLBACK');
        }
      });

    it('partners, managers and seniors read exactly what the tables give them', async () => {
      await billed0();
      for (const email of ['partner.a@dhvaj.in', 'manager.x@dhvaj.in', 'senior.y@dhvaj.in']) {
        const n = await counts(email, {
          entities: 'hsdg.entities',
          profiles: 'hsdg.entity_billing_profiles',
          engagements: 'hsdg.engagements',
          headers: 'hsdg.engagement_billing_headers',
          employees: 'hsdg.employees',
          names: 'hsdg.employee_names',
          tans: `hsdg.entity_registrations WHERE registration_type = 'tan'`,
          clientTans: 'hsdg.client_tans',
          time: `hsdg.effective_time_entries`,
          billable: 'hsdg.billable_time_entries',
        });
        expect({ email, profiles: n.profiles, headers: n.headers, names: n.names }).toEqual({
          email,
          profiles: n.entities,
          headers: n.engagements,
          names: n.employees,
        });
        expect(n.clientTans).toBe(n.tans);
        expect(n.billable).toBe(n.time);
        expect(n.windowAfter).toBe(0);
      }
    });

    it('the Accountant reads every billable client through the views, and no raw table', async () => {
      await billed0();
      const all = await superuser(async (c) =>
        Number(
          (await c.query<{ n: string }>(`SELECT count(*) AS n FROM hsdg.entities`)).rows[0]!.n,
        ),
      );
      const n = await counts('accounts@dhvaj.in', {
        entities: 'hsdg.entities',
        profiles: 'hsdg.entity_billing_profiles',
        engagements: 'hsdg.engagements',
        headers: 'hsdg.engagement_billing_headers',
        time: 'hsdg.engagement_time_entries',
        tasks: 'hsdg.tasks',
        documents: 'hsdg.documents',
        credentials: 'hsdg.client_credentials',
        audit: 'hsdg.audit_events',
        registrations: 'hsdg.entity_registrations',
        contacts: 'hsdg.entity_contacts',
        noteless: `hsdg.billable_time_entries WHERE note IS NOT NULL OR task_id IS NOT NULL`,
      });
      expect(n).toMatchObject({
        entities: 0,
        engagements: 0,
        time: 0,
        tasks: 0,
        documents: 0,
        credentials: 0,
        audit: 0,
        registrations: 0,
        contacts: 0,
        noteless: 0,
        windowAfter: 0,
      });
      expect(n.profiles).toBe(all);
      expect(n.headers).toBeGreaterThan(0);
    });

    /** Some billing data to count over. */
    const billed0 = async (): Promise<void> => {
      const { eng } = await engagement();
      await http()
        .post(`/api/v1/engagements/${eng}/time/other`)
        .set(bearer(pa))
        .send({ category: 'client_call', minutes: 15, date: today, note: 'Note' })
        .expect(201);
    };
  });
});
