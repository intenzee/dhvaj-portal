import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { TaxAuditWorkspace } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * F-6 — drafts from portal data. "For a client whose GST and TDS the firm
 * files, those clauses open as 'Draft from portal' with their source." The
 * client master drafts clauses 1–8, the TDS returns the firm filed clause 34,
 * the GST returns 27 and 44, last year's tax audit 18 and 40, and the MSME
 * list 22 and 26 once the client sends it. The lead refreshes the drafts; a
 * changed draft needs confirming again and the answer is never touched.
 */
describe('Tax audit drafts from portal data (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: Record<string, string>;
  let senior: Record<string, string>;
  let eng: string;
  let entity: string;
  let auditId: string;
  let gstFiling: string;
  const FY = '2025-26';
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const base = () => `/api/v1/engagements/${eng}/tax-audits/${auditId}`;
  const view = async (who = pa) =>
    (await http().get(`${base()}/clauses`).set(who).expect(200)).body as TaxAuditWorkspace;
  const paper = (v: TaxAuditWorkspace, no: string) => v.papers.find((p) => p.clauseNo === no)!;
  const refresh = async (who = pa, status = 200) => {
    const v = await view();
    return (
      await http()
        .post(`${base()}/clauses/refresh-drafts`)
        .set(who)
        .send({ version: v.version })
        .expect(status)
    ).body as TaxAuditWorkspace;
  };
  const confirm = async (no: string) => {
    const wp = paper(await view(), no);
    await http()
      .post(`${base()}/clauses/${wp.id}/confirm-draft`)
      .set(pa)
      .send({ version: wp.version })
      .expect(200);
  };

  /** A filed return of the stream on the engagement, as the superuser. */
  async function filed(p: {
    stream: 'tds' | 'gst';
    form: string;
    periodKey: string;
    start: string;
    end: string;
    due: string;
    filedOn: string;
    figures: Record<string, number>;
    interest?: number;
  }): Promise<string> {
    // Lodged as a record without its acknowledgement: the firm's checks are
    // relaxed for the insert and put back as they were.
    await su.query('BEGIN');
    const {
      rows: [fs],
    } = await su.query<{ strict_checks: unknown }>(
      `SELECT strict_checks FROM hsdg.firm_settings LIMIT 1`,
    );
    await su.query(`UPDATE hsdg.firm_settings SET strict_checks = '{}'::jsonb`);
    const {
      rows: [rv],
    } = await su.query<{ id: string; rule: string }>(
      `SELECT v.id, v.compliance_rule_id AS rule FROM hsdg.compliance_rule_versions v
        WHERE v.stream = $1 ORDER BY v.effective_from LIMIT 1`,
      [p.stream],
    );
    const {
      rows: [ci],
    } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.compliance_instances
         (engagement_id, compliance_rule_id, compliance_rule_version_id, reference_date,
          statutory_deadline, internal_sla_date, financial_year, period_key, period_start,
          period_end, form_label, workflow_status)
       VALUES ($1, $2, $3, $4::date, $5::date, $5::date, $6, $7, $4::date, $8::date, $9, 'filed')
       RETURNING id`,
      [eng, rv!.rule, rv!.id, p.start, p.due, FY, p.periodKey, p.end, p.form],
    );
    const {
      rows: [fr],
    } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.filing_records
         (compliance_instance_id, engagement_id, compliance_rule_id, period_key, reference_kind,
          reference_no, filed_on, figures, interest_paid)
       VALUES ($1, $2, $3, $4, 'ack', $5, $6::date, $7::jsonb, $8) RETURNING id`,
      [
        ci!.id,
        eng,
        rv!.rule,
        p.periodKey,
        `ACK-${Date.now().toString(36).toUpperCase()}`,
        p.filedOn,
        JSON.stringify(p.figures),
        p.interest ?? null,
      ],
    );
    await su.query(`UPDATE hsdg.firm_settings SET strict_checks = $1::jsonb`, [
      JSON.stringify(fs!.strict_checks),
    ]);
    await su.query('COMMIT');
    return fr!.id;
  }

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    pa = await as('partner.a@dhvaj.in');
    senior = await as('senior.y@dhvaj.in');

    const acme = await http().get('/api/v1/entities?search=Acme&limit=10').set(pa).expect(200);
    entity = await freshClient(acme.body.items[0].id as string);
    await su.query(
      `UPDATE hsdg.entities SET annual_turnover = 25000000, pan = NULL, incorporation_date = '2009-06-01'
        WHERE id = $1`,
      [entity],
    );
    await su.query(
      `INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, state_code, status)
       VALUES ($1, 'gstin', '03AAACZ' || substr(md5(random()::text), 1, 4) || 'Z1Z5', '03', 'active')`,
      [entity],
    );
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          kind: 'compliance',
          entityId: entity,
          status: 'accepted',
          financialYear: FY,
          streams: ['income_tax', 'tax_audit'],
          years: [{ financialYear: FY }],
        })
        .expect(201)
    ).body.id as string;
    auditId = (await http().get(`/api/v1/engagements/${eng}/tax-audits`).set(pa).expect(200))
      .body[0].id as string;
    const { rows: sy } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE user_id = (SELECT id FROM hsdg.users WHERE email = 'senior.y@dhvaj.in')`,
    );
    await su.query(
      `INSERT INTO hsdg.engagement_team (engagement_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [eng, sy[0]!.id],
    );

    // The year's applicability decision: s.44AB(a).
    await su.query(
      `DELETE FROM hsdg.tax_audit_applicability WHERE engagement_id = $1 AND financial_year = $2`,
      [eng, FY],
    );
    await su.query(
      `INSERT INTO hsdg.tax_audit_applicability
         (engagement_id, financial_year, inputs, computed_applicable, computed_clause, computed_reason)
       VALUES ($1, $2, '{}', true, '44AB(a)', 'Business turnover over the limit.')`,
      [eng, FY],
    );

    // The firm filed the client's TDS (Q2 late, with interest) and GST.
    await filed({
      stream: 'tds',
      form: '26Q',
      periodKey: 'Q1',
      start: '2025-04-01',
      end: '2025-06-30',
      due: '2025-07-31',
      filedOn: '2025-07-25',
      figures: { tax_deducted: 18000, tax_deposited: 18000 },
    });
    await filed({
      stream: 'tds',
      form: '26Q',
      periodKey: 'Q2',
      start: '2025-07-01',
      end: '2025-09-30',
      due: '2025-10-31',
      filedOn: '2025-11-12',
      figures: {},
      interest: 900,
    });
    gstFiling = await filed({
      stream: 'gst',
      form: 'GSTR-3B',
      periodKey: '2025-04',
      start: '2025-04-01',
      end: '2025-04-30',
      due: '2025-05-20',
      filedOn: '2025-05-19',
      figures: { itc_igst: 1000, itc_cgst: 400, itc_sgst: 400, itc_cess: 0 },
    });

    // Last year's tax audit of the client, its depreciation and ratios done.
    const {
      rows: [ly],
    } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.tax_audits (engagement_id, financial_year, stage)
       VALUES ($1, '2024-25', 'clause_work') RETURNING id`,
      [eng],
    );
    const {
      rows: [pkg],
    } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.tax_audit_clause_packages (tax_audit_id, engagement_id, package, grade)
       VALUES ($1, $2, 'depreciation', 'article') RETURNING id`,
      [ly!.id, eng],
    );
    for (const [no, answer] of [
      ['18', { blocks: 'Plant and machinery\t15\t200000\t0\t0\t30000\t170000' }],
      ['40', { ratios: 'Gross profit / turnover\t22.4%\t21.0%' }],
    ] as const) {
      await su.query(
        `INSERT INTO hsdg.tax_audit_working_papers
           (tax_audit_id, engagement_id, package_id, library_clause_id, clause_no, status, answer, done_at)
         SELECT $1, $2, $3, c.id, c.clause_no, 'done', $5::jsonb, now()
           FROM hsdg.tax_audit_clause_library c
           JOIN hsdg.tax_audit_clause_library_versions v ON v.id = c.library_version_id
          WHERE v.version_no = 1 AND c.clause_no = $4`,
        [ly!.id, eng, pkg!.id, no, JSON.stringify(answer)],
      );
    }
    await su.query(`UPDATE hsdg.tax_audits SET stage = 'information' WHERE id = $1`, [auditId]);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('opens the 3CD work with drafts from the client master, the returns and last year', async () => {
    const v0 = await view();
    const v = (
      await http().post(`${base()}/clauses/open`).set(pa).send({ version: v0.version }).expect(200)
    ).body as TaxAuditWorkspace;
    const { rows: ent } = await su.query<{ legal_name: string }>(
      `SELECT legal_name FROM hsdg.entities WHERE id = $1`,
      [entity],
    );

    expect(paper(v, '1')).toMatchObject({
      draftSource: 'client_master',
      draftAnswer: { name: ent[0]!.legal_name },
      draftConfirmedAt: null,
    });
    // The master holds no PAN: nothing to draft.
    expect(paper(v, '3').draftSource).toBeNull();
    expect(paper(v, '4').draftAnswer).toMatchObject({ liable: true });
    expect(paper(v, '4').draftAnswer!.registrations).toMatch(/^GSTIN\t03AAACZ/m);
    expect(paper(v, '6').draftAnswer).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(paper(v, '7').draftAnswer).toEqual({ ay: '2026-27' });
    expect(paper(v, '8')).toMatchObject({
      draftSource: 'client_master',
      draftAnswer: { clause: '44AB(a)' },
    });

    const tds = paper(v, '34');
    expect(tds.draftSource).toBe('tds_filings');
    expect(tds.draftAnswer).toEqual({
      a: '26Q\tQ1\t18000\t18000',
      b: '26Q\tQ1\t2025-07-31\t2025-07-25\tYes\n26Q\tQ2\t2025-10-31\t2025-11-12\tNo',
      c: '26Q\tQ2\t900',
    });
    expect(tds.draftNote).toMatch(/2 TDS\/TCS returns the firm filed for FY 2025-26, 1 after/);
    expect(paper(v, '27')).toMatchObject({
      draftSource: 'gst_filings',
      draftAnswer: { a: expect.stringMatching(/\tGSTR-3B\t2025-04\t1000\t400\t400\t0$/) },
    });
    expect(paper(v, '44').draftAnswer!.breakup).toMatch(/\t1\t1800$/);

    expect(paper(v, '18')).toMatchObject({
      draftSource: 'last_year',
      draftAnswer: { blocks: 'Plant and machinery\t15\t170000' },
    });
    expect(paper(v, '40').draftAnswer).toEqual({ ratios: 'Gross profit / turnover\t\t22.4%' });
    // No MSME list yet, and clauses with no source: no draft.
    expect(paper(v, '22').draftSource).toBeNull();
    expect(paper(v, '26').draftSource).toBeNull();
    expect(paper(v, '10').draftSource).toBeNull();

    // The draft blocks review until confirmed; confirming fills the blanks.
    await confirm('34');
    const after = paper(await view(), '34');
    expect(after.draftConfirmedAt).not.toBeNull();
    expect(after.answer).toMatchObject({ b: tds.draftAnswer!.b });
  });

  it('only the partner or manager refreshes; nothing changed leaves confirmations alone', async () => {
    await http()
      .post(`${base()}/clauses/refresh-drafts`)
      .set(senior)
      .send({ version: (await view()).version })
      .expect(403)
      .expect((r) => expect(r.body.message).toContain('partner or manager'));
    const v = await refresh();
    expect(paper(v, '34').draftConfirmedAt).not.toBeNull();
    const { rows } = await su.query(
      `SELECT 1 FROM hsdg.audit_events WHERE object_id::text = $1 AND action = 'tax_audit.drafts_refreshed'`,
      [auditId],
    );
    expect(rows).toHaveLength(0);
  });

  it('refresh drafts the MSME clauses once the list is in, and takes away a gone source', async () => {
    await http()
      .post(`${base()}/information-requests`)
      .set(pa)
      .send({ items: ['msme_list'] })
      .expect((r) => expect([200, 201]).toContain(r.status));
    await su.query(
      `UPDATE hsdg.client_dependencies SET status = 'received', received_date = '2026-05-04'
        WHERE tax_audit_id = $1 AND tax_audit_item = 'msme_list'`,
      [auditId],
    );
    // The GST return is undone: its unconfirmed drafts go.
    const { rows: me } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE user_id = (SELECT id FROM hsdg.users WHERE email = 'partner.a@dhvaj.in')`,
    );
    await su.query(
      `UPDATE hsdg.filing_records SET undone_at = now(), undone_by_employee_id = $2, undo_reason = 'Wrong period'
        WHERE id = $1`,
      [gstFiling, me[0]!.id],
    );

    const v = await refresh();
    expect(paper(v, '22')).toMatchObject({ draftSource: 'msme_list', draftAnswer: {} });
    expect(paper(v, '22').draftNote).toMatch(/MSME supplier list on 2026-05-04/);
    expect(paper(v, '26').draftSource).toBe('msme_list');
    expect(paper(v, '27').draftSource).toBeNull();
    expect(paper(v, '44').draftSource).toBeNull();
    const { rows } = await su.query<{ after: { drafted: string[]; cleared: string[] } }>(
      `SELECT after_state AS after FROM hsdg.audit_events WHERE object_id::text = $1 AND action = 'tax_audit.drafts_refreshed'`,
      [auditId],
    );
    expect(rows[0]!.after).toEqual({ drafted: ['22', '26'], cleared: ['27', '44'] });
  });

  it('a changed master redrafts a confirmed clause for confirming again; the answer stays', async () => {
    await confirm('1');
    const before = paper(await view(), '1');
    await su.query(`UPDATE hsdg.entities SET legal_name = legal_name || ' LLP' WHERE id = $1`, [
      entity,
    ]);
    const wp = paper(await refresh(), '1');
    expect(wp.draftConfirmedAt).toBeNull();
    expect(wp.draftAnswer!.name).toMatch(/ LLP$/);
    expect(wp.answer).toEqual(before.answer);
  });
});
