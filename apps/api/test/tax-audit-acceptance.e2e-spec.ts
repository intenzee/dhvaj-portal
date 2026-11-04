import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { DocumentTemplateRecord, TaxAuditAcceptance } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { tinyDocx } from './section01-files.helper';

/**
 * F-3 — the Tax Audit acceptance desk. Only a partner with a valid
 * certificate of practice signs, and no partner signs more tax audit reports
 * in a year than the firm's limit (ICAI: 60) — a 61st is refused with the
 * count shown. A changed auditor needs the written communication uploaded
 * before the audit is accepted; the appointment letter comes from the firm's
 * template.
 */
describe('Tax audit acceptance (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: Record<string, string>;
  let pa: Record<string, string>;
  let pb: Record<string, string>;
  let eng: string;
  let auditId: string;
  const FY = '2026-27';
  const partner: Record<'mp' | 'a' | 'b', string> = { mp: '', a: '', b: '' };
  const http = () => request(app.getHttpServer());
  const base = () => `/api/v1/engagements/${eng}/tax-audits/${auditId}/acceptance`;

  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const view = async (who = pa) =>
    (await http().get(base()).set(who).expect(200)).body as TaxAuditAcceptance;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await as('mp@dhvaj.in');
    pa = await as('partner.a@dhvaj.in');
    pb = await as('partner.b@dhvaj.in');
    const { rows } = await su.query<{ code: string; id: string }>(
      `SELECT employee_code AS code, id FROM hsdg.employees
        WHERE employee_code IN ('EMP001', 'EMP003', 'EMP004')`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.code, r.id]));
    partner.mp = by.EMP001!;
    partner.a = by.EMP003!;
    partner.b = by.EMP004!;
    // Partner A: a valid COP. Partner B (another office): expired. MP: none.
    await su.query(
      `UPDATE hsdg.partner_profiles
          SET cop_no = CASE employee_id WHEN $1 THEN 'COP-A' WHEN $2 THEN 'COP-B' END,
              cop_valid_until = CASE employee_id WHEN $1 THEN DATE '2099-03-31'
                                                 WHEN $2 THEN DATE '2020-03-31' END
        WHERE employee_id IN ($1, $2, $3)`,
      [partner.a, partner.b, partner.mp],
    );

    const acme = await http().get('/api/v1/entities?search=Acme&limit=10').set(mp).expect(200);
    const client = await freshClient(acme.body.items[0].id as string);
    await su.query(`UPDATE hsdg.entities SET annual_turnover = 25000000 WHERE id = $1`, [client]);
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          kind: 'compliance',
          entityId: client,
          status: 'accepted',
          financialYear: FY,
          streams: ['income_tax', 'tax_audit'],
          years: [{ financialYear: FY }],
        })
        .expect(201)
    ).body.id as string;
    const audits = await http().get(`/api/v1/engagements/${eng}/tax-audits`).set(pa).expect(200);
    auditId = audits.body[0].id as string;
  });

  afterAll(async () => {
    await su?.query(
      `UPDATE hsdg.partner_profiles SET cop_no = NULL, cop_valid_until = NULL
        WHERE employee_id IN ($1, $2, $3)`,
      [partner.a, partner.b, partner.mp],
    );
    await su?.end();
    await app?.close();
  });

  it('offers only partners with a valid COP, each with their count', async () => {
    const v = await view();
    expect(v).toMatchObject({ stage: 'not_started', limit: 60, canEdit: true });
    const p = Object.fromEntries(v.partners.map((x) => [x.employeeId, x]));
    expect(p[partner.a]).toMatchObject({
      offered: true,
      reports: 0,
      summary: `Partner A: 0 of 60 for FY ${FY}`,
    });
    // Partner B sits in another office: still listed, with the reason.
    expect(p[partner.b]).toMatchObject({ offered: false });
    expect(p[partner.b]!.reason).toContain('COP expired on 2020-03-31');
    expect(p[partner.mp]).toMatchObject({ offered: false });
    expect(p[partner.mp]!.reason).toContain('No certificate of practice');

    const res = await http()
      .put(base())
      .set(pa)
      .send({ version: v.version, signingPartnerId: partner.b })
      .expect(409);
    expect(res.body.message).toContain('COP expired');
  });

  it('only the engagement’s partner or manager accepts', async () => {
    const v = await view(mp);
    const res = await http().put(base()).set(pb).send({ version: v.version, formType: '3CB' });
    expect([403, 404]).toContain(res.status);
  });

  it('refuses a 61st report for one partner, with the count shown', async () => {
    // 60 reports for Partner A this year on other clients' engagements.
    await su.query('BEGIN');
    await su.query(`SET LOCAL session_replication_role = replica`);
    const { rows: fillers } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.engagements
       SELECT (jsonb_populate_record(NULL::hsdg.engagements,
                 to_jsonb(e) || jsonb_build_object('id', gen_random_uuid(),
                                                   'engagement_code', 'TAF/' || lpad(g::text, 5, '0'),
                                                   'kind', 'assignment'))).*
         FROM hsdg.engagements e, generate_series(1, 60) g
        WHERE e.id = $1
       RETURNING id`,
      [eng],
    );
    await su.query('COMMIT');
    try {
      await su.query(
        `INSERT INTO hsdg.tax_audits (engagement_id, financial_year, signing_partner_id)
         SELECT id, $2, $3 FROM unnest($1::uuid[]) id`,
        [fillers.map((f) => f.id), FY, partner.a],
      );
      const v = await view();
      const a = v.partners.find((x) => x.employeeId === partner.a)!;
      expect(a).toMatchObject({ offered: false, reports: 60 });
      expect(a.summary).toBe(`Partner A: 60 of 60 for FY ${FY}`);

      const res = await http()
        .put(base())
        .set(pa)
        .send({ version: v.version, signingPartnerId: partner.a })
        .expect(409);
      expect(res.body.message).toContain(`Partner A: 60 of 60 for FY ${FY}`);

      // The database refuses it too, whoever writes the row.
      await expect(
        su.query(`UPDATE hsdg.tax_audits SET signing_partner_id = $2 WHERE id = $1`, [
          auditId,
          partner.a,
        ]),
      ).rejects.toThrow(`Partner A has 60 of 60 tax audit reports for FY ${FY}`);
    } finally {
      await su.query(`DELETE FROM hsdg.tax_audits WHERE engagement_id = ANY($1::uuid[])`, [
        fillers.map((f) => f.id),
      ]);
      await su.query('BEGIN');
      await su.query(`SET LOCAL session_replication_role = replica`);
      await su.query(`DELETE FROM hsdg.engagements WHERE id = ANY($1::uuid[])`, [
        fillers.map((f) => f.id),
      ]);
      await su.query('COMMIT');
    }
  });

  it('the firm may lower the limit, never raise it past 60', async () => {
    const s = (await http().get('/api/v1/workflow-settings').set(mp).expect(200)).body as {
      version: number;
      taxAuditLimit: number;
    };
    expect(s.taxAuditLimit).toBe(60);
    const bad = await http()
      .patch('/api/v1/workflow-settings')
      .set(mp)
      .send({ version: s.version, taxAuditLimit: 61 })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain('at most 60');
    const low = await http()
      .patch('/api/v1/workflow-settings')
      .set(mp)
      .send({ version: s.version, taxAuditLimit: 45 })
      .expect(200);
    expect(low.body.taxAuditLimit).toBe(45);
    expect((await view()).partners.find((x) => x.employeeId === partner.a)!.summary).toBe(
      `Partner A: 0 of 45 for FY ${FY}`,
    );
    await http()
      .patch('/api/v1/workflow-settings')
      .set(mp)
      .send({ version: low.body.version, taxAuditLimit: 60 })
      .expect(200);
  });

  it('a changed auditor needs the written communication before acceptance', async () => {
    let v = await view();
    // "Not answered" with a name keeps no name.
    v = (
      await http()
        .put(base())
        .set(pa)
        .send({ version: v.version, previousAuditorChanged: null, previousAuditorName: 'X' })
        .expect(200)
    ).body;
    expect(v.previousAuditor).toMatchObject({ changed: null, name: null });
    v = (
      await http()
        .put(base())
        .set(pa)
        .send({
          version: v.version,
          formType: '3CB',
          signingPartnerId: partner.a,
          previousAuditorChanged: true,
          previousAuditorName: 'Old & Co',
        })
        .expect(200)
    ).body;
    expect(v).toMatchObject({
      stage: 'acceptance',
      formType: '3CB',
      signingPartnerName: 'Partner A',
    });
    expect(v.missing).toContain('Upload the written communication to the previous auditor.');

    const refused = await http().post(`${base()}/accept`).set(pa).send({ version: v.version });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('Upload the written communication');

    v = (
      await http()
        .post(`${base()}/previous-auditor-letter`)
        .set(pa)
        .send({
          version: v.version,
          filename: 'Letter to Old & Co.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('%PDF-1.4 letter').toString('base64'),
        })
        .expect(200)
    ).body;
    expect(v.previousAuditor.letterDocumentId).toEqual(expect.any(String));
    expect(v.missing).toEqual(['Make the appointment letter.']);
  });

  it('makes the appointment letter from the template, then accepts', async () => {
    let v = await view();
    const noTemplate = await http()
      .post(`${base()}/appointment-letter`)
      .set(pa)
      .send({ version: v.version })
      .expect(400);
    expect(noTemplate.body.message).toContain('an administrator must upload and approve one');

    const templates = (await http().get('/api/v1/document-templates').set(mp).expect(200))
      .body as DocumentTemplateRecord[];
    const standard = templates.find(
      (t) => t.templateKey === 'tax_audit_appointment_letter' && t.variantKey === 'standard',
    )!;
    const bytes = await tinyDocx([
      'Appointment as tax auditor — {{client.name}}, AY {{taxAudit.assessmentYear}}',
      '{{taxAudit.form}} signed by {{partner.name}} (COP {{partner.copNo}})',
    ]);
    const uploaded = (
      await http()
        .post(`/api/v1/document-templates/${standard.id}/versions`)
        .set(mp)
        .send({ filename: 'TA appointment.docx', contentBase64: bytes.toString('base64') })
        .expect(201)
    ).body as DocumentTemplateRecord;
    expect(uploaded.versions[0]!.unknownFields).toEqual([]);
    await http()
      .post(
        `/api/v1/document-templates/${standard.id}/versions/${uploaded.versions[0]!.id}/approve`,
      )
      .set(mp)
      .expect(201);

    v = (
      await http()
        .post(`${base()}/appointment-letter`)
        .set(pa)
        .send({ version: v.version })
        .expect(200)
    ).body;
    expect(v.appointmentLetter?.title).toContain(`Tax Audit Appointment Letter ${FY}`);
    expect(v.missing).toEqual([]);

    v = (await http().post(`${base()}/accept`).set(pa).send({ version: v.version }).expect(200))
      .body;
    expect(v).toMatchObject({ stage: 'information', canEdit: false });
    expect(v.acceptedByName).toBe('Partner A');
    expect(v.independence).toMatchObject({ ok: true, confirmedByName: 'Partner A' });

    const again = await http().put(base()).set(pa).send({ version: v.version, formType: '3CA' });
    expect(again.status).toBe(409);
    expect(again.body.message).toContain('already accepted');
  });
});
