import { inflateSync } from 'node:zlib';
import type { PartnerPackFigures } from '@hsdg/contracts';
import { renderPartnerPackPdf } from './partner-pack-pdf';
import { isPackDay } from './partner-packs.scheduler';
import { packHeadline } from './partner-packs.service';

const pack = (over: Partial<PartnerPackFigures> = {}): PartnerPackFigures => ({
  month: '2026-10',
  from: '2026-10-01',
  to: '2026-10-31',
  asOf: '2026-11-03',
  partner: { employeeId: 'e1', name: 'Asha Rao', officeCode: 'DEL' },
  scope: 'own',
  risk: [
    {
      key: 'missed',
      label: 'Missed filings',
      count: 7,
      amount: null,
      available: true,
      items: [{ title: 'Bharat Steels · GSTR-1', detail: 'Sep 2026', dueOn: '2026-10-11' }],
    },
    {
      key: 'receivables',
      label: 'Receivables',
      count: 2,
      amount: '420000.00',
      available: true,
      items: [],
    },
    { key: 'dsc', label: 'DSC', count: 0, amount: null, available: false, items: [] },
  ],
  filingsDone: {
    total: 86,
    byStream: [
      { stream: 'gst', count: 80 },
      { stream: 'income_tax', count: 6 },
    ],
  },
  noticesClosed: { total: 1, byOutcome: [{ outcome: 'dropped', count: 1 }] },
  invoiced: { count: 4, amount: '118000.00' },
  collected: { count: 3, amount: '420000.00' },
  profitability: null,
  ...over,
});

/** The text drawn on the pages (content streams, inflated where compressed). */
function textOf(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const body = Buffer.from(m[1]!, 'latin1');
    try {
      out.push(inflateSync(body).toString('latin1'));
    } catch {
      out.push(m[1]!);
    }
  }
  return out.join('\n');
}

describe('PS-303 partner pack PDF', () => {
  it('draws the tiles, the month and the money', () => {
    const pdf = renderPartnerPackPdf(pack(), 'Dhvaj & Co');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = textOf(pdf);
    expect(text).toContain('Partner pack - October 2026');
    expect(text).toContain('Missed filings');
    expect(text).toContain('Bharat Steels - GSTR-1 - Sep 2026');
    expect(text).toContain('and 6 more on the dashboard');
    expect(text).toContain('2 - Rs. 4,20,000.00');
    expect(text).toContain('not in use yet');
    expect(text).toContain('Income tax');
    expect(text).toContain('Rs. 1,18,000.00');
    expect(text).toContain('once cost rates are set up');
    expect(text).not.toContain('?');
  });

  it('runs to more pages when the tiles are long', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      title: `Client ${i}`,
      detail: 'x'.repeat(300),
      dueOn: '2026-10-01',
    }));
    const risk = Array.from({ length: 9 }, (_, i) => ({
      ...pack().risk[0]!,
      key: 'missed' as const,
      label: `Tile ${i}`,
      items: many,
    }));
    const text = textOf(renderPartnerPackPdf(pack({ risk }), null));
    expect(text).toContain('Page 1 of ');
    expect(text).toContain('Page 2 of ');
  });

  it('says the profitability once PS-302 gives it', () => {
    const text = textOf(
      renderPartnerPackPdf(
        pack({
          profitability: {
            timeCost: '50000.00',
            standardValue: '80000.00',
            billed: '70000.00',
            realisationPct: 87.5,
            margin: '20000.00',
          },
        }),
        null,
      ),
    );
    expect(text).toContain('87.5%');
    expect(text).toContain('Rs. 20,000.00');
  });

  it('headline and pack day', () => {
    expect(packHeadline(pack())).toBe('Risk 9 · Filed 86 · Collected ₹4,20,000.00');
    expect(isPackDay('2026-11-03')).toBe(true);
    expect(isPackDay('2026-11-13')).toBe(false);
  });
});
