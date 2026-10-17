import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { NotificationItem, TodayView } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { dateFromToday } from './date.helper';

/**
 * PS-205 · Credit notes and write-offs, with a partner's approval.
 *
 * Done when: a manager requests a ₹5,000 write-off, the partner approves it
 * from Today, and the invoice shows it. Also: the requester cannot decide
 * their own request, only approval moves the balance, a rejection leaves it,
 * and a credit note carries the invoice's GST and a CN number.
 */
describe('PS-205 credit notes and write-offs (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let mx: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const today = dateFromToday(0);

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

  /** A fresh NORTH client and an engagement Partner A leads on it. */
  const client = async (): Promise<{ entityId: string; eng: string }> => {
    const bharat = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=GST_MONTHLY&limit=100');
    const entityId = await freshClient(bharat);
    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `P${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return { entityId, eng: res.body.id as string };
  };

  /** An issued invoice with one line of `amount` (tax as the firm settings say). */
  const invoice = async (eng: string, amount: string): Promise<string> => {
    const d = await http()
      .post(`/api/v1/engagements/${eng}/invoices`)
      .set(bearer(pa))
      .send({
        dueDate: dateFromToday(15),
        lines: [{ description: 'Professional fees', unitAmount: amount }],
      })
      .expect(201);
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${d.body.id as string}/status`)
      .set(bearer(pa))
      .send({ status: 'issued', issueDate: today })
      .expect(201);
    return d.body.id as string;
  };

  const getInvoice = async (eng: string, id: string): Promise<Record<string, unknown>> =>
    (await http().get(`/api/v1/engagements/${eng}/invoices/${id}`).set(bearer(pa)).expect(200))
      .body as Record<string, unknown>;

  const writeOff = (t: string, inv: string, amount: string) =>
    http()
      .post(`/api/v1/billing/invoices/${inv}/write-offs`)
      .set(bearer(t))
      .send({ amount, reason: 'Client disputes the extra visit' });

  const decide = (
    t: string,
    kind: 'write-offs' | 'credit-notes',
    id: string,
    decision: 'approve' | 'reject',
  ) =>
    http()
      .post(`/api/v1/billing/${kind}/${id}/decision`)
      .set(bearer(t))
      .send({ decision, note: decision === 'reject' ? 'Bill it in full' : null });

  const todayView = async (t: string): Promise<TodayView> =>
    (await http().get('/api/v1/work/today').set(bearer(t)).expect(200)).body as TodayView;
  const inbox = async (t: string): Promise<NotificationItem[]> =>
    (await http().get('/api/v1/notifications?limit=100').set(bearer(t)).expect(200)).body
      .items as NotificationItem[];

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
  });

  afterAll(async () => {
    // Other suites share the database and expect no firm GST state.
    await superuser((c) =>
      c.query(`UPDATE hsdg.firm_settings SET gstin = NULL, state_code = NULL`),
    );
    await app?.close();
  });

  it('a manager asks to write off ₹5,000; the partner approves it from Today and the invoice shows it', async () => {
    const { entityId, eng } = await client();
    const inv = await invoice(eng, '100000.00');

    const req = await writeOff(mx, inv, '5000').expect(201);
    expect(req.body).toMatchObject({
      kind: 'write_off',
      status: 'pending',
      total: '5000.00',
      invoiceId: inv,
    });
    const id = req.body.id as string;
    // Asking moves nothing.
    expect(await getInvoice(eng, inv)).toMatchObject({ status: 'issued', balance: '100000.00' });

    // Partner A has it on Today and in the bell; the manager has not.
    const row = (await todayView(pa)).groups
      .find((g) => g.group === 'write_offs')
      ?.items.find((i) => i.key === `write_off:${id}`);
    expect(row).toMatchObject({
      kind: 'write_off',
      engagementId: eng,
      adjustment: { id, amount: '5000.00', invoiceId: inv },
    });
    expect((await todayView(mx)).groups.map((g) => g.group)).not.toContain('write_offs');
    const pending = (await inbox(pa)).filter(
      (n) => n.objectId === id && n.type === 'write_off_pending',
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: 'actionable', status: 'unread', engagementId: eng });

    // Approve it from the Today row.
    const ok = await decide(pa, 'write-offs', row!.adjustment!.id, 'approve').expect(201);
    expect(ok.body).toMatchObject({ status: 'approved', decidedByName: expect.any(String) });
    expect(await getInvoice(eng, inv)).toMatchObject({
      status: 'partially_paid',
      amountSettled: '5000.00',
      balance: '95000.00',
    });
    const done = (await inbox(pa)).find((n) => n.objectId === id)!;
    expect(done.status).toBe('read');
    expect(done.resolvedAt).not.toBeNull();
    expect(
      (await todayView(pa)).groups
        .find((g) => g.group === 'write_offs')
        ?.items.some((i) => i.key === `write_off:${id}`),
    ).toBe(false);

    const listed = await http()
      .get(`/api/v1/billing/adjustments?invoiceId=${inv}`)
      .set(bearer(pa))
      .expect(200);
    expect(listed.body).toEqual([expect.objectContaining({ id, status: 'approved' })]);

    const st = await http()
      .get(`/api/v1/billing/clients/${entityId}/statement`)
      .set(bearer(pa))
      .expect(200);
    expect(st.body.totals).toMatchObject({ credited: '5000.00', balance: '95000.00' });
    expect(st.body.credits).toEqual([
      expect.objectContaining({ id, kind: 'write_off', amount: '5000.00', invoiceId: inv }),
    ]);
    expect((st.body.lines as Array<{ kind: string }>).map((l) => l.kind)).toEqual([
      'invoice',
      'write_off',
    ]);
    // No number of its own: the line names the invoice it came off.
    const lines = st.body.lines as Array<{ kind: string; reference: string | null }>;
    expect(lines[1]!.reference).toBe(lines[0]!.reference);
    expect(lines[1]!.reference).toMatch(/^INV\//);
  });

  it('refuses the requester deciding their own request, in the API and the database', async () => {
    const { eng } = await client();
    const inv = await invoice(eng, '20000.00');
    const id = (await writeOff(pa, inv, '1000').expect(201)).body.id as string;
    await decide(pa, 'write-offs', id, 'approve').expect(403);
    await decide(pa, 'write-offs', id, 'reject').expect(403);
    // Even past the API, the guard holds.
    await expect(
      superuser((c) =>
        c.query(
          `UPDATE hsdg.write_offs SET status = 'approved',
                  decided_by_employee_id = requested_by_employee_id WHERE id = $1`,
          [id],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await getInvoice(eng, inv)).toMatchObject({ balance: '20000.00' });
    // A manager cannot decide at all (no billing.approve).
    await decide(mx, 'write-offs', id, 'approve').expect(403);
    // Someone else can.
    await decide(mp, 'write-offs', id, 'approve').expect(201);
    expect(await getInvoice(eng, inv)).toMatchObject({ balance: '19000.00' });
  });

  it('a rejection leaves the balance; a decided request cannot be decided again', async () => {
    const { eng } = await client();
    const inv = await invoice(eng, '30000.00');
    const id = (await writeOff(mx, inv, '30000').expect(201)).body.id as string;
    const no = await decide(pa, 'write-offs', id, 'reject').expect(201);
    expect(no.body).toMatchObject({ status: 'rejected', decisionNote: 'Bill it in full' });
    expect(await getInvoice(eng, inv)).toMatchObject({ status: 'issued', balance: '30000.00' });
    await decide(pa, 'write-offs', id, 'approve').expect(400);
    // More than is owed is refused at the request.
    await writeOff(mx, inv, '30000.01').expect(400);
  });

  it('a full write-off settles the invoice; a void or paid one cannot be reduced', async () => {
    const { eng } = await client();
    const inv = await invoice(eng, '8000.00');
    const id = (await writeOff(mx, inv, '8000').expect(201)).body.id as string;
    await decide(pa, 'write-offs', id, 'approve').expect(201);
    expect(await getInvoice(eng, inv)).toMatchObject({ status: 'paid', balance: '0.00' });
    await writeOff(mx, inv, '1').expect(400);
  });

  it('tells the managing partner of a request raised in another office', async () => {
    // A SOUTH client: Partner B (SOUTH) bills it; the managing partner sits in NORTH.
    const pb = await token('partner.b@dhvaj.in');
    const bharat = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=GST_MONTHLY&limit=100');
    const entityId = await freshClient(bharat);
    await superuser((c) =>
      c.query(
        `UPDATE hsdg.entities SET home_office_id = (SELECT id FROM hsdg.offices WHERE code = 'SOUTH')
          WHERE id = $1`,
        [entityId],
      ),
    );
    const eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pb))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `P${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    const d = await http()
      .post(`/api/v1/engagements/${eng}/invoices`)
      .set(bearer(pb))
      .send({ dueDate: dateFromToday(15), lines: [{ description: 'Fees', unitAmount: '40000' }] })
      .expect(201);
    const inv = d.body.id as string;
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${inv}/status`)
      .set(bearer(pb))
      .send({ status: 'issued', issueDate: today })
      .expect(201);

    const id = (await writeOff(pb, inv, '2500').expect(201)).body.id as string;
    const about = (items: NotificationItem[]) =>
      items.filter((n) => n.objectId === id && n.type === 'write_off_pending');
    expect(about(await inbox(mp))).toHaveLength(1);
    // Not the requester, and not a NORTH partner who cannot bill a SOUTH client.
    expect(about(await inbox(pb))).toHaveLength(0);
    expect(about(await inbox(pa))).toHaveLength(0);

    await decide(mp, 'write-offs', id, 'approve').expect(201);
    expect(about(await inbox(mp))[0]!.resolvedAt).not.toBeNull();
  });

  it('a credit note carries the invoice GST and takes a CN number on approval', async () => {
    const settings = await http().get('/api/v1/billing/settings').set(bearer(mp)).expect(200);
    await http()
      .patch('/api/v1/billing/settings')
      .set(bearer(mp))
      .send({ version: settings.body.version, gstin: '07AAAFD1234K1Z5' })
      .expect(200);
    const { entityId, eng } = await client();
    const inv = await invoice(eng, '100000.00');
    expect(await getInvoice(eng, inv)).toMatchObject({ total: '118000.00' });

    const [line] = (await getInvoice(eng, inv)).lines as { id: string }[];
    const req = await http()
      .post(`/api/v1/billing/invoices/${inv}/credit-notes`)
      .set(bearer(mx))
      .send({
        lines: [{ invoiceLineId: line!.id, taxableValue: '5000' }],
        reason: 'One return dropped from scope',
      })
      .expect(201);
    expect(req.body).toMatchObject({
      kind: 'credit_note',
      status: 'pending',
      number: null,
      taxableValue: '5000.00',
      gstRate: '18.00',
      cgst: '450.00',
      sgst: '450.00',
      igst: '0.00',
      total: '5900.00',
    });
    expect(await getInvoice(eng, inv)).toMatchObject({ balance: '118000.00' });

    const ok = await decide(pa, 'credit-notes', req.body.id as string, 'approve').expect(201);
    expect(ok.body.number).toMatch(/^CN\/\d{2}-\d{2}\/\d{4,}$/);
    expect(ok.body.creditDate).toBe(today);
    expect(await getInvoice(eng, inv)).toMatchObject({
      status: 'partially_paid',
      balance: '112100.00',
    });
    const st = await http()
      .get(`/api/v1/billing/clients/${entityId}/statement`)
      .set(bearer(pa))
      .expect(200);
    expect(st.body.credits).toEqual([
      expect.objectContaining({ kind: 'credit_note', number: ok.body.number, amount: '5900.00' }),
    ]);
  });

  it("looking up approvers switches to 'system' only inside the lookup; the caller's RLS is unchanged after", async () => {
    const { entityId } = await client();
    const who = await superuser(async (c) => {
      const { rows } = await c.query<{
        email: string;
        user_id: string;
        emp: string;
        office: string;
      }>(
        `SELECT u.email::text, u.id AS user_id, e.id AS emp, u.primary_office_id AS office
           FROM hsdg.users u JOIN hsdg.employees e ON e.user_id = u.id
          WHERE u.email IN ('manager.x@dhvaj.in', 'partner.b@dhvaj.in', 'partner.a@dhvaj.in')`,
      );
      const all = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM hsdg.users`);
      return { by: new Map(rows.map((r) => [r.email, r])), allUsers: all.rows[0]!.n };
    });
    const asCaller = async (email: string, role: string) => {
      const u = who.by.get(email)!;
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query(
          `SELECT set_config('hsdg.user_id', $1, true), set_config('hsdg.role', $2, true),
                  set_config('hsdg.office_id', $3, true), set_config('hsdg.employee_id', $4, true)`,
          [u.user_id, role, u.office, u.emp],
        );
        const users = async () =>
          (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM hsdg.users`)).rows[0]!.n;
        const before = await users();
        const approvers = (
          await c.query<{ id: string }>(`SELECT hsdg.billing_approvers($1) AS id`, [entityId])
        ).rows.map((r) => r.id);
        const roleAfter = (
          await c.query<{ r: string }>(`SELECT current_setting('hsdg.role', true) AS r`)
        ).rows[0]!.r;
        const after = await users();
        await c.query('ROLLBACK');
        return { approvers, roleAfter, before, after };
      } finally {
        await c.end();
      }
    };

    // The client's manager (NORTH) finds the approvers, and is still a manager after.
    const m = await asCaller('manager.x@dhvaj.in', 'manager');
    expect(m.approvers).toContain(who.by.get('partner.a@dhvaj.in')!.emp);
    expect(m.roleAfter).toBe('manager');
    expect(m.after).toBe(m.before);
    expect(m.before).toBeLessThan(who.allUsers);
    // Another office's partner is told nothing, and keeps their role.
    const b = await asCaller('partner.b@dhvaj.in', 'partner');
    expect(b.approvers).toEqual([]);
    expect(b.roleAfter).toBe('partner');
    expect(b.after).toBe(b.before);
  });

  it("splits a credit note's GST per invoice line, at each line's rate, within what is left of it", async () => {
    const settings = await http().get('/api/v1/billing/settings').set(bearer(mp)).expect(200);
    await http()
      .patch('/api/v1/billing/settings')
      .set(bearer(mp))
      .send({ version: settings.body.version, gstin: '07AAAFD1234K1Z5' })
      .expect(200);
    const { eng } = await client();
    const d = await http()
      .post(`/api/v1/engagements/${eng}/invoices`)
      .set(bearer(pa))
      .send({
        dueDate: dateFromToday(15),
        lines: [
          { description: 'GST returns', unitAmount: '10000.00', gstRate: 18 },
          { description: 'Courier and filing', unitAmount: '2000.00', gstRate: 5 },
        ],
      })
      .expect(201);
    const inv = d.body.id as string;
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${inv}/status`)
      .set(bearer(pa))
      .send({ status: 'issued', issueDate: today })
      .expect(201);
    const detail = await getInvoice(eng, inv);
    expect(detail).toMatchObject({ total: '13900.00' });
    const [fees, courier] = detail.lines as { id: string; description: string }[];
    const credit = (lines: { invoiceLineId: string; taxableValue: string }[]) =>
      http()
        .post(`/api/v1/billing/invoices/${inv}/credit-notes`)
        .set(bearer(mx))
        .send({ lines, reason: 'Courier not used; one return dropped' });

    const req = await credit([
      { invoiceLineId: fees!.id, taxableValue: '1000' },
      { invoiceLineId: courier!.id, taxableValue: '2000' },
    ]).expect(201);
    expect(req.body).toMatchObject({
      taxableValue: '3000.00',
      gstRate: null,
      cgst: '140.00',
      sgst: '140.00',
      igst: '0.00',
      total: '3280.00',
      lines: [
        {
          invoiceLineId: fees!.id,
          gstRate: '18.00',
          cgst: '90.00',
          sgst: '90.00',
          total: '1180.00',
        },
        {
          invoiceLineId: courier!.id,
          gstRate: '5.00',
          cgst: '50.00',
          sgst: '50.00',
          total: '2100.00',
        },
      ],
    });

    // The courier line is fully credited (pending counts); the fees line has 9,000 left.
    await credit([{ invoiceLineId: courier!.id, taxableValue: '0.01' }]).expect(400);
    const over = await credit([{ invoiceLineId: fees!.id, taxableValue: '9000.01' }]).expect(400);
    expect(over.body.message).toMatch(/left to credit/);
    // Not a line of this invoice; the same line twice.
    const otherEng = (await client()).eng;
    const otherInv = await invoice(otherEng, '500.00');
    const [foreign] = (await getInvoice(otherEng, otherInv)).lines as { id: string }[];
    await credit([{ invoiceLineId: foreign!.id, taxableValue: '10' }]).expect(400);
    await credit([
      { invoiceLineId: fees!.id, taxableValue: '10' },
      { invoiceLineId: fees!.id, taxableValue: '10' },
    ]).expect(400);

    // A rejected note frees its lines.
    await decide(pa, 'credit-notes', req.body.id as string, 'reject').expect(201);
    await credit([{ invoiceLineId: courier!.id, taxableValue: '2000' }]).expect(201);

    // The database refuses a line beyond what is left, whatever the API says.
    await expect(
      superuser(async (c) => {
        await c.query('BEGIN');
        try {
          const { rows } = await c.query<{ id: string }>(
            `INSERT INTO hsdg.credit_notes (invoice_id, client_entity_id, reason, taxable_value)
             SELECT id, client_entity_id, 'direct', 1 FROM hsdg.invoices WHERE id = $1
             RETURNING id`,
            [inv],
          );
          await c.query(
            `INSERT INTO hsdg.credit_note_lines (credit_note_id, invoice_line_id, description, taxable_value)
             VALUES ($1, $2, 'x', 1)`,
            [rows[0]!.id, courier!.id],
          );
        } finally {
          await c.query('ROLLBACK');
        }
      }),
    ).rejects.toThrow(/left to credit/);
  });

  /** The firm in Delhi (07), so tax is worked. */
  const firmInDelhi = async () => {
    const settings = await http().get('/api/v1/billing/settings').set(bearer(mp)).expect(200);
    await http()
      .patch('/api/v1/billing/settings')
      .set(bearer(mp))
      .send({ version: settings.body.version, gstin: '07AAAFD1234K1Z5' })
      .expect(200);
  };

  it('two notes crediting a paise-valued invoice in full reverse exactly the GST it charged', async () => {
    await firmInDelhi();
    const { eng } = await client();
    const d = await http()
      .post(`/api/v1/engagements/${eng}/invoices`)
      .set(bearer(pa))
      .send({
        dueDate: dateFromToday(15),
        lines: [
          { description: 'Return A', unitAmount: '333.33', gstRate: 18 },
          { description: 'Return B', unitAmount: '333.33', gstRate: 18 },
          { description: 'Courier', unitAmount: '99.99', gstRate: 5 },
        ],
      })
      .expect(201);
    const inv = d.body.id as string;
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${inv}/status`)
      .set(bearer(pa))
      .send({ status: 'issued', issueDate: today })
      .expect(201);
    const detail = await getInvoice(eng, inv);
    const [a, b, c] = detail.lines as { id: string }[];
    const credit = (lines: { invoiceLineId: string; taxableValue: string }[]) =>
      http()
        .post(`/api/v1/billing/invoices/${inv}/credit-notes`)
        .set(bearer(mx))
        .send({ lines, reason: 'Engagement withdrawn' })
        .expect(201);

    const first = await credit([{ invoiceLineId: a!.id, taxableValue: '333.33' }]);
    await decide(pa, 'credit-notes', first.body.id as string, 'approve').expect(201);
    const last = await credit([
      { invoiceLineId: b!.id, taxableValue: '333.33' },
      { invoiceLineId: c!.id, taxableValue: '99.99' },
    ]);
    await decide(pa, 'credit-notes', last.body.id as string, 'approve').expect(201);

    const paise = (v: unknown) => Math.round(Number(v) * 100);
    expect(paise(first.body.cgst) + paise(last.body.cgst)).toBe(paise(detail.cgst));
    expect(paise(first.body.sgst) + paise(last.body.sgst)).toBe(paise(detail.sgst));
    expect(paise(first.body.total) + paise(last.body.total)).toBe(paise(detail.total));
    expect(await getInvoice(eng, inv)).toMatchObject({ status: 'paid', balance: '0.00' });
  });

  it('refuses a GST credit note after the CGST s.34 date, at request and at approval; a write-off still goes', async () => {
    await firmInDelhi();
    const { eng } = await client();
    const inv = await invoice(eng, '10000.00');
    const [line] = (await getInvoice(eng, inv)).lines as { id: string }[];
    const credit = () =>
      http()
        .post(`/api/v1/billing/invoices/${inv}/credit-notes`)
        .set(bearer(mx))
        .send({
          lines: [{ invoiceLineId: line!.id, taxableValue: '1000' }],
          reason: 'Late dispute',
        });
    // Asked in time, then the date passes before a partner decides.
    const pending = await credit().expect(201);
    await superuser(async (cl) => {
      await cl.query('BEGIN');
      await cl.query(`SET LOCAL session_replication_role = replica`);
      await cl.query(`UPDATE hsdg.invoices SET issue_date = '2024-05-10' WHERE id = $1`, [inv]);
      await cl.query('COMMIT');
    });

    const late = await decide(pa, 'credit-notes', pending.body.id as string, 'approve').expect(400);
    expect(late.body.message).toMatch(/section 34 of the CGST Act.*30 Nov 2025.*write-off/);
    await decide(pa, 'credit-notes', pending.body.id as string, 'reject').expect(201);
    const refused = await credit().expect(400);
    expect(refused.body.message).toMatch(/section 34/);
    await writeOff(mx, inv, '1000.00').expect(201);
  });

  it('defaults the place of supply from the address, else the firm; asks for it when GSTINs are in several states', async () => {
    await firmInDelhi();
    // An unregistered client with its office in Maharashtra: IGST.
    const mumbai = await client();
    await superuser((cl) =>
      cl.query(`UPDATE hsdg.entity_registrations SET status = 'cancelled' WHERE entity_id = $1;`, [
        mumbai.entityId,
      ]),
    );
    await superuser((cl) =>
      cl.query(
        `INSERT INTO hsdg.entity_addresses (entity_id, address_type, line1, state, is_primary)
         VALUES ($1, 'registered', '4 Nariman Point', 'Maharashtra', true)`,
        [mumbai.entityId],
      ),
    );
    const m = await http()
      .post(`/api/v1/engagements/${mumbai.eng}/invoices`)
      .set(bearer(pa))
      .send({ lines: [{ description: 'Advice', unitAmount: '1000.00' }] })
      .expect(201);
    expect(m.body).toMatchObject({ placeOfSupplyState: '27', igst: '180.00', cgst: '0.00' });

    // No GSTIN and no address: the firm's own state (IGST Act s.12(2)(b)(ii)).
    const none = await client();
    const n = await http()
      .post(`/api/v1/engagements/${none.eng}/invoices`)
      .set(bearer(pa))
      .send({ lines: [{ description: 'Advice', unitAmount: '1000.00' }] })
      .expect(201);
    expect(n.body).toMatchObject({ placeOfSupplyState: '07', cgst: '90.00' });

    // GSTINs in Delhi and Karnataka, none picked: issuing asks for the place of supply.
    const two = await client();
    const tag = Math.random()
      .toString(36)
      .replace(/[^a-z]/g, '')
      .toUpperCase()
      .padEnd(5, 'Q');
    await superuser((cl) =>
      cl.query(
        `INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, state_code, status)
         VALUES ($1, 'gstin', $2, '07', 'active'), ($1, 'gstin', $3, '29', 'active')`,
        [two.entityId, `07${tag.slice(0, 5)}1234C1Z5`, `29${tag.slice(0, 5)}1234C1Z5`],
      ),
    );
    const t = await http()
      .post(`/api/v1/engagements/${two.eng}/invoices`)
      .set(bearer(pa))
      .send({ lines: [{ description: 'Advice', unitAmount: '1000.00' }] })
      .expect(201);
    expect(t.body.placeOfSupplyState).toBeNull();
    const issue = () =>
      http()
        .post(`/api/v1/engagements/${two.eng}/invoices/${t.body.id as string}/status`)
        .set(bearer(pa))
        .send({ status: 'issued', issueDate: today });
    const asked = await issue().expect(400);
    expect(asked.body.message).toMatch(/Set the place of supply/);
    await http()
      .patch(`/api/v1/engagements/${two.eng}/invoices/${t.body.id as string}`)
      .set(bearer(pa))
      .send({ placeOfSupplyState: '29', version: t.body.version })
      .expect(200);
    const issued = await issue().expect(201);
    expect(issued.body).toMatchObject({ placeOfSupplyState: '29', igst: '180.00' });
  });
});
