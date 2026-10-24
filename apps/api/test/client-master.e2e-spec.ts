import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import {
  CLIENT_MASTER_PASSWORDS_MASKED_HEADER,
  CLIENT_MASTER_PASSWORDS_SHOWN_HEADER,
  gstinCheckChar,
  type ClientMasterPreview,
  type ClientMasterResult,
  type ClientMasterRow,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * The Client Master workbook: Export gives every client the caller can see
 * in the firm's template, gaps empty; the person fills them (and adds rows
 * for new clients) and imports it back. An untouched export imports as
 * nothing; a filled one fills the client in — registrations, contact,
 * address, GST frequency, logins — and opens its Compliance engagement with
 * the services marked Yes. Importing again adds nothing twice. A client's
 * main logins sit on its row; Export with passwords writes them in full for
 * the clients the caller may reveal, logging each one.
 */
describe('Client Master workbook (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: string;
  let sy: string;
  let pb: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;

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
  const typo = (g: string) => g.slice(0, 14) + (g[14] === '0' ? '1' : '0');

  const tag = `Master${Date.now()}`;
  const OLD_PAN = pan('C');
  const OLD_GSTIN = gstin('07', OLD_PAN);
  const OLD_TAN = `${letters(4)}${digits(5)}${letters(1)}`;
  const NEW_PAN = pan('F');
  const NEW_GSTIN = gstin('27', NEW_PAN);
  const LEGACY_PAN = pan('C');
  const LEGACY_GSTIN = typo(gstin('07', LEGACY_PAN));
  const CLASH_PAN = pan('C');
  const CLASH_GSTIN = gstin('07', pan('F'));
  const PASSWORD = 'Pw-Master-New-Firm-27!';
  const OLD_GST_PASSWORD = 'Old Gst  Pw#07';
  const OLD_IT_PASSWORD = '98765432';

  let oldId: string;
  let oldCode: string;
  let legacyCode: string;

  const exportFile = (t: string, query = '') =>
    http()
      .get(`/api/v1/client-imports/master/export${query}`)
      .set(bearer(t))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  const download = async (t: string): Promise<Buffer> =>
    (await exportFile(t).expect(200)).body as Buffer;
  const rowOf = (ws: XLSX.WorkSheet, code: string): number => {
    for (let r = 6; r < 5000; r++) if (ws[`A${r}`]?.v === code) return r;
    throw new Error(`${code} is not in the export`);
  };
  const firstEmpty = (ws: XLSX.WorkSheet, from: number, col: string): number => {
    let r = from;
    while (ws[`${col}${r}`]?.v !== undefined && ws[`${col}${r}`]?.v !== '') r++;
    return r;
  };
  const put = (ws: XLSX.WorkSheet, ref: string, v: string) => {
    ws[ref] = { t: 's', v };
  };
  const body = (file: Buffer) => ({
    filename: 'master.xlsx',
    contentBase64: file.toString('base64'),
    officeCode: 'NORTH',
  });
  const preview = async (file: Buffer): Promise<ClientMasterPreview> =>
    (
      await http()
        .post('/api/v1/client-imports/master/preview')
        .set(bearer(pa))
        .send(body(file))
        .expect(200)
    ).body as ClientMasterPreview;
  const runImport = async (file: Buffer): Promise<ClientMasterResult> =>
    (
      await http()
        .post('/api/v1/client-imports/master')
        .set(bearer(pa))
        .send(body(file))
        .expect(200)
    ).body as ClientMasterResult;
  const named = (p: ClientMasterPreview, name: string): ClientMasterRow =>
    p.rows.find((r) => r.name === name)!;
  /** The code the import gave the new client, read off its export row. */
  const newCode = (ws: XLSX.WorkSheet): string => {
    for (let r = 6; r < 5000; r++)
      if (ws[`B${r}`]?.v === `${tag} New Traders`) return ws[`A${r}`].v as string;
    throw new Error('The new client is not in the export');
  };

  /** The export, filled in: the old client's gaps, a new client, a typo row and a login. */
  let filled: Buffer;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    pa = await token('partner.a@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    const old = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `${tag} Old Pvt Ltd`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
        pan: OLD_PAN,
      })
      .expect(201);
    oldId = old.body.id as string;
    oldCode = old.body.entityCode as string;
    const legacy = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `${tag} Legacy Pvt Ltd`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
      })
      .expect(201);
    legacyCode = legacy.body.entityCode as string;
    // A GSTIN with a wrong check digit, as older data has.
    await su.query(
      `INSERT INTO hsdg.entity_registrations
         (entity_id, registration_type, registration_number, state_code, is_principal)
       VALUES ($1, 'gstin', $2, '07', true)`,
      [legacy.body.id, LEGACY_GSTIN],
    );
    // A GSTIN of another PAN, as older data has.
    const clash = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `${tag} Clash Pvt Ltd`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
        pan: CLASH_PAN,
      })
      .expect(201);
    await su.query(
      `INSERT INTO hsdg.entity_registrations
         (entity_id, registration_type, registration_number, state_code, is_principal)
       VALUES ($1, 'gstin', $2, '07', true)`,
      [clash.body.id, CLASH_GSTIN],
    );
  });

  afterAll(async () => {
    await su.end();
    await app.close();
  });

  it('is for partners and managers only', async () => {
    await http().get('/api/v1/client-imports/master/export').set(bearer(sy)).expect(403);
    await http()
      .post('/api/v1/client-imports/master/preview')
      .set(bearer(sy))
      .send({ filename: 'x.xlsx', contentBase64: 'AAAA', officeCode: 'NORTH' })
      .expect(403);
  });

  it('exports every client in the template with what the portal has, gaps left empty', async () => {
    const file = await download(pa);
    const book = XLSX.read(file, { type: 'buffer' });
    expect(book.SheetNames).toEqual(['Read Me', 'Clients', 'Logins', 'Lists']);
    const ws = book.Sheets.Clients!;
    const r = rowOf(ws, oldCode);
    expect(ws[`B${r}`].v).toBe(`${tag} Old Pvt Ltd`);
    expect(ws[`D${r}`].v).toBe('Private Limited Company');
    expect(ws[`E${r}`].v).toBe(OLD_PAN);
    expect(ws[`L${r}`].v).toBe('NORTH');
    for (const col of ['F', 'H', 'M', 'O', 'Q', 'V', 'W'])
      expect(ws[`${col}${r}`]?.v ?? '').toBe('');
    expect(ws[`F${rowOf(ws, legacyCode)}`].v).toBe(LEGACY_GSTIN);
  });

  it('imports an untouched export as nothing, a bad GSTIN already on the client only warned', async () => {
    // Re-zipped: the styled export is over the e2e's 256 KB body ceiling (10 MiB in production).
    const untouched = XLSX.write(XLSX.read(await download(pa), { type: 'buffer' }), {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;
    const p = await preview(untouched);
    expect(p.counts.create_client).toBe(0);
    expect(p.rows.filter((r) => r.action === 'update_client')).toEqual([]);
    expect(named(p, `${tag} Old Pvt Ltd`)).toMatchObject({
      action: 'unchanged',
      entityId: oldId,
      matchedBy: 'code',
    });
    const legacy = named(p, `${tag} Legacy Pvt Ltd`);
    expect(legacy).toMatchObject({ action: 'unchanged', error: null });
    expect(legacy.warnings).toEqual([
      expect.stringContaining(`${LEGACY_GSTIN} in the portal is not valid`),
    ]);
    // Its PAN and a GSTIN of another PAN, both already on it: left as they are.
    const clash = named(p, `${tag} Clash Pvt Ltd`);
    expect(clash).toMatchObject({ action: 'unchanged', error: null });
    expect(clash.warnings).toEqual([
      expect.stringContaining(`PAN ${CLASH_PAN} does not match the GSTIN ${CLASH_GSTIN}`),
    ]);
    expect(clash.warnings[0]).toContain('Both are on the client in the portal');
  });

  it('previews a filled export row by row, never returning a password', async () => {
    const book = XLSX.read(await download(pa), { type: 'buffer' });
    const ws = book.Sheets.Clients!;
    const r = rowOf(ws, oldCode);
    put(ws, `F${r}`, OLD_GSTIN);
    put(ws, `H${r}`, OLD_TAN);
    put(ws, `M${r}`, 'Ravi Kumar');
    put(ws, `O${r}`, 'Ravi@Old.example');
    put(ws, `Q${r}`, '4 Park Street');
    put(ws, `S${r}`, 'New Delhi');
    put(ws, `U${r}`, '110001');
    put(ws, `V${r}`, '2026-27');
    put(ws, `W${r}`, 'Yes');
    put(ws, `X${r}`, 'Monthly');
    put(ws, `Y${r}`, 'Yes');
    put(ws, `AA${r}`, 'Yes');
    put(ws, `AD${r}`, 'partner.a@dhvaj.in');
    // The client's main logins, on its own row.
    put(ws, `AF${r}`, 'oldpvt_gst');
    put(ws, `AG${r}`, OLD_GST_PASSWORD);
    put(ws, `AH${r}`, OLD_PAN);
    put(ws, `AI${r}`, OLD_IT_PASSWORD);
    const n = firstEmpty(ws, 6, 'B');
    put(ws, `B${n}`, `${tag} New Traders`);
    put(ws, `F${n}`, NEW_GSTIN);
    put(ws, `V${n}`, '2026-27');
    put(ws, `W${n}`, 'Yes');
    put(ws, `X${n}`, 'Quarterly');
    put(ws, `B${n + 1}`, `${tag} Typo Traders`);
    put(ws, `F${n + 1}`, typo(gstin('07', pan('F'))));
    const logins = book.Sheets.Logins!;
    const l = firstEmpty(logins, 5, 'E');
    put(logins, `B${l}`, `${tag} New Traders`);
    put(logins, `C${l}`, 'GST');
    put(logins, `E${l}`, 'newtraders27');
    put(logins, `F${l}`, PASSWORD);
    filled = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const res = await http()
      .post('/api/v1/client-imports/master/preview')
      .set(bearer(pa))
      .send(body(filled))
      .expect(200);
    for (const secret of [PASSWORD, OLD_GST_PASSWORD, OLD_IT_PASSWORD])
      expect(res.text).not.toContain(secret);
    const p = res.body as ClientMasterPreview;
    expect(p.loginProblems.filter((l) => l.row === r)).toEqual([]);

    const old = named(p, `${tag} Old Pvt Ltd`);
    expect(old).toMatchObject({
      action: 'update_client',
      matchedBy: 'code',
      error: null,
      logins: 2,
    });
    expect(old.changes.map((c) => [c.field, c.to])).toEqual([
      ['GSTIN', OLD_GSTIN],
      ['TAN', OLD_TAN],
      ['Contact', 'Ravi Kumar · ravi@old.example'],
      ['Address', '4 Park Street, New Delhi, Delhi, 110001'],
      ['GST return frequency', 'Monthly'],
    ]);
    expect(old.engagement).toEqual({
      action: 'create',
      engagementCode: null,
      financialYear: '2026-27',
      streams: ['gst', 'tds', 'roc'],
    });

    const created = named(p, `${tag} New Traders`);
    expect(created).toMatchObject({
      action: 'create_client',
      logins: 1,
      engagement: { action: 'create', streams: ['gst'] },
    });
    expect(created.warnings).toContain('Entity type taken from the PAN: Partnership Firm.');
    expect(named(p, `${tag} Typo Traders`).action).toBe('error');
  });

  it('fills the client in, creates the new one and opens their Compliance engagements', async () => {
    const result = await runImport(filled);
    expect(result).toMatchObject({
      clientsCreated: 1,
      clientsUpdated: 1,
      registrationsAdded: 3, // the old client's GSTIN + TAN, the new one's GSTIN
      contactsAdded: 1,
      addressesAdded: 1,
      loginsSaved: 3,
      schemesSet: 2,
      engagementsCreated: 2,
      engagementsExtended: 0,
    });
    // Only this suite's rows: other suites' clients (odd test GSTINs) are in the export too.
    expect(result.failed.filter((f) => f.name.startsWith(tag))).toEqual([
      expect.objectContaining({
        name: `${tag} Typo Traders`,
        message: expect.stringMatching(/GSTIN/),
      }),
    ]);

    const regs = await su.query<{ registration_number: string }>(
      `SELECT registration_number FROM hsdg.entity_registrations WHERE entity_id = $1 ORDER BY 1`,
      [oldId],
    );
    expect(regs.rows.map((x) => x.registration_number)).toEqual([OLD_GSTIN, OLD_TAN].sort());
    const contact = await su.query(
      `SELECT full_name, email::text AS email, is_primary FROM hsdg.entity_contacts WHERE entity_id = $1`,
      [oldId],
    );
    expect(contact.rows).toEqual([
      { full_name: 'Ravi Kumar', email: 'ravi@old.example', is_primary: true },
    ]);
    const address = await su.query(
      `SELECT line1, city, state, pincode FROM hsdg.entity_addresses WHERE entity_id = $1`,
      [oldId],
    );
    expect(address.rows).toEqual([
      { line1: '4 Park Street', city: 'New Delhi', state: 'Delhi', pincode: '110001' },
    ]);
    const schemes = await su.query<{ registration_number: string; gst_scheme: string }>(
      `SELECT r.registration_number, p.gst_scheme FROM hsdg.registration_compliance_profiles p
         JOIN hsdg.entity_registrations r ON r.id = p.registration_id
        WHERE r.registration_number = ANY($1) ORDER BY 1`,
      [[OLD_GSTIN, NEW_GSTIN]],
    );
    expect(schemes.rows).toEqual(
      [
        { registration_number: OLD_GSTIN, gst_scheme: 'regular' },
        { registration_number: NEW_GSTIN, gst_scheme: 'qrmp' },
      ].sort((a, b) => a.registration_number.localeCompare(b.registration_number)),
    );
    const engagements = await su.query<{ legal_name: string; streams: string[]; partner: string }>(
      `SELECT en.legal_name, y.streams, u.email::text AS partner
         FROM hsdg.engagements e
         JOIN hsdg.entities en ON en.id = e.entity_id
         JOIN hsdg.compliance_engagement_years y ON y.engagement_id = e.id
         JOIN hsdg.employees emp ON emp.id = e.engagement_partner_id
         JOIN hsdg.users u ON u.id = emp.user_id
        WHERE e.kind = 'compliance' AND en.legal_name LIKE $1 AND y.financial_year = '2026-27'
        ORDER BY 1`,
      [`${tag}%`],
    );
    expect(engagements.rows).toEqual([
      { legal_name: `${tag} New Traders`, streams: ['gst'], partner: 'partner.a@dhvaj.in' },
      {
        legal_name: `${tag} Old Pvt Ltd`,
        streams: expect.arrayContaining(['gst', 'tds', 'roc']),
        partner: 'partner.a@dhvaj.in',
      },
    ]);
    const login = await su.query(
      `SELECT c.portal, c.account, r.registration_number FROM hsdg.client_credentials c
         JOIN hsdg.entities e ON e.id = c.entity_id
         LEFT JOIN hsdg.entity_registrations r ON r.id = c.registration_id
        WHERE e.legal_name = $1`,
      [`${tag} New Traders`],
    );
    expect(login.rows).toEqual([
      { portal: 'gst', account: 'main', registration_number: NEW_GSTIN },
    ]);
    const oldLogins = await su.query(
      `SELECT c.portal, c.account, r.registration_number FROM hsdg.client_credentials c
         LEFT JOIN hsdg.entity_registrations r ON r.id = c.registration_id
        WHERE c.entity_id = $1 ORDER BY 1`,
      [oldId],
    );
    expect(oldLogins.rows).toEqual([
      { portal: 'gst', account: 'main', registration_number: OLD_GSTIN },
      { portal: 'income_tax', account: 'main', registration_number: null },
    ]);
  });

  it('adds nothing twice when the same file is imported again', async () => {
    const result = await runImport(filled);
    expect(result).toMatchObject({
      clientsCreated: 0,
      registrationsAdded: 0,
      contactsAdded: 0,
      addressesAdded: 0,
      schemesSet: 0,
      engagementsCreated: 0,
      engagementsExtended: 0,
    });
    // The typed logins are saved over themselves; nothing else changes.
    expect(result.clientsUpdated).toBe(2);
    expect(result.loginsSaved).toBe(3);
  });

  it('shows the filled details and the saved logins, masked, on their rows in the next export', async () => {
    const res = await exportFile(pa).expect(200);
    expect(res.headers[CLIENT_MASTER_PASSWORDS_SHOWN_HEADER]).toBe('0');
    const book = XLSX.read(res.body as Buffer, { type: 'buffer' });
    const ws = book.Sheets.Clients!;
    const r = rowOf(ws, oldCode);
    expect([ws[`F${r}`].v, ws[`H${r}`].v, ws[`M${r}`].v, ws[`V${r}`].v, ws[`W${r}`].v]).toEqual([
      OLD_GSTIN,
      OLD_TAN,
      'Ravi Kumar',
      '2026-27',
      'Yes',
    ]);
    expect(ws[`X${r}`].v).toBe('Monthly');
    expect(ws[`AF${r}`].v).toContain('•');
    expect(ws[`AG${r}`].v).toBe('(saved in portal)');
    expect(ws[`AH${r}`].v).toContain('•');
    expect(ws[`AI${r}`].v).toBe('(saved in portal)');
    const n = rowOf(ws, newCode(ws));
    expect(ws[`AF${n}`].v).not.toBe('newtraders27');
    expect(ws[`AG${n}`].v).toBe('(saved in portal)');
    // The main GSTIN's login is on the row, not on the Logins sheet.
    const logins = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Logins!, { header: 1 });
    expect(logins.some((x) => x[1]?.startsWith(tag))).toBe(false);
    const all = JSON.stringify([XLSX.utils.sheet_to_json(ws, { header: 1 }), logins]);
    for (const secret of [PASSWORD, OLD_GST_PASSWORD, OLD_IT_PASSWORD])
      expect(all).not.toContain(secret);

    // Imported back as it is, it changes nothing.
    const again = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const p = await preview(again);
    expect(named(p, `${tag} Old Pvt Ltd`)).toMatchObject({ action: 'unchanged', logins: 0 });
  });

  it('writes the passwords in full for the clients the caller may reveal, each one logged', async () => {
    await exportFile(sy, '?passwords=true').expect(403);
    const res = await exportFile(pa, '?passwords=true').expect(200);
    expect(res.headers['content-disposition']).toMatch(/with-passwords\.xlsx/);
    expect(Number(res.headers[CLIENT_MASTER_PASSWORDS_SHOWN_HEADER])).toBeGreaterThanOrEqual(3);
    const ws = XLSX.read(res.body as Buffer, { type: 'buffer' }).Sheets.Clients!;
    const r = rowOf(ws, oldCode);
    expect([ws[`AF${r}`].v, ws[`AG${r}`].v, ws[`AH${r}`].v, ws[`AI${r}`].v]).toEqual([
      'oldpvt_gst',
      OLD_GST_PASSWORD,
      OLD_PAN,
      OLD_IT_PASSWORD,
    ]);
    const n = rowOf(ws, newCode(ws));
    expect([ws[`AF${n}`].v, ws[`AG${n}`].v]).toEqual(['newtraders27', PASSWORD]);

    const log = await su.query<{ via: string; n: number }>(
      `SELECT l.via, count(*)::int AS n FROM hsdg.credential_access_log l
         JOIN hsdg.users u ON u.id = l.user_id
        WHERE u.email = 'partner.a@dhvaj.in' AND l.entity_id = $1 GROUP BY 1`,
      [oldId],
    );
    expect(log.rows).toEqual([{ via: 'export', n: 2 }]);
    const audit = await su.query(
      `SELECT 1 FROM hsdg.audit_events WHERE action = 'client_master.exported_with_passwords'`,
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it("gives another office's partner none of the client's logins, and logs none", async () => {
    const res = await exportFile(pb, '?passwords=true').expect(200);
    expect(res.headers[CLIENT_MASTER_PASSWORDS_MASKED_HEADER]).toBeDefined();
    const book = XLSX.read(res.body as Buffer, { type: 'buffer' });
    const all = JSON.stringify(
      ['Clients', 'Logins'].map((n) => XLSX.utils.sheet_to_json(book.Sheets[n]!, { header: 1 })),
    );
    expect(all).not.toContain(oldCode);
    expect(all).not.toContain(OLD_GST_PASSWORD);
    const log = await su.query(
      `SELECT 1 FROM hsdg.credential_access_log l JOIN hsdg.users u ON u.id = l.user_id
        WHERE u.email = 'partner.b@dhvaj.in' AND l.entity_id = $1`,
      [oldId],
    );
    expect(log.rowCount).toBe(0);
  });

  it('exports with passwords 5 times an hour at most; single reveals are not used up', async () => {
    await su.query(
      `INSERT INTO hsdg.credential_access_log (credential_id, entity_id, user_id, role, via, revealed_at)
       SELECT NULL, $1, u.id, 'partner', 'export', now() - make_interval(mins => g)
         FROM hsdg.users u, generate_series(1, 5) g WHERE u.email = 'partner.a@dhvaj.in'`,
      [oldId],
    );
    await exportFile(pa, '?passwords=true').expect(429);
    await exportFile(pa).expect(200);
    const { rows } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.client_credentials WHERE entity_id = $1 LIMIT 1`,
      [oldId],
    );
    await http().post(`/api/v1/credentials/${rows[0]!.id}/reveal`).set(bearer(pa)).expect(200);
  });
});
