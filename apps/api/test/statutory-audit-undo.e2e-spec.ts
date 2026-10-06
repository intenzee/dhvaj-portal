import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  AuditCompletionItem,
  AuditPbcItem,
  AuditUndoResult,
  AuditUndoStatus,
  StatutoryAuditCompletion,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Audit file undo / redo — every click on the file is one step the person who
 * made it can take back and put back, never over someone else's later change.
 */
describe('Statutory Audit — undo / redo (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let pb: string;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(url).set(bearer(t)).send(body);
  const get = (t: string, url: string) =>
    request(app.getHttpServer()).get(url).set(bearer(t)).expect(200);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('undoes and redoes one click at a time, and refuses over a later change', async () => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Undo Seed ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: itr,
      financialYear: '2024-25',
      periodLabel: `P${stamp()}`,
      status: 'accepted',
    }).expect(201);
    const engId = eng.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    const shellId = (await get(pa, base)).body[0].workflowInstanceId as string;

    const status = async (t = pa): Promise<AuditUndoStatus> =>
      (await get(t, `${base}/undo`)).body as AuditUndoStatus;
    const readItem = async (key: string): Promise<AuditCompletionItem> =>
      ((await get(pa, `${base}/completion`)).body[0] as StatutoryAuditCompletion).items.find(
        (i) => i.itemKey === key,
      )!;

    // Opening the file is not an action — nothing to undo yet.
    const before = await readItem('caro');
    expect(await status()).toEqual({ undo: null, redo: null });

    // One click: mark a checklist item complete.
    await post(pa, `${base}/completion/items/${before.id}`, {
      state: 'complete',
      note: 'Done.',
      version: before.version,
    }).expect(201);
    let s = await status();
    expect(s.undo?.description).toBe('Update a completion / reporting checklist item');
    expect(s.redo).toBeNull();

    // Another person sees nothing of it.
    expect(await status(pb)).toEqual({ undo: null, redo: null });

    // Undo puts it back exactly; redo puts the change back.
    let res = (await post(pa, `${base}/undo`).expect(201)).body as AuditUndoResult;
    expect(res.applied.description).toBe('Update a completion / reporting checklist item');
    expect(res.undo).toBeNull();
    expect(res.redo?.id).toBe(res.applied.id);
    let item = await readItem('caro');
    expect(item).toMatchObject({ state: before.state, note: before.note });
    expect(item.version).toBeGreaterThan(before.version);

    res = (await post(pa, `${base}/redo`).expect(201)).body as AuditUndoResult;
    expect(res.redo).toBeNull();
    item = await readItem('caro');
    expect(item).toMatchObject({ state: 'complete', note: 'Done.' });

    // Add then delete a PBC request; undoing the delete brings it back.
    const added = await post(pa, `${base}/${shellId}/pbc`, {
      requirement: 'Bank confirmations',
    }).expect(201);
    const pbcItem = (added.body.items as AuditPbcItem[]).find(
      (i) => i.requirement === 'Bank confirmations',
    )!;
    await request(app.getHttpServer())
      .delete(`${base}/pbc/${pbcItem.id}`)
      .set(bearer(pa))
      .expect(200);
    s = await status();
    expect(s.undo?.description).toBe('Delete a PBC request');
    await post(pa, `${base}/undo`).expect(201);
    let pbc = (await get(pa, `${base}/pbc`)).body[0].items as AuditPbcItem[];
    expect(pbc.map((i) => i.id)).toContain(pbcItem.id);

    // Undo the add too: it is gone. A new action clears the redo stack.
    await post(pa, `${base}/undo`).expect(201);
    pbc = (await get(pa, `${base}/pbc`)).body[0].items as AuditPbcItem[];
    expect(pbc.map((i) => i.id)).not.toContain(pbcItem.id);
    expect((await status()).redo?.description).toBe('Add a PBC request');
    const fresh = await readItem('ifc');
    await post(pa, `${base}/completion/items/${fresh.id}`, {
      state: 'in_progress',
      version: fresh.version,
    }).expect(201);
    expect((await status()).redo).toBeNull();
    await post(pa, `${base}/redo`).expect(409);

    // A later change by someone else blocks the undo, and nothing is touched.
    const mine = await readItem('ifc');
    await post(mp, `${base}/completion/items/${mine.id}`, {
      state: 'complete',
      note: 'Managing partner closed it.',
      version: mine.version,
    }).expect(201);
    const blocked = await post(pa, `${base}/undo`).expect(409);
    expect(blocked.body.message).toMatch(/changed since/);
    expect(await readItem('ifc')).toMatchObject({
      state: 'complete',
      note: 'Managing partner closed it.',
    });

    // An outsider cannot undo on this file.
    const outsider = await post(pb, `${base}/undo`);
    expect([403, 404, 409]).toContain(outsider.status);
  });
});
