import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Component work generation (spec §21–§22, §36), through the HTTP API.
 *
 * Headline acceptance: a configured recurring component generates one instance
 * per period of the engagement's financial year; re-running never duplicates
 * (idempotent); a linked compliance rule stamps each period's deadline
 * (snapshotting the version); instances transition (complete); role/RLS
 * negatives hold.
 */
describe('Component Work Generation (e2e)', () => {
  let app: INestApplication;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp));
    return res.body.items[0].id as string;
  };

  const createEngagement = async (
    epToken: string,
    serviceCode = 'GST_MONTHLY',
  ): Promise<string> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId(`/api/v1/services?search=${serviceCode}&limit=100`);
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `W${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  const configure = async (
    t: string,
    engId: string,
    serviceComponentCode: string,
  ): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components`)
      .set(bearer(t))
      .send({ serviceComponentCode })
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates 12 monthly instances for the FY, idempotently', async () => {
    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    const componentId = await configure(pa, engId, 'GSTR1'); // monthly

    const gen = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/instances/generate`)
      .set(bearer(pa))
      .expect(201);
    expect(gen.body.generated).toHaveLength(12);
    expect(gen.body.skipped).toHaveLength(0);
    const keys = gen.body.generated.map((i: { periodKey: string }) => i.periodKey).sort();
    expect(keys[0]).toBe('2026-04');
    expect(keys[11]).toBe('2027-03');

    // Re-running is idempotent — nothing new, all 12 skipped.
    const again = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/instances/generate`)
      .set(bearer(pa))
      .expect(201);
    expect(again.body.generated).toHaveLength(0);
    expect(again.body.skipped).toHaveLength(12);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/components/${componentId}/instances?limit=50`)
      .set(bearer(pa))
      .expect(200);
    expect(list.body.total).toBe(12);
  });

  it('stamps each period’s deadline from the linked compliance rule (snapshot)', async () => {
    // month_end basis, +20 days → the 20th after each month end.
    const ruleCode = `WK_${unique()}`;
    const rule = await request(app.getHttpServer())
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code: ruleCode, name: 'Monthly filing', category: 'gst' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/compliance-rules/${rule.body.id}/versions`)
      .set(bearer(mp))
      .send({
        effectiveFrom: '2020-04-01',
        calculationBasis: 'month_end',
        offsetDays: 20,
        internalSlaOffsetDays: 5,
      })
      .expect(201);

    const compCode = `WC_${unique()}`;
    await request(app.getHttpServer())
      .post('/api/v1/service-components')
      .set(bearer(mp))
      .send({
        serviceCode: 'GST_MONTHLY',
        code: compCode,
        name: 'Linked monthly',
        defaultFrequency: 'monthly',
        complianceRuleCode: ruleCode,
      })
      .expect(201);

    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    const componentId = await configure(pa, engId, compCode);

    const gen = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/instances/generate`)
      .set(bearer(pa))
      .expect(201);
    const april = gen.body.generated.find((i: { periodKey: string }) => i.periodKey === '2026-04');
    // month_end(30 Apr 2026) + 20 days = 20 May 2026; SLA 5 days earlier.
    expect(april.statutoryDeadline).toBe('2026-05-20');
    expect(april.internalSlaDate).toBe('2026-05-15');
    expect(april.complianceRuleVersionId).toBeTruthy();
  });

  it('completes an instance (status + completedAt)', async () => {
    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    const componentId = await configure(pa, engId, 'GSTR1');
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/instances/generate`)
      .set(bearer(pa))
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/component-work?limit=50`)
      .set(bearer(pa))
      .expect(200);
    expect(list.body.total).toBe(12);
    const instanceId = list.body.items[0].id as string;

    const done = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/component-work/${instanceId}/status`)
      .set(bearer(pa))
      .send({ status: 'completed' })
      .expect(201);
    expect(done.body.status).toBe('completed');
    expect(done.body.completedAt).toBeTruthy();
  });

  it('bulk-generates work for all live components on the engagement', async () => {
    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    await configure(pa, engId, 'GSTR1'); // monthly → 12
    await configure(pa, engId, 'GSTR3B'); // monthly → 12

    const gen = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/component-work/generate`)
      .set(bearer(pa))
      .expect(201);
    expect(gen.body.generated.length).toBe(24);
  });

  it('reconciles work to the active window — narrowing removes, widening revives', async () => {
    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    const componentId = await configure(pa, engId, 'ITC_RECON'); // monthly
    const gen = (): request.Test =>
      request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/components/${componentId}/instances/generate`)
        .set(bearer(pa));
    const liveCount = async (): Promise<number> => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${engId}/components/${componentId}/instances?limit=100`)
        .set(bearer(pa));
      return res.body.items.filter((i: { status: string }) => i.status !== 'cancelled').length;
    };

    // Full year → 12 live.
    expect((await gen().expect(201)).body.generated).toHaveLength(12);
    expect(await liveCount()).toBe(12);

    // Narrow to Apr–Jun → the other 9 months are removed (cancelled), 3 live.
    await request(app.getHttpServer())
      .patch(`/api/v1/engagements/${engId}/components/${componentId}`)
      .set(bearer(pa))
      .send({ startDate: '2026-04-01', endDate: '2026-06-30' })
      .expect(200);
    const narrowed = await gen().expect(201);
    expect(narrowed.body.removed).toHaveLength(9);
    expect(narrowed.body.generated).toHaveLength(0);
    expect(await liveCount()).toBe(3);

    // Widen back to open-ended → the 9 revive, 12 live again (no duplicates).
    await request(app.getHttpServer())
      .patch(`/api/v1/engagements/${engId}/components/${componentId}`)
      .set(bearer(pa))
      .send({ startDate: null, endDate: null })
      .expect(200);
    const widened = await gen().expect(201);
    expect(widened.body.generated).toHaveLength(9);
    expect(await liveCount()).toBe(12);
  });

  it('removing a scope cancels its pending work but preserves completed work', async () => {
    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    const componentId = await configure(pa, engId, 'GSTR1'); // monthly → 12
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/instances/generate`)
      .set(bearer(pa))
      .expect(201);

    // Complete one instance — it must survive removal (filed work is history, §25).
    const list = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/components/${componentId}/instances?limit=50`)
      .set(bearer(pa));
    const firstId = list.body.items[0].id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/component-work/${firstId}/status`)
      .set(bearer(pa))
      .send({ status: 'completed' })
      .expect(201);

    // Remove the scope.
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/remove`)
      .set(bearer(pa))
      .send({ reason: 'out of scope' })
      .expect(201);

    // The 11 pending instances are cancelled; the 1 completed is preserved.
    const after = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/components/${componentId}/instances?limit=50`)
      .set(bearer(pa));
    const statuses = after.body.items.map((i: { status: string }) => i.status);
    expect(statuses.filter((s: string) => s === 'completed')).toHaveLength(1);
    expect(statuses.filter((s: string) => s === 'cancelled')).toHaveLength(11);
    expect(statuses.filter((s: string) => s === 'scheduled')).toHaveLength(0);
  });

  it('changing frequency with existing work supersedes the config + pending work, versions a new one', async () => {
    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    const componentId = await configure(pa, engId, 'GSTR1'); // monthly
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/instances/generate`)
      .set(bearer(pa))
      .expect(201);

    // Complete one monthly instance — it must survive the supersession (history).
    const before = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/components/${componentId}/instances?limit=50`)
      .set(bearer(pa));
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/component-work/${before.body.items[0].id}/status`)
      .set(bearer(pa))
      .send({ status: 'completed' })
      .expect(201);

    // Change monthly → quarterly.
    const changed = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/change-frequency`)
      .set(bearer(pa))
      .send({ frequency: 'quarterly' })
      .expect(201);
    const newId = changed.body.id as string;
    expect(newId).not.toBe(componentId);
    expect(changed.body.frequency).toBe('quarterly');
    expect(changed.body.status).not.toBe('superseded');

    // Old config is superseded and points to the new version.
    const cfgList = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/components?limit=100`)
      .set(bearer(pa));
    const oldCfg = cfgList.body.items.find((c: { id: string }) => c.id === componentId);
    expect(oldCfg.status).toBe('superseded');
    expect(oldCfg.supersededById).toBe(newId);

    // Old pending work is superseded (11); the completed one is preserved.
    const oldWork = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/components/${componentId}/instances?limit=50`)
      .set(bearer(pa));
    const st = oldWork.body.items.map((i: { status: string }) => i.status);
    expect(st.filter((s: string) => s === 'completed')).toHaveLength(1);
    expect(st.filter((s: string) => s === 'superseded')).toHaveLength(11);

    // The new quarterly version generates 4 fresh periods.
    const gen = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${newId}/instances/generate`)
      .set(bearer(pa))
      .expect(201);
    expect(gen.body.generated).toHaveLength(4);
  });

  it('changing frequency with no work yet updates in place (no supersede), and rejects a no-op', async () => {
    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    const componentId = await configure(pa, engId, 'GSTR1'); // monthly, no work generated

    const changed = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/change-frequency`)
      .set(bearer(pa))
      .send({ frequency: 'quarterly' })
      .expect(201);
    expect(changed.body.id).toBe(componentId); // same config row — in place
    expect(changed.body.frequency).toBe('quarterly');
    expect(changed.body.status).not.toBe('superseded');

    // Same frequency again → 400.
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/change-frequency`)
      .set(bearer(pa))
      .send({ frequency: 'quarterly' })
      .expect(400);
  });

  it('blocks generation without engagement.manage and hides another’s work (403/404)', async () => {
    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    const componentId = await configure(pa, engId, 'GSTR1');

    // Senior lacks engagement.manage → 403 on generate.
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components/${componentId}/instances/generate`)
      .set(bearer(await token('senior.y@hsdg.in')))
      .expect(403);

    // Unassigned partner cannot see the work (RLS) → empty list.
    const pb = await token('partner.b@hsdg.in');
    const list = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/component-work?limit=50`)
      .set(bearer(pb))
      .expect(200);
    expect(list.body.total).toBe(0);
  });
});
