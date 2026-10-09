import JSZip from 'jszip';
import { gatherSplitFields, mergeDocx, scanDocxFields } from './docx-merge';

const KNOWN = new Map([
  ['client.name', 'Client name'],
  ['client.cin', 'CIN / LLPIN'],
  ['firm.address', 'Firm address'],
]);

async function docx(bodyXml: string, extra: Record<string, string> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', `<w:document xmlns:w="w"><w:body>${bodyXml}</w:body></w:document>`);
  for (const [name, xml] of Object.entries(extra)) zip.file(name, xml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function documentXml(buf: Buffer, part = 'word/document.xml'): Promise<string> {
  return (await JSZip.loadAsync(buf)).file(part)!.async('string');
}

describe('gatherSplitFields', () => {
  it('moves a field split across runs into the run where it starts', () => {
    expect(gatherSplitFields(['Dear {{cli', 'ent.na', 'me}}, hello'])).toEqual([
      'Dear {{client.name}}',
      '',
      ', hello',
    ]);
  });

  it('leaves whole fields and plain text untouched', () => {
    const t = ['To {{client.name}}', ' of ', '{{client.cin}}'];
    expect(gatherSplitFields(t)).toEqual(t);
  });

  it('handles several split fields in one paragraph', () => {
    expect(gatherSplitFields(['{', '{client.name}', '} and {{client.', 'cin}}'])).toEqual([
      '{{client.name}}',
      '',
      ' and {{client.cin}}',
      '',
    ]);
  });
});

describe('mergeDocx', () => {
  it('fills known fields, keeping the run formatting', async () => {
    const buf = await docx(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{{client.name}}</w:t></w:r><w:r><w:t xml:space="preserve"> Ltd</w:t></w:r></w:p>',
    );
    const res = await mergeDocx(buf, { 'client.name': 'Bharat & Sons' }, KNOWN);
    const xml = await documentXml(res.buffer);
    expect(xml).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Bharat &amp; Sons</w:t>');
    expect(res.filled).toEqual(['client.name']);
  });

  it('re-joins a field Word split across runs', async () => {
    const buf = await docx(
      '<w:p><w:r><w:t>CIN: {{client</w:t></w:r><w:proofErr/><w:r><w:t>.cin}}</w:t></w:r></w:p>',
    );
    const res = await mergeDocx(buf, { 'client.cin': 'U12345MH2020PTC000001' }, KNOWN);
    const xml = await documentXml(res.buffer);
    expect(xml).toContain('CIN: U12345MH2020PTC000001');
    expect(xml).not.toContain('{{');
  });

  it('marks a known field with no value and leaves unknown fields as written', async () => {
    const buf = await docx('<w:p><w:r><w:t>{{client.cin}} {{custom.thing}}</w:t></w:r></w:p>');
    const res = await mergeDocx(buf, { 'client.cin': null }, KNOWN);
    const xml = await documentXml(res.buffer);
    expect(xml).toContain('[CIN / LLPIN] {{custom.thing}}');
    expect(res.missing).toEqual(['client.cin']);
    expect(res.unknown).toEqual(['custom.thing']);
  });

  it('turns multi-line values into line breaks', async () => {
    const buf = await docx('<w:p><w:r><w:t>{{firm.address}}</w:t></w:r></w:p>');
    const res = await mergeDocx(buf, { 'firm.address': '1 Main St\nMumbai' }, KNOWN);
    expect(await documentXml(res.buffer)).toContain(
      '1 Main St</w:t><w:br/><w:t xml:space="preserve">Mumbai',
    );
  });

  it('merges headers and footers too', async () => {
    const buf = await docx('<w:p/>', {
      'word/header1.xml': '<w:hdr><w:p><w:r><w:t>{{client.name}}</w:t></w:r></w:p></w:hdr>',
    });
    const res = await mergeDocx(buf, { 'client.name': 'Acme' }, KNOWN);
    expect(await documentXml(res.buffer, 'word/header1.xml')).toContain('>Acme</w:t>');
  });

  it('rejects a file that is not a Word document', async () => {
    await expect(mergeDocx(Buffer.from('not a zip'), {}, KNOWN)).rejects.toThrow(
      'not a valid Word',
    );
  });
});

describe('scanDocxFields', () => {
  it('lists the fields a template uses, including split ones', async () => {
    const buf = await docx(
      '<w:p><w:r><w:t>{{client.name}} {{cl</w:t></w:r><w:r><w:t>ient.cin}} {{client.name}}</w:t></w:r></w:p>',
    );
    expect(await scanDocxFields(buf)).toEqual(['client.cin', 'client.name']);
  });
});
