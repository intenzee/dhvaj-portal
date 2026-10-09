import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { AuthorityProvisionRecord, AuthorityReference } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Authority / Provision Library versioning (02.2 spec §20 "effective dates and
 * version history"): a methodology administrator supersedes the current version
 * with a new dated one; the old one closes the day before and stays what an
 * earlier audit period resolves; the viewer lists every version.
 *
 * Uses its own provision code and reference context so shared seeds stay put.
 */
jest.setTimeout(30_000);

describe('Authority provisions — versions and supersession (e2e)', () => {
  let app: INestApplication;
  let mp: string; // Managing Partner — methodology administrator.
  let pa: string; // Partner A — no service administration.
  const suffix = `${Date.now()}`.slice(-8);
  const code = `E2E_PROV_${suffix}`;
  const context = '99.1';
  const anchor = `e2e_${suffix.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]!)}`;
  let v1Id: string;

  const token = async (email: string): Promise<string> =>
    (await request(app.getHttpServer()).post('/api/v1/auth/dev-token').send({ email }).expect(201))
      .body.accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const su = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    v1Id = await su(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO hsdg.authority_provision
           (code, authority, title, provision_number, effective_from, summary, source_url)
         VALUES ($1, 'MCA', 'E2E provision', 'Rule 4', '2015-04-01', 'Original wording.',
                 'https://www.mca.gov.in/v1')
         RETURNING id`,
        [code],
      );
      await c.query(
        `INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code)
         VALUES ($1, $2, 'View E2E provision', $3)`,
        [context, anchor, code],
      );
      return rows[0]!.id;
    });
  });

  afterAll(async () => {
    await su(async (c) => {
      await c.query(`DELETE FROM hsdg.authority_reference_link WHERE context_key = $1`, [context]);
      await c.query(`UPDATE hsdg.authority_provision SET superseded_by_id = NULL WHERE code = $1`, [
        code,
      ]);
      await c.query(`DELETE FROM hsdg.authority_provision WHERE code = $1`, [code]);
    });
    await app?.close();
  });

  const resolveOn = async (on: string): Promise<AuthorityProvisionRecord | null> => {
    const refs = (
      await request(app.getHttpServer())
        .get(`/api/v1/authority-provisions/references/${context}?on=${on}`)
        .set(bearer(pa))
        .expect(200)
    ).body as AuthorityReference[];
    return refs.find((r) => r.anchor === anchor)?.provision ?? null;
  };

  it('only a methodology administrator supersedes, with a later date and a change note', async () => {
    const http = app.getHttpServer();
    const url = `/api/v1/authority-provisions/${v1Id}/supersede`;
    await request(http)
      .post(url)
      .set(bearer(pa))
      .send({ effectiveFrom: '2024-04-01', changeNote: 'Amended.' })
      .expect(403);
    await request(http)
      .post(url)
      .set(bearer(mp))
      .send({ effectiveFrom: '2015-04-01', changeNote: 'Same day.' })
      .expect(400);
    await request(http)
      .post(url)
      .set(bearer(mp))
      .send({ effectiveFrom: '2024-04-01', changeNote: '' })
      .expect(400);
    await request(http)
      .post(url)
      .set(bearer(mp))
      .send({ effectiveFrom: '2024-02-30', changeNote: 'Not a date.' })
      .expect(400);
  });

  it('supersedes: the old version closes the day before and earlier periods keep it', async () => {
    const http = app.getHttpServer();
    const v2 = (
      await request(http)
        .post(`/api/v1/authority-provisions/${v1Id}/supersede`)
        .set(bearer(mp))
        .send({
          effectiveFrom: '2024-04-01',
          provisionNumber: 'Rule 4 (as amended)',
          sourceUrl: 'https://www.mca.gov.in/v2',
          changeNote: 'Substituted by the 2024 amendment rules.',
        })
        .expect(201)
    ).body as AuthorityProvisionRecord;
    expect(v2).toMatchObject({
      code,
      versionNo: 2,
      effectiveFrom: '2024-04-01',
      effectiveTo: null,
      provisionNumber: 'Rule 4 (as amended)',
      title: 'E2E provision', // blank → carried over
      summary: 'Original wording.',
      sourceUrl: 'https://www.mca.gov.in/v2',
      changeNote: 'Substituted by the 2024 amendment rules.',
    });

    const versions = (
      await request(http)
        .get(`/api/v1/authority-provisions/${code}/versions`)
        .set(bearer(pa))
        .expect(200)
    ).body as AuthorityProvisionRecord[];
    expect(versions.map((v) => [v.versionNo, v.effectiveFrom, v.effectiveTo])).toEqual([
      [2, '2024-04-01', null],
      [1, '2015-04-01', '2024-03-31'],
    ]);
    expect(versions[1]!.supersededById).toBe(v2.id);

    // Resolution by date — the last day of the old version is still the old one.
    expect((await resolveOn('2023-04-01'))?.versionNo).toBe(1);
    expect((await resolveOn('2024-03-31'))?.versionNo).toBe(1);
    expect((await resolveOn('2024-04-01'))?.versionNo).toBe(2);
    expect(await resolveOn('2014-04-01')).toBeNull();
    const direct = (
      await request(http)
        .get(`/api/v1/authority-provisions/${code}?on=2020-01-01`)
        .set(bearer(pa))
        .expect(200)
    ).body as AuthorityProvisionRecord;
    expect(direct.id).toBe(v1Id);

    // Only the current version can be superseded.
    await request(http)
      .post(`/api/v1/authority-provisions/${v1Id}/supersede`)
      .set(bearer(mp))
      .send({ effectiveFrom: '2025-04-01', changeNote: 'Again.' })
      .expect(409);
    await request(http)
      .post(`/api/v1/authority-provisions/${v2.id}/supersede`)
      .set(bearer(mp))
      .send({ effectiveFrom: '2025-04-01', changeNote: 'Third version.' })
      .expect(201);
    expect((await resolveOn('2025-06-30'))?.versionNo).toBe(3);
    expect((await resolveOn('2024-06-30'))?.versionNo).toBe(2);
  });

  it('records the supersession in the audit trail', async () => {
    const n = await su(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hsdg.audit_events
          WHERE action = 'authority.provision_superseded' AND after_state->>'code' = $1`,
        [code],
      );
      return Number(rows[0]!.n);
    });
    expect(n).toBe(2);
  });

  it('an unknown code has no history', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/authority-provisions/E2E_NO_SUCH_CODE/versions')
      .set(bearer(pa))
      .expect(404);
  });
});
