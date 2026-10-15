import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { SearchResponse } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Staff Workflow · Questions for the partners — "which clients does an article
 * see?" With 'office' an article sees their office's clients; with
 * 'engagements', only the clients of engagements they are on — in the client
 * list, a client's page and search alike (RLS).
 */
describe('Article client scope (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let mx: string;
  let art: string;
  let onTeam: string;
  let officeOnly: string;
  const tag = `Scope${Date.now()}`;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const scope = async (articleClientScope: 'office' | 'engagements') => {
    const { version } = (await http().get('/api/v1/workflow-settings').set(bearer(mp)).expect(200))
      .body as { version: number };
    await http()
      .patch('/api/v1/workflow-settings')
      .set(bearer(mp))
      .send({ version, articleClientScope })
      .expect(200);
  };
  const listed = async (t: string): Promise<string[]> =>
    (
      (await http().get(`/api/v1/entities?search=${tag}&limit=100`).set(bearer(t)).expect(200))
        .body as { items: { id: string }[] }
    ).items.map((e) => e.id);
  const searched = async (t: string): Promise<string[]> =>
    (
      (await http().get(`/api/v1/search?q=${tag}`).set(bearer(t)).expect(200))
        .body as SearchResponse
    ).groups.flatMap((g) => g.items.map((i) => i.id));

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');

    // An article in North with a login, linked to the seeded Article North.
    const email = `article.${Date.now()}@dhvaj.in`;
    const user = await http()
      .post('/api/v1/users')
      .set(bearer(await token('admin@dhvaj.in')))
      .send({ email, displayName: 'Article North', officeCode: 'NORTH', roles: ['article'] })
      .expect(201);
    const emp = (
      await su.query<{ id: string }>(
        `UPDATE hsdg.employees SET user_id = $1 WHERE employee_code = 'EMP007' RETURNING id`,
        [user.body.id],
      )
    ).rows[0]!.id;
    art = await token(email);

    // Two North clients: one with an engagement the article is on, one without.
    const entity = async (name: string): Promise<string> =>
      (
        await http()
          .post('/api/v1/entities')
          .set(bearer(pa))
          .send({ legalName: `${tag} ${name}`, typeSlug: 'private_limited', officeCode: 'NORTH' })
          .expect(201)
      ).body.id as string;
    onTeam = await entity('Team Client');
    officeOnly = await entity('Office Client');
    const service = (
      await http().get('/api/v1/services?search=STAT_AUDIT&limit=100').set(bearer(pa)).expect(200)
    ).body.items[0].id as string;
    const eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId: onTeam,
          serviceId: service,
          financialYear: '2024-25',
          periodLabel: tag,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    await su.query(
      `INSERT INTO hsdg.engagement_team (engagement_id, employee_id) VALUES ($1, $2)`,
      [eng, emp],
    );
  });

  afterAll(async () => {
    try {
      if (mp) await scope('office');
    } finally {
      await su?.end();
      await app?.close();
    }
  });

  it("'office': an article sees every client of their office", async () => {
    await scope('office');
    expect((await listed(art)).sort()).toEqual([onTeam, officeOnly].sort());
    await http().get(`/api/v1/entities/${officeOnly}`).set(bearer(art)).expect(200);
    expect(await searched(art)).toEqual(expect.arrayContaining([onTeam, officeOnly]));
  });

  it("'engagements': only the clients of engagements they are on", async () => {
    await scope('engagements');
    expect(await listed(art)).toEqual([onTeam]);
    await http().get(`/api/v1/entities/${onTeam}`).set(bearer(art)).expect(200);
    await http().get(`/api/v1/entities/${officeOnly}`).set(bearer(art)).expect(404);
    const hits = await searched(art);
    expect(hits).toContain(onTeam);
    expect(hits).not.toContain(officeOnly);
    // Other roles are not affected: Manager X (North) still sees both.
    expect((await listed(mx)).sort()).toEqual([onTeam, officeOnly].sort());
  });
});
