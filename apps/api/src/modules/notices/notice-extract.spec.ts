import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NoticeIntakeField } from '@hsdg/contracts';
import { extractNoticeFields, findDates, gstinCheckChar, isValidGstin } from './notice-extract';

/**
 * PS-104 — notice-extract over synthetic notices (no client data: names,
 * GSTINs, PANs and DINs are made up; GSTINs carry a valid check character).
 * Each fixture follows the layout of a GST portal / CBIC notice, an
 * income-tax e-proceeding or CPC notice, or a TRACES 200A intimation.
 */

type Expected = Partial<Record<NoticeIntakeField, string>> & { type?: string };

const FIXTURES: Record<string, Expected> = {
  'gst-asmt10': {
    gstin: '27AABCS1234F1ZR',
    referenceNo: 'ZD2710102600123',
    issuedOn: '2026-10-10',
    replyDueOn: '2026-11-09',
    form: 'ASMT-10',
    amountDemanded: '148350.00',
    financialYear: '2024-25',
    periodFrom: '2024-04-01',
    periodTo: '2025-03-31',
    type: 'GST_ASMT10',
  },
  'gst-drc01': {
    gstin: '29AAGFR5678K1ZE',
    referenceNo: 'ZD2915102600987',
    issuedOn: '2026-10-15',
    replyDueOn: '2026-11-14',
    form: 'DRC-01',
    section: 's.73',
    amountDemanded: '286200.00',
    periodFrom: '2023-04-01',
    periodTo: '2024-03-31',
    type: 'GST_DRC01',
  },
  'gst-drc01a': {
    gstin: '07AAACT9012M1Z6',
    referenceNo: 'ZD0712092600456',
    issuedOn: '2026-09-12',
    replyDueOn: '2026-09-27',
    form: 'DRC-01A',
    section: 's.73(5)',
    amountDemanded: '615500.00',
    financialYear: '2022-23',
    type: 'GST_DRC01A',
  },
  'gst-gstr3a': {
    gstin: '19AABCN3456P1ZW',
    referenceNo: 'ZD1901102600234',
    issuedOn: '2026-10-01',
    replyDueOn: '2026-10-16',
    form: 'GSTR-3A',
    section: 's.46',
    periodFrom: '2026-08-01',
    periodTo: '2026-08-31',
    type: 'GST_GSTR3A',
  },
  'gst-adt01': {
    gstin: '33AAJFK7788Q1ZA',
    referenceNo: 'CBIC-202610TNAD0B00012345',
    issuedOn: '2026-10-05',
    replyDueOn: '2026-10-20',
    form: 'ADT-01',
    section: 's.65',
    financialYear: '2023-24',
    type: 'GST_ADT01',
  },
  'it-143-2': {
    pan: 'ABCPM1234D',
    referenceNo: 'ITBA/AST/S/143(2)/2026-27/1071234567(1)',
    issuedOn: '2026-10-06',
    replyDueOn: '2026-10-21',
    section: 's.143(2)',
    assessmentYear: '2025-26',
    type: 'IT_143_2',
  },
  'it-142-1': {
    pan: 'AAGCB5566H',
    referenceNo: 'ITBA/AST/F/142(1)/2026-27/1072345678(1)',
    issuedOn: '2026-10-08',
    replyDueOn: '2026-10-20',
    section: 's.142(1)',
    assessmentYear: '2024-25',
    type: 'IT_142_1',
  },
  'it-148a': {
    pan: 'AAFPL7788E',
    referenceNo: 'ITBA/AST/S/148A/2026-27/1073456789(1)',
    issuedOn: '2026-09-30',
    replyDueOn: '2026-10-07',
    section: 's.148A(b)',
    assessmentYear: '2022-23',
    type: 'IT_148A',
  },
  'it-139-9': {
    pan: 'AKLPS9900Q',
    referenceNo: 'CPC/2526/G5/1987654321',
    issuedOn: '2026-10-02',
    replyDueOn: '2026-10-17',
    section: 's.139(9)',
    assessmentYear: '2025-26',
    type: 'IT_139_9',
  },
  'it-245': {
    pan: 'AABCG2233L',
    referenceNo: 'CPC/2627/A6/2345678901',
    issuedOn: '2026-10-11',
    replyDueOn: '2026-11-10',
    section: 's.245',
    amountDemanded: '45670.00',
    assessmentYear: '2026-27',
    type: 'IT_245',
  },
  'it-156': {
    pan: 'AAECP4455M',
    referenceNo: 'ITBA/AST/S/156/2026-27/1074567890(1)',
    issuedOn: '2026-09-29',
    replyDueOn: '2026-10-29',
    section: 's.156',
    amountDemanded: '234560.00',
    assessmentYear: '2023-24',
    type: 'IT_156',
  },
  'tds-200a': {
    pan: 'AAMFS3344N',
    referenceNo: 'TDS200A/2627/AAA/7654321',
    issuedOn: '2026-10-04',
    section: 's.200A',
    amountDemanded: '12340.00',
    financialYear: '2025-26',
    type: 'TDS_200A',
  },
};

