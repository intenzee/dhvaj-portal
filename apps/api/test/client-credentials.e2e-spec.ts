import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import {
  gstinCheckChar,
  type ClientImportPreview,
  type ClientImportResult,
  type ClientReturns,
  type EntityCredentials,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * ADR-0035 — clients' portal logins: imported from the firm's login workbook
 * (GST Login + TDS Login sheets), stored only encrypted, unreadable to the
 * app role, shown only through the logged, rate-limited reveal, and only to
 * the client's partner (or the managing partner, or its engagement team). A
 * GST login without its GSTIN waits on the client and moves onto the GSTIN
 * when it is added; the sheet's frequency becomes the GSTIN's scheme and its
 * filed / NA marks are kept as the client's GST return history (GSTIN or
 * not) and close the matching filings — in a GST engagement the import
 * creates, or adds the year / GST to, when the client has none. Marks
 * without a GSTIN are pointed out.
 */
describe('Client portal credentials (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let mx: string;
  let sy: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;

  // Fresh PANs every run: GSTINs, TANs and PANs are unique across the database.
  const letters = (n: number) =>
    Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
      '',
    );
  const digits = (n: number) =>
    String(Math.floor(Math.random() * 9 * 10 ** (n - 1)) + 10 ** (n - 1));
  const pan = (kind: string) => `${letters(3)}${kind}${letters(1)}${digits(4)}${letters(1)}`;
  const gstin = (state: string, p: string) => {
    const first14 = `${state}${p}1Z`;
    return first14 + gstinCheckChar(first14);
  };
  const company = pan('C');
  const firm = pan('F');
  const kiran = pan('P');
  const TAN = `${letters(4)}${digits(5)}${letters(1)}`;
  const G_CO_DL = gstin('07', company);
  const G_CO_MH = gstin('27', company);
  const G_FIRM = gstin('07', firm);
  const typo = (g: string) => g.slice(0, 14) + (g[14] === '0' ? '1' : '0');
  const PASSWORDS = [
    'Pw-Company-Delhi-91!',
    'Pw-Company-Mum-27!',
    'Pw-Firm-Delhi-07!',
    'Pw-Co-Income-Tax!',
    'Pw-Co-Tan-Login!',
    'Pw-Co-Traces-Ded!',
    'Pw-Co-Traces-Tp!',
    'Pw-Kiran-It!',
  ];
  const tag = `Vault${Date.now()}`;

  /** The firm's workbook, laid out as its format file: months in row 3, headings in row 4. */
  const file = (): string => {
    const wb = XLSX.utils.book_new();
    const gst = XLSX.utils.aoa_to_sheet([[]]);
    XLSX.utils.sheet_add_aoa(
      gst,
      [
        ['', '', '', '', '', '', 'Apr-26', '', 'May-26', '', 'Jun-26', ''],
        [
          'S No',
          'Particular',
          'Frequency',
          'ID',
          'Pwd',
          'GSTIN',
          'GSTR-1',
          'GSTR-3',
          'GSTR-1',
          'GSTR-3',
          'GSTR-1',
          'GSTR-3',
          'Fees',
        ],
        [1, `${tag} Company Pvt Ltd (Delhi)`, 'Monthly', 'company_dl', PASSWORDS[0], G_CO_DL],
        [
          2,
          `${tag} Company Pvt Ltd (Maharashtra)`,
          'Quarterly',
          'company_mh',
          PASSWORDS[1],
          '',
          'filed',
        ],
        [
          3,
          `${tag} Firm (Delhi)`,
          'Monthly',
          'firm_dl',
          PASSWORDS[2],
          G_FIRM,
          'filed',
          'filed',
          '',
          'NA',
          'filed',
          '',
          2500,
        ],
        [4, `${tag} Typo`, 'Monthly', '', '', typo(G_FIRM)],
      ],
      { origin: 'A3' },
    );
    gst['!ref'] = 'A3:M8';
    gst['!merges'] = [6, 8, 10].map((c) => ({ s: { r: 2, c }, e: { r: 2, c: c + 1 } }));
    XLSX.utils.book_append_sheet(wb, gst, 'GST Login');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['TDS & Income Tax ID , Passwords'],
        [
          'S.No',
          'Client name',
          'mail',
          'IT- PAN',
          'PWD',
          'IT-TAN',
          'Pwd',
          'Traces ID (Deductor)',
          'Pwd',
          'Traces ID (Tax Payer)',
          'Pwd',
          'DOI',
          'Return filing Status',
          'Ack. No',
        ],
        [
          1,
          `${tag} Company Pvt Ltd`,
          'a@b.in',
          company,
          PASSWORDS[3],
          TAN,
          PASSWORDS[4],
          'co_deductor',
          PASSWORDS[5],
          'co_taxpayer',
          PASSWORDS[6],
          '01/04/2010',
          'Filed',
          '123',
        ],
        [2, `${tag} Kiran`, '', kiran, PASSWORDS[7]],
      ]),
      'TDS Login',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['S.No', 'Client name', 'Quater1'],
        [1, `${tag} Kiran`, 'x'],
      ]),
      'ITR ',
    );
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };
  const body = () => ({ filename: 'logins.xlsx', contentBase64: file(), officeCode: 'NORTH' });
  const runImport = async (): Promise<ClientImportResult> =>
    (await http().post('/api/v1/client-imports/workbook').set(bearer(pa)).send(body()).expect(200))
      .body as ClientImportResult;
  const credentialsOf = async (t: string, entityId: string): Promise<EntityCredentials> =>
    (await http().get(`/api/v1/credentials?entityId=${entityId}`).set(bearer(t)).expect(200))
      .body as EntityCredentials;
  const entityOf = async (p: string): Promise<string> =>
    (await su.query<{ id: string }>(`SELECT id FROM hsdg.entities WHERE pan = $1`, [p])).rows[0]!
      .id;
  const returnsOf = async (t: string, entityId: string): Promise<ClientReturns> =>
    (await http().get(`/api/v1/client-returns?entityId=${entityId}`).set(bearer(t)).expect(200))
      .body as ClientReturns;
  const schemeOf = async (number: string) =>
    (
      await su.query<{ gst_scheme: string; qrmp_category: string | null }>(
        `SELECT p.gst_scheme, p.qrmp_category FROM hsdg.registration_compliance_profiles p
           JOIN hsdg.entity_registrations r ON r.id = p.registration_id
          WHERE r.registration_number = $1`,
        [number],
      )
    ).rows;

  let companyId: string;
  let firmId: string;
  let loginId: string;

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
    await su.end();
    await app.close();
  });

  it('previews the workbook client by client without ever returning a password', async () => {
    const res = await http()
      .post('/api/v1/client-imports/workbook/preview')
      .set(bearer(pa))
      .send(body())
      .expect(200);
    for (const p of PASSWORDS) expect(res.text).not.toContain(p);
    const p = res.body as ClientImportPreview;
    expect(p.sheets.map((s) => [s.name, s.kind])).toEqual([
      ['GST Login', 'gst'],
      ['TDS Login', 'tds'],
      ['ITR ', 'skipped'],
    ]);
    expect(p.months).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(p.vaultReady).toBe(true);
    expect(p.rows.map((r) => [r.name, r.action])).toEqual([
      [`${tag} Company Pvt Ltd`, 'create_client'],
      [`${tag} Firm`, 'create_client'],
      [`${tag} Typo`, 'error'],
      [`${tag} Kiran`, 'create_client'],
    ]);
    const co = p.rows[0]!;
    expect(co).toMatchObject({
      pan: company,
      tan: TAN,
      typeSlug: 'private_limited',
      email: 'a@b.in',
    });
    expect(co.source).toBe('GST Login 5, 6 · TDS Login 3');
    expect(co.gst.map((g) => [g.gstin, g.stateCode, g.frequency])).toEqual([
      [G_CO_DL, '07', 'monthly'],
      [null, '27', 'quarterly'],
    ]);
    expect(co.logins.map((l) => [l.portal, l.account, l.usernameHint])).toEqual([
      ['gst', 'main', 'co•••dl'],
      ['gst', 'main', 'co•••mh'],
      ['income_tax', 'main', `${company.slice(0, 2)}•••${company.slice(-2)}`],
      ['income_tax', 'tan', `${TAN.slice(0, 2)}•••${TAN.slice(-2)}`],
      ['traces', 'deductor', 'co•••or'],
      ['traces', 'taxpayer', 'co•••er'],
    ]);
    // The Maharashtra row's mark stays with it although it has no GSTIN yet —
    // and the person is told it cannot go into an engagement.
    expect(co).toMatchObject({ noGstin: true, gstEngagement: null });
    expect(co.warnings).toEqual([expect.stringMatching(/^No GSTIN: /)]);
    expect(co.gst[1]).toMatchObject({ gstin: null, filed: 1, notApplicable: 0 });
    expect(p.rows[1]!.gst[0]).toMatchObject({ gstin: G_FIRM, filed: 3, notApplicable: 1 });
    expect(p.rows[1]).toMatchObject({
      noGstin: false,
      gstEngagement: { action: 'create', engagementCode: null, financialYears: ['2026-27'] },
    });
    expect(p.rows[1]!.warnings).toContain(
      'A GST engagement for 2026-27 will be created, with the months the sheet marks filed / NA closed in it.',
    );
    expect(p).toMatchObject({ engagementsToCreate: 1, noGstin: 1 });
    expect(p.rows[2]!.error).toMatch(/not a valid GSTIN/);
    expect(p.rows[3]).toMatchObject({ typeSlug: 'individual', typeGuessed: false });
    expect(p.logins).toBe(8);
  });

  it('is for partners and managers only', async () => {
    await http()
      .post('/api/v1/client-imports/workbook/preview')
      .set(bearer(sy))
      .send(body())
      .expect(403);
  });

  it('creates the clients with their GSTINs, TAN, contact, sealed logins and GST schemes', async () => {
    const result = await runImport();
    expect(result).toMatchObject({
      clientsCreated: 3,
      registrationsAdded: 3, // Company: Delhi GSTIN + TAN; Firm: its GSTIN
      loginsSaved: 8,
      schemesSet: 2,
      engagementsCreated: 1, // the Firm's: the Company's marked row has no GSTIN
      engagementsExtended: 0,
      marksApplied: 4,
      marksWithoutFiling: 0,
      marksRecorded: 5, // all kept: Firm's 4, Company's Maharashtra row (no GSTIN) 1
    });
    expect(result.failed).toEqual([
      expect.objectContaining({ source: 'GST Login 8', message: expect.stringMatching(/GSTIN/) }),
    ]);
    expect(result.notes).toContainEqual(
      expect.objectContaining({
        message: expect.stringMatching(/^GST engagement \S+ created for 2026-27\.$/),
      }),
    );
    companyId = await entityOf(company);
    firmId = await entityOf(firm);

    const detail = (await http().get(`/api/v1/entities/${companyId}`).set(bearer(pa)).expect(200))
      .body as {
      registrations: { registrationType: string; registrationNumber: string }[];
      contacts: { email: string | null }[];
    };
    expect(detail.registrations.map((r) => r.registrationNumber).sort()).toEqual(
      [G_CO_DL, TAN].sort(),
    );
    expect(detail.contacts[0]).toMatchObject({ email: 'a@b.in' });

    const list = await credentialsOf(pa, companyId);
    expect(list.items).toHaveLength(6);
    const waiting = list.items.find((i) => i.portal === 'gst' && !i.registrationId)!;
    expect(waiting).toMatchObject({ stateCode: '27', pendingFrequency: 'quarterly' });
    expect(list.items.find((i) => i.account === 'deductor')!.registrationNumber).toBe(TAN);
    loginId = list.items.find((i) => i.registrationNumber === G_CO_DL)!.id;

    expect(await schemeOf(G_CO_DL)).toEqual([{ gst_scheme: 'regular', qrmp_category: null }]);
    expect(await schemeOf(G_FIRM)).toEqual([{ gst_scheme: 'regular', qrmp_category: null }]);
  });

  it("keeps the sheet's marks as each client's return history, GSTIN or not", async () => {
    const firmReturns = await returnsOf(pa, firmId);
    expect(firmReturns.periods).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(firmReturns.forms).toEqual(['GSTR1', 'GSTR3B']);
    expect(firmReturns.lines).toEqual([
      expect.objectContaining({
        entityId: firmId,
        entityName: `${tag} Firm`,
        gstin: G_FIRM,
        stateCode: '07',
        marks: {
          '2026-04': { GSTR1: 'filed', GSTR3B: 'filed' },
          '2026-05': { GSTR3B: 'not_applicable' },
          '2026-06': { GSTR1: 'filed' },
        },
      }),
    ]);
    // The Maharashtra row has no GSTIN yet: kept by its state.
    expect((await returnsOf(pa, companyId)).lines).toEqual([
      expect.objectContaining({
        gstin: null,
        registrationId: null,
        stateCode: '27',
        marks: { '2026-04': { GSTR1: 'filed' } },
      }),
    ]);
    // The whole firm's list has both; another office sees neither.
    const all = (await http().get('/api/v1/client-returns').set(bearer(mp)).expect(200))
      .body as ClientReturns;
    expect(all.lines.filter((l) => [firmId, companyId].includes(l.entityId))).toHaveLength(2);
    expect((await returnsOf(pb, firmId)).lines).toEqual([]);
    const south = (await http().get('/api/v1/client-returns').set(bearer(pb)).expect(200))
      .body as ClientReturns;
    expect(south.lines.some((l) => [firmId, companyId].includes(l.entityId))).toBe(false);
  });

  it("creates the Firm's GST engagement for the marked year, the importer its partner, and closes the months in it", async () => {
    const { rows: engagements } = await su.query<{
      kind: string;
      status: string;
      ep: string;
      years: string;
    }>(
      `SELECT e.kind, e.status, u.email AS ep,
              string_agg(y.financial_year || ' ' || array_to_string(y.streams, ','), '; '
                         ORDER BY y.financial_year) AS years
         FROM hsdg.engagements e
         JOIN hsdg.employees em ON em.id = e.engagement_partner_id
         JOIN hsdg.users u ON u.id = em.user_id
         JOIN hsdg.compliance_engagement_years y ON y.engagement_id = e.id
        WHERE e.entity_id = $1
        GROUP BY e.id, u.email`,
      [firmId],
    );
    expect(engagements).toEqual([
      {
        kind: 'compliance',
        status: 'accepted',
        ep: 'partner.a@dhvaj.in',
        years: '2026-27 gst',
      },
    ]);
    const { rows } = await su.query<{ code: string; period_key: string; workflow_status: string }>(
      `SELECT r.code, ci.period_key, ci.workflow_status
         FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
         JOIN hsdg.entity_registrations g ON g.id = ci.registration_id
        WHERE g.registration_number = $1 AND ci.period_key IN ('2026-04', '2026-05', '2026-06')
          AND r.code IN ('GST_GSTR1_M', 'GST_GSTR3B_M')
        ORDER BY ci.period_key, r.code`,
      [G_FIRM],
    );
    expect(rows.map((r) => `${r.period_key} ${r.code} ${r.workflow_status}`)).toEqual([
      '2026-04 GST_GSTR1_M filed',
      '2026-04 GST_GSTR3B_M filed',
      '2026-05 GST_GSTR1_M not_started',
      '2026-05 GST_GSTR3B_M not_applicable',
      '2026-06 GST_GSTR1_M filed',
      '2026-06 GST_GSTR3B_M not_started',
    ]);
  });

  it('stores only ciphertext, which the app role cannot even select', async () => {
    const { rows } = await su.query<{ ciphertext: Buffer }>(
      `SELECT ciphertext FROM hsdg.client_credentials WHERE entity_id = ANY($1)`,
      [[companyId, firmId]],
    );
    expect(rows).toHaveLength(7);
    for (const r of rows)
      for (const p of PASSWORDS) expect(r.ciphertext.toString()).not.toContain(p);

    const appDb = new Client({ connectionString: process.env.DATABASE_URL });
    await appDb.connect();
    try {
      await expect(appDb.query(`SELECT ciphertext FROM hsdg.client_credentials`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        appDb.query(`INSERT INTO hsdg.credential_access_log (credential_id, entity_id, user_id, role)
                   VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x')`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        appDb.query(
          `SELECT hsdg.seed_gst_scheme(gen_random_uuid(), gen_random_uuid(), '07', 'qrmp')`,
        ),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await appDb.end();
    }

    const { rows: audit } = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.audit_events
        WHERE coalesce(after_state::text, '') || coalesce(before_state::text, '') ~ $1`,
      [PASSWORDS.map((p) => p.replace(/[!-]/g, '.')).join('|')],
    );
    expect(audit[0]!.n).toBe(0);
  });

  it("shows a login to the client's partner and the managing partner, never cached", async () => {
    const res = await http()
      .post(`/api/v1/credentials/${loginId}/reveal`)
      .set(bearer(pa))
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      id: loginId,
      portal: 'gst',
      account: 'main',
      username: 'company_dl',
      password: PASSWORDS[0],
    });
    const deductor = (await credentialsOf(pa, companyId)).items.find(
      (i) => i.account === 'deductor',
    )!;
    const traces = await http()
      .post(`/api/v1/credentials/${deductor.id}/reveal`)
      .set(bearer(mp))
      .expect(200);
    expect(traces.body).toMatchObject({ portal: 'traces', username: 'co_deductor' });
  });

  it('refuses a manager who is not on its engagements, and hides it from other offices', async () => {
    await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(mx)).expect(403);
    await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(pb)).expect(404);
    expect((await credentialsOf(pb, companyId)).items).toEqual([]);
  });

  it('logs every reveal for the partners to see', async () => {
    const list = await credentialsOf(pa, companyId);
    expect(list.recentAccess.filter((a) => a.credentialId === loginId)).toEqual([
      expect.objectContaining({ userName: 'Partner A', role: 'partner' }),
    ]);
    expect(list.recentAccess).toHaveLength(2);
    // A manager can manage logins but does not read the log.
    expect((await credentialsOf(mx, companyId)).recentAccess).toEqual([]);
  });

  it('moves the waiting login onto the GSTIN when it is added, with its quarterly scheme', async () => {
    await http()
      .post(`/api/v1/entities/${companyId}/registrations`)
      .set(bearer(pa))
      .send({ registrationType: 'gstin', registrationNumber: G_CO_MH, stateCode: '27' })
      .expect(201);
    const gst = (await credentialsOf(pa, companyId)).items.filter((i) => i.portal === 'gst');
    expect(gst.map((i) => [i.registrationNumber, i.stateCode, i.pendingFrequency]).sort()).toEqual(
      [
        [G_CO_DL, '07', null],
        [G_CO_MH, '27', null],
      ].sort(),
    );
    expect(await schemeOf(G_CO_MH)).toEqual([{ gst_scheme: 'qrmp', qrmp_category: 'X' }]);
    // The marks kept by state now show under the GSTIN.
    expect((await returnsOf(pa, companyId)).lines).toEqual([
      expect.objectContaining({ gstin: G_CO_MH, marks: { '2026-04': { GSTR1: 'filed' } } }),
    ]);
    // Still opens: the seal is bound to the client, not the GSTIN.
    const moved = gst.find((i) => i.registrationNumber === G_CO_MH)!;
    const res = await http()
      .post(`/api/v1/credentials/${moved.id}/reveal`)
      .set(bearer(pa))
      .expect(200);
    expect(res.body.password).toBe(PASSWORDS[1]);
  });

  it('puts the months of a GSTIN added later into an engagement on the next upload, and only once', async () => {
    const preview = (
      await http()
        .post('/api/v1/client-imports/workbook/preview')
        .set(bearer(pa))
        .send(body())
        .expect(200)
    ).body as ClientImportPreview;
    const co = preview.rows.find((r) => r.name === `${tag} Company Pvt Ltd`)!;
    // The sheet's Maharashtra row has no GSTIN: it takes the one added in the portal.
    expect(co).toMatchObject({ action: 'update_client', noGstin: false });
    expect(co.gst[1]).toMatchObject({ gstin: G_CO_MH, stateCode: '27' });
    expect(co.gstEngagement).toMatchObject({ action: 'create', financialYears: ['2026-27'] });
    expect(preview.rows.find((r) => r.name === `${tag} Firm`)!.gstEngagement).toMatchObject({
      action: 'existing',
    });
    expect(preview).toMatchObject({ engagementsToCreate: 1, noGstin: 0 });

    const again = await runImport();
    expect(again).toMatchObject({
      clientsCreated: 0,
      clientsUpdated: 3,
      registrationsAdded: 0,
      loginsSaved: 8,
      schemesSet: 0,
      engagementsCreated: 1,
      marksNotAllowed: 0,
      marksAlreadyDone: 4, // the Firm's
      marksRecorded: 1, // the Company's Maharashtra mark, moved from its state onto the GSTIN
    });
    // April on a quarterly GSTIN has no GSTR-1 to close (IFF): kept on the client only.
    expect(again).toMatchObject({ marksApplied: 0, marksWithoutFiling: 0 });
    expect((await returnsOf(pa, companyId)).lines).toEqual([
      expect.objectContaining({ gstin: G_CO_MH, marks: { '2026-04': { GSTR1: 'filed' } } }),
    ]);
    // The Company's new engagement has the Maharashtra GSTIN's quarterly returns.
    const { rows } = await su.query<{ period_key: string }>(
      `SELECT ci.period_key FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
         JOIN hsdg.entity_registrations g ON g.id = ci.registration_id
         JOIN hsdg.engagements e ON e.id = ci.engagement_id
        WHERE g.registration_number = $1 AND r.code = 'GST_GSTR1_Q' AND e.entity_id = $2
        ORDER BY ci.period_key`,
      [G_CO_MH, companyId],
    );
    expect(rows.map((r) => r.period_key)).toEqual([
      '2026-27:Q1',
      '2026-27:Q2',
      '2026-27:Q3',
      '2026-27:Q4',
    ]);

    const third = await runImport();
    expect(third).toMatchObject({
      engagementsCreated: 0,
      engagementsExtended: 0,
      marksApplied: 0,
      marksRecorded: 0,
    });
    expect(third.marksAlreadyDone).toBe(4);
  });

  it('lets a manager of the office change or remove a login; not another office', async () => {
    const registrationId = (await credentialsOf(pa, firmId)).items[0]!.registrationId;
    const saved = await http()
      .put('/api/v1/credentials')
      .set(bearer(mx))
      .send({
        entityId: firmId,
        registrationId,
        portal: 'gst',
        username: 'firm_new',
        password: 'New-Pw-1',
      })
      .expect(200);
    expect(saved.body).toMatchObject({ usernameHint: 'fi•••ew', updatedBy: 'Manager X' });
    expect(JSON.stringify(saved.body)).not.toContain('New-Pw-1');
    await http()
      .put('/api/v1/credentials')
      .set(bearer(pb))
      .send({ entityId: firmId, registrationId, portal: 'gst', username: 'x', password: 'y' })
      .expect(404);
    await http().delete(`/api/v1/credentials/${saved.body.id}`).set(bearer(sy)).expect(403);
    await http().delete(`/api/v1/credentials/${saved.body.id}`).set(bearer(mx)).expect(204);
    expect((await credentialsOf(pa, firmId)).items).toEqual([]);
  });

  it('stops after 60 reveals an hour', async () => {
    const { rows } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.users WHERE email = 'partner.a@dhvaj.in'`,
    );
    const filled = await su.query<{ id: string }>(
      `INSERT INTO hsdg.credential_access_log (credential_id, entity_id, user_id, role)
       SELECT c.id, c.entity_id, $2, 'partner' FROM hsdg.client_credentials c, generate_series(1, 60)
        WHERE c.id = $1
       RETURNING id`,
      [loginId, rows[0]!.id],
    );
    try {
      await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(pa)).expect(429);
      await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(mp)).expect(200);
    } finally {
      // The suites share one database: left in, these 60 hold Partner A at the
      // limit for an hour, and a later suite's reveal (client-master) gets 429.
      await su.query(`DELETE FROM hsdg.credential_access_log WHERE id = ANY ($1)`, [
        filled.rows.map((r) => r.id),
      ]);
    }
  });

  it("adds the marked year, or GST, to the client's open Compliance engagement", async () => {
    const p = pan('C');
    const g = gstin('07', p);
    const name = `Extend${Date.now()} Traders Pvt Ltd`;
    const book = (marks: Record<string, string>): string => {
      const months = Object.keys(marks);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['', '', '', '', ...months],
          ['Particular', 'ID', 'Pwd', 'GSTIN', ...months.map(() => 'GSTR-1')],
          [name, 'ext_id', 'ext-pw', g, ...months.map((m) => marks[m])],
        ]),
        'GST Login',
      );
      return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
    };
    const send = async (path: string, marks: Record<string, string>) =>
      (
        await http()
          .post(`/api/v1/client-imports/workbook${path}`)
          .set(bearer(pa))
          .send({ filename: 'extend.xlsx', contentBase64: book(marks), officeCode: 'NORTH' })
          .expect(200)
      ).body;

    // No marks: the client only, no engagement.
    expect(await send('', { 'Apr-26': '' })).toMatchObject({
      clientsCreated: 1,
      engagementsCreated: 0,
    });
    const entityId = await entityOf(p);
    const created = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        kind: 'compliance',
        entityId,
        status: 'accepted',
        financialYear: '2026-27',
        streams: ['tds'],
        years: [{ financialYear: '2026-27' }],
      })
      .expect(201);
    const code = created.body.engagementCode as string;

    // A year it already has, without GST: GST is added to it.
    const marks = { 'Apr-26': 'filed' };
    const preview = (await send('/preview', marks)) as ClientImportPreview;
    expect(preview.rows[0]!.gstEngagement).toEqual({
      action: 'add_stream',
      engagementCode: code,
      financialYears: ['2026-27'],
    });
    const result = (await send('', marks)) as ClientImportResult;
    expect(result).toMatchObject({
      engagementsCreated: 0,
      engagementsExtended: 1,
      marksApplied: 1,
    });
    expect(result.notes).toContainEqual(
      expect.objectContaining({ message: `GST added to ${code} for 2026-27.` }),
    );

    // A year it does not have: added with GST.
    const later = { 'Apr-27': 'filed' };
    expect(((await send('/preview', later)) as ClientImportPreview).rows[0]!.gstEngagement).toEqual(
      { action: 'add_year', engagementCode: code, financialYears: ['2027-28'] },
    );
    const added = (await send('', later)) as ClientImportResult;
    expect(added).toMatchObject({ engagementsCreated: 0, engagementsExtended: 1 });
    expect(added.notes).toContainEqual(
      expect.objectContaining({ message: `2027-28 with GST added to ${code}.` }),
    );
    const { rows } = await su.query<{ financial_year: string; streams: string[] }>(
      `SELECT financial_year, streams FROM hsdg.compliance_engagement_years
        WHERE engagement_id = $1 ORDER BY financial_year`,
      [created.body.id],
    );
    expect(rows.map((r) => [r.financial_year, [...r.streams].sort()])).toEqual([
      ['2026-27', ['gst', 'tds']],
      ['2027-28', ['gst']],
    ]);
  });

  it("finds a client by a similar name, takes the sheet's fuller name, and points out duplicates", async () => {
    const t = `Alike${Date.now()}`;
    const book = (names: string[]): string => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['Particular', 'ID', 'Pwd', 'GSTIN', 'Apr-26'],
          ['', '', '', '', 'GSTR-1'],
          ...names.map((n, i) => [`${t} ${n}`, `${t}_${i}`, `pw-${i}`, '', 'filed']),
        ]),
        'GST Login',
      );
      return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
    };
    const send = (path: string, names: string[]) =>
      http()
        .post(`/api/v1/client-imports/workbook${path}`)
        .set(bearer(pa))
        .send({
          filename: 'alike.xlsx',
          contentBase64: book(names),
          officeCode: 'NORTH',
          defaultTypeSlug: 'proprietorship',
        })
        .expect(200);
    const named = async () =>
      (
        await su.query<{ legal_name: string }>(
          `SELECT legal_name FROM hsdg.entities WHERE legal_name LIKE $1 ORDER BY legal_name`,
          [`${t} %`],
        )
      ).rows.map((r) => r.legal_name.slice(t.length + 1));

    await send('', [
      'aveer green',
      'Jaynat Gupta',
      'GRIID Chandigarh',
      'Kumar Agencies',
      'Kumar Agro',
    ]);
    await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({ legalName: `${t} Griid`, typeSlug: 'proprietorship', officeCode: 'NORTH' })
      .expect(201);

    const next = ['Aveer Green Private Limited', 'Jayant Gupta', 'GRIID- Chandigarh', 'Kumar'];
    const preview = (await send('/preview', next)).body as ClientImportPreview;
    const row = (n: string) => preview.rows.find((r) => r.name === `${t} ${n}`)!;
    expect(row('Aveer Green Private Limited')).toMatchObject({
      action: 'update_client',
      entityName: `${t} aveer green`,
    });
    expect(row('Aveer Green Private Limited').warnings).toEqual(
      expect.arrayContaining([
        `Taken to be "${t} aveer green" in the portal, by its name.`,
        `"${t} aveer green" will be renamed "${t} Aveer Green Private Limited".`,
      ]),
    );
    expect(row('Jayant Gupta').warnings).toContain(
      `"${t} Jaynat Gupta" will be renamed "${t} Jayant Gupta".`,
    );
    // "- Chandigarh" is the place (its GST state), not part of the name: the
    // row is Griid, and the earlier "GRIID Chandigarh" looks like a duplicate.
    expect(row('GRIID')).toMatchObject({ action: 'update_client', entityName: `${t} Griid` });
    expect(row('GRIID').gst.map((g) => g.stateCode)).toEqual(['04']);
    expect(row('GRIID').warnings.join(' ')).toMatch(
      new RegExp(
        `"${t} GRIID Chandigarh" \\(.+\\) in the portal looks like the same client; if it is, merge the two`,
      ),
    );
    expect(row('Kumar')).toMatchObject({ action: 'error' });
    expect(row('Kumar').error).toMatch(/could be .*Kumar Agencies.* or .*Kumar Agro/);

    const result = (await send('', next)).body as ClientImportResult;
    expect(result).toMatchObject({ clientsCreated: 0, clientsUpdated: 3 });
    expect(result.notes).toContainEqual(
      expect.objectContaining({
        message: `"${t} aveer green" renamed "${t} Aveer Green Private Limited", as the sheet has it.`,
      }),
    );
    expect(await named()).toEqual(
      [
        'Aveer Green Private Limited',
        'GRIID Chandigarh',
        'Griid',
        'Jayant Gupta',
        'Kumar Agencies',
        'Kumar Agro',
      ].sort(),
    );
    const audit = await su.query(
      `SELECT 1 FROM hsdg.audit_events WHERE action = 'entity.updated' AND after_state->>'legalName' = $1`,
      [`${t} Jayant Gupta`],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('points out a client of the same first word and GST login as a likely duplicate, never taking it', async () => {
    const t = `Twin${Date.now()}`;
    const book = (rows: [string, string][]): string => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['Particular', 'ID', 'Pwd', 'GSTIN', 'Apr-26'],
          ['', '', '', '', 'GSTR-1'],
          ...rows.map(([n, id], i) => [`${n} ${t}`, id, `pw-${i}`, '', 'filed']),
        ]),
        'GST Login',
      );
      return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
    };
    const send = (path: string, rows: [string, string][]) =>
      http()
        .post(`/api/v1/client-imports/workbook${path}`)
        .set(bearer(pa))
        .send({
          filename: 'twin.xlsx',
          contentBase64: book(rows),
          officeCode: 'NORTH',
          defaultTypeSlug: 'proprietorship',
        })
        .expect(200);

    await send('', [['3Acess', `${t}_ace`]]);
    const preview = (
      await send('/preview', [
        ['3Aces Technologies - Firm', `${t}_ace`],
        ['3Aces Technologies Private Limited', `${t}_xyz`],
      ])
    ).body as ClientImportPreview;
    const row = (n: string) => preview.rows.find((r) => r.name === `${n} ${t}`)!;
    expect(row('3Aces Technologies - Firm')).toMatchObject({ action: 'create_client' });
    expect(row('3Aces Technologies - Firm').warnings.join(' ')).toMatch(
      new RegExp(`"3Acess ${t}" \\(.+\\) in the portal looks like the same client`),
    );
    expect(row('3Aces Technologies Private Limited')).toMatchObject({ action: 'create_client' });
    expect(row('3Aces Technologies Private Limited').warnings.join(' ')).not.toMatch(
      /looks like the same client/,
    );
  });
});
