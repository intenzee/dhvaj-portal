import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import JSZip from 'jszip';
import type { AcceptanceFilesView } from '@hsdg/contracts';

/** A minimal Word document whose body is the given paragraphs (merge fields allowed). */
export async function tinyDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Put an engagement letter in Section 01.7 and take it to Issued, the way the
 * team would (add → Submit for Partner Review → EP approves → Mark Issued).
 * `epToken` must be the Engagement Partner's (the approval step is EP-only).
 */
export async function progressEngagementLetter(
  app: INestApplication,
  epToken: string,
  engId: string,
  shellId: string,
): Promise<AcceptanceFilesView> {
  const http = app.getHttpServer();
  const base = `/api/v1/engagements/${engId}/statutory-audit/${shellId}/acceptance/files`;
  const auth = { Authorization: `Bearer ${epToken}` };
  let view = (await request(http).get(base).set(auth).expect(200)).body as AcceptanceFilesView;
  if (!view.files.some((f) => f.slotKey === 'engagement_letter')) {
    const bytes = await tinyDocx(['Engagement letter (e2e)']);
    view = (
      await request(http)
        .post(`${base}/add`)
        .set(auth)
        .send({
          slotKey: 'engagement_letter',
          filename: 'Engagement letter.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          contentBase64: bytes.toString('base64'),
        })
        .expect(201)
    ).body;
  }
  const steps: Array<{ from: string; to: string; meta?: Record<string, string> }> = [
    { from: 'draft', to: 'partner_review' },
    { from: 'partner_review', to: 'approved' },
    { from: 'approved', to: 'issued', meta: { issuedDate: '2024-04-15', deliveryMode: 'email' } },
  ];
  for (const step of steps) {
    const letter = view.files.find((f) => f.slotKey === 'engagement_letter')!;
    if (letter.status !== step.from) continue;
    view = (
      await request(http)
        .post(`${base}/${letter.id}/status`)
        .set(auth)
        .send({ status: step.to, meta: step.meta, version: letter.version })
        .expect(201)
    ).body;
  }
  return view;
}
