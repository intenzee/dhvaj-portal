import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Reusable, versioned catalogue templates (§18/§25/§27) + the configuration
 * snapshots (§28): checklist / PBC / document-requirement masters with append-
 * only effective-dated versions, and the version a component configuration loads
 * when it is instantiated into an engagement.
 */
describe('Catalogue Templates (e2e)', () => {
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
  const code = (prefix: string): string => `${prefix}_${Date.now().toString().slice(-6)}`;

  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp));
    return res.body.items[0].id as string;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('template masters + append-only versions', () => {
    it('creates a template, appends effective-dated versions, and reads them newest-first', async () => {
      const templateCode = code('CHK');
      const created = await request(app.getHttpServer())
        .post('/api/v1/catalogue-templates')
        .set(bearer(mp))
        .send({ templateType: 'checklist', code: templateCode, name: 'Audit Planning Checklist' })
        .expect(201);
      expect(created.body.templateType).toBe('checklist');
      const id = created.body.id as string;

      const v1 = await request(app.getHttpServer())
        .post(`/api/v1/catalogue-templates/${id}/versions`)
        .set(bearer(mp))
        .send({
          effectiveFrom: '2020-04-01',
          items: [
            { label: 'Engagement letter signed', mandatory: true },
            { label: 'Independence confirmed' },
          ],
        })
        .expect(201);
      expect(v1.body.version).toBe(1);
      expect(v1.body.items[0].sequence).toBe(1); // defaulted from declaration order

      const v2 = await request(app.getHttpServer())
        .post(`/api/v1/catalogue-templates/${id}/versions`)
        .set(bearer(mp))
        .send({ effectiveFrom: '2026-04-01', items: [{ label: 'Revised planning step' }] })
        .expect(201);
      expect(v2.body.version).toBe(2);

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/catalogue-templates/${id}`)
        .set(bearer(mp))
        .expect(200);
      // Newest effective first.
      expect((detail.body.versions as Array<{ version: number }>).map((v) => v.version)).toEqual([
        2, 1,
      ]);
    });

    it('rejects a duplicate effective_from for the same template (409)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/catalogue-templates')
        .set(bearer(mp))
        .send({ templateType: 'pbc', code: code('PBC'), name: 'PBC' })
        .expect(201);
      const id = created.body.id as string;
      const body = { effectiveFrom: '2025-04-01', items: [{ label: 'Item' }] };
      await request(app.getHttpServer())
        .post(`/api/v1/catalogue-templates/${id}/versions`)
        .set(bearer(mp))
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/catalogue-templates/${id}/versions`)
        .set(bearer(mp))
        .send(body)
        .expect(409);
    });

    it('rejects a version whose item has a blank label (400)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/catalogue-templates')
        .set(bearer(mp))
        .send({ templateType: 'document_requirement', code: code('DOC'), name: 'Docs' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/catalogue-templates/${created.body.id}/versions`)
        .set(bearer(mp))
        .send({ effectiveFrom: '2025-04-01', items: [{ label: '   ' }] })
        .expect(400);
    });

    it('filters templates by type and exposes the seeded bookkeeping templates', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/catalogue-templates?templateType=checklist&limit=100')
        .set(bearer(mp))
        .expect(200);
      const items = res.body.items as Array<{ code: string; templateType: string }>;
      expect(items.every((t) => t.templateType === 'checklist')).toBe(true);
      expect(items.map((t) => t.code)).toContain('CHK_BANKREC');
    });

    it('forbids a Senior (no service.manage) from creating a template (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/catalogue-templates')
        .set(bearer(await token('senior.y@dhvaj.in')))
        .send({ templateType: 'checklist', code: code('CHK'), name: 'X' })
        .expect(403);
    });
  });

  describe('configuration snapshot (§28)', () => {
    it('snapshots the active template versions when the linked component is configured', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
      const serviceId = await findId('/api/v1/services?search=BOOKKEEPING&limit=100');
      const eng = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `T${unique()}`,
          status: 'accepted',
        })
        .expect(201);

      // BK_BANKREC links a checklist, a PBC and a document-requirement template.
      const configured = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.body.id}/components`)
        .set(bearer(pa))
        .send({ serviceComponentCode: 'BK_BANKREC' })
        .expect(201);

      expect(configured.body.checklistTemplateVersionId).toBeTruthy();
      expect(configured.body.pbcTemplateVersionId).toBeTruthy();
      expect(configured.body.documentRequirementTemplateVersionId).toBeTruthy();
    });
  });
});
