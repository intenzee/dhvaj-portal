import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  ImportItrStatementResult,
  ItrIncome,
  ItrReturn,
  ItrSeason,
  ItrVerifyReminder,
  RecordItrIntimationResult,
  TodayView,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

/** A synthetic 26AS text export (as parsers.spec): two deductors in Part I, one in Part II. */
const FORM_26AS = [
  'Annual Tax Statement',
  'Permanent Account Number (PAN)^Current Status of PAN^Financial Year^Assessment Year',
  'ABCPE1234F^Active^2025-26^2026-27',
  'PART-I - Details of Tax Deducted at Source',
  'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)',
  '1^EXAMPLE SOFTWARE PRIVATE LIMITED^MUMX12345A^^^^^12,00,000.00^1,10,000.00^1,10,000.00',
  '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)',
  '^1^192^31-Mar-2026^F^31-May-2026^-^12,00,000.00^1,10,000.00^1,10,000.00',
  '2^SAMPLE BANK LIMITED^DELS54321B^^^^^45,250.00^4,525.00^4,525.00',
  '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)',
  '^1^194A^30-Sep-2025^F^15-Nov-2025^-^20,000.00^2,000.00^2,000.00',
  '^2^194A^31-Mar-2026^U^15-May-2026^-^25,250.00^2,525.00^2,525.00',
  'PART-II - Details of Tax Deducted at Source for 15G / 15H',
  'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)',
  '1^DEMO CO-OPERATIVE BANK^PNEX11111C^^^^^8,000.00^0.00^0.00',
].join('\n');

const FY = '2025-26';

/**
 * PS-403 — the ITR desk. "The season grid lists every individual's ITR for the
 * year; a filed return shows its e-verify date (filing + 30 days) and turns
 * red past it; refunds and 143(1) intimations are followed on the return, a
 * demand opening a notice; 26AS / AIS lines are matched with the client's."
 */
