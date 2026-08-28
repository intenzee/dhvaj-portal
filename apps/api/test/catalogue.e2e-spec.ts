import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Service catalogue through the HTTP API: firm-wide config reads, permission-
 * gated + audited service/service-line management, filters, and the required-
 * review-model data that Phase 7 will enforce.
 */
describe('Service Catalogue (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const code = (prefix: string): string => `${prefix}_${Date.now().toString().slice(-6)}`;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('reference reads (firm-wide, any authenticated role)', () => {
    it('lists review models ranked', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/review-models')
        .set(bearer(await token('senior.y@hsdg.in')))
        .expect(200);
      const ranks = (res.body as Array<{ rank: number }>).map((r) => r.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b)); // ascending
      expect(res.body.at(-1).slug).toBe('full_ep_review');
    });

    it('lists workflow families with ordered states', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/workflow-families')
        .set(bearer(await token('senior.y@hsdg.in')))
        .expect(200);
      const audit = (res.body as Array<{ slug: string; states: Array<{ slug: string }> }>).find(
        (f) => f.slug === 'audit_workflow',
      )!;
      // Phase 6 reconciliation (ADR-0011): the generic "review" state split
      // into Manager Review / EP Review to match the firm's actual practice.
      expect(audit.states.map((s) => s.slug)).toEqual([
        'planning',
        'fieldwork',
        'manager_review',
        'ep_review',
        'ep_sign_off',
        'completed',
      ]);
    });

    it('lists services with the required review model', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services?limit=100')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const statAudit = (
        res.body.items as Array<{ code: string; requiredReviewModelSlug: string }>
      ).find((s) => s.code === 'STAT_AUDIT')!;
      expect(statAudit.requiredReviewModelSlug).toBe('full_ep_review');
    });

    it('filters services by line and active flag (combined query DTO)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services?serviceLine=GST&active=true')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const codes = (res.body.items as Array<{ code: string }>).map((s) => s.code);
      // The filter returns the GST line (which the §8 catalogue expansion grows),
      // so assert its intent: the core GST services are present and nothing from
      // another line leaks in — not a frozen exact list.
      expect(codes).toEqual(expect.arrayContaining(['GST_ANNUAL', 'GST_MONTHLY']));
      expect(codes).not.toContain('STAT_AUDIT');
      expect(codes.every((c) => c.startsWith('GST'))).toBe(true);
    });

    it('rejects an unknown query param (400)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/services?bogus=1')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(400);
    });
  });

  describe('management (permission-gated + audited)', () => {
    it('forbids a Senior (no service.manage) from creating a service (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(await token('senior.y@hsdg.in')))
        .send({
          serviceLineCode: 'AUDIT',
          code: code('SVC'),
          name: 'X',
          requiredReviewModel: 'manager_review',
          workflowFamily: 'audit_workflow',
        })
        .expect(403);
    });

    it('lets an admin create a service and audits it', async () => {
      const svcCode = code('DD');
      const correlationId = `corr-svc-${Date.now()}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(await token('admin@hsdg.in')))
        .set('x-correlation-id', correlationId)
        .send({
          serviceLineCode: 'ADVISORY',
          code: svcCode,
          name: 'Due Diligence',
          requiredReviewModel: 'full_ep_review',
          workflowFamily: 'advisory_workflow',
          defaultRecurrence: 'as_required',
        })
        .expect(201);
      expect(created.body.code).toBe(svcCode);
      expect(created.body.workflowStates.length).toBeGreaterThan(0);

      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const event = (
        audit.body.items as Array<{ action: string; objectId: string; correlationId: string }>
      ).find((e) => e.action === 'service.created' && e.correlationId === correlationId);
      expect(event?.objectId).toBe(created.body.id);
    });

    it('rejects a duplicate service code (409)', async () => {
      const admin = await token('admin@hsdg.in');
      const body = {
        serviceLineCode: 'AUDIT',
        code: code('DUP'),
        name: 'Dup',
        requiredReviewModel: 'manager_review',
        workflowFamily: 'audit_workflow',
      };
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(admin))
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(admin))
        .send(body)
        .expect(409);
    });

    it('rejects an unknown review model (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(await token('admin@hsdg.in')))
        .send({
          serviceLineCode: 'AUDIT',
          code: code('BAD'),
          name: 'X',
          requiredReviewModel: 'nope',
          workflowFamily: 'audit_workflow',
        })
        .expect(400);
    });

    it('enforces optimistic concurrency on service update (stale version ⇒ 409)', async () => {
      const admin = await token('admin@hsdg.in');
      const created = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(admin))
        .send({
          serviceLineCode: 'AUDIT',
          code: code('VER'),
          name: 'Versioned',
          requiredReviewModel: 'manager_review',
          workflowFamily: 'audit_workflow',
        })
        .expect(201);
      const v0 = created.body.version as number;
      await request(app.getHttpServer())
        .patch(`/api/v1/services/${created.body.id}`)
        .set(bearer(admin))
        .send({ isActive: false, version: v0 })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/services/${created.body.id}`)
        .set(bearer(admin))
        .send({ isActive: true, version: v0 })
        .expect(409);
    });

    it('creates a service line (audited)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/service-lines')
        .set(bearer(await token('admin@hsdg.in')))
        .send({ code: code('LINE').replace(/_/g, ''), name: 'Valuation' })
        .expect(201);
      expect(res.body.version).toBe(1);
    });
  });

  // ── Frozen §3 master + §17 controlled fallback (0035 reconciliation) ───────
  describe('service-line master reconciliation (spec §3 / §17)', () => {
    it('exposes the advisory-family lines as co-equal top-level lines, without LITIGATION', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/service-lines')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const codes = (res.body as Array<{ code: string }>).map((l) => l.code);
      expect(codes).toEqual(expect.arrayContaining(['FEMA', 'VAL', 'CFO', 'GOV', 'FOR', 'OTHER']));
      // Litigation is a SERVICE under Direct Tax in the master, not a line.
      expect(codes).not.toContain('LITIGATION');
    });

    it('re-parents the folded services to their own lines and ITAT_REP to TAX', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services?limit=100')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const byCode = new Map(
        (res.body.items as Array<{ code: string; serviceLineCode: string }>).map((s) => [
          s.code,
          s.serviceLineCode,
        ]),
      );
      expect(byCode.get('VALUATION')).toBe('VAL');
      expect(byCode.get('FEMA')).toBe('FEMA');
      expect(byCode.get('VIRTUAL_CFO')).toBe('CFO');
      expect(byCode.get('GOVERNANCE')).toBe('GOV');
      expect(byCode.get('FORENSIC')).toBe('FOR');
      expect(byCode.get('ITAT_REP')).toBe('TAX');
    });

    it('exposes the §19 named workflow families (15), without the legacy generic filing family', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/workflow-families')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const slugs = (res.body as Array<{ slug: string }>).map((f) => f.slug);
      expect(slugs).toHaveLength(15);
      expect(slugs).toEqual(
        expect.arrayContaining([
          'audit_workflow',
          'assurance_workflow',
          'recurring_compliance_workflow',
          'tax_filing_workflow',
          'tax_compliance_workflow',
          'accounting_workflow',
          'payroll_workflow',
          'registration_workflow',
          'corporate_compliance_workflow',
          'litigation_workflow',
          'advisory_workflow',
          'valuation_workflow',
          'cfo_workflow',
          'governance_workflow',
          'investigation_workflow',
        ]),
      );
      expect(slugs).not.toContain('filing_workflow');
    });

    it('maps re-pointed services to their §19 workflow families', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services?limit=100')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const byCode = new Map(
        (res.body.items as Array<{ code: string; workflowFamilySlug: string }>).map((s) => [
          s.code,
          s.workflowFamilySlug,
        ]),
      );
      expect(byCode.get('GST_MONTHLY')).toBe('recurring_compliance_workflow');
      expect(byCode.get('PAYROLL')).toBe('payroll_workflow');
      expect(byCode.get('VALUATION')).toBe('valuation_workflow');
      expect(byCode.get('FORENSIC')).toBe('investigation_workflow');
      expect(byCode.get('STAT_AUDIT')).toBe('audit_workflow'); // unchanged
    });

    it('seeds the §17 controlled fallback service under OTHER', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services?serviceLine=OTHER')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const codes = (res.body.items as Array<{ code: string }>).map((s) => s.code);
      expect(codes).toContain('OTHER_PROF');
    });

    it('forbids an admin (no service.manage_other) from creating under OTHER (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(await token('admin@hsdg.in')))
        .send({
          serviceLineCode: 'OTHER',
          code: code('OTH'),
          name: 'Bespoke Assignment',
          requiredReviewModel: 'key_matter_review',
          workflowFamily: 'advisory_workflow',
          approvalReference: 'MP-APPROVAL-1',
        })
        .expect(403);
    });

    it('requires an approval reference when the MP creates under OTHER (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(await token('mp@hsdg.in')))
        .send({
          serviceLineCode: 'OTHER',
          code: code('OTH'),
          name: 'Bespoke Assignment',
          requiredReviewModel: 'key_matter_review',
          workflowFamily: 'advisory_workflow',
        })
        .expect(400);
    });

    it('lets the MP create a service under OTHER with a recorded approval reference', async () => {
      const svcCode = code('OTH');
      const res = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(await token('mp@hsdg.in')))
        .send({
          serviceLineCode: 'OTHER',
          code: svcCode,
          name: 'Bespoke Assignment',
          requiredReviewModel: 'key_matter_review',
          workflowFamily: 'advisory_workflow',
          approvalReference: 'MP-APPROVAL-2026-014',
        })
        .expect(201);
      expect(res.body.code).toBe(svcCode);
      expect(res.body.serviceLineCode).toBe('OTHER');
      expect(res.body.approvalReference).toBe('MP-APPROVAL-2026-014');
    });

    it('does not store an approval reference for a non-OTHER service (OTHER-only concept)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(await token('admin@hsdg.in')))
        .send({
          serviceLineCode: 'AUDIT',
          code: code('AUD'),
          name: 'Regular Audit Service',
          requiredReviewModel: 'manager_review',
          workflowFamily: 'audit_workflow',
          approvalReference: 'SHOULD-BE-IGNORED',
        })
        .expect(201);
      expect(res.body.approvalReference).toBeNull();
    });

    it('refuses to re-parent an existing service into OTHER via update (400)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set(bearer(await token('admin@hsdg.in')))
        .send({
          serviceLineCode: 'AUDIT',
          code: code('MOV'),
          name: 'Movable Service',
          requiredReviewModel: 'manager_review',
          workflowFamily: 'audit_workflow',
        })
        .expect(201);
      // Even the Managing Partner (who holds service.manage_other) cannot move a
      // service into the fallback line — the only path there is create-with-approval.
      await request(app.getHttpServer())
        .patch(`/api/v1/services/${created.body.id}`)
        .set(bearer(await token('mp@hsdg.in')))
        .send({ serviceLineCode: 'OTHER', version: created.body.version as number })
        .expect(400);
    });
  });
});
