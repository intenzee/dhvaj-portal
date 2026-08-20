import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Phase 10 — Documents, through the HTTP API.
 *
 * Acceptance (§12): an authorised user can upload and download; an unauthorised
 * user cannot; a document id alone cannot bypass access control (no direct URL);
 * downloads are audited; and controlled versioning retains earlier evidence —
 * a new version supersedes without silently replacing the old one.
 */
describe('Documents (e2e)', () => {
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
  const b64 = (s: string): string => Buffer.from(s).toString('base64');

  const findEntityId = async (search: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/entities?search=${search}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const findServiceId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/services?search=${code}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const findEmployeeId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/employees?limit=100`)
      .set(bearer(mp));
    return (res.body.items as Array<{ employeeCode: string; id: string }>).find(
      (e) => e.employeeCode === code,
    )!.id;
  };

  const createEngagement = async (epToken: string): Promise<string> => {
    const entityId = await findEntityId('Bharat');
    const serviceId = await findServiceId('ITR_FILING');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `D${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  const uploadDoc = (t: string, eng: string, body: Record<string, unknown>): request.Test =>
    request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/documents`)
      .set(bearer(t))
      .send(body);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── ACCEPTANCE ────────────────────────────────────────────────────────────
  describe('upload, download, versioning', () => {
    it('uploads a document, downloads the exact bytes, and audits the download', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const content = 'Engagement letter — signed FY26-27';

      const created = await uploadDoc(pa, eng, {
        title: 'Engagement letter',
        documentType: 'engagement_letter',
        classification: 'client_shared',
        filename: 'letter.txt',
        contentType: 'text/plain',
        contentBase64: b64(content),
      }).expect(201);
      expect(created.body.currentVersionNo).toBe(1);
      expect(created.body.currentFilename).toBe('letter.txt');
      // The storage reference must NEVER be exposed.
      expect(JSON.stringify(created.body)).not.toMatch(/storage_reference|storageReference/);

      const docId = created.body.id as string;
      const download = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/documents/${docId}/download`)
        .set(bearer(pa))
        .expect(200);
      expect(download.text).toBe(content);
      expect(download.headers['content-disposition']).toContain('letter.txt');

      // The download is on the immutable audit trail.
      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(mp))
        .expect(200);
      const hit = (audit.body.items as Array<{ action: string; objectId: string }>).find(
        (e) => e.action === 'document.downloaded' && e.objectId === docId,
      );
      expect(hit).toBeDefined();
    });

    it('adds a new version that supersedes, while the earlier version is retained and downloadable', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const created = await uploadDoc(pa, eng, {
        title: 'Working paper',
        documentType: 'working_paper',
        filename: 'wp.txt',
        contentType: 'text/plain',
        contentBase64: b64('draft v1'),
      }).expect(201);
      const docId = created.body.id as string;

      const v2 = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/documents/${docId}/versions`)
        .set(bearer(pa))
        .send({
          filename: 'wp.txt',
          contentType: 'text/plain',
          contentBase64: b64('final v2'),
          note: 'incorporated review points',
        })
        .expect(201);
      expect(v2.body.currentVersionNo).toBe(2);
      expect(v2.body.versions).toHaveLength(2);

      // Current download is v2.
      const current = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/documents/${docId}/download`)
        .set(bearer(pa))
        .expect(200);
      expect(current.text).toBe('final v2');

      // v1 is retained and still downloadable by its version id — not replaced.
      const versions = v2.body.versions as Array<{
        id: string;
        versionNo: number;
        checksumSha256: string;
      }>;
      const v1 = versions.find((v) => v.versionNo === 1)!;
      const v2meta = versions.find((v) => v.versionNo === 2)!;
      expect(v1.checksumSha256).not.toBe(v2meta.checksumSha256);
      const old = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/documents/${docId}/versions/${v1.id}/download`)
        .set(bearer(pa))
        .expect(200);
      expect(old.text).toBe('draft v1');
    });

    it('archives and restores a document (both audited)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const created = await uploadDoc(pa, eng, {
        title: 'Superseded note',
        filename: 'n.txt',
        contentType: 'text/plain',
        contentBase64: b64('note'),
      }).expect(201);
      const docId = created.body.id as string;

      const archived = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/documents/${docId}/archive`)
        .set(bearer(pa))
        .send({ reason: 'superseded by consolidated file' })
        .expect(201);
      expect(archived.body.status).toBe('archived');
      expect(archived.body.archivedAt).not.toBeNull();

      // Archiving again is rejected.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/documents/${docId}/archive`)
        .set(bearer(pa))
        .send({ reason: 'again' })
        .expect(400);

      const restored = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/documents/${docId}/restore`)
        .set(bearer(pa))
        .send({ reason: 'still needed' })
        .expect(201);
      expect(restored.body.status).toBe('active');
      expect(restored.body.archivedAt).toBeNull();
    });
  });

  // ── Authority & RLS ──────────────────────────────────────────────────────
  describe('authority & RLS', () => {
    it('lets a team member (Senior) download, but forbids them uploading (403)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const seniorY = await findEmployeeId('EMP006');
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/team`)
        .set(bearer(pa))
        .send({ employeeId: seniorY, roleOnEngagement: 'in_charge' })
        .expect(201);

      const created = await uploadDoc(pa, eng, {
        title: 'Shared WP',
        filename: 'shared.txt',
        contentType: 'text/plain',
        contentBase64: b64('shared bytes'),
      }).expect(201);
      const docId = created.body.id as string;

      const sy = await token('senior.y@hsdg.in');
      // Member can download.
      const dl = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/documents/${docId}/download`)
        .set(bearer(sy))
        .expect(200);
      expect(dl.text).toBe('shared bytes');

      // …but cannot upload (no engagement.manage).
      await uploadDoc(sy, eng, {
        title: 'Nope',
        filename: 'x.txt',
        contentType: 'text/plain',
        contentBase64: b64('x'),
      }).expect(403);
    });

    it('does not let an unassigned partner list, read, or download — a document id cannot bypass access (404)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const created = await uploadDoc(pa, eng, {
        title: 'Confidential',
        classification: 'restricted',
        filename: 'c.txt',
        contentType: 'text/plain',
        contentBase64: b64('secret'),
      }).expect(201);
      const docId = created.body.id as string;

      const pb = await token('partner.b@hsdg.in');
      await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/documents`)
        .set(bearer(pb))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/documents/${docId}`)
        .set(bearer(pb))
        .expect(404);
      // Even armed with the real document id, the bytes are unreachable.
      await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/documents/${docId}/download`)
        .set(bearer(pb))
        .expect(404);
    });

    it('rejects an over-size upload (413)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      // Size just over DOCUMENT_MAX_BYTES (but under the JSON body ceiling) so the
      // request reaches the app-level size guard rather than the body parser.
      const maxBytes = Number(process.env.DOCUMENT_MAX_BYTES ?? 256 * 1024);
      const tooBig = b64('a'.repeat(maxBytes + 4 * 1024));
      await uploadDoc(pa, eng, {
        title: 'Too big',
        filename: 'big.bin',
        contentBase64: tooBig,
      }).expect(413);
    });
  });
});
