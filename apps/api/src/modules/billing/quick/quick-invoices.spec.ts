import { deflateSync } from 'node:zlib';
import {
  addMonth,
  firstRunOn,
  invoiceMailtoUrl,
  invoiceSendText,
  quickInvoiceDescription,
  quickInvoiceTotals,
} from '@hsdg/contracts';
import { bankLines, firmHeaderLines, renderInvoicePdf, type InvoicePdfData } from '../invoice-pdf';
import { ImageError, fitInto, pdfImage } from '../pdf-image';
import { normaliseFirmField } from './firm-profile.service';
import { nextAfter } from './recurring-invoices.service';

/** A tiny PNG: `type` 2 (RGB) or 6 (RGBA), rows filtered with `filter`. */
function png(width: number, height: number, type: 2 | 6, pixel: number[], filter = 0): Buffer {
  const ch = type === 6 ? 4 : 3;
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(filter);
    for (let x = 0; x < width; x++) {
      // Sub filter: every pixel after the first is stored as the difference (0).
      rows.push(...(filter === 1 && x > 0 ? new Array(ch).fill(0) : pixel));
    }
  }
  const chunk = (name: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    return Buffer.concat([len, Buffer.from(name, 'latin1'), body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = type;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A JPEG header far enough for its size: SOI, SOF0 (h, w, comps). */
function jpeg(width: number, height: number, comps: number): Buffer {
  const sof = [
    0xff,
    0xc0,
    0,
    8 + comps * 3,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    comps,
  ];
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, ...sof, ...new Array(comps * 3).fill(1)]);
}

describe('the logo on an invoice PDF', () => {
  it('a JPEG passes through with its size', () => {
    const img = pdfImage(jpeg(300, 120, 3), 'image/jpeg');
    expect(img).toMatchObject({
      width: 300,
      height: 120,
      colorSpace: 'DeviceRGB',
      filter: 'DCTDecode',
    });
  });

  it('a CMYK JPEG, or something that is not one, is refused in words', () => {
    expect(() => pdfImage(jpeg(10, 10, 4), 'image/jpeg')).toThrow(/CMYK/);
    expect(() => pdfImage(Buffer.from('hello'), 'image/jpeg')).toThrow(ImageError);
  });

  it('a PNG is decoded (filters undone) and laid on white', () => {
    const opaque = pdfImage(png(3, 2, 2, [10, 20, 30], 1), 'image/png');
    expect(opaque).toMatchObject({ width: 3, height: 2, filter: 'FlateDecode' });
    // Half-transparent black on white is mid-grey.
    const glass = pdfImage(png(1, 1, 6, [0, 0, 0, 128]), 'image/png');
    const { inflateSync } = jest.requireActual<typeof import('node:zlib')>('node:zlib');
    expect([...inflateSync(glass.data)]).toEqual([127, 127, 127]);
  });

  it('fits a box keeping its shape', () => {
    expect(fitInto({ width: 300, height: 100 }, 64, 56)).toEqual({ w: 64, h: 21.33 });
  });
});

describe('the firm in full on the invoice', () => {
  const firm: InvoicePdfData['firm'] = {
    name: 'Dhvaj & Co',
    address: '12 Ring Road, New Delhi',
    gstin: '07AAAFD1234K1Z5',
    stateCode: '07',
    pan: 'AAAFD1234K',
    frn: '012345N',
    phone: '+91 98100 00000',
    email: 'accounts@dhvaj.in',
    website: 'dhvaj.in',
    bank: {
      accountName: 'Dhvaj & Co',
      bankName: 'HDFC Bank',
      accountNumber: '50200012345678',
      ifsc: 'HDFC0001234',
      branch: 'Connaught Place',
      upiId: null,
    },
  };

  it('prints address, GSTIN, PAN and FRN, then phone / e-mail / website', () => {
    expect(firmHeaderLines(firm)).toEqual([
      '12 Ring Road, New Delhi',
      'GSTIN: 07AAAFD1234K1Z5   State: Delhi (07)',
      'PAN: AAAFD1234K   FRN: 012345N',
      'Phone: +91 98100 00000   Email: accounts@dhvaj.in   dhvaj.in',
    ]);
  });

  it('prints the bank details, and nothing when none are on file', () => {
    expect(bankLines(firm.bank)).toEqual([
      'Account name: Dhvaj & Co',
      'Bank: HDFC Bank, Connaught Place',
      'A/c no: 50200012345678   IFSC: HDFC0001234',
    ]);
    expect(bankLines(null)).toEqual([]);
  });

  it('the PDF carries the logo as an image and the bank block', () => {
    const pdf = renderInvoicePdf({
      firm: { ...firm, logo: pdfImage(png(4, 4, 2, [200, 0, 0]), 'image/png') },
      client: { name: 'Acme Ltd', pan: null, gstin: null },
      invoiceNumber: 'INV/26-27/0001',
      issueDate: '2026-11-04',
      dueDate: '2026-11-19',
      placeOfSupplyState: '07',
      isReverseCharge: false,
      lines: [
        {
          description: 'GST compliance — November 2026',
          sacCode: '998221',
          quantity: '1.00',
          unitAmount: '15000.00',
          gstRate: '18.00',
          taxableValue: '15000.00',
        },
      ],
      split: {
        taxable: '15000.00',
        cgst: '1350.00',
        sgst: '1350.00',
        igst: '0.00',
        tax: '2700.00',
        intraState: true,
        byRate: [
          { rate: '18', taxable: '15000.00', cgst: '1350.00', sgst: '1350.00', igst: '0.00' },
        ],
      } as InvoicePdfData['split'],
      taxAmount: '2700.00',
      total: '17700.00',
      amountInWords: 'Rupees Seventeen Thousand Seven Hundred Only',
      notes: null,
    }).toString('latin1');
    expect(pdf).toContain('/XObject << /Im1');
    expect(pdf).toContain('/Im1 Do');
    expect(pdf).toContain('(Bank details)');
    expect(pdf).toContain('(PAN: AAAFD1234K   FRN: 012345N)');
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
  });

  it('stores capitals for PAN / IFSC, no spaces in an account number, blank as none', () => {
    expect(normaliseFirmField('pan', ' aaafd1234k ')).toBe('AAAFD1234K');
    expect(normaliseFirmField('bankAccountNumber', '5020 0012 3456')).toBe('502000123456');
    expect(normaliseFirmField('bankName', '  HDFC   Bank ')).toBe('HDFC Bank');
    expect(normaliseFirmField('phone', '   ')).toBeNull();
  });
});

describe('quick invoice and the monthly schedule', () => {
  it('describes the line by service and month', () => {
    expect(quickInvoiceDescription('GST compliance', '2026-11-04')).toBe(
      'GST compliance — November 2026',
    );
  });

  it('previews tax and total', () => {
    expect(quickInvoiceTotals('15000', 18)).toEqual({ taxable: 15000, tax: 2700, total: 17700 });
    expect(quickInvoiceTotals('0', 18)).toBeNull();
    expect(quickInvoiceTotals('abc', 18)).toBeNull();
  });

  it('the first run is this month’s day if it is still ahead, else next month’s', () => {
    expect(firstRunOn('2026-11-04', 5)).toBe('2026-11-05');
    expect(firstRunOn('2026-11-04', 4)).toBe('2026-11-04');
    expect(firstRunOn('2026-11-04', 1)).toBe('2026-12-01');
    expect(firstRunOn('2026-12-20', 1)).toBe('2027-01-01');
    expect(addMonth('2026-12-28')).toBe('2027-01-28');
  });

  it('after a run the next one is after today — missed months are not billed again', () => {
    expect(nextAfter('2026-11-01', '2026-11-01')).toBe('2026-12-01');
    expect(nextAfter('2026-08-01', '2026-11-04')).toBe('2026-12-01');
  });

  it('the send text carries the number, amount, due date and link', () => {
    const { subject, text } = invoiceSendText({
      clientName: 'Acme Ltd',
      invoiceNumber: 'INV/26-27/0001',
      total: '17700',
      dueDate: '2026-11-19',
      firmName: 'Dhvaj & Co',
      link: 'https://portal.dhvaj.in/invoice/abc',
    });
    expect(subject).toBe('Invoice INV/26-27/0001 from Dhvaj & Co');
    expect(text).toContain('INV/26-27/0001 for Rs. 17,700.00, due 19-11-2026.');
    expect(text).toContain('https://portal.dhvaj.in/invoice/abc');
    expect(invoiceMailtoUrl('a@b.in', subject, text)).toMatch(/^mailto:a%40b\.in\?subject=Invoice/);
  });
});
