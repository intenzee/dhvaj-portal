import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { gstinCheckChar, type ClientImportResult } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * The client's GST return history (the firm's sheet: filed / NA by month)
 * closes the engagement's GST months wherever they are: on import, whoever
 * leads the engagement; when a calendar is generated later; the month's
 * inward reconciliation with its GSTR-3B; and a month removed from the
 * portal that the client filed shows as filed.
 */
describe('Client return marks close GST filings (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: string;
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
  const pan = `${letters(3)}C${letters(1)}${digits(4)}${letters(1)}`;
  const first14 = `07${pan}1Z`;
  const GSTIN = first14 + gstinCheckChar(first14);
  const name = `Marks${Date.now()} Traders Pvt Ltd`;

  /** The firm's sheet for one monthly GSTIN: [GSTR-1, GSTR-3B] per month. */
  const book = (marks: Record<string, [string, string]>): string => {
    const months = Object.keys(marks);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['', '', '', '', '', ...months.flatMap((m) => [m, ''])],
        [
          'Particular',
          'Frequency',
          'ID',
          'Pwd',
          'GSTIN',
          ...months.flatMap(() => ['GSTR-1', 'GSTR-3']),
        ],
        [name, 'Monthly', 'marks_id', 'marks-pw', GSTIN, ...months.flatMap((m) => marks[m]!)],
      ]),
      'GST Login',
    );
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };
  const runImport = async (t: string, marks: Record<string, [string, string]>) =>
    (
      await http()
        .post('/api/v1/client-imports/workbook')
        .set(bearer(t))
        .send({ filename: 'marks.xlsx', contentBase64: book(marks), officeCode: 'NORTH' })
        .expect(200)
    ).body as ClientImportResult;

  /** Each GST filing of the client: 'CODE period' → workflow status (and notes). */
  const filings = async (): Promise<Map<string, { workflow: string; notes: string | null }>> => {
    const { rows } = await su.query<{
      code: string;
      period_key: string;
      workflow_status: string;
      notes: string | null;
    }>(
      `SELECT r.code, ci.period_key, ci.workflow_status, ci.notes
         FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
         JOIN hsdg.entity_registrations g ON g.id = ci.registration_id
        WHERE g.registration_number = $1`,
      [GSTIN],
    );
    return new Map(
      rows.map((r) => [
        `${r.code} ${r.period_key}`,
        { workflow: r.workflow_status, notes: r.notes },
      ]),
    );
  };
  const workflowOf = async (key: string) => (await filings()).get(key)?.workflow;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  let engagementId: string;

  it('closes the marked months on import, with the inward reconciliation of a filed 3B', async () => {
    const result = await runImport(pa, {
      'Apr-26': ['filed', 'filed'],
      'May-26': ['NA', ''],
    });
    expect(result).toMatchObject({ engagementsCreated: 1, marksApplied: 3, marksNotAllowed: 0 });
    const f = await filings();
    expect(f.get('GST_GSTR1_M 2026-04')?.workflow).toBe('filed');
    expect(f.get('GST_GSTR3B_M 2026-04')?.workflow).toBe('filed');
    expect(f.get('GST_ITC_RECON_M 2026-04')?.workflow).toBe('filed');
    expect(f.get('GST_GSTR1_M 2026-05')).toEqual({
      workflow: 'not_applicable',
      notes: expect.stringMatching(/^Marked NA in the firm's GST sheet \(GST Login, row \d+\)\.$/),
    });
    expect(f.get('GST_GSTR3B_M 2026-05')?.workflow).not.toMatch(/filed|not_applicable/);
    expect(f.get('GST_ITC_RECON_M 2026-05')?.workflow).not.toMatch(/filed|not_applicable/);

    const { rows } = await su.query<{ engagement_id: string }>(
      `SELECT ci.engagement_id FROM hsdg.compliance_instances ci
         JOIN hsdg.entity_registrations g ON g.id = ci.registration_id
        WHERE g.registration_number = $1 LIMIT 1`,
      [GSTIN],
    );
    engagementId = rows[0]!.engagement_id;
  });

  it('closes them on an engagement the importer does not lead, and a removed month the client filed', async () => {
    // The engagement passes to Partner B: Partner A, who imports, no longer leads it.
    await su.query(
      `UPDATE hsdg.engagements
          SET engagement_partner_id = (SELECT id FROM hsdg.employees WHERE employee_code = 'EMP004')
        WHERE id = $1`,
      [engagementId],
    );
    const lead = await su.query(
      `SELECT 1 FROM hsdg.engagement_access a JOIN hsdg.employees e ON e.id = a.employee_id
        WHERE a.engagement_id = $1 AND e.employee_code = 'EMP003'
          AND a.source IN ('partner', 'manager')`,
      [engagementId],
    );
    expect(lead.rowCount).toBe(0);
    // July was removed from the portal (Start fresh / Remove this month).
    await su.query(
      `UPDATE hsdg.compliance_instances ci
          SET workflow_status = 'not_applicable', notes = '[removed] Removed from the portal.'
         FROM hsdg.compliance_rules r
        WHERE r.id = ci.compliance_rule_id AND ci.engagement_id = $1
          AND r.code = 'GST_GSTR1_M' AND ci.period_key = '2026-07'`,
      [engagementId],
    );

    const result = await runImport(pa, {
      'Apr-26': ['filed', 'filed'],
      'May-26': ['NA', ''],
      'Jun-26': ['filed', ''],
      'Jul-26': ['filed', ''],
    });
    expect(result).toMatchObject({ marksApplied: 2, marksAlreadyDone: 3, marksNotAllowed: 0 });
    const f = await filings();
    expect(f.get('GST_GSTR1_M 2026-06')?.workflow).toBe('filed');
    expect(f.get('GST_GSTR1_M 2026-07')).toEqual({ workflow: 'filed', notes: null });

    const audit = await su.query(
      `SELECT 1 FROM hsdg.audit_events a
         JOIN hsdg.compliance_instances ci ON ci.id::text = a.object_id
         JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
        WHERE ci.engagement_id = $1 AND r.code = 'GST_GSTR1_M' AND ci.period_key = '2026-06'
          AND a.action = 'compliance.instance_completed'
          AND a.reason LIKE 'Marked filed in the firm''s GST sheet%'`,
      [engagementId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('closes the months of a calendar generated after the marks', async () => {
    // The sheet already marked April 2027 (kept on the client) before the year existed.
    await su.query(
      `INSERT INTO hsdg.client_return_marks
         (entity_id, registration_id, state_code, return_form, period_key, mark)
       SELECT g.entity_id, g.id, '07', f.form, '2027-04', 'filed'
         FROM hsdg.entity_registrations g, unnest(ARRAY['GSTR1','GSTR3B']) AS f(form)
        WHERE g.registration_number = $1`,
      [GSTIN],
    );
    expect(await workflowOf('GST_GSTR1_M 2027-04')).toBeUndefined();

    await http()
      .post(`/api/v1/engagements/${engagementId}/years`)
      .set(bearer(pb))
      .send({ financialYear: '2027-28', streams: ['gst'] })
      .expect(201);

    const f = await filings();
    expect(f.get('GST_GSTR1_M 2027-04')?.workflow).toBe('filed');
    expect(f.get('GST_GSTR3B_M 2027-04')?.workflow).toBe('filed');
    expect(f.get('GST_ITC_RECON_M 2027-04')?.workflow).toBe('filed');
    expect(f.get('GST_GSTR1_M 2027-05')?.workflow).not.toMatch(/filed|not_applicable/);
  });

  it("takes a quarter's mark, or its last month's", async () => {
    const { rows } = await su.query<{ q1: string; q4: string; month: string }>(
      `SELECT hsdg.return_period_month('2026-27:Q1') AS q1,
              hsdg.return_period_month('2026-27:Q4') AS q4,
              hsdg.return_period_month('2026-05') AS month`,
    );
    expect(rows[0]).toEqual({ q1: '2026-06', q4: '2027-03', month: '2026-05' });
  });
});
