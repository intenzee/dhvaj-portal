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
 * not) and close the matching filings.
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
    // The Maharashtra row's mark stays with it although it has no GSTIN yet.
    expect(co.warnings).toEqual([]);
    expect(co.gst[1]).toMatchObject({ gstin: null, filed: 1, notApplicable: 0 });
    expect(p.rows[1]!.gst[0]).toMatchObject({ gstin: G_FIRM, filed: 3, notApplicable: 1 });
    expect(p.rows[2]!.error).toMatch(/not a valid GSTIN/);
    expect(p.rows[3]).toMatchObject({ typeSlug: 'proprietorship', typeGuessed: false });
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
      marksApplied: 0,
      marksWithoutFiling: 4, // no GST engagement yet
      marksRecorded: 5, // …but all kept: Firm's 4, Company's Maharashtra row (no GSTIN) 1
    });
    expect(result.failed).toEqual([
      expect.objectContaining({ source: 'GST Login 8', message: expect.stringMatching(/GSTIN/) }),
    ]);
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

  it('closes the filings the sheet marks filed / NA once there is a GST engagement, and only once', async () => {
    await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        kind: 'compliance',
        entityId: firmId,
        status: 'accepted',
        financialYear: '2026-27',
        streams: ['gst'],
        years: [{ financialYear: '2026-27' }],
      })
      .expect(201);
    const again = await runImport();
    expect(again).toMatchObject({
      clientsCreated: 0,
      clientsUpdated: 3,
      registrationsAdded: 0,
      loginsSaved: 8,
      schemesSet: 0,
      marksApplied: 4,
      marksNotAllowed: 0,
      marksRecorded: 0, // the same marks: nothing new
    });
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

    const third = await runImport();
    expect(third).toMatchObject({ marksApplied: 0, marksAlreadyDone: 4 });
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
    await su.query(
      `INSERT INTO hsdg.credential_access_log (credential_id, entity_id, user_id, role)
       SELECT c.id, c.entity_id, $2, 'partner' FROM hsdg.client_credentials c, generate_series(1, 60)
        WHERE c.id = $1`,
      [loginId, rows[0]!.id],
    );
    await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(pa)).expect(429);
    await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(mp)).expect(200);
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
    expect(row('GRIID- Chandigarh').entityName).toBe(`${t} GRIID Chandigarh`);
    expect(row('GRIID- Chandigarh').warnings.join(' ')).toMatch(
      new RegExp(`"${t} Griid" \\(.+\\) in the portal looks like the same client`),
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
