import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';
import { gstinCheckChar } from '../src/modules/notices/notice-extract';
import { FeatureFlagsService } from '../src/common/feature-flags/feature-flags.service';

/**
 * PS-104 — notice intake from the PDF. Partner A uploads a notice PDF onto
 * the client's Compliance engagement; OCR is off under test, so intake first
 * reports not_applicable; with the OCR text in place (written as the
 * superuser, as the extraction service would) intake suggests the fields and
 * the client — by GSTIN, else by PAN — with its open engagements. Nothing is
 * saved. RLS: a partner of another office who is not on the engagement gets
 * 404. Behind ff_notices (404 when off).
 */
describe('Notice intake from the PDF (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let admin: string;
  let entityId: string;
  let engagementId: string;
  let engagementCode: string;
  let registrationId: string;
  let pan: string;
  let gstin: string;
  let gstDoc: string;
  let itDoc: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const fixture = (name: string): string =>
    readFileSync(
      join(__dirname, '..', 'src', 'modules', 'notices', '__fixtures__', `${name}.txt`),
      'utf8',
    );
  const letters = (n: number): string =>
    Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
      '',
    );
  const intake = (t: string, documentId: string) =>
    http().post('/api/v1/notices/intake').set(bearer(t)).send({ documentId });

  const upload = async (title: string): Promise<string> => {
    const res = await http()
      .post(`/api/v1/engagements/${engagementId}/documents`)
      .set(bearer(pa))
      .send({
        title,
        documentType: 'notice',
        filename: 'notice.pdf',
        contentType: 'application/pdf',
        contentBase64: Buffer.from('%PDF-1.4 synthetic').toString('base64'),
      })
      .expect(201);
    const id = res.body.id as string;
    // Extraction runs after the upload commits; wait for it to settle.
    for (let i = 0; i < 50; i++) {
      const r = await su.query<{ ocr_status: string }>(
        `SELECT ocr_status FROM hsdg.documents WHERE id = $1`,
        [id],
      );
      if (r.rows[0]?.ocr_status !== 'pending') break;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    return id;
  };
  const setText = (documentId: string, text: string) =>
    su.query(
      `UPDATE hsdg.documents SET extracted_text = $2, ocr_status = 'done', extracted_at = now()
        WHERE id = $1`,
      [documentId, text],
    );

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    admin = await token('admin@dhvaj.in');

    // A client of its own with a (synthetic) PAN and GSTIN.
    entityId = await freshClient(
      (await http().get('/api/v1/entities?search=Bharat&limit=100').set(bearer(mp))).body.items[0]
        .id as string,
    );
    pan = `${letters(3)}C${letters(1)}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}${letters(1)}`;
    gstin = `27${pan}1Z`;
    gstin += gstinCheckChar(gstin);
    await su.query(`UPDATE hsdg.entities SET pan = $2 WHERE id = $1`, [entityId, pan]);
    registrationId = (
      await su.query<{ id: string }>(
        `INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, state_code)
         VALUES ($1, 'gstin', $2, '27') RETURNING id`,
        [entityId, gstin],
      )
    ).rows[0]!.id;

    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    const eng = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `NI${Date.now()}`,
        status: 'accepted',
      })
      .expect(201);
    engagementId = eng.body.id as string;
    engagementCode = eng.body.engagementCode as string;

    gstDoc = await upload('ASMT-10 for FY 2024-25');
    itDoc = await upload('143(2) for AY 2025-26');
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('reports not_applicable while the document has no OCR text (OCR is off under test)', async () => {
    const res = await intake(pa, gstDoc).expect(200);
    expect(res.body).toEqual({
      documentId: gstDoc,
      ocrStatus: 'not_applicable',
      fields: {},
      noticeTypeCode: null,
      clients: [],
    });
  });

  it('reports pending until extraction has run', async () => {
    await su.query(`UPDATE hsdg.documents SET ocr_status = 'pending' WHERE id = $1`, [gstDoc]);
    const res = await intake(pa, gstDoc).expect(200);
    expect(res.body.ocrStatus).toBe('pending');
  });

  it('suggests the fields of a GST notice and the client by GSTIN, saving nothing', async () => {
    await setText(gstDoc, fixture('gst-asmt10').replace('27AABCS1234F1ZR', gstin));
    const before = await su.query(`SELECT count(*)::int AS n FROM hsdg.notices`);
    const res = await intake(pa, gstDoc).expect(200);
    expect(res.body.ocrStatus).toBe('done');
    const f = res.body.fields;
    expect(f.gstin).toEqual(expect.objectContaining({ value: gstin, confidence: 0.9 }));
    expect(f.referenceNo.value).toBe('ZD2710102600123');
    expect(f.issuedOn.value).toBe('2026-10-10');
    expect(f.replyDueOn.value).toBe('2026-11-09');
    expect(f.amountDemanded.value).toBe('148350.00');
    expect(f.form.value).toBe('ASMT-10');
    expect(typeof f.replyDueOn.snippet).toBe('string');
    expect(res.body.noticeTypeCode.value).toBe('GST_ASMT10');
    expect(res.body.clients).toEqual([
      {
        entityId,
        entityName: expect.any(String),
        matchedOn: 'gstin',
        registrationId,
        engagements: [
          { id: engagementId, code: engagementCode, name: expect.stringContaining('FY 2026-27') },
        ],
      },
    ]);
    const after = await su.query(`SELECT count(*)::int AS n FROM hsdg.notices`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('matches an income-tax notice to the client by PAN', async () => {
    await setText(itDoc, fixture('it-143-2').replace('ABCPM1234D', pan));
    const res = await intake(pa, itDoc).expect(200);
    expect(res.body.fields.pan.value).toBe(pan);
    expect(res.body.fields.referenceNo.value).toBe('ITBA/AST/S/143(2)/2026-27/1071234567(1)');
    expect(res.body.fields.assessmentYear.value).toBe('2025-26');
    expect(res.body.noticeTypeCode.value).toBe('IT_143_2');
    expect(res.body.clients).toHaveLength(1);
    expect(res.body.clients[0]).toEqual(
      expect.objectContaining({ entityId, matchedOn: 'pan', registrationId: null }),
    );
  });

  it('the confirmed suggestions make a valid notice (recorded directly; POST /notices files it)', async () => {
    const s = (await intake(pa, gstDoc).expect(200)).body;
    const owner = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE employee_code = 'EMP003'`,
    );
    const n = await su.query<{ id: string; internal_due_on: string }>(
      `INSERT INTO hsdg.notices
         (entity_id, engagement_id, registration_id, notice_type_id, reference_no, issued_on,
          received_on, financial_year, period_from, period_to, amount_demanded, reply_due_on,
          owner_employee_id)
       SELECT $1, $2, $3, t.id, $5, $6, $6, $7, $8, $9, $10, $11, $12
         FROM hsdg.notice_types t WHERE t.code = $4
       RETURNING id, internal_due_on::text`,
      [
        s.clients[0].entityId,
        s.clients[0].engagements[0].id,
        s.clients[0].registrationId,
        s.noticeTypeCode.value,
        s.fields.referenceNo.value,
        s.fields.issuedOn.value,
        s.fields.financialYear.value,
        s.fields.periodFrom.value,
        s.fields.periodTo.value,
        s.fields.amountDemanded.value,
        s.fields.replyDueOn.value,
        owner.rows[0]!.id,
      ],
    );
    await su.query(`UPDATE hsdg.documents SET notice_id = $2 WHERE id = $1`, [
      gstDoc,
      n.rows[0]!.id,
    ]);
    expect(n.rows[0]!.internal_due_on < s.fields.replyDueOn.value).toBe(true);
  });

  it('hides a document on someone else’s engagement (404), and lets the firm-wide MP read it', async () => {
    await intake(pb, gstDoc).expect(404);
    await intake(mp, gstDoc).expect(200);
  });

  it('404s an unknown document, 400s a malformed id, 403s without notice.manage', async () => {
    await intake(pa, '00000000-0000-4000-8000-000000000000').expect(404);
    await http()
      .post('/api/v1/notices/intake')
      .set(bearer(pa))
      .send({ documentId: 'nope' })
      .expect(400);
    await intake(admin, gstDoc).expect(403);
  });

  it('is behind ff_notices: 404 when the firm has it off', async () => {
    const flags = app.get(FeatureFlagsService);
    flags.setRules(new Map([['ff_notices', { mode: 'off', officeCodes: new Set<string>() }]]));
    try {
      await intake(pa, gstDoc).expect(404);
    } finally {
      flags.setRules(new Map());
    }
    await intake(pa, gstDoc).expect(200);
  });
});