describe('ITR desk (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: Record<string, string>;
  let pb: Record<string, string>;
  let sy: Record<string, string>;
  let acme: string;
  let individual: string;
  let today: string;
  const savedFlags = process.env.FEATURE_FLAGS;
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const daysFrom = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const pan = () =>
    `ABC${'P'}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String(
      Math.floor(Math.random() * 1e4),
    ).padStart(4, '0')}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;

  /** A new individual client with a compliance engagement on income tax for FY; its ITR filing. */
  const itrFiling = async (): Promise<{ entity: string; engagement: string; instance: string }> => {
    const entity = await freshClient(acme);
    // A salaried individual: no tax audit (Acme's turnover would make it IT_ITR_AUDIT).
    await su.query(
      `UPDATE hsdg.entities SET entity_type_id = $2, pan = $3, annual_turnover = 500000
        WHERE id = $1`,
      [entity, individual, pan()],
    );
    const res = await http()
      .post('/api/v1/engagements')
      .set(pa)
      .send({
        kind: 'compliance',
        entityId: entity,
        status: 'accepted',
        financialYear: FY,
        streams: ['income_tax'],
        years: [{ financialYear: FY }],
      });
    if (res.status !== 201)
      throw new Error(`engagement: ${res.status} ${JSON.stringify(res.body)}`);
    const engagement = res.body.id as string;
    const { rows } = await su.query<{ id: string }>(
      `SELECT ci.id FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
        WHERE ci.engagement_id = $1 AND cr.code = 'IT_ITR' AND ci.financial_year = $2`,
      [engagement, FY],
    );
    if (!rows[0]) throw new Error('No IT_ITR filing was generated for the engagement.');
    return { entity, engagement, instance: rows[0].id };
  };

  /** Lodge the filing in the drawer (as the superuser, the firm's checks relaxed meanwhile). */
  const lodge = async (instance: string, filedOn: string, ackNo: string) => {
    await su.query('BEGIN');
    try {
      const {
        rows: [fs],
      } = await su.query<{ strict_checks: unknown }>(
        `SELECT strict_checks FROM hsdg.firm_settings LIMIT 1`,
      );
      await su.query(`UPDATE hsdg.firm_settings SET strict_checks = '{}'::jsonb`);
      await su.query(
        `INSERT INTO hsdg.filing_records
           (compliance_instance_id, engagement_id, compliance_rule_id, period_key, reference_kind,
            reference_no, filed_on)
         SELECT ci.id, ci.engagement_id, ci.compliance_rule_id, ci.period_key, 'ack', $2, $3::date
           FROM hsdg.compliance_instances ci WHERE ci.id = $1`,
        [instance, ackNo, filedOn],
      );
      await su.query(`UPDATE hsdg.firm_settings SET strict_checks = $1::jsonb`, [
        JSON.stringify(fs!.strict_checks),
      ]);
      await su.query('COMMIT');
    } catch (err) {
      await su.query('ROLLBACK');
      throw err;
    }
  };

  const open = async (instance: string, h = pa) =>
    (
      await http()
        .post('/api/v1/itr/returns')
        .set(h)
        .send({ complianceInstanceId: instance })
        .expect(200)
    ).body as ItrReturn;

  const season = async (h = pa, scope = '') =>
    (await http().get(`/api/v1/itr/season?financialYear=${FY}${scope}`).set(h).expect(200))
      .body as ItrSeason;

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    today = (
      await su.query<{ d: string }>(`SELECT timezone('Asia/Kolkata', now())::date::text AS d`)
    ).rows[0]!.d;
    pa = await as('partner.a@dhvaj.in');
    pb = await as('partner.b@dhvaj.in');
    sy = await as('senior.y@dhvaj.in');
    acme = (await http().get('/api/v1/entities?search=Acme&limit=10').set(pa).expect(200)).body
      .items[0].id as string;
    individual = (
      await su.query<{ id: string }>(
        `SELECT id FROM hsdg.entity_types WHERE category = 'individual' LIMIT 1`,
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
    if (savedFlags === undefined) delete process.env.FEATURE_FLAGS;
    else process.env.FEATURE_FLAGS = savedFlags;
  });

  it('lists the year’s ITRs on individuals; opening a return is idempotent; outsiders see nothing', async () => {
    const f = await itrFiling();
    let s = await season();
    const row = s.items.find((i) => i.instanceId === f.instance);
    expect(row).toMatchObject({
      returnId: null,
      stage: 'preparing',
      entityType: 'individual',
      eVerifyDueOn: null,
      refundStatus: 'none',
      canAssign: true,
    });
    expect(s.yearLabel).toBe('AY 2026-27');
    expect(s.total).toBe(s.items.length);

    const r = await open(f.instance);
    expect(r).toMatchObject({
      complianceInstanceId: f.instance,
      engagementId: f.engagement,
      regime: 'new',
      returnType: 'original',
      stage: 'preparing',
      assessmentYear: '2026-27',
      version: 1,
      can: { edit: true },
    });
    expect((await open(f.instance)).id).toBe(r.id);
    s = await season();
    expect(s.items.find((i) => i.instanceId === f.instance)?.returnId).toBe(r.id);

    // Another office's partner and a senior off the team: not found.
    await http().get(`/api/v1/itr/returns/${r.id}`).set(pb).expect(404);
    expect((await season(pb)).items.some((i) => i.instanceId === f.instance)).toBe(false);
    await http().get(`/api/v1/itr/returns/${r.id}`).set(sy).expect(404);
    await http()
      .post('/api/v1/itr/returns')
      .set(sy)
      .send({ complianceInstanceId: f.instance })
      .expect(404);
  });

  it('refuses a filing that is not an ITR, and an unknown filing', async () => {
    const f = await itrFiling();
    const other = (
      await su.query<{ id: string }>(
        `SELECT ci.id FROM hsdg.compliance_instances ci
           JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
          WHERE ci.engagement_id = $1 AND cr.code NOT IN ('IT_ITR', 'IT_ITR_AUDIT', 'IT_ITR_TP')
          LIMIT 1`,
        [f.engagement],
      )
    ).rows[0]?.id;
    if (other)
      await http()
        .post('/api/v1/itr/returns')
        .set(pa)
        .send({ complianceInstanceId: other })
        .expect(400);
    await http()
      .post('/api/v1/itr/returns')
      .set(pa)
      .send({ complianceInstanceId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
  });

  it('a filed return is due for e-verification 30 days on; past it it is overdue, and on Today', async () => {
    const f = await itrFiling();
    let r = await open(f.instance);
    // Not lodged yet: nothing to e-verify.
    await http()
      .post(`/api/v1/itr/returns/${r.id}/e-verify`)
      .set(pa)
      .send({ version: r.version, eVerifiedOn: today, mode: 'aadhaar_otp' })
      .expect(400);

    const filedOn = daysFrom(today, -40);
    await lodge(f.instance, filedOn, 'ACK-ITR-LATE');
    r = (await http().get(`/api/v1/itr/returns/${r.id}`).set(pa).expect(200)).body as ItrReturn;
    expect(r).toMatchObject({
      stage: 'awaiting_verification',
      filedOn,
      ackNo: 'ACK-ITR-LATE',
      eVerifyDueOn: daysFrom(filedOn, 30),
      eVerifyOverdue: true,
      verifiedLate: false,
    });
    const s = await season();
    expect(s.items.find((i) => i.returnId === r.id)).toMatchObject({
      stage: 'awaiting_verification',
      eVerifyOverdue: true,
    });
    expect(s.eVerifyOverdue).toBeGreaterThanOrEqual(1);

    // Today: the partner leads the engagement, so the lapsed window is a row (lifted to Overdue).
    const view = (
      await http().get(`/api/v1/work/today?engagementId=${f.engagement}`).set(pa).expect(200)
    ).body as TodayView;
    const row = view.groups.flatMap((g) => g.items).find((i) => i.key === `itr_verify:${r.id}`);
    expect(row).toMatchObject({
      kind: 'itr_verify',
      isOverdue: true,
      itr: { returnId: r.id, ackNo: 'ACK-ITR-LATE', filedOn, eVerifyDueOn: daysFrom(filedOn, 30) },
    });

    // The client is reminded (no channel: the firm's, falling back to copy).
    const rem = (
      await http().post(`/api/v1/itr/returns/${r.id}/remind-verify`).set(pa).send({}).expect(200)
    ).body as ItrVerifyReminder;
    expect(rem.returnId).toBe(r.id);
    expect(rem.text).toContain('ACK-ITR-LATE');
    expect(rem.text).toContain('AY 2026-27');

    // Bad dates; a stale version.
    await http()
      .post(`/api/v1/itr/returns/${r.id}/e-verify`)
      .set(pa)
      .send({ version: r.version, eVerifiedOn: daysFrom(filedOn, -1), mode: 'aadhaar_otp' })
      .expect(400);
    await http()
      .post(`/api/v1/itr/returns/${r.id}/e-verify`)
      .set(pa)
      .send({ version: r.version, eVerifiedOn: daysFrom(today, 1), mode: 'aadhaar_otp' })
      .expect(400);
    await http()
      .post(`/api/v1/itr/returns/${r.id}/e-verify`)
      .set(pa)
      .send({ version: r.version + 5, eVerifiedOn: today, mode: 'aadhaar_otp' })
      .expect(409);

    // Verified today — after the window: late, and off Today.
    r = (
      await http()
        .post(`/api/v1/itr/returns/${r.id}/e-verify`)
        .set(pa)
        .send({ version: r.version, eVerifiedOn: today, mode: 'evc_bank' })
        .expect(200)
    ).body as ItrReturn;
    expect(r).toMatchObject({
      stage: 'verified',
      eVerifiedOn: today,
      eVerifyMode: 'evc_bank',
      eVerifyOverdue: false,
      verifiedLate: true,
    });
    const after = (
      await http().get(`/api/v1/work/today?engagementId=${f.engagement}`).set(pa).expect(200)
    ).body as TodayView;
    expect(after.groups.flatMap((g) => g.items).some((i) => i.key === `itr_verify:${r.id}`)).toBe(
      false,
    );
    await http().post(`/api/v1/itr/returns/${r.id}/remind-verify`).set(pa).send({}).expect(400);
  });

  it('a refund claimed is followed until credited; bad moves are refused', async () => {
    const f = await itrFiling();
    let r = await open(f.instance);
    r = (
      await http()
        .patch(`/api/v1/itr/returns/${r.id}`)
        .set(pa)
        .send({ version: r.version, itrForm: 'ITR-1', refundClaimed: '15000' })
        .expect(200)
    ).body as ItrReturn;
    expect(r).toMatchObject({
      itrForm: 'ITR-1',
      refundClaimed: '15000.00',
      refundStatus: 'pending',
    });
    // Not filed yet: it cannot be credited.
    await http()
      .post(`/api/v1/itr/returns/${r.id}/refund`)
      .set(pa)
      .send({ version: r.version, to: 'issued', amount: '15000' })
      .expect(400);
    await lodge(f.instance, daysFrom(today, -5), 'ACK-ITR-REF');
    // Credited needs the amount; pending cannot go back to pending.
    await http()
      .post(`/api/v1/itr/returns/${r.id}/refund`)
      .set(pa)
      .send({ version: r.version, to: 'issued' })
      .expect(400);
    await http()
      .post(`/api/v1/itr/returns/${r.id}/refund`)
      .set(pa)
      .send({ version: r.version, to: 'pending' })
      .expect(400);
    r = (
      await http()
        .post(`/api/v1/itr/returns/${r.id}/refund`)
        .set(pa)
        .send({ version: r.version, to: 'failed', note: 'Bank account not pre-validated' })
        .expect(200)
    ).body as ItrReturn;
    expect(r).toMatchObject({
      refundStatus: 'failed',
      refundNote: 'Bank account not pre-validated',
    });
    r = (
      await http()
        .post(`/api/v1/itr/returns/${r.id}/refund`)
        .set(pa)
        .send({ version: r.version, to: 'issued', amount: '15230', on: today })
        .expect(200)
    ).body as ItrReturn;
    expect(r).toMatchObject({ refundStatus: 'issued', refundAmount: '15230.00', refundOn: today });
    // Credited is final.
    await http()
      .post(`/api/v1/itr/returns/${r.id}/refund`)
      .set(pa)
      .send({ version: r.version, to: 'pending' })
      .expect(400);
    const s = await season();
    expect(s.items.find((i) => i.returnId === r.id)?.refundStatus).toBe('issued');
  });

  it('a 143(1) demand opens a linked notice; a 245 set-off opens one too', async () => {
    const f = await itrFiling();
    let r = await open(f.instance);
    const filedOn = daysFrom(today, -20);
    await lodge(f.instance, filedOn, 'ACK-ITR-143');
    r = (await http().get(`/api/v1/itr/returns/${r.id}`).set(pa).expect(200)).body as ItrReturn;
    // A demand needs its amount; it cannot predate the filing.
    await http()
      .post(`/api/v1/itr/returns/${r.id}/intimation`)
      .set(pa)
      .send({
        version: r.version,
        kind: '143_1',
        result: 'demand',
        referenceNo: 'CPC/143/1',
        issuedOn: daysFrom(today, -3),
        receivedOn: today,
      })
      .expect(400);
    await http()
      .post(`/api/v1/itr/returns/${r.id}/intimation`)
      .set(pa)
      .send({
        version: r.version,
        kind: '143_1',
        result: 'demand',
        amount: '4200',
        referenceNo: 'CPC/143/1',
        issuedOn: daysFrom(filedOn, -1),
        receivedOn: today,
      })
      .expect(400);
    const ref143 = `CPC/143/${Date.now()}`;
    const res = (
      await http()
        .post(`/api/v1/itr/returns/${r.id}/intimation`)
        .set(pa)
        .send({
          version: r.version,
          kind: '143_1',
          result: 'demand',
          amount: '4200',
          referenceNo: ref143,
          issuedOn: daysFrom(today, -3),
          receivedOn: today,
        })
        .expect(200)
    ).body as RecordItrIntimationResult;
    expect(res.noticeId).toEqual(expect.any(String));
    expect(res.return).toMatchObject({
      stage: 'processed',
      intimationResult: 'demand',
      intimationAmount: '4200.00',
      intimationOn: daysFrom(today, -3),
    });
    expect(res.return.notices).toEqual([
      expect.objectContaining({ id: res.noticeId, referenceNo: ref143, typeCode: 'IT_143_1' }),
    ]);
    const notice = await su.query<{ itr_return_id: string; engagement_id: string }>(
      `SELECT itr_return_id, engagement_id FROM hsdg.notices WHERE id = $1`,
      [res.noticeId],
    );
    expect(notice.rows[0]).toEqual({ itr_return_id: r.id, engagement_id: f.engagement });

    const ref245 = `CPC/245/${Date.now()}`;
    const set = (
      await http()
        .post(`/api/v1/itr/returns/${r.id}/intimation`)
        .set(pa)
        .send({
          version: res.return.version,
          kind: '245',
          amount: '1800',
          referenceNo: ref245,
          issuedOn: daysFrom(today, -1),
          receivedOn: today,
        })
        .expect(200)
    ).body as RecordItrIntimationResult;
    expect(set.noticeId).toEqual(expect.any(String));
    expect(set.return.notices.map((n) => n.typeCode)).toEqual(['IT_143_1', 'IT_245']);
    // The 143(1) result stays as recorded.
    expect(set.return.intimationResult).toBe('demand');
  });

  it('a 143(1) refund determined puts a refund to follow, with no notice', async () => {
    const f = await itrFiling();
    let r = await open(f.instance);
    await lodge(f.instance, daysFrom(today, -10), 'ACK-ITR-RFD');
    r = (await http().get(`/api/v1/itr/returns/${r.id}`).set(pa).expect(200)).body as ItrReturn;
    const res = (
      await http()
        .post(`/api/v1/itr/returns/${r.id}/intimation`)
        .set(pa)
        .send({
          version: r.version,
          kind: '143_1',
          result: 'refund',
          amount: '9100',
          referenceNo: `CPC/R/${Date.now()}`,
          issuedOn: daysFrom(today, -2),
          receivedOn: today,
        })
        .expect(200)
    ).body as RecordItrIntimationResult;
    expect(res.noticeId).toBeNull();
    expect(res.return).toMatchObject({ refundStatus: 'pending', notices: [] });
  });

  it('reads a 26AS export and matches it with the client’s figures', async () => {
    const f = await itrFiling();
    const r = await open(f.instance);
    // Something that is not a statement is refused.
    await http()
      .post(`/api/v1/itr/returns/${r.id}/statements`)
      .set(pa)
      .send({
        source: '26as',
        filename: 'notes.txt',
        contentBase64: Buffer.from('hello there').toString('base64'),
      })
      .expect(400);
    const imp = (
      await http()
        .post(`/api/v1/itr/returns/${r.id}/statements`)
        .set(pa)
        .send({
          source: '26as',
          filename: '26AS.txt',
          contentBase64: Buffer.from(FORM_26AS).toString('base64'),
        })
        .expect(200)
    ).body as ImportItrStatementResult;
    expect(imp).toMatchObject({ source: '26as', imported: 4 });
    expect(imp.format).toMatch(/26AS/);
    // Re-importing replaces the source's lines rather than doubling them.
    await http()
      .post(`/api/v1/itr/returns/${r.id}/statements`)
      .set(pa)
      .send({
        source: '26as',
        filename: '26AS.txt',
        contentBase64: Buffer.from(FORM_26AS).toString('base64'),
      })
      .expect(200);

    let inc = (
      await http()
        .post(`/api/v1/itr/returns/${r.id}/lines`)
        .set(pa)
        .send({
          source: 'client',
          head: 'salary',
          payerName: 'Example Software Pvt Ltd',
          payerTan: 'mumx12345a',
          amount: '1200000',
          taxDeducted: '110000',
        })
        .expect(201)
    ).body as ItrIncome;
    expect(inc.lines.filter((l) => l.source === '26as')).toHaveLength(4);
    const salary = inc.matching.rows.find((m) => m.head === 'salary')!;
    expect(salary).toMatchObject({
      status: 'matched',
      payerTan: 'MUMX12345A',
      amounts: { '26as': '1200000.00', client: '1200000.00' },
    });
    const bank = inc.matching.rows.find((m) => m.payerTan === 'DELS54321B')!;
    expect(bank).toMatchObject({ status: 'not_in_client', amounts: { '26as': '45250.00' } });
    // What the client left out sorts first.
    expect(inc.matching.rows[0]!.status).toBe('not_in_client');

    // Classify the Part II line; remove the client's line.
    const partII = inc.lines.find((l) => l.payerTan === 'PNEX11111C')!;
    expect(partII.head).toBe('unclassified');
    inc = (
      await http()
        .patch(`/api/v1/itr/returns/${r.id}/lines/${partII.id}`)
        .set(pa)
        .send({ head: 'other_sources' })
        .expect(200)
    ).body as ItrIncome;
    expect(inc.lines.find((l) => l.id === partII.id)?.head).toBe('other_sources');
    const mine = inc.lines.find((l) => l.source === 'client')!;
    inc = (await http().delete(`/api/v1/itr/returns/${r.id}/lines/${mine.id}`).set(pa).expect(200))
      .body as ItrIncome;
    expect(inc.lines.some((l) => l.source === 'client')).toBe(false);
    const view = (await http().get(`/api/v1/itr/returns/${r.id}`).set(pa).expect(200))
      .body as ItrReturn;
    expect(view.lineCounts).toEqual({ '26as': 4 });
    // Outsiders cannot read the lines.
    await http().get(`/api/v1/itr/returns/${r.id}/income`).set(pb).expect(404);
  });
});
