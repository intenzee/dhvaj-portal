import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * F-4 — the Form 3CD clause library. Version 1 holds every clause of the
 * form; Admin and the Managing Partner change the library on one draft and
 * publish it as the next version, and a whole new form loads as data. A
 * published version never changes, not even by a direct write.
 */
describe('Tax audit clause library (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: Record<string, string>;
  let admin: Record<string, string>;
  let senior: Record<string, string>;
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const base = '/api/v1/tax-audit-clause-library';

  interface View {
    versions: {
      versionNo: number;
      status: string;
      act: string;
      clauseCount: number;
      version: number;
    }[];
    selected: {
      id: string;
      versionNo: number;
      status: string;
      basedOnVersionNo: number | null;
      version: number;
    } | null;
    clauses: {
      id: string;
      clauseNo: string;
      title: string;
      appliesWhen: unknown;
      defaultGrade: string;
    }[];
  }

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    // An earlier run may have left a draft behind.
    await su.query(`DELETE FROM hsdg.tax_audit_clause_library_versions WHERE status = 'draft'`);
    mp = await as('mp@dhvaj.in');
    admin = await as('admin@dhvaj.in');
    senior = await as('senior.y@dhvaj.in');
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('version 1 is published and holds every Form 3CD clause, readable by everyone', async () => {
    const res = await http().get(`${base}?version=1`).set(senior).expect(200);
    const v = res.body as View;
    expect(v.selected).toMatchObject({ versionNo: 1, status: 'published' });
    const numbers = v.clauses.map((c) => c.clauseNo);
    expect(numbers).toHaveLength(60);
    expect(numbers.slice(0, 10)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '8a', '9']);
    expect(numbers.at(-1)).toBe('44');
    for (const n of [
      '21(d)',
      '26',
      '29A',
      '29B',
      '30A',
      '30B',
      '30C',
      '31',
      '34',
      '35(b)',
      '36A',
    ]) {
      expect(numbers).toContain(n);
    }
    expect(v.clauses.find((c) => c.clauseNo === '31')).toMatchObject({
      appliesWhen: { fact: 'loansOrDeposits', is: true },
      defaultGrade: 'article',
    });
  });

  it('only Admin and the Managing Partner change it', async () => {
    await http()
      .post(`${base}/drafts`)
      .set(senior)
      .send({ label: 'Mine', act: '1961', appliesFromFy: '2026-27' })
      .expect(403);
  });

  it('a draft copies the newest version, takes changes, and publishes as the next version', async () => {
    const draft = (
      await http()
        .post(`${base}/drafts`)
        .set(mp)
        .send({
          label: 'Form 3CD — 2027 amendment',
          act: '1961',
          appliesFromFy: '2026-27',
          basedOnVersionNo: 1,
        })
        .expect(201)
    ).body as View;
    const no = draft.selected!.versionNo;
    expect(draft.selected).toMatchObject({ status: 'draft', basedOnVersionNo: 1 });
    expect(draft.clauses).toHaveLength(60);

    // One draft at a time.
    await http()
      .post(`${base}/drafts`)
      .set(admin)
      .send({ label: 'Another', act: '1961', appliesFromFy: '2026-27' })
      .expect(409);

    const c44 = draft.clauses.find((c) => c.clauseNo === '44')!;
    const body = {
      clauseNo: '44',
      part: 'B',
      title: 'Break-up of expenditure by GST status of the supplier',
      subItems: [{ key: 'breakup', label: 'Break-up', kind: 'table' }],
      appliesWhen: { fact: 'gstRegistered', is: true },
      notApplicableReason: null,
      defaultPackage: 'gst_breakup',
      defaultGrade: 'article',
      evidence: ['Purchase register'],
      draftSource: 'gst_filings',
      partnerReview: false,
      sortOrder: 600,
    };
    // A condition needs its Not applicable reason; an unknown fact is refused.
    await http().put(`${base}/${no}/clauses/${c44.id}`).set(mp).send(body).expect(400);
    await http()
      .put(`${base}/${no}/clauses/${c44.id}`)
      .set(mp)
      .send({ ...body, appliesWhen: { fact: 'hasYacht', is: true }, notApplicableReason: 'x' })
      .expect(400);
    await http()
      .put(`${base}/${no}/clauses/${c44.id}`)
      .set(mp)
      .send({ ...body, notApplicableReason: 'Not registered under GST.' })
      .expect(200);

    const added = (
      await http()
        .post(`${base}/${no}/clauses`)
        .set(admin)
        .send({ ...body, clauseNo: '45', title: 'A new clause', appliesWhen: null, sortOrder: 610 })
        .expect(201)
    ).body as View;
    expect(added.clauses.at(-1)).toMatchObject({ clauseNo: '45' });
    await http()
      .post(`${base}/${no}/clauses`)
      .set(admin)
      .send({ ...body, clauseNo: '45', appliesWhen: null })
      .expect(409);
    const c45 = added.clauses.find((c) => c.clauseNo === '45')!;
    await http().delete(`${base}/${no}/clauses/${c45.id}`).set(admin).expect(200);

    const published = (await http().post(`${base}/${no}/publish`).set(mp).expect(201)).body as View;
    expect(published.selected).toMatchObject({ versionNo: no, status: 'published' });
    expect(published.clauses.find((c) => c.clauseNo === '44')).toMatchObject({
      title: 'Break-up of expenditure by GST status of the supplier',
    });

    // Published: no change through the API, nor by a direct write.
    await http()
      .put(`${base}/${no}/clauses/${c44.id}`)
      .set(mp)
      .send({ ...body, notApplicableReason: 'x' })
      .expect(409);
    await expect(
      su.query(`UPDATE hsdg.tax_audit_clause_library SET title = 'x' WHERE id = $1`, [c44.id]),
    ).rejects.toThrow(/published Form 3CD library version/);
    await expect(
      su.query(`DELETE FROM hsdg.tax_audit_clause_library_versions WHERE version_no = 1`),
    ).rejects.toThrow(/cannot be deleted/);

    const { rows } = await su.query<{ action: string }>(
      `SELECT action FROM hsdg.audit_events
        WHERE object_type = 'tax_audit_clause_library_version' AND object_id = $1
        ORDER BY occurred_at`,
      [published.selected!.id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'tax_audit_library.draft_created',
      'tax_audit_library.published',
    ]);
  });

  it('a new form loads as data, and an audit year finds its version', async () => {
    const res = await http()
      .post(`${base}/drafts`)
      .set(admin)
      .send({
        label: 'Tax audit report — Income-tax Act 2025',
        act: '2025',
        appliesFromFy: '2030-31',
        clauses: [
          {
            clauseNo: '2',
            part: 'A',
            title: 'Address',
            subItems: [{ key: 'address', label: 'Address', kind: 'text' }],
            appliesWhen: null,
            notApplicableReason: null,
            defaultPackage: 'general',
            defaultGrade: 'manager',
            evidence: [],
            draftSource: 'client_master',
            partnerReview: false,
            sortOrder: 20,
          },
          {
            clauseNo: '1',
            part: 'A',
            title: 'Name',
            subItems: [{ key: 'name', label: 'Name', kind: 'text' }],
            appliesWhen: null,
            notApplicableReason: null,
            defaultPackage: 'general',
            defaultGrade: 'manager',
            evidence: [],
            draftSource: 'client_master',
            partnerReview: false,
            sortOrder: 10,
          },
        ],
      })
      .expect(201);
    const v = res.body as View;
    expect(v.selected).toMatchObject({ status: 'draft', basedOnVersionNo: null });
    expect(v.clauses.map((c) => c.clauseNo)).toEqual(['1', '2']);
    await http().post(`${base}/${v.selected!.versionNo}/publish`).set(admin).expect(201);

    const forYear = async (fy: string) =>
      (
        await su.query<{ act: string }>(
          `SELECT act FROM hsdg.tax_audit_clause_library_versions
            WHERE status = 'published' AND applies_from_fy <= $1
            ORDER BY applies_from_fy DESC, version_no DESC LIMIT 1`,
          [fy],
        )
      ).rows[0]?.act;
    expect(await forYear('2025-26')).toBe('1961');
    expect(await forYear('2030-31')).toBe('2025');
  });

  it('an import with a clause listed twice is refused whole', async () => {
    const one = {
      clauseNo: '1',
      part: 'A',
      title: 'Name',
      subItems: [],
      appliesWhen: null,
      notApplicableReason: null,
      defaultPackage: 'general',
      defaultGrade: 'manager',
      evidence: [],
      draftSource: null,
      partnerReview: false,
      sortOrder: 10,
    };
    const res = await http()
      .post(`${base}/drafts`)
      .set(admin)
      .send({ label: 'Bad', act: '2025', appliesFromFy: '2031-32', clauses: [one, one] })
      .expect(400);
    expect(res.body.message).toContain('Clause 1 is listed twice.');
  });
});
