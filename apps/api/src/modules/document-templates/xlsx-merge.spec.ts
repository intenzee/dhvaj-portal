import JSZip from 'jszip';
import { mergeXlsx, scanXlsxFields } from './xlsx-merge';

const KNOWN = new Map([
  ['client.name', 'Client name'],
  ['client.cin', 'CIN / LLPIN'],
  ['engagement.financialYear', 'Financial year'],
]);

async function xlsx(sharedStrings: string, sheet = '<worksheet><sheetData/></worksheet>') {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('xl/workbook.xml', '<workbook/>');
  zip.file('xl/sharedStrings.xml', `<sst>${sharedStrings}</sst>`);
  zip.file('xl/worksheets/sheet1.xml', sheet);
  return zip.generateAsync({ type: 'nodebuffer' });
}
const part = async (buf: Buffer, name: string) =>
  (await JSZip.loadAsync(buf)).file(name)!.async('string');

describe('mergeXlsx', () => {
  it('fills shared-string and inline-string cells and reports gaps', async () => {
    const buf = await xlsx(
      '<si><t>Balance Sheet of {{client.name}}</t></si><si><t>CIN {{client.cin}}</t></si>',
      '<worksheet><sheetData><row><c t="inlineStr"><is><t>FY {{engagement.financialYear}}</t></is></c>' +
        '<c><v>42</v></c></row></sheetData></worksheet>',
    );
    const res = await mergeXlsx(
      buf,
      { 'client.name': 'Acme & Sons', 'engagement.financialYear': '2025-26' },
      KNOWN,
    );
    const ss = await part(res.buffer, 'xl/sharedStrings.xml');
    expect(ss).toContain('Balance Sheet of Acme &amp; Sons');
    expect(ss).toContain('CIN [CIN / LLPIN]');
    const sheet = await part(res.buffer, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('FY 2025-26');
    expect(sheet).toContain('<v>42</v>');
    expect(res.filled).toEqual(['client.name', 'engagement.financialYear']);
    expect(res.missing).toEqual(['client.cin']);
  });

  it('gathers a field split across rich-text runs of one cell, never across cells', async () => {
    const buf = await xlsx(
      '<si><r><t>{{client.</t></r><r><rPr><b/></rPr><t>name}} Ltd</t></r></si><si><t>{{client.</t></si><si><t>cin}}</t></si>',
    );
    const res = await mergeXlsx(buf, { 'client.name': 'Acme' }, KNOWN);
    const ss = await part(res.buffer, 'xl/sharedStrings.xml');
    expect(ss).toContain('<t xml:space="preserve">Acme</t>');
    expect(ss).toContain('<t xml:space="preserve"> Ltd</t>');
    expect(ss).toContain('<t>{{client.</t>'); // separate cells stay as written
    expect(res.filled).toEqual(['client.name']);
  });

  it('leaves unknown fields as written', async () => {
    const res = await mergeXlsx(await xlsx('<si><t>{{custom.thing}}</t></si>'), {}, KNOWN);
    expect(await part(res.buffer, 'xl/sharedStrings.xml')).toContain('{{custom.thing}}');
    expect(res.unknown).toEqual(['custom.thing']);
  });

  it('scans the fields a template uses and rejects a non-workbook', async () => {
    expect(
      await scanXlsxFields(await xlsx('<si><r><t>{{client</t></r><r><t>.name}}</t></r></si>')),
    ).toEqual(['client.name']);
    await expect(scanXlsxFields(Buffer.from('not a zip'))).rejects.toThrow(/valid Excel/);
  });
});