const ALL_FIELDS: NoticeIntakeField[] = [
  'gstin',
  'pan',
  'referenceNo',
  'issuedOn',
  'replyDueOn',
  'section',
  'form',
  'amountDemanded',
  'financialYear',
  'assessmentYear',
  'periodFrom',
  'periodTo',
];
/** The form pre-fills a suggestion at or above this confidence. */
const PREFILL = 0.5;

const load = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', `${name}.txt`), 'utf8');

describe('notice-extract over the sample notices', () => {
  const results = Object.entries(FIXTURES).map(([name, expected]) => ({
    name,
    expected,
    got: extractNoticeFields(load(name)),
  }));

  it.each(results.map((r) => [r.name, r] as const))(
    '%s: reference number and dates are pre-filled exactly',
    (_name, { expected, got }) => {
      for (const f of ['referenceNo', 'issuedOn', 'replyDueOn'] as const) {
        const s = got.fields[f];
        const prefilled = s && s.confidence >= PREFILL ? s.value : undefined;
        expect({ field: f, value: prefilled }).toEqual({ field: f, value: expected[f] });
      }
    },
  );

  it.each(results.map((r) => [r.name, r] as const))(
    '%s: identifiers, section / form, amount, years, period and type',
    (_name, { expected, got }) => {
      for (const f of ALL_FIELDS) {
        if (expected[f] === undefined) continue;
        expect({ field: f, value: got.fields[f]?.value }).toEqual({
          field: f,
          value: expected[f],
        });
      }
      expect(got.noticeTypeCode?.value).toBe(expected.type);
    },
  );

  it('pre-fills at least 80% of reference numbers and dates correctly (and reports the rate)', () => {
    let right = 0;
    let total = 0;
    let allRight = 0;
    let allTotal = 0;
    for (const { expected, got } of results) {
      for (const f of ALL_FIELDS) {
        const s = got.fields[f];
        const prefilled = s && s.confidence >= PREFILL ? s.value : undefined;
        // An absent expectation is right only when nothing (confident) was pre-filled.
        const ok = prefilled === expected[f];
        allTotal += 1;
        if (ok) allRight += 1;
        if (f === 'referenceNo' || f === 'issuedOn' || f === 'replyDueOn') {
          total += 1;
          if (ok) right += 1;
        }
      }
    }
    const rate = right / total;
    const allRate = allRight / allTotal;
    // Surfaced in the test log for the PS-104 "done when".
    process.stdout.write(
      `notice-extract: reference+dates ${right}/${total} (${(rate * 100).toFixed(1)}%), ` +
        `every field ${allRight}/${allTotal} (${(allRate * 100).toFixed(1)}%)\n`,
    );
    expect(rate).toBeGreaterThanOrEqual(0.8);
    expect(allRate).toBeGreaterThanOrEqual(0.8);
  });

  it('reads the same through OCR noise (CRLF, doubled spaces, tabs)', () => {
    for (const { name, expected } of results) {
      const noisy = load(name).replace(/\n/g, '\r\n').replace(/ /g, '  ').replace(/: /g, ':\t');
      const got = extractNoticeFields(noisy);
      for (const f of ['referenceNo', 'issuedOn', 'replyDueOn'] as const) {
        expect({ name, f, value: got.fields[f]?.value }).toEqual({ name, f, value: expected[f] });
      }
    }
  });

  it('carries a snippet of the text each value was read from', () => {
    const got = extractNoticeFields(load('it-143-2'));
    expect(got.fields.replyDueOn?.snippet).toContain('on or before 21/10/2026');
    expect(got.fields.referenceNo?.snippet).toContain('DIN & Notice No');
  });

  it('grades confidence: labelled high, computed medium, inferred low', () => {
    const asmt = extractNoticeFields(load('gst-asmt10'));
    expect(asmt.fields.referenceNo?.confidence).toBe(0.9);
    expect(asmt.fields.issuedOn?.confidence).toBe(0.9);
    // The PAN inside the GSTIN is an inference.
    expect(asmt.fields.pan).toEqual(
      expect.objectContaining({ value: 'AABCS1234F', confidence: 0.4 }),
    );
    // "within thirty days" is computed from the issue date.
    const demand = extractNoticeFields(load('it-156'));
    expect(demand.fields.replyDueOn?.confidence).toBe(0.6);
    // An amount on a notice that demands nothing is not pre-filled.
    const inquiry = extractNoticeFields(load('it-142-1'));
    expect((inquiry.fields.amountDemanded?.confidence ?? 0) < PREFILL).toBe(true);
  });

  it('ignores the hearing date and the refund amount', () => {
    const scn = extractNoticeFields(load('gst-drc01'));
    expect(scn.fields.replyDueOn?.value).toBe('2026-11-14');
    const setOff = extractNoticeFields(load('it-245'));
    expect(setOff.fields.amountDemanded?.value).toBe('45670.00');
  });
});

