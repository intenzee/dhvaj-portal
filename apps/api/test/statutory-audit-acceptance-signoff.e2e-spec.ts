import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import JSZip from 'jszip';
import type {
  AcceptanceFilesView,
  AcceptanceSignoffView,
  DocumentTemplateRecord,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { answerSection01Clean } from './section01.helper';
import { progressEngagementLetter, tinyDocx } from './section01-files.helper';

/**
 * Section 01 documents + sign-off (spec §2, §10, §12, §14) through the HTTP API:
 * firm templates (upload → approve → Create from Template with engagement data
 * merged in, the exact template version remembered), file-card lifecycles with
 * partner-only steps and the approved-work lock, FINAL-01 → FINAL-02 (EP only,
 * reasons/safeguards enforced, Return / Decline), and the controlled reopen.
 */
describe('Statutory Audit — Section 01 documents & sign-off (e2e)', () => {
  let app: INestApplication;
  let mp: string; // Managing Partner — firm-wide admin, NOT the EP of these engagements.
  let pa: string; // Partner A — creates the engagements, so is their Engagement Partner.

  const token = async (email: string): Promise<string> =>
    (await request(app.getHttpServer()).post('/api/v1/auth/dev-token').send({ email }).expect(201))
      .body.accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniquePeriod = (): string => `P${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const findId = async (path: string): Promise<string> =>
    (await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200)).body.items[0]
      .id as string;

  const provision = async (): Promise<{ engId: string; shellId: string }> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const created = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId: primaryServiceId,
        financialYear: '2024-25',
        periodLabel: uniquePeriod(),
        status: 'accepted',
      })
      .expect(201);
    const engId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/services`)
      .set(bearer(pa))
      .send({ serviceId: statAuditId })
      .expect(201);
    const shells = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    return { engId, shellId: shells.body[0].workflowInstanceId as string };
  };

  const filesUrl = (engId: string, shellId: string) =>
    `/api/v1/engagements/${engId}/statutory-audit/${shellId}/acceptance/files`;
  const acceptanceUrl = (engId: string, shellId: string) =>
    `/api/v1/engagements/${engId}/statutory-audit/${shellId}/acceptance`;

  const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('Create from Template explains itself until a template is approved, then merges engagement data', async () => {
    const { engId, shellId } = await provision();
    const http = app.getHttpServer();

    // No approved template yet → the button explains what an admin must do.
    let view = (await request(http).get(filesUrl(engId, shellId)).set(bearer(pa)).expect(200))
      .body as AcceptanceFilesView;
    const consent = view.templates.find((t) => t.templateKey === 'auditor_consent_certificate')!;
    expect(consent.available).toBe(false);
    expect(consent.reason).toMatch(/administrator must upload and approve/);
    await request(http)
      .post(`${filesUrl(engId, shellId)}/create-from-template`)
      .set(bearer(pa))
      .send({ slotKey: 'consent_certificate' })
      .expect(400);

    // An admin uploads + approves the firm's Word template.
    const templates = (
      await request(http).get('/api/v1/document-templates').set(bearer(mp)).expect(200)
    ).body as DocumentTemplateRecord[];
    const standard = templates.find(
      (t) => t.templateKey === 'auditor_consent_certificate' && t.variantKey === 'standard',
    )!;
    await request(http)
      .post(`/api/v1/document-templates/${standard.id}/versions`)
      .set(bearer(mp))
      .send({ filename: 'notes.txt', contentBase64: Buffer.from('x').toString('base64') })
      .expect(400);
    const bytes = await tinyDocx([
      'To the Board of {{client.name}} ({{client.cin}})',
      'FY {{engagement.financialYear}} — {{custom.unknownField}}',
    ]);
    const uploaded = (
      await request(http)
        .post(`/api/v1/document-templates/${standard.id}/versions`)
        .set(bearer(mp))
        .send({ filename: 'Consent v1.docx', contentBase64: bytes.toString('base64') })
        .expect(201)
    ).body as DocumentTemplateRecord;
    const v1 = uploaded.versions[0]!;
    expect(v1.status).toBe('draft');
    expect(v1.fieldsFound).toEqual(
      expect.arrayContaining(['client.name', 'client.cin', 'engagement.financialYear']),
    );
    expect(v1.unknownFields).toEqual(['custom.unknownField']);
    // A partner without service.manage cannot approve firm templates.
    await request(http)
      .post(`/api/v1/document-templates/${standard.id}/versions/${v1.id}/approve`)
      .set(bearer(pa))
      .expect(403);
    const approved = (
      await request(http)
        .post(`/api/v1/document-templates/${standard.id}/versions/${v1.id}/approve`)
        .set(bearer(mp))
        .expect(201)
    ).body as DocumentTemplateRecord;
    expect(approved.currentVersion?.versionNo).toBe(1);

    // Create from Template: merged, filed on the engagement, version remembered.
    view = (
      await request(http)
        .post(`${filesUrl(engId, shellId)}/create-from-template`)
        .set(bearer(pa))
        .send({ slotKey: 'consent_certificate' })
        .expect(201)
    ).body;
    const card = view.files.find((f) => f.slotKey === 'consent_certificate')!;
    expect(card).toMatchObject({
      status: 'draft',
      templateKey: 'auditor_consent_certificate',
      templateVariantKey: 'standard',
      templateVersionNo: 1,
      editLocked: false,
    });
    expect(card.filename).toMatch(/^Auditor Consent and Eligibility Certificate - .*\.docx$/);
    const download = await request(http)
      .get(`/api/v1/engagements/${engId}/documents/${card.documentId}/download`)
      .set(bearer(pa))
      .buffer(true)
      .parse(binary)
      .expect(200);
    const xml = await (
      await JSZip.loadAsync(download.body as Buffer)
    )
      .file('word/document.xml')!
      .async('string');
    expect(xml).toContain('FY 2024-25');
    expect(xml).toContain('{{custom.unknownField}}');
    expect(xml).not.toContain('{{client.name}}');

    // One file per single-file slot.
    await request(http)
      .post(`${filesUrl(engId, shellId)}/create-from-template`)
      .set(bearer(pa))
      .send({ slotKey: 'consent_certificate' })
      .expect(409);

    // The version history falls back to the portal's when SharePoint is off.
    const history = await request(http)
      .get(`${filesUrl(engId, shellId)}/${card.id}/versions`)
      .set(bearer(pa))
      .expect(200);
    expect(history.body.source).toBe('portal');
    expect(history.body.entries).toHaveLength(1);
  });

  it('runs the engagement letter lifecycle with partner-only approval and the approved-work lock', async () => {
    const { engId, shellId } = await provision();
    const http = app.getHttpServer();
    const bytes = await tinyDocx(['Letter']);
    let view = (
      await request(http)
        .post(`${filesUrl(engId, shellId)}/add`)
        .set(bearer(pa))
        .send({
          slotKey: 'engagement_letter',
          filename: 'Letter.docx',
          contentBase64: bytes.toString('base64'),
        })
        .expect(201)
    ).body as AcceptanceFilesView;
    let letter = view.files.find((f) => f.slotKey === 'engagement_letter')!;
    view = (
      await request(http)
        .post(`${filesUrl(engId, shellId)}/${letter.id}/status`)
        .set(bearer(pa))
        .send({ status: 'partner_review', version: letter.version })
        .expect(201)
    ).body;
    letter = view.files.find((f) => f.slotKey === 'engagement_letter')!;
    expect(letter.editLocked).toBe(true);
    // Locked work takes no new versions.
    await request(http)
      .post(`/api/v1/engagements/${engId}/documents/${letter.documentId}/versions`)
      .set(bearer(pa))
      .send({ filename: 'Letter.docx', contentBase64: bytes.toString('base64') })
      .expect(409);

    // Not the Engagement Partner → refused.
    await request(http)
      .post(`${filesUrl(engId, shellId)}/${letter.id}/status`)
      .set(bearer(mp))
      .send({ status: 'approved', version: letter.version })
      .expect(400);
    view = (
      await request(http)
        .post(`${filesUrl(engId, shellId)}/${letter.id}/status`)
        .set(bearer(pa))
        .send({ status: 'approved', version: letter.version })
        .expect(201)
    ).body;
    letter = view.files.find((f) => f.slotKey === 'engagement_letter')!;
    // Issuing needs the date and the mode.
    await request(http)
      .post(`${filesUrl(engId, shellId)}/${letter.id}/status`)
      .set(bearer(pa))
      .send({ status: 'issued', meta: { issuedDate: '2024-04-15' }, version: letter.version })
      .expect(400);
    // Reopening approved work needs a reason, and unlocks the document.
    await request(http)
      .post(`${filesUrl(engId, shellId)}/${letter.id}/status`)
      .set(bearer(pa))
      .send({ status: 'draft', version: letter.version })
      .expect(400);
    view = (
      await request(http)
        .post(`${filesUrl(engId, shellId)}/${letter.id}/status`)
        .set(bearer(pa))
        .send({
          status: 'draft',
          meta: { reopenReason: 'Fee clause changed' },
          version: letter.version,
        })
        .expect(201)
    ).body;
    letter = view.files.find((f) => f.slotKey === 'engagement_letter')!;
    expect(letter).toMatchObject({ status: 'draft', editLocked: false });
    expect(letter.meta.reopenReason).toBeUndefined();
  });

  it('FINAL-01 → FINAL-02: EP-only approval, reasons and safeguards, lock, then controlled reopen', async () => {
    const { engId, shellId } = await provision();
    const http = app.getHttpServer();
    const url = acceptanceUrl(engId, shellId);

    // The partner cannot conclude before the Manager submits.
    await request(http)
      .post(`${url}/approve`)
      .set(bearer(pa))
      .send({ conclusion: 'accept' })
      .expect(400);
    // Clear recommendations need a ready file; others need comments.
    await request(http)
      .post(`${url}/recommend`)
      .set(bearer(pa))
      .send({ recommendation: 'accept' })
      .expect(400);
    await request(http)
      .post(`${url}/recommend`)
      .set(bearer(pa))
      .send({ recommendation: 'decline' })
      .expect(400);

    await answerSection01Clean(app, pa, engId);
    await progressEngagementLetter(app, pa, engId, shellId);
    let signoff = (await request(http).get(`${url}/signoff`).set(bearer(pa)).expect(200))
      .body as AcceptanceSignoffView;
    expect(signoff.blockers).toEqual([]);
    expect(signoff.finalSegmentState).toBe('ready_for_approval');
    expect(signoff.callerIsEngagementPartner).toBe(true);

    signoff = (
      await request(http)
        .post(`${url}/recommend`)
        .set(bearer(pa))
        .send({ recommendation: 'accept' })
        .expect(201)
    ).body;
    expect(signoff.header.status).toBe('ready_for_review');
    expect(signoff.canDecide).toBe(true);
    await request(http)
      .post(`${url}/recommend`)
      .set(bearer(pa))
      .send({ recommendation: 'accept' })
      .expect(409);

    // Only the Engagement Partner concludes.
    await request(http)
      .post(`${url}/approve`)
      .set(bearer(mp))
      .send({ conclusion: 'accept' })
      .expect(403);
    await request(http)
      .post(`${url}/approve`)
      .set(bearer(pa))
      .send({ conclusion: 'accept_with_conditions' })
      .expect(400);

    // Return for further work needs a reason; it sends the file back.
    await request(http)
      .post(`${url}/approve`)
      .set(bearer(pa))
      .send({ conclusion: 'return' })
      .expect(400);
    signoff = (
      await request(http)
        .post(`${url}/approve`)
        .set(bearer(pa))
        .send({ conclusion: 'return', reason: 'Expand the independence assessment.' })
        .expect(201)
    ).body;
    expect(signoff.recommendation?.status).toBe('returned');
    expect(signoff.header.status).toBe('attention_required');
    expect(signoff.canSubmit).toBe(true);

    // Resubmit → approve with safeguards.
    await request(http)
      .post(`${url}/recommend`)
      .set(bearer(pa))
      .send({ recommendation: 'accept' })
      .expect(201);
    signoff = (
      await request(http)
        .post(`${url}/approve`)
        .set(bearer(pa))
        .send({ conclusion: 'accept_with_conditions', safeguards: 'EQCR partner review.' })
        .expect(201)
    ).body;
    expect(signoff.finalSegmentState).toBe('complete');
    expect(signoff.header.status).toBe('complete');
    expect(signoff.canReopen).toBe(true);
    expect(signoff.decisions[0]).toMatchObject({
      conclusion: 'accept_with_conditions',
      safeguards: 'EQCR partner review.',
    });

    // Section 02 is unlocked; Section 01 and its documents are locked.
    const shell = await request(http)
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    const phase = (key: string) =>
      (shell.body[0].phases as Array<{ phaseKey: string; state: string }>).find(
        (p) => p.phaseKey === key,
      )?.state;
    expect(phase('acceptance')).toBe('complete');
    expect(phase('framework')).toBe('in_progress');
    const files = (await request(http).get(filesUrl(engId, shellId)).set(bearer(pa)).expect(200))
      .body as AcceptanceFilesView;
    expect(files.sectionLocked).toBe(true);
    expect(files.files.every((f) => f.editLocked)).toBe(true);
    await request(http)
      .post(`${filesUrl(engId, shellId)}/add`)
      .set(bearer(pa))
      .send({
        slotKey: 'appointment_filing',
        filename: 'x.pdf',
        contentBase64: Buffer.from('x').toString('base64'),
      })
      .expect(409);

    // Controlled reopen: EP only, with a reason; never deletes the approval.
    await request(http).post(`${url}/reopen`).set(bearer(pa)).send({ reason: ' ' }).expect(400);
    await request(http)
      .post(`${url}/reopen`)
      .set(bearer(mp))
      .send({ reason: 'New info' })
      .expect(403);
    signoff = (
      await request(http)
        .post(`${url}/reopen`)
        .set(bearer(pa))
        .send({ reason: 'A new related-party relationship came to light.' })
        .expect(201)
    ).body;
    expect(signoff.header.status).not.toBe('complete');
    expect(signoff.decisions[0]).toMatchObject({
      reopenReason: 'A new related-party relationship came to light.',
    });
    expect(signoff.decisions[0]!.reopenedAt).not.toBeNull();
    expect(signoff.canSubmit).toBe(true);
    const after = await request(http)
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    const phaseAfter = (key: string) =>
      (after.body[0].phases as Array<{ phaseKey: string; state: string }>).find(
        (p) => p.phaseKey === key,
      )?.state;
    expect(phaseAfter('acceptance')).toBe('in_progress');
    expect(phaseAfter('framework')).toBe('needs_attention');
    const filesAfter = (
      await request(http).get(filesUrl(engId, shellId)).set(bearer(pa)).expect(200)
    ).body as AcceptanceFilesView;
    expect(filesAfter.sectionLocked).toBe(false);
    // The issued letter stays locked by its own status; nothing else does.
    expect(filesAfter.files.find((f) => f.slotKey === 'engagement_letter')!.editLocked).toBe(true);

    // The audit trail holds the approval and the reopen.
    const audit = await request(http).get('/api/v1/audit?limit=100').set(bearer(mp)).expect(200);
    const actions = (audit.body.items as Array<{ action: string; objectId: string }>)
      .filter((e) => e.objectId === shellId)
      .map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'statutory_audit.acceptance_recommendation_submitted',
        'statutory_audit.acceptance_returned',
        'statutory_audit.acceptance_approved',
        'statutory_audit.acceptance_reopened',
      ]),
    );
  });
});
