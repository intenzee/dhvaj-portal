import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Section-wise views — "GST only", "Income Tax only", … `?section=` on My
 * Work tasks: a stream matches through the task's engagement service, and
 * Statutory Audit / Assignments through the engagement's kind.
 */
describe('Work sections (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let sy: string;
  let seniorY: string;
  const ids: Record<'gst' | 'it' | 'plain' | 'sa' | 'asg', string> = {
    gst: '',
    it: '',
    plain: '',
    sa: '',
    asg: '',
  };
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const entityId = async (search: string): Promise<string> => {
    const res = await http().get(`/api/v1/entities?search=${search}&limit=100`).set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const serviceId = async (code: string): Promise<string> => {
    const res = await http().get(`/api/v1/services?search=${code}&limit=100`).set(bearer(mp));
    return (res.body.items as Array<{ id: string; code: string }>).find((s) => s.code === code)!.id;
  };
  const create = async (body: Record<string, unknown>): Promise<string> => {
    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({ status: 'accepted', financialYear: '2026-27', ...body })
      .expect(201);
    const id = res.body.id as string;
    await http()
      .post(`/api/v1/engagements/${id}/team`)
      .set(bearer(pa))
      .send({ employeeId: seniorY, roleOnEngagement: 'in_charge' })
      .expect(201);
    return id;
  };
  // Due long ago, so they sort ahead of the senior's other tasks.
  const task = async (eng: string, title: string, due: string, extra = {}): Promise<string> => {
    const res = await http()
      .post(`/api/v1/engagements/${eng}/tasks`)
      .set(bearer(pa))
      .send({ title, assignedToEmployeeId: seniorY, dueDate: due, ...extra })
      .expect(201);
    return res.body.id as string;
  };
  const mine = async (query: string): Promise<string[]> => {
    const res = await http()
      .get(`/api/v1/work/tasks?limit=100${query}`)
      .set(bearer(sy))
      .expect(200);
    const all = Object.values(ids);
    return (res.body.items as Array<{ id: string }>)
      .map((t) => t.id)
      .filter((id) => all.includes(id));
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    const emps = await http().get('/api/v1/employees?limit=100').set(bearer(mp)).expect(200);
    seniorY = (emps.body.items as Array<{ employeeCode: string; id: string }>).find(
      (e) => e.employeeCode === 'EMP006',
    )!.id;
    const acme = await entityId('Acme');
    const bharat = await entityId('Bharat');

    const cr = await create({
      kind: 'compliance',
      entityId: await freshClient(acme),
      streams: ['gst', 'income_tax'],
    });
    const detail = await http().get(`/api/v1/engagements/${cr}`).set(bearer(pa)).expect(200);
    const line = (stream: string) =>
      (detail.body.services as Array<{ id: string; stream: string | null }>).find(
        (s) => s.stream === stream,
      )!.id;
    ids.gst = await task(cr, 'GSTR-3B workings', '2001-01-01', {
      engagementServiceId: line('gst'),
    });
    ids.it = await task(cr, 'ITR computation', '2001-01-02', {
      engagementServiceId: line('income_tax'),
    });
    ids.plain = await task(cr, 'Client call', '2001-01-03');

    const sa = await create({ kind: 'statutory_audit', entityId: await freshClient(acme) });
    ids.sa = await task(sa, 'Audit planning memo', '2001-01-04');
    const asg = await create({
      kind: 'assignment',
      entityId: await freshClient(bharat),
      serviceId: await serviceId('TAX_AUDIT'),
    });
    ids.asg = await task(asg, 'Form 3CD draft', '2001-01-05');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows every section when none is picked', async () => {
    expect(await mine('')).toEqual([ids.gst, ids.it, ids.plain, ids.sa, ids.asg]);
  });

  it('GST only — a stream matches through the task’s engagement service', async () => {
    expect(await mine('&section=gst')).toEqual([ids.gst]);
    expect(await mine('&section=income_tax')).toEqual([ids.it]);
    expect(await mine('&section=roc')).toEqual([]);
  });

  it('Statutory Audit and Assignments match through the engagement’s kind', async () => {
    expect(await mine('&section=statutory_audit')).toEqual([ids.sa]);
    expect(await mine('&section=assignment')).toEqual([ids.asg]);
  });

  it('takes a comma list (any-of), and the total follows the filter', async () => {
    expect(await mine('&section=income_tax,statutory_audit')).toEqual([ids.it, ids.sa]);
    const res = await http()
      .get('/api/v1/work/tasks?limit=1&section=gst,assignment')
      .set(bearer(sy))
      .expect(200);
    const all = await http().get('/api/v1/work/tasks?limit=1').set(bearer(sy)).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.total).toBeLessThan(all.body.total);
  });

  it('refuses an unknown section', async () => {
    await http().get('/api/v1/work/tasks?section=vat').set(bearer(sy)).expect(400);
  });
});