describe('notice-extract helpers', () => {
  it('validates the GSTIN check character', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZW')).toBe(false);
  });

  it('gives an unchecked GSTIN low confidence', () => {
    const got = extractNoticeFields('Notice\nGSTIN: 27AAPFU0939F1ZW\n');
    expect(got.fields.gstin).toEqual(expect.objectContaining({ confidence: 0.4 }));
  });

  it('reads Indian date formats', () => {
    const text =
      '01/02/2026 03-04-2026 05.06.2026 15th October, 2026 15-Oct-2026 7 Nov 2026 December 1, 2026 31/02/2026';
    expect(findDates(text).map((d) => d.iso)).toEqual([
      '2026-02-01',
      '2026-04-03',
      '2026-06-05',
      '2026-10-15',
      '2026-10-15',
      '2026-11-07',
      '2026-12-01',
    ]);
  });

  it('labels: "Date of issue", "Reply by", a reply period in words', () => {
    const got = extractNoticeFields(
      'Notice No. ABC/123/2026\nDate of issue: 1st October, 2026\nReply by 10/10/2026\n',
    );
    expect(got.fields.referenceNo?.value).toBe('ABC/123/2026');
    expect(got.fields.issuedOn?.value).toBe('2026-10-01');
    expect(got.fields.replyDueOn?.value).toBe('2026-10-10');
    const words = extractNoticeFields(
      'Dated: 01/10/2026\nPlease respond within a period of seven days.',
    );
    expect(words.fields.replyDueOn?.value).toBe('2026-10-08');
  });

  it('reads AY / FY in their long forms', () => {
    const got = extractNoticeFields('Assessment Year 2024-2025\nFinancial Year: 2023-24');
    expect(got.fields.assessmentYear?.value).toBe('2024-25');
    expect(got.fields.financialYear?.value).toBe('2023-24');
  });

  it('maps a section to the library when there is no form', () => {
    expect(extractNoticeFields('Notice u/s 270A read with 274').noticeTypeCode?.value).toBe(
      'IT_270A_274',
    );
    expect(extractNoticeFields('Notice under section 148 of the Act').noticeTypeCode?.value).toBe(
      'IT_148',
    );
  });

  it('returns nothing for empty text', () => {
    expect(extractNoticeFields('')).toEqual({ fields: {}, noticeTypeCode: null });
    expect(extractNoticeFields(null)).toEqual({ fields: {}, noticeTypeCode: null });
  });
});
