import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Section-wise views, Track A: `?section=` (any-of, comma list) on the client
 * and engagement lists. A client is in a section while it has a live
 * engagement there; an engagement is in a section by a stream it covers or by
 * its kind (Statutory Audit, Assignments). Unknown keys are a 400.
 */
describe('Sections on clients and engagements (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  const stamp = `SEC${Date.now().toString().slice(-7)}`;
  const ids: Record<'gst' | 'audit' | 'assignment' | 'closed', { entity: string; eng: string }> =
    {} as never;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const serviceId = async (code: string): Promise<string> => {
    const res = await http()
      .get(`/api/v1/services?search=${code}&limit=100`)
      .set(bearer(mp))
      .expect(200);
    return (res.body.items as Array<{ id: string; code: string }>).find((s) => s.code === code)!.id;
  };
  const client = async (name: string): Promise<string> => {
    const res = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({ legalName: `${stamp} ${name}`, typeSlug: 'private_limited', officeCode: 'NORTH' })
      .expect(201);
    return res.body.id as string;
  };
  const engage = async (body: Record<string, unknown>): Promise<string> => {
    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({ status: 'accepted', financialYear: '2026-27', ...body })
      .expect(201);
    return res.body.id as string;
  };
  const clients = async (section?: string): Promise<string[]> => {
    const res = await http()
      .get(`/api/v1/entities?search=${stamp}&limit=100${section ? `&section=${section}` : ''}`)
      .set(bearer(pa))
      .expect(200);
    return (res.body.items as Array<{ id: string }>).map((e) => e.id).sort();
  };
  const engagements = async (query: string): Promise<{ ids: string[]; total: number }> => {
    const res = await http()
      .get(`/api/v1/engagements?search=${stamp}&limit=100&${query}`)
      .set(bearer(pa))
      .expect(200);
    return {
      ids: (res.body.items as Array<{ id: string }>).map((e) => e.id).sort(),
      total: res.body.total as number,
    };
  };
  const sorted = (...xs: string[]): string[] => [...xs].sort();

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');

    const gst = await client('GST Traders');
    ids.gst = {
      entity: gst,
      eng: await engage({ kind: 'compliance', entityId: gst, streams: ['gst'] }),
    };
    const audit = await client('Audited Co');
    ids.audit = { entity: audit, eng: await engage({ kind: 'statutory_audit', entityId: audit }) };
    const asg = await client('Assignment Co');
    ids.assignment = {
      entity: asg,
      eng: await engage({
        kind: 'assignment',
        entityId: asg,
        serviceId: await serviceId('TAX_AUDIT'),
      }),
    };
    // A client whose only GST engagement has ended is no longer in GST.
    const closed = await client('Former GST Client');
    ids.closed = {
      entity: closed,
      eng: await engage({ kind: 'compliance', entityId: closed, streams: ['gst'] }),
    };
    await su.query(`UPDATE hsdg.engagements SET status = 'cancelled' WHERE id = $1`, [
      ids.closed.eng,
    ]);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  describe('GET /entities?section=', () => {
    it('lists every client with no section', async () => {
      expect(await clients()).toEqual(
        sorted(ids.gst.entity, ids.audit.entity, ids.assignment.entity, ids.closed.entity),
      );
    });

    it('GST only: the client with a live GST engagement', async () => {
      expect(await clients('gst')).toEqual([ids.gst.entity]);
    });

    it('Statutory Audit only, and Assignments only', async () => {
      expect(await clients('statutory_audit')).toEqual([ids.audit.entity]);
      expect(await clients('assignment')).toEqual([ids.assignment.entity]);
    });

    it('a comma list is any-of', async () => {
      expect(await clients('gst,statutory_audit')).toEqual(
        sorted(ids.gst.entity, ids.audit.entity),
      );
    });

    it('a section with none of them is empty', async () => {
      expect(await clients('roc')).toEqual([]);
    });

    it('rejects an unknown section', async () => {
      await http().get('/api/v1/entities?section=gst,vat').set(bearer(pa)).expect(400);
    });
  });

  describe('GET /engagements?section=', () => {
    it('GST only, with a total that matches', async () => {
      // The cancelled one is still a GST engagement; the status chip hides it.
      expect(await engagements('section=gst')).toEqual({
        ids: sorted(ids.gst.eng, ids.closed.eng),
        total: 2,
      });
      expect(await engagements('section=gst&status=accepted')).toEqual({
        ids: [ids.gst.eng],
        total: 1,
      });
    });

    it('by kind: Statutory Audit, Assignments; and a comma list', async () => {
      expect((await engagements('section=statutory_audit')).ids).toEqual([ids.audit.eng]);
      expect((await engagements('section=assignment')).ids).toEqual([ids.assignment.eng]);
      expect(await engagements('section=statutory_audit,assignment')).toEqual({
        ids: sorted(ids.audit.eng, ids.assignment.eng),
        total: 2,
      });
    });

    it('combines with mine', async () => {
      expect((await engagements('mine=true&section=statutory_audit')).ids).toEqual([ids.audit.eng]);
    });

    it('rejects an unknown section', async () => {
      await http().get('/api/v1/engagements?section=audit').set(bearer(pa)).expect(400);
    });
  });
});
