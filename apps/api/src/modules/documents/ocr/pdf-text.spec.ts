import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * unpdf loads PDF.js with a dynamic import, which jest's VM refuses without
 * --experimental-vm-modules; the API runs on plain Node, so each case runs
 * pdfTextLayer there (ts-node, transpile only) and reads back its result.
 */
function pdfTextLayer(bytes: Buffer): string | null {
  const script = `
    const { pdfTextLayer } = require(${JSON.stringify(join(__dirname, 'pdf-text.ts'))});
    const bytes = Buffer.from(process.env.PDF_B64, 'base64');
    pdfTextLayer(bytes).then((t) => process.stdout.write(JSON.stringify({ t })));`;
  const run = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', script], {
    env: {
      ...process.env,
      PDF_B64: bytes.toString('base64'),
      TS_NODE_PROJECT: join(__dirname, '../../../../tsconfig.json'),
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (run.status !== 0) throw new Error(run.stderr || `exit ${run.status}`);
  return (JSON.parse(run.stdout) as { t: string | null }).t;
}

/** A one-page PDF whose text layer holds `lines` (Helvetica, no fonts embedded). */
function pdfWith(lines: string[]): Buffer {
  const content = `BT /F1 11 Tf 50 750 Td 14 TL ${lines
    .map((l) => `(${l.replace(/([()\\])/g, '\\$1')}) '`)
    .join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('pdfTextLayer (PS-104)', () => {
  it("reads a digital notice's text layer", () => {
    const text = pdfTextLayer(
      pdfWith(['FORM GST ASMT-10', 'Reference No: ZD190926000123X', 'GSTIN: 19AAACB1234C1Z5']),
    );
    expect(text).toContain('FORM GST ASMT-10');
    expect(text).toContain('ZD190926000123X');
  });

  it('gives null for a PDF with (almost) no text — a scan', () => {
    expect(pdfTextLayer(pdfWith(['p. 1']))).toBeNull();
  });

  it('gives null, never throws, for bytes that are not a PDF', () => {
    expect(pdfTextLayer(Buffer.from('not a pdf at all'))).toBeNull();
    expect(pdfTextLayer(Buffer.alloc(0))).toBeNull();
  });
});
